using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using WpfMath.Controls;

namespace PersonalWorkbench;

public static partial class MarkdownDocumentRenderer
{
    public static FlowDocument Render(string markdown, double fontSize = 14, string? documentPath = null)
    {
        var document = new FlowDocument
        {
            FontFamily = Application.Current.TryFindResource("AppFont") as FontFamily ?? new FontFamily("Segoe UI"),
            FontSize = fontSize,
            Foreground = new SolidColorBrush(Color.FromRgb(53, 67, 86)),
            PagePadding = new Thickness(20, 16, 24, 28),
            LineHeight = fontSize * 1.62
        };

        var lines = (markdown ?? string.Empty).Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n').Split('\n');
        var inCode = false;
        var codeLines = new List<string>();
        var inDisplayMath = false;
        var displayMathEnd = string.Empty;
        var mathLines = new List<string>();
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
                FontFamily = new FontFamily("Cascadia Mono, Consolas, Microsoft YaHei UI"),
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

        void FlushMath()
        {
            var formula = string.Join("\n", mathLines).Trim();
            mathLines.Clear();
            inDisplayMath = false;
            displayMathEnd = string.Empty;
            if (string.IsNullOrWhiteSpace(formula)) return;
            document.Blocks.Add(CreateDisplayFormula(formula, fontSize));
        }

        foreach (var raw in lines)
        {
            var line = raw.TrimEnd();
            var trimmed = line.Trim();

            if (inDisplayMath)
            {
                if (trimmed.EndsWith(displayMathEnd, StringComparison.Ordinal))
                {
                    var before = trimmed[..^displayMathEnd.Length];
                    if (!string.IsNullOrWhiteSpace(before)) mathLines.Add(before);
                    FlushMath();
                }
                else
                {
                    mathLines.Add(raw);
                }
                continue;
            }

            if (trimmed.StartsWith("```", StringComparison.Ordinal))
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

            if (TryStartDisplayMath(trimmed, out var mathStart, out var mathEnd, out var singleFormula))
            {
                FlushList();
                if (singleFormula is not null)
                    document.Blocks.Add(CreateDisplayFormula(singleFormula, fontSize));
                else
                {
                    inDisplayMath = true;
                    displayMathEnd = mathEnd;
                    if (!string.IsNullOrWhiteSpace(mathStart)) mathLines.Add(mathStart);
                }
                continue;
            }

            if (string.IsNullOrWhiteSpace(line))
            {
                FlushList();
                continue;
            }

            var blockImage = BlockImageRegex().Match(trimmed);
            if (blockImage.Success)
            {
                FlushList();
                document.Blocks.Add(CreateImageBlock(
                    blockImage.Groups["alt"].Value,
                    blockImage.Groups["target"].Value,
                    documentPath));
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
                AddInlineMarkup(paragraph.Inlines, heading.Groups[2].Value, fontSize, documentPath);
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
                AddInlineMarkup(paragraph.Inlines, quote.Groups[1].Value, fontSize, documentPath);
                document.Blocks.Add(paragraph);
                continue;
            }

            var task = TaskRegex().Match(line);
            var bullet = BulletRegex().Match(line);
            var ordered = OrderedRegex().Match(line);
            if (task.Success || bullet.Success || ordered.Success)
            {
                var marker = ordered.Success ? TextMarkerStyle.Decimal : TextMarkerStyle.Disc;
                if (activeList is null || activeList.MarkerStyle != marker)
                {
                    FlushList();
                    activeList = new List { MarkerStyle = marker, Margin = new Thickness(20, 3, 0, 8) };
                }
                var itemParagraph = new Paragraph { Margin = new Thickness(0, 1, 0, 1) };
                if (task.Success)
                {
                    itemParagraph.Inlines.Add(new Run(task.Groups[1].Value.Equals("x", StringComparison.OrdinalIgnoreCase) ? "☑ " : "☐ ")
                    {
                        Foreground = new SolidColorBrush(Color.FromRgb(70, 111, 184))
                    });
                    AddInlineMarkup(itemParagraph.Inlines, task.Groups[2].Value, fontSize, documentPath);
                }
                else
                {
                    AddInlineMarkup(itemParagraph.Inlines, (bullet.Success ? bullet.Groups[1] : ordered.Groups[1]).Value, fontSize, documentPath);
                }
                activeList.ListItems.Add(new ListItem(itemParagraph));
                continue;
            }

            FlushList();
            var body = new Paragraph { Margin = new Thickness(0, 2, 0, 7) };
            AddInlineMarkup(body.Inlines, line, fontSize, documentPath);
            document.Blocks.Add(body);
        }

        FlushList();
        if (inCode || codeLines.Count > 0) FlushCode();
        if (inDisplayMath || mathLines.Count > 0) FlushMath();
        if (document.Blocks.Count == 0)
            document.Blocks.Add(new Paragraph(new Run("空文档")) { Foreground = Brushes.Gray });
        return document;
    }

    private static bool TryStartDisplayMath(string value, out string firstLine, out string end, out string? singleFormula)
    {
        firstLine = string.Empty;
        end = string.Empty;
        singleFormula = null;
        if (value.StartsWith("$$", StringComparison.Ordinal))
        {
            end = "$$";
            var inner = value[2..];
            if (inner.EndsWith("$$", StringComparison.Ordinal) && inner.Length >= 2)
                singleFormula = inner[..^2].Trim();
            else
                firstLine = inner;
            return true;
        }
        if (value.StartsWith("\\[", StringComparison.Ordinal))
        {
            end = "\\]";
            var inner = value[2..];
            if (inner.EndsWith("\\]", StringComparison.Ordinal) && inner.Length >= 2)
                singleFormula = inner[..^2].Trim();
            else
                firstLine = inner;
            return true;
        }
        return false;
    }

    private static Block CreateDisplayFormula(string formula, double fontSize)
    {
        try
        {
            var control = new FormulaControl
            {
                Formula = formula,
                FontSize = Math.Max(15, fontSize + 2),
                Foreground = new SolidColorBrush(Color.FromRgb(39, 54, 75)),
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(8)
            };
            return new BlockUIContainer(new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(249, 251, 254)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(229, 235, 243)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(9),
                Padding = new Thickness(12, 8, 12, 8),
                Margin = new Thickness(0, 7, 0, 10),
                Child = control
            });
        }
        catch
        {
            return new Paragraph(new Run(formula)
            {
                FontFamily = new FontFamily("Cambria Math, Segoe UI Symbol"),
                Foreground = new SolidColorBrush(Color.FromRgb(124, 72, 82))
            }) { Margin = new Thickness(0, 7, 0, 10) };
        }
    }

    private static void AddInlineMarkup(InlineCollection target, string text, double fontSize, string? documentPath)
    {
        var position = 0;
        foreach (Match match in InlineRegex().Matches(text))
        {
            if (match.Index > position) target.Add(new Run(text[position..match.Index]));
            if (match.Groups["imageAlt"].Success)
            {
                var alt = match.Groups["imageAlt"].Value;
                var imageTarget = match.Groups["imageTarget"].Value;
                var source = LoadImage(imageTarget, documentPath);
                if (source is not null)
                {
                    target.Add(new InlineUIContainer(new Image
                    {
                        Source = source,
                        MaxWidth = 360,
                        MaxHeight = 240,
                        Stretch = Stretch.Uniform,
                        Margin = new Thickness(3, 2, 3, 2),
                        ToolTip = alt
                    }) { BaselineAlignment = BaselineAlignment.Center });
                }
                else
                {
                    target.Add(new Run("[图片：" + (string.IsNullOrWhiteSpace(alt) ? imageTarget : alt) + "]")
                    {
                        Foreground = new SolidColorBrush(Color.FromRgb(155, 86, 96))
                    });
                }
            }
            else if (match.Groups["mathDollar"].Success || match.Groups["mathParen"].Success)
            {
                var formula = match.Groups["mathDollar"].Success
                    ? match.Groups["mathDollar"].Value
                    : match.Groups["mathParen"].Value;
                try
                {
                    target.Add(new InlineUIContainer(new FormulaControl
                    {
                        Formula = formula,
                        FontSize = Math.Max(13, fontSize),
                        Foreground = new SolidColorBrush(Color.FromRgb(39, 54, 75)),
                        Margin = new Thickness(2, 0, 2, -2)
                    }) { BaselineAlignment = BaselineAlignment.Center });
                }
                catch
                {
                    target.Add(new Run(formula) { FontFamily = new FontFamily("Cambria Math") });
                }
            }
            else if (match.Groups["bold"].Success)
                target.Add(new Bold(new Run(match.Groups["bold"].Value)));
            else if (match.Groups["italic"].Success)
                target.Add(new Italic(new Run(match.Groups["italic"].Value)));
            else if (match.Groups["code"].Success)
                target.Add(new Run(match.Groups["code"].Value)
                {
                    FontFamily = new FontFamily("Cascadia Mono, Consolas"),
                    Background = new SolidColorBrush(Color.FromRgb(240, 244, 249)),
                    Foreground = new SolidColorBrush(Color.FromRgb(172, 63, 81))
                });
            else if (match.Groups["linkText"].Success)
            {
                var destination = match.Groups["linkTarget"].Value;
                var link = new Hyperlink(new Run(match.Groups["linkText"].Value))
                {
                    Foreground = new SolidColorBrush(Color.FromRgb(47, 108, 216)),
                    TextDecorations = null,
                    ToolTip = destination
                };
                link.Click += (_, _) =>
                {
                    try { Process.Start(new ProcessStartInfo(destination) { UseShellExecute = true }); } catch { }
                };
                target.Add(link);
            }
            position = match.Index + match.Length;
        }
        if (position < text.Length) target.Add(new Run(text[position..]));
    }

    private static Block CreateImageBlock(string alt, string target, string? documentPath)
    {
        var source = LoadImage(target, documentPath);
        if (source is null)
        {
            return new Paragraph(new Run("图片无法读取：" + target)
            {
                Foreground = new SolidColorBrush(Color.FromRgb(155, 86, 96))
            }) { Margin = new Thickness(0, 7, 0, 10) };
        }

        var panel = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center };
        panel.Children.Add(new Border
        {
            Background = new SolidColorBrush(Color.FromRgb(249, 251, 254)),
            BorderBrush = new SolidColorBrush(Color.FromRgb(228, 234, 242)),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(9),
            Padding = new Thickness(8),
            Child = new Image
            {
                Source = source,
                Stretch = Stretch.Uniform,
                MaxWidth = 920,
                MaxHeight = 620,
                SnapsToDevicePixels = true
            }
        });
        if (!string.IsNullOrWhiteSpace(alt))
            panel.Children.Add(new TextBlock
            {
                Text = alt,
                FontSize = 11,
                Foreground = new SolidColorBrush(Color.FromRgb(119, 133, 151)),
                TextAlignment = TextAlignment.Center,
                Margin = new Thickness(6, 6, 6, 0),
                TextWrapping = TextWrapping.Wrap
            });
        return new BlockUIContainer(panel) { Margin = new Thickness(0, 7, 0, 12) };
    }

    private static ImageSource? LoadImage(string rawTarget, string? documentPath)
    {
        try
        {
            var target = rawTarget.Trim().Trim('<', '>');
            if (target.Length == 0) return null;
            Uri uri;
            if (Uri.TryCreate(target, UriKind.Absolute, out var absolute) && absolute.Scheme is "http" or "https" or "file")
            {
                uri = absolute;
            }
            else
            {
                var directory = !string.IsNullOrWhiteSpace(documentPath)
                    ? Path.GetDirectoryName(documentPath)
                    : null;
                var path = Path.GetFullPath(Path.Combine(
                    directory ?? Environment.CurrentDirectory,
                    Uri.UnescapeDataString(target.Replace('/', Path.DirectorySeparatorChar))));
                if (!File.Exists(path)) return null;
                uri = new Uri(path, UriKind.Absolute);
            }

            if (uri.IsFile)
            {
                using var stream = new FileStream(uri.LocalPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                var image = new BitmapImage();
                image.BeginInit();
                image.CacheOption = BitmapCacheOption.OnLoad;
                image.CreateOptions = BitmapCreateOptions.IgnoreImageCache;
                image.StreamSource = stream;
                image.EndInit();
                image.Freeze();
                return image;
            }

            var remote = new BitmapImage();
            remote.BeginInit();
            remote.UriSource = uri;
            remote.CacheOption = BitmapCacheOption.OnLoad;
            remote.EndInit();
            if (remote.CanFreeze) remote.Freeze();
            return remote;
        }
        catch
        {
            return null;
        }
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
    [GeneratedRegex("^\\s*[-+*]\\s+\\[([ xX])\\]\\s+(.+)$")]
    private static partial Regex TaskRegex();
    [GeneratedRegex("^!\\[(?<alt>[^]]*)\\]\\((?<target>[^)]+)\\)$")]
    private static partial Regex BlockImageRegex();
    [GeneratedRegex("!\\[(?<imageAlt>[^]]*)\\]\\((?<imageTarget>[^)]+)\\)|\\$(?<mathDollar>[^$\\n]+)\\$|\\\\\\((?<mathParen>.+?)\\\\\\)|\\*\\*(?<bold>.+?)\\*\\*|(?<!\\*)\\*(?<italic>[^*]+?)\\*|`(?<code>[^`]+)`|(?<!!)\\[(?<linkText>[^]]+)\\]\\((?<linkTarget>[^)]+)\\)")]
    private static partial Regex InlineRegex();
}
