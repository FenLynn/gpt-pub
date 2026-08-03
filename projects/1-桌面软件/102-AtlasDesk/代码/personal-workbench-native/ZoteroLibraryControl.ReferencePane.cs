using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows;
using System.Windows.Controls;

namespace PersonalWorkbench;

public partial class ZoteroLibraryControl
{
    private long _referenceRequestVersion;
    private ZoteroItemDetails? _referenceDetails;
    private string _citationKey = string.Empty;

    public ZoteroRecord? SelectedRecord => _selectedRecord;
    public string CurrentCitationKey => _citationKey;

    private async void ItemsList_SelectionChanged_Reference(object sender, SelectionChangedEventArgs e)
    {
        _selectedRecord = ItemsList.SelectedItem as ZoteroRecord;
        var requestVersion = Interlocked.Increment(ref _referenceRequestVersion);
        if (_selectedRecord is null)
        {
            ClearDetails();
            ClearReferencePane();
            return;
        }

        ClearReferencePane(keepHeading: true);
        ReferenceStatusText.Text = "正在读取只读条目信息…";
        await LoadDetailsAsync(_selectedRecord);
        if (requestVersion != Volatile.Read(ref _referenceRequestVersion)
            || _selectedRecord is null
            || _selectedDetails?.Record.ItemId != _selectedRecord.ItemId)
        {
            return;
        }

        ApplyReferencePane(_selectedDetails);
    }

    private void ApplyReferencePane(ZoteroItemDetails details)
    {
        _referenceDetails = details;
        _citationKey = ZoteroCitationFormatter.ResolveCitationKey(details);
        CitationKeyText.Text = string.IsNullOrWhiteSpace(_citationKey) ? "未记录" : _citationKey;
        DoiValueText.Text = string.IsNullOrWhiteSpace(details.Record.Doi) ? "未记录" : details.Record.Doi;
        CopyCitationKeyButton.IsEnabled = !string.IsNullOrWhiteSpace(_citationKey);
        CopyCitationButton.IsEnabled = true;
        CopyLatexButton.IsEnabled = !string.IsNullOrWhiteSpace(_citationKey);
        CopyPandocButton.IsEnabled = !string.IsNullOrWhiteSpace(_citationKey);
        ShowPdfFolderButton.IsEnabled = details.Record.HasPdf && File.Exists(details.Record.ResolvedPdfPath);
        ReferenceStatusText.Text = "只读 · 引用预览不修改 Zotero 数据";
        UpdateCitationPreview();
    }

    private void ClearReferencePane(bool keepHeading = false)
    {
        _referenceDetails = null;
        _citationKey = string.Empty;
        CitationKeyText.Text = keepHeading ? "读取中…" : "未选择文献";
        DoiValueText.Text = keepHeading ? "读取中…" : "未选择文献";
        CitationPreviewText.Text = string.Empty;
        ReferenceStatusText.Text = keepHeading ? "正在读取只读条目信息…" : "选择文献后可复制引用与文件位置";
        CopyCitationKeyButton.IsEnabled = false;
        CopyCitationButton.IsEnabled = false;
        CopyLatexButton.IsEnabled = false;
        CopyPandocButton.IsEnabled = false;
        ShowPdfFolderButton.IsEnabled = false;
    }

    private void CitationFormat_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (!IsLoaded)
            return;
        UpdateCitationPreview();
    }

    private void UpdateCitationPreview()
    {
        if (_referenceDetails is null)
        {
            CitationPreviewText.Text = string.Empty;
            return;
        }

        var tag = (CitationFormatBox.SelectedItem as ComboBoxItem)?.Tag?.ToString();
        var format = tag switch
        {
            "apa" => ZoteroCitationFormat.ApaQuick,
            "compact" => ZoteroCitationFormat.Compact,
            _ => ZoteroCitationFormat.Gbt7714Quick
        };
        CitationPreviewText.Text = ZoteroCitationFormatter.FormatReference(_referenceDetails, format);
    }

    private void CopyCitationKey_Click(object sender, RoutedEventArgs e) =>
        CopyReferenceText(_citationKey, "Citation Key 已复制");

    private void CopyCitation_Click(object sender, RoutedEventArgs e) =>
        CopyReferenceText(CitationPreviewText.Text, "引用文本已复制");

    private void CopyLatexCitation_Click(object sender, RoutedEventArgs e) =>
        CopyReferenceText(ZoteroCitationFormatter.BuildLatexCitation(_citationKey), "LaTeX 引用已复制");

    private void CopyPandocCitation_Click(object sender, RoutedEventArgs e) =>
        CopyReferenceText(ZoteroCitationFormatter.BuildPandocCitation(_citationKey), "Pandoc 引用已复制");

    private void ShowPdfFolder_Click(object sender, RoutedEventArgs e)
    {
        var path = _selectedRecord?.ResolvedPdfPath;
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
            return;

        try
        {
            Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{path}\"")
            {
                UseShellExecute = true
            });
            ReferenceStatusText.Text = "已在资源管理器中定位 PDF";
        }
        catch (Exception ex)
        {
            App.Log("Show Zotero PDF in Explorer failed: " + ex);
            MessageBox.Show(
                "无法打开 PDF 所在文件夹：\n" + ex.Message,
                "AtlasDesk",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
        }
    }

    private void CopyReferenceText(string value, string successMessage)
    {
        if (string.IsNullOrWhiteSpace(value))
            return;

        try
        {
            Clipboard.SetText(value.Trim());
            ReferenceStatusText.Text = successMessage;
        }
        catch (Exception ex)
        {
            App.Log("Copy Zotero reference text failed: " + ex.Message);
            ReferenceStatusText.Text = "复制失败";
        }
    }
}
