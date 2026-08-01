using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace PersonalWorkbench;

public partial class WorkspaceControl
{
    private Button? _wordWrapButton;
    private bool _v0612WorkspaceAttached;

    internal void EnableV0612WorkspacePolish()
    {
        if (_v0612WorkspaceAttached) return;
        _v0612WorkspaceAttached = true;

        ReflowDocumentIdentity();
        InstallWordWrapToggle();
        ApplyWordWrapSetting();

        _previewTimer.Tick += (_, _) => RenderEnhancedMarkdownPreview();
        PreviewModeButton.Checked += (_, _) => QueueEnhancedMarkdownPreview();
        SplitModeButton.Checked += (_, _) => QueueEnhancedMarkdownPreview();
        FolderTree.SelectedItemChanged += (_, _) => QueueEnhancedMarkdownPreview();
        IsVisibleChanged += (_, _) =>
        {
            if (IsVisible)
            {
                ApplyWordWrapSetting();
                QueueEnhancedMarkdownPreview();
            }
        };
    }

    private void ReflowDocumentIdentity()
    {
        if (DocumentTitleText.Parent is not StackPanel oldStack || oldStack.Parent is not Grid header)
            return;

        var column = Grid.GetColumn(oldStack);
        var row = Grid.GetRow(oldStack);
        oldStack.Children.Remove(DocumentTitleText);
        oldStack.Children.Remove(DocumentPathText);
        header.Children.Remove(oldStack);

        var identity = new Grid
        {
            VerticalAlignment = VerticalAlignment.Center,
            ToolTip = DocumentPathText.Text
        };
        identity.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        identity.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
        identity.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(identity, column);
        Grid.SetRow(identity, row);

        DocumentTitleText.MaxWidth = 300;
        DocumentTitleText.VerticalAlignment = VerticalAlignment.Center;
        DocumentTitleText.TextTrimming = TextTrimming.CharacterEllipsis;
        Grid.SetColumn(DocumentTitleText, 0);
        identity.Children.Add(DocumentTitleText);

        DocumentPathText.Margin = new Thickness(0);
        DocumentPathText.VerticalAlignment = VerticalAlignment.Center;
        DocumentPathText.TextTrimming = TextTrimming.CharacterEllipsis;
        DocumentPathText.ToolTip = DocumentPathText.Text;
        DocumentPathText.TargetUpdated += (_, _) => DocumentPathText.ToolTip = DocumentPathText.Text;
        Grid.SetColumn(DocumentPathText, 2);
        identity.Children.Add(DocumentPathText);
        header.Children.Add(identity);
    }

    private void InstallWordWrapToggle()
    {
        if (SaveButton.Parent is not StackPanel actions || _wordWrapButton is not null)
            return;

        _wordWrapButton = new Button
        {
            Height = 28,
            MinWidth = 0,
            Padding = new Thickness(9, 0, 9, 0),
            Margin = new Thickness(0, 0, 5, 0),
            BorderThickness = new Thickness(1),
            BorderBrush = new SolidColorBrush(Color.FromRgb(213, 222, 233)),
            FontSize = 10.8,
            FontWeight = FontWeights.SemiBold,
            Cursor = System.Windows.Input.Cursors.Hand,
            FocusVisualStyle = null,
            ToolTip = "切换编辑器自动换行"
        };
        _wordWrapButton.Click += (_, _) =>
        {
            _settings.WorkspaceWordWrap = !_settings.WorkspaceWordWrap;
            _settings.Save();
            ApplyWordWrapSetting();
        };
        actions.Children.Insert(0, _wordWrapButton);
    }

    private void ApplyWordWrapSetting()
    {
        EditorBox.TextWrapping = _settings.WorkspaceWordWrap ? TextWrapping.Wrap : TextWrapping.NoWrap;
        EditorBox.HorizontalScrollBarVisibility = _settings.WorkspaceWordWrap
            ? ScrollBarVisibility.Disabled
            : ScrollBarVisibility.Auto;
        if (_wordWrapButton is null) return;

        _wordWrapButton.Content = _settings.WorkspaceWordWrap ? "换行 开" : "换行 关";
        _wordWrapButton.Background = new SolidColorBrush(_settings.WorkspaceWordWrap
            ? Color.FromRgb(232, 241, 255)
            : Color.FromRgb(248, 250, 252));
        _wordWrapButton.Foreground = new SolidColorBrush(_settings.WorkspaceWordWrap
            ? Color.FromRgb(45, 103, 194)
            : Color.FromRgb(101, 117, 138));
        _wordWrapButton.ToolTip = _settings.WorkspaceWordWrap
            ? "自动换行已开启；点击关闭并恢复横向滚动"
            : "自动换行已关闭；点击开启";
    }

    private void QueueEnhancedMarkdownPreview()
    {
        Dispatcher.BeginInvoke(DispatcherPriority.ContextIdle, new Action(RenderEnhancedMarkdownPreview));
    }

    private void RenderEnhancedMarkdownPreview()
    {
        if (string.IsNullOrWhiteSpace(_currentFile)
            || !MarkdownExtensions.Contains(Path.GetExtension(_currentFile)))
            return;
        try
        {
            PreviewViewer.Document = MarkdownDocumentRenderer.Render(
                EditorBox.Text,
                Math.Max(12, _settings.WorkspaceEditorFontSize),
                _currentFile);
        }
        catch (Exception ex)
        {
            App.Log("Enhanced Markdown preview failed: " + ex.Message);
            StatusText.Text = "Markdown 数学或图片渲染失败，源文件未受影响。";
        }
    }
}
