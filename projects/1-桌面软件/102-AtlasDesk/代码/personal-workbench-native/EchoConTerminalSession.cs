using System.Collections;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace PersonalWorkbench;

/// <summary>
/// Minimal Windows pseudoconsole host. The process startup layout, standard-
/// handle flags and channel lifetime mirror Microsoft's vs-pty.net ConPTY path.
/// </summary>
internal sealed class EchoConTerminalSession : ITerminalSession
{
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    private const int STARTF_USESTDHANDLES = 0x00000100;
    private const uint WAIT_TIMEOUT = 0x00000102;
    private const int ERROR_BROKEN_PIPE = 109;
    private const int MaxPendingOutputChars = 262_144;
    private static readonly IntPtr PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = new(22 | 0x20000);

    private readonly object _eventGate = new();
    private readonly StringBuilder _pendingOutput = new();
    private readonly CancellationTokenSource _cts = new();
    private readonly SemaphoreSlim _writeGate = new(1, 1);

    private IntPtr _pseudoInput;
    private IntPtr _inputWrite;
    private IntPtr _outputRead;
    private IntPtr _pseudoOutput;
    private IntPtr _pseudoConsole;
    private IntPtr _processHandle;
    private IntPtr _threadHandle;
    private Task? _readTask;
    private Task? _waitTask;
    private EventHandler<string>? _outputReceived;
    private EventHandler<int>? _exited;
    private int? _exitCode;
    private int _exitRaised;
    private bool _disposed;

    private EchoConTerminalSession() { }

    public static EchoConTerminalSession Start(TerminalLaunchSpec spec, int columns, int rows)
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 17763))
            throw new PlatformNotSupportedException("内置终端需要 Windows 10 1809 或更高版本。");
        if (!File.Exists(spec.Executable))
            throw new FileNotFoundException("未找到系统 CMD。", spec.Executable);

        var session = new EchoConTerminalSession();
        try
        {
            session.Initialize(spec, columns, rows);
            return session;
        }
        catch
        {
            session.DisposeCore();
            throw;
        }
    }

    public event EventHandler<string>? OutputReceived
    {
        add
        {
            if (value is null) return;
            string pending = string.Empty;
            lock (_eventGate)
            {
                _outputReceived += value;
                if (_pendingOutput.Length > 0)
                {
                    pending = _pendingOutput.ToString();
                    _pendingOutput.Clear();
                }
            }
            if (pending.Length > 0) value(this, pending);
        }
        remove
        {
            lock (_eventGate) _outputReceived -= value;
        }
    }

    public event EventHandler<int>? Exited
    {
        add
        {
            if (value is null) return;
            int? completed;
            lock (_eventGate)
            {
                _exited += value;
                completed = _exitCode;
            }
            if (completed.HasValue) value(this, completed.Value);
        }
        remove
        {
            lock (_eventGate) _exited -= value;
        }
    }

    public int ProcessId { get; private set; }

    private void Initialize(TerminalLaunchSpec spec, int columns, int rows)
    {
        IntPtr pseudoInput = IntPtr.Zero;
        IntPtr hostInput = IntPtr.Zero;
        IntPtr hostOutput = IntPtr.Zero;
        IntPtr pseudoOutput = IntPtr.Zero;
        IntPtr attributeList = IntPtr.Zero;
        IntPtr environmentBlock = IntPtr.Zero;
        var attributeInitialized = false;

        try
        {
            if (!CreatePipe(out pseudoInput, out hostInput, IntPtr.Zero, 0))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "无法创建终端输入管道。");
            if (!CreatePipe(out hostOutput, out pseudoOutput, IntPtr.Zero, 0))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "无法创建终端输出管道。");

            var result = CreatePseudoConsole(
                new COORD(Math.Clamp(columns, 20, 500), Math.Clamp(rows, 5, 300)),
                pseudoInput,
                pseudoOutput,
                0,
                out _pseudoConsole);
            if (result != 0)
                Marshal.ThrowExceptionForHR(result);

            var startup = default(STARTUPINFOEX);
            startup.StartupInfo.cb = Marshal.SizeOf<STARTUPINFOEX>();
            startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;

            var attributeSize = IntPtr.Zero;
            var firstInitialization = InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeSize);
            if (firstInitialization || attributeSize == IntPtr.Zero)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "无法计算终端进程属性大小。");

            attributeList = Marshal.AllocHGlobal(attributeSize);
            if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeSize))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "无法初始化终端进程属性。");
            attributeInitialized = true;
            startup.lpAttributeList = attributeList;

            if (!UpdateProcThreadAttribute(
                    attributeList,
                    0,
                    PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
                    _pseudoConsole,
                    (IntPtr)Marshal.SizeOf<IntPtr>(),
                    IntPtr.Zero,
                    IntPtr.Zero))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "无法附加 Windows 伪控制台。");

            var commandLine = new StringBuilder(Quote(spec.Executable));
            if (!string.IsNullOrWhiteSpace(spec.Arguments)) commandLine.Append(' ').Append(spec.Arguments);
            environmentBlock = Marshal.StringToHGlobalUni(BuildEnvironmentBlock());

            if (!CreateProcessW(
                    null,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    false,
                    EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
                    environmentBlock,
                    Directory.Exists(spec.WorkingDirectory) ? spec.WorkingDirectory : Environment.CurrentDirectory,
                    ref startup,
                    out var processInfo))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "无法在伪控制台中启动 CMD。");

            _processHandle = processInfo.hProcess;
            _threadHandle = processInfo.hThread;
            ProcessId = processInfo.dwProcessId;

            // Retain all four channel handles for the full connection lifetime,
            // matching Microsoft's PseudoConsoleConnection implementation.
            _pseudoInput = pseudoInput;
            pseudoInput = IntPtr.Zero;
            _inputWrite = hostInput;
            hostInput = IntPtr.Zero;
            _outputRead = hostOutput;
            hostOutput = IntPtr.Zero;
            _pseudoOutput = pseudoOutput;
            pseudoOutput = IntPtr.Zero;

            _readTask = Task.Factory.StartNew(ReadLoop, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
            _waitTask = Task.Factory.StartNew(WaitLoop, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
        }
        finally
        {
            if (attributeInitialized && attributeList != IntPtr.Zero)
                DeleteProcThreadAttributeList(attributeList);
            if (attributeList != IntPtr.Zero) Marshal.FreeHGlobal(attributeList);
            if (environmentBlock != IntPtr.Zero) Marshal.FreeHGlobal(environmentBlock);
            if (pseudoInput != IntPtr.Zero) CloseHandle(pseudoInput);
            if (hostInput != IntPtr.Zero) CloseHandle(hostInput);
            if (hostOutput != IntPtr.Zero) CloseHandle(hostOutput);
            if (pseudoOutput != IntPtr.Zero) CloseHandle(pseudoOutput);
        }
    }

    public async Task WriteAsync(string text)
    {
        if (_disposed || _inputWrite == IntPtr.Zero || string.IsNullOrEmpty(text)) return;
        try
        {
            await _writeGate.WaitAsync(_cts.Token);
            try
            {
                if (_disposed || _inputWrite == IntPtr.Zero) return;
                var bytes = Encoding.UTF8.GetBytes(text);
                await Task.Run(() =>
                {
                    var offset = 0;
                    while (offset < bytes.Length)
                    {
                        var remaining = bytes.Length - offset;
                        var chunk = offset == 0 ? bytes : bytes[offset..];
                        if (!WriteFile(_inputWrite, chunk, remaining, out var written, IntPtr.Zero))
                            throw new Win32Exception(Marshal.GetLastWin32Error(), "终端输入管道写入失败。");
                        if (written == 0) throw new IOException("终端输入管道未接受数据。");
                        offset += checked((int)written);
                    }
                }, _cts.Token);
            }
            finally
            {
                _writeGate.Release();
            }
        }
        catch (OperationCanceledException) { }
        catch (ObjectDisposedException) { }
        catch (IOException) when (_disposed) { }
        catch (Exception ex) { App.Log("EchoCon input failed: " + ex.Message); }
    }

    public void Resize(int columns, int rows)
    {
        if (_disposed || _pseudoConsole == IntPtr.Zero) return;
        try
        {
            var result = ResizePseudoConsole(
                _pseudoConsole,
                new COORD(Math.Clamp(columns, 20, 500), Math.Clamp(rows, 5, 300)));
            if (result != 0) App.Log("EchoCon resize failed: HRESULT 0x" + result.ToString("X8"));
        }
        catch (Exception ex) { App.Log("EchoCon resize failed: " + ex.Message); }
    }

    private void ReadLoop()
    {
        var bytes = new byte[16_384];
        var chars = new char[16_384];
        var decoder = Encoding.UTF8.GetDecoder();
        try
        {
            while (!_cts.IsCancellationRequested && _outputRead != IntPtr.Zero)
            {
                var success = ReadFile(_outputRead, bytes, bytes.Length, out var read, IntPtr.Zero);
                if (!success)
                {
                    var error = Marshal.GetLastWin32Error();
                    if (error == ERROR_BROKEN_PIPE || _disposed || _cts.IsCancellationRequested) break;
                    throw new Win32Exception(error, "终端输出管道读取失败。");
                }
                if (read == 0) break;
                decoder.Convert(bytes, 0, checked((int)read), chars, 0, chars.Length, false, out _, out var charCount, out _);
                if (charCount > 0) PublishOutput(new string(chars, 0, charCount));
            }
        }
        catch (Exception ex) when (_disposed || _cts.IsCancellationRequested) { App.Log("EchoCon output stopped: " + ex.Message); }
        catch (Exception ex) { App.Log("EchoCon output failed: " + ex.Message); }
    }

    private void WaitLoop()
    {
        if (_processHandle == IntPtr.Zero) return;
        WaitForSingleObject(_processHandle, 0xFFFFFFFF);
        var code = 0;
        if (GetExitCodeProcess(_processHandle, out var rawCode)) code = unchecked((int)rawCode);
        RaiseExited(code);
    }

    private void PublishOutput(string text)
    {
        EventHandler<string>? handler;
        lock (_eventGate)
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

    private void RaiseExited(int code)
    {
        if (Interlocked.Exchange(ref _exitRaised, 1) != 0) return;
        EventHandler<int>? handler;
        lock (_eventGate)
        {
            _exitCode = code;
            handler = _exited;
        }
        handler?.Invoke(this, code);
    }

    public async ValueTask DisposeAsync()
    {
        DisposeCore();
        var tasks = new[] { _readTask, _waitTask }.Where(task => task is not null).Cast<Task>().ToArray();
        if (tasks.Length > 0)
        {
            try { await Task.WhenAny(Task.WhenAll(tasks), Task.Delay(1200)); } catch { }
        }
    }

    private void DisposeCore()
    {
        if (_disposed) return;
        _disposed = true;
        _cts.Cancel();

        try
        {
            if (_processHandle != IntPtr.Zero && WaitForSingleObject(_processHandle, 0) == WAIT_TIMEOUT)
                TerminateProcess(_processHandle, 0);
        }
        catch { }

        CloseStoredHandle(ref _inputWrite);
        if (_pseudoConsole != IntPtr.Zero)
        {
            try { ClosePseudoConsole(_pseudoConsole); } catch { }
            _pseudoConsole = IntPtr.Zero;
        }
        CloseStoredHandle(ref _outputRead);
        CloseStoredHandle(ref _pseudoInput);
        CloseStoredHandle(ref _pseudoOutput);
        CloseStoredHandle(ref _threadHandle);
        CloseStoredHandle(ref _processHandle);

        _writeGate.Dispose();
        _cts.Dispose();
    }

    private static void CloseStoredHandle(ref IntPtr handle)
    {
        var value = Interlocked.Exchange(ref handle, IntPtr.Zero);
        if (value != IntPtr.Zero) CloseHandle(value);
    }

    private static string BuildEnvironmentBlock()
    {
        var entries = new List<KeyValuePair<string, string>>();
        foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            var key = entry.Key?.ToString();
            if (string.IsNullOrEmpty(key)) continue;
            entries.Add(new KeyValuePair<string, string>(key, entry.Value?.ToString() ?? string.Empty));
        }
        entries.Sort((left, right) => StringComparer.OrdinalIgnoreCase.Compare(left.Key, right.Key));
        var result = new StringBuilder();
        foreach (var entry in entries)
            result.Append(entry.Key).Append('=').Append(entry.Value).Append('\0');
        result.Append('\0');
        return result.ToString();
    }

    private static string Quote(string value) => "\"" + value.Replace("\"", "\\\"", StringComparison.Ordinal) + "\"";

    [StructLayout(LayoutKind.Sequential)]
    private readonly struct COORD
    {
        public readonly ushort X;
        public readonly ushort Y;
        public COORD(int x, int y) { X = checked((ushort)x); Y = checked((ushort)y); }
    }

    [StructLayout(LayoutKind.Sequential, Pack = 8, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public IntPtr lpReserved;
        public IntPtr lpDesktop;
        public IntPtr lpTitle;
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

    [StructLayout(LayoutKind.Sequential, Pack = 8, CharSet = CharSet.Unicode)]
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
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreatePipe(out IntPtr hReadPipe, out IntPtr hWritePipe, IntPtr lpPipeAttributes, int nSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ReadFile(IntPtr hFile, byte[] buffer, int bytesToRead, out uint bytesRead, IntPtr overlapped);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WriteFile(IntPtr hFile, byte[] buffer, int bytesToWrite, out uint bytesWritten, IntPtr overlapped);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll")]
    private static extern int CreatePseudoConsole(COORD size, IntPtr hInput, IntPtr hOutput, uint dwFlags, out IntPtr phPC);

    [DllImport("kernel32.dll")]
    private static extern int ResizePseudoConsole(IntPtr hPC, COORD size);

    [DllImport("kernel32.dll")]
    private static extern void ClosePseudoConsole(IntPtr hPC);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr lpAttributeList, int dwAttributeCount, int dwFlags, ref IntPtr lpSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UpdateProcThreadAttribute(IntPtr lpAttributeList, uint dwFlags, IntPtr attribute, IntPtr lpValue, IntPtr cbSize, IntPtr lpPreviousValue, IntPtr lpReturnSize);

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr lpAttributeList);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcessW(
        string? lpApplicationName,
        StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFOEX lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll")]
    private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);
}
