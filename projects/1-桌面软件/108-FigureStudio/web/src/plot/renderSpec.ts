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
    return '"Times New Roman", "Songti SC", "SimSun", serif';
  }
  return 'Arial, "Microsoft YaHei", "PingFang SC", sans-serif';
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

export function orderSeries(dataset: Dataset, seriesOrder: string[]): PlotColumn[] {
  const byId = new Map(dataset.ys.map((series) => [series.id, series]));
  const ordered = seriesOrder
    .map((id) => byId.get(id))
    .filter((series): series is PlotColumn => Boolean(series));

  for (const series of dataset.ys) {
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
    "bottom-right": { x: 0.98, y: 0.02, xanchor: "right", yanchor: "bottom" }
  };
  if (position === "custom") {
    return { x: 0.02, y: 0.985, xanchor: "left", yanchor: "top" };
  }
  return map[position];
}

function visibleSeries(dataset: Dataset, figure: FigureSpec): PlotColumn[] {
  return orderSeries(dataset, figure.seriesOrder).filter(
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
    name: override.legendLabel ?? series.name,
    showlegend: override.showInLegend ?? true,
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
    const surfaceX = dataset.x.values.every(
      (value) => value === null || typeof value === "number"
    )
      ? dataset.x.values
      : dataset.x.values.map((_value, index) => index + 1);
    return [
      {
        type: "surface",
        x: surfaceX,
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
      return {
        type: "bar",
        name: override.legendLabel ?? column.name,
        showlegend: override.showInLegend ?? true,
        x: dataset.x.values,
        y: column.values,
        opacity: override.opacity ?? 0.92,
        marker: {
          color: markerColor,
          line: {
            color: override.barBorderColor ?? fillColor,
            width: ptToPx(override.barBorderWidthPt ?? 0.3)
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
  scale: "linear" | "log",
  reverse: boolean
) {
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

  const range =
    scale === "log"
      ? minValue > 0 && maxValue > 0
        ? [Math.log10(minValue), Math.log10(maxValue)]
        : undefined
      : [minValue, maxValue];

  return range && reverse ? [range[1], range[0]] : range;
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
  const majorTickLengthPt = axisStyle === "bold" ? 5 : 3.6;
  const minorTickLengthPt = axisStyle === "bold" ? 3.1 : 2.2;
  const tickLabelSizePx = ptToPx(
    overrides.tickLabelSizePt ?? fontSizePt
  );
  const axisTitleSizePx = ptToPx(
    overrides.axisTitleSizePt ?? fontSizePt * 1.02
  );
  const plotTitleSizePx = ptToPx(
    overrides.plotTitleSizePt ?? fontSizePt * 1.12
  );
  const background = overrides.background ?? "#ffffff";
  const tickDirection = overrides.tickDirection ?? "inside";
  const gridVisible = overrides.gridVisible ?? preset.showGrid;
  const legendPositionMode = overrides.legendPosition ?? "top-left";
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
  const legendOrientation = overrides.legendOrientation ?? "horizontal";
  const legendColumns = Math.max(1, overrides.legendColumns ?? 1);
  const xIsCategorical = dataset.x.values.some(
    (value) => typeof value === "string"
  );
  const xScale = xIsCategorical ? "linear" : overrides.xScale ?? "linear";
  const yScale = overrides.yScale ?? "linear";
  const xRange = xIsCategorical
    ? undefined
    : rangeFor(
        overrides.xAutoRange,
        overrides.xMin,
        overrides.xMax,
        xScale,
        overrides.xReverse ?? false
      );
  const yRange = rangeFor(
    overrides.yAutoRange,
    overrides.yMin,
    overrides.yMax,
    yScale,
    overrides.yReverse ?? false
  );

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

  const resolvedXTitle =
    displayText?.xTitle ??
    overrides.xTitle ??
    autoAxisTitle(dataset.x.name, dataset.x.unit);
  const resolvedYTitle =
    displayText?.yTitle ??
    overrides.yTitle ??
    (figure.templateId === "heatmap"
      ? dataset.metadata?.rowAxisName ?? "Y"
      : dataset.ys[0]
      ? autoAxisTitle(dataset.ys[0].name, dataset.ys[0].unit)
      : "Y");
  const hasXTitle = Boolean(String(resolvedXTitle ?? "").trim());
  const hasYTitle = Boolean(String(resolvedYTitle ?? "").trim());
  const hasPlotTitle = Boolean(String(displayText?.plotTitle ?? overrides.plotTitle ?? "").trim());

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
          figure.templateId === "heatmap" ||
            figure.templateId === "surface-3d"
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
          text: displayText?.plotTitle ?? overrides.plotTitle,
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
          overrides.legendFontSizePt ?? fontSizePt * 0.92
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
        gridcolor: "#e3e6e9",
        zeroline: false,
        showbackground: false
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
        gridcolor: "#e3e6e9",
        zeroline: false,
        showbackground: false
      },
      zaxis: {
        title: {
          text: overrides.zTitle ?? "Z",
          font: {
            family: fontFamily,
            size: axisTitleSizePx,
            color: overrides.axisTitleColor ?? "#17191c"
          }
        },
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
        : undefined,
    tickformat: xIsCategorical
      ? undefined
      : tickFormatString(
          overrides.xTickFormat,
          overrides.xTickDecimals
        ),
    tickprefix: overrides.xTickPrefix || undefined,
    ticksuffix: overrides.xTickSuffix || undefined,
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
    type: yScale,
    autorange: yRange
      ? false
      : overrides.yReverse
      ? "reversed"
      : true,
    range: yRange,
    title: {
      text:
        resolvedYTitle,
      standoff: Math.round(mmToPx(0.7)),
      font: {
        family: fontFamily,
        size: axisTitleSizePx,
        color: overrides.axisTitleColor ?? "#17191c"
      }
    },
    dtick:
      overrides.yMajorTickStep && overrides.yMajorTickStep > 0
        ? overrides.yMajorTickStep
        : undefined,
    tickformat: tickFormatString(
      overrides.yTickFormat,
      overrides.yTickDecimals
    ),
    tickprefix: overrides.yTickPrefix || undefined,
    ticksuffix: overrides.yTickSuffix || undefined,
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

  if (figure.templateId === "heatmap") {
    layout.xaxis.scaleanchor = "y";
    layout.xaxis.scaleratio = 1;
  }

  return layout;
}
