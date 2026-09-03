using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace PersonalWorkbench;

public partial class ZoteroLibraryControl
{
    private bool _v0612DetailsAttached;
    private Grid? _responsiveLibraryGrid;

    internal void EnableV0612DetailPolish()
    {
        if (_v0612DetailsAttached) return;
        _v0612DetailsAttached = true;

        DetailAuthors.FontSize = 11.5;
        DetailAuthors.Foreground = new SolidColorBrush(Color.FromRgb(82, 101, 126));
        DetailAuthors.LineHeight = 18;
        DetailAuthors.Margin = new Thickness(0, 7, 0, 0);
        DetailMeta.Margin = new Thickness(0, 5, 0, 0);

        if (CreatorsList.Parent is StackPanel infoStack)
        {
            var creatorIndex = infoStack.Children.IndexOf(CreatorsList);
            if (creatorIndex > 0 && infoStack.Children[creatorIndex - 1] is TextBlock heading)
                heading.Visibility = Visibility.Collapsed;
            CreatorsList.Visibility = Visibility.Collapsed;
            if (creatorIndex + 1 < infoStack.Children.Count && infoStack.Children[creatorIndex + 1] is Border separator)
                separator.Visibility = Visibility.Collapsed;
        }

        AttachResponsiveLibraryLayout();
        ItemsList.SelectionChanged += (_, _) => QueueCompactAuthorRefresh();
    }

    private void AttachResponsiveLibraryLayout()
    {
        if (Content is not Grid root) return;
        _responsiveLibraryGrid = root.Children
            .OfType<Grid>()
            .FirstOrDefault(grid => Grid.GetRow(grid) == 2 && grid.ColumnDefinitions.Count == 5);
        if (_responsiveLibraryGrid is null) return;

        SizeChanged += (_, _) => ApplyResponsiveLibraryLayout();
        Loaded += (_, _) => ApplyResponsiveLibraryLayout();
        ApplyResponsiveLibraryLayout();
    }

    private void ApplyResponsiveLibraryLayout()
    {
        if (_responsiveLibraryGrid is null || _responsiveLibraryGrid.ColumnDefinitions.Count != 5)
            return;

        var width = ActualWidth;
        var leftWidth = width switch
        {
            < 900 => 156,
            < 1080 => 178,
            < 1240 => 196,
            _ => 220
        };
        var rightWidth = width switch
        {
            < 900 => 320,
            < 1080 => 338,
            < 1240 => 370,
            _ => 410
        };
        var gap = width < 1080 ? 5 : 7;

        _responsiveLibraryGrid.ColumnDefinitions[0].Width = new GridLength(leftWidth);
        _responsiveLibraryGrid.ColumnDefinitions[1].Width = new GridLength(gap);
        _responsiveLibraryGrid.ColumnDefinitions[3].Width = new GridLength(gap);
        _responsiveLibraryGrid.ColumnDefinitions[4].Width = new GridLength(rightWidth);

        var compact = rightWidth <= 338;
        DetailTitle.FontSize = compact ? 14.5 : 16;
        if (DetailTitle.Parent is StackPanel header)
            header.Margin = compact ? new Thickness(12, 10, 12, 9) : new Thickness(15, 13, 15, 11);
    }

    private void QueueCompactAuthorRefresh()
    {
        var selectedId = (ItemsList.SelectedItem as ZoteroRecord)?.ItemId;
        if (!selectedId.HasValue) return;
        _ = RefreshCompactAuthorsAsync(selectedId.Value);
    }

    private async Task RefreshCompactAuthorsAsync(long selectedId)
    {
        for (var attempt = 0; attempt < 40; attempt++)
        {
            if (_selectedDetails?.Record.ItemId == selectedId)
                break;
            await Task.Delay(50);
        }
        if (_selectedDetails?.Record.ItemId != selectedId || _selectedRecord?.ItemId != selectedId)
            return;

        await Dispatcher.InvokeAsync(() =>
        {
            var names = _selectedDetails.Creators
                .Select(creator => creator.Name.Trim())
                .Where(name => name.Length > 0)
                .Distinct(StringComparer.CurrentCultureIgnoreCase)
                .ToArray();
            DetailAuthors.Text = names.Length > 0
                ? string.Join("、", names)
                : _selectedRecord.Authors;
            DetailAuthors.ToolTip = DetailAuthors.Text;
            DetailMeta.Text = string.Join(" · ", new[]
            {
                _selectedRecord.ItemTypeLabel,
                _selectedRecord.Publication,
                _selectedRecord.Year
            }.Where(value => !string.IsNullOrWhiteSpace(value)));
        }, DispatcherPriority.Background);
    }
}
