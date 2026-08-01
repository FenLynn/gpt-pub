using QRCoder;
using System.IO;
using System.Windows;
using System.Windows.Media.Imaging;

namespace PersonalWorkbench;

public partial class SecurityCenterWindow : Window
{
    private SecuritySetupDraft? _setupDraft;

    public SecurityCenterWindow()
    {
        InitializeComponent();
        Closed += (_, _) => DisposeDraft();
        RefreshState();
    }

    private void RefreshState()
    {
        var configured = SecurityService.IsConfigured;
        SetupPanel.Visibility = configured ? Visibility.Collapsed : Visibility.Visible;
        VaultPanel.Visibility = configured ? Visibility.Visible : Visibility.Collapsed;
        VaultLockedPanel.Visibility = configured && !SecurityService.IsUnlocked ? Visibility.Visible : Visibility.Collapsed;
        VaultUnlockedPanel.Visibility = configured && SecurityService.IsUnlocked ? Visibility.Visible : Visibility.Collapsed;
        OverallStatusText.Text = SecurityService.GetStatusSummary();
        PinStatusText.Text = SecurityService.IsPinEnabled ? "当前：已启用，仅手动锁定时生效" : "当前：未启用";
        if (!configured)
        {
            VaultStatusText.Text = string.Empty;
            UnlockPasswordBox.Clear();
            UnlockTotpBox.Clear();
        }
    }

    private async void GenerateQr_Click(object sender, RoutedEventArgs e)
    {
        SetupStatusText.Text = string.Empty;
        DisposeDraft();
        if (!string.Equals(SetupPasswordBox.Password, SetupConfirmBox.Password, StringComparison.Ordinal))
        {
            SetupStatusText.Text = "两次输入的主密码不一致。";
            return;
        }
        try
        {
            IsEnabled = false;
            _setupDraft = await SecurityService.CreateSetupDraftAsync(SetupPasswordBox.Password);
            TotpSecretBox.Text = _setupDraft.TotpSecretText;
            TotpQrImage.Source = CreateQrImage(_setupDraft.OtpAuthUri);
            QrPanel.Visibility = Visibility.Visible;
            SetupStatusText.Text = "二维码仅在当前窗口内生成，不会写入 Runtime。扫码后请输入 6 位验证码确认。";
            SetupStatusText.Foreground = System.Windows.Media.Brushes.SteelBlue;
            SetupTotpCodeBox.Focus();
        }
        catch (Exception ex)
        {
            SetupStatusText.Foreground = System.Windows.Media.Brushes.Firebrick;
            SetupStatusText.Text = ex.Message;
        }
        finally
        {
            IsEnabled = true;
        }
    }

    private void CompleteSetup_Click(object sender, RoutedEventArgs e)
    {
        if (_setupDraft is null)
        {
            SetupStatusText.Text = "请先生成二维码。";
            return;
        }
        var result = SecurityService.CompleteSetup(_setupDraft, SetupTotpCodeBox.Text);
        SetupStatusText.Foreground = result.Success ? System.Windows.Media.Brushes.SeaGreen : System.Windows.Media.Brushes.Firebrick;
        SetupStatusText.Text = result.Message;
        if (!result.Success) return;
        DisposeDraft();
        SetupPasswordBox.Clear();
        SetupConfirmBox.Clear();
        SetupTotpCodeBox.Clear();
        RefreshState();
    }

    private async void Unlock_Click(object sender, RoutedEventArgs e)
    {
        VaultStatusText.Text = "正在验证…";
        IsEnabled = false;
        try
        {
            var result = await SecurityService.UnlockVaultAsync(UnlockPasswordBox.Password, UnlockTotpBox.Text);
            VaultStatusText.Foreground = result.Success ? System.Windows.Media.Brushes.SeaGreen : System.Windows.Media.Brushes.Firebrick;
            VaultStatusText.Text = result.Message;
            if (result.Success)
            {
                UnlockPasswordBox.Clear();
                UnlockTotpBox.Clear();
                RefreshState();
            }
        }
        finally
        {
            IsEnabled = true;
        }
    }

    private void OpenVault_Click(object sender, RoutedEventArgs e)
    {
        if (!SecurityService.IsUnlocked)
        {
            VaultStatusText.Text = "请先解锁保险库。";
            RefreshState();
            return;
        }
        new VaultWindow { Owner = this }.ShowDialog();
    }

    private void LockVault_Click(object sender, RoutedEventArgs e)
    {
        SecurityService.LockVault();
        VaultStatusText.Text = "保险库已锁定。";
        RefreshState();
    }

    private void SetPin_Click(object sender, RoutedEventArgs e)
    {
        var result = SecurityService.SetPin(NewPinBox.Password, ConfirmPinBox.Password);
        PinOperationStatusText.Foreground = result.Success ? System.Windows.Media.Brushes.SeaGreen : System.Windows.Media.Brushes.Firebrick;
        PinOperationStatusText.Text = result.Message;
        if (result.Success)
        {
            NewPinBox.Clear();
            ConfirmPinBox.Clear();
            RefreshState();
        }
    }

    private void DisablePin_Click(object sender, RoutedEventArgs e)
    {
        if (!SecurityService.IsPinEnabled)
        {
            PinOperationStatusText.Text = "四位临时锁当前没有启用。";
            return;
        }
        var result = SecurityService.DisablePin(CurrentPinBox.Password);
        PinOperationStatusText.Foreground = result.Success ? System.Windows.Media.Brushes.SeaGreen : System.Windows.Media.Brushes.Firebrick;
        PinOperationStatusText.Text = result.Message;
        if (result.Success)
        {
            CurrentPinBox.Clear();
            RefreshState();
        }
    }

    private void LockNow_Click(object sender, RoutedEventArgs e)
    {
        if (!SecurityService.IsPinEnabled)
        {
            PinOperationStatusText.Text = "请先设置四位临时密码。";
            return;
        }
        new TemporaryLockWindow { Owner = Owner ?? this }.ShowDialog();
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    private void DisposeDraft()
    {
        _setupDraft?.Dispose();
        _setupDraft = null;
    }

    private static BitmapImage CreateQrImage(string content)
    {
        using var generator = new QRCodeGenerator();
        using var data = generator.CreateQrCode(content, QRCodeGenerator.ECCLevel.Q);
        var png = new PngByteQRCode(data).GetGraphic(8);
        using var stream = new MemoryStream(png);
        var image = new BitmapImage();
        image.BeginInit();
        image.CacheOption = BitmapCacheOption.OnLoad;
        image.StreamSource = stream;
        image.EndInit();
        image.Freeze();
        return image;
    }
}
