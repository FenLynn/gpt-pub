using System.Text.Json;
using System.Text.Json.Serialization;
using LocalSub.Core;

namespace LocalSub.Models;

public enum ProxyMode { System, Direct, Socks5 }
public enum AudioSourceMode { PotPlayer, AllAudio }
public enum SubtitleBackgroundMode { None, Light, Dark }
public enum ResourceProfile { Eco, Auto, MaxPerformance }

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
    public string FfmpegPath { get; set; } = "";

    [JsonConverter(typeof(JsonStringEnumConverter))]
    public ResourceProfile ResourceProfile { get; set; } = ResourceProfile.Auto;
    public bool MinimizeToTray { get; set; } = false;
    public bool StartWithWindows { get; set; } = false;

    public bool SubtitleAutoSize { get; set; } = true;
    public int SubtitleFontSize { get; set; } = 28;
    public int SubtitleAutoScalePercent { get; set; } = 100;
    public int SubtitleBottomOffset { get; set; } = 24;
    public int SubtitleMaxWidthPercent { get; set; } = 90;
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public SubtitleBackgroundMode SubtitleBackground { get; set; } = SubtitleBackgroundMode.None;
    public int SubtitleBackgroundOpacity { get; set; } = 24;
    public double SubtitleDisplaySeconds { get; set; } = 3.0;

    public string SubtitleCurrentColor { get; set; } = "#FFFFFF";
    public int SubtitleCurrentWeight { get; set; } = 500;
    public string SubtitlePreviousColor { get; set; } = "#D8D8D8";
    public int SubtitlePreviousScalePercent { get; set; } = 66;
    public int SubtitlePreviousOpacity { get; set; } = 72;
    public int SubtitlePreviousWeight { get; set; } = 400;
    public string SubtitleOutlineColor { get; set; } = "#000000";
    public double SubtitleOutlineWidth { get; set; } = 1.5;
    public int SubtitleShadowOpacity { get; set; } = 55;

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
