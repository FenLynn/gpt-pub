using Microsoft.Win32;
using LocalSub.Core;
using LocalSub.Models;

namespace LocalSub.Services;

internal static class StartupRegistrationService
{
    const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string RunValueName = "LocalSub";

    internal static bool IsRegistered()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, false);
            return !string.IsNullOrWhiteSpace(key?.GetValue(RunValueName) as string);
        }
        catch
        {
            return false;
        }
    }

    internal static void Apply(AppSettings settings)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath, true);
        if (!settings.StartWithWindows)
        {
            key.DeleteValue(RunValueName, false);
            return;
        }

        var exe = Environment.ProcessPath ?? Path.Combine(PortablePaths.BaseDir, "LocalSub.exe");
        var command = $"\"{exe}\"";
        if (settings.SilentStartup) command += " --startup-silent";
        key.SetValue(RunValueName, command, RegistryValueKind.String);
    }
}
