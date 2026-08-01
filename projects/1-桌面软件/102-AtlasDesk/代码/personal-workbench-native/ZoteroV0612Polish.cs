using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace PersonalWorkbench;

public partial class ZoteroLibraryControl
{
    private bool _v0612DetailsAttached;

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

        ItemsList.SelectionChanged += (_, _) => QueueCompactAuthorRefresh();
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
