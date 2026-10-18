import type { PlotTemplateId } from "../model";

export interface TemplateInputDefinition {
  mode: "series" | "matrix";
  x: "optional" | "required";
  minSeries: number;
  yError?: "optional" | "required";
}

export type PlotSystemId =
  | "single-y"
  | "double-y"
  | "waterfall"
  | "bar"
  | "field-2d"
  | "surface-3d"
  | "analysis"
  | "layout";

export type SingleYAppearanceId =
  | "line"
  | "markers"
  | "line-marker"
  | "errorbar"
  | "spectrum";

export interface TemplateDefinition {
  id: PlotTemplateId;
  label: string;
  family: "XY" | "Bar" | "Field" | "3D" | "Layout";
  system: PlotSystemId;
  input: TemplateInputDefinition;
}

export interface PlotSystemDefinition {
  id: PlotSystemId;
  label: string;
  description: string;
  defaultTemplateId: PlotTemplateId;
}

export interface SingleYAppearanceDefinition {
  id: SingleYAppearanceId;
  label: string;
  templateId: PlotTemplateId;
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
  { id: "xy-line", label: "线", family: "XY", system: "single-y", input: seriesInput },
  { id: "xy-scatter", label: "点", family: "XY", system: "single-y", input: seriesInput },
  { id: "xy-line-marker", label: "点线", family: "XY", system: "single-y", input: seriesInput },
  {
    id: "xy-errorbar",
    label: "误差棒",
    family: "XY",
    system: "single-y",
    input: { ...seriesInput, yError: "required" }
  },
  { id: "spectrum", label: "光谱", family: "XY", system: "single-y", input: seriesInput },

  { id: "double-y", label: "双 Y 轴", family: "XY", system: "double-y", input: { ...seriesInput, minSeries: 2 } },

  { id: "offset-spectrum", label: "Y 偏移 / 堆叠", family: "XY", system: "waterfall", input: { ...seriesInput, minSeries: 2 } },
  { id: "waterfall", label: "XY 瀑布", family: "XY", system: "waterfall", input: { ...seriesInput, minSeries: 2 } },

  { id: "bar", label: "单组柱", family: "Bar", system: "bar", input: seriesInput },
  {
    id: "grouped-bar",
    label: "分组柱",
    family: "Bar",
    system: "bar",
    input: { ...seriesInput, minSeries: 2 }
  },
  {
    id: "stacked-bar",
    label: "堆叠柱",
    family: "Bar",
    system: "bar",
    input: { ...seriesInput, minSeries: 2 }
  },

  { id: "heatmap", label: "热图 / 光斑", family: "Field", system: "field-2d", input: matrixInput },
  { id: "contour", label: "等高线", family: "Field", system: "field-2d", input: { ...matrixInput, minSeries: 2 } },

  { id: "surface-3d", label: "3D 曲面", family: "3D", system: "surface-3d", input: matrixInput },
  { id: "surface-projection-3d", label: "3D 曲面 + 三向投影", family: "3D", system: "surface-3d", input: matrixInput },

  { id: "pca-ellipse", label: "PCA + 置信椭圆", family: "XY", system: "analysis", input: { ...seriesInput, minSeries: 2 } },
  { id: "volcano", label: "Volcano / 火山图", family: "XY", system: "analysis", input: seriesInput },
  { id: "ridgeline", label: "Ridgeline / 山脊密度", family: "XY", system: "analysis", input: { ...seriesInput, minSeries: 2 } },

  { id: "publication-board", label: "Publication Style Board", family: "Layout", system: "layout", input: seriesInput }
];

export const plotSystems: PlotSystemDefinition[] = [
  {
    id: "single-y",
    label: "单 Y",
    description: "共享一个 Y 坐标轴。点、线、点线、多曲线都属于这一体系。",
    defaultTemplateId: "xy-line"
  },
  {
    id: "double-y",
    label: "双 Y",
    description: "同一 X 轴，两套独立 Y 轴。",
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

export const singleYAppearances: SingleYAppearanceDefinition[] = [
  { id: "line", label: "线", templateId: "xy-line" },
  { id: "markers", label: "点", templateId: "xy-scatter" },
  { id: "line-marker", label: "点线", templateId: "xy-line-marker" },
  { id: "errorbar", label: "误差棒", templateId: "xy-errorbar" },
  { id: "spectrum", label: "光谱", templateId: "spectrum" }
];

export function templateDefinition(id: PlotTemplateId): TemplateDefinition {
  return templates.find((item) => item.id === id) ?? templates[0];
}

export function templateLabel(id: PlotTemplateId): string {
  return templateDefinition(id).label;
}

export function plotSystemIdForTemplate(id: PlotTemplateId): PlotSystemId {
  return templateDefinition(id).system;
}

export function plotSystemDefinition(id: PlotSystemId): PlotSystemDefinition {
  return plotSystems.find((item) => item.id === id) ?? plotSystems[0];
}

export function templatesForSystem(id: PlotSystemId): TemplateDefinition[] {
  return templates.filter((item) => item.system === id);
}

export function defaultTemplateForSystem(id: PlotSystemId): PlotTemplateId {
  return plotSystemDefinition(id).defaultTemplateId;
}

export function singleYAppearanceForTemplate(
  id: PlotTemplateId
): SingleYAppearanceId {
  return (
    singleYAppearances.find((item) => item.templateId === id)?.id ?? "line"
  );
}

export function templateForSingleYAppearance(
  id: SingleYAppearanceId
): PlotTemplateId {
  return (
    singleYAppearances.find((item) => item.id === id)?.templateId ?? "xy-line"
  );
}
