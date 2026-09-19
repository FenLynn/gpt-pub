import type { PresetDefinition, PresetId } from "../model";

export const presets: Record<PresetId, PresetDefinition> = {
  scientific: {
    id: "scientific",
    label: "科研默认",
    description: "Matplotlib 风格的通用论文图：紧凑、清晰、低装饰",
    widthMm: 118,
    heightMm: 88.5,
    fontFamily: "Arial",
    fontSizePt: 8,
    lineWidthPt: 1.15,
    axisWidthPt: 0.8,
    markerSizePt: 4.2,
    showGrid: false,
    palette: ["#1F77B4","#FF7F0E","#2CA02C","#D62728","#9467BD","#8C564B","#E377C2","#7F7F7F","#BCBD22","#17BECF"]
  },
  nature: {
    id: "nature",
    label: "Nature 单栏",
    description: "89 mm 单栏尺寸，保持可读字号与克制线宽",
    widthMm: 89,
    heightMm: 66.75,
    fontFamily: "Arial",
    fontSizePt: 7.5,
    lineWidthPt: 1.0,
    axisWidthPt: 0.72,
    markerSizePt: 3.8,
    showGrid: false,
    palette: ["#0072B2","#D55E00","#009E73","#CC79A7","#E69F00","#56B4E9","#000000"]
  },
  presentation: {
    id: "presentation",
    label: "演示",
    description: "适合 PPT 与大屏展示，字号和线条按比例放大",
    widthMm: 160,
    heightMm: 120,
    fontFamily: "Arial",
    fontSizePt: 10.5,
    lineWidthPt: 1.6,
    axisWidthPt: 0.95,
    markerSizePt: 5.4,
    showGrid: false,
    palette: ["#1F77B4","#FF7F0E","#2CA02C","#D62728","#9467BD","#17BECF"]
  }
};

export const presetOrder: PresetId[] = ["scientific", "nature", "presentation"];
