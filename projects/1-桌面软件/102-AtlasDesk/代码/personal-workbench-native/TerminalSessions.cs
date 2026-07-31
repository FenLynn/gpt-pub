namespace PersonalWorkbench;

public interface ITerminalSession : IAsyncDisposable
{
    event EventHandler<string>? OutputReceived;
    event EventHandler<int>? Exited;
    int ProcessId { get; }
    Task WriteAsync(string text);
    void Resize(int columns, int rows);
}

public static class TerminalSessionFactory
{
    public static ITerminalSession Start(TerminalLaunchSpec spec, int columns, int rows)
    {
        if (TerminalReliability.IsSupervisedCmd(spec))
            return NativeTerminalHostSession.Start(spec, columns, rows);
        return new ConPtyTerminalSession(ConPtySession.Start(spec, columns, rows));
    }
}

internal sealed class ConPtyTerminalSession : ITerminalSession
{
    private readonly ConPtySession _inner;

    public ConPtyTerminalSession(ConPtySession inner) => _inner = inner;

    public event EventHandler<string>? OutputReceived
    {
        add => _inner.OutputReceived += value;
        remove => _inner.OutputReceived -= value;
    }

    public event EventHandler<int>? Exited
    {
        add => _inner.Exited += value;
        remove => _inner.Exited -= value;
    }

    public int ProcessId => _inner.ProcessId;
    public Task WriteAsync(string text) => _inner.WriteAsync(text);
    public void Resize(int columns, int rows) => _inner.Resize(columns, rows);
    public ValueTask DisposeAsync() => _inner.DisposeAsync();
}
