using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;

namespace PersonalWorkbench;

public partial class VaultWindow : Window
{
    private readonly ObservableCollection<VaultEntry> _entries;
    private VaultEntry? _selected;

    public VaultWindow()
    {
        InitializeComponent();
        if (!SecurityService.IsUnlocked)
            throw new InvalidOperationException("加密保险库尚未解锁。");
        _entries = new ObservableCollection<VaultEntry>(SecurityService.LoadVaultEntries());
        EntriesList.ItemsSource = _entries;
        if (_entries.Count > 0) EntriesList.SelectedIndex = 0;
        else BeginNewEntry();
    }

    private void EntriesList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        _selected = EntriesList.SelectedItem as VaultEntry;
        if (_selected is null) return;
        NameBox.Text = _selected.Name;
        UserNameBox.Text = _selected.UserName;
        SecretBox.Text = _selected.Secret;
        NotesBox.Text = _selected.Notes;
        StatusText.Text = string.Empty;
    }

    private void New_Click(object sender, RoutedEventArgs e) => BeginNewEntry();

    private void BeginNewEntry()
    {
        EntriesList.SelectedItem = null;
        _selected = null;
        NameBox.Clear();
        UserNameBox.Clear();
        SecretBox.Clear();
        NotesBox.Clear();
        StatusText.Text = "新项目";
        NameBox.Focus();
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        var name = NameBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            StatusText.Text = "请填写名称。";
            return;
        }
        if (_selected is null)
        {
            _selected = new VaultEntry();
            _entries.Add(_selected);
        }
        _selected.Name = name;
        _selected.UserName = UserNameBox.Text.Trim();
        _selected.Secret = SecretBox.Text;
        _selected.Notes = NotesBox.Text;
        _selected.UpdatedUtc = DateTimeOffset.UtcNow;
        SecurityService.SaveVaultEntries(_entries);
        EntriesList.Items.Refresh();
        EntriesList.SelectedItem = _selected;
        StatusText.Text = "已加密保存";
    }

    private void Delete_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;
        if (MessageBox.Show("确定删除“" + _selected.Name + "”吗？", ProductIdentity.ProductName,
                MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
            return;
        _entries.Remove(_selected);
        SecurityService.SaveVaultEntries(_entries);
        BeginNewEntry();
        if (_entries.Count > 0) EntriesList.SelectedIndex = 0;
    }

    private void CopySecret_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrEmpty(SecretBox.Text))
        {
            StatusText.Text = "当前没有可复制的内容。";
            return;
        }
        Clipboard.SetText(SecretBox.Text);
        StatusText.Text = "已复制";
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();
}
