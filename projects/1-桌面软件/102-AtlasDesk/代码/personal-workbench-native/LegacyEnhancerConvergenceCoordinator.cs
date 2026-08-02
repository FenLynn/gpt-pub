using System.Reflection;
using System.Windows;
using System.Windows.Threading;

namespace PersonalWorkbench;

/// <summary>
/// Transitional retirement boundary for legacy corrective layers that still
/// contain useful presentation work. It removes only responsibilities now owned
/// by named long-term coordinators, allowing the remaining visual code to be
/// retired incrementally instead of through an unsafe all-at-once rewrite.
/// </summary>
public sealed class LegacyEnhancerConvergenceCoordinator
{
    private readonly MainWindow _window;
    private readonly V069UiFixEnhancer _legacyPresentation;

    private LegacyEnhancerConvergenceCoordinator(
        MainWindow window,
        V069UiFixEnhancer legacyPresentation)
    {
        _window = window;
        _legacyPresentation = legacyPresentation;

        // V069 still supplies the current title bar, tree templates and terminal
        // reliability fixes. Its WM_GETMINMAXINFO hook is obsolete after v0.8.5.
        // Remove it after SourceInitialized and again after Loaded because the
        // historical layer attempted installation at both lifecycle points.
        _window.SourceInitialized += (_, _) => ScheduleLegacyWorkAreaRemoval();
        _window.Loaded += (_, _) => ScheduleLegacyWorkAreaRemoval();
        ScheduleLegacyWorkAreaRemoval();
    }

    public static LegacyEnhancerConvergenceCoordinator Attach(
        MainWindow window,
        V069UiFixEnhancer legacyPresentation)
        => new(window, legacyPresentation);

    private void ScheduleLegacyWorkAreaRemoval()
    {
        _window.Dispatcher.BeginInvoke(
            DispatcherPriority.Loaded,
            new Action(RemoveLegacyWorkAreaHook));
    }

    private void RemoveLegacyWorkAreaHook()
    {
        try
        {
            _legacyPresentation.GetType()
                .GetMethod("RemoveWindowWorkAreaHook", BindingFlags.Instance | BindingFlags.NonPublic)
                ?.Invoke(_legacyPresentation, null);
            App.Log("Legacy V069 WorkArea hook retired; ShellResilienceCoordinator is the exclusive owner.");
        }
        catch (Exception ex)
        {
            App.Log("Retire legacy WorkArea hook failed: " + ex);
        }
    }
}
