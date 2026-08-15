using System.Text.Json;
using System.Text.Json.Serialization;
using LocalSub.Core;

namespace LocalSub.Models;

public enum ProxyMode { System, Direct, Socks5 }
public enum AudioSourceMode { PotPlayer, AllAudio }
public enum SubtitleBackgroundMode { None, Light, Dark }

public sealed class AppSettings
{
    public string AsrRoot { get; set; } = "ASR";
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public ProxyMode ProxyMode { get; set; } = ProxyMode.System;
    public string Socks5Url { get; set; } = "socks5://127.0.0.1:7890";
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public AudioSourceMode AudioSource { get; set; } = AudioSourceMode.PotPlayer;
    public string LiveModelId { get; set; } = "streaming-zipformer-zh-large-int8";
    public string BatchModelId { get; set; } = "sensevoice-small-int8";
    public string Keywords { get; set; } = "";

    public bool SubtitleAutoSize { get; set; } = true;
    public int SubtitleFontSize { get; set; } = 28;
    public int SubtitleBottomOffset { get; set; } = 24;
    public int SubtitleMaxWidthPercent { get; set; } = 90;
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public SubtitleBackgroundMode SubtitleBackground { get; set; } = SubtitleBackgroundMode.None;
    public int SubtitleBackgroundOpacity { get; set; } = 24;
    public double SubtitleDisplaySeconds { get; set; } = 3.0;

    [JsonIgnore]
    public string ResolvedAsrRoot => PortablePaths.ResolvePortablePath(AsrRoot);

    public static AppSettings Load()
    {
        try
        {
            if (!File.Exists(PortablePaths.ConfigFile)) return new AppSettings();
            return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(PortablePaths.ConfigFile), JsonOptions()) ?? new AppSettings();
        }
        catch
        {
            return new AppSettings();
        }
    }

    public void Save()
    {
        var path = PortablePaths.ConfigFile;
        var temp = path + ".tmp";
        var json = JsonSerializer.Serialize(this, JsonOptions());
        File.WriteAllText(temp, json);
        File.Move(temp, path, true);
    }

    static JsonSerializerOptions JsonOptions() => new() { WriteIndented = true, Converters = { new JsonStringEnumConverter() } };
}
