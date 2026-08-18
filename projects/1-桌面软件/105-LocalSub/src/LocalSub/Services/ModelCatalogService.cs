using System.Text.Json;
using LocalSub.Core;
using LocalSub.Models;

namespace LocalSub.Services;

public sealed class ModelCatalogService
{
    public IReadOnlyList<ModelDescriptor> Load()
    {
        var path = Path.Combine(PortablePaths.AssetsDir, "model-catalog.json");
        if (!File.Exists(path)) return Array.Empty<ModelDescriptor>();
        return JsonSerializer.Deserialize<List<ModelDescriptor>>(File.ReadAllText(path), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? [];
    }
}
