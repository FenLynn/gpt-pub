import type { Dataset, FigureSpec, PresetDefinition } from "../model";

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return map[char];
  });
}

function numbers(values: Array<number | null>): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

export function figureThumbnailDataUrl(
  dataset: Dataset | undefined,
  figure: FigureSpec,
  preset: PresetDefinition
): string {
  const width = 180;
  const height = 112;
  const left = 14;
  const right = 8;
  const top = 10;
  const bottom = 16;
  const bg = figure.figureOverrides.background ?? "#ffffff";

  let content = "";

  if (!dataset) {
    content = '<text x="90" y="58" text-anchor="middle" fill="#8a929a" font-size="11">缺少数据</text>';
  } else if (figure.templateId === "heatmap" || figure.templateId === "surface-3d") {
    const scale = figure.figureOverrides.colorScale ?? "Viridis";
    const gradientId = "g";
    const palettes: Record<string, string[]> = {
      Viridis: ["#440154", "#31688e", "#35b779", "#fde725"],
      Cividis: ["#00204c", "#575d6d", "#a59c74", "#fee838"],
      Magma: ["#000004", "#51127c", "#b73779", "#fcfdbf"],
      Inferno: ["#000004", "#57106e", "#bc3754", "#fcffa4"],
      RdBu: ["#2166ac", "#f7f7f7", "#b2182b"],
      Greys: ["#ffffff", "#969696", "#252525"]
    };
    const stops = palettes[scale] ?? palettes.Viridis;
    content =
      '<defs><linearGradient id="' +
      gradientId +
      '" x1="0" x2="1" y1="1" y2="0">' +
      stops
        .map(
          (color, index) =>
            '<stop offset="' +
            Math.round((100 * index) / Math.max(1, stops.length - 1)) +
            '%" stop-color="' +
            color +
            '"/>'
        )
        .join("") +
      "</linearGradient></defs>" +
      '<rect x="' +
      left +
      '" y="' +
      top +
      '" width="' +
      (width - left - right) +
      '" height="' +
      (height - top - bottom) +
      '" fill="url(#' +
      gradientId +
      ')" opacity="0.9"/>' +
      '<ellipse cx="96" cy="52" rx="38" ry="23" fill="#ffffff" opacity="0.22"/>';
  } else {
    const visible = figure.seriesOrder
      .map((id) => dataset.ys.find((series) => series.id === id))
      .filter((series): series is NonNullable<typeof series> => Boolean(series))
      .filter((series) => figure.seriesOverrides[series.id]?.visible !== false)
      .slice(0, 4);

    const xValues = numbers(dataset.x.values);
    const allY = visible.flatMap((series) => numbers(series.values));
    const minX = Math.min(...xValues, 0);
    const maxX = Math.max(...xValues, 1);
    const minY = Math.min(...allY, 0);
    const maxY = Math.max(...allY, 1);
    const sx = (value: number) =>
      left + ((value - minX) / Math.max(1e-12, maxX - minX)) * (width - left - right);
    const sy = (value: number) =>
      top + (1 - (value - minY) / Math.max(1e-12, maxY - minY)) * (height - top - bottom);

    content = visible
      .map((series, seriesIndex) => {
        const sourceIndex = Math.max(0, dataset.ys.findIndex((item) => item.id === series.id));
        const color =
          figure.seriesOverrides[series.id]?.color ??
          preset.palette[sourceIndex % preset.palette.length];
        const points: string[] = [];
        const step = Math.max(1, Math.ceil(dataset.x.values.length / 60));
        for (let index = 0; index < dataset.x.values.length; index += step) {
          const x = dataset.x.values[index];
          const y = series.values[index];
          if (x === null || y === null) continue;
          points.push(sx(x).toFixed(1) + "," + sy(y).toFixed(1));
        }
        return (
          '<polyline points="' +
          points.join(" ") +
          '" fill="none" stroke="' +
          color +
          '" stroke-width="' +
          (seriesIndex === 0 ? "1.5" : "1.1") +
          '" opacity="0.92"/>'
        );
      })
      .join("");
  }

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    width +
    '" height="' +
    height +
    '" viewBox="0 0 ' +
    width +
    " " +
    height +
    '">' +
    '<rect width="100%" height="100%" fill="' +
    bg +
    '"/>' +
    '<path d="M14 10V96H172" fill="none" stroke="#3d4349" stroke-width="0.8"/>' +
    content +
    '<text x="14" y="108" fill="#59616a" font-size="9" font-family="Arial, sans-serif">' +
    esc(figure.name).slice(0, 28) +
    "</text></svg>";

  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
