namespace PersonalWorkbench;

public static class WorkbenchVersion
{
    public static string Current
    {
        get
        {
            var version = typeof(WorkbenchVersion).Assembly.GetName().Version;
            return version is null ? "0.0.0" : $"{version.Major}.{version.Minor}.{version.Build}";
        }
    }
}
