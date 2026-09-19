import type { PresetDefinition, PresetId } from "../model";

export const presets: Record<PresetId, PresetDefinition> = {
  scientific: {
    id: "scientific",
    label: "Scientific",
    description: "Matplotlib-like general scientific style",
    widthMm: 118,
    heightMm: 76,
    fontFamily: "Arial",
    fontSizePt: 7,
    lineWidthPt: 1.0,
    axisWidthPt: 0.72,
    markerSizePt: 4.0,
    showGrid: false,
    palette: ["#4C78A8", "#F58518", "#54A24B", "#E45756", "#72B7B2", "#B279A2"]
  },
  nature: {
    id: "nature",
    label: "Nature",
    description: "Compact single-column publication preset",
    widthMm: 89,
    heightMm: 62,
    fontFamily: "Arial",
    fontSizePt: 6.5,
    lineWidthPt: 0.9,
    axisWidthPt: 0.6,
    markerSizePt: 3.5,
    showGrid: false,
    palette: ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9"]
  },
  presentation: {
    id: "presentation",
    label: "Presentation",
    description: "Larger text and strokes for slides",
    widthMm: 160,
    heightMm: 100,
    fontFamily: "Arial",
    fontSizePt: 10,
    lineWidthPt: 1.8,
    axisWidthPt: 1.0,
    markerSizePt: 5.6,
    showGrid: false,
    palette: ["#3366CC", "#DC3912", "#109618", "#990099", "#0099C6", "#DD4477"]
  }
};

export const presetOrder: PresetId[] = ["scientific", "nature", "presentation"];
