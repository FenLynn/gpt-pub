using System.Text.RegularExpressions;

namespace PersonalWorkbench;

public enum ZoteroCitationFormat
{
    Gbt7714Quick,
    ApaQuick,
    Compact
}

public static class ZoteroCitationFormatter
{
    private static readonly Regex ExtraCitationKeyPattern = new(
        @"(?im)^\s*(?:citation\s*key|citation-key|citekey|tex\.citationkey|bibtex\.citationkey)\s*[:=]\s*(?<key>[^\r\n]+?)\s*$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static string ResolveCitationKey(ZoteroItemDetails details)
    {
        ArgumentNullException.ThrowIfNull(details);
        var native = details.Fields.FirstOrDefault(field => field.Name.Equals("citationKey", StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrWhiteSpace(native?.Value))
            return native.Value.Trim();

        var extra = details.Fields.FirstOrDefault(field => field.Name.Equals("extra", StringComparison.OrdinalIgnoreCase));
        if (string.IsNullOrWhiteSpace(extra?.Value))
            return string.Empty;

        var match = ExtraCitationKeyPattern.Match(extra.Value);
        return match.Success ? match.Groups["key"].Value.Trim() : string.Empty;
    }

    public static string FormatReference(ZoteroItemDetails details, ZoteroCitationFormat format)
    {
        ArgumentNullException.ThrowIfNull(details);
        var record = details.Record;
        var authors = BuildAuthors(details);
        var year = string.IsNullOrWhiteSpace(record.Year) ? "n.d." : record.Year.Trim();
        var title = Clean(record.DisplayTitle);
        var source = Clean(record.Publication);
        var doi = NormalizeDoi(record.Doi);

        return format switch
        {
            ZoteroCitationFormat.ApaQuick => BuildApa(authors, year, title, source, doi),
            ZoteroCitationFormat.Compact => BuildCompact(authors, year, title, source, doi),
            _ => BuildGbt(authors, year, title, source, doi, record.ItemType)
        };
    }

    public static string BuildLatexCitation(string citationKey) =>
        string.IsNullOrWhiteSpace(citationKey) ? string.Empty : $"\\cite{{{citationKey.Trim()}}}";

    public static string BuildPandocCitation(string citationKey) =>
        string.IsNullOrWhiteSpace(citationKey) ? string.Empty : $"[@{citationKey.Trim()}]";

    private static string BuildAuthors(ZoteroItemDetails details)
    {
        var authors = details.Creators
            .Where(creator => creator.Role is "作者" or "发明人" || string.IsNullOrWhiteSpace(creator.Role))
            .Select(creator => Clean(creator.Name))
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .ToArray();
        if (authors.Length == 0 && !string.IsNullOrWhiteSpace(details.Record.Authors))
            authors = details.Record.Authors.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (authors.Length == 0)
            return "佚名";
        if (authors.Length <= 3)
            return string.Join(", ", authors);
        return string.Join(", ", authors.Take(3)) + ", et al.";
    }

    private static string BuildGbt(string authors, string year, string title, string source, string doi, string itemType)
    {
        var marker = itemType switch
        {
            "book" or "bookSection" => "[M]",
            "conferencePaper" => "[C]",
            "thesis" => "[D]",
            "report" or "preprint" => "[R]",
            "patent" => "[P]",
            "webpage" => "[EB/OL]",
            _ => "[J]"
        };
        var result = $"{authors}. {title}{marker}.";
        if (!string.IsNullOrWhiteSpace(source))
            result += $" {source},";
        result += $" {year}.";
        if (!string.IsNullOrWhiteSpace(doi))
            result += $" DOI: {doi}.";
        return NormalizeSpaces(result);
    }

    private static string BuildApa(string authors, string year, string title, string source, string doi)
    {
        var result = $"{authors} ({year}). {title}.";
        if (!string.IsNullOrWhiteSpace(source))
            result += $" {source}.";
        if (!string.IsNullOrWhiteSpace(doi))
            result += $" https://doi.org/{doi}";
        return NormalizeSpaces(result);
    }

    private static string BuildCompact(string authors, string year, string title, string source, string doi)
    {
        var parts = new List<string> { authors, $"{title} ({year})" };
        if (!string.IsNullOrWhiteSpace(source))
            parts.Add(source);
        if (!string.IsNullOrWhiteSpace(doi))
            parts.Add("DOI: " + doi);
        return string.Join(" · ", parts.Where(part => !string.IsNullOrWhiteSpace(part)));
    }

    private static string NormalizeDoi(string value)
    {
        var doi = Clean(value);
        foreach (var prefix in new[] { "https://doi.org/", "http://doi.org/", "doi:" })
        {
            if (!doi.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                continue;
            doi = doi[prefix.Length..].Trim();
            break;
        }
        return doi;
    }

    private static string Clean(string value) =>
        string.IsNullOrWhiteSpace(value) ? string.Empty : NormalizeSpaces(value.Trim());

    private static string NormalizeSpaces(string value) =>
        Regex.Replace(value, @"\s+", " ").Trim();
}
