using System.Diagnostics;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace PersonalWorkbench;

public sealed class ZoteroItemTypeGlyph : FrameworkElement
{
    public static readonly DependencyProperty ItemTypeProperty = DependencyProperty.Register(
        nameof(ItemType), typeof(string), typeof(ZoteroItemTypeGlyph),
        new FrameworkPropertyMetadata(string.Empty, FrameworkPropertyMetadataOptions.AffectsRender));

    public string ItemType
    {
        get => (string)GetValue(ItemTypeProperty);
        set => SetValue(ItemTypeProperty, value);
    }

    protected override void OnRender(DrawingContext dc)
    {
        base.OnRender(dc);
        if (ActualWidth <= 0 || ActualHeight <= 0) return;
        dc.PushTransform(new ScaleTransform(ActualWidth / 24d, ActualHeight / 24d));
        DrawGlyph(dc, ItemType ?? string.Empty);
        dc.Pop();
    }

    private static void DrawGlyph(DrawingContext dc, string itemType)
    {
        var key = itemType.Trim();
        var color = key switch
        {
            "thesis" => Color.FromRgb(116, 91, 161),
            "conferencePaper" or "presentation" => Color.FromRgb(103, 109, 170),
            "book" or "bookSection" => Color.FromRgb(75, 125, 100),
            "patent" => Color.FromRgb(145, 105, 66),
            "webpage" => Color.FromRgb(57, 126, 171),
            "computerProgram" => Color.FromRgb(66, 114, 157),
            "dataset" => Color.FromRgb(69, 132, 139),
            "magazineArticle" or "newspaperArticle" => Color.FromRgb(110, 103, 88),
            "letter" => Color.FromRgb(123, 104, 145),
            _ => Color.FromRgb(78, 119, 168)
        };
        var pen = new Pen(new SolidColorBrush(color), 1.55)
        {
            StartLineCap = PenLineCap.Round,
            EndLineCap = PenLineCap.Round,
            LineJoin = PenLineJoin.Round
        };
        pen.Freeze();

        switch (key)
        {
            case "thesis":
                dc.DrawGeometry(null, pen, Geometry.Parse("M3,9 L12,4 L21,9 L12,14 Z M7,12 V17 C10,20 14,20 17,17 V12 M21,9 V15"));
                break;
            case "conferencePaper":
                dc.DrawRoundedRectangle(null, pen, new Rect(4, 6, 16, 14), 1.2, 1.2);
                dc.DrawLine(pen, new Point(4, 10), new Point(20, 10));
                dc.DrawLine(pen, new Point(8, 4), new Point(8, 8));
                dc.DrawLine(pen, new Point(16, 4), new Point(16, 8));
                dc.DrawLine(pen, new Point(8, 14), new Point(16, 14));
                break;
            case "book":
            case "bookSection":
                dc.DrawGeometry(null, pen, Geometry.Parse("M4,5 H10 C12,5 13,6 13,8 V20 H8 C5.5,20 4,18.8 4,17 Z M13,8 C13,6 14,5 16,5 H20 V17 C20,18.8 18.5,20 16,20 H13"));
                break;
            case "patent":
                DrawPage(dc, pen);
                dc.DrawEllipse(null, pen, new Point(12, 15), 3.2, 3.2);
                dc.DrawLine(pen, new Point(10.5, 18), new Point(9.5, 21));
                dc.DrawLine(pen, new Point(13.5, 18), new Point(14.5, 21));
                break;
            case "webpage":
                dc.DrawEllipse(null, pen, new Point(12, 12), 8, 8);
                dc.DrawEllipse(null, pen, new Point(12, 12), 3.4, 8);
                dc.DrawLine(pen, new Point(4, 12), new Point(20, 12));
                break;
            case "computerProgram":
                dc.DrawRoundedRectangle(null, pen, new Rect(3.5, 5, 17, 14), 1.5, 1.5);
                dc.DrawLine(pen, new Point(8.5, 9), new Point(6, 12));
                dc.DrawLine(pen, new Point(6, 12), new Point(8.5, 15));
                dc.DrawLine(pen, new Point(15.5, 9), new Point(18, 12));
                dc.DrawLine(pen, new Point(18, 12), new Point(15.5, 15));
                dc.DrawLine(pen, new Point(13.5, 8), new Point(10.5, 16));
                break;
            case "dataset":
                dc.DrawEllipse(null, pen, new Point(12, 6.5), 7, 2.5);
                dc.DrawLine(pen, new Point(5, 6.5), new Point(5, 17.5));
                dc.DrawLine(pen, new Point(19, 6.5), new Point(19, 17.5));
                dc.DrawGeometry(null, pen, Geometry.Parse("M5,12 C7,15 17,15 19,12 M5,17.5 C7,20.5 17,20.5 19,17.5"));
                break;
            case "presentation":
                dc.DrawRoundedRectangle(null, pen, new Rect(4, 5, 16, 11), 1.2, 1.2);
                dc.DrawLine(pen, new Point(12, 16), new Point(12, 20));
                dc.DrawLine(pen, new Point(8, 20), new Point(16, 20));
                dc.DrawGeometry(null, pen, Geometry.Parse("M8,13 L11,10 L13,12 L17,8"));
                break;
            case "magazineArticle":
            case "newspaperArticle":
                dc.DrawRoundedRectangle(null, pen, new Rect(4, 4, 16, 16), 1, 1);
                dc.DrawRectangle(null, pen, new Rect(7, 8, 4, 5));
                dc.DrawLine(pen, new Point(13, 8), new Point(17, 8));
                dc.DrawLine(pen, new Point(13, 11), new Point(17, 11));
                dc.DrawLine(pen, new Point(7, 16), new Point(17, 16));
                break;
            case "letter":
                dc.DrawRoundedRectangle(null, pen, new Rect(3.5, 6, 17, 12), 1.2, 1.2);
                dc.DrawGeometry(null, pen, Geometry.Parse("M4,7 L12,13 L20,7"));
                break;
            default:
                DrawPage(dc, pen);
                dc.DrawLine(pen, new Point(8.5, 11), new Point(16.5, 11));
                dc.DrawLine(pen, new Point(8.5, 14.5), new Point(16.5, 14.5));
                dc.DrawLine(pen, new Point(8.5, 18), new Point(14.5, 18));
                break;
        }
    }

    private static void DrawPage(DrawingContext dc, Pen pen)
        => dc.DrawGeometry(null, pen, Geometry.Parse("M6,3 H15 L20,8 V21 H6 Z M15,3 V8 H20"));
}

public sealed class ZoteroRecordAttachmentGlyph : FrameworkElement
{
    public static readonly DependencyProperty HasPdfProperty = DependencyProperty.Register(
        nameof(HasPdf), typeof(bool), typeof(ZoteroRecordAttachmentGlyph),
        new FrameworkPropertyMetadata(false, FrameworkPropertyMetadataOptions.AffectsRender, OnVisualChanged));

    public static readonly DependencyProperty AttachmentCountProperty = DependencyProperty.Register(
        nameof(AttachmentCount), typeof(int), typeof(ZoteroRecordAttachmentGlyph),
        new FrameworkPropertyMetadata(0, FrameworkPropertyMetadataOptions.AffectsRender, OnVisualChanged));

    public bool HasPdf
    {
        get => (bool)GetValue(HasPdfProperty);
        set => SetValue(HasPdfProperty, value);
    }

    public int AttachmentCount
    {
        get => (int)GetValue(AttachmentCountProperty);
        set => SetValue(AttachmentCountProperty, value);
    }

    protected override void OnRender(DrawingContext dc)
    {
        base.OnRender(dc);
        if (ActualWidth <= 0 || ActualHeight <= 0 || AttachmentCount <= 0) return;
        dc.PushTransform(new ScaleTransform(ActualWidth / 24d, ActualHeight / 24d));
        if (HasPdf)
            ZoteroAttachmentDrawing.DrawPdf(dc);
        else
            ZoteroAttachmentDrawing.DrawPaperclip(dc, Color.FromRgb(102, 120, 143));
        dc.Pop();
    }

    private static void OnVisualChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is not ZoteroRecordAttachmentGlyph glyph) return;
        glyph.ToolTip = glyph.AttachmentCount <= 0
            ? null
            : glyph.HasPdf
                ? $"本地 PDF · 共 {glyph.AttachmentCount} 个附件"
                : $"{glyph.AttachmentCount} 个附件";
    }
}

public enum ZoteroAttachmentVisualKind
{
    Pdf,
    Word,
    PowerPoint,
    Excel,
    Image,
    Other
}

public sealed class ZoteroAttachmentGlyph : FrameworkElement
{
    public static readonly DependencyProperty KindProperty = DependencyProperty.Register(
        nameof(Kind), typeof(ZoteroAttachmentVisualKind), typeof(ZoteroAttachmentGlyph),
        new FrameworkPropertyMetadata(ZoteroAttachmentVisualKind.Other, FrameworkPropertyMetadataOptions.AffectsRender));

    public ZoteroAttachmentVisualKind Kind
    {
        get => (ZoteroAttachmentVisualKind)GetValue(KindProperty);
        set => SetValue(KindProperty, value);
    }

    protected override void OnRender(DrawingContext dc)
    {
        base.OnRender(dc);
        if (ActualWidth <= 0 || ActualHeight <= 0) return;
        dc.PushTransform(new ScaleTransform(ActualWidth / 24d, ActualHeight / 24d));
        switch (Kind)
        {
            case ZoteroAttachmentVisualKind.Pdf:
                ZoteroAttachmentDrawing.DrawPdf(dc);
                break;
            case ZoteroAttachmentVisualKind.Word:
                ZoteroAttachmentDrawing.DrawOffice(dc, "W", Color.FromRgb(45, 101, 176));
                break;
            case ZoteroAttachmentVisualKind.PowerPoint:
                ZoteroAttachmentDrawing.DrawOffice(dc, "P", Color.FromRgb(211, 88, 48));
                break;
            case ZoteroAttachmentVisualKind.Excel:
                ZoteroAttachmentDrawing.DrawOffice(dc, "X", Color.FromRgb(46, 128, 79));
                break;
            case ZoteroAttachmentVisualKind.Image:
                ZoteroAttachmentDrawing.DrawImage(dc);
                break;
            default:
                ZoteroAttachmentDrawing.DrawPaperclip(dc, Color.FromRgb(102, 120, 143));
                break;
        }
        dc.Pop();
    }
}

public sealed class ZoteroAttachmentRow : Grid
{
    private readonly ZoteroAttachmentGlyph _glyph;
    private readonly TextBlock _title;
    private readonly TextBlock _status;
    private readonly TextBlock _path;
    private readonly Button _open;
    private ZoteroAttachmentInfo? _attachment;

    public ZoteroAttachmentRow()
    {
        Margin = new Thickness(0, 0, 0, 1);
        Background = Brushes.Transparent;
        ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(34) });
        ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _glyph = new ZoteroAttachmentGlyph
        {
            Width = 23,
            Height = 23,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(3, 10, 0, 0)
        };
        Children.Add(_glyph);

        var text = new StackPanel { Margin = new Thickness(0, 7, 8, 7) };
        Grid.SetColumn(text, 1);
        _title = new TextBlock
        {
            FontSize = 12.1,
            FontWeight = FontWeights.SemiBold,
            Foreground = new SolidColorBrush(Color.FromRgb(57, 73, 94)),
            TextTrimming = TextTrimming.CharacterEllipsis
        };
        _status = new TextBlock
        {
            FontSize = 10.6,
            Foreground = new SolidColorBrush(Color.FromRgb(112, 128, 149)),
            Margin = new Thickness(0, 3, 0, 0)
        };
        _path = new TextBlock
        {
            FontSize = 10.1,
            Foreground = new SolidColorBrush(Color.FromRgb(145, 157, 173)),
            Margin = new Thickness(0, 2, 0, 0),
            TextTrimming = TextTrimming.CharacterEllipsis
        };
        text.Children.Add(_title);
        text.Children.Add(_status);
        text.Children.Add(_path);
        Children.Add(text);

        _open = new Button
        {
            Content = "打开",
            Style = Application.Current.TryFindResource("TerminalHeaderButton") as Style,
            MinWidth = 50,
            Height = 25,
            Margin = new Thickness(0, 10, 3, 0),
            VerticalAlignment = VerticalAlignment.Top
        };
        _open.Click += Open_Click;
        Grid.SetColumn(_open, 2);
        Children.Add(_open);

        DataContextChanged += (_, _) => UpdateAttachment(DataContext as ZoteroAttachmentInfo);
    }

    private void UpdateAttachment(ZoteroAttachmentInfo? attachment)
    {
        _attachment = attachment;
        if (attachment is null)
        {
            _title.Text = string.Empty;
            _status.Text = string.Empty;
            _path.Text = string.Empty;
            _open.IsEnabled = false;
            return;
        }

        var kind = ResolveKind(attachment);
        _glyph.Kind = kind;
        _title.Text = attachment.DisplayTitle;
        _status.Text = attachment.Exists
            ? kind switch
            {
                ZoteroAttachmentVisualKind.Pdf => "PDF · 本地可用",
                ZoteroAttachmentVisualKind.Word => "Word 文档 · 本地可用",
                ZoteroAttachmentVisualKind.PowerPoint => "PowerPoint · 本地可用",
                ZoteroAttachmentVisualKind.Excel => "Excel 表格 · 本地可用",
                ZoteroAttachmentVisualKind.Image => "图片 · 本地可用",
                _ => "附件 · 本地可用"
            }
            : "文件缺失或尚未同步";
        _path.Text = attachment.ResolvedPath;
        _open.IsEnabled = attachment.Exists;
        ToolTip = attachment.ResolvedPath;
    }

    private void Open_Click(object sender, RoutedEventArgs e)
    {
        if (_attachment is null || !_attachment.Exists) return;
        try
        {
            Process.Start(new ProcessStartInfo(_attachment.ResolvedPath) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            App.Log("Open Zotero attachment failed: " + ex.Message);
        }
    }

    private static ZoteroAttachmentVisualKind ResolveKind(ZoteroAttachmentInfo attachment)
    {
        var path = !string.IsNullOrWhiteSpace(attachment.ResolvedPath) ? attachment.ResolvedPath : attachment.RawPath;
        var extension = Path.GetExtension(path).ToLowerInvariant();
        var content = attachment.ContentType.ToLowerInvariant();
        if (attachment.IsPdf) return ZoteroAttachmentVisualKind.Pdf;
        if (extension is ".doc" or ".docx" or ".rtf" || content.Contains("word")) return ZoteroAttachmentVisualKind.Word;
        if (extension is ".ppt" or ".pptx" or ".pps" or ".ppsx" || content.Contains("presentation") || content.Contains("powerpoint")) return ZoteroAttachmentVisualKind.PowerPoint;
        if (extension is ".xls" or ".xlsx" or ".csv" || content.Contains("spreadsheet") || content.Contains("excel")) return ZoteroAttachmentVisualKind.Excel;
        if (extension is ".png" or ".jpg" or ".jpeg" or ".gif" or ".bmp" or ".webp" or ".tif" or ".tiff" || content.StartsWith("image/")) return ZoteroAttachmentVisualKind.Image;
        return ZoteroAttachmentVisualKind.Other;
    }
}

internal static class ZoteroAttachmentDrawing
{
    public static void DrawPdf(DrawingContext dc)
    {
        var red = new SolidColorBrush(Color.FromRgb(213, 67, 76));
        red.Freeze();
        var pen = new Pen(red, 1.55) { LineJoin = PenLineJoin.Round };
        pen.Freeze();
        dc.DrawGeometry(null, pen, Geometry.Parse("M6,3 H15 L20,8 V21 H6 Z M15,3 V8 H20"));
        dc.DrawGeometry(null, pen, Geometry.Parse("M8,17 C11,14 13,9 12,7 C11,10 13,15 17,17 C14,16 10,16 8,17"));
    }

    public static void DrawOffice(DrawingContext dc, string letter, Color color)
    {
        var brush = new SolidColorBrush(color);
        brush.Freeze();
        dc.DrawRoundedRectangle(brush, null, new Rect(4, 3, 16, 18), 2, 2);
        var text = new FormattedText(
            letter,
            CultureInfo.InvariantCulture,
            FlowDirection.LeftToRight,
            new Typeface("Segoe UI"),
            11,
            Brushes.White,
            1.0);
        dc.DrawText(text, new Point(8.2, 5.4));
    }

    public static void DrawPaperclip(DrawingContext dc, Color color)
    {
        var pen = new Pen(new SolidColorBrush(color), 1.7)
        {
            StartLineCap = PenLineCap.Round,
            EndLineCap = PenLineCap.Round
        };
        pen.Freeze();
        dc.DrawGeometry(null, pen, Geometry.Parse("M9,12 L15.5,5.5 C18,3 21,6 18.5,8.5 L10,17 C6,21 2,16.5 5.5,13 L14,4.5"));
    }

    public static void DrawImage(DrawingContext dc)
    {
        var pen = new Pen(new SolidColorBrush(Color.FromRgb(86, 137, 105)), 1.55) { LineJoin = PenLineJoin.Round };
        pen.Freeze();
        dc.DrawRoundedRectangle(null, pen, new Rect(4, 5, 16, 14), 1.4, 1.4);
        dc.DrawEllipse(null, pen, new Point(15.5, 9.5), 1.6, 1.6);
        dc.DrawGeometry(null, pen, Geometry.Parse("M6,17 L10,12 L13,15 L16,12 L19,17"));
    }
}
