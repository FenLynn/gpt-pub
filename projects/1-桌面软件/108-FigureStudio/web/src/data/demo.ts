import { defaultDataRef } from "./adapter";
import type {
  DataBook,
  DataSheet,
  FigureSpec,
  ProjectState,
  UserDefaults
} from "../model";

function id(prefix: string): string {
  return prefix + "-" + Math.random().toString(36).slice(2, 10);
}

export function createSpectrumSheet(): DataSheet {
  const x: number[] = [];
  const measured: number[] = [];
  const fit: number[] = [];
  const sigma: number[] = [];

  for (let i = 0; i < 420; i += 1) {
    const wavelength = 1034 + i * 0.145;
    const main = Math.exp(-Math.pow((wavelength - 1064.2) / 2.35, 2));
    const side = Math.exp(-Math.pow((wavelength - 1071.1) / 1.3, 2));
    const baseline = -53.5 + 0.45 * Math.sin(i * 0.21) + 0.18 * Math.cos(i * 0.071);
    const fitted = -53.5 + 44.8 * main + 3.7 * side;
    const observation =
      baseline +
      44.8 * main +
      3.7 * side +
      0.42 * Math.sin(i * 0.73) * Math.exp(-Math.pow((wavelength - 1064.2) / 6.5, 2));

    x.push(Number(wavelength.toFixed(4)));
    measured.push(Number(observation.toFixed(4)));
    fit.push(Number(fitted.toFixed(4)));
    sigma.push(Number((0.28 + 0.12 * Math.abs(Math.sin(i * 0.17))).toFixed(4)));
  }

  return {
    id: id("sheet-spectrum"),
    name: "光谱",
    source: { kind: "embedded" },
    columns: [
      {
        id: "wavelength",
        name: "波长",
        unit: "nm",
        role: "X",
        values: x
      },
      {
        id: "measured",
        name: "测量数据",
        unit: "dBm",
        role: "Y",
        values: measured
      },
      {
        id: "fit",
        name: "高斯拟合",
        unit: "dBm",
        role: "Y",
        values: fit
      },
      {
        id: "sigma",
        name: "标准差",
        unit: "dB",
        role: "YErr",
        values: sigma
      }
    ]
  };
}

export function createFieldSheet(): DataSheet {
  const x: number[] = [];
  const columns = [];
  const rowCoordinates: number[] = [];

  for (let i = 0; i < 96; i += 1) {
    x.push(Number((-3.2 + (6.4 * i) / 95).toFixed(4)));
  }

  columns.push({
    id: "x-position",
    name: "横向位置",
    unit: "mm",
    role: "X" as const,
    values: x
  });

  for (let row = 0; row < 25; row += 1) {
    const y = -2.4 + (4.8 * row) / 24;
    rowCoordinates.push(Number(y.toFixed(4)));
    const values = x.map((xValue) => {
      const r2 = Math.pow(xValue / 1.08, 2) + Math.pow(y / 0.82, 2);
      const shoulder =
        0.12 *
        Math.exp(
          -Math.pow((xValue - 1.25) / 0.52, 2) -
            Math.pow((y + 0.35) / 0.62, 2)
        );
      return Number((Math.exp(-2 * r2) + shoulder).toFixed(6));
    });

    columns.push({
      id: "row-" + String(row + 1),
      name: y.toFixed(2),
      unit: "a.u.",
      role: "Y" as const,
      values
    });
  }

  return {
    id: id("sheet-field"),
    name: "二维光场",
    source: { kind: "embedded" },
    columns,
    metadata: {
      rowCoordinates,
      rowCoordinateByColumnId: Object.fromEntries(
        rowCoordinates.map((value, index) => [
          "row-" + String(index + 1),
          value
        ])
      ),
      rowAxisName: "纵向位置",
      rowAxisUnit: "mm"
    }
  };
}

export function createDualYAxisSheet(): DataSheet {
  const current: number[] = [];
  const output: number[] = [];
  const efficiency: number[] = [];

  for (let i = 0; i < 36; i += 1) {
    const x = 0.4 + i * 0.08;
    const aboveThreshold = Math.max(0, x - 0.72);
    current.push(Number(x.toFixed(3)));
    output.push(
      Number(
        (
          0.08 +
          14.5 * aboveThreshold +
          0.25 * Math.sin(i * 0.35)
        ).toFixed(3)
      )
    );
    efficiency.push(
      Number(
        (
          4 +
          58 * (1 - Math.exp(-aboveThreshold * 1.7))
        ).toFixed(2)
      )
    );
  }

  return {
    id: id("sheet-double-y"),
    name: "双 Y 示例",
    source: { kind: "embedded" },
    columns: [
      {
        id: "pump-current",
        name: "泵浦电流",
        unit: "A",
        role: "X",
        values: current
      },
      {
        id: "output-power",
        name: "输出功率",
        unit: "W",
        role: "Y",
        values: output
      },
      {
        id: "efficiency",
        name: "光光效率",
        unit: "%",
        role: "Y",
        values: efficiency
      }
    ]
  };
}

export function createWaterfallSheet(): DataSheet {
  const wavelength: number[] = [];
  const columns: DataSheet["columns"] = [];

  for (let i = 0; i < 240; i += 1) {
    wavelength.push(Number((1048 + i * 0.13).toFixed(3)));
  }

  columns.push({
    id: "waterfall-wavelength",
    name: "波长",
    unit: "nm",
    role: "X",
    values: wavelength
  });

  for (let row = 0; row < 7; row += 1) {
    const pump = 0.6 + row * 0.2;
    const center = 1061.8 + row * 0.38;
    const values = wavelength.map((x, index) => {
      const main =
        Math.exp(-Math.pow((x - center) / 1.45, 2));
      const shoulder =
        0.22 *
        Math.exp(-Math.pow((x - (center + 4.1)) / 0.9, 2));
      const baseline =
        -48 +
        row * 1.25 +
        0.18 * Math.sin(index * 0.24 + row);
      return Number(
        (baseline + 40 * main + 8 * shoulder).toFixed(3)
      );
    });

    columns.push({
      id: "waterfall-" + String(row + 1),
      name: pump.toFixed(1) + " W",
      unit: "dBm",
      role: "Y",
      values
    });
  }

  return {
    id: id("sheet-waterfall"),
    name: "瀑布光谱",
    source: { kind: "embedded" },
    columns
  };
}

export function createScatterErrorbarSheet(): DataSheet {
  const temperature: number[] = [];
  const sampleA: number[] = [];
  const sampleB: number[] = [];
  const uncertainty: number[] = [];

  for (let i = 0; i < 15; i += 1) {
    const x = 20 + i * 5;
    const a =
      0.42 +
      0.0082 * (x - 20) +
      0.035 * Math.sin(i * 0.72);
    const b =
      0.5 +
      0.0066 * (x - 20) +
      0.045 * Math.cos(i * 0.58 + 0.35);
    const e = 0.025 + 0.008 * (0.5 + 0.5 * Math.sin(i * 0.83));

    temperature.push(x);
    sampleA.push(Number(a.toFixed(4)));
    sampleB.push(Number(b.toFixed(4)));
    uncertainty.push(Number(e.toFixed(4)));
  }

  return {
    id: id("sheet-scatter-errorbar"),
    name: "散点与误差棒",
    source: { kind: "embedded" },
    columns: [
      {
        id: "temperature",
        name: "温度",
        unit: "°C",
        role: "X",
        values: temperature
      },
      {
        id: "sample-a",
        name: "样品 A",
        unit: "a.u.",
        role: "Y",
        values: sampleA
      },
      {
        id: "sample-b",
        name: "样品 B",
        unit: "a.u.",
        role: "Y",
        values: sampleB
      },
      {
        id: "response-error",
        name: "测量不确定度",
        unit: "a.u.",
        role: "YErr",
        values: uncertainty
      }
    ]
  };
}

export function createBarSheet(): DataSheet {
  const categories = ["条件 A", "条件 B", "条件 C", "条件 D", "条件 E"];
  const fundamental = [62, 58, 66, 71, 68];
  const higherOrder = [24, 29, 20, 18, 21];
  const loss = categories.map(
    (_label, index) => 100 - fundamental[index] - higherOrder[index]
  );

  return {
    id: id("sheet-bar"),
    name: "柱状图",
    source: { kind: "embedded" },
    columns: [
      {
        id: "condition",
        name: "实验条件",
        role: "X",
        values: categories
      },
      {
        id: "fundamental",
        name: "基模",
        unit: "%",
        role: "Y",
        values: fundamental
      },
      {
        id: "higher-order",
        name: "高阶模",
        unit: "%",
        role: "Y",
        values: higherOrder
      },
      {
        id: "loss",
        name: "其他损耗",
        unit: "%",
        role: "Y",
        values: loss
      }
    ]
  };
}

function makeFigure(
  sheet: DataSheet,
  name: string,
  templateId: FigureSpec["templateId"],
  defaults: UserDefaults,
  folderId?: string,
  overrides: FigureSpec["figureOverrides"] = {},
  seriesOverrides: FigureSpec["seriesOverrides"] = {}
): FigureSpec {
  const dataRef = defaultDataRef(sheet);
  return {
    id: id("figure"),
    name,
    folderId,
    dataRef,
    templateId,
    presetId: defaults.presetId,
    figureOverrides: {
      aspectMode: "4:3",
      ...defaults.figureOverrides,
      errorSeriesId: dataRef.yErrorColumnId,
      ...overrides
    },
    seriesOverrides,
    seriesOrder: dataRef.yColumnIds
  };
}

export function createInitialProject(
  userDefaults?: UserDefaults,
  includeVisualQa = false
): ProjectState {
  const defaults: UserDefaults = userDefaults ?? {
    templateId: "xy-line",
    presetId: "scientific",
    figureOverrides: {
      aspectMode: "4:3",
      tickDirection: "outside",
      minorTicks: false,
      gridVisible: false,
      legendPosition: "top-right",
      legendOrientation: "vertical",
      legendFrame: false
    }
  };

  const folders = [
    { id: "folder-experiment", name: "实验数据" },
    { id: "folder-paper", name: "论文" },
    ...(includeVisualQa
      ? [{ id: "folder-gallery", name: "常用图验收" }]
      : [])
  ];

  const spectrumSheet = createSpectrumSheet();
  const fieldSheet = createFieldSheet();
  const doubleYSheet = createDualYAxisSheet();
  const waterfallSheet = createWaterfallSheet();
  const scatterErrorbarSheet = createScatterErrorbarSheet();
  const barSheet = createBarSheet();

  const spectrumBook: DataBook = {
    id: id("book-spectrum"),
    name: "OSA 光谱数据",
    folderId: "folder-experiment",
    sheets: [spectrumSheet]
  };

  const fieldBook: DataBook = {
    id: id("book-field"),
    name: "二维光场数据",
    folderId: "folder-experiment",
    sheets: [fieldSheet]
  };

  const commonPlotsBook: DataBook = {
    id: id("book-common"),
    name: "常用图型示例",
    folderId: "folder-experiment",
    sheets: [doubleYSheet, waterfallSheet]
  };

  const galleryBook: DataBook = {
    id: id("book-gallery"),
    name: "Matplotlib 验收数据",
    folderId: "folder-gallery",
    sheets: [scatterErrorbarSheet, barSheet]
  };

  const spectrumFigure = makeFigure(
    spectrumSheet,
    "Fig 1 · 光谱",
    "spectrum",
    defaults,
    "folder-paper",
    {
      xTitle: "$\\lambda$ (nm)",
      yTitle: "光谱功率 (dBm)"
    }
  );

  const doubleYFigure = makeFigure(
    doubleYSheet,
    "Fig 2 · 双 Y",
    "double-y",
    defaults,
    "folder-paper",
    {
      xTitle: "泵浦电流 (A)",
      yTitle: "输出功率 (W)",
      rightYTitle: "光光效率 (%)",
      legendPosition: "top-left",
      legendOrientation: "vertical"
    },
    {
      "output-power": {
        yAxis: "left",
        color: "#1F77B4"
      },
      efficiency: {
        yAxis: "right",
        color: "#FF7F0E"
      }
    }
  );

  const waterfallFigure = makeFigure(
    waterfallSheet,
    "Fig 3 · 瀑布图",
    "waterfall",
    defaults,
    "folder-paper",
    {
      waterfallXOffset: 0.35,
      waterfallYOffset: 4.2,
      legendVisible: false
    }
  );

  const heatmapFigure = makeFigure(
    fieldSheet,
    "Fig 4 · 热图",
    "heatmap",
    defaults,
    "folder-paper",
    {
      xTitle: "横向位置 (mm)",
      yTitle: "纵向位置 (mm)",
      legendVisible: false,
      colorScale: "Viridis",
      colorbarTitle: "归一化强度"
    }
  );

  const contourFigure = makeFigure(
    fieldSheet,
    "Fig 5 · 等高线",
    "contour",
    defaults,
    "folder-paper",
    {
      xTitle: "横向位置 (mm)",
      yTitle: "纵向位置 (mm)",
      legendVisible: false,
      colorScale: "Viridis",
      colorbarTitle: "归一化强度",
      contourLevels: 12,
      contourFill: true,
      contourLines: true
    }
  );

  const surfaceFigure = makeFigure(
    fieldSheet,
    "Fig S1 · 3D 光场",
    "surface-3d",
    defaults,
    "folder-paper",
    {
      xTitle: "横向位置 (mm)",
      yTitle: "纵向位置 (mm)",
      legendVisible: false,
      colorScale: "RdBu",
      reverseColorScale: true,
      colorbarTitle: "归一化强度",
      zTitle: "归一化强度 (a.u.)"
    }
  );

  const scatterFigure = makeFigure(
    scatterErrorbarSheet,
    "QA 1 · 散点图",
    "xy-scatter",
    defaults,
    "folder-gallery",
    {
      xTitle: "温度 (°C)",
      yTitle: "归一化响应 (a.u.)",
      legendPosition: "outside-right"
    },
    {
      "sample-a": {
        color: "#1F77B4",
        markerSymbol: "circle",
        markerSizePt: 4.8
      },
      "sample-b": {
        color: "#FF7F0E",
        markerSymbol: "square",
        markerSizePt: 4.8
      }
    }
  );

  const errorbarFigure = makeFigure(
    scatterErrorbarSheet,
    "QA 2 · 误差棒",
    "xy-errorbar",
    defaults,
    "folder-gallery",
    {
      xTitle: "温度 (°C)",
      yTitle: "样品 A 响应 (a.u.)",
      legendVisible: false
    },
    {
      "sample-a": {
        color: "#1F77B4",
        lineVisible: false,
        markerVisible: true,
        markerSizePt: 4.8
      }
    }
  );

  const barFigure = makeFigure(
    barSheet,
    "QA 3 · 柱状图",
    "bar",
    defaults,
    "folder-gallery",
    {
      yTitle: "占比 (%)",
      barLabelsVisible: true,
      barLabelDecimals: 0,
      barLabelPosition: "outside"
    },
    {
      fundamental: {
        color: "#1F77B4"
      }
    }
  );

  const groupedBarFigure = makeFigure(
    barSheet,
    "QA 4 · 分组柱状图",
    "grouped-bar",
    defaults,
    "folder-gallery",
    {
      yTitle: "占比 (%)",
      barGap: 0.18,
      barGroupGap: 0.06,
      barLabelsVisible: true,
      barLabelDecimals: 0,
      barLabelPosition: "outside",
      legendPosition: "outside-right"
    },
    {
      fundamental: { color: "#1F77B4" },
      "higher-order": { color: "#FF7F0E" },
      loss: { color: "#2CA02C" }
    }
  );

  const stackedBarFigure = makeFigure(
    barSheet,
    "QA 5 · 堆叠柱状图",
    "stacked-bar",
    defaults,
    "folder-gallery",
    {
      yTitle: "占比 (%)",
      barGap: 0.22,
      barLabelsVisible: true,
      barLabelDecimals: 0,
      barLabelPosition: "inside",
      legendPosition: "outside-right"
    },
    {
      fundamental: { color: "#1F77B4" },
      "higher-order": { color: "#FF7F0E" },
      loss: { color: "#2CA02C" }
    }
  );

  return {
    format: "sfig",
    schemaVersion: "0.5",
    projectId: id("project"),
    name: "未命名项目",
    folders,
    dataBooks: [
      spectrumBook,
      fieldBook,
      commonPlotsBook,
      ...(includeVisualQa ? [galleryBook] : [])
    ],
    figures: [
      spectrumFigure,
      doubleYFigure,
      waterfallFigure,
      heatmapFigure,
      contourFigure,
      surfaceFigure,
      ...(includeVisualQa
        ? [
            scatterFigure,
            errorbarFigure,
            barFigure,
            groupedBarFigure,
            stackedBarFigure
          ]
        : [])
    ],
    activeFigureId: spectrumFigure.id,
    defaults: {
      templateId: defaults.templateId,
      presetId: defaults.presetId,
      figureOverrides: defaults.figureOverrides
    }
  };
}
