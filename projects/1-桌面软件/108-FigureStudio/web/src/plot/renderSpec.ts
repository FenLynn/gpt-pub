import { resolveFieldRowCoordinates } from "../data/field";
import { normalizePlotlyMathText } from "../lib/mathText";
import type {
  Dataset,
  PlotColumn,
  FigureSpec,
  LegendPosition,
  PresetDefinition,
  TickLabelFormat
} from "../model";

export const DESIGN_DPI = 96;
export const PNG_DPI = 600;
export const PX_PER_MM = DESIGN_DPI / 25.4;

export function ptToPx(valuePt: number): number {
  return valuePt * (DESIGN_DPI / 72);
}

export function mmToPx(valueMm: number): number {
  return valueMm * PX_PER_MM;
}

export function plotFontFamily(font: "Arial" | "Times New Roman"): string {
  if (font === "Times New Roman") {
    return '"Times New Roman", "Songti SC", "SimSun", "Noto Serif CJK SC", serif';
  }
  return 'Arial, "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
}

function autoAxisTitle(name: string, unit?: string): string {
  return unit ? name + " (" + unit + ")" : name;
}

export function aspectRatioFor(
  mode = "4:3",
  customWidth = 4,
  customHeight = 3
): number {
  if (mode === "16:9") return 16 / 9;
  if (mode === "3:2") return 3 / 2;
  if (mode === "custom") {
    const width = Number.isFinite(customWidth) && customWidth > 0 ? customWidth : 4;
    const height = Number.isFinite(customHeight) && customHeight > 0 ? customHeight : 3;
    return width / height;
  }
  return 4 / 3;
}

export function resolveCanvasMm(
  preset: PresetDefinition,
  figure: FigureSpec
) {
  const overrides = figure.figureOverrides;
  const aspectMode = overrides.aspectMode ?? "4:3";
  const ratio = aspectRatioFor(
    aspectMode,
    overrides.customAspectWidth,
    overrides.customAspectHeight
  );
  const widthMm = preset.widthMm;
  const heightMm = widthMm / ratio;
  return { widthMm, heightMm, ratio, aspectMode };
}

export function orderSeries(
  dataset: Dataset,
  seriesOrder: string[],
  allowedIds?: string[]
): PlotColumn[] {
  const allowed = allowedIds ? new Set(allowedIds) : undefined;
  const candidates = allowed
    ? dataset.ys.filter((series) => allowed.has(series.id))
    : dataset.ys;
  const byId = new Map(candidates.map((series) => [series.id, series]));
  const ordered = seriesOrder
    .map((id) => byId.get(id))
    .filter((series): series is PlotColumn => Boolean(series));

  for (const series of candidates) {
    if (!ordered.some((item) => item.id === series.id)) ordered.push(series);
  }

  return ordered;
}

function legendAnchor(position: LegendPosition) {
  const map: Record<
    Exclude<LegendPosition, "custom">,
    { x: number; y: number; xanchor: string; yanchor: string }
  > = {
    "top-left": { x: 0.02, y: 0.985, xanchor: "left", yanchor: "top" },
    "top-center": { x: 0.5, y: 0.985, xanchor: "center", yanchor: "top" },
    "top-right": { x: 0.98, y: 0.985, xanchor: "right", yanchor: "top" },
    "bottom-left": { x: 0.02, y: 0.02, xanchor: "left", yanchor: "bottom" },
    "bottom-center": { x: 0.5, y: 0.02, xanchor: "center", yanchor: "bottom" },
    "bottom-right": { x: 0.98, y: 0.02, xanchor: "right", yanchor: "bottom" },
    "outside-right": { x: 1.02, y: 0.985, xanchor: "left", yanchor: "top" }
  };
  if (position === "custom") {
    return { x: 0.02, y: 0.985, xanchor: "left", yanchor: "top" };
  }
  return map[position];
}

function visibleSeries(dataset: Dataset, figure: FigureSpec): PlotColumn[] {
  return orderSeries(
    dataset,
    figure.seriesOrder,
    figure.dataRef?.yColumnIds
  ).filter(
    (series) => figure.seriesOverrides[series.id]?.visible !== false
  );
}

function baseXYTrace(
  dataset: Dataset,
  figure: FigureSpec,
  preset: PresetDefinition,
  series: PlotColumn,
  sourceIndex: number,
  modeDefault: "lines" | "markers" | "lines+markers",
  yValues?: Array<number | null>
) {
  const override = figure.seriesOverrides[series.id] || {};
  const isFit = /fit|拟合/i.test(series.name);
  const lineVisible =
    override.lineVisible ??
    (modeDefault === "lines" || modeDefault === "lines+markers");
  const markerVisible =
    override.markerVisible ??
    (modeDefault === "markers" || modeDefault === "lines+markers");
  const lineWidthPt = override.lineWidthPt ?? preset.lineWidthPt;
  const markerSizePt = override.markerSizePt ?? preset.markerSizePt;
  const color =
    override.color || preset.palette[sourceIndex % preset.palette.length];
  const opacity = override.opacity ?? 1;
  const xIsNumeric = dataset.x.values.every(
    (value) => value === null || typeof value === "number"
  );

  let mode = "";
  if (lineVisible) mode += "lines";
  if (markerVisible) mode += (mode ? "+" : "") + "markers";
  if (!mode) mode = "lines";

  return {
    type: "scatter",
    mode,
    name: normalizePlotlyMathText(override.legendLabel ?? series.name),
    showlegend: override.showInLegend ?? true,
    meta: { figureStudioSeriesId: series.id },
    x: dataset.x.values,
    y: yValues ?? series.values,
    opacity,
    line: {
      color,
      width: ptToPx(
        isFit && override.lineWidthPt === undefined
          ? Math.max(0.65, lineWidthPt * 0.9)
          : lineWidthPt
      ),
      dash: override.lineStyle ?? (isFit ? "dash" : "solid")
    },
    marker: {
      color,
      size: ptToPx(markerSizePt),
      symbol: override.markerSymbol ?? "circle",
      line: {
        color,
        width: ptToPx(modeDefault === "markers" ? 0 : 0.55)
      }
    },
    hovertemplate:
      "<b>" +
      series.name +
      "</b><br>" +
      dataset.x.name +
      "：" +
      (xIsNumeric ? "%{x:.4g}" : "%{x}") +
      (dataset.x.unit ? " " + dataset.x.unit : "") +
      "<br>%{y:.4g}" +
      (series.unit ? " " + series.unit : "") +
      "<extra></extra>"
  };
}

export function buildTraces(args: {
  dataset: Dataset;
  figure: FigureSpec;
  preset: PresetDefinition;
}) {
  const { dataset, figure, preset } = args;
  const template = figure.templateId;
  const mappedSeries = orderSeries(
    dataset,
    figure.seriesOrder,
    figure.dataRef?.yColumnIds
  );
  const fieldTemplate =
    template === "heatmap" ||
    template === "contour" ||
    template === "surface-3d";
  const series = fieldTemplate
    ? mappedSeries
    : mappedSeries.filter(
        (item) => figure.seriesOverrides[item.id]?.visible !== false
      );

  if (template === "heatmap" || template === "contour") {
    const xIsNumeric = dataset.x.values.every(
      (value) => value === null || typeof value === "number"
    );
    const yValues = resolveFieldRowCoordinates(dataset, series);
    const zValues = series.map((column) => column.values);
    const zAuto = figure.figureOverrides.zAutoRange !== false;
    let zDataMin = Number.POSITIVE_INFINITY;
    let zDataMax = Number.NEGATIVE_INFINITY;
    for (const row of zValues) {
      for (const value of row) {
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        if (value < zDataMin) zDataMin = value;
        if (value > zDataMax) zDataMax = value;
      }
    }
    if (!Number.isFinite(zDataMin) || !Number.isFinite(zDataMax)) {
      zDataMin = 0;
      zDataMax = 1;
    }
    let zLevelMin =
      !zAuto && Number.isFinite(figure.figureOverrides.zMin)
        ? (figure.figureOverrides.zMin as number)
        : zDataMin;
    let zLevelMax =
      !zAuto && Number.isFinite(figure.figureOverrides.zMax)
        ? (figure.figureOverrides.zMax as number)
        : zDataMax;
    if (!(zLevelMax > zLevelMin)) {
      const padding = Math.max(Math.abs(zLevelMin) * 0.05, 0.5);
      zLevelMin -= padding;
      zLevelMax += padding;
    }
    const fieldFontFamily = plotFontFamily(
      figure.figureOverrides.fontFamily ?? preset.fontFamily
    );
    const fieldFontSizePt =
      figure.figureOverrides.fontSizePt ?? preset.fontSizePt;
    const colorbar = {
      thickness: 11,
      outlinewidth: 0,
      len: 0.88,
      tickfont: {
        family: fieldFontFamily,
        size: ptToPx(
          figure.figureOverrides.tickLabelSizePt ?? fieldFontSizePt * 0.96
        ),
        color: figure.figureOverrides.tickLabelColor ?? "#17191c"
      },
      title: figure.figureOverrides.colorbarTitle
        ? {
            text: normalizePlotlyMathText(
              figure.figureOverrides.colorbarTitle
            ),
            side: "right",
            font: {
              family: fieldFontFamily,
              size: ptToPx(
                figure.figureOverrides.axisTitleSizePt ??
                  fieldFontSizePt * 1.08
              ),
              color: figure.figureOverrides.axisTitleColor ?? "#17191c"
            }
          }
        : undefined
    };

    if (template === "contour") {
      const contourFill = figure.figureOverrides.contourFill !== false;
      const contourLabels = figure.figureOverrides.contourLabels ?? false;
      const contourLines =
        figure.figureOverrides.contourLines !== false ||
        contourLabels ||
        !contourFill;
      const contourLevelCount = Math.max(
        3,
        Math.min(64, Math.round(figure.figureOverrides.contourLevels ?? 12))
      );
      const contourLevelSize =
        (zLevelMax - zLevelMin) / Math.max(1, contourLevelCount - 1);
      return [
        {
          type: "contour",
          x: dataset.x.values,
          y: yValues,
          z: zValues,
          colorscale: figure.figureOverrides.colorScale ?? "Viridis",
          reversescale: figure.figureOverrides.reverseColorScale ?? false,
          showscale: figure.figureOverrides.colorbarVisible ?? true,
          zauto: false,
          zmin: zLevelMin,
          zmax: zLevelMax,
          autocontour: false,
          ncontours: contourLevelCount,
          contours: {
            start: zLevelMin,
            end: zLevelMax,
            size: contourLevelSize,
            coloring: contourFill ? "fill" : "lines",
            showlabels: contourLabels,
            labelfont: {
              family: plotFontFamily(
                figure.figureOverrides.fontFamily ?? preset.fontFamily
              ),
              size: ptToPx(
                (figure.figureOverrides.tickLabelSizePt ??
                  figure.figureOverrides.fontSizePt ??
                  preset.fontSizePt) * 0.9
              ),
              color: figure.figureOverrides.tickLabelColor ?? "#17191c"
            }
          },
          line: {
            width: contourLines ? ptToPx(0.45) : 0,
            color: "rgba(32,35,40,0.72)"
          },
          colorbar,
          hovertemplate:
            (xIsNumeric ? "X=%{x:.4g}" : "X=%{x}") +
            "<br>Y=%{y:.4g}<br>Z=%{z:.4g}<extra></extra>"
        }
      ];
    }

    return [
      {
        type: "heatmap",
        x: dataset.x.values,
        y: yValues,
        z: zValues,
        colorscale: figure.figureOverrides.colorScale ?? "Viridis",
        reversescale: figure.figureOverrides.reverseColorScale ?? false,
        showscale: figure.figureOverrides.colorbarVisible ?? true,
        zauto: zAuto,
        zmin: zAuto ? undefined : figure.figureOverrides.zMin,
        zmax: zAuto ? undefined : figure.figureOverrides.zMax,
        colorbar,
        zsmooth: false,
        hoverongaps: false,
        hovertemplate:
          (xIsNumeric ? "X=%{x:.4g}" : "X=%{x}") +
          "<br>Y=%{y:.4g}<br>Z=%{z:.4g}<extra></extra>"
      }
    ];
  }

  if (template === "surface-3d") {
    const surfaceX = dataset.x.values.every(
      (value) => value === null || typeof value === "number"
    )
      ? dataset.x.values
      : dataset.x.values.map((_value, index) => index + 1);
    return [
      {
        type: "surface",
        x: surfaceX,
        y: resolveFieldRowCoordinates(dataset, series),
        z: series.map((column) => column.values),
        colorscale: figure.figureOverrides.colorScale ?? "Viridis",
        reversescale: figure.figureOverrides.reverseColorScale ?? false,
        showscale: figure.figureOverrides.colorbarVisible ?? true,
        cauto: figure.figureOverrides.zAutoRange !== false,
        cmin:
          figure.figureOverrides.zAutoRange === false
            ? figure.figureOverrides.zMin
            : undefined,
        cmax:
          figure.figureOverrides.zAutoRange === false
            ? figure.figureOverrides.zMax
            : undefined,
        colorbar: {
          thickness: 11,
          outlinewidth: 0,
          len: 0.66,
          x: 1.06,
          xpad: 4,
          tickfont: {
            family: plotFontFamily(
              figure.figureOverrides.fontFamily ?? preset.fontFamily
            ),
            size: ptToPx(
              (figure.figureOverrides.tickLabelSizePt ??
                figure.figureOverrides.fontSizePt ??
                preset.fontSizePt) * 0.96
            ),
            color: figure.figureOverrides.tickLabelColor ?? "#17191c"
          },
          title: figure.figureOverrides.colorbarTitle
            ? {
                text: normalizePlotlyMathText(
                  figure.figureOverrides.colorbarTitle
                ),
                side: "right",
                font: {
                  family: plotFontFamily(
                    figure.figureOverrides.fontFamily ?? preset.fontFamily
                  ),
                  size: ptToPx(
                    figure.figureOverrides.axisTitleSizePt ??
                      (figure.figureOverrides.fontSizePt ??
                        preset.fontSizePt) * 1.08
                  ),
                  color: figure.figureOverrides.axisTitleColor ?? "#17191c"
                }
              }
            : { text: "" }
        },
        lighting: {
          ambient: 0.82,
          diffuse: 0.72,
          specular: 0.08,
          roughness: 0.92,
          fresnel: 0.03
        },
        lightposition: { x: 100, y: 160, z: 220 },
        hovertemplate: "X=%{x:.4g}<br>Y=%{y:.4g}<br>Z=%{z:.4g}<extra></extra>"
      }
    ];
  }

  if (
    template === "bar" ||
    template === "grouped-bar" ||
    template === "stacked-bar"
  ) {
    const barSeries = template === "bar" ? series.slice(0, 1) : series;
    return barSeries.map((column, index) => {
      const sourceIndex = Math.max(
        0,
        dataset.ys.findIndex((item) => item.id === column.id)
      );
      const override = figure.seriesOverrides[column.id] || {};
      const fillColor =
        override.color ||
        preset.palette[sourceIndex % preset.palette.length];
      const markerColor =
        override.barColorMode === "points"
          ? column.values.map(
              (_value, pointIndex) =>
                preset.palette[pointIndex % preset.palette.length]
            )
          : fillColor;
      const labelVisible =
        figure.figureOverrides.barLabelsVisible ?? false;
      const labelDecimals = Math.max(
        0,
        Math.min(
          6,
          Math.round(figure.figureOverrides.barLabelDecimals ?? 0)
        )
      );
      const labelPosition =
        figure.figureOverrides.barLabelPosition ??
        (template === "stacked-bar" ? "inside" : "outside");
      return {
        type: "bar",
        name: normalizePlotlyMathText(override.legendLabel ?? column.name),
        showlegend: override.showInLegend ?? true,
        meta: { figureStudioSeriesId: column.id },
        x: dataset.x.values,
        y: column.values,
        opacity: override.opacity ?? 1,
        marker: {
          color: markerColor,
          line: {
            color: override.barBorderColor ?? fillColor,
            width: ptToPx(override.barBorderWidthPt ?? 0)
          }
        },
        texttemplate: labelVisible
          ? "%{y:." + String(labelDecimals) + "f}"
          : undefined,
        textposition: labelVisible ? labelPosition : "none",
        textangle: 0,
        cliponaxis: false,
        insidetextfont: {
          family: plotFontFamily(
            figure.figureOverrides.fontFamily ?? preset.fontFamily
          ),
          size: ptToPx(
            (figure.figureOverrides.tickLabelSizePt ??
              figure.figureOverrides.fontSizePt ??
              preset.fontSizePt) * 0.9
          ),
          color: "#ffffff"
        },
        outsidetextfont: {
          family: plotFontFamily(
            figure.figureOverrides.fontFamily ?? preset.fontFamily
          ),
          size: ptToPx(
            (figure.figureOverrides.tickLabelSizePt ??
              figure.figureOverrides.fontSizePt ??
              preset.fontSizePt) * 0.9
          ),
          color: figure.figureOverrides.tickLabelColor ?? "#17191c"
        },
        hovertemplate:
          "<b>" +
          column.name +
          "</b><br>%{x}<br>%{y:.4g}" +
          (column.unit ? " " + column.unit : "") +
          "<extra></extra>"
      };
    });
  }

  if (template === "xy-errorbar") {
    const main = series[0];
    if (!main) return [];
    const sourceIndex = Math.max(
      0,
      dataset.ys.findIndex((item) => item.id === main.id)
    );
    const trace = baseXYTrace(
      dataset,
      figure,
      preset,
      main,
      sourceIndex,
      "lines+markers"
    ) as any;
    const errorId = figure.figureOverrides.errorSeriesId;
    const errorSeries = dataset.ys.find((column) => column.id === errorId);
    if (errorSeries) {
      trace.error_y = {
        type: "data",
        array: errorSeries.values,
        visible: true,
        color: trace.line?.color,
        thickness: ptToPx(0.8),
        width: 0
      };
    }
    return [trace];
  }

  const modeDefault =
    template === "xy-scatter"
      ? "markers"
      : template === "xy-line-marker"
      ? "lines+markers"
      : "lines";

  const offsetStep =
    template === "offset-spectrum"
      ? figure.figureOverrides.offsetStep ?? 5
      : 0;
  const waterfallYOffset =
    template === "waterfall"
      ? figure.figureOverrides.waterfallYOffset ?? 5
      : 0;
  const waterfallXOffset =
    template === "waterfall"
      ? figure.figureOverrides.waterfallXOffset ?? 0.5
      : 0;
  const xIsNumeric = dataset.x.values.every(
    (value) => value === null || typeof value === "number"
  );

  return series.map((column, index) => {
    const sourceIndex = Math.max(
      0,
      dataset.ys.findIndex((item) => item.id === column.id)
    );
    const totalYOffset = offsetStep + waterfallYOffset;
    const yValues =
      totalYOffset === 0
        ? undefined
        : column.values.map((value) =>
            value === null ? null : value + index * totalYOffset
          );
    const trace = baseXYTrace(
      dataset,
      figure,
      preset,
      column,
      sourceIndex,
      modeDefault,
      yValues
    ) as any;

    if (template === "waterfall" && waterfallXOffset !== 0 && xIsNumeric) {
      trace.x = dataset.x.values.map((value) =>
        typeof value === "number"
          ? value + index * waterfallXOffset
          : value
      );
    }

    if (template === "double-y") {
      const orderIndex = figure.seriesOrder.indexOf(column.id);
      const stableIndex = orderIndex >= 0 ? orderIndex : sourceIndex;
      const axis =
        figure.seriesOverrides[column.id]?.yAxis ??
        (stableIndex === 0 ? "left" : "right");
      trace.yaxis = axis === "right" ? "y2" : "y";
    }

    return trace;
  });
}

function rangeFor(
  autoRange: boolean | undefined,
  minValue: number | undefined,
  maxValue: number | undefined,
  scale: "linear" | "log",
  reverse: boolean
): [number, number] | undefined {
  if (autoRange !== false) return undefined;
  if (
    minValue === undefined ||
    maxValue === undefined ||
    !Number.isFinite(minValue) ||
    !Number.isFinite(maxValue) ||
    minValue >= maxValue
  ) {
    return undefined;
  }

  const range: [number, number] | undefined =
    scale === "log"
      ? minValue > 0 && maxValue > 0
        ? [Math.log10(minValue), Math.log10(maxValue)]
        : undefined
      : [minValue, maxValue];

  return range && reverse ? [range[1], range[0]] : range;
}

function finiteNumericValues(values: unknown[]): number[] {
  return values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value)
  );
}

function coordinateExtent(
  values: number[],
  extendHalfCell: boolean
): [number, number] | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) {
    const padding = Math.max(Math.abs(sorted[0]) * 0.05, 0.5);
    return [sorted[0] - padding, sorted[0] + padding];
  }
  if (!extendHalfCell) return [sorted[0], sorted[sorted.length - 1]];

  const lowStep = sorted[1] - sorted[0];
  const highStep =
    sorted[sorted.length - 1] - sorted[sorted.length - 2];
  return [
    sorted[0] - lowStep / 2,
    sorted[sorted.length - 1] + highStep / 2
  ];
}

function matplotlibAutoRange(
  values: number[],
  scale: "linear" | "log",
  reverse: boolean,
  margin = 0.05
): [number, number] | undefined {
  const finite =
    scale === "log" ? values.filter((value) => value > 0) : values;
  if (!finite.length) return undefined;

  if (scale === "log") {
    const logs = finite.map((value) => Math.log10(value));
    let low = Math.min(...logs);
    let high = Math.max(...logs);
    let span = high - low;
    if (!(span > 0)) {
      span = 0.2;
      low -= span / 2;
      high += span / 2;
    } else {
      const padding = span * margin;
      low -= padding;
      high += padding;
    }
    return reverse ? [high, low] : [low, high];
  }

  let low = Math.min(...finite);
  let high = Math.max(...finite);
  let span = high - low;
  if (!(span > 0)) {
    const padding = Math.max(Math.abs(low) * margin, 0.5);
    low -= padding;
    high += padding;
  } else {
    const padding = span * margin;
    low -= padding;
    high += padding;
  }
  return reverse ? [high, low] : [low, high];
}

function matplotlibNiceTickStep(
  range: [number, number] | undefined,
  targetIntervals = 6
): number | undefined {
  if (!range) return undefined;
  const span = Math.abs(range[1] - range[0]);
  if (!(span > 0) || !Number.isFinite(span)) return undefined;

  const raw = span / Math.max(2, targetIntervals);
  const exponent = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exponent);
  const candidates = [1, 2, 2.5, 5, 10].map(
    (step) => step * base
  );
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate - raw) < Math.abs(best - raw)
      ? candidate
      : best
  );
}

function tickFormatString(
  format: TickLabelFormat | undefined,
  decimals: number | undefined
): string | undefined {
  if (!format || format === "auto") return undefined;
  const digits = Math.max(
    0,
    Math.min(12, Number.isFinite(decimals) ? Math.round(decimals as number) : 2)
  );
  if (format === "decimal") return "." + digits + "f";
  if (format === "scientific") return "." + digits + "e";
  return "." + Math.max(1, digits + 1) + "s";
}

function rgba(hex: string, opacity: number): string {
  const clean = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return hex;
  const value = Number.parseInt(clean, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  const alpha = Math.max(0, Math.min(1, opacity));
  return "rgba(" + red + "," + green + "," + blue + "," + alpha + ")";
}

export function buildLayout(args: {
  dataset: Dataset;
  figure: FigureSpec;
  preset: PresetDefinition;
  displayText?: {
    plotTitle?: string;
    xTitle?: string;
    yTitle?: string;
    rightYTitle?: string;
  };
}) {
  const { dataset, figure, preset, displayText } = args;
  const overrides = figure.figureOverrides;
  const canvas = resolveCanvasMm(preset, figure);
  const fontFamily = plotFontFamily(overrides.fontFamily || preset.fontFamily);
  const fontSizePt = overrides.fontSizePt ?? preset.fontSizePt;
  const fontSizePx = ptToPx(fontSizePt);
  const axisStyle = overrides.axisStyle ?? "regular";
  const axisWidthPt =
    axisStyle === "bold"
      ? Math.max(1, preset.axisWidthPt * 1.45)
      : preset.axisWidthPt;
  const axisWidthPx = ptToPx(axisWidthPt);
  const majorTickLengthPt = axisStyle === "bold" ? 5 : 3.5;
  const minorTickLengthPt = axisStyle === "bold" ? 3 : 2;
  const tickLabelSizePx = ptToPx(
    overrides.tickLabelSizePt ?? fontSizePt * 0.96
  );
  const axisTitleSizePx = ptToPx(
    overrides.axisTitleSizePt ?? fontSizePt * 1.08
  );
  const plotTitleSizePx = ptToPx(
    overrides.plotTitleSizePt ?? fontSizePt * 1.18
  );
  const background = overrides.background ?? "#ffffff";
  const tickDirection = overrides.tickDirection ?? "outside";
  const gridVisible = overrides.gridVisible ?? preset.showGrid;
  const legendPositionMode =
    overrides.legendPosition ??
    (figure.templateId === "double-y" ? "top-left" : "top-right");
  const presetLegendPosition = legendAnchor(legendPositionMode);
  const legendPosition =
    legendPositionMode === "custom"
      ? {
          x: overrides.legendX ?? presetLegendPosition.x,
          y: overrides.legendY ?? presetLegendPosition.y,
          xanchor: overrides.legendXAnchor ?? "left",
          yanchor: overrides.legendYAnchor ?? "top"
        }
      : presetLegendPosition;
  const legendOrientation = overrides.legendOrientation ?? "vertical";
  const legendColumns = Math.max(1, overrides.legendColumns ?? 1);
  const xIsCategorical = dataset.x.values.some(
    (value) => typeof value === "string"
  );
  const xScale = xIsCategorical ? "linear" : overrides.xScale ?? "linear";
  const yScale = overrides.yScale ?? "linear";
  const rightYScale = overrides.rightYScale ?? "linear";
  const isDoubleY = figure.templateId === "double-y";
  const isField2D =
    figure.templateId === "heatmap" || figure.templateId === "contour";
  const fieldSeriesForTicks = isField2D
    ? orderSeries(
        dataset,
        figure.seriesOrder,
        figure.dataRef?.yColumnIds
      )
    : [];
  const fieldExtendsCells = figure.templateId === "heatmap";
  const fieldXTickRange =
    isField2D && !xIsCategorical
      ? coordinateExtent(
          finiteNumericValues(dataset.x.values),
          fieldExtendsCells
        )
      : undefined;
  const fieldYTickRange = isField2D
    ? coordinateExtent(
        resolveFieldRowCoordinates(dataset, fieldSeriesForTicks),
        fieldExtendsCells
      )
    : undefined;
  const continuousXY =
    !isField2D &&
    figure.templateId !== "surface-3d" &&
    figure.templateId !== "bar" &&
    figure.templateId !== "grouped-bar" &&
    figure.templateId !== "stacked-bar";
  const rangeTraces: any[] = continuousXY
    ? (buildTraces({ dataset, figure, preset }) as any[])
    : [];
  const autoXValues: number[] = [];
  const autoLeftYValues: number[] = [];
  const autoRightYValues: number[] = [];

  for (const trace of rangeTraces) {
    autoXValues.push(...finiteNumericValues(Array.isArray(trace.x) ? trace.x : []));
    const yValues = Array.isArray(trace.y) ? trace.y : [];
    const targetY =
      isDoubleY && trace.yaxis === "y2"
        ? autoRightYValues
        : autoLeftYValues;
    const errors =
      Array.isArray(trace.error_y?.array) ? trace.error_y.array : undefined;

    for (let index = 0; index < yValues.length; index += 1) {
      const value = yValues[index];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const error = errors?.[index];
      if (typeof error === "number" && Number.isFinite(error)) {
        targetY.push(value - Math.abs(error), value + Math.abs(error));
      } else {
        targetY.push(value);
      }
    }
  }

  const xRange = xIsCategorical
    ? undefined
    : overrides.xAutoRange === false
    ? rangeFor(
        false,
        overrides.xMin,
        overrides.xMax,
        xScale,
        overrides.xReverse ?? false
      )
    : continuousXY
    ? matplotlibAutoRange(
        autoXValues,
        xScale,
        overrides.xReverse ?? false
      )
    : undefined;
  const yRange =
    overrides.yAutoRange === false
      ? rangeFor(
          false,
          overrides.yMin,
          overrides.yMax,
          yScale,
          overrides.yReverse ?? false
        )
      : continuousXY
      ? matplotlibAutoRange(
          autoLeftYValues,
          yScale,
          overrides.yReverse ?? false
        )
      : undefined;
  const rightYRange =
    overrides.rightYAutoRange === false
      ? rangeFor(
          false,
          overrides.rightYMin,
          overrides.rightYMax,
          rightYScale,
          overrides.rightYReverse ?? false
        )
      : isDoubleY
      ? matplotlibAutoRange(
          autoRightYValues,
          rightYScale,
          overrides.rightYReverse ?? false
        )
      : undefined;
  const xAutoTickStep =
    !xIsCategorical &&
    xScale === "linear" &&
    !overrides.xMajorTickStep
      ? matplotlibNiceTickStep(xRange ?? fieldXTickRange)
      : undefined;
  const yAutoTickStep =
    yScale === "linear" && !overrides.yMajorTickStep
      ? matplotlibNiceTickStep(yRange ?? fieldYTickRange)
      : undefined;
  const rightYAutoTickStep =
    rightYScale === "linear" && !overrides.rightYMajorTickStep
      ? matplotlibNiceTickStep(rightYRange)
      : undefined;

  const commonAxis = {
    showline: true,
    mirror: true,
    linewidth: axisWidthPx,
    linecolor: "#202328",
    ticks: tickDirection,
    ticklen: ptToPx(majorTickLengthPt),
    tickwidth: axisWidthPx,
    tickcolor: "#202328",
    tickfont: {
      family: fontFamily,
      size: tickLabelSizePx,
      color: overrides.tickLabelColor ?? "#17191c"
    },
    showgrid: gridVisible,
    gridcolor: "#e3e6e9",
    gridwidth: 0.45,
    zeroline: false,
    automargin: true,
    minor: {
      ticks: overrides.minorTicks ? tickDirection : "",
      ticklen: overrides.minorTicks ? ptToPx(minorTickLengthPt) : 0,
      tickwidth: axisWidthPx * 0.85,
      showgrid: false
    }
  };

  const doubleYAxisSeries = isDoubleY
    ? orderSeries(
        dataset,
        figure.seriesOrder,
        figure.dataRef?.yColumnIds
      ).filter(
        (series) => figure.seriesOverrides[series.id]?.visible !== false
      )
    : [];
  const doubleYAxisSide = (series: PlotColumn) => {
    const orderIndex = figure.seriesOrder.indexOf(series.id);
    const sourceIndex = Math.max(
      0,
      dataset.ys.findIndex((item) => item.id === series.id)
    );
    const stableIndex = orderIndex >= 0 ? orderIndex : sourceIndex;
    return (
      figure.seriesOverrides[series.id]?.yAxis ??
      (stableIndex === 0 ? "left" : "right")
    );
  };
  const leftSeries = doubleYAxisSeries.filter(
    (series) => doubleYAxisSide(series) === "left"
  );
  const rightSeries = doubleYAxisSeries.filter(
    (series) => doubleYAxisSide(series) === "right"
  );
  const seriesColor = (series: PlotColumn | undefined) => {
    if (!series) return "#17191c";
    const sourceIndex = Math.max(
      0,
      dataset.ys.findIndex((item) => item.id === series.id)
    );
    return (
      figure.seriesOverrides[series.id]?.color ??
      preset.palette[sourceIndex % preset.palette.length]
    );
  };
  const leftYColor = seriesColor(leftSeries[0]);
  const rightYColor = seriesColor(rightSeries[0]);
  const automaticLegendSeriesCount =
    figure.templateId === "bar" || figure.templateId === "xy-errorbar"
      ? Math.min(1, visibleSeries(dataset, figure).length)
      : visibleSeries(dataset, figure).length;
  const effectiveLegendVisible =
    !isField2D &&
    figure.templateId !== "surface-3d" &&
    (overrides.legendVisible ?? automaticLegendSeriesCount > 1);
  const outsideRightLegend =
    effectiveLegendVisible && legendPositionMode === "outside-right";

  const emptyFigure = dataset.id === "__empty__";
  const resolvedXTitle = normalizePlotlyMathText(
    displayText?.xTitle ??
      overrides.xTitle ??
      (emptyFigure ? "" : autoAxisTitle(dataset.x.name, dataset.x.unit))
  );
  const resolvedYTitle = normalizePlotlyMathText(
    displayText?.yTitle ??
      overrides.yTitle ??
      (emptyFigure
        ? ""
        : isField2D || figure.templateId === "surface-3d"
        ? autoAxisTitle(
            dataset.metadata?.rowAxisName ?? "纵向位置",
            dataset.metadata?.rowAxisUnit
          )
        : isDoubleY && leftSeries[0]
        ? autoAxisTitle(leftSeries[0].name, leftSeries[0].unit)
        : dataset.ys[0]
        ? autoAxisTitle(dataset.ys[0].name, dataset.ys[0].unit)
        : "")
  );
  const resolvedRightYTitle = normalizePlotlyMathText(
    displayText?.rightYTitle ??
      overrides.rightYTitle ??
      (rightSeries[0]
        ? autoAxisTitle(rightSeries[0].name, rightSeries[0].unit)
        : "右 Y")
  );
  const resolvedPlotTitle = normalizePlotlyMathText(
    displayText?.plotTitle ?? overrides.plotTitle
  );
  const hasXTitle = Boolean(String(resolvedXTitle ?? "").trim());
  const hasYTitle = Boolean(String(resolvedYTitle ?? "").trim());
  const hasPlotTitle = Boolean(String(resolvedPlotTitle ?? "").trim());

  const layout: any = {
    width: Math.round(mmToPx(canvas.widthMm)),
    height: Math.round(mmToPx(canvas.heightMm)),
    autosize: false,
    margin: {
      // These are minimum content-safe margins, not decorative whitespace.
      // automargin may only expand them when real tick/title content requires it.
      l: Math.round(mmToPx(hasYTitle ? 10.2 : 6.2)),
      r: Math.round(
        mmToPx(
          outsideRightLegend
            ? 22
            : isDoubleY
            ? 10.2
            : isField2D || figure.templateId === "surface-3d"
            ? 8
            : 2.2
        )
      ),
      t: Math.round(mmToPx(hasPlotTitle ? 7.2 : 2.2)),
      b: Math.round(mmToPx(hasXTitle ? 9.2 : 5.8)),
      pad: 0,
      autoexpand: true
    },
    paper_bgcolor: background,
    plot_bgcolor: background,
    title: overrides.plotTitle
      ? {
          text: resolvedPlotTitle,
          x: 0.5,
          xanchor: "center",
          y: 0.985,
          yanchor: "top",
          automargin: true,
          pad: { t: 2, b: 2, l: 0, r: 0 },
          font: {
            family: fontFamily,
            size: plotTitleSizePx,
            color: overrides.plotTitleColor ?? "#17191c"
          }
        }
      : undefined,
    showlegend: effectiveLegendVisible,
    hovermode: "closest",
    dragmode: figure.templateId === "surface-3d" ? "orbit" : "zoom",
    uirevision: figure.id,
    font: {
      family: fontFamily,
      size: fontSizePx,
      color: "#17191c"
    },
    legend: {
      ...legendPosition,
      orientation: legendOrientation === "horizontal" ? "h" : "v",
      bgcolor: overrides.legendBackground
        ? rgba(
            overrides.legendBackground,
            overrides.legendBackgroundOpacity ?? 1
          )
        : overrides.legendFrame
        ? "rgba(255,255,255,0.90)"
        : "rgba(255,255,255,0)",
      bordercolor: overrides.legendBorderColor ?? "#cdd2d7",
      borderwidth: overrides.legendFrame
        ? ptToPx(overrides.legendBorderWidthPt ?? 0.6)
        : 0,
      traceorder: "normal",
      itemsizing: "constant",
      itemwidth: Math.max(30, overrides.legendItemWidthPx ?? 30),
      entrywidthmode:
        legendOrientation === "horizontal" && legendColumns > 1
          ? "fraction"
          : undefined,
      entrywidth:
        legendOrientation === "horizontal" && legendColumns > 1
          ? 1 / legendColumns
          : undefined,
      font: {
        family: fontFamily,
        size: ptToPx(
          overrides.legendFontSizePt ?? fontSizePt * 0.94
        ),
        color: overrides.legendFontColor ?? "#17191c"
      }
    },
    barmode: figure.templateId === "stacked-bar" ? "stack" : "group",
    bargap: overrides.barGap ?? 0.2,
    bargroupgap: overrides.barGroupGap ?? 0.08
  };

  if (figure.templateId === "surface-3d") {
    layout.scene = {
      bgcolor: background,
      xaxis: {
        title: {
          text: resolvedXTitle,
          font: {
            family: fontFamily,
            size: axisTitleSizePx,
            color: overrides.axisTitleColor ?? "#17191c"
          }
        },
        showbackground: true,
        backgroundcolor: "#f3f3f3",
        showline: true,
        linecolor: "#555b61",
        linewidth: ptToPx(0.65),
        gridcolor: "#d8dadd",
        gridwidth: 1,
        zeroline: false,
        ticks: "outside",
        ticklen: ptToPx(3.5),
        tickcolor: "#4a4f54",
        tickfont: {
          family: fontFamily,
          size: tickLabelSizePx,
          color: overrides.tickLabelColor ?? "#17191c"
        }
      },
      yaxis: {
        title: {
          text: resolvedYTitle,
          font: {
            family: fontFamily,
            size: axisTitleSizePx,
            color: overrides.axisTitleColor ?? "#17191c"
          }
        },
        showbackground: true,
        backgroundcolor: "#f3f3f3",
        showline: true,
        linecolor: "#555b61",
        linewidth: ptToPx(0.65),
        gridcolor: "#d8dadd",
        gridwidth: 1,
        zeroline: false,
        ticks: "outside",
        ticklen: ptToPx(3.5),
        tickcolor: "#4a4f54",
        tickfont: {
          family: fontFamily,
          size: tickLabelSizePx,
          color: overrides.tickLabelColor ?? "#17191c"
        }
      },
      zaxis: {
        title: {
          text: normalizePlotlyMathText(overrides.zTitle ?? "Z"),
          font: {
            family: fontFamily,
            size: axisTitleSizePx,
            color: overrides.axisTitleColor ?? "#17191c"
          }
        },
        showbackground: true,
        backgroundcolor: "#f3f3f3",
        showline: true,
        linecolor: "#555b61",
        linewidth: ptToPx(0.65),
        gridcolor: "#d8dadd",
        gridwidth: 1,
        zeroline: false,
        ticks: "outside",
        ticklen: ptToPx(3.5),
        tickcolor: "#4a4f54",
        tickfont: {
          family: fontFamily,
          size: tickLabelSizePx,
          color: overrides.tickLabelColor ?? "#17191c"
        }
      },
      camera: {
        eye: { x: 1.45, y: 1.45, z: 1.12 }
      },
      aspectmode: "manual",
      aspectratio: { x: 1, y: 1, z: 0.75 }
    };
    return layout;
  }

  layout.xaxis = {
    ...commonAxis,
    type: xIsCategorical ? "category" : xScale,
    autorange: xRange
      ? false
      : overrides.xReverse
      ? "reversed"
      : true,
    range: xRange,
    title: {
      text: resolvedXTitle,
      standoff: Math.round(mmToPx(0.9)),
      font: {
        family: fontFamily,
        size: axisTitleSizePx,
        color: overrides.axisTitleColor ?? "#17191c"
      }
    },
    dtick:
      !xIsCategorical &&
      overrides.xMajorTickStep &&
      overrides.xMajorTickStep > 0
        ? overrides.xMajorTickStep
        : xAutoTickStep,
    tickformat: xIsCategorical
      ? undefined
      : tickFormatString(
          overrides.xTickFormat,
          overrides.xTickDecimals
        ),
    tickprefix: overrides.xTickPrefix || undefined,
    ticksuffix: overrides.xTickSuffix || undefined,
    tickangle: overrides.xTickAngle ?? 0,
    minor: {
      ...commonAxis.minor,
      dtick:
        !xIsCategorical &&
        overrides.minorTicks &&
        overrides.xMinorTickStep &&
        overrides.xMinorTickStep > 0
          ? overrides.xMinorTickStep
          : undefined
    }
  };

  layout.yaxis = {
    ...commonAxis,
    mirror: isDoubleY ? false : commonAxis.mirror,
    type: yScale,
    autorange: yRange
      ? false
      : overrides.yReverse
      ? "reversed"
      : true,
    range: yRange,
    tickcolor: isDoubleY ? leftYColor : commonAxis.tickcolor,
    tickfont: {
      ...commonAxis.tickfont,
      color:
        overrides.tickLabelColor ??
        (isDoubleY ? leftYColor : "#17191c")
    },
    title: {
      text: resolvedYTitle,
      standoff: Math.round(mmToPx(0.7)),
      font: {
        family: fontFamily,
        size: axisTitleSizePx,
        color:
          overrides.axisTitleColor ??
          (isDoubleY ? leftYColor : "#17191c")
      }
    },
    dtick:
      overrides.yMajorTickStep && overrides.yMajorTickStep > 0
        ? overrides.yMajorTickStep
        : yAutoTickStep,
    tickformat: tickFormatString(
      overrides.yTickFormat,
      overrides.yTickDecimals
    ),
    tickprefix: overrides.yTickPrefix || undefined,
    ticksuffix: overrides.yTickSuffix || undefined,
    tickangle: overrides.yTickAngle ?? 0,
    minor: {
      ...commonAxis.minor,
      dtick:
        overrides.minorTicks &&
        overrides.yMinorTickStep &&
        overrides.yMinorTickStep > 0
          ? overrides.yMinorTickStep
          : undefined
    }
  };

  if (isDoubleY) {
    layout.yaxis2 = {
      ...commonAxis,
      mirror: false,
      overlaying: "y",
      side: "right",
      type: rightYScale,
      autorange: rightYRange
        ? false
        : overrides.rightYReverse
        ? "reversed"
        : true,
      range: rightYRange,
      tickcolor: rightYColor,
      tickfont: {
        ...commonAxis.tickfont,
        color: overrides.tickLabelColor ?? rightYColor
      },
      title: {
        text: resolvedRightYTitle,
        standoff: Math.round(mmToPx(0.7)),
        font: {
          family: fontFamily,
          size: axisTitleSizePx,
          color: overrides.axisTitleColor ?? rightYColor
        }
      },
      showgrid: false,
      dtick:
        overrides.rightYMajorTickStep &&
        overrides.rightYMajorTickStep > 0
          ? overrides.rightYMajorTickStep
          : rightYAutoTickStep,
      tickformat: tickFormatString(
        overrides.rightYTickFormat,
        overrides.rightYTickDecimals
      ),
      tickprefix: overrides.rightYTickPrefix || undefined,
      ticksuffix: overrides.rightYTickSuffix || undefined,
      tickangle: overrides.rightYTickAngle ?? 0,
      minor: {
        ...commonAxis.minor,
        showgrid: false,
        dtick:
          overrides.minorTicks &&
          overrides.rightYMinorTickStep &&
          overrides.rightYMinorTickStep > 0
            ? overrides.rightYMinorTickStep
            : undefined
      }
    };
  }

  const equalFieldAspect =
    overrides.fieldEqualAspect ??
    (figure.templateId === "heatmap");
  if (isField2D && equalFieldAspect) {
    layout.xaxis.scaleanchor = "y";
    layout.xaxis.scaleratio = 1;
    layout.yaxis.constrain = "domain";
  }

  return layout;
}
