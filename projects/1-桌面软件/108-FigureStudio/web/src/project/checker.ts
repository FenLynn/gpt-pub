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

function autoAxisTitle(name: string, unit?: string): string {
  return unit ? name + " (" + unit + ")" : name;
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

  const ref = figure.dataRef;
  const availableSeries = new Set(dataset.ys.map((series) => series.id));
  const missingSeries = ref
    ? ref.yColumnIds.filter((id) => !availableSeries.has(id))
    : [];
  const missingError =
    ref?.yErrorColumnId &&
    !availableSeries.has(ref.yErrorColumnId);
  const mappingBroken =
    ref !== undefined &&
    (ref.yColumnIds.length === 0 ||
      missingSeries.length > 0 ||
      Boolean(missingError));

  items.push({
    id: "data-mapping",
    level: !ref ? "info" : mappingBroken ? "warn" : "pass",
    title: "数据映射",
    detail: !ref
      ? "当前是空图，可以稍后在“数据”页绑定工作表。"
      : mappingBroken
      ? "图形的数据引用不完整；请在“数据”页重新选择数据列。"
      : ref.xColumnId
      ? "X / Y / 误差引用均使用稳定 Column ID。"
      : "Y 数据引用完整；X 自动使用行号。"
  });

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
    level: titleHasUnit(
      o.xTitle ?? autoAxisTitle(dataset.x.name, dataset.x.unit),
      dataset.x.unit
    ) ? "pass" : "warn",
    title: "X 轴单位",
    detail: titleHasUnit(
      o.xTitle ?? autoAxisTitle(dataset.x.name, dataset.x.unit),
      dataset.x.unit
    )
      ? "X 轴标题包含数据单位。"
      : "数据包含单位，但 X 轴标题未显示单位。"
  });

  const fieldTemplate =
    figure.templateId === "heatmap" || figure.templateId === "surface-3d";
  const yUnit = fieldTemplate
    ? dataset.metadata?.rowAxisUnit
    : dataset.ys[0]?.unit;
  const autoYTitle = fieldTemplate
    ? autoAxisTitle(dataset.metadata?.rowAxisName ?? "Y", yUnit)
    : dataset.ys[0]
    ? autoAxisTitle(dataset.ys[0].name, dataset.ys[0].unit)
    : "Y";
  items.push({
    id: "y-unit",
    level: titleHasUnit(o.yTitle ?? autoYTitle, yUnit) ? "pass" : "warn",
    title: "Y 轴单位",
    detail: titleHasUnit(o.yTitle ?? autoYTitle, yUnit)
      ? "Y 轴标题包含数据单位。"
      : "数据包含单位，但 Y 轴标题未显示单位。"
  });

  items.push({
    id: "series-count",
    level:
      visibleSeries.length === 0
        ? ref
          ? "warn"
          : "info"
        : visibleSeries.length <= 8
        ? "pass"
        : "warn",
    title: "数据层数量",
    detail:
      visibleSeries.length === 0
        ? ref
          ? "当前没有可见主数据层。"
          : "当前为空图，尚未绑定主数据层。"
        : visibleSeries.length <= 8
        ? "当前可见数据层数量较容易辨识。"
        : "可见数据层较多，建议分组、筛选或使用更明确编码。"
  });

  const xLength = dataset.x.values.length;
  const lengthMismatches = visibleSeries.filter(
    (series) => xLength > 0 && series.values.length !== xLength
  );
  items.push({
    id: "data-length",
    level: lengthMismatches.length ? "warn" : "pass",
    title: "数据长度",
    detail: lengthMismatches.length
      ? lengthMismatches.length +
        " 个数据层与 X 列长度不同；超出配对范围的点可能不会显示。"
      : "可见数据层与 X 数据长度一致。"
  });

  const errorSeries = ref?.yErrorColumnId
    ? dataset.ys.find((series) => series.id === ref.yErrorColumnId)
    : undefined;
  if (errorSeries) {
    const mainLength = Math.max(
      0,
      ...visibleSeries
        .filter((series) => series.id !== errorSeries.id)
        .map((series) => series.values.length)
    );
    const negativeErrors = errorSeries.values.filter(
      (value) => typeof value === "number" && value < 0
    ).length;
    const errorProblems: string[] = [];
    if (mainLength > 0 && errorSeries.values.length !== mainLength) {
      errorProblems.push("误差列长度与主数据不一致");
    }
    if (negativeErrors > 0) {
      errorProblems.push(negativeErrors + " 个误差值为负数");
    }
    items.push({
      id: "error-data",
      level: errorProblems.length ? "warn" : "pass",
      title: "误差数据",
      detail: errorProblems.length
        ? errorProblems.join("；") + "。"
        : "误差列长度和数值有效。"
    });
  }

  const xCategoricalValues = dataset.x.values.filter(
    (value): value is string => typeof value === "string"
  );
  if (xCategoricalValues.length) {
    const populated = xCategoricalValues.filter((value) => value.trim() !== "");
    const duplicates = populated.length - new Set(populated).size;
    const barLike =
      figure.templateId === "bar" ||
      figure.templateId === "grouped-bar" ||
      figure.templateId === "stacked-bar";
    items.push({
      id: "category-axis",
      level:
        duplicates > 0 || (barLike && populated.length > 30)
          ? "warn"
          : "pass",
      title: "分类 X 轴",
      detail:
        duplicates > 0
          ? "存在 " +
            duplicates +
            " 个重复类别；同名类别会落在同一分类位置，请确认这是预期行为。"
          : barLike && populated.length > 30
          ? "分类数量超过 30，柱状图的 Tick 标签可能过密。"
          : "文本 / 分类 X 按数据顺序显示。"
    });
  }

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

  if (!fieldTemplate && (o.legendVisible ?? true)) {
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
  }

  const xCategorical = dataset.x.values.some(
    (value) => typeof value === "string"
  );
  const axisIssues: string[] = [];
  if (
    xCategorical &&
    ((o.xScale ?? "linear") === "log" ||
      o.xAutoRange === false ||
      o.xMajorTickStep !== undefined ||
      o.xMinorTickStep !== undefined)
  ) {
    axisIssues.push(
      "X 是分类轴，数值范围 / 对数 / 数值刻度间距将被忽略"
    );
  }
  const checkAxis = (
    label: string,
    auto: boolean | undefined,
    min: number | undefined,
    max: number | undefined,
    scale: "linear" | "log",
    major: number | undefined,
    minor: number | undefined
  ) => {
    if (auto === false) {
      if (
        min === undefined ||
        max === undefined ||
        !Number.isFinite(min) ||
        !Number.isFinite(max) ||
        min >= max
      ) {
        axisIssues.push(label + " 手动范围需要满足 最小值 < 最大值");
      } else if (scale === "log" && (min <= 0 || max <= 0)) {
        axisIssues.push(label + " 对数范围必须大于 0");
      }
    }
    if (major !== undefined && (!Number.isFinite(major) || major <= 0)) {
      axisIssues.push(label + " 大刻度间距必须大于 0");
    }
    if (minor !== undefined && (!Number.isFinite(minor) || minor <= 0)) {
      axisIssues.push(label + " 小刻度间距必须大于 0");
    }
  };

  if (!xCategorical) {
    checkAxis(
      "X 轴",
      o.xAutoRange,
      o.xMin,
      o.xMax,
      o.xScale ?? "linear",
      o.xMajorTickStep,
      o.xMinorTickStep
    );
  }
  checkAxis(
    "Y 轴",
    o.yAutoRange,
    o.yMin,
    o.yMax,
    o.yScale ?? "linear",
    o.yMajorTickStep,
    o.yMinorTickStep
  );

  items.push({
    id: "axis-validity",
    level: axisIssues.length ? "warn" : "pass",
    title: "坐标轴数值",
    detail: axisIssues.length
      ? axisIssues.join("；") + "。无效值不会写入渲染范围。"
      : "坐标轴范围和刻度间距有效。"
  });

  const logIssues: string[] = [];
  if ((o.xScale ?? "linear") === "log" && !xCategorical) {
    const numericX = dataset.x.values.filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value)
    );
    if (!numericX.some((value) => value > 0)) {
      logIssues.push("X 对数轴没有可显示的正值");
    } else if (numericX.some((value) => value <= 0)) {
      logIssues.push("X 数据包含非正值，这些点在对数轴上不会显示");
    }
  }
  if ((o.yScale ?? "linear") === "log") {
    const numericY = visibleSeries.flatMap((series) =>
      series.values.filter(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value)
      )
    );
    if (numericY.length && !numericY.some((value) => value > 0)) {
      logIssues.push("Y 对数轴没有可显示的正值");
    } else if (numericY.some((value) => value <= 0)) {
      logIssues.push("Y 数据包含非正值，这些点在对数轴上不会显示");
    }
  }
  if (logIssues.length) {
    items.push({
      id: "log-data",
      level: "warn",
      title: "对数轴数据",
      detail: logIssues.join("；") + "。"
    });
  }

  const legendFarOutside =
    o.legendPosition === "custom" &&
    ((o.legendX !== undefined && (o.legendX < -0.25 || o.legendX > 1.25)) ||
      (o.legendY !== undefined && (o.legendY < -0.25 || o.legendY > 1.25)));
  if (!fieldTemplate && (o.legendVisible ?? true)) {
    items.push({
      id: "legend-position",
      level: legendFarOutside ? "warn" : "pass",
      title: "图例位置",
      detail: legendFarOutside
        ? "自由图例位置远离绘图区，导出前请确认没有被裁切。"
        : "图例位置处于合理范围。"
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
