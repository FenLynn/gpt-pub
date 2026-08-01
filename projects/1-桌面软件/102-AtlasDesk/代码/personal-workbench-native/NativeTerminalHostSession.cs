using System.Diagnostics;
using System.IO.Pipes;
using System.Text;
using System.Threading.Channels;

namespace PersonalWorkbench;

/// <summary>
/// Hosts CMD through a small native GUI bridge. Data and resize traffic use
/// explicit named pipes, avoiding ambiguous GUI standard handles while the
/// actual shell remains attached to the Windows system pseudoconsole.
/// </summary>
internal sealed class NativeTerminalHostSession : ITerminalSession
{
    private const int MaxPendingOutputChars = 262_144;
    private readonly object _eventGate = new();
    private readonly StringBuilder _pendingOutput = new();
    private readonly CancellationTokenSource _cts = new();
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private readonly SemaphoreSlim _controlGate = new(1, 1);
    private readonly Channel<string> _outputChannel = Channel.CreateUnbounded<string>(
        new UnboundedChannelOptions { SingleReader = true, SingleWriter = true });
    private readonly Process _process;
    private readonly NamedPipeServerStream _inputPipe;
    private readonly NamedPipeServerStream _outputPipe;
    private readonly NamedPipeServerStream _controlPipe;
    private readonly Task _outputTask;
    private readonly Task _dispatchTask;
    private readonly Task _errorTask;
    private readonly Task _waitTask;
    private EventHandler<string>? _outputReceived;
    private EventHandler<int>? _exited;
    private int? _exitCode;
    private int _exitRaised;
    private bool _disposed;

    private NativeTerminalHostSession(
        Process process,
        NamedPipeServerStream inputPipe,
        NamedPipeServerStream outputPipe,
        NamedPipeServerStream controlPipe,
        Task outputConnection)
    {
        _process = process;
        _inputPipe = inputPipe;
        _outputPipe = outputPipe;
        _controlPipe = controlPipe;
        ProcessId = process.Id;

        _dispatchTask = Task.Run(DispatchOutputAsync);
        _outputTask = Task.Factory.StartNew(
            () => ReadOutputLoop(outputConnection),
            CancellationToken.None,
            TaskCreationOptions.LongRunning,
            TaskScheduler.Default);
        _errorTask = Task.Run(ReadErrorAsync);
        _waitTask = Task.Run(WaitForExitAsync);
    }

    public static NativeTerminalHostSession Start(TerminalLaunchSpec spec, int columns, int rows)
    {
        var hostPath = ResolveHostPath();
        if (!File.Exists(hostPath))
            throw new FileNotFoundException("缺少内置终端宿主。", hostPath);

        var suffix = Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture)
            + "-" + Guid.NewGuid().ToString("N");
        var inputName = "AtlasDesk-Terminal-" + suffix + "-in";
        var outputName = "AtlasDesk-Terminal-" + suffix + "-out";
        var controlName = "AtlasDesk-Terminal-" + suffix + "-control";

        var inputPipe = new NamedPipeServerStream(
            inputName,
            PipeDirection.Out,
            1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous,
            65_536,
            65_536);
        var outputPipe = new NamedPipeServerStream(
            outputName,
            PipeDirection.In,
            1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous,
            65_536,
            65_536);
        var controlPipe = new NamedPipeServerStream(
            controlName,
            PipeDirection.Out,
            1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous,
            4_096,
            4_096);

        var startInfo = new ProcessStartInfo
        {
            FileName = hostPath,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardError = true,
            WorkingDirectory = Directory.Exists(spec.WorkingDirectory)
                ? spec.WorkingDirectory
                : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
        };
        startInfo.Environment["PWB_TERMINAL_APP"] = spec.Executable;
        startInfo.Environment["PWB_TERMINAL_ARGS"] = spec.Arguments;
        startInfo.Environment["PWB_TERMINAL_CWD"] = startInfo.WorkingDirectory;
        startInfo.Environment["PWB_TERMINAL_COLS"] = Math.Clamp(columns, 20, 500).ToString(System.Globalization.CultureInfo.InvariantCulture);
        startInfo.Environment["PWB_TERMINAL_ROWS"] = Math.Clamp(rows, 5, 300).ToString(System.Globalization.CultureInfo.InvariantCulture);
        startInfo.Environment["PWB_TERMINAL_INPUT_PIPE"] = inputName;
        startInfo.Environment["PWB_TERMINAL_OUTPUT_PIPE"] = outputName;
        startInfo.Environment["PWB_TERMINAL_CONTROL_PIPE"] = controlName;

        var process = new Process { StartInfo = startInfo, EnableRaisingEvents = false };
        NativeTerminalHostSession? session = null;
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(6));
            var inputConnection = inputPipe.WaitForConnectionAsync(timeout.Token);
            var outputConnection = outputPipe.WaitForConnectionAsync(timeout.Token);
            var controlConnection = controlPipe.WaitForConnectionAsync(timeout.Token);

            if (!process.Start()) throw new InvalidOperationException("终端宿主未能启动。");
            session = new NativeTerminalHostSession(
                process,
                inputPipe,
                outputPipe,
                controlPipe,
                outputConnection);

            Task.WhenAll(inputConnection, outputConnection, controlConnection).GetAwaiter().GetResult();
            return session;
        }
        catch
        {
            if (session is not null)
            {
                try { session.DisposeAsync().AsTask().GetAwaiter().GetResult(); } catch { }
            }
            else
            {
                try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch { }
                process.Dispose();
                inputPipe.Dispose();
                outputPipe.Dispose();
                controlPipe.Dispose();
            }
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

    public int ProcessId { get; }

    public async Task WriteAsync(string text)
    {
        if (_disposed || string.IsNullOrEmpty(text)) return;
        try
        {
            await _writeGate.WaitAsync(_cts.Token);
            try
            {
                if (_disposed || !_inputPipe.IsConnected) return;
                var bytes = Encoding.UTF8.GetBytes(text);
                await _inputPipe.WriteAsync(bytes, _cts.Token);
            }
            finally
            {
                _writeGate.Release();
            }
        }
        catch (OperationCanceledException) { }
        catch (ObjectDisposedException) { }
        catch (IOException) when (_disposed || !_inputPipe.IsConnected) { }
        catch (Exception ex) { App.Log("Native terminal host input failed: " + ex.Message); }
    }

    public void Resize(int columns, int rows)
    {
        if (_disposed || !_controlPipe.IsConnected) return;
        _ = SendResizeAsync(Math.Clamp(columns, 20, 500), Math.Clamp(rows, 5, 300));
    }

    private async Task SendResizeAsync(int columns, int rows)
    {
        try
        {
            await _controlGate.WaitAsync(_cts.Token);
            try
            {
                if (_disposed || !_controlPipe.IsConnected) return;
                var command = Encoding.ASCII.GetBytes($"RESIZE {columns} {rows}\n");
                await _controlPipe.WriteAsync(command, _cts.Token);
            }
            finally
            {
                _controlGate.Release();
            }
        }
        catch (OperationCanceledException) { }
        catch (ObjectDisposedException) { }
        catch (IOException) when (_disposed || !_controlPipe.IsConnected) { }
        catch (Exception ex) { App.Log("Native terminal host resize failed: " + ex.Message); }
    }

    private void ReadOutputLoop(Task outputConnection)
    {
        var bytes = new byte[16_384];
        var chars = new char[16_384];
        var decoder = Encoding.UTF8.GetDecoder();
        try
        {
            outputConnection.GetAwaiter().GetResult();
            while (!_cts.IsCancellationRequested && _outputPipe.IsConnected)
            {
                var count = _outputPipe.Read(bytes, 0, bytes.Length);
                if (count <= 0) break;
                decoder.Convert(bytes, 0, count, chars, 0, chars.Length, false, out _, out var charCount, out _);
                if (charCount > 0)
                    _outputChannel.Writer.TryWrite(new string(chars, 0, charCount));
            }
        }
        catch (OperationCanceledException) { }
        catch (ObjectDisposedException) { }
        catch (IOException) when (_disposed || _cts.IsCancellationRequested) { }
        catch (Exception ex) { App.Log("Native terminal host output failed: " + ex.Message); }
        finally
        {
            _outputChannel.Writer.TryComplete();
        }
    }

    private async Task DispatchOutputAsync()
    {
        try
        {
            await foreach (var text in _outputChannel.Reader.ReadAllAsync(_cts.Token))
                PublishOutput(text);
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { App.Log("Native terminal output dispatch failed: " + ex.Message); }
    }

    private async Task ReadErrorAsync()
    {
        try
        {
            var error = await _process.StandardError.ReadToEndAsync(_cts.Token);
            if (!string.IsNullOrWhiteSpace(error))
            {
                App.Log("Native terminal host: " + error.Trim());
                _outputChannel.Writer.TryWrite("\r\n[terminal-host] " + error);
            }
        }
        catch (OperationCanceledException) { }
        catch (ObjectDisposedException) { }
        catch (Exception ex) { App.Log("Native terminal host diagnostics failed: " + ex.Message); }
    }

    private async Task WaitForExitAsync()
    {
        var code = 0;
        try
        {
            await _process.WaitForExitAsync(_cts.Token);
            code = _process.ExitCode;
        }
        catch (OperationCanceledException) { return; }
        catch (Exception ex) { App.Log("Native terminal host wait failed: " + ex.Message); code = -1; }
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
        if (_disposed) return;
        _disposed = true;
        try { _inputPipe.Dispose(); } catch { }
        try { _controlPipe.Dispose(); } catch { }
        try
        {
            if (!_process.HasExited)
            {
                if (!await Task.Run(() => _process.WaitForExit(900)))
                    _process.Kill(entireProcessTree: true);
            }
        }
        catch { }
        _cts.Cancel();
        try { _outputPipe.Dispose(); } catch { }
        try { await Task.WhenAny(Task.WhenAll(_outputTask, _dispatchTask, _errorTask, _waitTask), Task.Delay(1200)); } catch { }
        _writeGate.Dispose();
        _controlGate.Dispose();
        _cts.Dispose();
        _process.Dispose();
    }

    private static string ResolveHostPath()
    {
        var configured = Environment.GetEnvironmentVariable("PWB_TERMINAL_HOST_PATH");
        if (!string.IsNullOrWhiteSpace(configured)) return Path.GetFullPath(configured);
        return Path.Combine(App.RuntimeDirectory, "AtlasDesk.TerminalHost.exe");
    }
}
