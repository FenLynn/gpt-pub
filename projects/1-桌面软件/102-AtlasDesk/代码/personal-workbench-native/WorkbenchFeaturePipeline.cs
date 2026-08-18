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

        // The Project / Environment / Terminal development surface owns environment
        // discovery. Disable MainWindow's retained legacy path so one navigation can
        // never start two independent Conda/Python scans.
        DevelopmentLifecycleGuard.SuppressLegacyEnvironmentDiscovery(window);

        Experience = V061ExperienceEnhancer.Attach(window, Base);
        Stability = V062StabilityEnhancer.Attach(window, Settings);
        ShellResilience = ShellResilienceCoordinator.Attach(window);
        DashboardDiagnostics = DashboardScriptDiagnostics.Attach(window);
        DashboardInteraction = DashboardInteractionCoordinator.Attach(window, Settings);
        Projects = V063ProjectEnhancer.Attach(window, this);
        TaskTools = TaskToolCoordinator.Attach(window, this);
        Backup = V066BackupEnhancer.Attach(window);
        FeatureHosts = FeatureHostTerminalCoordinator.Attach(window, this);
        WorkspaceTerminal = WorkspaceTerminalCoordinator.Attach(window, this);
        UiFixes = V069UiFixEnhancer.Attach(window, this);
        LegacyConvergence = LegacyEnhancerConvergenceCoordinator.Attach(window, UiFixes);
        TerminalPresentation = V0610TerminalPresentationEnhancer.Attach(this);
        Corrective = V0611CorrectiveEnhancer.Attach(this);
        ExperiencePolish = V0612ExperienceEnhancer.Attach(window, this);
        ProjectWorkflow = ProjectWorkflowCoordinator.Attach(window, this);
    }

    public V067VisualFixes VisualFixes { get; }
    public WorkbenchEnhancer Base { get; }
    public V061ExperienceEnhancer Experience { get; }
    public V062StabilityEnhancer Stability { get; }
    public ShellResilienceCoordinator ShellResilience { get; }
    public DashboardScriptDiagnostics DashboardDiagnostics { get; }
    public DashboardInteractionCoordinator DashboardInteraction { get; }
    public V063ProjectEnhancer Projects { get; }
    public TaskToolCoordinator TaskTools { get; }
    public V066BackupEnhancer Backup { get; }
    public FeatureHostTerminalCoordinator FeatureHosts { get; }
    public WorkspaceTerminalCoordinator WorkspaceTerminal { get; }
    public V069UiFixEnhancer UiFixes { get; }
    public LegacyEnhancerConvergenceCoordinator LegacyConvergence { get; }
    public V0610TerminalPresentationEnhancer TerminalPresentation { get; }
    public V0611CorrectiveEnhancer Corrective { get; }
    public V0612ExperienceEnhancer ExperiencePolish { get; }
    public ProjectWorkflowCoordinator ProjectWorkflow { get; }
    public AppSettings Settings { get; }

    public static WorkbenchFeaturePipeline Attach(MainWindow window) => new(window);
}
