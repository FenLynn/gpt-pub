import type {
  FigureSpec,
  PresetDefinition,
  PublicationMode
} from "../model";
import { GOLDEN_STYLE, goldenTypography } from "./goldenStyle";

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
  axisTitlePadPt: number;
  plotTitleScale: number;
  plotTitlePadPt: number;
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
    const type = goldenTypography(preset.fontSizePt);
    return {
      mode,
      widthMm: preset.widthMm,
      fontSizePt: preset.fontSizePt,
      lineWidthPt: Math.max(
        preset.lineWidthPt,
        preset.id === "nature"
          ? GOLDEN_STYLE.stroke.natureCurveMinPt
          : GOLDEN_STYLE.stroke.referenceCurvePt
      ),
      axisWidthPt: Math.max(preset.axisWidthPt, GOLDEN_STYLE.stroke.referenceAxisPt),
      markerSizePt: preset.markerSizePt,
      majorTickLengthPt: GOLDEN_STYLE.stroke.majorTickLengthPt,
      minorTickLengthPt: GOLDEN_STYLE.stroke.minorTickLengthPt,
      axisTitleScale: type.axisTitlePt / type.bodyPt,
      axisTitlePadPt: 4,
      plotTitleScale: type.plotTitlePt / type.bodyPt,
      plotTitlePadPt: 6,
      legendScale: type.legendPt / type.bodyPt,
      outerMarginScale: 1
    };
  }

  // A four-panel slot is not a geometrically shrunken single figure.
  // Keep text readable at final print size while tightening the panel box,
  // matching the compact-layout philosophy used by Matplotlib/MATLAB.
  const quadBodyPt = Math.max(7.25, preset.fontSizePt * 0.94);
  const type = goldenTypography(quadBodyPt);
  return {
    mode,
    widthMm: QUAD_PANEL_WIDTH_MM[preset.id],
    fontSizePt: quadBodyPt,
    lineWidthPt: Math.max(0.9, preset.lineWidthPt * 0.9),
    axisWidthPt: Math.max(GOLDEN_STYLE.stroke.referenceAxisPt, preset.axisWidthPt * 0.9),
    markerSizePt: Math.max(3.2, preset.markerSizePt * 0.86),
    majorTickLengthPt: GOLDEN_STYLE.stroke.majorTickLengthPt * 0.9,
    minorTickLengthPt: GOLDEN_STYLE.stroke.minorTickLengthPt * 0.9,
    axisTitleScale: type.axisTitlePt / type.bodyPt,
    axisTitlePadPt: 3.5,
    plotTitleScale: type.plotTitlePt / type.bodyPt,
    plotTitlePadPt: 4.5,
    legendScale: type.legendPt / type.bodyPt,
    outerMarginScale: 0.78
  };
}


export const MATLAB_GEM_COLORS = [
  "#1171BE",
  "#DD5400",
  "#EDB120",
  "#8516D1",
  "#3BAA32",
  "#2FBEF0",
  "#D1048B"
];

export function resolveSeriesPalette(
  preset: PresetDefinition,
  figure: FigureSpec
): string[] {
  return figure.figureOverrides.colorCycle === "matlab"
    ? MATLAB_GEM_COLORS
    : [...GOLDEN_STYLE.palette];
}
