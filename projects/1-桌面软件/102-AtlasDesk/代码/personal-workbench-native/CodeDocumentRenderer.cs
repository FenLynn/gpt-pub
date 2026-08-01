using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Documents;
using System.Windows.Media;

namespace PersonalWorkbench;

public static class CodeDocumentRenderer
{
    private static readonly HashSet<string> PythonKeywords = new(StringComparer.Ordinal)
    {
        "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif",
        "else", "except", "False", "finally", "for", "from", "global", "if", "import", "in", "is",
        "lambda", "None", "nonlocal", "not", "or", "pass", "raise", "return", "True", "try", "while",
        "with", "yield", "match", "case"
    };

    private static readonly HashSet<string> GenericKeywords = new(StringComparer.Ordinal)
    {
        "public", "private", "protected", "internal", "static", "sealed", "class", "struct", "interface",
        "enum", "namespace", "using", "new", "return", "if", "else", "for", "foreach", "while", "switch",
        "case", "break", "continue", "try", "catch", "finally", "throw", "async", "await", "true", "false",
        "null", "const", "let", "var", "function", "def", "import", "from", "include"
    };

    private static readonly Brush PlainBrush = Freeze(Color.FromRgb(50, 66, 88));
    private static readonly Brush KeywordBrush = Freeze(Color.FromRgb(92, 75, 184));
    private static readonly Brush StringBrush = Freeze(Color.FromRgb(28, 128, 99));
    private static readonly Brush CommentBrush = Freeze(Color.FromRgb(126, 139, 155));
    private static readonly Brush NumberBrush = Freeze(Color.FromRgb(184, 91, 51));
    private static readonly Brush CommandBrush = Freeze(Color.FromRgb(43, 105, 190));

    public static FlowDocument Render(string text, string extension, double fontSize)
    {
        var document = new FlowDocument
        {
            FontFamily = new FontFamily("Cascadia Mono, Consolas, Microsoft YaHei UI"),
            FontSize = Math.Clamp(fontSize, 11, 24),
            Foreground = PlainBrush,
            Background = Brushes.White,
            PagePadding = new Thickness(15, 12, 18, 12),
            LineHeight = Math.Clamp(fontSize + 7, 18, 32)
        };

        var normalized = (text ?? string.Empty)
            .Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace('\r', '\n');
        var lines = normalized.Split('\n');
        for (var index = 0; index < lines.Length; index++)
        {
            var paragraph = new Paragraph { Margin = new Thickness(0), Padding = new Thickness(0) };
            AppendLine(paragraph, lines[index], extension);
            if (index < lines.Length - 1) paragraph.Inlines.Add(new LineBreak());
            document.Blocks.Add(paragraph);
        }
        return document;
    }

    private static void AppendLine(Paragraph paragraph, string line, string extension)
    {
        if (extension.Equals(".tex", StringComparison.OrdinalIgnoreCase))
        {
            AppendLatex(paragraph, line);
            return;
        }

        var python = extension.Equals(".py", StringComparison.OrdinalIgnoreCase);
        var commentMarker = python ? "#" : extension is ".bat" or ".cmd" ? "REM " : "//";
        var commentIndex = FindCommentOutsideString(line, commentMarker, python);
        var code = commentIndex >= 0 ? line[..commentIndex] : line;
        AppendGenericCode(paragraph, code, python ? PythonKeywords : GenericKeywords);
        if (commentIndex >= 0)
            paragraph.Inlines.Add(new Run(line[commentIndex..]) { Foreground = CommentBrush });
    }

    private static void AppendLatex(Paragraph paragraph, string line)
    {
        var commentIndex = FindCommentOutsideString(line, "%", false);
        var code = commentIndex >= 0 ? line[..commentIndex] : line;
        var cursor = 0;
        foreach (Match match in Regex.Matches(code, @"\\[A-Za-z@]+|\\.|\$[^$]*\$|\b\d+(?:\.\d+)?\b"))
        {
            if (match.Index > cursor)
                paragraph.Inlines.Add(new Run(code[cursor..match.Index]) { Foreground = PlainBrush });
            var brush = match.Value.StartsWith('\\') ? CommandBrush
                : match.Value.StartsWith('$') ? StringBrush
                : NumberBrush;
            paragraph.Inlines.Add(new Run(match.Value)
            {
                Foreground = brush,
                FontWeight = match.Value.StartsWith('\\') ? FontWeights.SemiBold : FontWeights.Normal
            });
            cursor = match.Index + match.Length;
        }
        if (cursor < code.Length)
            paragraph.Inlines.Add(new Run(code[cursor..]) { Foreground = PlainBrush });
        if (commentIndex >= 0)
            paragraph.Inlines.Add(new Run(line[commentIndex..]) { Foreground = CommentBrush });
    }

    private static void AppendGenericCode(Paragraph paragraph, string code, HashSet<string> keywords)
    {
        const string tokenPattern = "'(?:\\\\.|[^'\\\\])*'|\"(?:\\\\.|[^\"\\\\])*\"|\\b\\d+(?:\\.\\d+)?\\b|\\b[A-Za-z_][A-Za-z0-9_]*\\b";
        var cursor = 0;
        foreach (Match match in Regex.Matches(code, tokenPattern))
        {
            if (match.Index > cursor)
                paragraph.Inlines.Add(new Run(code[cursor..match.Index]) { Foreground = PlainBrush });
            var value = match.Value;
            if (value.StartsWith('\'') || value.StartsWith('"'))
                paragraph.Inlines.Add(new Run(value) { Foreground = StringBrush });
            else if (char.IsDigit(value[0]))
                paragraph.Inlines.Add(new Run(value) { Foreground = NumberBrush });
            else if (keywords.Contains(value))
                paragraph.Inlines.Add(new Run(value) { Foreground = KeywordBrush, FontWeight = FontWeights.SemiBold });
            else
                paragraph.Inlines.Add(new Run(value) { Foreground = PlainBrush });
            cursor = match.Index + match.Length;
        }
        if (cursor < code.Length)
            paragraph.Inlines.Add(new Run(code[cursor..]) { Foreground = PlainBrush });
    }

    private static int FindCommentOutsideString(string value, string marker, bool hashComment)
    {
        if (string.IsNullOrEmpty(value)) return -1;
        var single = false;
        var doubleQuote = false;
        for (var index = 0; index < value.Length; index++)
        {
            var character = value[index];
            if (character == '\\')
            {
                index++;
                continue;
            }
            if (character == '\'' && !doubleQuote) single = !single;
            else if (character == '"' && !single) doubleQuote = !doubleQuote;
            if (single || doubleQuote) continue;

            if (hashComment && character == '#') return index;
            if (!hashComment && value.AsSpan(index).StartsWith(marker, StringComparison.OrdinalIgnoreCase))
                return index;
        }
        return -1;
    }

    private static SolidColorBrush Freeze(Color color)
    {
        var brush = new SolidColorBrush(color);
        brush.Freeze();
        return brush;
    }
}
