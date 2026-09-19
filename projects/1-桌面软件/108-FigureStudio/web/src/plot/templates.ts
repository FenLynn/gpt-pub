import type { PlotTemplateId } from "../model";

export interface TemplateInputDefinition {
  mode: "series" | "matrix";
  x: "optional" | "required";
  minSeries: number;
}

export interface TemplateDefinition {
  id: PlotTemplateId;
  label: string;
  family: "XY" | "Bar" | "Field" | "3D";
  input: TemplateInputDefinition;
}

const seriesInput: TemplateInputDefinition = {
  mode: "series",
  x: "optional",
  minSeries: 1
};

const matrixInput: TemplateInputDefinition = {
  mode: "matrix",
  x: "optional",
  minSeries: 1
};

export const templates: TemplateDefinition[] = [
  { id: "xy-line", label: "折线", family: "XY", input: seriesInput },
  { id: "xy-scatter", label: "散点", family: "XY", input: seriesInput },
  { id: "xy-line-marker", label: "点线", family: "XY", input: seriesInput },
  { id: "xy-errorbar", label: "误差棒", family: "XY", input: seriesInput },
  { id: "spectrum", label: "光谱", family: "XY", input: seriesInput },
  { id: "offset-spectrum", label: "堆叠光谱", family: "XY", input: { ...seriesInput, minSeries: 2 } },
  { id: "waterfall", label: "瀑布图", family: "XY", input: { ...seriesInput, minSeries: 2 } },
  { id: "double-y", label: "双 Y 轴", family: "XY", input: { ...seriesInput, minSeries: 2 } },
  { id: "bar", label: "柱状图", family: "Bar", input: seriesInput },
  { id: "grouped-bar", label: "分组柱状图", family: "Bar", input: seriesInput },
  { id: "stacked-bar", label: "堆叠柱状图", family: "Bar", input: seriesInput },
  { id: "heatmap", label: "热图 / 光斑图", family: "Field", input: matrixInput },
  { id: "contour", label: "等高线 / Contour", family: "Field", input: { ...matrixInput, minSeries: 2 } },
  { id: "surface-3d", label: "3D 曲面", family: "3D", input: matrixInput }
];

export function templateDefinition(id: PlotTemplateId): TemplateDefinition {
  return templates.find((item) => item.id === id) ?? templates[0];
}

export function templateLabel(id: PlotTemplateId): string {
  return templateDefinition(id).label;
}
