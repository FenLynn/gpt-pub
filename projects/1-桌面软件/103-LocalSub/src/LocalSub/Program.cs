using LocalSub.Core;
using LocalSub.UI;

namespace LocalSub;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        PortablePaths.EnsureBaseFolders();
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => MessageBox.Show(e.Exception.ToString(), "LocalSub error");
        Application.Run(new MainForm());
    }
}
