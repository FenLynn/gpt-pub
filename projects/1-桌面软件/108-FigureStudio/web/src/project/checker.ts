import type {
  Dataset,
  FigureSpec,
  PresetDefinition
} from "../model";

export type CheckLevel = "pass" | "warn" | "info";

export interface CheckItem {
  id: string;
  level: CheckLevel;
  title: string;
  detail: string;
}

function titleHasUnit(title: string | undefined, unit?: string): boolean {
  if (!unit) return true;
  if (!title) return false;
  return title.toLowerCase().includes(unit.toLowerCase());
}

export function checkFigure(
  dataset: Dataset,
  figure: FigureSpec,
  preset: PresetDefinition
): CheckItem[] {
  const o = figure.figureOverrides;
  const visibleSeries = dataset.ys.filter(
    (series) => figure.seriesOverrides[series.id]?.visible !== false
  );
  const items: CheckItem[] = [];

  items.push({
    id: "background",
    level: (o.background ?? "#ffffff").toLowerCase() === "#ffffff" ? "pass" : "warn",
    title: "白色背景",
    detail:
      (o.background ?? "#ffffff").toLowerCase() === "#ffffff"
        ? "背景适合常规论文排版。"
        : "当前背景不是纯白；多数论文图建议使用白底。"
  });

  const grid = o.gridVisible ?? preset.showGrid;
  items.push({
    id: "grid",
    level: grid ? "warn" : "pass",
    title: "背景网格",
    detail: grid ? "当前启用了网格，请确认期刊和图型确实需要。" : "未使用装饰性背景网格。"
  });

  const fontSize = o.fontSizePt ?? preset.fontSizePt;
  items.push({
    id: "font-size",
    level: fontSize >= 5.5 && fontSize <= 9 ? "pass" : "warn",
    title: "字体尺寸",
    detail:
      fontSize >= 5.5 && fontSize <= 9
        ? "当前正文图中文字尺寸处于常见论文范围。"
        : "当前字号偏离常见论文图范围，请检查最终排版尺寸。"
  });

  if (figure.presetId === "nature") {
    items.push({
      id: "nature-font",
      level: (o.fontFamily ?? preset.fontFamily) === "Arial" ? "pass" : "warn",
      title: "Nature 字体",
      detail:
        (o.fontFamily ?? preset.fontFamily) === "Arial"
          ? "当前使用 Arial。"
          : "Nature 预设建议保持无衬线字体。"
    });
  }

  items.push({
    id: "x-unit",
    level: titleHasUnit(o.xTitle ?? dataset.x.name, dataset.x.unit) ? "pass" : "warn",
    title: "X 轴单位",
    detail: titleHasUnit(o.xTitle ?? dataset.x.name, dataset.x.unit)
      ? "X 轴标题包含数据单位。"
      : "数据包含单位，但 X 轴标题未显示单位。"
  });

  const yUnit =
    figure.templateId === "heatmap" || figure.templateId === "surface-3d"
      ? dataset.metadata?.rowAxisUnit
      : dataset.ys[0]?.unit;
  items.push({
    id: "y-unit",
    level: titleHasUnit(o.yTitle ?? "Y", yUnit) ? "pass" : "warn",
    title: "Y 轴单位",
    detail: titleHasUnit(o.yTitle ?? "Y", yUnit)
      ? "Y 轴标题包含数据单位。"
      : "数据包含单位，但 Y 轴标题未显示单位。"
  });

  items.push({
    id: "series-count",
    level: visibleSeries.length <= 8 ? "pass" : "warn",
    title: "曲线数量",
    detail:
      visibleSeries.length <= 8
        ? "当前可见曲线数量较容易辨识。"
        : "可见曲线较多，建议分组、筛选或使用更明确编码。"
  });

  const alphaTooLow = visibleSeries.some(
    (series) => (figure.seriesOverrides[series.id]?.opacity ?? 1) < 0.55
  );
  items.push({
    id: "opacity",
    level: alphaTooLow ? "warn" : "pass",
    title: "透明度",
    detail: alphaTooLow
      ? "存在透明度低于 55% 的主要数据层，印刷后可能不够清晰。"
      : "主要数据层透明度适合论文输出。"
  });

  if (figure.figureOverrides.legendFrame) {
    items.push({
      id: "legend-frame",
      level: figure.presetId === "nature" ? "warn" : "info",
      title: "图例边框",
      detail: "当前图例有边框；若非必要，可关闭以减少视觉噪声。"
    });
  } else {
    items.push({
      id: "legend-frame",
      level: "pass",
      title: "图例边框",
      detail: "图例保持简洁。"
    });
  }

  items.push({
    id: "raster",
    level: "pass",
    title: "PNG 分辨率",
    detail: "当前 PNG 导出固定为 600 dpi；SVG 保持矢量。"
  });

  return items;
}
