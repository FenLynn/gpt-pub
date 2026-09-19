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
  } else if (
    figure.templateId === "heatmap" ||
    figure.templateId === "contour" ||
    figure.templateId === "surface-3d"
  ) {
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
      '<ellipse cx="96" cy="52" rx="38" ry="23" fill="#ffffff" opacity="0.22"/>' +
      (figure.templateId === "contour"
        ? '<path d="M28 72 C52 46 70 82 96 50 S142 32 166 54" fill="none" stroke="#202328" stroke-width="0.8" opacity="0.68"/>' +
          '<path d="M22 57 C48 30 77 65 104 36 S146 24 170 38" fill="none" stroke="#202328" stroke-width="0.65" opacity="0.58"/>' +
          '<path d="M34 84 C58 65 85 92 114 68 S150 54 166 70" fill="none" stroke="#202328" stroke-width="0.65" opacity="0.58"/>'
        : "");
  } else {
    const visible = figure.seriesOrder
      .map((id) => dataset.ys.find((series) => series.id === id))
      .filter((series): series is NonNullable<typeof series> => Boolean(series))
      .filter((series) => figure.seriesOverrides[series.id]?.visible !== false)
      .slice(0, 4);

    const categoricalX = dataset.x.values.some(
      (value) => typeof value === "string"
    );
    const waterfall = figure.templateId === "waterfall";
    const doubleY = figure.templateId === "double-y";
    const waterfallXOffset = waterfall
      ? figure.figureOverrides.waterfallXOffset ?? 0.5
      : 0;
    const waterfallYOffset = waterfall
      ? figure.figureOverrides.waterfallYOffset ?? 5
      : 0;

    const baseX = categoricalX
      ? dataset.x.values.map((_value, index) => index)
      : numbers(
          dataset.x.values.map((value) =>
            typeof value === "number" ? value : null
          )
        );
    const xValues =
      waterfall && !categoricalX
        ? visible.flatMap((_series, seriesIndex) =>
            baseX.map((value) => value + seriesIndex * waterfallXOffset)
          )
        : baseX;
    const allY = visible.flatMap((series, seriesIndex) =>
      numbers(series.values).map(
        (value) => value + seriesIndex * waterfallYOffset
      )
    );
    const minX = Math.min(...xValues, 0);
    const maxX = Math.max(...xValues, 1);
    const minY = Math.min(...allY, 0);
    const maxY = Math.max(...allY, 1);

    const leftY = visible.flatMap((series, seriesIndex) => {
      const axis =
        figure.seriesOverrides[series.id]?.yAxis ??
        (seriesIndex === 0 ? "left" : "right");
      return axis === "left" ? numbers(series.values) : [];
    });
    const rightY = visible.flatMap((series, seriesIndex) => {
      const axis =
        figure.seriesOverrides[series.id]?.yAxis ??
        (seriesIndex === 0 ? "left" : "right");
      return axis === "right" ? numbers(series.values) : [];
    });
    const leftMinY = Math.min(...leftY, 0);
    const leftMaxY = Math.max(...leftY, 1);
    const rightMinY = Math.min(...rightY, 0);
    const rightMaxY = Math.max(...rightY, 1);

    const sx = (value: number) =>
      left + ((value - minX) / Math.max(1e-12, maxX - minX)) * (width - left - right);
    const syRange = (value: number, low: number, high: number) =>
      top + (1 - (value - low) / Math.max(1e-12, high - low)) * (height - top - bottom);
    const sy = (value: number) => syRange(value, minY, maxY);
    const syForSeries = (value: number, series: (typeof visible)[number], seriesIndex: number) => {
      if (!doubleY) return sy(value);
      const axis =
        figure.seriesOverrides[series.id]?.yAxis ??
        (seriesIndex === 0 ? "left" : "right");
      return axis === "right"
        ? syRange(value, rightMinY, rightMaxY)
        : syRange(value, leftMinY, leftMaxY);
    };

    const barTemplate =
      figure.templateId === "bar" ||
      figure.templateId === "grouped-bar" ||
      figure.templateId === "stacked-bar";

    content = visible
      .map((series, seriesIndex) => {
        const sourceIndex = Math.max(
          0,
          dataset.ys.findIndex((item) => item.id === series.id)
        );
        const color =
          figure.seriesOverrides[series.id]?.color ??
          preset.palette[sourceIndex % preset.palette.length];
        const step = Math.max(1, Math.ceil(dataset.x.values.length / 60));

        if (barTemplate) {
          const bars: string[] = [];
          const count = Math.max(1, dataset.x.values.length);
          const plotWidth = width - left - right;
          const groupWidth = plotWidth / count;
          const seriesCount = Math.max(1, visible.length);
          const barWidth =
            figure.templateId === "stacked-bar"
              ? Math.max(1, groupWidth * 0.62)
              : Math.max(1, (groupWidth * 0.72) / seriesCount);

          for (let index = 0; index < dataset.x.values.length; index += step) {
            const y = series.values[index];
            if (y === null) continue;
            const center = left + (index + 0.5) * groupWidth;
            const x =
              figure.templateId === "stacked-bar"
                ? center - barWidth / 2
                : center -
                  (barWidth * seriesCount) / 2 +
                  seriesIndex * barWidth;
            const zeroY = sy(0);
            const valueY = sy(y);
            const topY = Math.min(zeroY, valueY);
            const barHeight = Math.max(0.8, Math.abs(zeroY - valueY));
            bars.push(
              '<rect x="' +
                x.toFixed(1) +
                '" y="' +
                topY.toFixed(1) +
                '" width="' +
                Math.max(0.8, barWidth * 0.88).toFixed(1) +
                '" height="' +
                barHeight.toFixed(1) +
                '" fill="' +
                color +
                '" opacity="0.88"/>'
            );
          }
          return bars.join("");
        }

        const points: string[] = [];
        for (let index = 0; index < dataset.x.values.length; index += step) {
          const rawX = dataset.x.values[index];
          const y = series.values[index];
          if (rawX === null || y === null) continue;
          const base =
            categoricalX || typeof rawX !== "number" ? index : rawX;
          const x =
            waterfall && !categoricalX
              ? base + seriesIndex * waterfallXOffset
              : base;
          const plottedY = y + seriesIndex * waterfallYOffset;
          points.push(
            sx(x).toFixed(1) +
              "," +
              syForSeries(plottedY, series, seriesIndex).toFixed(1)
          );
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
    (figure.templateId === "double-y"
      ? '<path d="M172 10V96" fill="none" stroke="#3d4349" stroke-width="0.8"/>'
      : "") +
    content +
    '<text x="14" y="108" fill="#59616a" font-size="9" font-family="Arial, sans-serif">' +
    esc(figure.name).slice(0, 28) +
    "</text></svg>";

  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
