import type {
  AspectMode,
  Column,
  Dataset,
  FigureOverrides,
  PresetDefinition,
  SeriesOverride
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
  mode: AspectMode = "4:3",
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
  figureOverrides: FigureOverrides
) {
  const aspectMode = figureOverrides.aspectMode ?? "4:3";
  const ratio = aspectRatioFor(
    aspectMode,
    figureOverrides.customAspectWidth,
    figureOverrides.customAspectHeight
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

export function buildTraces(args: {
  dataset: Dataset;
  orderedSeries: Column[];
  preset: PresetDefinition;
  seriesOverrides: Record<string, SeriesOverride>;
}) {
  const { dataset, orderedSeries, preset, seriesOverrides } = args;

  return orderedSeries.map((series) => {
    const sourceIndex = Math.max(
      0,
      dataset.ys.findIndex((item) => item.id === series.id)
    );
    const override = seriesOverrides[series.id] || {};
    const lineWidthPt = override.lineWidthPt ?? preset.lineWidthPt;
    const markerVisible = override.markerVisible ?? false;
    const markerSizePt = override.markerSizePt ?? preset.markerSizePt;
    const color = override.color || preset.palette[sourceIndex % preset.palette.length];
    const opacity = override.opacity ?? 1;
    const isFit = /fit|拟合/i.test(series.name);

    return {
      type: "scatter",
      mode: markerVisible ? "lines+markers" : "lines",
      name: series.name,
      x: dataset.x.values,
      y: series.values,
      opacity,
      line: {
        color,
        width: ptToPx(isFit ? Math.max(0.65, lineWidthPt * 0.9) : lineWidthPt),
        dash: isFit ? "dash" : "solid"
      },
      marker: {
        color,
        size: ptToPx(markerSizePt),
        symbol: "circle",
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
        "：%{x:.4f}" +
        (dataset.x.unit ? " " + dataset.x.unit : "") +
        "<br>" +
        (series.unit ? "%{y:.3f} " + series.unit : "%{y:.3f}") +
        "<extra></extra>"
    };
  });
}

export function buildLayout(args: {
  preset: PresetDefinition;
  figureOverrides: FigureOverrides;
  xTitle: string;
  yTitle: string;
}) {
  const { preset, figureOverrides, xTitle, yTitle } = args;
  const canvas = resolveCanvasMm(preset, figureOverrides);
  const fontFamily = plotFontFamily(figureOverrides.fontFamily || preset.fontFamily);
  const fontSizePt = figureOverrides.fontSizePt ?? preset.fontSizePt;
  const fontSizePx = ptToPx(fontSizePt);
  const axisWidthPx = ptToPx(preset.axisWidthPt);

  return {
    width: Math.round(mmToPx(canvas.widthMm)),
    height: Math.round(mmToPx(canvas.heightMm)),
    autosize: false,
    margin: {
      l: Math.round(mmToPx(14)),
      r: Math.round(mmToPx(4.5)),
      t: Math.round(mmToPx(5.5)),
      b: Math.round(mmToPx(12.5)),
      pad: 0
    },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    showlegend: figureOverrides.legendVisible ?? true,
    hovermode: "closest",
    dragmode: "zoom",
    uirevision: "figurestudio-wysiwyg-v3",
    font: {
      family: fontFamily,
      size: fontSizePx,
      color: "#17191c"
    },
    legend: {
      orientation: "h",
      x: 0.025,
      y: 0.985,
      xanchor: "left",
      yanchor: "top",
      bgcolor: "rgba(255,255,255,0)",
      borderwidth: 0,
      traceorder: "normal",
      font: {
        family: fontFamily,
        size: fontSizePx * 0.92
      }
    },
    xaxis: {
      title: {
        text: xTitle,
        standoff: Math.round(mmToPx(1.8)),
        font: { family: fontFamily, size: fontSizePx * 1.02 }
      },
      showline: true,
      mirror: true,
      linewidth: axisWidthPx,
      linecolor: "#202328",
      ticks: "inside",
      ticklen: ptToPx(3.6),
      tickwidth: axisWidthPx,
      tickcolor: "#202328",
      showgrid: preset.showGrid,
      gridcolor: "#e8eaed",
      gridwidth: 0.5,
      zeroline: false,
      automargin: false
    },
    yaxis: {
      title: {
        text: yTitle,
        standoff: Math.round(mmToPx(1.5)),
        font: { family: fontFamily, size: fontSizePx * 1.02 }
      },
      showline: true,
      mirror: true,
      linewidth: axisWidthPx,
      linecolor: "#202328",
      ticks: "inside",
      ticklen: ptToPx(3.6),
      tickwidth: axisWidthPx,
      tickcolor: "#202328",
      showgrid: preset.showGrid,
      gridcolor: "#e8eaed",
      gridwidth: 0.5,
      zeroline: false,
      automargin: false
    }
  };
}
