using System.ComponentModel;
using System.Windows;
using System.Windows.Input;

namespace PersonalWorkbench;

public partial class TemporaryLockWindow : Window
{
    private bool _unlocked;

    public TemporaryLockWindow()
    {
        InitializeComponent();
        Loaded += (_, _) => PinBox.Focus();
        Closing += OnClosing;
    }

    private void Unlock_Click(object sender, RoutedEventArgs e) => TryUnlock();

    private void PinBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        TryUnlock();
        e.Handled = true;
    }

    private void TryUnlock()
    {
        if (!SecurityService.VerifyPin(PinBox.Password))
        {
            StatusText.Text = "四位密码不正确。";
            PinBox.SelectAll();
            PinBox.Focus();
            return;
        }
        _unlocked = true;
        DialogResult = true;
        Close();
    }

    private void OnClosing(object? sender, CancelEventArgs e)
    {
        if (!_unlocked) e.Cancel = true;
    }
}
