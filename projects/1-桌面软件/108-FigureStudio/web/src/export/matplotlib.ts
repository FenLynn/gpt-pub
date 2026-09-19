import type { Dataset, FigureSpec, PresetDefinition } from "../model";

function py(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/true/g, "True")
    .replace(/false/g, "False")
    .replace(/null/g, "None");
}

export function generateMatplotlibScript(
  dataset: Dataset,
  figure: FigureSpec,
  preset: PresetDefinition
): string {
  const o = figure.figureOverrides;
  const font = o.fontFamily ?? preset.fontFamily;
  const fontSize = o.fontSizePt ?? preset.fontSizePt;
  const bg = o.background ?? "#ffffff";
  const widthIn = preset.widthMm / 25.4;
  const ratio =
    o.aspectMode === "16:9"
      ? 16 / 9
      : o.aspectMode === "3:2"
      ? 3 / 2
      : o.aspectMode === "custom"
      ? (o.customAspectWidth ?? 4) / (o.customAspectHeight ?? 3)
      : 4 / 3;
  const heightIn = widthIn / ratio;

  return `# FigureStudio P108 — generated Matplotlib script
# This script is an editable, reproducible export. The .sfig project remains the source of truth.
import numpy as np
import matplotlib.pyplot as plt

x = np.array(${py(dataset.x.values)}, dtype=float)
series = ${py(
    Object.fromEntries(dataset.ys.map((column) => [column.id, column.values]))
  )}
names = ${py(Object.fromEntries(dataset.ys.map((column) => [column.id, column.name])))}
order = ${py(figure.seriesOrder)}
overrides = ${py(figure.seriesOverrides)}

plt.rcParams.update({
    "font.family": ${py(font)},
    "font.size": ${fontSize},
    "axes.linewidth": ${preset.axisWidthPt},
    "svg.fonttype": "none",
    "pdf.fonttype": 42,
})

fig = plt.figure(figsize=(${widthIn.toFixed(5)}, ${heightIn.toFixed(5)}), facecolor=${py(bg)})
template = ${py(figure.templateId)}
palette = ${py(preset.palette)}

if template == "surface-3d":
    ax = fig.add_subplot(111, projection="3d")
    z = np.array([series[k] for k in order if overrides.get(k, {}).get("visible", True)], dtype=float)
    y = np.array(${py(dataset.metadata?.rowCoordinates ?? [])}, dtype=float)
    if y.size == 0:
        y = np.arange(z.shape[0], dtype=float)
    X, Y = np.meshgrid(x, y)
    ax.plot_surface(X, Y, z, cmap=${py(o.colorScale ?? "viridis")}.lower(), linewidth=0, antialiased=True)
    ax.set_xlabel(${py(o.xTitle ?? dataset.x.name)})
    ax.set_ylabel(${py(o.yTitle ?? dataset.metadata?.rowAxisName ?? "Y")})
    ax.set_zlabel("Z")
elif template == "heatmap":
    ax = fig.add_subplot(111)
    z = np.array([series[k] for k in order if overrides.get(k, {}).get("visible", True)], dtype=float)
    y = np.array(${py(dataset.metadata?.rowCoordinates ?? [])}, dtype=float)
    extent = None
    if y.size and x.size:
        extent = [x.min(), x.max(), y.min(), y.max()]
    im = ax.imshow(z, origin="lower", aspect="auto", extent=extent, cmap=${py(o.colorScale ?? "viridis")}.lower())
    fig.colorbar(im, ax=ax)
    ax.set_xlabel(${py(o.xTitle ?? dataset.x.name)})
    ax.set_ylabel(${py(o.yTitle ?? dataset.metadata?.rowAxisName ?? "Y")})
else:
    ax = fig.add_subplot(111)
    offset_step = ${o.offsetStep ?? 5}
    visible_index = 0
    for source_index, key in enumerate(order):
        if key not in series:
            continue
        style = overrides.get(key, {})
        if not style.get("visible", True):
            continue
        y = np.array(series[key], dtype=float)
        if template == "offset-spectrum":
            y = y + visible_index * offset_step
        color = style.get("color", palette[source_index % len(palette)])
        alpha = style.get("opacity", 1.0)
        lw = style.get("lineWidthPt", ${preset.lineWidthPt})
        marker = style.get("markerSymbol", None) if style.get("markerVisible", False) else None
        marker_map = {
            "circle": "o", "square": "s", "diamond": "D",
            "triangle-up": "^", "triangle-down": "v", "cross": "+", "x": "x"
        }
        marker = marker_map.get(marker, None)
        linestyle_map = {"solid": "-", "dash": "--", "dot": ":", "dashdot": "-."}
        linestyle = linestyle_map.get(style.get("lineStyle", "solid"), "-")
        if template in ("bar", "grouped-bar", "stacked-bar"):
            ax.bar(x, y, label=names.get(key, key), color=color, alpha=alpha)
        else:
            ax.plot(
                x, y,
                label=names.get(key, key),
                color=color,
                alpha=alpha,
                linewidth=lw,
                linestyle=linestyle,
                marker=marker,
                markersize=style.get("markerSizePt", ${preset.markerSizePt})
            )
        visible_index += 1

    ax.set_xlabel(${py(o.xTitle ?? (dataset.x.unit ? dataset.x.name + " (" + dataset.x.unit + ")" : dataset.x.name))})
    ax.set_ylabel(${py(o.yTitle ?? dataset.ys[0]?.name ?? "Y")})
    ax.set_xscale(${py(o.xScale ?? "linear")})
    ax.set_yscale(${py(o.yScale ?? "linear")})
    if ${py(o.gridVisible ?? preset.showGrid)}:
        ax.grid(True, alpha=0.18)
    if ${py(o.legendVisible ?? true)}:
        ax.legend(frameon=${py(o.legendFrame ?? false)})

for spine in getattr(ax, "spines", {}).values():
    spine.set_linewidth(${preset.axisWidthPt})

fig.patch.set_facecolor(${py(bg)})
if hasattr(ax, "set_facecolor"):
    ax.set_facecolor(${py(bg)})
fig.tight_layout()

# Examples:
# fig.savefig("figure.svg", bbox_inches="tight")
# fig.savefig("figure.pdf", bbox_inches="tight")
# fig.savefig("figure.eps", bbox_inches="tight")
# fig.savefig("figure.tiff", dpi=600, bbox_inches="tight")
plt.show()
`;
}

export function downloadMatplotlibScript(
  dataset: Dataset,
  figure: FigureSpec,
  preset: PresetDefinition
) {
  const text = generateMatplotlibScript(dataset, figure, preset);
  const blob = new Blob([text], { type: "text/x-python;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download =
    figure.name.replace(/[\\/:*?"<>|]+/g, "-") + "-matplotlib.py";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
