import type { Dataset } from "../model";

export function createDemoDataset(): Dataset {
  const x: number[] = [];
  const measured: number[] = [];
  const fit: number[] = [];

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
  }

  return {
    id: "dataset-demo-spectrum",
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
      }
    ]
  };
}
