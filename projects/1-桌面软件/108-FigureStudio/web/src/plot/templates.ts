import type { PlotTemplateId } from "../model";

export interface TemplateDefinition {
  id: PlotTemplateId;
  label: string;
  family: "XY" | "Bar" | "Field" | "3D";
}

export const templates: TemplateDefinition[] = [
  { id: "xy-line", label: "折线", family: "XY" },
  { id: "xy-scatter", label: "散点", family: "XY" },
  { id: "xy-line-marker", label: "点线", family: "XY" },
  { id: "xy-errorbar", label: "误差棒", family: "XY" },
  { id: "spectrum", label: "光谱", family: "XY" },
  { id: "offset-spectrum", label: "堆叠光谱", family: "XY" },
  { id: "bar", label: "柱状图", family: "Bar" },
  { id: "grouped-bar", label: "分组柱状图", family: "Bar" },
  { id: "stacked-bar", label: "堆叠柱状图", family: "Bar" },
  { id: "heatmap", label: "热图 / 光斑图", family: "Field" },
  { id: "surface-3d", label: "3D 曲面", family: "3D" }
];

export function templateLabel(id: PlotTemplateId): string {
  return templates.find((item) => item.id === id)?.label ?? id;
}
