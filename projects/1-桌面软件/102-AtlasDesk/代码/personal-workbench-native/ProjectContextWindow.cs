using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace PersonalWorkbench;

public sealed class ProjectContextWindow : Window
{
    private readonly ProductivityContextState _state;
    private readonly ProjectContextProfile _profile;
    private readonly TextBox _nameBox = new();
    private readonly ComboBox _shellBox = new();
    private readonly TextBox _environmentBox = new();
    private readonly TextBox _dashboardBox = new();
    private readonly TextBox _favoritesBox = new();
    private readonly TextBox _commandsBox = new();
    private readonly ListView _researchList = new();
    private readonly TextBlock _status = new();

    public ProjectContextWindow(ProductivityContextState state, ProjectContextProfile profile)
    {
        _state = state;
        _profile = profile;
        Title = "项目上下文 · " + profile.EffectiveName;
        Width = 820;
        Height = 660;
        MinWidth = 680;
        MinHeight = 520;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        Background = new SolidColorBrush(Color.FromRgb(247, 249, 252));
        FontFamily = new FontFamily("Microsoft YaHei UI");
        Content = BuildContent();
        LoadValues();
    }

    private UIElement BuildContent()
    {
        var root = new Grid { Margin = new Thickness(22) };
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(14) });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(12) });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var heading = new StackPanel();
        heading.Children.Add(new TextBlock
        {
            Text = "项目上下文",
            FontSize = 21,
            FontWeight = FontWeights.SemiBold,
            Foreground = new SolidColorBrush(Color.FromRgb(34, 48, 66))
        });
        heading.Children.Add(new TextBlock
        {
            Text = _profile.ProjectRoot,
            Margin = new Thickness(0, 5, 0, 0),
            FontSize = 11.5,
            Foreground = new SolidColorBrush(Color.FromRgb(105, 121, 142)),
            TextTrimming = TextTrimming.CharacterEllipsis
        });
        root.Children.Add(heading);

        var tabs = new TabControl
        {
            BorderThickness = new Thickness(1),
            Background = Brushes.White
        };
        tabs.Items.Add(new TabItem { Header = "启动与命令", Content = BuildProfileTab() });
        tabs.Items.Add(new TabItem { Header = "关联文献", Content = BuildResearchTab() });
        Grid.SetRow(tabs, 2);
        root.Children.Add(tabs);

        var footer = new Grid();
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _status.Text = "配置只保存在 AtlasDesk 私人 Data 中。";
        _status.FontSize = 11.2;
        _status.Foreground = new SolidColorBrush(Color.FromRgb(102, 119, 140));
        _status.VerticalAlignment = VerticalAlignment.Center;
        footer.Children.Add(_status);

        var actions = new StackPanel { Orientation = Orientation.Horizontal };
        var cancel = CreateButton("取消", secondary: true);
        cancel.Click += (_, _) => Close();
        var save = CreateButton("保存项目上下文", secondary: false);
        save.Margin = new Thickness(8, 0, 0, 0);
        save.Click += (_, _) => SaveAndClose();
        actions.Children.Add(cancel);
        actions.Children.Add(save);
        Grid.SetColumn(actions, 1);
        footer.Children.Add(actions);
        Grid.SetRow(footer, 4);
        root.Children.Add(footer);
        return root;
    }

    private UIElement BuildProfileTab()
    {
        var scroll = new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled
        };
        var panel = new StackPanel { Margin = new Thickness(18) };
        scroll.Content = panel;

        panel.Children.Add(Field("显示名称", _nameBox, "用于 Command Center 和项目文献分组。"));

        _shellBox.Items.Add(new ComboBoxItem { Content = "PowerShell", Tag = "powershell" });
        _shellBox.Items.Add(new ComboBoxItem { Content = "CMD", Tag = "cmd" });
        _shellBox.Height = 34;
        _shellBox.Padding = new Thickness(8, 2, 8, 2);
        panel.Children.Add(Field("默认终端", _shellBox, "打开项目终端和执行预设命令时使用。"));

        panel.Children.Add(Field("Python 环境", _environmentBox, "可填写 Conda 环境名、venv 路径或说明；AtlasDesk 不自动修改环境。"));
        panel.Children.Add(Field("项目 Dashboard", _dashboardBox, "可选。仅接受 http/https 地址，跨域仍交给默认浏览器。"));

        _favoritesBox.AcceptsReturn = true;
        _favoritesBox.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _favoritesBox.Height = 112;
        _favoritesBox.TextWrapping = TextWrapping.NoWrap;
        panel.Children.Add(Field("常用文件与目录", _favoritesBox, "每行一个完整路径。失效路径不会出现在快捷中心。"));

        _commandsBox.AcceptsReturn = true;
        _commandsBox.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _commandsBox.Height = 150;
        _commandsBox.TextWrapping = TextWrapping.NoWrap;
        panel.Children.Add(Field("常用命令", _commandsBox, "每行：名称 | 命令 | 可选工作目录。命令只在你主动执行时写入内置终端。"));
        return scroll;
    }

    private UIElement BuildResearchTab()
    {
        var root = new Grid { Margin = new Thickness(18) };
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(10) });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(10) });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        root.Children.Add(new TextBlock
        {
            Text = "关联记录保存在 AtlasDesk 中，Zotero 数据库继续严格只读。可在资料库选择文献后点击“关联项目”。",
            TextWrapping = TextWrapping.Wrap,
            FontSize = 11.5,
            Foreground = new SolidColorBrush(Color.FromRgb(82, 103, 129))
        });

        _researchList.BorderThickness = new Thickness(1);
        _researchList.BorderBrush = new SolidColorBrush(Color.FromRgb(222, 228, 236));
        _researchList.Background = Brushes.White;
        var view = new GridView();
        view.Columns.Add(new GridViewColumn { Header = "标题", Width = 390, DisplayMemberBinding = new System.Windows.Data.Binding(nameof(ProjectResearchLink.Title)) });
        view.Columns.Add(new GridViewColumn { Header = "Citation Key", Width = 120, DisplayMemberBinding = new System.Windows.Data.Binding(nameof(ProjectResearchLink.CitationKey)) });
        view.Columns.Add(new GridViewColumn { Header = "DOI", Width = 170, DisplayMemberBinding = new System.Windows.Data.Binding(nameof(ProjectResearchLink.Doi)) });
        _researchList.View = view;
        _researchList.MouseDoubleClick += (_, _) => OpenSelectedResearch();
        Grid.SetRow(_researchList, 2);
        root.Children.Add(_researchList);

        var actions = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        var copy = CreateButton("复制引用键", secondary: true);
        copy.Click += (_, _) => CopySelectedCitation();
        var open = CreateButton("打开 PDF", secondary: true);
        open.Margin = new Thickness(8, 0, 0, 0);
        open.Click += (_, _) => OpenSelectedResearch();
        var remove = CreateButton("解除关联", secondary: true);
        remove.Margin = new Thickness(8, 0, 0, 0);
        remove.Click += (_, _) => RemoveSelectedResearch();
        actions.Children.Add(copy);
        actions.Children.Add(open);
        actions.Children.Add(remove);
        Grid.SetRow(actions, 4);
        root.Children.Add(actions);
        return root;
    }

    private void LoadValues()
    {
        _nameBox.Text = _profile.DisplayName;
        _environmentBox.Text = _profile.PythonEnvironment;
        _dashboardBox.Text = _profile.DashboardUrl;
        _favoritesBox.Text = string.Join(Environment.NewLine, _profile.FavoriteFiles);
        _commandsBox.Text = string.Join(Environment.NewLine, _profile.Commands.Select(command =>
            string.Join(" | ", new[] { command.Name, command.Command, command.WorkingDirectory }
                .Take(string.IsNullOrWhiteSpace(command.WorkingDirectory) ? 2 : 3))));
        _shellBox.SelectedIndex = string.Equals(_profile.DefaultShell, "cmd", StringComparison.OrdinalIgnoreCase) ? 1 : 0;
        RefreshResearchList();
    }

    private void SaveAndClose()
    {
        var dashboard = _dashboardBox.Text.Trim();
        if (!string.IsNullOrWhiteSpace(dashboard)
            && (!Uri.TryCreate(dashboard, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")))
        {
            _status.Text = "Dashboard 地址必须是有效的 http/https 地址。";
            _dashboardBox.Focus();
            return;
        }

        _profile.DisplayName = _nameBox.Text.Trim();
        _profile.DefaultShell = (_shellBox.SelectedItem as ComboBoxItem)?.Tag?.ToString() == "cmd" ? "cmd" : "powershell";
        _profile.PythonEnvironment = _environmentBox.Text.Trim();
        _profile.DashboardUrl = dashboard;
        _profile.FavoriteFiles = SplitLines(_favoritesBox.Text)
            .Select(NormalizePath)
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(80)
            .ToList();
        _profile.Commands = ParseCommands(_commandsBox.Text);
        _profile.UpdatedUtc = DateTime.UtcNow;
        ProductivityContextStore.Save(_state);
        DialogResult = true;
        Close();
    }

    private static List<ProjectContextCommand> ParseCommands(string text)
    {
        var commands = new List<ProjectContextCommand>();
        foreach (var line in SplitLines(text))
        {
            var parts = line.Split('|', 3, StringSplitOptions.TrimEntries);
            if (parts.Length == 1)
            {
                commands.Add(new ProjectContextCommand { Name = parts[0], Command = parts[0] });
            }
            else if (!string.IsNullOrWhiteSpace(parts[1]))
            {
                commands.Add(new ProjectContextCommand
                {
                    Name = parts[0],
                    Command = parts[1],
                    WorkingDirectory = parts.Length > 2 ? parts[2] : string.Empty
                });
            }
            if (commands.Count >= 40)
                break;
        }
        return commands;
    }

    private void RefreshResearchList()
    {
        _researchList.ItemsSource = null;
        _researchList.ItemsSource = _profile.ResearchLinks
            .OrderByDescending(item => item.LinkedUtc)
            .ToArray();
    }

    private ProjectResearchLink? SelectedResearch => _researchList.SelectedItem as ProjectResearchLink;

    private void CopySelectedCitation()
    {
        var link = SelectedResearch;
        if (link is null)
            return;
        var value = !string.IsNullOrWhiteSpace(link.CitationKey)
            ? link.CitationKey
            : !string.IsNullOrWhiteSpace(link.ItemKey)
                ? link.ItemKey
                : link.Title;
        try
        {
            Clipboard.SetText(value);
            _status.Text = "已复制 · " + value;
        }
        catch (Exception ex)
        {
            _status.Text = "复制失败：" + ex.Message;
        }
    }

    private void OpenSelectedResearch()
    {
        var link = SelectedResearch;
        if (link is null || !File.Exists(link.PdfPath))
        {
            _status.Text = "当前关联没有可用的本地 PDF。";
            return;
        }
        try
        {
            Process.Start(new ProcessStartInfo(link.PdfPath) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            _status.Text = "打开失败：" + ex.Message;
        }
    }

    private void RemoveSelectedResearch()
    {
        var link = SelectedResearch;
        if (link is null)
            return;
        _profile.ResearchLinks.Remove(link);
        _profile.UpdatedUtc = DateTime.UtcNow;
        ProductivityContextStore.Save(_state);
        RefreshResearchList();
        _status.Text = "已解除关联，不会修改 Zotero 数据库。";
    }

    private static FrameworkElement Field(string label, Control control, string help)
    {
        control.Margin = new Thickness(0, 5, 0, 0);
        control.MinHeight = 34;
        if (control is TextBox textBox)
        {
            textBox.Padding = new Thickness(9, 6, 9, 6);
            textBox.BorderBrush = new SolidColorBrush(Color.FromRgb(210, 219, 231));
            textBox.BorderThickness = new Thickness(1);
        }

        var panel = new StackPanel { Margin = new Thickness(0, 0, 0, 15) };
        panel.Children.Add(new TextBlock
        {
            Text = label,
            FontWeight = FontWeights.SemiBold,
            FontSize = 12.2,
            Foreground = new SolidColorBrush(Color.FromRgb(55, 70, 90))
        });
        panel.Children.Add(control);
        panel.Children.Add(new TextBlock
        {
            Text = help,
            Margin = new Thickness(0, 4, 0, 0),
            FontSize = 10.7,
            Foreground = new SolidColorBrush(Color.FromRgb(116, 130, 149)),
            TextWrapping = TextWrapping.Wrap
        });
        return panel;
    }

    private static Button CreateButton(string text, bool secondary)
    {
        return new Button
        {
            Content = text,
            Height = 34,
            MinWidth = 86,
            Padding = new Thickness(13, 0, 13, 0),
            Background = secondary
                ? Brushes.White
                : new SolidColorBrush(Color.FromRgb(55, 111, 190)),
            Foreground = secondary
                ? new SolidColorBrush(Color.FromRgb(58, 75, 96))
                : Brushes.White,
            BorderBrush = new SolidColorBrush(Color.FromRgb(194, 205, 220)),
            BorderThickness = new Thickness(1)
        };
    }

    private static IEnumerable<string> SplitLines(string text) =>
        text.Split(new[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries)
            .Select(line => line.Trim())
            .Where(line => line.Length > 0);

    private static string NormalizePath(string path)
    {
        try { return Path.GetFullPath(path.Trim()); }
        catch { return path.Trim(); }
    }
}
