import type { Dataset, FigureSpec, PresetDefinition } from "../model";
import {
  resolvePublicationMetrics,
  resolveSeriesPalette
} from "../plot/publication";

function autoAxisTitle(name: string, unit?: string): string {
  return unit ? name + " (" + unit + ")" : name;
}

function orderedSeriesIds(dataset: Dataset, figure: FigureSpec): string[] {
  const allowed = new Set(
    figure.dataRef?.yColumnIds ?? dataset.ys.map((series) => series.id)
  );
  const ids = figure.seriesOrder.filter(
    (id) =>
      allowed.has(id) &&
      dataset.ys.some((series) => series.id === id)
  );
  for (const series of dataset.ys) {
    if (allowed.has(series.id) && !ids.includes(series.id)) ids.push(series.id);
  }
  return ids;
}

export function generateMatplotlibScript(
  dataset: Dataset,
  figure: FigureSpec,
  preset: PresetDefinition
): string {
  const o = figure.figureOverrides;
  const metrics = resolvePublicationMetrics(preset, figure);
  const palette = resolveSeriesPalette(preset, figure);
  const ratio =
    o.aspectMode === "16:9"
      ? 16 / 9
      : o.aspectMode === "3:2"
      ? 3 / 2
      : o.aspectMode === "custom"
      ? (o.customAspectWidth ?? 4) / (o.customAspectHeight ?? 3)
      : 4 / 3;
  const widthIn = metrics.widthMm / 25.4;
  const heightIn = widthIn / ratio;

  const order = orderedSeriesIds(dataset, figure);
  const seriesSide = (id: string, fallbackIndex: number) => {
    const orderIndex = figure.seriesOrder.indexOf(id);
    const stableIndex = orderIndex >= 0 ? orderIndex : fallbackIndex;
    return (
      figure.seriesOverrides[id]?.yAxis ??
      (stableIndex === 0 ? "left" : "right")
    );
  };
  const leftSeries = order
    .map((id, index) => {
      const series = dataset.ys.find((item) => item.id === id);
      return seriesSide(id, index) === "left" ? series : undefined;
    })
    .find(Boolean);
  const rightSeries = order
    .map((id, index) => {
      const series = dataset.ys.find((item) => item.id === id);
      return seriesSide(id, index) === "right" ? series : undefined;
    })
    .find(Boolean);

  const payload = {
    template: figure.templateId,
    x: dataset.x.values,
    xName: dataset.x.name,
    xUnit: dataset.x.unit ?? "",
    series: Object.fromEntries(
      dataset.ys.map((column) => [column.id, column.values])
    ),
    names: Object.fromEntries(
      dataset.ys.map((column) => [column.id, column.name])
    ),
    units: Object.fromEntries(
      dataset.ys.map((column) => [column.id, column.unit ?? ""])
    ),
    order,
    seriesOverrides: figure.seriesOverrides,
    figureOverrides: o,
    metadata: dataset.metadata ?? {},
    preset: {
      fontFamily: preset.fontFamily,
      fontSizePt: metrics.fontSizePt,
      lineWidthPt: metrics.lineWidthPt,
      axisWidthPt: metrics.axisWidthPt,
      markerSizePt: metrics.markerSizePt,
      majorTickLengthPt: metrics.majorTickLengthPt,
      minorTickLengthPt: metrics.minorTickLengthPt,
      axisTitleScale: metrics.axisTitleScale,
      plotTitleScale: metrics.plotTitleScale,
      legendScale: metrics.legendScale,
      showGrid: preset.showGrid,
      palette
    },
    autoTitles: {
      x: o.xTitle ?? autoAxisTitle(dataset.x.name, dataset.x.unit),
      y:
        o.yTitle ??
        (figure.templateId === "heatmap" ||
        figure.templateId === "contour" ||
        figure.templateId === "surface-3d"
          ? autoAxisTitle(
              dataset.metadata?.rowAxisName ?? "Y",
              dataset.metadata?.rowAxisUnit
            )
          : leftSeries
          ? autoAxisTitle(leftSeries.name, leftSeries.unit)
          : dataset.ys[0]
          ? autoAxisTitle(dataset.ys[0].name, dataset.ys[0].unit)
          : "Y"),
      rightY:
        o.rightYTitle ??
        (rightSeries
          ? autoAxisTitle(rightSeries.name, rightSeries.unit)
          : "Right Y"),
      z: o.zTitle ?? "Z"
    }
  };

  const payloadLiteral = JSON.stringify(JSON.stringify(payload));

  return `# FigureStudio P108 — generated Matplotlib script
# Editable reproduction export. The .sfig project remains the source of truth.
import json
import math
import numpy as np
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.ticker import MultipleLocator, FixedLocator, NullFormatter, FuncFormatter, EngFormatter

P = json.loads(${payloadLiteral})
O = P["figureOverrides"]
S = P["seriesOverrides"]
PRESET = P["preset"]
template = P["template"]
order = P["order"]
series = P["series"]
names = P["names"]
units = P["units"]
palette = PRESET["palette"]

raw_x = P["x"]
x_is_categorical = any(isinstance(v, str) for v in raw_x if v is not None)
if x_is_categorical:
    x = np.arange(len(raw_x), dtype=float)
    x_labels = ["" if v is None else str(v) for v in raw_x]
else:
    x = np.array([np.nan if v is None else float(v) for v in raw_x], dtype=float)
    x_labels = None

preferred_font = O.get("fontFamily") or PRESET["fontFamily"]
font_size = O.get("fontSizePt") or PRESET["fontSizePt"]
axis_width = PRESET["axisWidthPt"]
if O.get("axisStyle", "regular") == "bold":
    axis_width = max(1.0, axis_width * 1.45)

def contains_cjk(value):
    if isinstance(value, str):
        return any(
            "\\u3400" <= ch <= "\\u4dbf"
            or "\\u4e00" <= ch <= "\\u9fff"
            or "\\uf900" <= ch <= "\\ufaff"
            for ch in value
        )
    if isinstance(value, dict):
        return any(contains_cjk(item) for item in value.values())
    if isinstance(value, (list, tuple)):
        return any(contains_cjk(item) for item in value)
    return False

available_fonts = {entry.name for entry in font_manager.fontManager.ttflist}
has_cjk_text = contains_cjk({
    "titles": P.get("autoTitles", {}),
    "names": names,
    "seriesOverrides": S,
    "plotTitle": O.get("plotTitle", ""),
})

if preferred_font == "Times New Roman":
    latin_candidates = [
        "Times New Roman",
        "Times",
        "Liberation Serif",
        "DejaVu Serif",
    ]
    cjk_candidates = [
        "Songti SC",
        "SimSun",
        "Noto Serif CJK SC",
        "Source Han Serif SC",
    ] + sorted(
        name
        for name in available_fonts
        if name.startswith("Noto Serif CJK")
        or name.startswith("Source Han Serif")
    )
    fallback_font = "DejaVu Serif"
else:
    latin_candidates = [
        "Arial",
        "Arial Unicode MS",
        "Liberation Sans",
        "DejaVu Sans",
    ]
    cjk_candidates = [
        "Microsoft YaHei",
        "PingFang SC",
        "Noto Sans CJK SC",
        "Source Han Sans SC",
        "SimHei",
    ] + sorted(
        name
        for name in available_fonts
        if name.startswith("Noto Sans CJK")
        or name.startswith("Source Han Sans")
    )
    fallback_font = "DejaVu Sans"

font_candidates = (
    cjk_candidates + latin_candidates
    if has_cjk_text
    else latin_candidates + cjk_candidates
)
font = next(
    (candidate for candidate in font_candidates if candidate in available_fonts),
    fallback_font,
)
font_stack = [font] + [
    candidate
    for candidate in font_candidates
    if candidate != font and candidate in available_fonts
]

plt.rcParams.update({
    "font.family": font_stack,
    "font.size": font_size,
    "axes.linewidth": axis_width,
    "mathtext.fontset": "stix" if preferred_font == "Times New Roman" else "dejavusans",
    "svg.fonttype": "none",
    "pdf.fonttype": 42,
})

fig = plt.figure(figsize=(${widthIn.toFixed(6)}, ${heightIn.toFixed(6)}), facecolor=O.get("background", "#ffffff"))
ax = None
ax2 = None

def finite_array(values):
    return np.array([np.nan if v is None else float(v) for v in values], dtype=float)

def mpl_cmap(name):
    mapping = {
        "Viridis": "viridis",
        "Cividis": "cividis",
        "Magma": "magma",
        "Inferno": "inferno",
        "RdBu": "RdBu",
        "Greys": "Greys",
    }
    base = mapping.get(name, str(name))
    return base + "_r" if O.get("reverseColorScale", False) else base

def visible_keys():
    field_template = template in ("heatmap", "contour", "surface-3d")
    return [
        key for key in order
        if key in series and (
            field_template or S.get(key, {}).get("visible", True)
        )
    ]

def mpl_marker(symbol):
    return {
        "circle": "o",
        "square": "s",
        "diamond": "D",
        "triangle-up": "^",
        "triangle-down": "v",
        "cross": "+",
        "x": "x",
    }.get(symbol)

def mpl_linestyle(style):
    return {
        "solid": "-",
        "dash": "--",
        "dot": ":",
        "dashdot": "-.",
    }.get(style, "-")

def color_for(key, source_index):
    return S.get(key, {}).get("color", palette[source_index % len(palette)])

def label_for(key):
    style = S.get(key, {})
    if not style.get("showInLegend", True):
        return "_nolegend_"
    return style.get("legendLabel") or names.get(key, key)

def axis_for_series(key, visible_index):
    style = S.get(key, {})
    side = style.get("yAxis")
    if side is None:
        stable_index = order.index(key) if key in order else visible_index
        side = "left" if stable_index == 0 else "right"
    return side

def apply_tick_formatter(axis_obj, which, mode, decimals, prefix, suffix):
    if not mode or mode == "auto":
        if not prefix and not suffix:
            return
        base = lambda value, _pos: "{:g}".format(value)
    elif mode == "decimal":
        digits = max(0, min(12, int(decimals if decimals is not None else 2)))
        base = lambda value, _pos: ("{0:." + str(digits) + "f}").format(value)
    elif mode == "scientific":
        digits = max(0, min(12, int(decimals if decimals is not None else 2)))
        base = lambda value, _pos: ("{0:." + str(digits) + "e}").format(value)
    else:
        digits = max(0, min(12, int(decimals if decimals is not None else 2)))
        eng = EngFormatter(places=digits)
        base = lambda value, pos: eng(value, pos)

    formatter = FuncFormatter(
        lambda value, pos: str(prefix or "") + base(value, pos) + str(suffix or "")
    )
    target = axis_obj.xaxis if which == "x" else axis_obj.yaxis
    target.set_major_formatter(formatter)

def apply_log_tick_spacing(axis_obj, which, step, minor=False):
    if step is None or step <= 0:
        return
    getter = axis_obj.get_xlim if which == "x" else axis_obj.get_ylim
    low, high = getter()
    low, high = min(low, high), max(low, high)
    if low <= 0 or high <= 0:
        return
    log_low, log_high = math.log10(low), math.log10(high)
    start = math.floor(log_low / step) * step
    stop = math.ceil(log_high / step) * step
    exponents = np.arange(start, stop + step * 0.5, step)
    if len(exponents) == 0 or len(exponents) > 200:
        return
    locator = FixedLocator(np.power(10.0, exponents))
    target = axis_obj.xaxis if which == "x" else axis_obj.yaxis
    if minor:
        target.set_minor_locator(locator)
        target.set_minor_formatter(NullFormatter())
    else:
        target.set_major_locator(locator)

def configure_axis(axis_obj, side="left"):
    is_right = side == "right"
    scale = O.get("rightYScale", "linear") if is_right else O.get("yScale", "linear")
    auto = O.get("rightYAutoRange", True) if is_right else O.get("yAutoRange", True)
    low = O.get("rightYMin") if is_right else O.get("yMin")
    high = O.get("rightYMax") if is_right else O.get("yMax")
    reverse = O.get("rightYReverse", False) if is_right else O.get("yReverse", False)
    major = O.get("rightYMajorTickStep") if is_right else O.get("yMajorTickStep")
    minor = O.get("rightYMinorTickStep") if is_right else O.get("yMinorTickStep")
    fmt = O.get("rightYTickFormat") if is_right else O.get("yTickFormat")
    decimals = O.get("rightYTickDecimals") if is_right else O.get("yTickDecimals")
    prefix = O.get("rightYTickPrefix", "") if is_right else O.get("yTickPrefix", "")
    suffix = O.get("rightYTickSuffix", "") if is_right else O.get("yTickSuffix", "")
    angle = O.get("rightYTickAngle", 0) if is_right else O.get("yTickAngle", 0)

    axis_obj.set_yscale(scale)
    if auto is False and low is not None and high is not None and low < high:
        if scale != "log" or (low > 0 and high > 0):
            axis_obj.set_ylim(low, high)
    if reverse:
        axis_obj.invert_yaxis()
    if major is not None and major > 0:
        if scale == "linear":
            axis_obj.yaxis.set_major_locator(MultipleLocator(major))
        else:
            apply_log_tick_spacing(axis_obj, "y", major)
    if O.get("minorTicks", False) and minor is not None and minor > 0:
        if scale == "linear":
            axis_obj.yaxis.set_minor_locator(MultipleLocator(minor))
        else:
            apply_log_tick_spacing(axis_obj, "y", minor, minor=True)
    apply_tick_formatter(axis_obj, "y", fmt, decimals, prefix, suffix)
    axis_obj.tick_params(
        axis="y",
        direction="in" if O.get("tickDirection", "outside") == "inside" else "out",
        labelsize=O.get("tickLabelSizePt", font_size * 0.96),
        colors=O.get("tickLabelColor", "#17191c"),
        width=axis_width,
        length=max(4.5, PRESET["majorTickLengthPt"] * 1.4) if O.get("axisStyle", "regular") == "bold" else PRESET["majorTickLengthPt"],
    )
    axis_obj.tick_params(
        axis="y",
        which="minor",
        width=axis_width * 0.85,
        length=max(2.8, PRESET["minorTickLengthPt"] * 1.45) if O.get("axisStyle", "regular") == "bold" else PRESET["minorTickLengthPt"],
    )
    plt.setp(axis_obj.get_yticklabels(), rotation=angle)

def configure_x(axis_obj):
    if x_is_categorical:
        axis_obj.set_xticks(x)
        axis_obj.set_xticklabels(x_labels)
    else:
        scale = O.get("xScale", "linear")
        axis_obj.set_xscale(scale)
        if O.get("xAutoRange", True) is False:
            low = O.get("xMin")
            high = O.get("xMax")
            if low is not None and high is not None and low < high:
                if scale != "log" or (low > 0 and high > 0):
                    axis_obj.set_xlim(low, high)
        if O.get("xReverse", False):
            axis_obj.invert_xaxis()
        major = O.get("xMajorTickStep")
        minor = O.get("xMinorTickStep")
        if major is not None and major > 0:
            if scale == "linear":
                axis_obj.xaxis.set_major_locator(MultipleLocator(major))
            else:
                apply_log_tick_spacing(axis_obj, "x", major)
        if O.get("minorTicks", False) and minor is not None and minor > 0:
            if scale == "linear":
                axis_obj.xaxis.set_minor_locator(MultipleLocator(minor))
            else:
                apply_log_tick_spacing(axis_obj, "x", minor, minor=True)
        apply_tick_formatter(
            axis_obj,
            "x",
            O.get("xTickFormat"),
            O.get("xTickDecimals"),
            O.get("xTickPrefix", ""),
            O.get("xTickSuffix", ""),
        )

    axis_obj.tick_params(
        axis="x",
        direction="in" if O.get("tickDirection", "outside") == "inside" else "out",
        labelsize=O.get("tickLabelSizePt", font_size * 0.96),
        colors=O.get("tickLabelColor", "#17191c"),
        width=axis_width,
        length=max(4.5, PRESET["majorTickLengthPt"] * 1.4) if O.get("axisStyle", "regular") == "bold" else PRESET["majorTickLengthPt"],
    )
    axis_obj.tick_params(
        axis="x",
        which="minor",
        width=axis_width * 0.85,
        length=max(2.8, PRESET["minorTickLengthPt"] * 1.45) if O.get("axisStyle", "regular") == "bold" else PRESET["minorTickLengthPt"],
    )
    plt.setp(axis_obj.get_xticklabels(), rotation=O.get("xTickAngle", 0))

def apply_titles(axis_obj):
    axis_obj.set_xlabel(
        P["autoTitles"]["x"],
        fontsize=O.get("axisTitleSizePt", font_size * PRESET["axisTitleScale"]),
        color=O.get("axisTitleColor", "#17191c"),
    )
    axis_obj.set_ylabel(
        P["autoTitles"]["y"],
        fontsize=O.get("axisTitleSizePt", font_size * PRESET["axisTitleScale"]),
        color=O.get("axisTitleColor", "#17191c"),
    )
    if O.get("plotTitle"):
        axis_obj.set_title(
            O["plotTitle"],
            fontsize=O.get("plotTitleSizePt", font_size * PRESET["plotTitleScale"]),
            color=O.get("plotTitleColor", "#17191c"),
        )

def finish_2d_axes(axis_obj):
    configure_x(axis_obj)
    configure_axis(axis_obj, "left")
    apply_titles(axis_obj)
    if O.get("gridVisible", PRESET["showGrid"]):
        axis_obj.grid(True, alpha=0.18)
    for spine in axis_obj.spines.values():
        spine.set_linewidth(axis_width)
    axis_obj.set_facecolor(O.get("background", "#ffffff"))

def legend_kwargs():
    position = O.get("legendPosition", "top-left" if template == "double-y" else "top-right")
    loc_map = {
        "top-left": "upper left",
        "top-center": "upper center",
        "top-right": "upper right",
        "bottom-left": "lower left",
        "bottom-center": "lower center",
        "bottom-right": "lower right",
    }
    kwargs = {
        "frameon": O.get("legendFrame", False),
        "fontsize": O.get("legendFontSizePt", font_size * PRESET["legendScale"]),
        "ncol": max(1, int(O.get("legendColumns", 1))),
    }
    if position == "outside-right":
        kwargs["loc"] = "upper left"
        kwargs["bbox_to_anchor"] = (1.02, 1.0)
    elif position == "custom":
        xa = O.get("legendXAnchor", "left")
        ya = O.get("legendYAnchor", "top")
        loc_by_anchor = {
            ("left", "top"): "upper left",
            ("center", "top"): "upper center",
            ("right", "top"): "upper right",
            ("left", "middle"): "center left",
            ("center", "middle"): "center",
            ("right", "middle"): "center right",
            ("left", "bottom"): "lower left",
            ("center", "bottom"): "lower center",
            ("right", "bottom"): "lower right",
        }
        kwargs["loc"] = loc_by_anchor.get((xa, ya), "upper left")
        kwargs["bbox_to_anchor"] = (O.get("legendX", 0.02), O.get("legendY", 0.985))
    else:
        kwargs["loc"] = loc_map.get(position, "upper left")
    return kwargs

def add_legend(axis_obj, secondary=None):
    default_visible = len(keys) > 1 and template not in ("bar", "xy-errorbar")
    if not O.get("legendVisible", default_visible):
        return
    handles, labels = axis_obj.get_legend_handles_labels()
    if secondary is not None:
        h2, l2 = secondary.get_legend_handles_labels()
        handles += h2
        labels += l2
    pairs = [(h, l) for h, l in zip(handles, labels) if l != "_nolegend_"]
    if not pairs:
        return
    handles, labels = zip(*pairs)
    legend = axis_obj.legend(handles, labels, **legend_kwargs())
    if O.get("legendBackground"):
        legend.get_frame().set_facecolor(O["legendBackground"])
        legend.get_frame().set_alpha(O.get("legendBackgroundOpacity", 1.0))
    if O.get("legendBorderColor"):
        legend.get_frame().set_edgecolor(O["legendBorderColor"])
    if O.get("legendBorderWidthPt") is not None:
        legend.get_frame().set_linewidth(O["legendBorderWidthPt"])
    for text_obj in legend.get_texts():
        text_obj.set_color(O.get("legendFontColor", "#17191c"))

keys = visible_keys()

if template == "surface-3d":
    ax = fig.add_subplot(111, projection="3d")
    z = np.array([finite_array(series[key]) for key in keys], dtype=float)
    row_map = P["metadata"].get("rowCoordinateByColumnId") or {}
    legacy_rows = P["metadata"].get("rowCoordinates") or []
    y_values = []
    for row_index, key in enumerate(keys):
        if key in row_map:
            y_values.append(float(row_map[key]))
        elif len(legacy_rows) == len(keys):
            y_values.append(float(legacy_rows[row_index]))
        else:
            try:
                y_values.append(float(names.get(key, row_index)))
            except (TypeError, ValueError):
                y_values.append(float(row_index))
    y = np.array(y_values, dtype=float)
    sx = x if not x_is_categorical else np.arange(len(raw_x), dtype=float)
    X, Y = np.meshgrid(sx, y)
    cmap_name = mpl_cmap(O.get("colorScale", "Viridis"))
    kwargs = {}
    if O.get("zAutoRange", True) is False:
        if O.get("zMin") is not None:
            kwargs["vmin"] = O["zMin"]
        if O.get("zMax") is not None:
            kwargs["vmax"] = O["zMax"]
    surf = ax.plot_surface(
        X, Y, z,
        cmap=cmap_name,
        linewidth=0,
        antialiased=False,
        **kwargs
    )
    if O.get("colorbarVisible", True):
        cb = fig.colorbar(surf, ax=ax, shrink=0.66, pad=0.10)
        if O.get("colorbarTitle"):
            cb.set_label(O["colorbarTitle"])
    ax.set_box_aspect((4, 4, 3))
    ax.set_xlabel(P["autoTitles"]["x"])
    ax.set_ylabel(P["autoTitles"]["y"])
    ax.set_zlabel(P["autoTitles"]["z"])
    if O.get("plotTitle"):
        ax.set_title(O["plotTitle"])

elif template in ("heatmap", "contour"):
    ax = fig.add_subplot(111)
    z = np.array([finite_array(series[key]) for key in keys], dtype=float)
    row_map = P["metadata"].get("rowCoordinateByColumnId") or {}
    legacy_rows = P["metadata"].get("rowCoordinates") or []
    y_values = []
    for row_index, key in enumerate(keys):
        if key in row_map:
            y_values.append(float(row_map[key]))
        elif len(legacy_rows) == len(keys):
            y_values.append(float(legacy_rows[row_index]))
        else:
            try:
                y_values.append(float(names.get(key, row_index)))
            except (TypeError, ValueError):
                y_values.append(float(row_index))
    y = np.array(y_values, dtype=float)
    sx = x if not x_is_categorical else np.arange(len(raw_x), dtype=float)
    cmap_name = mpl_cmap(O.get("colorScale", "Viridis"))
    field_kwargs = {"cmap": cmap_name}
    if O.get("zAutoRange", True) is False:
        if O.get("zMin") is not None:
            field_kwargs["vmin"] = O["zMin"]
        if O.get("zMax") is not None:
            field_kwargs["vmax"] = O["zMax"]

    if template == "heatmap":
        artist = ax.pcolormesh(sx, y, z, shading="auto", **field_kwargs)
    else:
        level_count = max(3, min(64, int(O.get("contourLevels", 12))))
        finite_z = z[np.isfinite(z)]
        if O.get("zAutoRange", True) is False:
            level_min = O.get("zMin")
            level_max = O.get("zMax")
        else:
            level_min = float(np.min(finite_z)) if finite_z.size else 0.0
            level_max = float(np.max(finite_z)) if finite_z.size else 1.0
        if (
            level_min is None
            or level_max is None
            or not np.isfinite(level_min)
            or not np.isfinite(level_max)
        ):
            level_min, level_max = 0.0, 1.0
        if not level_max > level_min:
            padding = max(abs(float(level_min)) * 0.05, 0.5)
            level_min -= padding
            level_max += padding
        levels = np.linspace(level_min, level_max, level_count)

        contour_fill = O.get("contourFill", True)
        contour_labels = O.get("contourLabels", False)
        contour_lines = (
            O.get("contourLines", True)
            or contour_labels
            or not contour_fill
        )
        artist = None
        line_artist = None
        if contour_fill:
            artist = ax.contourf(
                sx, y, z, levels=levels, **field_kwargs
            )
        if contour_lines:
            line_artist = ax.contour(
                sx,
                y,
                z,
                levels=levels,
                colors=None if not contour_fill else "#202328",
                linewidths=0.45,
                **({} if contour_fill else field_kwargs)
            )
            if contour_labels:
                ax.clabel(
                    line_artist,
                    inline=True,
                    fontsize=font_size * 0.9
                )
            if artist is None:
                artist = line_artist

    if O.get("colorbarVisible", True) and artist is not None:
        cb = fig.colorbar(artist, ax=ax)
        if O.get("colorbarTitle"):
            cb.set_label(O["colorbarTitle"])
    finish_2d_axes(ax)
    if O.get("fieldEqualAspect", template == "heatmap"):
        ax.set_aspect("equal", adjustable="box")

else:
    ax = fig.add_subplot(111)
    if template == "double-y":
        ax2 = ax.twinx()

    plotted = 0
    visible_count = max(1, len(keys))
    numeric_spacing = 1.0
    if not x_is_categorical and len(x) > 1:
        finite_x = np.sort(x[np.isfinite(x)])
        if len(finite_x) > 1:
            diffs = np.diff(finite_x)
            diffs = diffs[diffs > 0]
            if len(diffs):
                numeric_spacing = float(np.median(diffs))
    bar_gap = max(0.0, min(0.9, float(O.get("barGap", 0.2))))
    group_gap = max(0.0, min(0.9, float(O.get("barGroupGap", 0.08))))
    base_bar_width = numeric_spacing * (1.0 - bar_gap)
    bar_labels = bool(O.get("barLabelsVisible", False))
    bar_label_decimals = max(
        0, min(6, int(O.get("barLabelDecimals", 0)))
    )
    bar_label_position = O.get(
        "barLabelPosition",
        "inside" if template == "stacked-bar" else "outside"
    )
    bar_label_fmt = "%." + str(bar_label_decimals) + "f"

    stack_bottom = np.zeros(len(x), dtype=float)
    left_axis_color = None
    right_axis_color = None

    for source_index, key in enumerate(order):
        if key not in series:
            continue
        style = S.get(key, {})
        if not style.get("visible", True):
            continue

        y = finite_array(series[key])
        current_x = x.copy()
        if template == "offset-spectrum":
            y = y + plotted * float(O.get("offsetStep", 5))
        elif template == "waterfall":
            y = y + plotted * float(O.get("waterfallYOffset", 5))
            if not x_is_categorical:
                current_x = current_x + plotted * float(O.get("waterfallXOffset", 0.5))

        target = ax
        axis_side = "left"
        if template == "double-y" and axis_for_series(key, plotted) == "right":
            target = ax2
            axis_side = "right"

        color = color_for(key, source_index)
        if template == "double-y":
            if axis_side == "right" and right_axis_color is None:
                right_axis_color = color
            elif axis_side == "left" and left_axis_color is None:
                left_axis_color = color
        alpha = float(style.get("opacity", 1.0))
        label = label_for(key)

        if template in ("bar", "grouped-bar", "stacked-bar"):
            if template == "bar" and plotted > 0:
                continue
            edge = style.get("barBorderColor", color)
            edge_width = float(style.get("barBorderWidthPt", 0.0))
            bar_color = color
            if style.get("barColorMode") == "points":
                bar_color = [palette[i % len(palette)] for i in range(len(current_x))]

            if template == "grouped-bar":
                width = base_bar_width * (1.0 - group_gap) / visible_count
                offset = (plotted - (visible_count - 1) / 2.0) * width
                container = target.bar(
                    current_x + offset,
                    y,
                    width=width,
                    label=label,
                    color=bar_color,
                    edgecolor=edge,
                    linewidth=edge_width,
                    alpha=alpha,
                )
            elif template == "stacked-bar":
                container = target.bar(
                    current_x,
                    y,
                    width=base_bar_width,
                    bottom=stack_bottom,
                    label=label,
                    color=bar_color,
                    edgecolor=edge,
                    linewidth=edge_width,
                    alpha=alpha,
                )
                stack_bottom = np.nan_to_num(stack_bottom) + np.nan_to_num(y)
            else:
                container = target.bar(
                    current_x,
                    y,
                    width=base_bar_width,
                    label=label,
                    color=bar_color,
                    edgecolor=edge,
                    linewidth=edge_width,
                    alpha=alpha,
                )

            if bar_labels:
                inside = bar_label_position == "inside"
                target.bar_label(
                    container,
                    fmt=bar_label_fmt,
                    label_type="center" if inside else "edge",
                    padding=0 if inside else 3,
                    fontsize=font_size * 0.9,
                    color="#ffffff" if inside else O.get(
                        "tickLabelColor", "#17191c"
                    ),
                )
        else:
            line_default = template not in ("xy-scatter", "xy-errorbar")
            marker_default = template in ("xy-scatter", "xy-line-marker", "xy-errorbar")
            line_visible = style.get("lineVisible", line_default)
            marker_visible = style.get("markerVisible", marker_default)
            series_name = str(names.get(key, key))
            is_fit = "fit" in series_name.lower() or "拟合" in series_name
            line_style_value = style.get(
                "lineStyle",
                "dash" if is_fit else "solid"
            )
            linestyle = mpl_linestyle(line_style_value) if line_visible else "None"
            marker = mpl_marker(style.get("markerSymbol", "circle")) if marker_visible else None
            automatic_marker_cap = (
                22
                if O.get("publicationMode", "single") == "quad-panel"
                else 28
            ) if marker_visible and line_visible and template not in ("xy-scatter", "xy-errorbar") else 0
            marker_max_displayed = int(
                style.get("markerMaxDisplayed", automatic_marker_cap)
            )
            markevery = (
                max(1, int(math.ceil(len(y) / marker_max_displayed)))
                if marker is not None
                and marker_max_displayed > 0
                and len(y) > marker_max_displayed
                else None
            )
            default_line_width = float(PRESET["lineWidthPt"])
            line_width = float(
                style["lineWidthPt"]
                if "lineWidthPt" in style
                else max(0.65, default_line_width * 0.9)
                if is_fit
                else default_line_width
            )

            common = dict(
                label=label,
                color=color,
                alpha=alpha,
                linewidth=line_width,
                linestyle=linestyle,
                marker=marker,
                markersize=float(style.get("markerSizePt", PRESET["markerSizePt"])),
                markevery=markevery,
                markeredgecolor=color,
                markeredgewidth=0.0 if template in ("xy-scatter", "xy-errorbar") else 0.55,
            )

            if template == "xy-errorbar" and plotted == 0:
                error_id = O.get("errorSeriesId")
                yerr = finite_array(series[error_id]) if error_id in series else None
                target.errorbar(
                    current_x,
                    y,
                    yerr=yerr,
                    capsize=0,
                    elinewidth=0.8,
                    **common
                )
            elif template != "xy-errorbar":
                target.plot(current_x, y, **common)

        plotted += 1

    finish_2d_axes(ax)
    if template == "double-y" and left_axis_color is not None:
        if O.get("tickLabelColor") is None:
            ax.tick_params(axis="y", colors=left_axis_color)
        if O.get("axisTitleColor") is None:
            ax.yaxis.label.set_color(left_axis_color)
    if ax2 is not None:
        configure_axis(ax2, "right")
        right_label_color = O.get("axisTitleColor") or right_axis_color or "#17191c"
        ax2.set_ylabel(
            P["autoTitles"]["rightY"],
            fontsize=O.get("axisTitleSizePt", font_size * PRESET["axisTitleScale"]),
            color=right_label_color,
        )
        if right_axis_color is not None and O.get("tickLabelColor") is None:
            ax2.tick_params(axis="y", colors=right_axis_color)
        for spine in ax2.spines.values():
            spine.set_linewidth(axis_width)
        add_legend(ax, ax2)
    else:
        add_legend(ax)

fig.patch.set_facecolor(O.get("background", "#ffffff"))
fig.tight_layout()

# Publication examples: preserve the exact FigureStudio physical canvas.
# Avoid bbox_inches="tight" here because it changes the exported figure size.
# fig.savefig("figure.svg")
# fig.savefig("figure.pdf")
# fig.savefig("figure.eps")
# fig.savefig("figure.tiff", dpi=600)
# fig.savefig("figure.png", dpi=600)
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
