using PersonalWorkbench;
using System.Runtime.CompilerServices;

internal static class IntegrityBoundarySmoke
{
    [ModuleInitializer]
    internal static void Run()
    {
        const string hash = "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD";

        var spaced = new IntegrityManifestEntry { RelativePath = " leading and trailing .txt ", Sha256 = hash };
        var roundTrip = FileIntegrityService.ParseManifest(FileIntegrityService.FormatManifest(new[] { spaced }));
        Require(roundTrip.Single().RelativePath == spaced.RelativePath, "manifest preserves legal spaces in file names");

        var duplicate = FileIntegrityService.Header + Environment.NewLine
            + hash + " *same.txt" + Environment.NewLine
            + hash + " *SAME.txt" + Environment.NewLine;
        RequireThrows<InvalidDataException>(() => FileIntegrityService.ParseManifest(duplicate), "duplicate manifest paths are rejected");

        RequireThrows<InvalidDataException>(
            () => FileIntegrityService.FormatManifest(new[] { new IntegrityManifestEntry { RelativePath = "bad\u0001name.txt", Sha256 = hash } }),
            "control characters are rejected");

        var longPath = new string('a', FileIntegrityService.MaxManifestLineLength);
        RequireThrows<InvalidDataException>(
            () => FileIntegrityService.FormatManifest(new[] { new IntegrityManifestEntry { RelativePath = longPath, Sha256 = hash } }),
            "oversized manifest records are rejected");

        Console.WriteLine("PASS integrity parser boundary suite");
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException("SMOKE FAIL: " + message);
    }

    private static void RequireThrows<T>(Action action, string message) where T : Exception
    {
        try { action(); }
        catch (T) { return; }
        throw new InvalidOperationException("SMOKE FAIL: " + message);
    }
}
