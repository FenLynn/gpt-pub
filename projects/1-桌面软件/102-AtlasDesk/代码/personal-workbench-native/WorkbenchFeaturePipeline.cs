using System.Reflection;

namespace PersonalWorkbench;

public sealed class WorkbenchFeaturePipeline
{
    private WorkbenchFeaturePipeline(MainWindow window)
    {
        Base = WorkbenchEnhancer.Attach(window);
        Settings = Base.GetType().GetField("_settings", BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(Base) as AppSettings
                   ?? AppSettings.Load();
        Experience = V061ExperienceEnhancer.Attach(window, Base);
        Stability = V062StabilityEnhancer.Attach(window, Settings);
        Projects = V063ProjectEnhancer.Attach(window, this);
        Tasks = V064TaskEnhancer.Attach(window, this);
        Tools = V065ToolsEnhancer.Attach(window, this);
        Backup = V066BackupEnhancer.Attach(window);
    }

    public WorkbenchEnhancer Base { get; }
    public V061ExperienceEnhancer Experience { get; }
    public V062StabilityEnhancer Stability { get; }
    public V063ProjectEnhancer Projects { get; }
    public V064TaskEnhancer Tasks { get; }
    public V065ToolsEnhancer Tools { get; }
    public V066BackupEnhancer Backup { get; }
    public AppSettings Settings { get; }

    public static WorkbenchFeaturePipeline Attach(MainWindow window) => new(window);
}
