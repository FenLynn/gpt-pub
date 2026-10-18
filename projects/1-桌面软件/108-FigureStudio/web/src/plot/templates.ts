import type { PlotTemplateId } from "../model";

export interface TemplateInputDefinition {
  mode: "series" | "matrix";
  x: "optional" | "required";
  minSeries: number;
  yError?: "optional" | "required";
}

export type PlotArchitectureId =
  | "single-y"
  | "double-y"
  | "waterfall"
  | "bar"
  | "field-2d"
  | "surface-3d"
  | "analysis"
  | "layout";

export interface TemplateDefinition {
  id: PlotTemplateId;
  label: string;
  family: "XY" | "Bar" | "Field" | "3D" | "Layout";
  architecture: PlotArchitectureId;
  input: TemplateInputDefinition;
}

export interface PlotArchitectureDefinition {
  id: PlotArchitectureId;
  label: string;
  description: string;
  defaultTemplateId: PlotTemplateId;
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
  { id: "xy-line", label: "线", family: "XY", architecture: "single-y", input: seriesInput },
  { id: "xy-scatter", label: "点", family: "XY", architecture: "single-y", input: seriesInput },
  { id: "xy-line-marker", label: "点线", family: "XY", architecture: "single-y", input: seriesInput },
  {
    id: "xy-errorbar",
    label: "误差棒",
    family: "XY",
    architecture: "single-y",
    input: { ...seriesInput, yError: "required" }
  },
  { id: "spectrum", label: "光谱", family: "XY", architecture: "single-y", input: seriesInput },

  { id: "double-y", label: "双 Y 轴", family: "XY", architecture: "double-y", input: { ...seriesInput, minSeries: 2 } },

  { id: "offset-spectrum", label: "Y 偏移 / 堆叠", family: "XY", architecture: "waterfall", input: { ...seriesInput, minSeries: 2 } },
  { id: "waterfall", label: "XY 瀑布", family: "XY", architecture: "waterfall", input: { ...seriesInput, minSeries: 2 } },

  { id: "bar", label: "单组柱", family: "Bar", architecture: "bar", input: seriesInput },
  {
    id: "grouped-bar",
    label: "分组柱",
    family: "Bar",
    architecture: "bar",
    input: { ...seriesInput, minSeries: 2 }
  },
  {
    id: "stacked-bar",
    label: "堆叠柱",
    family: "Bar",
    architecture: "bar",
    input: { ...seriesInput, minSeries: 2 }
  },

  { id: "heatmap", label: "热图 / 光斑", family: "Field", architecture: "field-2d", input: matrixInput },
  { id: "contour", label: "等高线", family: "Field", architecture: "field-2d", input: { ...matrixInput, minSeries: 2 } },

  { id: "surface-3d", label: "3D 曲面", family: "3D", architecture: "surface-3d", input: matrixInput },
  { id: "surface-projection-3d", label: "3D 曲面 + 三向投影", family: "3D", architecture: "surface-3d", input: matrixInput },

  { id: "pca-ellipse", label: "PCA + 置信椭圆", family: "XY", architecture: "analysis", input: { ...seriesInput, minSeries: 2 } },
  { id: "volcano", label: "Volcano / 火山图", family: "XY", architecture: "analysis", input: seriesInput },
  { id: "ridgeline", label: "Ridgeline / 山脊密度", family: "XY", architecture: "analysis", input: { ...seriesInput, minSeries: 2 } },

  { id: "publication-board", label: "Publication Style Board", family: "Layout", architecture: "layout", input: seriesInput }
];

export const plotArchitectures: PlotArchitectureDefinition[] = [
  {
    id: "single-y",
    label: "单 Y",
    description: "共享一个 Y 坐标轴。任意数量的数据组都可独立设置 Line、Symbol、Error Bar 和 Fill。",
    defaultTemplateId: "xy-line"
  },
  {
    id: "double-y",
    label: "双 Y",
    description: "同一 X 轴，两套独立 Y 轴。每个数据组可自由分配到左 Y 或右 Y，并独立设置表达元素。",
    defaultTemplateId: "double-y"
  },
  {
    id: "waterfall",
    label: "瀑布 / 偏移",
    description: "多序列按 X/Y 方向错位或堆叠显示。",
    defaultTemplateId: "waterfall"
  },
  {
    id: "bar",
    label: "柱状",
    description: "单组、分组和堆叠柱状体系。",
    defaultTemplateId: "bar"
  },
  {
    id: "field-2d",
    label: "二维场",
    description: "二维标量场的热图与等高线表达。",
    defaultTemplateId: "heatmap"
  },
  {
    id: "surface-3d",
    label: "3D",
    description: "三维曲面及其投影表达。",
    defaultTemplateId: "surface-3d"
  },
  {
    id: "analysis",
    label: "专项分析",
    description: "PCA、火山图、山脊图等具有专门统计语义的图。",
    defaultTemplateId: "pca-ellipse"
  },
  {
    id: "layout",
    label: "版式",
    description: "出版风格板等组合版式。",
    defaultTemplateId: "publication-board"
  }
];

export function templateDefinition(id: PlotTemplateId): TemplateDefinition {
  return templates.find((item) => item.id === id) ?? templates[0];
}

export function templateLabel(id: PlotTemplateId): string {
  return templateDefinition(id).label;
}

export function plotArchitectureIdForTemplate(id: PlotTemplateId): PlotArchitectureId {
  return templateDefinition(id).architecture;
}

export function plotArchitectureDefinition(id: PlotArchitectureId): PlotArchitectureDefinition {
  return plotArchitectures.find((item) => item.id === id) ?? plotArchitectures[0];
}

export function templatesForArchitecture(id: PlotArchitectureId): TemplateDefinition[] {
  return templates.filter((item) => item.architecture === id);
}

export function defaultTemplateForArchitecture(id: PlotArchitectureId): PlotTemplateId {
  return plotArchitectureDefinition(id).defaultTemplateId;
}

export function architectureVariants(
  id: PlotArchitectureId
): TemplateDefinition[] {
  if (id === "single-y" || id === "double-y") return [];
  return templates.filter((item) => item.architecture === id);
}
