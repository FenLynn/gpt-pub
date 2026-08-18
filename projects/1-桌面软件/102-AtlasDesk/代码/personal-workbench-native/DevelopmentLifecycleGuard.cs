using System.Reflection;

namespace PersonalWorkbench;

/// <summary>
/// The development surface is now owned by V070ProjectCenterEnhancer. MainWindow
/// still contains the pre-project-center Python controls and discovery method for
/// backward source compatibility, but that legacy path must not run alongside the
/// current DevelopmentControl.
/// </summary>
internal static class DevelopmentLifecycleGuard
{
    private static readonly FieldInfo? LegacyPythonInitializedField = typeof(MainWindow)
        .GetField("_pythonInitialized", BindingFlags.Instance | BindingFlags.NonPublic);

    public static void SuppressLegacyEnvironmentDiscovery(MainWindow window)
    {
        if (LegacyPythonInitializedField is null)
            throw new MissingFieldException(typeof(MainWindow).FullName, "_pythonInitialized");

        LegacyPythonInitializedField.SetValue(window, true);
    }
}
