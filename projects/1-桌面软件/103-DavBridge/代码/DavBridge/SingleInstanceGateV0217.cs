namespace DavBridge;

internal sealed class SingleInstanceGateV0217 : IDisposable
{
    private const string MutexName = @"Local\DavBridge.SingleInstance.v1";
    private const string ShowEventName = @"Local\DavBridge.ShowExisting.v1";

    private readonly Mutex? _mutex;
    private readonly EventWaitHandle? _showEvent;
    private RegisteredWaitHandle? _registeredWait;
    private MainForm? _form;
    private bool _ownsMutex;
    private bool _disposed;

    private SingleInstanceGateV0217(Mutex? mutex, EventWaitHandle? showEvent, bool ownsMutex, bool isPrimary)
    {
        _mutex = mutex;
        _showEvent = showEvent;
        _ownsMutex = ownsMutex;
        IsPrimary = isPrimary;
    }

    public bool IsPrimary { get; }

    public static SingleInstanceGateV0217 Acquire()
    {
        EventWaitHandle? showEvent = null;
        Mutex? mutex = null;
        try
        {
            showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
            mutex = new Mutex(false, MutexName, out var createdNew);
            if (!createdNew)
            {
                showEvent.Set();
                mutex.Dispose();
                showEvent.Dispose();
                return new SingleInstanceGateV0217(null, null, false, false);
            }

            var owns = mutex.WaitOne(0);
            if (!owns)
            {
                showEvent.Set();
                mutex.Dispose();
                showEvent.Dispose();
                return new SingleInstanceGateV0217(null, null, false, false);
            }

            return new SingleInstanceGateV0217(mutex, showEvent, true, true);
        }
        catch
        {
            mutex?.Dispose();
            showEvent?.Dispose();
            return new SingleInstanceGateV0217(null, null, false, true);
        }
    }

    public void Attach(MainForm form)
    {
        if (!IsPrimary || _showEvent is null || _disposed) return;
        _form = form;
        _registeredWait = ThreadPool.RegisterWaitForSingleObject(
            _showEvent,
            static (state, _) => ((SingleInstanceGateV0217)state!).ShowExisting(),
            this,
            Timeout.Infinite,
            executeOnlyOnce: false);
    }

    private void ShowExisting()
    {
        var form = _form;
        if (form is null || form.IsDisposed) return;
        try
        {
            form.BeginInvoke(new Action(() =>
            {
                if (form.IsDisposed) return;
                if (form.Tag is IHomeWindowControllerV037 controller)
                {
                    controller.ShowHomeAndRestore();
                    return;
                }

                if (form.WindowState == FormWindowState.Minimized)
                    form.WindowState = FormWindowState.Normal;
                if (!form.Visible) form.Show();
                form.ShowInTaskbar = true;
                form.BringToFront();
                form.Activate();
            }));
        }
        catch { }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _registeredWait?.Unregister(null);
        _registeredWait = null;
        if (_ownsMutex && _mutex is not null)
        {
            try { _mutex.ReleaseMutex(); } catch { }
            _ownsMutex = false;
        }
        _mutex?.Dispose();
        _showEvent?.Dispose();
    }
}
