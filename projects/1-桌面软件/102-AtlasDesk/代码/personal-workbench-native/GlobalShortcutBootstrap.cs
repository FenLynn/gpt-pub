using System.Windows.Input;

namespace PersonalWorkbench;

public static class GlobalShortcutBootstrap
{
    private static bool _initialized;

    public static event EventHandler? SearchRequested;

    public static void Initialize()
    {
        if (_initialized) return;
        _initialized = true;
        InputManager.Current.PreProcessInput += OnPreProcessInput;
    }

    private static void OnPreProcessInput(object? sender, PreProcessInputEventArgs e)
    {
        if (e.StagingItem.Input is not KeyEventArgs args || args.RoutedEvent != Keyboard.PreviewKeyDownEvent)
            return;
        if (args.Key != Key.K || !Keyboard.Modifiers.HasFlag(ModifierKeys.Control))
            return;

        args.Handled = true;
        SearchRequested?.Invoke(null, EventArgs.Empty);
    }
}
