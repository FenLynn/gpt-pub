using System.Reflection;

namespace PersonalWorkbench;

public sealed class WorkbenchFeaturePipeline
{
    private WorkbenchFeaturePipeline(MainWindow window)
    {
        VisualFixes = V067VisualFixes.Attach();
        Base = WorkbenchEnhancer.Attach(window);
        Settings = Base.GetType().GetField("_settings", BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(Base) as AppSettings
                   ?? AppSettings.Load();
        Experience = V061ExperienceEnhancer.Attach(window, Base);
        Stability = V062StabilityEnhancer.Attach(window, Settings);
        DashboardDiagnostics = DashboardScriptDiagnostics.Attach(window);
        DashboardInteraction = DashboardInteractionCoordinator.Attach(window, Settings);
        Projects = V063ProjectEnhancer.Attach(window, this);
        Tasks = V064TaskEnhancer.Attach(window, this);
        Tools = V065ToolsEnhancer.Attach(window, this);
        Backup = V066BackupEnhancer.Attach(window);
        Hotfix = V068HotfixEnhancer.Attach(window, this);
        UiFixes = V069UiFixEnhancer.Attach(window, this);
        TerminalPresentation = V0610TerminalPresentationEnhancer.Attach(this);
        Corrective = V0611CorrectiveEnhancer.Attach(this);
        ExperiencePolish = V0612ExperienceEnhancer.Attach(window, this);
        ProjectCenter = V070ProjectCenterEnhancer.Attach(window, this);
    }

    public V067VisualFixes VisualFixes { get; }
    public WorkbenchEnhancer Base { get; }
    public V061ExperienceEnhancer Experience { get; }
    public V062StabilityEnhancer Stability { get; }
    public DashboardScriptDiagnostics DashboardDiagnostics { get; }
    public DashboardInteractionCoordinator DashboardInteraction { get; }
    public V063ProjectEnhancer Projects { get; }
    public V064TaskEnhancer Tasks { get; }
    public V065ToolsEnhancer Tools { get; }
    public V066BackupEnhancer Backup { get; }
    public V068HotfixEnhancer Hotfix { get; }
    public V069UiFixEnhancer UiFixes { get; }
    public V0610TerminalPresentationEnhancer TerminalPresentation { get; }
    public V0611CorrectiveEnhancer Corrective { get; }
    public V0612ExperienceEnhancer ExperiencePolish { get; }
    public V070ProjectCenterEnhancer ProjectCenter { get; }
    public AppSettings Settings { get; }

    public static WorkbenchFeaturePipeline Attach(MainWindow window) => new(window);
}
