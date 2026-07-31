using Microsoft.Win32.SafeHandles;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace PersonalWorkbench;

public sealed class TerminalLaunchSpec
{
    public string Title { get; init; } = "Terminal";
    public string Executable { get; init; } = string.Empty;
    public string Arguments { get; init; } = string.Empty;
    public string WorkingDirectory { get; init; } = string.Empty;
    public string InitialInput { get; init; } = string.Empty;

    public static TerminalLaunchSpec Create(AppSettings settings, string shell, PythonEnvironmentInfo? environment = null, string? title = null)
    {
        var workspace = Directory.Exists(settings.WorkspaceRoot)
            ? settings.WorkspaceRoot
            : environment is not null && Directory.Exists(environment.Prefix)
                ? environment.Prefix
                : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

        var useCmd = string.Equals(shell, "cmd", StringComparison.OrdinalIgnoreCase) || environment is not null;
        if (useCmd)
        {
            var command = Environment.GetEnvironmentVariable("ComSpec") ?? Path.Combine(Environment.SystemDirectory, "cmd.exe");
            var initial = new StringBuilder();
            if (environment is not null)
            {
                if (environment.Kind == "conda")
                {
                    var condaBat = ResolveCondaBatch(settings.CondaPath);
                    if (!string.IsNullOrWhiteSpace(condaBat))
                        initial.Append("call \"").Append(condaBat).Append("\" activate \"").Append(environment.Prefix).Append("\"\r");
                }
                else if (environment.Kind == "uv")
                {
                    var activate = Path.Combine(environment.Prefix, "Scripts", "activate.bat");
                    if (File.Exists(activate))
                        initial.Append("call \"").Append(activate).Append("\"\r");
                }
            }
            initial.Append("cd /d \"").Append(workspace).Append("\"\r");
            return new TerminalLaunchSpec
            {
                Title = title ?? environment?.DisplayName ?? "CMD",
                Executable = command,
                Arguments = "/d /q",
                WorkingDirectory = workspace,
                InitialInput = initial.ToString()
            };
        }

        var pwsh = FindExecutable("pwsh.exe");
        var executable = !string.IsNullOrWhiteSpace(pwsh)
            ? pwsh
            : Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe");
        var escaped = workspace.Replace("'", "''", StringComparison.Ordinal);
        return new TerminalLaunchSpec
        {
            Title = title ?? (Path.GetFileName(executable).Equals("pwsh.exe", StringComparison.OrdinalIgnoreCase) ? "PowerShell 7" : "PowerShell"),
            Executable = executable,
            Arguments = "-NoLogo -NoExit",
            WorkingDirectory = workspace,
            InitialInput = $"Set-Location -LiteralPath '{escaped}'\r"
        };
    }

    private static string ResolveCondaBatch(string? condaPath)
    {
        if (string.IsNullOrWhiteSpace(condaPath)) return string.Empty;
        if (condaPath.EndsWith(".bat", StringComparison.OrdinalIgnoreCase) && File.Exists(condaPath)) return condaPath;
        try
        {
            var scripts = Path.GetDirectoryName(condaPath);
            var root = scripts is null ? null : Directory.GetParent(scripts)?.FullName;
            var candidate = root is null ? string.Empty : Path.Combine(root, "condabin", "conda.bat");
            return File.Exists(candidate) ? candidate : string.Empty;
        }
        catch { return string.Empty; }
    }

    private static string FindExecutable(string name)
    {
        var path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        foreach (var segment in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                var candidate = Path.Combine(segment.Trim().Trim('"'), name);
                if (File.Exists(candidate)) return candidate;
            }
            catch { }
        }
        return string.Empty;
    }
}

public sealed class ConPtySession : IAsyncDisposable, IDisposable
{
    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint HANDLE_FLAG_INHERIT = 0x00000001;
    private const int MaxPendingOutputChars = 262_144;
    private static readonly IntPtr PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = new(0x00020016);

    private IntPtr _pseudoConsole;
    private IntPtr _processHandle;
    private IntPtr _threadHandle;
    private SafeFileHandle? _inputHandle;
    private SafeFileHandle? _outputHandle;
    private FileStream? _inputStream;
    private FileStream? _outputStream;
    private readonly CancellationTokenSource _cts = new();
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private readonly object _outputGate = new();
    private readonly StringBuilder _pendingOutput = new();
    private EventHandler<string>? _outputReceived;
    private Task? _readTask;
    private Task? _waitTask;
    private bool _disposed;

    public event EventHandler<string>? OutputReceived
    {
        add
        {
            if (value is null) return;
            string pending = string.Empty;
            lock (_outputGate)
            {
                _outputReceived += value;
                if (_pendingOutput.Length > 0)
                {
                    pending = _pendingOutput.ToString();
                    _pendingOutput.Clear();
                }
            }
            if (pending.Length > 0)
                value(this, pending);
        }
        remove
        {
            lock (_outputGate) _outputReceived -= value;
        }
    }

    public event EventHandler<int>? Exited;
    public int ProcessId { get; private set; }

    public static ConPtySession Start(TerminalLaunchSpec spec, int columns, int rows)
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 17763))
            throw new PlatformNotSupportedException("内置终端需要 Windows 10 1809 或更高版本。");
        if (!File.Exists(spec.Executable))
            throw new FileNotFoundException("未找到终端程序。", spec.Executable);

        var session = new ConPtySession();
        session.Initialize(spec, columns, rows);
        return session;
    }

    private void Initialize(TerminalLaunchSpec spec, int columns, int rows)
    {
        var security = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf<SECURITY_ATTRIBUTES>(), bInheritHandle = true };
        if (!CreatePipe(out var inputRead, out var inputWrite, ref security, 0))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        if (!CreatePipe(out var outputRead, out var outputWrite, ref security, 0))
        {
            CloseHandle(inputRead);
            CloseHandle(inputWrite);
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        try
        {
            if (!SetHandleInformation(inputWrite, HANDLE_FLAG_INHERIT, 0))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            if (!SetHandleInformation(outputRead, HANDLE_FLAG_INHERIT, 0))
                throw new Win32Exception(Marshal.GetLastWin32Error());

            var hr = CreatePseudoConsole(
                new COORD((short)Math.Clamp(columns, 20, 500), (short)Math.Clamp(rows, 5, 300)),
                inputRead,
                outputWrite,
                0,
                out _pseudoConsole);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);

            var attributeSize = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeSize);
            var attributeList = Marshal.AllocHGlobal(attributeSize);
            try
            {
                if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeSize))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                if (!UpdateProcThreadAttribute(attributeList, 0, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, _pseudoConsole, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero))
                    throw new Win32Exception(Marshal.GetLastWin32Error());

                var startup = new STARTUPINFOEX
                {
                    StartupInfo = new STARTUPINFO { cb = Marshal.SizeOf<STARTUPINFOEX>() },
                    lpAttributeList = attributeList
                };
                var commandLine = new StringBuilder(Quote(spec.Executable));
                if (!string.IsNullOrWhiteSpace(spec.Arguments)) commandLine.Append(' ').Append(spec.Arguments);
                if (!CreateProcessW(
                        null,
                        commandLine,
                        IntPtr.Zero,
                        IntPtr.Zero,
                        false,
                        EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
                        IntPtr.Zero,
                        string.IsNullOrWhiteSpace(spec.WorkingDirectory) ? null : spec.WorkingDirectory,
                        ref startup,
                        out var processInfo))
                    throw new Win32Exception(Marshal.GetLastWin32Error());

                _processHandle = processInfo.hProcess;
                _threadHandle = processInfo.hThread;
                ProcessId = unchecked((int)processInfo.dwProcessId);

                // The pseudoconsole must retain valid channel ends until the hosted process has
                // been created and attached. Closing these before CreateProcess can leave the
                // child on the caller's console instead of the pseudoconsole transport.
                CloseHandle(inputRead);
                inputRead = IntPtr.Zero;
                CloseHandle(outputWrite);
                outputWrite = IntPtr.Zero;
            }
            finally
            {
                DeleteProcThreadAttributeList(attributeList);
                Marshal.FreeHGlobal(attributeList);
            }

            _inputHandle = new SafeFileHandle(inputWrite, ownsHandle: true);
            inputWrite = IntPtr.Zero;
            _outputHandle = new SafeFileHandle(outputRead, ownsHandle: true);
            outputRead = IntPtr.Zero;

            // CreatePseudoConsole currently requires synchronous channel handles. Each blocking
            // channel is therefore serviced by a dedicated background thread instead of using
            // FILE_FLAG_OVERLAPPED / FileStream asynchronous mode.
            _inputStream = new FileStream(_inputHandle, FileAccess.Write, 4096, isAsync: false);
            _outputStream = new FileStream(_outputHandle, FileAccess.Read, 4096, isAsync: false);
            _readTask = Task.Factory.StartNew(ReadLoop, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
            _waitTask = Task.Factory.StartNew(WaitLoop, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
        }
        catch
        {
            if (_pseudoConsole != IntPtr.Zero)
            {
                ClosePseudoConsole(_pseudoConsole);
                _pseudoConsole = IntPtr.Zero;
            }
            throw;
        }
        finally
        {
            if (inputRead != IntPtr.Zero) CloseHandle(inputRead);
            if (inputWrite != IntPtr.Zero) CloseHandle(inputWrite);
            if (outputRead != IntPtr.Zero) CloseHandle(outputRead);
            if (outputWrite != IntPtr.Zero) CloseHandle(outputWrite);
        }
    }

    public async Task WriteAsync(string text)
    {
        if (_disposed || _inputStream is null || string.IsNullOrEmpty(text)) return;
        try
        {
            await _writeGate.WaitAsync(_cts.Token);
            try
            {
                var stream = _inputStream;
                if (_disposed || stream is null) return;
                var bytes = Encoding.UTF8.GetBytes(text);
                await Task.Run(() =>
                {
                    stream.Write(bytes, 0, bytes.Length);
                    stream.Flush();
                }, _cts.Token);
            }
            finally
            {
                _writeGate.Release();
            }
        }
        catch (OperationCanceledException) { }
        catch (ObjectDisposedException) { }
        catch (Exception ex) { App.Log("Terminal input failed: " + ex.Message); }
    }

    public void Resize(int columns, int rows)
    {
        if (_disposed || _pseudoConsole == IntPtr.Zero) return;
        try
        {
            var hr = ResizePseudoConsole(
                _pseudoConsole,
                new COORD((short)Math.Clamp(columns, 20, 500), (short)Math.Clamp(rows, 5, 300)));
            if (hr != 0) App.Log("ResizePseudoConsole failed: HRESULT 0x" + hr.ToString("X8"));
        }
        catch (Exception ex) { App.Log("Terminal resize failed: " + ex.Message); }
    }

    private void ReadLoop()
    {
        var stream = _outputStream;
        if (stream is null) return;
        var bytes = new byte[8192];
        var chars = new char[8192];
        var decoder = Encoding.UTF8.GetDecoder();
        try
        {
            while (!_cts.IsCancellationRequested)
            {
                var count = stream.Read(bytes, 0, bytes.Length);
                if (count <= 0) break;
                decoder.Convert(bytes, 0, count, chars, 0, chars.Length, false, out _, out var charCount, out _);
                if (charCount > 0) PublishOutput(new string(chars, 0, charCount));
            }
        }
        catch (OperationCanceledException) { }
        catch (ObjectDisposedException) { }
        catch (IOException) when (_cts.IsCancellationRequested) { }
        catch (Exception ex) { App.Log("Terminal output failed: " + ex.Message); }
    }

    private void PublishOutput(string text)
    {
        EventHandler<string>? handler;
        lock (_outputGate)
        {
            handler = _outputReceived;
            if (handler is null)
            {
                _pendingOutput.Append(text);
                if (_pendingOutput.Length > MaxPendingOutputChars)
                    _pendingOutput.Remove(0, _pendingOutput.Length - MaxPendingOutputChars);
                return;
            }
        }
        handler(this, text);
    }

    private void WaitLoop()
    {
        if (_processHandle == IntPtr.Zero) return;
        WaitForSingleObject(_processHandle, 0xFFFFFFFF);
        GetExitCodeProcess(_processHandle, out var code);
        Exited?.Invoke(this, unchecked((int)code));
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _cts.Cancel();
        try { if (_processHandle != IntPtr.Zero) TerminateProcess(_processHandle, 0); } catch { }
        try { _inputStream?.Dispose(); } catch { }
        try { _outputStream?.Dispose(); } catch { }
        _inputStream = null;
        _outputStream = null;
        if (_threadHandle != IntPtr.Zero)
        {
            CloseHandle(_threadHandle);
            _threadHandle = IntPtr.Zero;
        }
        if (_processHandle != IntPtr.Zero)
        {
            CloseHandle(_processHandle);
            _processHandle = IntPtr.Zero;
        }
        if (_pseudoConsole != IntPtr.Zero)
        {
            var handle = _pseudoConsole;
            _pseudoConsole = IntPtr.Zero;
            _ = Task.Run(() =>
            {
                try { ClosePseudoConsole(handle); } catch { }
            });
        }
        _cts.Dispose();
    }

    public async ValueTask DisposeAsync()
    {
        Dispose();
        var tasks = new[] { _readTask, _waitTask }.Where(task => task is not null).Cast<Task>().ToArray();
        if (tasks.Length > 0)
        {
            try { await Task.WhenAny(Task.WhenAll(tasks), Task.Delay(800)); } catch { }
        }
    }

    private static string Quote(string value) => "\"" + value.Replace("\"", "\\\"", StringComparison.Ordinal) + "\"";

    [StructLayout(LayoutKind.Sequential)]
    private struct COORD
    {
        public short X;
        public short Y;
        public COORD(short x, short y) { X = x; Y = y; }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string? lpReserved;
        public string? lpDesktop;
        public string? lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CreatePipe(out IntPtr hReadPipe, out IntPtr hWritePipe, ref SECURITY_ATTRIBUTES lpPipeAttributes, uint nSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetHandleInformation(IntPtr hObject, uint dwMask, uint dwFlags);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern int CreatePseudoConsole(COORD size, IntPtr hInput, IntPtr hOutput, uint dwFlags, out IntPtr phPC);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern int ResizePseudoConsole(IntPtr hPC, COORD size);

    [DllImport("kernel32.dll")]
    private static extern void ClosePseudoConsole(IntPtr hPC);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr lpAttributeList, int dwAttributeCount, int dwFlags, ref IntPtr lpSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(IntPtr lpAttributeList, uint dwFlags, IntPtr attribute, IntPtr lpValue, IntPtr cbSize, IntPtr lpPreviousValue, IntPtr lpReturnSize);

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr lpAttributeList);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessW(
        string? lpApplicationName,
        StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string? lpCurrentDirectory,
        ref STARTUPINFOEX lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll")]
    private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);
}
