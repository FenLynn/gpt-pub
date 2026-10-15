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
    markerSizePt: 4.1,
    showGrid: false,
    palette: ["#1F77B4","#FF7F0E","#2CA02C","#D62728","#9467BD","#8C564B","#E377C2","#7F7F7F","#BCBD22","#17BECF"]
  },
  nature: {
    id: "nature",
    label: "Nature 单栏",
    description: "Nature 89 mm 单栏：6.5 pt 文字，0.58 pt 轴线，0.82 pt 数据线，紧凑矢量排版",
    widthMm: 89,
    heightMm: 66.75,
    fontFamily: "Arial",
    fontSizePt: 6.5,
    lineWidthPt: 0.82,
    axisWidthPt: 0.58,
    markerSizePt: 3.0,
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
    lineWidthPt: 1.8,
    axisWidthPt: 0.95,
    markerSizePt: 5.6,
    showGrid: false,
    palette: ["#1F77B4","#FF7F0E","#2CA02C","#D62728","#9467BD","#17BECF"]
  }
};

export const presetOrder: PresetId[] = ["scientific", "nature", "presentation"];
