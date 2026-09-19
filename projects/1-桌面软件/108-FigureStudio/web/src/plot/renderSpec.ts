import type {
  Column,
  Dataset,
  FigureSpec,
  LegendPosition,
  PresetDefinition
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
    return '"Times New Roman", "Songti SC", "SimSun", serif';
  }
  return 'Arial, "Microsoft YaHei", "PingFang SC", sans-serif';
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

export function orderSeries(dataset: Dataset, seriesOrder: string[]): Column[] {
  const byId = new Map(dataset.ys.map((series) => [series.id, series]));
  const ordered = seriesOrder
    .map((id) => byId.get(id))
    .filter((series): series is Column => Boolean(series));

  for (const series of dataset.ys) {
    if (!ordered.some((item) => item.id === series.id)) ordered.push(series);
  }

  return ordered;
}

function legendAnchor(position: LegendPosition) {
  const map: Record<
    LegendPosition,
    { x: number; y: number; xanchor: string; yanchor: string }
  > = {
    "top-left": { x: 0.02, y: 0.985, xanchor: "left", yanchor: "top" },
    "top-center": { x: 0.5, y: 0.985, xanchor: "center", yanchor: "top" },
    "top-right": { x: 0.98, y: 0.985, xanchor: "right", yanchor: "top" },
    "bottom-left": { x: 0.02, y: 0.02, xanchor: "left", yanchor: "bottom" },
    "bottom-center": { x: 0.5, y: 0.02, xanchor: "center", yanchor: "bottom" },
    "bottom-right": { x: 0.98, y: 0.02, xanchor: "right", yanchor: "bottom" }
  };
  return map[position];
}

function visibleSeries(dataset: Dataset, figure: FigureSpec): Column[] {
  return orderSeries(dataset, figure.seriesOrder).filter(
    (series) => figure.seriesOverrides[series.id]?.visible !== false
  );
}

function baseXYTrace(
  dataset: Dataset,
  figure: FigureSpec,
  preset: PresetDefinition,
  series: Column,
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

  let mode = "";
  if (lineVisible) mode += "lines";
  if (markerVisible) mode += (mode ? "+" : "") + "markers";
  if (!mode) mode = "lines";

  return {
    type: "scatter",
    mode,
    name: series.name,
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
        color: "#ffffff",
        width: 0.35
      }
    },
    hovertemplate:
      "<b>" +
      series.name +
      "</b><br>" +
      dataset.x.name +
      "：%{x:.4g}" +
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
  const series = visibleSeries(dataset, figure);
  const template = figure.templateId;

  if (template === "heatmap") {
    return [
      {
        type: "heatmap",
        x: dataset.x.values,
        y:
          dataset.metadata?.rowCoordinates ??
          series.map((_, index) => index),
        z: series.map((column) => column.values),
        colorscale: figure.figureOverrides.colorScale ?? "Viridis",
        reversescale: figure.figureOverrides.reverseColorScale ?? false,
        colorbar: {
          thickness: 12,
          outlinewidth: 0,
          len: 0.86
        },
        hovertemplate: "X=%{x:.4g}<br>Y=%{y:.4g}<br>Z=%{z:.4g}<extra></extra>"
      }
    ];
  }

  if (template === "surface-3d") {
    return [
      {
        type: "surface",
        x: dataset.x.values,
        y:
          dataset.metadata?.rowCoordinates ??
          series.map((_, index) => index),
        z: series.map((column) => column.values),
        colorscale: figure.figureOverrides.colorScale ?? "Viridis",
        reversescale: figure.figureOverrides.reverseColorScale ?? false,
        showscale: true,
        colorbar: {
          thickness: 12,
          outlinewidth: 0,
          len: 0.76
        },
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
      return {
        type: "bar",
        name: column.name,
        x: dataset.x.values,
        y: column.values,
        opacity: override.opacity ?? 0.92,
        marker: {
          color:
            override.color ||
            preset.palette[sourceIndex % preset.palette.length],
          line: {
            color: "#ffffff",
            width: 0.3
          }
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
        thickness: 0.8,
        width: 2
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

  return series.map((column, index) => {
    const sourceIndex = Math.max(
      0,
      dataset.ys.findIndex((item) => item.id === column.id)
    );
    const yValues =
      offsetStep === 0
        ? undefined
        : column.values.map((value) =>
            value === null ? null : value + index * offsetStep
          );

    return baseXYTrace(
      dataset,
      figure,
      preset,
      column,
      sourceIndex,
      modeDefault,
      yValues
    );
  });
}

function rangeFor(
  autoRange: boolean | undefined,
  minValue: number | undefined,
  maxValue: number | undefined,
  scale: "linear" | "log"
) {
  if (autoRange !== false) return undefined;
  if (
    minValue === undefined ||
    maxValue === undefined ||
    !Number.isFinite(minValue) ||
    !Number.isFinite(maxValue)
  ) {
    return undefined;
  }

  if (scale === "log") {
    if (minValue <= 0 || maxValue <= 0) return undefined;
    return [Math.log10(minValue), Math.log10(maxValue)];
  }

  return [minValue, maxValue];
}

export function buildLayout(args: {
  dataset: Dataset;
  figure: FigureSpec;
  preset: PresetDefinition;
}) {
  const { dataset, figure, preset } = args;
  const overrides = figure.figureOverrides;
  const canvas = resolveCanvasMm(preset, figure);
  const fontFamily = plotFontFamily(overrides.fontFamily || preset.fontFamily);
  const fontSizePt = overrides.fontSizePt ?? preset.fontSizePt;
  const fontSizePx = ptToPx(fontSizePt);
  const axisWidthPx = ptToPx(preset.axisWidthPt);
  const background = overrides.background ?? "#ffffff";
  const tickDirection = overrides.tickDirection ?? "inside";
  const gridVisible = overrides.gridVisible ?? preset.showGrid;
  const legendPosition = legendAnchor(
    overrides.legendPosition ?? "top-left"
  );
  const legendOrientation = overrides.legendOrientation ?? "horizontal";
  const legendColumns = Math.max(1, overrides.legendColumns ?? 1);
  const xScale = overrides.xScale ?? "linear";
  const yScale = overrides.yScale ?? "linear";
  const xRange = rangeFor(
    overrides.xAutoRange,
    overrides.xMin,
    overrides.xMax,
    xScale
  );
  const yRange = rangeFor(
    overrides.yAutoRange,
    overrides.yMin,
    overrides.yMax,
    yScale
  );

  const commonAxis = {
    showline: true,
    mirror: true,
    linewidth: axisWidthPx,
    linecolor: "#202328",
    ticks: tickDirection,
    ticklen: ptToPx(3.6),
    tickwidth: axisWidthPx,
    tickcolor: "#202328",
    showgrid: gridVisible,
    gridcolor: "#e3e6e9",
    gridwidth: 0.45,
    zeroline: false,
    automargin: false,
    minor: {
      ticks: overrides.minorTicks ? tickDirection : "",
      ticklen: overrides.minorTicks ? ptToPx(2.2) : 0,
      tickwidth: axisWidthPx * 0.85,
      showgrid: false
    }
  };

  const layout: any = {
    width: Math.round(mmToPx(canvas.widthMm)),
    height: Math.round(mmToPx(canvas.heightMm)),
    autosize: false,
    margin: {
      l: Math.round(mmToPx(14)),
      r: Math.round(mmToPx(
        figure.templateId === "heatmap" || figure.templateId === "surface-3d"
          ? 12
          : 4.5
      )),
      t: Math.round(mmToPx(5.5)),
      b: Math.round(mmToPx(12.5)),
      pad: 0
    },
    paper_bgcolor: background,
    plot_bgcolor: background,
    showlegend: overrides.legendVisible ?? true,
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
      bgcolor: overrides.legendFrame
        ? "rgba(255,255,255,0.90)"
        : "rgba(255,255,255,0)",
      bordercolor: "#cdd2d7",
      borderwidth: overrides.legendFrame ? 0.6 : 0,
      traceorder: "normal",
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
        size: fontSizePx * 0.92
      }
    },
    barmode: figure.templateId === "stacked-bar" ? "stack" : "group"
  };

  if (figure.templateId === "surface-3d") {
    layout.scene = {
      bgcolor: background,
      xaxis: {
        title: overrides.xTitle ?? dataset.x.name,
        gridcolor: "#e3e6e9",
        zeroline: false,
        showbackground: false
      },
      yaxis: {
        title:
          overrides.yTitle ??
          dataset.metadata?.rowAxisName ??
          "Y",
        gridcolor: "#e3e6e9",
        zeroline: false,
        showbackground: false
      },
      zaxis: {
        title: "Z",
        gridcolor: "#e3e6e9",
        zeroline: false,
        showbackground: false
      },
      camera: {
        eye: { x: 1.45, y: 1.45, z: 1.12 }
      },
      aspectmode: "auto"
    };
    return layout;
  }

  layout.xaxis = {
    ...commonAxis,
    type: xScale,
    autorange: xRange ? false : true,
    range: xRange,
    title: {
      text: overrides.xTitle ?? dataset.x.name,
      standoff: Math.round(mmToPx(1.8)),
      font: { family: fontFamily, size: fontSizePx * 1.02 }
    }
  };

  layout.yaxis = {
    ...commonAxis,
    type: yScale,
    autorange: yRange ? false : true,
    range: yRange,
    title: {
      text:
        overrides.yTitle ??
        (figure.templateId === "heatmap"
          ? dataset.metadata?.rowAxisName ?? "Y"
          : dataset.ys[0]?.name ?? "Y"),
      standoff: Math.round(mmToPx(1.5)),
      font: { family: fontFamily, size: fontSizePx * 1.02 }
    }
  };

  if (figure.templateId === "heatmap") {
    layout.xaxis.scaleanchor = "y";
    layout.xaxis.scaleratio = 1;
  }

  return layout;
}
