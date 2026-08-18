namespace LocalSub.Models;

public sealed class ModelFileDescriptor
{
    public string FileName { get; set; } = "";
    public string Url { get; set; } = "";
}

public sealed class ModelDescriptor
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Purpose { get; set; } = "";
    public string Languages { get; set; } = "";
    public string SizeText { get; set; } = "";
    public int RealtimeScore { get; set; }
    public int AccuracyScore { get; set; }
    public int ValueScore { get; set; }
    public string Url { get; set; } = "";
    public ModelFileDescriptor[] Files { get; set; } = Array.Empty<ModelFileDescriptor>();
    public string FolderName { get; set; } = "";
    public string[] RequiredFiles { get; set; } = Array.Empty<string>();
    public bool Recommended { get; set; }
    public bool LiveCapable { get; set; }
    public bool BatchCapable { get; set; }
}
