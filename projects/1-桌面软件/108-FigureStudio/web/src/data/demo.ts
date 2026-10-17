import { defaultDataRef } from "./adapter";
import { createLorentzSheet, createLorentzFigure } from "./lorentz";
import { createNatureDecaySheet, createNatureKineticsSheet, createNatureGallery } from "./natureGallery";
import type {
  DataBook,
  DataSheet,
  FigureSpec,
  ProjectState,
  UserDefaults
} from "../model";
import { GOLDEN_STYLE } from "../plot/goldenStyle";

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
        name: "Wavelength",
        unit: "nm",
        role: "X",
        values: x
      },
      {
        id: "measured",
        name: "Measured",
        unit: "dBm",
        role: "Y",
        values: measured
      },
      {
        id: "fit",
        name: "Gaussian fit",
        unit: "dBm",
        role: "Y",
        values: fit
      },
      {
        id: "sigma",
        name: "Uncertainty",
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
    name: "Horizontal position",
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
      rowAxisName: "Vertical position",
      rowAxisUnit: "mm"
    }
  };
}

export function createPeaksProjectionSheet(): DataSheet {
  const x = Array.from({ length: 49 }, (_v, i) =>
    Number((-3 + (6 * i) / 48).toFixed(4))
  );
  const columns: DataSheet["columns"] = [{
    id: "peaks-x",
    name: "x",
    role: "X",
    values: x
  }];
  const rowCoordinates: number[] = [];
  const rowCoordinateByColumnId: Record<string, number> = {};
  const peaks = (xv: number, yv: number) =>
    3 * Math.pow(1 - xv, 2) * Math.exp(-(xv * xv) - Math.pow(yv + 1, 2))
    - 10 * (xv / 5 - Math.pow(xv, 3) - Math.pow(yv, 5)) *
      Math.exp(-(xv * xv) - yv * yv)
    - (1 / 3) * Math.exp(-Math.pow(xv + 1, 2) - yv * yv);

  for (let row = 0; row < 41; row += 1) {
    const y = Number((-3 + (6 * row) / 40).toFixed(4));
    const rowId = "peaks-row-" + String(row + 1);
    rowCoordinates.push(y);
    rowCoordinateByColumnId[rowId] = y;
    columns.push({
      id: rowId,
      name: y.toFixed(2),
      unit: "a.u.",
      role: "Y",
      values: x.map((xv) => Number(peaks(xv, y).toFixed(6)))
    });
  }
  return {
    id: id("sheet-peaks-projection"),
    name: "Peaks 三向投影",
    source: { kind: "embedded" },
    columns,
    metadata: {
      rowCoordinates,
      rowCoordinateByColumnId,
      rowAxisName: "y"
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
        name: "Pump current",
        unit: "A",
        role: "X",
        values: current
      },
      {
        id: "output-power",
        name: "Output power",
        unit: "W",
        role: "Y",
        values: output
      },
      {
        id: "efficiency",
        name: "Optical efficiency",
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
    name: "Wavelength",
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
        name: "Temperature",
        unit: "°C",
        role: "X",
        values: temperature
      },
      {
        id: "sample-a",
        name: "Sample A",
        unit: "a.u.",
        role: "Y",
        values: sampleA
      },
      {
        id: "sample-b",
        name: "Sample B",
        unit: "a.u.",
        role: "Y",
        values: sampleB
      },
      {
        id: "response-error",
        name: "Measurement uncertainty",
        unit: "a.u.",
        role: "YErr",
        values: uncertainty
      }
    ]
  };
}

export function createBarSheet(): DataSheet {
  const categories = ["A", "B", "C", "D", "E"];
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
        name: "Condition",
        role: "X",
        values: categories
      },
      {
        id: "fundamental",
        name: "Fundamental mode",
        unit: "%",
        role: "Y",
        values: fundamental
      },
      {
        id: "higher-order",
        name: "Higher-order modes",
        unit: "%",
        role: "Y",
        values: higherOrder
      },
      {
        id: "loss",
        name: "Other losses",
        unit: "%",
        role: "Y",
        values: loss
      }
    ]
  };
}

export function createPcaEllipseSheet(): DataSheet {
  const groups = [
    { id: "pca-a", name: "Cluster A", cx: -3.0, cy: 1.6, sx: 1.15, sy: 0.72, phase: 0.2 },
    { id: "pca-b", name: "Cluster B", cx: 3.0, cy: 1.8, sx: 1.05, sy: 0.82, phase: 1.1 },
    { id: "pca-c", name: "Cluster C", cx: -2.1, cy: -2.2, sx: 0.92, sy: 0.72, phase: 2.0 },
    { id: "pca-d", name: "Cluster D", cx: 3.2, cy: -2.0, sx: 1.0, sy: 0.68, phase: 2.8 }
  ];
  const count = 24;
  const x: number[] = [];
  const ys = groups.map(() => [] as Array<number | null>);
  groups.forEach((group, groupIndex) => {
    for (let i = 0; i < count; i += 1) {
      const t = (2 * Math.PI * i) / count + group.phase;
      const radial = 0.62 + 0.26 * (0.5 + 0.5 * Math.sin(i * 2.37 + groupIndex));
      const xv = group.cx + group.sx * radial * Math.cos(t) + 0.16 * Math.sin(i * 1.71);
      const yv = group.cy + group.sy * radial * Math.sin(t) + 0.12 * Math.cos(i * 1.29);
      x.push(Number(xv.toFixed(4)));
      ys.forEach((values, index) => values.push(index === groupIndex ? Number(yv.toFixed(4)) : null));
    }
  });
  return {
    id: id("sheet-pca-ellipse"),
    name: "PCA 置信椭圆",
    source: { kind: "embedded" },
    columns: [
      { id: "pc1", name: "PC1", unit: "%", role: "X", values: x },
      ...groups.map((group,index) => ({
        id: group.id,
        name: group.name,
        unit: "%",
        role: "Y" as const,
        values: ys[index]
      }))
    ]
  };
}

export function createVolcanoSheet(): DataSheet {
  const x: number[] = [];
  const significance: number[] = [];
  for (let i = 0; i < 360; i += 1) {
    const u = (i + 0.5) / 360;
    const folded = ((i * 97) % 359) / 359;
    const fc = (folded - 0.5) * 8 + 0.28 * Math.sin(i * 1.73);
    const centerPenalty = Math.exp(-Math.pow(fc / 1.25, 2));
    const sig = 0.45 + 0.72 * Math.abs(fc) +
      2.4 * Math.pow(0.5 + 0.5 * Math.sin(i * 2.11 + u), 2) * (1 - 0.62 * centerPenalty);
    x.push(Number(fc.toFixed(4)));
    significance.push(Number(Math.min(9.6, sig).toFixed(4)));
  }
  return {
    id: id("sheet-volcano"),
    name: "Volcano",
    source: { kind: "embedded" },
    columns: [
      { id: "log2fc", name: "log2 fold change", role: "X", values: x },
      { id: "neglog10p", name: "-log10(p)", role: "Y", values: significance }
    ]
  };
}

export function createRidgelineSheet(): DataSheet {
  const x = Array.from({ length: 180 }, (_v,index) =>
    Number((-4 + (10 * index) / 179).toFixed(4))
  );
  const series = Array.from({ length: 6 }, (_v,index) => {
    const center = -0.8 + index * 0.42;
    const shoulder = 1.7 - index * 0.16;
    return {
      id: "ridge-" + String(index + 1),
      name: "Group " + String(index + 1),
      role: "Y" as const,
      values: x.map((value) => {
        const main = Math.exp(-0.5 * Math.pow((value - center) / (0.72 + index * 0.035), 2));
        const secondary = 0.28 * Math.exp(-0.5 * Math.pow((value - shoulder) / 0.58, 2));
        return Number((main + secondary).toFixed(6));
      })
    };
  });
  return {
    id: id("sheet-ridgeline"),
    name: "Ridgeline",
    source: { kind: "embedded" },
    columns: [
      { id: "ridge-x", name: "Expression level", unit: "log2", role: "X", values: x },
      ...series
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
      publicationMode: "single",
      aspectMode: "4:3",
      fontFamily: "Times New Roman",
      fontSizePt: GOLDEN_STYLE.typography.referenceBodyPt,
      tickLabelSizePt: GOLDEN_STYLE.typography.referenceTickPt,
      axisTitleSizePt: GOLDEN_STYLE.typography.referenceAxisTitlePt,
      plotTitleSizePt: GOLDEN_STYLE.typography.referencePlotTitlePt,
      legendFontSizePt: GOLDEN_STYLE.typography.referenceLegendPt,
      axisTitleColor: GOLDEN_STYLE.typography.axisTitleColor,
      tickLabelColor: GOLDEN_STYLE.typography.tickColor,
      axisLineWidthPt: GOLDEN_STYLE.stroke.referenceAxisPt,
      majorTickLengthPt: GOLDEN_STYLE.stroke.majorTickLengthPt,
      minorTickLengthPt: GOLDEN_STYLE.stroke.minorTickLengthPt,
      tickDirection: "inside",
      minorTicks: true,
      gridVisible: true,
      frameStyle: "boxed",
      legendPosition: "top-right",
      legendOrientation: "vertical",
      legendFrame: true,
      legendBackground: GOLDEN_STYLE.legend.background,
      legendBackgroundOpacity: GOLDEN_STYLE.legend.backgroundOpacity,
      legendBorderColor: GOLDEN_STYLE.legend.borderColor,
      legendBorderWidthPt: GOLDEN_STYLE.stroke.legendBorderPt
    }
  };

  const folders = [
    { id: "folder-golden", name: "Golden Reference · 双面板" },
    { id: "folder-nature", name: "Nature Gallery · 14 samples" },
    { id: "folder-experiment", name: "实验数据" },
    { id: "folder-paper", name: "论文" },
    ...(includeVisualQa
      ? [{ id: "folder-gallery", name: "常用图验收" }]
      : [])
  ];

  const spectrumSheet = createSpectrumSheet();
  const fieldSheet = createFieldSheet();
  const peaksProjectionSheet = createPeaksProjectionSheet();
  const doubleYSheet = createDualYAxisSheet();
  const waterfallSheet = createWaterfallSheet();
  const scatterErrorbarSheet = createScatterErrorbarSheet();
  const barSheet = createBarSheet();
  const pcaEllipseSheet = createPcaEllipseSheet();
  const volcanoSheet = createVolcanoSheet();
  const ridgelineSheet = createRidgelineSheet();
  const lorentzSheet = createLorentzSheet();
  const natureDecaySheet = createNatureDecaySheet();
  const natureKineticsSheet = createNatureKineticsSheet();
  const lorentzFigure = createLorentzFigure(lorentzSheet, defaults);
  const natureFigures = createNatureGallery(defaults, {
    spectrum: spectrumSheet,
    dualY: doubleYSheet,
    waterfall: waterfallSheet,
    scatter: scatterErrorbarSheet,
    field: fieldSheet,
    bar: barSheet,
    decay: natureDecaySheet,
    kinetics: natureKineticsSheet
  });
  const natureBook: DataBook = {
    id: id("book-nature"),
    name: "Synthetic Nature Gallery data",
    folderId: "folder-nature",
    sheets: [lorentzSheet, natureDecaySheet, natureKineticsSheet, scatterErrorbarSheet, barSheet]
  };

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
    sheets: [fieldSheet, peaksProjectionSheet]
  };

  const commonPlotsBook: DataBook = {
    id: id("book-common"),
    name: "常用图型示例",
    folderId: "folder-experiment",
    sheets: [doubleYSheet, waterfallSheet, pcaEllipseSheet, volcanoSheet, ridgelineSheet]
  };

  const spectrumFigure = makeFigure(
    spectrumSheet,
    "Fig 1 · 光谱",
    "spectrum",
    defaults,
    "folder-paper",
    {
      xTitle: "Wavelength (nm)",
      yTitle: "Spectral power (dBm)"
    }
  );

  const doubleYFigure = makeFigure(
    doubleYSheet,
    "Fig 2 · 双 Y",
    "double-y",
    defaults,
    "folder-paper",
    {
      xTitle: "Pump current (A)",
      yTitle: "Output power (W)",
      rightYTitle: "Optical efficiency (%)",
      legendPosition: "top-left",
      legendOrientation: "vertical"
    },
    {
      "output-power": {
        yAxis: "left",
        color: GOLDEN_STYLE.palette[0]
      },
      efficiency: {
        yAxis: "right",
        color: GOLDEN_STYLE.palette[1]
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
      xTitle: "Horizontal position (mm)",
      yTitle: "Vertical position (mm)",
      legendVisible: false,
      colorScale: "Cividis",
      colorbarTitle: "Normalized intensity"
    }
  );

  const contourFigure = makeFigure(
    fieldSheet,
    "Fig 5 · 等高线",
    "contour",
    defaults,
    "folder-paper",
    {
      xTitle: "Horizontal position (mm)",
      yTitle: "Vertical position (mm)",
      legendVisible: false,
      colorScale: "Cividis",
      colorbarTitle: "Normalized intensity",
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
      xTitle: "Horizontal position (mm)",
      yTitle: "Vertical position (mm)",
      legendVisible: false,
      colorScale: "Cividis",
      reverseColorScale: false,
      zTitle: "Normalized intensity (a.u.)"
    }
  );

  const projectedSurfaceFigure = makeFigure(
    peaksProjectionSheet,
    "Fig S2 · 3D 曲面三向投影",
    "surface-projection-3d",
    defaults,
    "folder-paper",
    {
      xTitle: "x",
      yTitle: "y",
      zTitle: "z = peaks(x, y)",
      plotTitle: "Surface with three-direction contour projections",
      legendVisible: false,
      colorScale: "Viridis",
      colorbarTitle: "z",
      surfaceProjectionFloor: true,
      surfaceProjectionX: true,
      surfaceProjectionY: true,
      surfaceProjectionContourCount: 12,
      surfaceProjectionLineWidthPt: 0.45,
      surfaceProjectionUseColorMap: true
    }
  );

  const pcaFigure = makeFigure(
    pcaEllipseSheet,
    "Fig S3 · PCA confidence ellipses",
    "pca-ellipse",
    defaults,
    "folder-paper",
    {
      xTitle: "PC1 (37.1%)",
      yTitle: "PC2 (21.4%)",
      colorCycle: "sea-salt-coral",
      legendPosition: "top-right",
      pcaEllipseScale: 2.15,
      pcaEllipseFillOpacity: 0.14
    }
  );

  const volcanoFigure = makeFigure(
    volcanoSheet,
    "Fig S4 · Volcano plot",
    "volcano",
    defaults,
    "folder-paper",
    {
      xTitle: "$\\log_2$ fold change",
      yTitle: "$-\\log_{10}(p)$",
      colorCycle: "sea-salt-coral",
      legendVisible: false,
      volcanoXThreshold: 1,
      volcanoYThreshold: 1.301,
      volcanoPointOpacity: 0.62,
      gridVisible: false
    }
  );

  const ridgelineFigure = makeFigure(
    ridgelineSheet,
    "Fig S5 · Density ridges",
    "ridgeline",
    defaults,
    "folder-paper",
    {
      xTitle: "Expression level ($\\log_2$)",
      yTitle: "",
      colorCycle: "mist-blue-celadon",
      legendVisible: false,
      ridgelineOffset: 1,
      ridgelineScale: 0.88,
      ridgelineFillOpacity: 0.32,
      gridVisible: false
    }
  );

  const scatterFigure = makeFigure(
    scatterErrorbarSheet,
    "QA 1 · 散点图",
    "xy-scatter",
    defaults,
    "folder-gallery",
    {
      xTitle: "Temperature (°C)",
      yTitle: "Normalized response (a.u.)",
      legendPosition: "outside-right"
    },
    {
      "sample-a": {
        color: GOLDEN_STYLE.palette[0],
        markerSymbol: "circle",
        markerSizePt: 4.8
      },
      "sample-b": {
        color: GOLDEN_STYLE.palette[1],
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
      xTitle: "Temperature (°C)",
      yTitle: "Sample A response (a.u.)",
      legendVisible: false
    },
    {
      "sample-a": {
        color: GOLDEN_STYLE.palette[0],
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
      yTitle: "Fraction (%)",
      barLabelsVisible: true,
      barLabelDecimals: 0,
      barLabelPosition: "outside"
    },
    {
      fundamental: {
        color: GOLDEN_STYLE.palette[0]
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
      yTitle: "Fraction (%)",
      barGap: 0.18,
      barGroupGap: 0.06,
      barLabelsVisible: true,
      barLabelDecimals: 0,
      barLabelPosition: "outside",
      legendPosition: "outside-right"
    },
    {
      fundamental: { color: GOLDEN_STYLE.palette[0] },
      "higher-order": { color: GOLDEN_STYLE.palette[1] },
      loss: { color: GOLDEN_STYLE.palette[3] }
    }
  );

  const stackedBarFigure = makeFigure(
    barSheet,
    "QA 5 · 堆叠柱状图",
    "stacked-bar",
    defaults,
    "folder-gallery",
    {
      yTitle: "Fraction (%)",
      barGap: 0.22,
      barLabelsVisible: true,
      barLabelDecimals: 0,
      barLabelPosition: "inside",
      legendPosition: "outside-right"
    },
    {
      fundamental: { color: GOLDEN_STYLE.palette[0] },
      "higher-order": { color: GOLDEN_STYLE.palette[1] },
      loss: { color: GOLDEN_STYLE.palette[3] }
    }
  );

  return {
    format: "sfig",
    schemaVersion: "0.5",
    projectId: id("project"),
    name: "未命名项目",
    folders,
    dataBooks: [
      natureBook,
      spectrumBook,
      fieldBook,
      commonPlotsBook
    ],
    figures: [
      ...natureFigures,
      lorentzFigure,
      spectrumFigure,
      doubleYFigure,
      waterfallFigure,
      heatmapFigure,
      contourFigure,
      surfaceFigure,
      projectedSurfaceFigure,
      pcaFigure,
      volcanoFigure,
      ridgelineFigure,
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
    activeFigureId: natureFigures[0].id,
    defaults: {
      templateId: defaults.templateId,
      presetId: defaults.presetId,
      figureOverrides: defaults.figureOverrides
    }
  };
}
