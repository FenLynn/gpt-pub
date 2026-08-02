using Microsoft.Win32;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace PersonalWorkbench;

public partial class ZoteroLibraryControl : UserControl
{
    private readonly AppSettings _settings;
    private readonly SemaphoreSlim _databaseGate = new(1, 1);
    private bool _loaded;
    private bool _busy;
    private long _listRequestVersion;
    private long _detailRequestVersion;
    private ZoteroCollectionNode? _scope;
    private ZoteroRecord? _selectedRecord;
    private ZoteroItemDetails? _selectedDetails;

    public event EventHandler? OpenSettingsRequested;

    public ZoteroLibraryControl() : this(AppSettings.Load()) { }

    public ZoteroLibraryControl(AppSettings settings)
    {
        _settings = settings;
        InitializeComponent();
        UpdateModeBadge();

        // Database access is deliberately not bound to IsVisibleChanged. The control
        // is reparented while the feature pipeline is assembled, and visibility changes
        // must never start SQLite work. WorkbenchEnhancer explicitly loads the library
        // only after the user selects the Library navigation item.
    }

    public void InvalidateLibrary()
    {
        Interlocked.Increment(ref _listRequestVersion);
        Interlocked.Increment(ref _detailRequestVersion);
        _loaded = false;
        ItemsList.ItemsSource = null;
        CollectionTree.ItemsSource = null;
        ClearDetails();
        UpdateModeBadge();
    }

    public async Task EnsureLoadedAsync()
    {
        if (_loaded || _busy)
            return;

        if (!File.Exists(_settings.ZoteroDbPath))
        {
            FirstRunOverlay.Visibility = Visibility.Visible;
            ConnectionText.Text = "尚未连接";
            return;
        }

        await LoadSnapshotAndSearchAsync();
    }

    private async Task LoadSnapshotAndSearchAsync()
    {
        if (_busy)
            return;

        var requestVersion = Interlocked.Increment(ref _listRequestVersion);
        try
        {
            _busy = true;
            FirstRunOverlay.Visibility = Visibility.Collapsed;
            ConnectionText.Text = "正在读取…";
            ResultStatus.Text = "正在后台读取 Zotero 分类与元信息…";

            var databasePath = _settings.ZoteroDbPath;
            var snapshot = await RunDatabaseReadAsync(
                () => ZoteroLibrary.ReadSnapshotAsync(databasePath),
                CancellationToken.None);
            if (!IsCurrentListRequest(requestVersion))
                return;

            CollectionTree.ItemsSource = snapshot.Roots;
            ConnectionText.Text = $"已连接 · {snapshot.ItemCount:N0} 条";
            if (!string.IsNullOrWhiteSpace(snapshot.SchemaVersion))
                ConnectionBadge.ToolTip = "数据库版本：" + snapshot.SchemaVersion;

            _scope = snapshot.Roots.FirstOrDefault();
            var results = await QueryRecordsAsync(CancellationToken.None);
            if (!IsCurrentListRequest(requestVersion))
                return;

            ApplySearchResults(results);
            _loaded = true;
        }
        catch (Exception ex)
        {
            App.Log("Zotero library load failed: " + ex);
            ConnectionText.Text = "读取失败";
            ResultStatus.Text = "读取失败：" + ex.Message;
            FirstRunOverlay.Visibility = Visibility.Visible;
        }
        finally
        {
            _busy = false;
        }
    }

    private async Task SearchAsync()
    {
        if (!File.Exists(_settings.ZoteroDbPath) || !_loaded || _busy)
            return;

        var requestVersion = Interlocked.Increment(ref _listRequestVersion);
        try
        {
            _busy = true;
            ResultStatus.Text = "正在后台检索…";
            var results = await QueryRecordsAsync(CancellationToken.None);
            if (!IsCurrentListRequest(requestVersion))
                return;
            ApplySearchResults(results);
        }
        catch (Exception ex)
        {
            App.Log("Zotero search failed: " + ex);
            ResultStatus.Text = "检索失败：" + ex.Message;
        }
        finally
        {
            _busy = false;
        }
    }

    private async Task<IReadOnlyList<ZoteroRecord>> QueryRecordsAsync(CancellationToken cancellationToken)
    {
        var databasePath = _settings.ZoteroDbPath;
        var query = SearchBox.Text;
        var scope = _scope;
        var typeTag = (ItemTypeFilter.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? string.Empty;
        var sortTag = (SortFilter.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "modified";
        var sortMode = sortTag switch
        {
            "added" => ZoteroSortMode.AddedDescending,
            "year" => ZoteroSortMode.YearDescending,
            "title" => ZoteroSortMode.TitleAscending,
            _ => ZoteroSortMode.ModifiedDescending
        };
        var pdfOnly = PdfOnlyFilter.IsChecked == true;
        var loadFullLibrary = _settings.ZoteroLoadFullLibrary;
        var effectiveLimit = _settings.EffectiveZoteroLimit;
        var collectionIds = scope?.Scope == ZoteroScopeKind.Collection
            ? EnumerateCollectionIds(scope).Distinct().ToArray()
            : Array.Empty<long>();

        ZoteroSearchRequest CreateRequest(long? collectionId, int limit) => new()
        {
            Query = query,
            Scope = scope?.Scope ?? ZoteroScopeKind.All,
            CollectionId = collectionId,
            ItemType = typeTag,
            PdfOnly = pdfOnly,
            Sort = sortMode,
            Limit = limit
        };

        return await RunDatabaseReadAsync(async () =>
        {
            if (collectionIds.Length == 0)
            {
                return await ZoteroLibrary.SearchAsync(
                    databasePath,
                    CreateRequest(scope?.CollectionId, effectiveLimit)).ConfigureAwait(false);
            }

            // Keep one read connection active at a time. Zotero may have the live
            // database open, and parallel descendant-collection queries only increase
            // lock pressure and CPU cost without improving perceived responsiveness.
            var perCollectionLimit = loadFullLibrary ? 0 : Math.Max(effectiveLimit, 250);
            var merged = new Dictionary<long, ZoteroRecord>();
            foreach (var collectionId in collectionIds)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var batch = await ZoteroLibrary.SearchAsync(
                    databasePath,
                    CreateRequest(collectionId, perCollectionLimit)).ConfigureAwait(false);
                foreach (var record in batch)
                    merged.TryAdd(record.ItemId, record);
            }

            return SortRecords(merged.Values, sortMode)
                .Take(loadFullLibrary ? int.MaxValue : effectiveLimit)
                .ToArray();
        }, cancellationToken);
    }

    private async Task<T> RunDatabaseReadAsync<T>(
        Func<Task<T>> readOperation,
        CancellationToken cancellationToken)
    {
        await _databaseGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            return await ZoteroReadScheduler.RunAsync(readOperation, cancellationToken)
                .ConfigureAwait(false);
        }
        finally
        {
            _databaseGate.Release();
        }
    }

    private bool IsCurrentListRequest(long requestVersion) =>
        requestVersion == Volatile.Read(ref _listRequestVersion);

    private void ApplySearchResults(IReadOnlyList<ZoteroRecord> results)
    {
        ItemsList.ItemsSource = results;
        CurrentScopeText.Text = _scope?.Scope == ZoteroScopeKind.Collection && _scope.Children.Count > 0
            ? (_scope.Name + " · 含子分类")
            : (_scope?.Name ?? "全部文献");
        ResultStatus.Text = _settings.ZoteroLoadFullLibrary
            ? $"已载入 {results.Count:N0} 条 · 全量模式"
            : $"已载入 {results.Count:N0} 条 · 校准上限 {_settings.EffectiveZoteroLimit:N0}";
        if (results.Count > 0)
            ItemsList.SelectedIndex = 0;
        else
            ClearDetails();
    }

    private static IEnumerable<long> EnumerateCollectionIds(ZoteroCollectionNode node)
    {
        if (node.CollectionId.HasValue)
            yield return node.CollectionId.Value;
        foreach (var child in node.Children)
        foreach (var id in EnumerateCollectionIds(child))
            yield return id;
    }

    private static IEnumerable<ZoteroRecord> SortRecords(
        IEnumerable<ZoteroRecord> records,
        ZoteroSortMode mode)
        => mode switch
        {
            ZoteroSortMode.AddedDescending => records.OrderByDescending(
                record => record.DateAdded,
                StringComparer.OrdinalIgnoreCase),
            ZoteroSortMode.YearDescending => records.OrderByDescending(
                    record => record.Year,
                    StringComparer.OrdinalIgnoreCase)
                .ThenByDescending(record => record.DateModified, StringComparer.OrdinalIgnoreCase),
            ZoteroSortMode.TitleAscending => records.OrderBy(
                record => record.DisplayTitle,
                StringComparer.CurrentCultureIgnoreCase),
            _ => records.OrderByDescending(
                record => record.DateModified,
                StringComparer.OrdinalIgnoreCase)
        };

    private async Task LoadDetailsAsync(ZoteroRecord record)
    {
        var requestVersion = Interlocked.Increment(ref _detailRequestVersion);
        try
        {
            DetailTitle.Text = record.DisplayTitle;
            DetailAuthors.Text = record.Authors;
            DetailMeta.Text = string.Join(
                " · ",
                new[] { record.ItemTypeLabel, record.Publication, record.Year }
                    .Where(value => !string.IsNullOrWhiteSpace(value)));
            AbstractText.Text = string.IsNullOrWhiteSpace(record.Abstract) ? "暂无摘要" : record.Abstract;
            OpenPrimaryPdfButton.IsEnabled = record.HasPdf;
            CopyDoiButton.IsEnabled = !string.IsNullOrWhiteSpace(record.Doi);
            CopyTitleButton.IsEnabled = true;
            CreatorsList.ItemsSource = null;
            InfoFields.ItemsSource = null;
            AttachmentsList.ItemsSource = null;
            NotesList.ItemsSource = null;
            CollectionsList.ItemsSource = null;
            TagsPanel.Children.Clear();

            var databasePath = _settings.ZoteroDbPath;
            var details = await RunDatabaseReadAsync(
                () => ZoteroLibrary.ReadItemDetailsAsync(databasePath, record),
                CancellationToken.None);
            if (requestVersion != Volatile.Read(ref _detailRequestVersion)
                || !ReferenceEquals(_selectedRecord, record))
            {
                return;
            }

            _selectedDetails = details;
            CreatorsList.ItemsSource = details.Creators;
            InfoFields.ItemsSource = BuildInformationRows(details);
            AttachmentsList.ItemsSource = details.Attachments;
            NotesList.ItemsSource = details.Notes;
            CollectionsList.ItemsSource = details.Collections;
            RenderTags(details.Tags);
        }
        catch (Exception ex)
        {
            App.Log("Zotero details failed: " + ex);
            if (requestVersion == Volatile.Read(ref _detailRequestVersion))
            {
                InfoFields.ItemsSource = new[]
                {
                    new ZoteroFieldInfo { Label = "读取失败", Value = ex.Message }
                };
            }
        }
    }

    private static IReadOnlyList<ZoteroFieldInfo> BuildInformationRows(ZoteroItemDetails details)
    {
        var rows = new List<ZoteroFieldInfo>
        {
            new() { Label="类型", Value=details.Record.ItemTypeLabel },
            new() { Label="年份", Value=details.Record.Year },
            new() { Label="来源", Value=details.Record.Publication },
            new() { Label="DOI", Value=details.Record.Doi },
            new() { Label="添加时间", Value=details.Record.DateAdded },
            new() { Label="修改时间", Value=details.Record.DateModified },
            new() { Label="Item Key", Value=details.Record.Key }
        };
        rows.AddRange(details.Fields);
        return rows.Where(row => !string.IsNullOrWhiteSpace(row.Value)).ToArray();
    }

    private void RenderTags(IEnumerable<ZoteroTagInfo> tags)
    {
        foreach (var tag in tags)
        {
            var border = new Border
            {
                Background = tag.IsAutomatic
                    ? new SolidColorBrush(Color.FromRgb(242, 244, 248))
                    : new SolidColorBrush(Color.FromRgb(234, 242, 255)),
                CornerRadius = new CornerRadius(7),
                Padding = new Thickness(8, 4, 8, 4),
                Margin = new Thickness(0, 0, 6, 6)
            };
            border.Child = new TextBlock
            {
                Text = tag.Name,
                FontSize = 11.2,
                Foreground = tag.IsAutomatic
                    ? new SolidColorBrush(Color.FromRgb(112, 124, 141))
                    : new SolidColorBrush(Color.FromRgb(52, 101, 174))
            };
            TagsPanel.Children.Add(border);
        }
        if (TagsPanel.Children.Count == 0)
        {
            TagsPanel.Children.Add(new TextBlock
            {
                Text = "暂无标签",
                FontSize = 11.5,
                Foreground = Brushes.Gray
            });
        }
    }

    private void ClearDetails()
    {
        Interlocked.Increment(ref _detailRequestVersion);
        _selectedRecord = null;
        _selectedDetails = null;
        DetailTitle.Text = "选择一篇文献";
        DetailAuthors.Text = string.Empty;
        DetailMeta.Text = string.Empty;
        AbstractText.Text = string.Empty;
        CreatorsList.ItemsSource = null;
        InfoFields.ItemsSource = null;
        AttachmentsList.ItemsSource = null;
        NotesList.ItemsSource = null;
        CollectionsList.ItemsSource = null;
        TagsPanel.Children.Clear();
        OpenPrimaryPdfButton.IsEnabled = false;
        CopyDoiButton.IsEnabled = false;
        CopyTitleButton.IsEnabled = false;
    }

    private void UpdateModeBadge()
    {
        LoadModeText.Text = _settings.ZoteroLoadFullLibrary
            ? "全量模式"
            : $"校准模式 · {_settings.EffectiveZoteroLimit}";
    }

    private async void AutoDetect_Click(object sender, RoutedEventArgs e)
    {
        var candidates = await ZoteroReadScheduler.RunAsync(
            () => Task.FromResult(ZoteroLibrary.DetectDatabaseCandidates()),
            CancellationToken.None);
        if (candidates.Count == 0)
        {
            MessageBox.Show(
                "未自动找到 zotero.sqlite，请使用手动选择。",
                "Zotero",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            return;
        }
        _settings.ZoteroDbPath = candidates[0];
        _settings.Save();
        InvalidateLibrary();
        await EnsureLoadedAsync();
    }

    private async void ManualSelect_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "选择 Zotero 数据库",
            Filter = "Zotero 数据库 (zotero.sqlite)|zotero.sqlite|SQLite 数据库 (*.sqlite)|*.sqlite|所有文件 (*.*)|*.*",
            CheckFileExists = true,
            Multiselect = false
        };
        if (dialog.ShowDialog(Window.GetWindow(this)) != true)
            return;
        _settings.ZoteroDbPath = dialog.FileName;
        _settings.Save();
        InvalidateLibrary();
        await EnsureLoadedAsync();
    }

    private async void Refresh_Click(object sender, RoutedEventArgs e)
    {
        InvalidateLibrary();
        await EnsureLoadedAsync();
    }

    private void OpenSettings_Click(object sender, RoutedEventArgs e) =>
        OpenSettingsRequested?.Invoke(this, EventArgs.Empty);

    private async void Search_Click(object sender, RoutedEventArgs e) => await SearchAsync();

    private async void SearchBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter)
            return;
        e.Handled = true;
        await SearchAsync();
    }

    private async void Filter_Changed(object sender, RoutedEventArgs e)
    {
        if (!IsLoaded || !_loaded)
            return;
        await SearchAsync();
    }

    private async void CollectionTree_SelectedItemChanged(
        object sender,
        RoutedPropertyChangedEventArgs<object> e)
    {
        if (e.NewValue is not ZoteroCollectionNode node)
            return;
        _scope = node;
        await SearchAsync();
    }

    private async void ItemsList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        _selectedRecord = ItemsList.SelectedItem as ZoteroRecord;
        if (_selectedRecord is null)
        {
            ClearDetails();
            return;
        }
        await LoadDetailsAsync(_selectedRecord);
    }

    private void ItemsList_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (_selectedRecord?.HasPdf == true)
            OpenPdf(_selectedRecord.ResolvedPdfPath);
    }

    private void OpenPrimaryPdf_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedRecord?.HasPdf == true)
            OpenPdf(_selectedRecord.ResolvedPdfPath);
    }

    private void OpenAttachment_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: ZoteroAttachmentInfo attachment } && attachment.Exists)
            OpenPdf(attachment.ResolvedPath);
    }

    private void OpenPdf(string path)
    {
        if (!File.Exists(path))
            return;
        try
        {
            if (!_settings.UseSystemPdfReader && File.Exists(_settings.PdfReaderPath))
            {
                var info = new ProcessStartInfo(_settings.PdfReaderPath) { UseShellExecute = true };
                info.ArgumentList.Add(path);
                Process.Start(info);
            }
            else
            {
                Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
            }
        }
        catch (Exception ex)
        {
            App.Log("Open PDF failed: " + ex);
            MessageBox.Show(
                "无法打开 PDF：\n" + ex.Message,
                "AtlasDesk",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
        }
    }

    private void CopyDoi_Click(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrWhiteSpace(_selectedRecord?.Doi))
            Clipboard.SetText(_selectedRecord.Doi);
    }

    private void CopyTitle_Click(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrWhiteSpace(_selectedRecord?.Title))
            Clipboard.SetText(_selectedRecord.Title);
    }
}
