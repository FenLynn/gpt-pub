import { defaultDataRef, sheetToDataset } from "./adapter";
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
    name: "Spectrum",
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
    name: "X",
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
    name: "Beam field",
    columns,
    metadata: {
      rowCoordinates,
      rowAxisName: "Y",
      rowAxisUnit: "mm"
    }
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
  const dataset = sheetToDataset(sheet);

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
      xTitle: dataset.x.unit
        ? dataset.x.name + " (" + dataset.x.unit + ")"
        : dataset.x.name,
      yTitle: dataset.ys[0]?.unit
        ? dataset.ys[0].name + " (" + dataset.ys[0].unit + ")"
        : dataset.ys[0]?.name || "Y",
      errorSeriesId: dataRef.yErrorColumnId,
      ...overrides
    },
    seriesOverrides,
    seriesOrder: dataRef.yColumnIds
  };
}

export function createInitialProject(userDefaults?: UserDefaults): ProjectState {
  const defaults: UserDefaults = userDefaults ?? {
    templateId: "xy-line",
    presetId: "scientific",
    figureOverrides: {
      aspectMode: "4:3",
      tickDirection: "inside",
      minorTicks: false,
      gridVisible: false,
      legendVisible: true,
      legendPosition: "top-left",
      legendOrientation: "horizontal",
      legendFrame: false
    }
  };

  const folders = [
    { id: "folder-experiment", name: "实验数据" },
    { id: "folder-paper", name: "论文" }
  ];

  const spectrumSheet = createSpectrumSheet();
  const fieldSheet = createFieldSheet();

  const spectrumBook: DataBook = {
    id: id("book-spectrum"),
    name: "OSA 光谱数据",
    folderId: "folder-experiment",
    source: { kind: "embedded" },
    sheets: [spectrumSheet]
  };

  const fieldBook: DataBook = {
    id: id("book-field"),
    name: "二维光场数据",
    folderId: "folder-experiment",
    source: { kind: "embedded" },
    sheets: [fieldSheet]
  };

  const spectrumFigure = makeFigure(
    spectrumSheet,
    "Fig 1 · 光谱",
    "spectrum",
    defaults,
    "folder-paper",
    {
      xTitle: "波长 λ (nm)",
      yTitle: "功率 (dBm)"
    }
  );

  const heatmapFigure = makeFigure(
    fieldSheet,
    "Fig 2 · 光场",
    "heatmap",
    defaults,
    "folder-paper",
    {
      xTitle: "X (mm)",
      yTitle: "Y (mm)",
      legendVisible: false,
      colorScale: "Viridis"
    }
  );

  const surfaceFigure = makeFigure(
    fieldSheet,
    "Fig S1 · 3D 光场",
    "surface-3d",
    defaults,
    "folder-paper",
    {
      xTitle: "X (mm)",
      yTitle: "Y (mm)",
      legendVisible: false,
      colorScale: "Viridis"
    }
  );

  return {
    format: "sfig",
    schemaVersion: "0.3",
    projectId: id("project"),
    name: "未命名项目",
    folders,
    dataBooks: [spectrumBook, fieldBook],
    figures: [spectrumFigure, heatmapFigure, surfaceFigure],
    activeFigureId: spectrumFigure.id,
    defaults: {
      templateId: defaults.templateId,
      presetId: defaults.presetId,
      figureOverrides: defaults.figureOverrides
    }
  };
}
