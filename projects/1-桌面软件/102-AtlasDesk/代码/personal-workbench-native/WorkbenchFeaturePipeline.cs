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
    }

    public WorkbenchEnhancer Base { get; }
    public V061ExperienceEnhancer Experience { get; }
    public V062StabilityEnhancer Stability { get; }
    public AppSettings Settings { get; }

    public static WorkbenchFeaturePipeline Attach(MainWindow window) => new(window);
}
