namespace LocalSub.Models;

public sealed class ModelDescriptor
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Purpose { get; set; } = "";
    public string SizeText { get; set; } = "";
    public string Url { get; set; } = "";
    public string FolderName { get; set; } = "";
    public string[] RequiredFiles { get; set; } = Array.Empty<string>();
    public bool Recommended { get; set; }
    public bool LiveCapable { get; set; }
    public bool BatchCapable { get; set; }
}
