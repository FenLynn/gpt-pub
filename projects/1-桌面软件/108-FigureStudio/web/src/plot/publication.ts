import type {
  FigureSpec,
  PresetDefinition,
  PublicationMode
} from "../model";

export interface PublicationMetrics {
  mode: PublicationMode;
  widthMm: number;
  fontSizePt: number;
  lineWidthPt: number;
  axisWidthPt: number;
  markerSizePt: number;
  majorTickLengthPt: number;
  minorTickLengthPt: number;
  axisTitleScale: number;
  plotTitleScale: number;
  legendScale: number;
  outerMarginScale: number;
}

const QUAD_PANEL_WIDTH_MM: Record<PresetDefinition["id"], number> = {
  scientific: 82,
  nature: 82,
  presentation: 110
};

export function publicationModeFor(figure: FigureSpec): PublicationMode {
  return figure.figureOverrides.publicationMode ?? "single";
}

export function resolvePublicationMetrics(
  preset: PresetDefinition,
  figure: FigureSpec
): PublicationMetrics {
  const mode = publicationModeFor(figure);
  if (mode === "single") {
    return {
      mode,
      widthMm: preset.widthMm,
      fontSizePt: preset.fontSizePt,
      lineWidthPt: preset.lineWidthPt,
      axisWidthPt: preset.axisWidthPt,
      markerSizePt: preset.markerSizePt,
      majorTickLengthPt: 3.5,
      minorTickLengthPt: 2,
      axisTitleScale: 1.08,
      plotTitleScale: 1.18,
      legendScale: 0.94,
      outerMarginScale: 1
    };
  }

  // A four-panel slot is not a geometrically shrunken single figure.
  // Keep text readable at final print size while tightening the panel box,
  // matching the compact-layout philosophy used by Matplotlib/MATLAB.
  return {
    mode,
    widthMm: QUAD_PANEL_WIDTH_MM[preset.id],
    fontSizePt: Math.max(7.25, preset.fontSizePt * 0.94),
    lineWidthPt: Math.max(0.9, preset.lineWidthPt * 0.88),
    axisWidthPt: Math.max(0.65, preset.axisWidthPt * 0.9),
    markerSizePt: Math.max(3.4, preset.markerSizePt * 0.86),
    majorTickLengthPt: 3.2,
    minorTickLengthPt: 1.8,
    axisTitleScale: 1.05,
    plotTitleScale: 1.12,
    legendScale: 0.92,
    outerMarginScale: 0.88
  };
}
