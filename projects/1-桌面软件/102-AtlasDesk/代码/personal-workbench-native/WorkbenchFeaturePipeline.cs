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
        UiConvergence = UiConvergenceCoordinator.Attach(window, Experience.Home, Experience.SettingsPage);
        Diagnostics = DiagnosticsCoordinator.Attach(window, Settings);
        ShellResilience = ShellResilienceCoordinator.Attach(window);

        // v1.1.10 restores the original lightweight Dashboard model. MainWindow owns
        // one in-process WPF WebView2 and the shared login profile. No dedicated host,
        // HWND embedding, page-script diagnostics or interaction shim is attached.
        Dashboard = DashboardSimplicityCoordinator.Attach(window, ShellResilience);

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
        ProductivityContext = ProductivityContextCoordinator.Attach(window, this);
        VisualPolish = SidebarTerminalVisualCoordinator.Attach(window, this);

        // Attach last. Historical presentation layers may still remove focus visuals
        // or Tab stops while applying compatibility fixes; AccessibilityCoordinator
        // is the exclusive final owner of keyboard focus, automation names, high
        // contrast overrides and structured UI quality auditing.
        Accessibility = AccessibilityCoordinator.Attach(window);
    }

    public V067VisualFixes VisualFixes { get; }
    public WorkbenchEnhancer Base { get; }
    public UiConvergenceCoordinator UiConvergence { get; }
    public V061ExperienceEnhancer Experience { get; }
    public DiagnosticsCoordinator Diagnostics { get; }
    public ShellResilienceCoordinator ShellResilience { get; }
    public DashboardSimplicityCoordinator Dashboard { get; }
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
    public ProductivityContextCoordinator ProductivityContext { get; }
    public SidebarTerminalVisualCoordinator VisualPolish { get; }
    public AccessibilityCoordinator Accessibility { get; }
    public AppSettings Settings { get; }

    public static WorkbenchFeaturePipeline Attach(MainWindow window) => new(window);
}
