namespace LocalSub.UI;

internal static class ModelGridVisualStyler
{
    static readonly Color UninstalledText = Color.FromArgb(178, 178, 178);
    static readonly Color UninstalledSelectedText = Color.FromArgb(150, 150, 150);

    public static void Attach(Form root)
    {
        foreach (var grid in FindModelGrids(root))
        {
            grid.CellFormatting -= Grid_CellFormatting;
            grid.CellFormatting += Grid_CellFormatting;
            grid.Invalidate();
        }
    }

    static IEnumerable<DataGridView> FindModelGrids(Control root)
    {
        foreach (Control child in root.Controls)
        {
            if (child is DataGridView grid &&
                grid.Columns.Contains("Status") &&
                grid.Columns.Contains("ModelName"))
                yield return grid;

            foreach (var nested in FindModelGrids(child))
                yield return nested;
        }
    }

    static void Grid_CellFormatting(object? sender, DataGridViewCellFormattingEventArgs e)
    {
        if (sender is not DataGridView grid || e.RowIndex < 0 || e.RowIndex >= grid.Rows.Count) return;
        if (!grid.Columns.Contains("Status")) return;

        var row = grid.Rows[e.RowIndex];
        var status = Convert.ToString(row.Cells["Status"].Value) ?? string.Empty;
        var installed = status.StartsWith("已安装", StringComparison.Ordinal);

        e.CellStyle.ForeColor = installed ? Color.Black : UninstalledText;
        e.CellStyle.SelectionForeColor = installed ? Color.Black : UninstalledSelectedText;
    }
}
