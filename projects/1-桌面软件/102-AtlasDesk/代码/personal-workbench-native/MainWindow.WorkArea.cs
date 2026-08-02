namespace PersonalWorkbench;

public partial class MainWindow
{
    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        WindowWorkAreaGuard.Attach(this);
    }
}
