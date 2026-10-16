/**
 * FigureStudio Golden Style
 *
 * The visual language is extracted from the approved Lorentz Golden figure.
 * Renderers may scale typography for a publication preset, but the hierarchy,
 * strokes, neutral colors, legend treatment and default series palette all
 * originate here. User/figure overrides always remain authoritative.
 */
export const GOLDEN_STYLE = {
  id: "figurestudio-golden-v1",
  typography: {
    referenceBodyPt: 9,
    referenceTickPt: 8,
    referenceAxisTitlePt: 9.2,
    referencePlotTitlePt: 9.5,
    referenceLegendPt: 8.2,
    titleWeight: 600,
    serifFamily: '"Times New Roman", Georgia, serif',
    sansFamily: 'Arial, "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
    textColor: "#262626",
    titleColor: "#262b30",
    axisTitleColor: "#34383d",
    tickColor: "#262626"
  },
  stroke: {
    referenceAxisPt: 0.55,
    referenceCurvePt: 1.1,
    natureCurveMinPt: 1.0,
    majorTickLengthPt: 4,
    minorTickLengthPt: 2,
    markerEdgePt: 0.45,
    legendBorderPt: 0.3,
    axisColor: "#39434b",
    tickStrokeColor: "#4d5359",
    gridColor: "#77818a",
    gridRgba: "rgba(119,129,138,0.085)",
    gridWidthPx: 0.42
  },
  legend: {
    background: "#ffffff",
    backgroundOpacity: 0.94,
    borderColor: "#d4d9dd",
    sampleLengthPx: 22,
    textGapPx: 7,
    paddingXPx: 7,
    paddingYPx: 5,
    rowGapPx: 4,
    minItemWidthPx: 36
  },
  spacing: {
    leftWithTitleMm: 12,
    leftCompactMm: 6,
    rightMm: 4,
    doubleYRightMm: 10.5,
    fieldRightMm: 8.2,
    outsideLegendRightMm: 21,
    topWithTitleMm: 7.2,
    topCompactMm: 3.2,
    bottomWithTitleMm: 9.2,
    bottomCompactMm: 5.4
  },
  annotation: {
    background: "#ffffff",
    backgroundOpacity: 0.88,
    borderColor: "#d8dde0",
    borderWidthPt: 0.3
  },
  field: {
    colorScale: "Cividis",
    colorbarThicknessPx: 10,
    colorbarOutlinePt: 0.3,
    colorbarLength2d: 0.84,
    colorbarLength3d: 0.68,
    contourLinePt: 0.35,
    contourLineColor: "rgba(57,67,75,0.52)",
    planeBackground: "#f8f8f6",
    sceneGridColor: "#d9dde0"
  },
  bar: {
    borderColor: "rgba(57,67,75,0.34)",
    borderWidthPt: 0.3,
    gap: 0.22,
    groupGap: 0.08
  },
  marker: {
    scatterSizePt: 3,
    connectedSizePt: 2.7,
    edgePt: 0.4,
    hollowEdgePt: 0.55,
    errorLinePt: 0.55,
    errorCapPt: 2
  },
  stackedSpectrum: {
    lineWidthPt: 0.82,
    baseOpacity: 0.58,
    opacityStep: 0.09,
    offsetStep: 6,
    waterfallXOffset: 0.22,
    waterfallYOffset: 4.2
  },
  palette: [
    "#305b76",
    "#a44b3d",
    "#674080",
    "#4f765f",
    "#a8793f",
    "#477b86",
    "#7d6674"
  ]
} as const;

export function goldenTypography(basePt: number) {
  const ref = GOLDEN_STYLE.typography;
  const scale = basePt / ref.referenceBodyPt;
  return {
    bodyPt: basePt,
    tickPt: ref.referenceTickPt * scale,
    axisTitlePt: ref.referenceAxisTitlePt * scale,
    plotTitlePt: ref.referencePlotTitlePt * scale,
    legendPt: ref.referenceLegendPt * scale
  };
}
