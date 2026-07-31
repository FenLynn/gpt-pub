using System.Diagnostics;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Documents;
using System.Windows.Media;

namespace PersonalWorkbench;

public static partial class MarkdownDocumentRenderer
{
    public static FlowDocument Render(string markdown, double fontSize = 14)
    {
        var document = new FlowDocument
        {
            FontFamily = Application.Current.TryFindResource("AppFont") as FontFamily ?? new FontFamily("Segoe UI"),
            FontSize = fontSize,
            Foreground = new SolidColorBrush(Color.FromRgb(53, 67, 86)),
            PagePadding = new Thickness(18, 14, 22, 24),
            LineHeight = fontSize * 1.62
        };

        var lines = (markdown ?? string.Empty).Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n');
        var inCode = false;
        var codeLines = new List<string>();
        List? activeList = null;

        void FlushList()
        {
            if (activeList is null) return;
            document.Blocks.Add(activeList);
            activeList = null;
        }

        void FlushCode()
        {
            if (codeLines.Count == 0) return;
            var paragraph = new Paragraph
            {
                FontFamily = new FontFamily("Cascadia Mono, Consolas"),
                FontSize = Math.Max(11, fontSize - 1),
                Background = new SolidColorBrush(Color.FromRgb(244, 247, 251)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(224, 231, 240)),
                BorderThickness = new Thickness(1),
                Padding = new Thickness(12),
                Margin = new Thickness(0, 8, 0, 10),
                LineHeight = fontSize * 1.45
            };
            paragraph.Inlines.Add(new Run(string.Join("\n", codeLines)));
            document.Blocks.Add(paragraph);
            codeLines.Clear();
        }

        foreach (var raw in lines)
        {
            var line = raw.TrimEnd();
            if (line.TrimStart().StartsWith("```", StringComparison.Ordinal))
            {
                FlushList();
                if (inCode) FlushCode();
                inCode = !inCode;
                continue;
            }
            if (inCode)
            {
                codeLines.Add(raw);
                continue;
            }

            if (string.IsNullOrWhiteSpace(line))
            {
                FlushList();
                continue;
            }

            var heading = HeadingRegex().Match(line);
            if (heading.Success)
            {
                FlushList();
                var level = heading.Groups[1].Value.Length;
                var paragraph = new Paragraph
                {
                    FontSize = level switch { 1 => fontSize + 10, 2 => fontSize + 6, 3 => fontSize + 3, _ => fontSize + 1 },
                    FontWeight = level <= 2 ? FontWeights.SemiBold : FontWeights.Medium,
                    Foreground = new SolidColorBrush(Color.FromRgb(31, 45, 64)),
                    Margin = new Thickness(0, level == 1 ? 5 : 10, 0, 5),
                    LineHeight = double.NaN
                };
                AddInlineMarkup(paragraph.Inlines, heading.Groups[2].Value);
                document.Blocks.Add(paragraph);
                continue;
            }

            if (HorizontalRuleRegex().IsMatch(line))
            {
                FlushList();
                document.Blocks.Add(new Paragraph
                {
                    BorderBrush = new SolidColorBrush(Color.FromRgb(223, 230, 239)),
                    BorderThickness = new Thickness(0, 0, 0, 1),
                    Margin = new Thickness(0, 8, 0, 10),
                    Padding = new Thickness(0)
                });
                continue;
            }

            var quote = QuoteRegex().Match(line);
            if (quote.Success)
            {
                FlushList();
                var paragraph = new Paragraph
                {
                    Background = new SolidColorBrush(Color.FromRgb(245, 248, 252)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(104, 145, 225)),
                    BorderThickness = new Thickness(3, 0, 0, 0),
                    Padding = new Thickness(12, 7, 10, 7),
                    Margin = new Thickness(0, 6, 0, 8),
                    Foreground = new SolidColorBrush(Color.FromRgb(76, 94, 119))
                };
                AddInlineMarkup(paragraph.Inlines, quote.Groups[1].Value);
                document.Blocks.Add(paragraph);
                continue;
            }

            var bullet = BulletRegex().Match(line);
            var ordered = OrderedRegex().Match(line);
            if (bullet.Success || ordered.Success)
            {
                var marker = ordered.Success ? TextMarkerStyle.Decimal : TextMarkerStyle.Disc;
                if (activeList is null || activeList.MarkerStyle != marker)
                {
                    FlushList();
                    activeList = new List { MarkerStyle = marker, Margin = new Thickness(20, 3, 0, 8) };
                }
                var itemParagraph = new Paragraph { Margin = new Thickness(0, 1, 0, 1) };
                AddInlineMarkup(itemParagraph.Inlines, (bullet.Success ? bullet.Groups[1] : ordered.Groups[1]).Value);
                activeList.ListItems.Add(new ListItem(itemParagraph));
                continue;
            }

            FlushList();
            var body = new Paragraph { Margin = new Thickness(0, 2, 0, 7) };
            AddInlineMarkup(body.Inlines, line);
            document.Blocks.Add(body);
        }

        FlushList();
        if (inCode || codeLines.Count > 0) FlushCode();
        if (document.Blocks.Count == 0)
            document.Blocks.Add(new Paragraph(new Run("空文档")) { Foreground = Brushes.Gray });
        return document;
    }

    private static void AddInlineMarkup(InlineCollection target, string text)
    {
        var position = 0;
        foreach (Match match in InlineRegex().Matches(text))
        {
            if (match.Index > position) target.Add(new Run(text[position..match.Index]));
            if (match.Groups[1].Success)
                target.Add(new Bold(new Run(match.Groups[1].Value)));
            else if (match.Groups[2].Success)
                target.Add(new Italic(new Run(match.Groups[2].Value)));
            else if (match.Groups[3].Success)
                target.Add(new Run(match.Groups[3].Value)
                {
                    FontFamily = new FontFamily("Cascadia Mono, Consolas"),
                    Background = new SolidColorBrush(Color.FromRgb(240, 244, 249)),
                    Foreground = new SolidColorBrush(Color.FromRgb(172, 63, 81))
                });
            else if (match.Groups[4].Success)
            {
                var link = new Hyperlink(new Run(match.Groups[4].Value))
                {
                    Foreground = new SolidColorBrush(Color.FromRgb(47, 108, 216)),
                    TextDecorations = null,
                    ToolTip = match.Groups[5].Value
                };
                link.Click += (_, _) =>
                {
                    try { Process.Start(new ProcessStartInfo(match.Groups[5].Value) { UseShellExecute = true }); } catch { }
                };
                target.Add(link);
            }
            position = match.Index + match.Length;
        }
        if (position < text.Length) target.Add(new Run(text[position..]));
    }

    [GeneratedRegex("^(#{1,6})\\s+(.+)$")]
    private static partial Regex HeadingRegex();
    [GeneratedRegex("^\\s*(?:---+|___+|\\*\\*\\*+)\\s*$")]
    private static partial Regex HorizontalRuleRegex();
    [GeneratedRegex("^\\s*>\\s?(.*)$")]
    private static partial Regex QuoteRegex();
    [GeneratedRegex("^\\s*[-+*]\\s+(.+)$")]
    private static partial Regex BulletRegex();
    [GeneratedRegex("^\\s*\\d+[.)]\\s+(.+)$")]
    private static partial Regex OrderedRegex();
    [GeneratedRegex("\\*\\*(.+?)\\*\\*|(?<!\\*)\\*([^*]+?)\\*|`([^`]+)`|\\[([^]]+)\\]\\(([^)]+)\\)")]
    private static partial Regex InlineRegex();
}