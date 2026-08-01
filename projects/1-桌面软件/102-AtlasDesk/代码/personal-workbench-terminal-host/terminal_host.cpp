#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <string>
#include <vector>
#include <thread>
#include <atomic>
#include <algorithm>
#include <cstdio>

static std::wstring ReadEnvironment(const wchar_t* name)
{
    DWORD required = GetEnvironmentVariableW(name, nullptr, 0);
    if (required == 0) return L"";
    std::wstring value(required, L'\0');
    DWORD copied = GetEnvironmentVariableW(name, value.data(), required);
    if (copied == 0 || copied >= required) return L"";
    value.resize(copied);
    return value;
}

static std::wstring Quote(const std::wstring& value)
{
    return L"\"" + value + L"\"";
}

static HANDLE ConnectNamedPipeClient(const std::wstring& name, DWORD access)
{
    if (name.empty()) return INVALID_HANDLE_VALUE;
    const std::wstring fullName = L"\\\\.\\pipe\\" + name;
    for (int attempt = 0; attempt < 150; ++attempt)
    {
        HANDLE handle = CreateFileW(
            fullName.c_str(),
            access,
            0,
            nullptr,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            nullptr);
        if (handle != INVALID_HANDLE_VALUE) return handle;

        const DWORD error = GetLastError();
        if (error != ERROR_PIPE_BUSY && error != ERROR_FILE_NOT_FOUND)
            return INVALID_HANDLE_VALUE;
        WaitNamedPipeW(fullName.c_str(), 100);
        Sleep(20);
    }
    return INVALID_HANDLE_VALUE;
}

static bool WriteAll(HANDLE handle, const BYTE* data, DWORD count)
{
    DWORD offset = 0;
    while (offset < count)
    {
        DWORD written = 0;
        if (!WriteFile(handle, data + offset, count - offset, &written, nullptr) || written == 0)
            return false;
        offset += written;
    }
    return true;
}

static HRESULT PrepareStartupInformation(HPCON pseudoConsole, STARTUPINFOEXW& startup)
{
    ZeroMemory(&startup, sizeof(startup));
    startup.StartupInfo.cb = sizeof(STARTUPINFOEXW);
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;

    SIZE_T bytesRequired = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &bytesRequired);
    startup.lpAttributeList = reinterpret_cast<PPROC_THREAD_ATTRIBUTE_LIST>(
        HeapAlloc(GetProcessHeap(), 0, bytesRequired));
    if (!startup.lpAttributeList) return E_OUTOFMEMORY;

    if (!InitializeProcThreadAttributeList(startup.lpAttributeList, 1, 0, &bytesRequired))
        return HRESULT_FROM_WIN32(GetLastError());

    if (!UpdateProcThreadAttribute(
            startup.lpAttributeList,
            0,
            PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
            pseudoConsole,
            sizeof(pseudoConsole),
            nullptr,
            nullptr))
        return HRESULT_FROM_WIN32(GetLastError());

    return S_OK;
}

static void FreeStartupInformation(STARTUPINFOEXW& startup)
{
    if (!startup.lpAttributeList) return;
    DeleteProcThreadAttributeList(startup.lpAttributeList);
    HeapFree(GetProcessHeap(), 0, startup.lpAttributeList);
    startup.lpAttributeList = nullptr;
}

static void ControlLoop(HANDLE control, HPCON pseudoConsole, std::atomic_bool& stopping)
{
    std::string pending;
    char buffer[256];
    while (!stopping.load())
    {
        DWORD read = 0;
        if (!ReadFile(control, buffer, sizeof(buffer), &read, nullptr) || read == 0)
            break;
        pending.append(buffer, buffer + read);
        size_t newline = 0;
        while ((newline = pending.find('\n')) != std::string::npos)
        {
            std::string line = pending.substr(0, newline);
            pending.erase(0, newline + 1);
            int columns = 0;
            int rows = 0;
            if (sscanf_s(line.c_str(), "RESIZE %d %d", &columns, &rows) == 2)
            {
                COORD size{
                    static_cast<SHORT>(std::clamp(columns, 20, 500)),
                    static_cast<SHORT>(std::clamp(rows, 5, 300))
                };
                ResizePseudoConsole(pseudoConsole, size);
            }
        }
    }
}

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int)
{
    const std::wstring application = ReadEnvironment(L"PWB_TERMINAL_APP");
    const std::wstring arguments = ReadEnvironment(L"PWB_TERMINAL_ARGS");
    const std::wstring workingDirectory = ReadEnvironment(L"PWB_TERMINAL_CWD");
    const std::wstring inputPipeName = ReadEnvironment(L"PWB_TERMINAL_INPUT_PIPE");
    const std::wstring outputPipeName = ReadEnvironment(L"PWB_TERMINAL_OUTPUT_PIPE");
    const std::wstring controlPipeName = ReadEnvironment(L"PWB_TERMINAL_CONTROL_PIPE");
    int columns = _wtoi(ReadEnvironment(L"PWB_TERMINAL_COLS").c_str());
    int rows = _wtoi(ReadEnvironment(L"PWB_TERMINAL_ROWS").c_str());
    columns = std::clamp(columns > 0 ? columns : 100, 20, 500);
    rows = std::clamp(rows > 0 ? rows : 28, 5, 300);

    if (application.empty() || inputPipeName.empty() || outputPipeName.empty() || controlPipeName.empty())
        return 101;

    HANDLE hostInput = ConnectNamedPipeClient(inputPipeName, GENERIC_READ);
    HANDLE hostOutput = ConnectNamedPipeClient(outputPipeName, GENERIC_WRITE);
    HANDLE hostControl = ConnectNamedPipeClient(controlPipeName, GENERIC_READ);
    if (hostInput == INVALID_HANDLE_VALUE || hostOutput == INVALID_HANDLE_VALUE || hostControl == INVALID_HANDLE_VALUE)
    {
        if (hostInput != INVALID_HANDLE_VALUE) CloseHandle(hostInput);
        if (hostOutput != INVALID_HANDLE_VALUE) CloseHandle(hostOutput);
        if (hostControl != INVALID_HANDLE_VALUE) CloseHandle(hostControl);
        return 102;
    }

    HANDLE pseudoInput = nullptr;
    HANDLE bridgeInput = nullptr;
    HANDLE bridgeOutput = nullptr;
    HANDLE pseudoOutput = nullptr;
    HPCON pseudoConsole = nullptr;
    PROCESS_INFORMATION processInfo{};
    STARTUPINFOEXW startup{};

    if (!CreatePipe(&pseudoInput, &bridgeInput, nullptr, 0) ||
        !CreatePipe(&bridgeOutput, &pseudoOutput, nullptr, 0))
    {
        if (pseudoInput) CloseHandle(pseudoInput);
        if (bridgeInput) CloseHandle(bridgeInput);
        if (bridgeOutput) CloseHandle(bridgeOutput);
        if (pseudoOutput) CloseHandle(pseudoOutput);
        CloseHandle(hostInput);
        CloseHandle(hostOutput);
        CloseHandle(hostControl);
        return 103;
    }

    COORD initialSize{ static_cast<SHORT>(columns), static_cast<SHORT>(rows) };
    HRESULT result = CreatePseudoConsole(initialSize, pseudoInput, pseudoOutput, 0, &pseudoConsole);
    if (FAILED(result))
    {
        CloseHandle(pseudoInput);
        CloseHandle(bridgeInput);
        CloseHandle(bridgeOutput);
        CloseHandle(pseudoOutput);
        CloseHandle(hostInput);
        CloseHandle(hostOutput);
        CloseHandle(hostControl);
        return 104;
    }

    result = PrepareStartupInformation(pseudoConsole, startup);
    if (FAILED(result))
    {
        ClosePseudoConsole(pseudoConsole);
        CloseHandle(pseudoInput);
        CloseHandle(bridgeInput);
        CloseHandle(bridgeOutput);
        CloseHandle(pseudoOutput);
        CloseHandle(hostInput);
        CloseHandle(hostOutput);
        CloseHandle(hostControl);
        return 105;
    }

    std::wstring commandLine = Quote(application);
    if (!arguments.empty()) commandLine += L" " + arguments;
    std::vector<wchar_t> mutableCommand(commandLine.begin(), commandLine.end());
    mutableCommand.push_back(L'\0');

    BOOL created = CreateProcessW(
        nullptr,
        mutableCommand.data(),
        nullptr,
        nullptr,
        FALSE,
        EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
        nullptr,
        workingDirectory.empty() ? nullptr : workingDirectory.c_str(),
        &startup.StartupInfo,
        &processInfo);
    FreeStartupInformation(startup);
    if (!created)
    {
        ClosePseudoConsole(pseudoConsole);
        CloseHandle(pseudoInput);
        CloseHandle(bridgeInput);
        CloseHandle(bridgeOutput);
        CloseHandle(pseudoOutput);
        CloseHandle(hostInput);
        CloseHandle(hostOutput);
        CloseHandle(hostControl);
        return 106;
    }

    std::atomic_bool stopping{ false };
    std::thread inputThread([&]()
    {
        BYTE buffer[16384];
        while (!stopping.load())
        {
            DWORD read = 0;
            if (!ReadFile(hostInput, buffer, static_cast<DWORD>(sizeof(buffer)), &read, nullptr) || read == 0)
                break;
            if (!WriteAll(bridgeInput, buffer, read))
                break;
        }
    });

    std::thread outputThread([&]()
    {
        BYTE buffer[16384];
        while (!stopping.load())
        {
            DWORD read = 0;
            if (!ReadFile(bridgeOutput, buffer, static_cast<DWORD>(sizeof(buffer)), &read, nullptr) || read == 0)
                break;
            if (!WriteAll(hostOutput, buffer, read))
                break;
        }
    });

    std::thread controlThread(ControlLoop, hostControl, pseudoConsole, std::ref(stopping));

    WaitForSingleObject(processInfo.hProcess, INFINITE);
    DWORD exitCode = 0;
    GetExitCodeProcess(processInfo.hProcess, &exitCode);
    stopping.store(true);

    CancelSynchronousIo(inputThread.native_handle());
    CancelSynchronousIo(outputThread.native_handle());
    CancelSynchronousIo(controlThread.native_handle());

    CloseHandle(bridgeInput);
    ClosePseudoConsole(pseudoConsole);
    CloseHandle(bridgeOutput);
    CloseHandle(pseudoInput);
    CloseHandle(pseudoOutput);
    CloseHandle(hostInput);
    CloseHandle(hostOutput);
    CloseHandle(hostControl);

    if (inputThread.joinable()) inputThread.join();
    if (outputThread.joinable()) outputThread.join();
    if (controlThread.joinable()) controlThread.join();

    CloseHandle(processInfo.hThread);
    CloseHandle(processInfo.hProcess);
    return static_cast<int>(exitCode);
}
