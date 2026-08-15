namespace LocalSub.UI;

public class Form : System.Windows.Forms.Form
{
    public IAsyncResult BeginInvoke(Action action) => base.BeginInvoke(action);
}
