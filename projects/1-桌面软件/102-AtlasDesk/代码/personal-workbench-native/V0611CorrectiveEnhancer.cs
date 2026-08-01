using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Data;
using System.Windows.Media;

namespace PersonalWorkbench;

/// <summary>
/// v0.6.11 corrective layer. It keeps the existing lightweight controls and
/// closes the screenshot-reported gaps: workspace image/code preview and the
/// crowded Zotero filter strip.
/// </summary>
public sealed class V0611CorrectiveEnhancer
{
    private readonly WorkspaceControl _workspace;
    private readonly ZoteroLibraryControl _zotero;

    private V0611CorrectiveEnhancer(WorkbenchFeaturePipeline pipeline)
    {
        _workspace = ReadBaseField<WorkspaceControl>(pipeline, "_workspace")
                     ?? throw new InvalidOperationException("Workspace module is unavailable.");
        _zotero = ReadBaseField<ZoteroLibraryControl>(pipeline, "_zotero")
                  ?? throw new InvalidOperationException("Zotero module is unavailable.");

        _workspace.EnableMediaAndSyntaxSupport();
        RepairZoteroFilterStrip();
    }

    public static V0611CorrectiveEnhancer Attach(WorkbenchFeaturePipeline pipeline) => new(pipeline);

    private static T? ReadBaseField<T>(WorkbenchFeaturePipeline pipeline, string name) where T : class
        => pipeline.Base.GetType()
            .GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)
            ?.GetValue(pipeline.Base) as T;

    private void RepairZoteroFilterStrip()
    {
        if (_zotero.FindName("PdfOnlyFilter") is CheckBox pdfOnly)
        {
            pdfOnly.Width = 30;
            pdfOnly.Height = 29;
            pdfOnly.Padding = new Thickness(0);
            pdfOnly.Margin = new Thickness(0);
            pdfOnly.Background = Brushes.Transparent;
            pdfOnly.BorderThickness = new Thickness(0);
            pdfOnly.HorizontalContentAlignment = HorizontalAlignment.Center;
            pdfOnly.VerticalContentAlignment = VerticalAlignment.Center;
            pdfOnly.FocusVisualStyle = null;
            pdfOnly.Template = BuildPdfToggleTemplate();

            if (pdfOnly.Parent is Grid filters && filters.ColumnDefinitions.Count >= 9)
            {
                filters.ColumnDefinitions[2].Width = new GridLength(46);
                filters.ColumnDefinitions[4].Width = new GridLength(108);
                filters.ColumnDefinitions[6].Width = new GridLength(30);
                filters.ColumnDefinitions[8].Width = new GridLength(30);
            }
        }

        if (_zotero.FindName("CurrentScopeText") is TextBlock scope)
        {
            scope.MaxWidth = 185;
            scope.TextTrimming = TextTrimming.CharacterEllipsis;
            scope.ToolTip = scope.Text;
            scope.TargetUpdated += (_, _) => scope.ToolTip = scope.Text;
            BindingOperations.GetBindingExpression(scope, TextBlock.TextProperty)?.UpdateTarget();
        }

        if (_zotero.FindName("SearchBox") is TextBox search)
            search.MinWidth = 160;
        if (_zotero.FindName("ItemTypeFilter") is ComboBox type)
        {
            type.MinWidth = 44;
            type.HorizontalContentAlignment = HorizontalAlignment.Center;
        }
        if (_zotero.FindName("SortFilter") is ComboBox sort)
            sort.MinWidth = 104;
    }

    private static ControlTemplate BuildPdfToggleTemplate()
    {
        var root = new FrameworkElementFactory(typeof(Border), "Root");
        root.SetValue(Border.BackgroundProperty, Brushes.Transparent);
        root.SetValue(Border.BorderBrushProperty, new SolidColorBrush(Color.FromRgb(218, 225, 234)));
        root.SetValue(Border.BorderThicknessProperty, new Thickness(1));
        root.SetValue(Border.CornerRadiusProperty, new CornerRadius(7));
        root.SetValue(Border.PaddingProperty, new Thickness(3));

        var presenter = new FrameworkElementFactory(typeof(ContentPresenter));
        presenter.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
        presenter.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
        presenter.SetBinding(ContentPresenter.ContentProperty, new Binding(nameof(ContentControl.Content))
        {
            RelativeSource = new RelativeSource(RelativeSourceMode.TemplatedParent)
        });
        root.AppendChild(presenter);

        var template = new ControlTemplate(typeof(CheckBox)) { VisualTree = root };
        var hover = new Trigger { Property = UIElement.IsMouseOverProperty, Value = true };
        hover.Setters.Add(new Setter(Border.BackgroundProperty, new SolidColorBrush(Color.FromRgb(248, 238, 240)), "Root"));
        hover.Setters.Add(new Setter(Border.BorderBrushProperty, new SolidColorBrush(Color.FromRgb(214, 139, 150)), "Root"));
        template.Triggers.Add(hover);

        var checkedTrigger = new Trigger { Property = ToggleButton.IsCheckedProperty, Value = true };
        checkedTrigger.Setters.Add(new Setter(Border.BackgroundProperty, new SolidColorBrush(Color.FromRgb(255, 232, 235)), "Root"));
        checkedTrigger.Setters.Add(new Setter(Border.BorderBrushProperty, new SolidColorBrush(Color.FromRgb(207, 82, 96)), "Root"));
        template.Triggers.Add(checkedTrigger);

        var disabled = new Trigger { Property = UIElement.IsEnabledProperty, Value = false };
        disabled.Setters.Add(new Setter(UIElement.OpacityProperty, 0.45));
        template.Triggers.Add(disabled);
        return template;
    }
}
