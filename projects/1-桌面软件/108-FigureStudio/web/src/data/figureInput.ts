import type {
  FigureInputState,
  FigureSpec,
  ProjectState
} from "../model";
import { findSheet } from "./adapter";
import { templateDefinition } from "../plot/templates";

export interface FigureInputInfo {
  state: FigureInputState;
  label: string;
  detail: string;
}

const labels: Record<FigureInputState, string> = {
  empty: "空图",
  incomplete: "待完成",
  ready: "可绘制",
  broken: "引用失效"
};

export function resolveFigureInput(
  project: ProjectState,
  figure: FigureSpec
): FigureInputInfo {
  const ref = figure.dataRef;
  if (!ref) {
    return {
      state: "empty",
      label: labels.empty,
      detail: "图形尚未绑定数据。可以先设置图型和样式，再选择工作表。"
    };
  }

  const context = findSheet(project, ref.sheetId);
  if (!context) {
    return {
      state: "broken",
      label: labels.broken,
      detail: "原工作表不存在，请重新选择数据源。"
    };
  }

  const available = new Set(context.sheet.columns.map((column) => column.id));
  const referenced = [
    ...(ref.xColumnId ? [ref.xColumnId] : []),
    ...ref.yColumnIds,
    ...(ref.yErrorColumnId ? [ref.yErrorColumnId] : []),
    ...(ref.zColumnId ? [ref.zColumnId] : [])
  ];
  if (referenced.some((id) => !available.has(id))) {
    return {
      state: "broken",
      label: labels.broken,
      detail: "已有数据映射包含不存在的列，请重新指定。"
    };
  }

  const requirement = templateDefinition(figure.templateId).input;
  if (
    ref.yColumnIds.length < requirement.minSeries ||
    (requirement.x === "required" && !ref.xColumnId)
  ) {
    return {
      state: "incomplete",
      label: labels.incomplete,
      detail:
        requirement.x === "optional"
          ? "当前图型至少需要一列数据；X 可以留空并自动使用行号。"
          : "当前图型的数据映射尚未满足要求。"
    };
  }

  return {
    state: "ready",
    label: labels.ready,
    detail: ref.xColumnId
      ? "数据映射完整。"
      : "数据映射完整；X 使用自动行号。"
  };
}
