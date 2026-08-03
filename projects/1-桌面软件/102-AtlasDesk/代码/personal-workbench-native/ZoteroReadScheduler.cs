namespace PersonalWorkbench;

public static class ZoteroReadScheduler
{
    public static Task<T> RunAsync<T>(
        Func<Task<T>> readOperation,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(readOperation);

        // Microsoft.Data.Sqlite exposes async-shaped APIs, but SQLite performs the
        // actual database work synchronously. Always enter the read on a pool thread
        // so a large live Zotero database cannot block the WPF Dispatcher.
        return Task.Run(async () =>
        {
            cancellationToken.ThrowIfCancellationRequested();
            return await readOperation().ConfigureAwait(false);
        }, cancellationToken);
    }
}
