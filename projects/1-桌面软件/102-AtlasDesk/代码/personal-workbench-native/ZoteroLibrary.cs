using Microsoft.Data.Sqlite;
using System.Text.RegularExpressions;

namespace PersonalWorkbench;

public sealed class ZoteroRecord
{
    public long ItemId { get; init; }
    public string Key { get; init; } = string.Empty;
    public string ItemType { get; init; } = string.Empty;
    public string Title { get; init; } = string.Empty;
    public string Authors { get; init; } = string.Empty;
    public string Year { get; init; } = string.Empty;
    public string Publication { get; init; } = string.Empty;
    public string Doi { get; init; } = string.Empty;
    public string Abstract { get; init; } = string.Empty;
    public string DateModified { get; init; } = string.Empty;
    public string AttachmentPath { get; init; } = string.Empty;
    public string AttachmentKey { get; init; } = string.Empty;
    public string ResolvedPdfPath { get; init; } = string.Empty;

    public string DisplayTitle => string.IsNullOrWhiteSpace(Title) ? "（无标题）" : Title;
}

public static class ZoteroLibrary
{
    public static IReadOnlyList<string> DetectDatabaseCandidates()
    {
        var results = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

        AddCandidate(results, Path.Combine(userProfile, "Zotero", "zotero.sqlite"));
        AddCandidate(results, Path.Combine(appData, "Zotero", "zotero.sqlite"));
        AddCandidate(results, Path.Combine(localAppData, "Zotero", "zotero.sqlite"));

        foreach (var root in new[]
                 {
                     Path.Combine(appData, "Zotero", "Zotero", "Profiles"),
                     Path.Combine(localAppData, "Zotero", "Zotero", "Profiles")
                 })
        {
            if (!Directory.Exists(root))
                continue;

            foreach (var profile in Directory.EnumerateDirectories(root))
            {
                AddCandidate(results, Path.Combine(profile, "zotero.sqlite"));
                TryReadCustomDataDirectory(profile, results);
            }
        }

        return results.OrderBy(path => path, StringComparer.OrdinalIgnoreCase).ToArray();
    }

    public static async Task<IReadOnlyList<ZoteroRecord>> SearchAsync(string databasePath, string? query, int limit = 200)
    {
        if (string.IsNullOrWhiteSpace(databasePath) || !File.Exists(databasePath))
            throw new FileNotFoundException("未找到 Zotero 数据库。", databasePath);

        var connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadOnly,
            Cache = SqliteCacheMode.Shared,
            Pooling = false
        }.ToString();

        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();

        var creatorSql = await BuildCreatorCteAsync(connection);
        var attachment = await GetAttachmentSchemaAsync(connection);
        var deletedJoin = await TableExistsAsync(connection, "deletedItems")
            ? "LEFT JOIN deletedItems deleted ON deleted.itemID = i.itemID"
            : string.Empty;
        var deletedFilter = string.IsNullOrEmpty(deletedJoin) ? string.Empty : "AND deleted.itemID IS NULL";

        var attachmentSelect = attachment is null
            ? "'' AS attachmentPath, '' AS attachmentKey"
            : $@"COALESCE((
                    SELECT ia.path
                    FROM itemAttachments ia
                    JOIN items ai ON ai.itemID = ia.itemID
                    WHERE ia.{attachment.ParentColumn} = i.itemID
                      AND (LOWER(COALESCE(ia.{attachment.ContentColumn}, '')) = 'application/pdf'
                           OR LOWER(COALESCE(ia.path, '')) LIKE '%.pdf')
                    ORDER BY ia.itemID
                    LIMIT 1
                ), '') AS attachmentPath,
                COALESCE((
                    SELECT ai.key
                    FROM itemAttachments ia
                    JOIN items ai ON ai.itemID = ia.itemID
                    WHERE ia.{attachment.ParentColumn} = i.itemID
                      AND (LOWER(COALESCE(ia.{attachment.ContentColumn}, '')) = 'application/pdf'
                           OR LOWER(COALESCE(ia.path, '')) LIKE '%.pdf')
                    ORDER BY ia.itemID
                    LIMIT 1
                ), '') AS attachmentKey";

        var sql = $@"
WITH
{creatorSql},
metadata AS (
    SELECT
        i.itemID,
        i.key,
        it.typeName AS itemType,
        i.dateModified,
        MAX(CASE WHEN f.fieldName = 'title' THEN v.value END) AS title,
        MAX(CASE WHEN f.fieldName = 'date' THEN v.value END) AS itemDate,
        MAX(CASE WHEN f.fieldName = 'DOI' THEN v.value END) AS doi,
        MAX(CASE WHEN f.fieldName IN ('publicationTitle', 'proceedingsTitle', 'bookTitle', 'websiteTitle') THEN v.value END) AS publication,
        MAX(CASE WHEN f.fieldName = 'abstractNote' THEN v.value END) AS abstractNote
    FROM items i
    JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
    LEFT JOIN itemData d ON d.itemID = i.itemID
    LEFT JOIN fields f ON f.fieldID = d.fieldID
    LEFT JOIN itemDataValues v ON v.valueID = d.valueID
    {deletedJoin}
    WHERE it.typeName NOT IN ('attachment', 'note', 'annotation')
      {deletedFilter}
    GROUP BY i.itemID, i.key, it.typeName, i.dateModified
)
SELECT
    i.itemID,
    i.key,
    i.itemType,
    COALESCE(i.title, '') AS title,
    COALESCE(a.authors, '') AS authors,
    COALESCE(i.itemDate, '') AS itemDate,
    COALESCE(i.publication, '') AS publication,
    COALESCE(i.doi, '') AS doi,
    COALESCE(i.abstractNote, '') AS abstractNote,
    COALESCE(i.dateModified, '') AS dateModified,
    {attachmentSelect}
FROM metadata i
LEFT JOIN authors a ON a.itemID = i.itemID
WHERE (@query = ''
       OR LOWER(COALESCE(i.title, '')) LIKE @like
       OR LOWER(COALESCE(a.authors, '')) LIKE @like
       OR LOWER(COALESCE(i.publication, '')) LIKE @like
       OR LOWER(COALESCE(i.doi, '')) LIKE @like
       OR LOWER(COALESCE(i.abstractNote, '')) LIKE @like)
ORDER BY i.dateModified DESC
LIMIT @limit;";

        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        var normalized = (query ?? string.Empty).Trim().ToLowerInvariant();
        command.Parameters.AddWithValue("@query", normalized);
        command.Parameters.AddWithValue("@like", "%" + normalized + "%");
        command.Parameters.AddWithValue("@limit", Math.Clamp(limit, 1, 1000));

        var records = new List<ZoteroRecord>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var rawDate = reader.GetString(5);
            var attachmentPath = reader.GetString(10);
            var attachmentKey = reader.GetString(11);
            records.Add(new ZoteroRecord
            {
                ItemId = reader.GetInt64(0),
                Key = reader.GetString(1),
                ItemType = reader.GetString(2),
                Title = reader.GetString(3),
                Authors = reader.GetString(4),
                Year = ExtractYear(rawDate),
                Publication = reader.GetString(6),
                Doi = reader.GetString(7),
                Abstract = reader.GetString(8),
                DateModified = reader.GetString(9),
                AttachmentPath = attachmentPath,
                AttachmentKey = attachmentKey,
                ResolvedPdfPath = ResolveAttachmentPath(databasePath, attachmentPath, attachmentKey)
            });
        }

        return records;
    }

    private static async Task<string> BuildCreatorCteAsync(SqliteConnection connection)
    {
        if (!await TableExistsAsync(connection, "itemCreators") || !await TableExistsAsync(connection, "creators"))
            return "authors AS (SELECT NULL AS itemID, '' AS authors WHERE 0)";

        if (await ColumnExistsAsync(connection, "creators", "firstName") &&
            await ColumnExistsAsync(connection, "creators", "lastName"))
        {
            return @"authors AS (
                SELECT ic.itemID,
                       GROUP_CONCAT(TRIM(COALESCE(c.firstName, '') || CASE WHEN COALESCE(c.firstName, '') <> '' AND COALESCE(c.lastName, '') <> '' THEN ' ' ELSE '' END || COALESCE(c.lastName, '')), ', ') AS authors
                FROM itemCreators ic
                JOIN creators c ON c.creatorID = ic.creatorID
                GROUP BY ic.itemID
            )";
        }

        if (await TableExistsAsync(connection, "creatorData") &&
            await ColumnExistsAsync(connection, "creators", "creatorDataID"))
        {
            return @"authors AS (
                SELECT ic.itemID,
                       GROUP_CONCAT(TRIM(COALESCE(cd.firstName, '') || CASE WHEN COALESCE(cd.firstName, '') <> '' AND COALESCE(cd.lastName, '') <> '' THEN ' ' ELSE '' END || COALESCE(cd.lastName, '')), ', ') AS authors
                FROM itemCreators ic
                JOIN creators c ON c.creatorID = ic.creatorID
                JOIN creatorData cd ON cd.creatorDataID = c.creatorDataID
                GROUP BY ic.itemID
            )";
        }

        return "authors AS (SELECT NULL AS itemID, '' AS authors WHERE 0)";
    }

    private static async Task<AttachmentSchema?> GetAttachmentSchemaAsync(SqliteConnection connection)
    {
        if (!await TableExistsAsync(connection, "itemAttachments") ||
            !await ColumnExistsAsync(connection, "itemAttachments", "path"))
            return null;

        var parent = await ColumnExistsAsync(connection, "itemAttachments", "parentItemID")
            ? "parentItemID"
            : await ColumnExistsAsync(connection, "itemAttachments", "sourceItemID") ? "sourceItemID" : string.Empty;
        var content = await ColumnExistsAsync(connection, "itemAttachments", "contentType")
            ? "contentType"
            : await ColumnExistsAsync(connection, "itemAttachments", "mimeType") ? "mimeType" : string.Empty;

        return string.IsNullOrEmpty(parent) || string.IsNullOrEmpty(content)
            ? null
            : new AttachmentSchema(parent, content);
    }

    private static async Task<bool> TableExistsAsync(SqliteConnection connection, string table)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT 1 FROM sqlite_master WHERE type='table' AND name=@name LIMIT 1";
        command.Parameters.AddWithValue("@name", table);
        return await command.ExecuteScalarAsync() is not null;
    }

    private static async Task<bool> ColumnExistsAsync(SqliteConnection connection, string table, string column)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = $"PRAGMA table_info([{table.Replace("]", "]]", StringComparison.Ordinal)}])";
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            if (string.Equals(reader.GetString(1), column, StringComparison.OrdinalIgnoreCase))
                return true;
        }
        return false;
    }

    private static string ResolveAttachmentPath(string databasePath, string rawPath, string attachmentKey)
    {
        if (string.IsNullOrWhiteSpace(rawPath))
            return string.Empty;

        if (rawPath.StartsWith("storage:", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(attachmentKey))
        {
            var relative = rawPath["storage:".Length..].Replace('/', Path.DirectorySeparatorChar);
            var resolved = Path.Combine(Path.GetDirectoryName(databasePath) ?? string.Empty, "storage", attachmentKey, relative);
            return File.Exists(resolved) ? resolved : string.Empty;
        }

        if (Path.IsPathRooted(rawPath))
            return File.Exists(rawPath) ? rawPath : string.Empty;

        return string.Empty;
    }

    private static string ExtractYear(string value)
    {
        var match = Regex.Match(value ?? string.Empty, @"(?<!\d)(18|19|20|21)\d{2}(?!\d)");
        return match.Success ? match.Value : string.Empty;
    }

    private static void AddCandidate(HashSet<string> results, string path)
    {
        try
        {
            if (File.Exists(path))
                results.Add(Path.GetFullPath(path));
        }
        catch
        {
            // Ignore inaccessible candidates.
        }
    }

    private static void TryReadCustomDataDirectory(string profileDirectory, HashSet<string> results)
    {
        try
        {
            var prefsPath = Path.Combine(profileDirectory, "prefs.js");
            if (!File.Exists(prefsPath))
                return;

            var text = File.ReadAllText(prefsPath);
            var match = Regex.Match(text, "user_pref\\(\\\"extensions\\.zotero\\.dataDir\\\",\\s*\\\"(?<path>.*?)\\\"\\);");
            if (!match.Success)
                return;

            var value = Regex.Unescape(match.Groups["path"].Value.Replace("\\\\", "\\", StringComparison.Ordinal));
            AddCandidate(results, Path.Combine(value, "zotero.sqlite"));
        }
        catch
        {
            // A malformed profile should not block startup.
        }
    }

    private sealed record AttachmentSchema(string ParentColumn, string ContentColumn);
}
