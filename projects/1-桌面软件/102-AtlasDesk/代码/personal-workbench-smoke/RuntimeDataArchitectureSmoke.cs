using System.Runtime.CompilerServices;

internal static class RuntimeDataArchitectureSmoke
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var root = FindRepositoryRoot();
        var native = Path.Combine(root, "personal-workbench-native");
        var identity = File.ReadAllText(Path.Combine(native, "ProductIdentity.cs"));
        Require(identity.Contains("RuntimeDirectory", StringComparison.Ordinal), "Runtime root is explicit.");
        Require(identity.Contains("RoamingDataDirectory", StringComparison.Ordinal), "Roaming Data root is explicit.");
        Require(identity.Contains("LocalDataDirectory", StringComparison.Ordinal), "Local Data root is explicit.");
        Require(!identity.Contains("MigrateLegacy", StringComparison.Ordinal), "Legacy migration is not embedded in product code.");

        var project = File.ReadAllText(Path.Combine(native, "PersonalWorkbench.csproj"));
        Require(project.Contains("<AssemblyName>AtlasDesk</AssemblyName>", StringComparison.Ordinal), "AtlasDesk.exe is the direct WPF output.");
        Require(project.Contains("Assets\\Terminal", StringComparison.Ordinal), "Terminal assets are copied into public Runtime.");
        Require(!project.Contains("<EmbeddedResource Include=\"TerminalAssets", StringComparison.Ordinal), "Terminal assets are not extracted into Data.");

        var assets = File.ReadAllText(Path.Combine(native, "TerminalAssetManager.cs"));
        Require(assets.Contains("ProductIdentity.TerminalAssetsDirectory", StringComparison.Ordinal), "Terminal uses Runtime assets.");
        Require(!assets.Contains("Directory.CreateDirectory", StringComparison.Ordinal), "Terminal asset lookup does not write Runtime/Data copies.");

        var security = File.ReadAllText(Path.Combine(native, "SecurityService.cs"));
        Require(security.Contains("Argon2id", StringComparison.Ordinal), "Master password uses Argon2id.");
        Require(security.Contains("AesGcm", StringComparison.Ordinal), "Vault uses authenticated AES-GCM encryption.");
        Require(security.Contains("HMACSHA1", StringComparison.Ordinal), "TOTP validation is implemented locally.");
        Require(security.Contains("PinEnabled", StringComparison.Ordinal), "Optional four-digit temporary lock is separate.");

        var shell = File.ReadAllText(Path.Combine(native, "WorkbenchEnhancer.cs"));
        Require(shell.Contains("Color.FromRgb(250, 252, 255)", StringComparison.Ordinal), "Sidebar is opaque and neutral.");
        Console.WriteLine("PASS AtlasDesk Runtime/Data/security architecture boundary");
    }

    private static string FindRepositoryRoot()
    {
        foreach (var candidate in new[] { Environment.GetEnvironmentVariable("GITHUB_WORKSPACE"), Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            if (string.IsNullOrWhiteSpace(candidate)) continue;
            var current = new DirectoryInfo(Path.GetFullPath(candidate));
            while (current is not null)
            {
                var direct = current.FullName;
                if (Directory.Exists(Path.Combine(direct, "personal-workbench-native"))
                    && Directory.Exists(Path.Combine(direct, "personal-workbench-smoke")))
                    return direct;

                var projectCode = Path.Combine(direct, "projects", "1-桌面软件", "102-AtlasDesk", "代码");
                if (Directory.Exists(Path.Combine(projectCode, "personal-workbench-native"))
                    && Directory.Exists(Path.Combine(projectCode, "personal-workbench-smoke")))
                    return projectCode;
                current = current.Parent;
            }
        }
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk source root.");
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
