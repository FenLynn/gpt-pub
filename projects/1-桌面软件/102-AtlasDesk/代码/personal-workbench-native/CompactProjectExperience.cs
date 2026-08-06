using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace PersonalWorkbench;

internal static class CompactProjectExperience
{
    private static readonly ConditionalWeakTable<ProjectCenterControl, TextBox> ProjectSearches = new();
    private static readonly ConditionalWeakTable<HomeDashboardControl, Button> HomeRecentButtons = new();

    [ModuleInitializer]
    internal static void Initialize()
    {
        EventManager.RegisterClassHandler(
            typeof(ProjectCenterControl),
            FrameworkElement.LoadedEvent,
            new RoutedEventHandler(ProjectCenter_Loaded),
            true);
        EventManager.RegisterClassHandler(
            typeof(HomeDashboardControl),
            FrameworkElement.LoadedEvent,
            new RoutedEventHandler(HomeDashboard_Loaded),
            true);
    }

    private static void ProjectCenter_Loaded(object sender, RoutedEventArgs e)
    {
        if (sender is not ProjectCenterControl control || ProjectSearches.TryGetValue(control, out _))
            return;

        var overview = control.FindName("OverviewScroll") as ScrollViewer;
        var favorites = control.FindName("FavoriteList") as ListView;
        var commands = control.FindName("CommandList") as ListView;
        var research = control.FindName("ResearchList") as ListView;
        if (overview?.Content is not StackPanel stack
            || favorites is null
            || commands is null
            || research is null)
            return;

        var search = new TextBox
        {
            Width = 190,
            Height = 28,
            Padding = new Thickness(8, 3, 8, 3),
            FontSize = 10.5,
            VerticalContentAlignment = VerticalAlignment.Center,
            ToolTip = "搜索文件、命令或文献",
            BorderBrush = Brush("#DDE3EB"),
            Background = Brush("#FBFCFE")
        };
        ProjectSearches.Add(control, search);

        var header = new Grid { Margin = new Thickness(0, 10, 0, 5) };
        header.ColumnDefinitions.Add(new ColumnDefinition());
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.Children.Add(new TextBlock
        {
            Text = "项目资源",
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            Foreground = Brush("#304157"),
            VerticalAlignment = VerticalAlignment.Center
        });
        Grid.SetColumn(search, 1);
        header.Children.Add(search);

        var insertAt = stack.Children.IndexOf(favorites);
        stack.Children.Insert(insertAt < 0 ? Math.Min(3, stack.Children.Count) : insertAt, header);
        RenameSection(stack, "常用文件", "文件");
        RenameSection(stack, "常用命令", "命令");
        RenameSection(stack, "关联文献", "文献");

        void Apply()
        {
            var query = search.Text.Trim();
            ApplyFilter(favorites, item => item is ProjectFavoriteView favorite
                && Matches(query, favorite.Name, favorite.FullPath, favorite.ParentPath));
            ApplyFilter(commands, item => item is ProjectContextCommand command
                && Matches(query, command.Name, command.Command, command.WorkingDirectory));
            ApplyFilter(research, item => item is ProjectResearchLink link
                && Matches(query, link.Title, link.CitationKey, link.Doi));
        }

        search.TextChanged += (_, _) => Apply();
        control.ProjectSelectionChanged += (_, _) => control.Dispatcher.BeginInvoke(
            new Action(Apply),
            DispatcherPriority.Background);
        Apply();
    }

    private static void HomeDashboard_Loaded(object sender, RoutedEventArgs e)
    {
        if (sender is not HomeDashboardControl home || HomeRecentButtons.TryGetValue(home, out _))
            return;
        if (home.FindName("HomeActionPanel") is not WrapPanel actions)
            return;

        var label = new TextBlock
        {
            TextTrimming = TextTrimming.CharacterEllipsis,
            MaxWidth = 280
        };
        var button = new Button
        {
            Content = label,
            Visibility = Visibility.Collapsed,
            MinWidth = 180
        };
        button.SetResourceReference(FrameworkElement.StyleProperty, "HomeActionButton");
        button.Click += (_, _) => RaiseButtonByContent(home, "开发");
        actions.Children.Insert(0, button);
        HomeRecentButtons.Add(home, button);

        foreach (var text in FindVisualChildren<TextBlock>(home).Where(item => item.Text == "最近工作"))
            text.Text = "最近文件";

        void Refresh()
        {
            var state = ProductivityContextStore.Load();
            var root = state.Session.ProjectRoot;
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
            {
                button.Visibility = Visibility.Collapsed;
                return;
            }

            var profile = ProductivityContextStore.FindProfile(state, root);
            var projectName = profile?.EffectiveName;
            if (string.IsNullOrWhiteSpace(projectName))
                projectName = Path.GetFileName(root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            if (string.IsNullOrWhiteSpace(projectName))
                projectName = root;

            var recentName = string.IsNullOrWhiteSpace(state.Session.WorkspacePath)
                ? string.Empty
                : Path.GetFileName(state.Session.WorkspacePath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            label.Text = string.IsNullOrWhiteSpace(recentName)
                ? "最近项目 · " + projectName
                : "最近项目 · " + projectName + " · " + recentName;
            button.ToolTip = root;
            button.Visibility = Visibility.Visible;
        }

        home.IsVisibleChanged += (_, _) =>
        {
            if (home.IsVisible)
                home.Dispatcher.BeginInvoke(new Action(Refresh), DispatcherPriority.Background);
        };
        Refresh();
    }

    private static void ApplyFilter(ListView list, Predicate<object> predicate)
    {
        if (list.ItemsSource is null)
            return;
        var view = CollectionViewSource.GetDefaultView(list.ItemsSource);
        view.Filter = predicate;
        view.Refresh();
    }

    private static bool Matches(string query, params string?[] values)
        => query.Length == 0 || values.Any(value => value?.Contains(query, StringComparison.OrdinalIgnoreCase) == true);

    private static void RaiseButtonByContent(DependencyObject root, string content)
    {
        var button = FindVisualChildren<Button>(root)
            .FirstOrDefault(item => item.IsEnabled && string.Equals(item.Content as string, content, StringComparison.Ordinal));
        button?.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
    }

    private static void RenameSection(DependencyObject root, string before, string after)
    {
        var text = FindVisualChildren<TextBlock>(root).FirstOrDefault(item => item.Text == before);
        if (text is not null)
            text.Text = after;
    }

    private static IEnumerable<T> FindVisualChildren<T>(DependencyObject root) where T : DependencyObject
    {
        for (var index = 0; index < VisualTreeHelper.GetChildrenCount(root); index++)
        {
            var child = VisualTreeHelper.GetChild(root, index);
            if (child is T typed)
                yield return typed;
            foreach (var descendant in FindVisualChildren<T>(child))
                yield return descendant;
        }
    }

    private static Brush Brush(string value)
        => (Brush)new BrushConverter().ConvertFromString(value)!;
}
