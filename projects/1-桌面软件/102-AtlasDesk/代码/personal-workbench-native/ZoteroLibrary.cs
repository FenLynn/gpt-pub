using Microsoft.Data.Sqlite;
using System.Collections.ObjectModel;
using System.IO;
using System.Net;
using System.Text.RegularExpressions;

namespace PersonalWorkbench;

public enum ZoteroScopeKind
{
    All,
    Recent,
    Unfiled,
    Collection
}

public enum ZoteroSortMode
{
    ModifiedDescending,
    AddedDescending,
    YearDescending,
    TitleAscending
}

public sealed class ZoteroCollectionNode
{
    public string NodeKey { get; init; } = string.Empty;
    public long? CollectionId { get; init; }
    public ZoteroScopeKind Scope { get; init; }
    public string Name { get; init; } = string.Empty;
    public int Count { get; set; }
    public ObservableCollection<ZoteroCollectionNode> Children { get; } = new();
    public string DisplayName => Count >= 0 ? $"{Name}  {Count}" : Name;
}

public sealed class ZoteroSearchRequest
{
    public string Query { get; init; } = string.Empty;
    public ZoteroScopeKind Scope { get; init; } = ZoteroScopeKind.All;
    public long? CollectionId { get; init; }
    public string ItemType { get; init; } = string.Empty;
    public bool PdfOnly { get; init; }
    public ZoteroSortMode Sort { get; init; } = ZoteroSortMode.ModifiedDescending;
    public int Limit { get; init; } = 250;
}

public sealed class ZoteroLibrarySnapshot
{
    public int ItemCount { get; init; }
    public int CollectionCount { get; init; }
    public string SchemaVersion { get; init; } = string.Empty;
    public IReadOnlyList<ZoteroCollectionNode> Roots { get; init; } = Array.Empty<ZoteroCollectionNode>();
}

public sealed class ZoteroCreatorInfo
{
    public string Name { get; init; } = string.Empty;
    public string Role { get; init; } = string.Empty;
    public string Display => string.IsNullOrWhiteSpace(Role) ? Name : $"{Name} · {Role}";
}

public sealed class ZoteroFieldInfo
{
    public string Name { get; init; } = string.Empty;
    public string Label { get; init; } = string.Empty;
    public string Value { get; init; } = string.Empty;
}

public sealed class ZoteroAttachmentInfo
{
    public long ItemId { get; init; }
    public string Key { get; init; } = string.Empty;
    public string Title { get; init; } = string.Empty;
    public string ContentType { get; init; } = string.Empty;
    public string RawPath { get; init; } = string.Empty;
    public string ResolvedPath { get; init; } = string.Empty;
    public bool Exists => File.Exists(ResolvedPath);
    public bool IsPdf => ContentType.Equals("application/pdf", StringComparison.OrdinalIgnoreCase)
                         || RawPath.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)
                         || ResolvedPath.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase);
    public string DisplayTitle => string.IsNullOrWhiteSpace(Title)
        ? (!string.IsNullOrWhiteSpace(ResolvedPath) ? Path.GetFileName(ResolvedPath) : "附件")
        : Title;
    public string Status => Exists ? (IsPdf ? "PDF · 本地可用" : "本地可用") : "文件缺失或尚未同步";
}

public sealed class ZoteroNoteInfo
{
    public long ItemId { get; init; }
    public string Text { get; init; } = string.Empty;
    public string DateModified { get; init; } = string.Empty;
}

public sealed class ZoteroTagInfo
{
    public string Name { get; init; } = string.Empty;
    public bool IsAutomatic { get; init; }
    public string Display => IsAutomatic ? Name + " · 自动" : Name;
}

public sealed class ZoteroItemDetails
{
    public ZoteroRecord Record { get; init; } = new();
    public IReadOnlyList<ZoteroCreatorInfo> Creators { get; init; } = Array.Empty<ZoteroCreatorInfo>();
    public IReadOnlyList<ZoteroFieldInfo> Fields { get; init; } = Array.Empty<ZoteroFieldInfo>();
    public IReadOnlyList<ZoteroAttachmentInfo> Attachments { get; init; } = Array.Empty<ZoteroAttachmentInfo>();
    public IReadOnlyList<ZoteroNoteInfo> Notes { get; init; } = Array.Empty<ZoteroNoteInfo>();
    public IReadOnlyList<ZoteroTagInfo> Tags { get; init; } = Array.Empty<ZoteroTagInfo>();
    public IReadOnlyList<string> Collections { get; init; } = Array.Empty<string>();
}

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
    public string DateAdded { get; init; } = string.Empty;
    public string DateModified { get; init; } = string.Empty;
    public string AttachmentPath { get; init; } = string.Empty;
    public string AttachmentKey { get; init; } = string.Empty;
    public string ResolvedPdfPath { get; init; } = string.Empty;
    public int AttachmentCount { get; init; }
    public int NoteCount { get; init; }
    public string TagsPreview { get; init; } = string.Empty;

    public string DisplayTitle => string.IsNullOrWhiteSpace(Title) ? "（无标题）" : Title;
    public bool HasPdf => !string.IsNullOrWhiteSpace(ResolvedPdfPath);
    public string PdfMark => HasPdf ? "PDF" : string.Empty;
    public string ItemTypeLabel => ZoteroLibrary.GetItemTypeLabel(ItemType);
}

public static class ZoteroLibrary
{
    private static readonly IReadOnlyDictionary<string, string> FieldLabels = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["title"] = "标题", ["shortTitle"] = "短标题", ["date"] = "日期", ["publicationTitle"] = "期刊",
        ["journalAbbreviation"] = "期刊缩写", ["proceedingsTitle"] = "会议录", ["conferenceName"] = "会议",
        ["bookTitle"] = "书名", ["publisher"] = "出版社", ["place"] = "出版地", ["university"] = "学校",
        ["thesisType"] = "学位类型", ["volume"] = "卷", ["issue"] = "期", ["pages"] = "页码",
        ["DOI"] = "DOI", ["ISBN"] = "ISBN", ["ISSN"] = "ISSN", ["url"] = "网址",
        ["accessDate"] = "访问日期", ["language"] = "语言", ["rights"] = "权利", ["extra"] = "Extra",
        ["abstractNote"] = "摘要", ["reportNumber"] = "报告编号", ["patentNumber"] = "专利号",
        ["archive"] = "档案馆", ["archiveLocation"] = "馆藏位置", ["libraryCatalog"] = "Library Catalog",
        ["series"] = "系列", ["seriesNumber"] = "系列编号", ["edition"] = "版本", ["institution"] = "机构"
    };

    private static readonly IReadOnlyDictionary<string, string> ItemTypeLabels = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["journalArticle"] = "期刊论文", ["conferencePaper"] = "会议论文", ["book"] = "图书",
        ["bookSection"] = "图书章节", ["thesis"] = "学位论文", ["report"] = "报告",
        ["patent"] = "专利", ["webpage"] = "网页", ["preprint"] = "预印本", ["manuscript"] = "手稿",
        ["magazineArticle"] = "杂志文章", ["newspaperArticle"] = "报纸文章", ["presentation"] = "演示文稿",
        ["computerProgram"] = "软件", ["dataset"] = "数据集", ["document"] = "文档", ["letter"] = "信件"
    };

    public static string GetItemTypeLabel(string itemType) => ItemTypeLabels.TryGetValue(itemType ?? string.Empty, out var label) ? label : itemType;

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

    public static async Task<ZoteroLibrarySnapshot> ReadSnapshotAsync(string databasePath)
    {
        await using var connection = await OpenReadOnlyAsync(databasePath);
        var deletedPredicate = await TableExistsAsync(connection, "deletedItems")
            ? "AND NOT EXISTS (SELECT 1 FROM deletedItems d WHERE d.itemID=i.itemID)"
            : string.Empty;

        var itemCount = await ExecuteScalarIntAsync(connection, $@"
            SELECT COUNT(*) FROM items i
            JOIN itemTypes it ON it.itemTypeID=i.itemTypeID
            WHERE it.typeName NOT IN ('attachment','note','annotation') {deletedPredicate};");

        var collectionRows = new List<(long Id, string Key, string Name, long? Parent, int Count)>();
        if (await TableExistsAsync(connection, "collections") && await TableExistsAsync(connection, "collectionItems"))
        {
            await using var command = connection.CreateCommand();
            command.CommandText = $@"
                SELECT c.collectionID, COALESCE(c.key,''), COALESCE(c.collectionName,''), c.parentCollectionID,
                       (SELECT COUNT(*) FROM collectionItems ci
                        JOIN items i ON i.itemID=ci.itemID
                        JOIN itemTypes it ON it.itemTypeID=i.itemTypeID
                        WHERE ci.collectionID=c.collectionID
                          AND it.typeName NOT IN ('attachment','note','annotation')
                          {deletedPredicate.Replace("i.itemID", "i.itemID", StringComparison.Ordinal)}) AS itemCount
                FROM collections c
                ORDER BY LOWER(c.collectionName);";
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                collectionRows.Add((
                    reader.GetInt64(0), reader.GetString(1), reader.GetString(2),
                    reader.IsDBNull(3) ? null : reader.GetInt64(3), reader.GetInt32(4)));
            }
        }

        var roots = BuildCollectionTree(collectionRows, itemCount);
        return new ZoteroLibrarySnapshot
        {
            ItemCount = itemCount,
            CollectionCount = collectionRows.Count,
            SchemaVersion = await ReadSchemaVersionAsync(connection),
            Roots = roots
        };
    }

    public static async Task<IReadOnlyList<ZoteroRecord>> SearchAsync(string databasePath, string? query, int limit = 200)
        => await SearchAsync(databasePath, new ZoteroSearchRequest { Query = query ?? string.Empty, Limit = limit });

    public static async Task<IReadOnlyList<ZoteroRecord>> SearchAsync(string databasePath, ZoteroSearchRequest request)
    {
        await using var connection = await OpenReadOnlyAsync(databasePath);
        var creatorSql = await BuildCreatorCteAsync(connection);
        var attachment = await GetAttachmentSchemaAsync(connection);
        var noteParent = await GetNoteParentColumnAsync(connection);
        var deletedJoin = await TableExistsAsync(connection, "deletedItems")
            ? "LEFT JOIN deletedItems deleted ON deleted.itemID = i.itemID"
            : string.Empty;
        var deletedFilter = string.IsNullOrEmpty(deletedJoin) ? string.Empty : "AND deleted.itemID IS NULL";

        var attachmentSelect = attachment is null
            ? "'' AS attachmentPath, '' AS attachmentKey, 0 AS attachmentCount"
            : $@"COALESCE((
                    SELECT ia.path FROM itemAttachments ia JOIN items ai ON ai.itemID=ia.itemID
                    WHERE ia.{attachment.ParentColumn}=i.itemID
                      AND (LOWER(COALESCE(ia.{attachment.ContentColumn},''))='application/pdf' OR LOWER(COALESCE(ia.path,'')) LIKE '%.pdf')
                    ORDER BY ia.itemID LIMIT 1), '') AS attachmentPath,
                COALESCE((
                    SELECT ai.key FROM itemAttachments ia JOIN items ai ON ai.itemID=ia.itemID
                    WHERE ia.{attachment.ParentColumn}=i.itemID
                      AND (LOWER(COALESCE(ia.{attachment.ContentColumn},''))='application/pdf' OR LOWER(COALESCE(ia.path,'')) LIKE '%.pdf')
                    ORDER BY ia.itemID LIMIT 1), '') AS attachmentKey,
                (SELECT COUNT(*) FROM itemAttachments ia WHERE ia.{attachment.ParentColumn}=i.itemID) AS attachmentCount";

        var noteCountSelect = string.IsNullOrWhiteSpace(noteParent)
            ? "0 AS noteCount"
            : $"(SELECT COUNT(*) FROM itemNotes n WHERE n.{noteParent}=i.itemID) AS noteCount";

        var tagsSelect = await TableExistsAsync(connection, "itemTags") && await TableExistsAsync(connection, "tags")
            ? "COALESCE((SELECT GROUP_CONCAT(t.name, ', ') FROM itemTags itg JOIN tags t ON t.tagID=itg.tagID WHERE itg.itemID=i.itemID LIMIT 6),'') AS tagsPreview"
            : "'' AS tagsPreview";

        var scopeWhere = request.Scope switch
        {
            ZoteroScopeKind.Collection when request.CollectionId.HasValue => "AND EXISTS (SELECT 1 FROM collectionItems ci WHERE ci.itemID=i.itemID AND ci.collectionID=@collectionId)",
            ZoteroScopeKind.Unfiled => "AND NOT EXISTS (SELECT 1 FROM collectionItems ci WHERE ci.itemID=i.itemID)",
            _ => string.Empty
        };
        var typeWhere = string.IsNullOrWhiteSpace(request.ItemType) ? string.Empty : "AND i.itemType=@itemType";
        var pdfWhere = request.PdfOnly && attachment is not null
            ? $"AND EXISTS (SELECT 1 FROM itemAttachments ia WHERE ia.{attachment.ParentColumn}=i.itemID AND (LOWER(COALESCE(ia.{attachment.ContentColumn},''))='application/pdf' OR LOWER(COALESCE(ia.path,'')) LIKE '%.pdf'))"
            : string.Empty;
        var orderBy = request.Scope == ZoteroScopeKind.Recent
            ? "i.dateAdded DESC"
            : request.Sort switch
            {
                ZoteroSortMode.AddedDescending => "i.dateAdded DESC",
                ZoteroSortMode.YearDescending => "i.itemDate DESC, i.dateModified DESC",
                ZoteroSortMode.TitleAscending => "LOWER(i.title) ASC",
                _ => "i.dateModified DESC"
            };
        var limitSql = request.Limit > 0 ? "LIMIT @limit" : string.Empty;

        var sql = $@"
WITH
{creatorSql},
metadata AS (
    SELECT i.itemID, i.key, it.typeName AS itemType, i.dateAdded, i.dateModified,
           MAX(CASE WHEN f.fieldName='title' THEN v.value END) AS title,
           MAX(CASE WHEN f.fieldName='date' THEN v.value END) AS itemDate,
           MAX(CASE WHEN f.fieldName='DOI' THEN v.value END) AS doi,
           MAX(CASE WHEN f.fieldName IN ('publicationTitle','proceedingsTitle','bookTitle','websiteTitle','conferenceName','university','institution') THEN v.value END) AS publication,
           MAX(CASE WHEN f.fieldName='abstractNote' THEN v.value END) AS abstractNote
    FROM items i
    JOIN itemTypes it ON it.itemTypeID=i.itemTypeID
    LEFT JOIN itemData d ON d.itemID=i.itemID
    LEFT JOIN fields f ON f.fieldID=d.fieldID
    LEFT JOIN itemDataValues v ON v.valueID=d.valueID
    {deletedJoin}
    WHERE it.typeName NOT IN ('attachment','note','annotation') {deletedFilter}
    GROUP BY i.itemID, i.key, it.typeName, i.dateAdded, i.dateModified
)
SELECT i.itemID, i.key, i.itemType, COALESCE(i.title,''), COALESCE(a.authors,''),
       COALESCE(i.itemDate,''), COALESCE(i.publication,''), COALESCE(i.doi,''),
       COALESCE(i.abstractNote,''), COALESCE(i.dateAdded,''), COALESCE(i.dateModified,''),
       {attachmentSelect}, {noteCountSelect}, {tagsSelect}
FROM metadata i
LEFT JOIN authors a ON a.itemID=i.itemID
WHERE (@query=''
       OR LOWER(COALESCE(i.title,'')) LIKE @like
       OR LOWER(COALESCE(a.authors,'')) LIKE @like
       OR LOWER(COALESCE(i.publication,'')) LIKE @like
       OR LOWER(COALESCE(i.doi,'')) LIKE @like
       OR LOWER(COALESCE(i.abstractNote,'')) LIKE @like
       OR LOWER(COALESCE(tagsPreview,'')) LIKE @like)
  {scopeWhere} {typeWhere} {pdfWhere}
ORDER BY {orderBy}
{limitSql};";

        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        var normalized = (request.Query ?? string.Empty).Trim().ToLowerInvariant();
        command.Parameters.AddWithValue("@query", normalized);
        command.Parameters.AddWithValue("@like", "%" + normalized + "%");
        if (request.CollectionId.HasValue)
            command.Parameters.AddWithValue("@collectionId", request.CollectionId.Value);
        if (!string.IsNullOrWhiteSpace(request.ItemType))
            command.Parameters.AddWithValue("@itemType", request.ItemType);
        if (request.Limit > 0)
            command.Parameters.AddWithValue("@limit", Math.Clamp(request.Limit, 1, 200000));

        var records = new List<ZoteroRecord>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var rawDate = reader.GetString(5);
            var attachmentPath = reader.GetString(11);
            var attachmentKey = reader.GetString(12);
            records.Add(new ZoteroRecord
            {
                ItemId = reader.GetInt64(0), Key = reader.GetString(1), ItemType = reader.GetString(2),
                Title = reader.GetString(3), Authors = reader.GetString(4), Year = ExtractYear(rawDate),
                Publication = reader.GetString(6), Doi = reader.GetString(7), Abstract = reader.GetString(8),
                DateAdded = reader.GetString(9), DateModified = reader.GetString(10),
                AttachmentPath = attachmentPath, AttachmentKey = attachmentKey,
                ResolvedPdfPath = ResolveAttachmentPath(databasePath, attachmentPath, attachmentKey),
                AttachmentCount = reader.GetInt32(13), NoteCount = reader.GetInt32(14), TagsPreview = reader.GetString(15)
            });
        }
        return records;
    }

    public static async Task<ZoteroItemDetails> ReadItemDetailsAsync(string databasePath, ZoteroRecord record)
    {
        await using var connection = await OpenReadOnlyAsync(databasePath);
        var fields = await ReadFieldsAsync(connection, record.ItemId);
        var creators = await ReadCreatorsAsync(connection, record.ItemId);
        var attachments = await ReadAttachmentsAsync(connection, databasePath, record.ItemId);
        var notes = await ReadNotesAsync(connection, record.ItemId);
        var tags = await ReadTagsAsync(connection, record.ItemId);
        var collections = await ReadItemCollectionsAsync(connection, record.ItemId);
        return new ZoteroItemDetails
        {
            Record = record, Fields = fields, Creators = creators, Attachments = attachments,
            Notes = notes, Tags = tags, Collections = collections
        };
    }

    private static async Task<SqliteConnection> OpenReadOnlyAsync(string databasePath)
    {
        if (string.IsNullOrWhiteSpace(databasePath) || !File.Exists(databasePath))
            throw new FileNotFoundException("未找到 Zotero 数据库。", databasePath);
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = databasePath, Mode = SqliteOpenMode.ReadOnly, Cache = SqliteCacheMode.Shared, Pooling = false
        }.ToString());
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA query_only=ON; PRAGMA busy_timeout=3000;";
        await command.ExecuteNonQueryAsync();
        return connection;
    }

    private static IReadOnlyList<ZoteroCollectionNode> BuildCollectionTree(
        IReadOnlyList<(long Id, string Key, string Name, long? Parent, int Count)> rows, int itemCount)
    {
        var map = rows.ToDictionary(row => row.Id, row => new ZoteroCollectionNode
        {
            NodeKey = "collection:" + row.Id, CollectionId = row.Id, Scope = ZoteroScopeKind.Collection,
            Name = string.IsNullOrWhiteSpace(row.Name) ? "未命名分类" : row.Name, Count = row.Count
        });
        var roots = new List<ZoteroCollectionNode>
        {
            new() { NodeKey="all", Scope=ZoteroScopeKind.All, Name="全部文献", Count=itemCount },
            new() { NodeKey="recent", Scope=ZoteroScopeKind.Recent, Name="最近添加", Count=-1 },
            new() { NodeKey="unfiled", Scope=ZoteroScopeKind.Unfiled, Name="未分类文献", Count=-1 }
        };
        foreach (var row in rows)
        {
            var node = map[row.Id];
            if (row.Parent.HasValue && map.TryGetValue(row.Parent.Value, out var parent))
                parent.Children.Add(node);
            else
                roots.Add(node);
        }
        SortCollectionChildren(roots);
        return roots;
    }

    private static void SortCollectionChildren(IEnumerable<ZoteroCollectionNode> nodes)
    {
        foreach (var node in nodes)
        {
            var sorted = node.Children.OrderBy(child => child.Name, StringComparer.CurrentCultureIgnoreCase).ToArray();
            node.Children.Clear();
            foreach (var child in sorted) node.Children.Add(child);
            SortCollectionChildren(node.Children);
        }
    }

    private static async Task<IReadOnlyList<ZoteroFieldInfo>> ReadFieldsAsync(SqliteConnection connection, long itemId)
    {
        var result = new List<ZoteroFieldInfo>();
        await using var command = connection.CreateCommand();
        command.CommandText = @"SELECT f.fieldName, COALESCE(v.value,'') FROM itemData d
                                JOIN fields f ON f.fieldID=d.fieldID
                                JOIN itemDataValues v ON v.valueID=d.valueID
                                WHERE d.itemID=@id ORDER BY f.fieldName;";
        command.Parameters.AddWithValue("@id", itemId);
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var name = reader.GetString(0);
            var value = reader.GetString(1);
            if (string.IsNullOrWhiteSpace(value) || name.Equals("abstractNote", StringComparison.OrdinalIgnoreCase))
                continue;
            result.Add(new ZoteroFieldInfo { Name=name, Label=FieldLabels.TryGetValue(name, out var label) ? label : name, Value=value });
        }
        return result;
    }

    private static async Task<IReadOnlyList<ZoteroCreatorInfo>> ReadCreatorsAsync(SqliteConnection connection, long itemId)
    {
        if (!await TableExistsAsync(connection, "itemCreators") || !await TableExistsAsync(connection, "creators"))
            return Array.Empty<ZoteroCreatorInfo>();
        var modern = await TableExistsAsync(connection, "creatorData") && await ColumnExistsAsync(connection, "creators", "creatorDataID");
        var hasTypes = await TableExistsAsync(connection, "creatorTypes");
        var nameExpression = modern
            ? "TRIM(COALESCE(cd.firstName,'') || CASE WHEN COALESCE(cd.firstName,'')<>'' AND COALESCE(cd.lastName,'')<>'' THEN ' ' ELSE '' END || COALESCE(cd.lastName,''))"
            : "TRIM(COALESCE(c.firstName,'') || CASE WHEN COALESCE(c.firstName,'')<>'' AND COALESCE(c.lastName,'')<>'' THEN ' ' ELSE '' END || COALESCE(c.lastName,''))";
        var joins = modern ? "JOIN creatorData cd ON cd.creatorDataID=c.creatorDataID" : string.Empty;
        var typeJoin = hasTypes ? "LEFT JOIN creatorTypes ct ON ct.creatorTypeID=ic.creatorTypeID" : string.Empty;
        var typeSelect = hasTypes ? "COALESCE(ct.creatorType,'')" : "''";
        await using var command = connection.CreateCommand();
        command.CommandText = $@"SELECT {nameExpression}, {typeSelect}
                                 FROM itemCreators ic JOIN creators c ON c.creatorID=ic.creatorID
                                 {joins} {typeJoin}
                                 WHERE ic.itemID=@id ORDER BY ic.orderIndex;";
        command.Parameters.AddWithValue("@id", itemId);
        var result = new List<ZoteroCreatorInfo>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            result.Add(new ZoteroCreatorInfo { Name=reader.GetString(0), Role=GetCreatorRoleLabel(reader.GetString(1)) });
        return result;
    }

    private static async Task<IReadOnlyList<ZoteroAttachmentInfo>> ReadAttachmentsAsync(SqliteConnection connection, string databasePath, long itemId)
    {
        var schema = await GetAttachmentSchemaAsync(connection);
        if (schema is null) return Array.Empty<ZoteroAttachmentInfo>();
        var titleSelect = await TableExistsAsync(connection, "itemData")
            ? "COALESCE((SELECT v.value FROM itemData d JOIN fields f ON f.fieldID=d.fieldID JOIN itemDataValues v ON v.valueID=d.valueID WHERE d.itemID=ia.itemID AND f.fieldName='title' LIMIT 1),'')"
            : "''";
        await using var command = connection.CreateCommand();
        command.CommandText = $@"SELECT ia.itemID, COALESCE(ai.key,''), {titleSelect},
                                        COALESCE(ia.{schema.ContentColumn},''), COALESCE(ia.path,'')
                                 FROM itemAttachments ia JOIN items ai ON ai.itemID=ia.itemID
                                 WHERE ia.{schema.ParentColumn}=@id ORDER BY ia.itemID;";
        command.Parameters.AddWithValue("@id", itemId);
        var result = new List<ZoteroAttachmentInfo>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var key=reader.GetString(1); var raw=reader.GetString(4);
            result.Add(new ZoteroAttachmentInfo
            {
                ItemId=reader.GetInt64(0), Key=key, Title=reader.GetString(2), ContentType=reader.GetString(3),
                RawPath=raw, ResolvedPath=ResolveAttachmentPath(databasePath, raw, key)
            });
        }
        return result;
    }

    private static async Task<IReadOnlyList<ZoteroNoteInfo>> ReadNotesAsync(SqliteConnection connection, long itemId)
    {
        var parent = await GetNoteParentColumnAsync(connection);
        if (string.IsNullOrWhiteSpace(parent)) return Array.Empty<ZoteroNoteInfo>();
        await using var command = connection.CreateCommand();
        command.CommandText = $@"SELECT n.itemID, COALESCE(n.note,''), COALESCE(i.dateModified,'')
                                 FROM itemNotes n JOIN items i ON i.itemID=n.itemID
                                 WHERE n.{parent}=@id ORDER BY i.dateModified DESC;";
        command.Parameters.AddWithValue("@id", itemId);
        var result = new List<ZoteroNoteInfo>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            result.Add(new ZoteroNoteInfo { ItemId=reader.GetInt64(0), Text=PlainTextFromHtml(reader.GetString(1)), DateModified=reader.GetString(2) });
        return result;
    }

    private static async Task<IReadOnlyList<ZoteroTagInfo>> ReadTagsAsync(SqliteConnection connection, long itemId)
    {
        if (!await TableExistsAsync(connection, "itemTags") || !await TableExistsAsync(connection, "tags"))
            return Array.Empty<ZoteroTagInfo>();
        var typeColumn = await ColumnExistsAsync(connection, "itemTags", "type") ? "itg.type"
            : await ColumnExistsAsync(connection, "tags", "type") ? "t.type" : "0";
        await using var command = connection.CreateCommand();
        command.CommandText = $@"SELECT COALESCE(t.name,''), COALESCE({typeColumn},0)
                                 FROM itemTags itg JOIN tags t ON t.tagID=itg.tagID
                                 WHERE itg.itemID=@id ORDER BY LOWER(t.name);";
        command.Parameters.AddWithValue("@id", itemId);
        var result = new List<ZoteroTagInfo>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            result.Add(new ZoteroTagInfo { Name=reader.GetString(0), IsAutomatic=reader.GetInt32(1) != 0 });
        return result;
    }

    private static async Task<IReadOnlyList<string>> ReadItemCollectionsAsync(SqliteConnection connection, long itemId)
    {
        if (!await TableExistsAsync(connection, "collectionItems") || !await TableExistsAsync(connection, "collections"))
            return Array.Empty<string>();
        await using var command = connection.CreateCommand();
        command.CommandText = @"SELECT COALESCE(c.collectionName,'') FROM collectionItems ci
                                JOIN collections c ON c.collectionID=ci.collectionID
                                WHERE ci.itemID=@id ORDER BY LOWER(c.collectionName);";
        command.Parameters.AddWithValue("@id", itemId);
        var result = new List<string>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync()) result.Add(reader.GetString(0));
        return result;
    }

    private static async Task<string> BuildCreatorCteAsync(SqliteConnection connection)
    {
        if (!await TableExistsAsync(connection, "itemCreators") || !await TableExistsAsync(connection, "creators"))
            return "authors AS (SELECT NULL AS itemID, '' AS authors WHERE 0)";
        if (await ColumnExistsAsync(connection, "creators", "firstName") && await ColumnExistsAsync(connection, "creators", "lastName"))
            return @"authors AS (SELECT ic.itemID, GROUP_CONCAT(TRIM(COALESCE(c.firstName,'') || CASE WHEN COALESCE(c.firstName,'')<>'' AND COALESCE(c.lastName,'')<>'' THEN ' ' ELSE '' END || COALESCE(c.lastName,'')), ', ') AS authors FROM itemCreators ic JOIN creators c ON c.creatorID=ic.creatorID GROUP BY ic.itemID)";
        if (await TableExistsAsync(connection, "creatorData") && await ColumnExistsAsync(connection, "creators", "creatorDataID"))
            return @"authors AS (SELECT ic.itemID, GROUP_CONCAT(TRIM(COALESCE(cd.firstName,'') || CASE WHEN COALESCE(cd.firstName,'')<>'' AND COALESCE(cd.lastName,'')<>'' THEN ' ' ELSE '' END || COALESCE(cd.lastName,'')), ', ') AS authors FROM itemCreators ic JOIN creators c ON c.creatorID=ic.creatorID JOIN creatorData cd ON cd.creatorDataID=c.creatorDataID GROUP BY ic.itemID)";
        return "authors AS (SELECT NULL AS itemID, '' AS authors WHERE 0)";
    }

    private static async Task<AttachmentSchema?> GetAttachmentSchemaAsync(SqliteConnection connection)
    {
        if (!await TableExistsAsync(connection, "itemAttachments") || !await ColumnExistsAsync(connection, "itemAttachments", "path")) return null;
        var parent = await ColumnExistsAsync(connection, "itemAttachments", "parentItemID") ? "parentItemID"
            : await ColumnExistsAsync(connection, "itemAttachments", "sourceItemID") ? "sourceItemID" : string.Empty;
        var content = await ColumnExistsAsync(connection, "itemAttachments", "contentType") ? "contentType"
            : await ColumnExistsAsync(connection, "itemAttachments", "mimeType") ? "mimeType" : string.Empty;
        return string.IsNullOrEmpty(parent) || string.IsNullOrEmpty(content) ? null : new AttachmentSchema(parent, content);
    }

    private static async Task<string> GetNoteParentColumnAsync(SqliteConnection connection)
    {
        if (!await TableExistsAsync(connection, "itemNotes")) return string.Empty;
        if (await ColumnExistsAsync(connection, "itemNotes", "parentItemID")) return "parentItemID";
        if (await ColumnExistsAsync(connection, "itemNotes", "sourceItemID")) return "sourceItemID";
        return string.Empty;
    }

    private static async Task<string> ReadSchemaVersionAsync(SqliteConnection connection)
    {
        if (!await TableExistsAsync(connection, "version")) return string.Empty;
        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT schema || ' ' || version FROM version ORDER BY schema LIMIT 1";
            return Convert.ToString(await command.ExecuteScalarAsync()) ?? string.Empty;
        }
        catch { return string.Empty; }
    }

    private static async Task<int> ExecuteScalarIntAsync(SqliteConnection connection, string sql)
    {
        await using var command = connection.CreateCommand(); command.CommandText=sql;
        return Convert.ToInt32(await command.ExecuteScalarAsync() ?? 0);
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
        while (await reader.ReadAsync()) if (string.Equals(reader.GetString(1), column, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    public static string ResolveAttachmentPath(string databasePath, string rawPath, string attachmentKey)
    {
        if (string.IsNullOrWhiteSpace(rawPath)) return string.Empty;
        if (rawPath.StartsWith("storage:", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(attachmentKey))
        {
            var relative = rawPath["storage:".Length..].Replace('/', Path.DirectorySeparatorChar);
            var resolved = Path.Combine(Path.GetDirectoryName(databasePath) ?? string.Empty, "storage", attachmentKey, relative);
            return File.Exists(resolved) ? resolved : string.Empty;
        }
        if (Path.IsPathRooted(rawPath)) return File.Exists(rawPath) ? rawPath : string.Empty;
        return string.Empty;
    }

    private static string ExtractYear(string value)
    {
        var match = Regex.Match(value ?? string.Empty, @"(?<!\d)(18|19|20|21)\d{2}(?!\d)");
        return match.Success ? match.Value : string.Empty;
    }

    private static string PlainTextFromHtml(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var text = Regex.Replace(value, "<br\\s*/?>", "\n", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, "</p>|</div>|</li>", "\n", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, "<[^>]+>", string.Empty);
        return WebUtility.HtmlDecode(text).Trim();
    }

    private static string GetCreatorRoleLabel(string role) => role switch
    {
        "author" => "作者", "editor" => "编辑", "translator" => "译者", "contributor" => "贡献者",
        "inventor" => "发明人", "director" => "导演", "programmer" => "程序员", "artist" => "艺术家",
        "bookAuthor" => "书籍作者", "reviewedAuthor" => "被评作者", "recipient" => "收件人", _ => role
    };

    private static void AddCandidate(HashSet<string> results, string path)
    {
        try { if (File.Exists(path)) results.Add(Path.GetFullPath(path)); } catch { }
    }

    private static void TryReadCustomDataDirectory(string profileDirectory, HashSet<string> results)
    {
        try
        {
            var prefsPath = Path.Combine(profileDirectory, "prefs.js");
            if (!File.Exists(prefsPath)) return;
            var text = File.ReadAllText(prefsPath);
            var match = Regex.Match(text, "user_pref\\(\\\"extensions\\.zotero\\.dataDir\\\",\\s*\\\"(?<path>.*?)\\\"\\);");
            if (!match.Success) return;
            var value = Regex.Unescape(match.Groups["path"].Value.Replace("\\\\", "\\", StringComparison.Ordinal));
            AddCandidate(results, Path.Combine(value, "zotero.sqlite"));
        }
        catch { }
    }

    private sealed record AttachmentSchema(string ParentColumn, string ContentColumn);
}
