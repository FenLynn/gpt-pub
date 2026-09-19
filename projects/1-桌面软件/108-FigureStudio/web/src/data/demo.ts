import type {
  Dataset,
  FigureSpec,
  ProjectState,
  UserDefaults
} from "../model";

function id(prefix: string): string {
  return prefix + "-" + Math.random().toString(36).slice(2, 10);
}

export function createSpectrumDataset(): Dataset {
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
    id: id("dataset-spectrum"),
    name: "合成 OSA 光谱",
    x: {
      id: "wavelength",
      name: "波长",
      unit: "nm",
      values: x
    },
    ys: [
      {
        id: "measured",
        name: "测量数据",
        unit: "dBm",
        values: measured
      },
      {
        id: "fit",
        name: "高斯拟合",
        unit: "dBm",
        values: fit
      },
      {
        id: "sigma",
        name: "标准差",
        unit: "dB",
        values: sigma
      }
    ]
  };
}

export function createFieldDataset(): Dataset {
  const x: number[] = [];
  const ys = [];
  const rowCoordinates: number[] = [];

  for (let i = 0; i < 96; i += 1) {
    x.push(Number((-3.2 + (6.4 * i) / 95).toFixed(4)));
  }

  for (let row = 0; row < 25; row += 1) {
    const y = -2.4 + (4.8 * row) / 24;
    rowCoordinates.push(Number(y.toFixed(4)));
    const values = x.map((xValue) => {
      const r2 = Math.pow(xValue / 1.08, 2) + Math.pow(y / 0.82, 2);
      const shoulder = 0.12 * Math.exp(
        -Math.pow((xValue - 1.25) / 0.52, 2) - Math.pow((y + 0.35) / 0.62, 2)
      );
      return Number((Math.exp(-2 * r2) + shoulder).toFixed(6));
    });

    ys.push({
      id: "row-" + String(row + 1),
      name: y.toFixed(2),
      unit: "a.u.",
      values
    });
  }

  return {
    id: id("dataset-field"),
    name: "合成二维光场",
    x: {
      id: "x-position",
      name: "X",
      unit: "mm",
      values: x
    },
    ys,
    metadata: {
      rowCoordinates,
      rowAxisName: "Y",
      rowAxisUnit: "mm"
    }
  };
}

function makeFigure(
  dataset: Dataset,
  name: string,
  templateId: FigureSpec["templateId"],
  defaults: UserDefaults,
  overrides: FigureSpec["figureOverrides"] = {},
  seriesOverrides: FigureSpec["seriesOverrides"] = {}
): FigureSpec {
  return {
    id: id("figure"),
    name,
    datasetId: dataset.id,
    templateId,
    presetId: defaults.presetId,
    figureOverrides: {
      aspectMode: "4:3",
      ...defaults.figureOverrides,
      ...overrides
    },
    seriesOverrides,
    seriesOrder: dataset.ys.map((series) => series.id)
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

  const spectrum = createSpectrumDataset();
  const field = createFieldDataset();

  const spectrumFigure = makeFigure(
    spectrum,
    "图 1 · 光谱",
    "spectrum",
    defaults,
    {
      xTitle: "波长 λ (nm)",
      yTitle: "功率 (dBm)"
    },
    {
      sigma: { visible: false }
    }
  );

  const heatmapFigure = makeFigure(field, "图 2 · 光场", "heatmap", defaults, {
    xTitle: "X (mm)",
    yTitle: "Y (mm)",
    aspectMode: "4:3",
    legendVisible: false,
    colorScale: "Viridis"
  });

  const surfaceFigure = makeFigure(field, "图 3 · 3D 光场", "surface-3d", defaults, {
    xTitle: "X (mm)",
    yTitle: "Y (mm)",
    aspectMode: "4:3",
    legendVisible: false,
    colorScale: "Viridis"
  });

  return {
    format: "sfig",
    schemaVersion: "0.1",
    projectId: id("project"),
    name: "未命名项目",
    datasets: [spectrum, field],
    figures: [spectrumFigure, heatmapFigure, surfaceFigure],
    activeFigureId: spectrumFigure.id,
    defaults: {
      templateId: defaults.templateId,
      presetId: defaults.presetId,
      figureOverrides: defaults.figureOverrides
    }
  };
}
