using System.Runtime.InteropServices;
using System.Text.Json;
using SherpaOnnx;

namespace LocalSub.Services;

/// <summary>
/// Reads offline ASR results through sherpa-onnx's JSON C API instead of the
/// managed OfflineStream.Result wrapper. sherpa-onnx 1.13.4's managed result
/// wrapper assumes the native result pointer is always non-null; short/empty
/// segments can therefore surface as a NullReferenceException. The JSON API
/// lets us safely treat a null/empty native result as an empty recognition.
/// </summary>
internal static class SherpaOfflineResultReader
{
    const string SherpaDll = "sherpa-onnx-c-api";

    public static string GetText(OfflineStream stream)
    {
        if (stream == null || stream.Handle == IntPtr.Zero) return string.Empty;

        IntPtr jsonPtr = IntPtr.Zero;
        try
        {
            jsonPtr = SherpaOnnxGetOfflineStreamResultAsJson(stream.Handle);
            if (jsonPtr == IntPtr.Zero) return string.Empty;

            var json = Marshal.PtrToStringUTF8(jsonPtr);
            if (string.IsNullOrWhiteSpace(json)) return string.Empty;

            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("text", out var text) || text.ValueKind != JsonValueKind.String)
                return string.Empty;
            return text.GetString()?.Trim() ?? string.Empty;
        }
        catch (EntryPointNotFoundException)
        {
            // Compatibility fallback for an unexpectedly older native runtime.
            // Keep this guarded because OfflineStream.Result itself can throw
            // NullReferenceException when the native result pointer is null.
            try { return stream.Result?.Text?.Trim() ?? string.Empty; }
            catch (NullReferenceException) { return string.Empty; }
        }
        finally
        {
            if (jsonPtr != IntPtr.Zero)
            {
                try { SherpaOnnxDestroyOfflineStreamResultJson(jsonPtr); } catch { }
            }
        }
    }

    [DllImport(SherpaDll, CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr SherpaOnnxGetOfflineStreamResultAsJson(IntPtr stream);

    [DllImport(SherpaDll, CallingConvention = CallingConvention.Cdecl)]
    static extern void SherpaOnnxDestroyOfflineStreamResultJson(IntPtr json);
}
