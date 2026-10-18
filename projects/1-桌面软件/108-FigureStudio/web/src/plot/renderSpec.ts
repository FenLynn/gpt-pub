import { resolveFieldRowCoordinates } from "../data/field";
import { normalizePlotlyMathText } from "../lib/mathText";
import {
  resolvePublicationMetrics,
  resolveSeriesPalette
} from "./publication";
import {
  GOLDEN_STYLE,
  goldenTickIntervalTarget
} from "./goldenStyle";
import type {
  Dataset,
  PlotColumn,
  FigureSpec,
  LegendPosition,
  PresetDefinition,
  TickLabelFormat
} from "../model";

export const DESIGN_DPI = 96;
export const PNG_DPI = 600;
export const PX_PER_MM = DESIGN_DPI / 25.4;

export function ptToPx(valuePt: number): number {
  return valuePt * (DESIGN_DPI / 72);
}

export function mmToPx(valueMm: number): number {
  return valueMm * PX_PER_MM;
}

export function plotFontFamily(font: "Arial" | "Times New Roman"): string {
  if (font === "Times New Roman") {
    return '"Times New Roman", "Songti SC", "SimSun", "Noto Serif CJK SC", serif';
  }
  return 'Arial, "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
}

function autoAxisTitle(name: string, unit?: string): string {
  return unit ? name + " (" + unit + ")" : name;
}

export function aspectRatioFor(
  mode = "4:3",
  customWidth = 4,
  customHeight = 3
): number {
  if (mode === "16:9") return 16 / 9;
  if (mode === "3:2") return 3 / 2;
  if (mode === "custom") {
    const width = Number.isFinite(customWidth) && customWidth > 0 ? customWidth : 4;
    const height = Number.isFinite(customHeight) && customHeight > 0 ? customHeight : 3;
    return width / height;
  }
  return 4 / 3;
}

export function resolveCanvasMm(
  preset: PresetDefinition,
  figure: FigureSpec
) {
  const overrides = figure.figureOverrides;
  const aspectMode = overrides.aspectMode ?? "4:3";
  const ratio = aspectRatioFor(
    aspectMode,
    overrides.customAspectWidth,
    overrides.customAspectHeight
  );
  const defaultWidth = resolvePublicationMetrics(preset, figure).widthMm;
  const widthMm = Number.isFinite(overrides.figureWidthMm) && (overrides.figureWidthMm ?? 0) > 0
    ? overrides.figureWidthMm! : defaultWidth;
  const heightMm = Number.isFinite(overrides.figureHeightMm) && (overrides.figureHeightMm ?? 0) > 0
    ? overrides.figureHeightMm! : widthMm / ratio;
  return { widthMm, heightMm, ratio: widthMm / heightMm, aspectMode };
}

export function orderSeries(
  dataset: Dataset,
  seriesOrder: string[],
  allowedIds?: string[]
): PlotColumn[] {
  const allowed = allowedIds ? new Set(allowedIds) : undefined;
  const candidates = allowed
    ? dataset.ys.filter((series) => allowed.has(series.id))
    : dataset.ys;
  const byId = new Map(candidates.map((series) => [series.id, series]));
  const ordered = seriesOrder
    .map((id) => byId.get(id))
    .filter((series): series is PlotColumn => Boolean(series));

  for (const series of candidates) {
    if (!ordered.some((item) => item.id === series.id)) ordered.push(series);
  }

  return ordered;
}

function legendAnchor(position: LegendPosition) {
  const map: Record<
    Exclude<LegendPosition, "custom">,
    { x: number; y: number; xanchor: string; yanchor: string }
  > = {
    "top-left": { x: 0.02, y: 0.985, xanchor: "left", yanchor: "top" },
    "top-center": { x: 0.5, y: 0.985, xanchor: "center", yanchor: "top" },
    "top-right": { x: 0.98, y: 0.985, xanchor: "right", yanchor: "top" },
    "bottom-left": { x: 0.02, y: 0.02, xanchor: "left", yanchor: "bottom" },
    "bottom-center": { x: 0.5, y: 0.02, xanchor: "center", yanchor: "bottom" },
    "bottom-right": { x: 0.98, y: 0.02, xanchor: "right", yanchor: "bottom" },
    "outside-right": { x: 1.02, y: 0.985, xanchor: "left", yanchor: "top" }
  };
  if (position === "custom") {
    return { x: 0.02, y: 0.985, xanchor: "left", yanchor: "top" };
  }
  return map[position];
}

function visibleSeries(dataset: Dataset, figure: FigureSpec): PlotColumn[] {
  return orderSeries(
    dataset,
    figure.seriesOrder,
    figure.dataRef?.yColumnIds
  ).filter(
    (series) => figure.seriesOverrides[series.id]?.visible !== false
  );
}

function rgbaFromHex(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const value = Number.parseInt(match[1], 16);
  return "rgba(" +
    ((value >> 16) & 255) + "," +
    ((value >> 8) & 255) + "," +
    (value & 255) + "," +
    Math.max(0, Math.min(1, alpha)) + ")";
}

function ellipsePolygon(
  x: number[],
  y: number[],
  scale: number
): { x: number[]; y: number[] } | undefined {
  const pairs = x.map((value,index)=>[value,y[index]] as const)
    .filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b));
  if (pairs.length < 3) return undefined;
  const mx = pairs.reduce((sum,[a])=>sum+a,0)/pairs.length;
  const my = pairs.reduce((sum,[,b])=>sum+b,0)/pairs.length;
  let cxx=0, cyy=0, cxy=0;
  for (const [a,b] of pairs) {
    const dx=a-mx, dy=b-my;
    cxx+=dx*dx; cyy+=dy*dy; cxy+=dx*dy;
  }
  const denom=Math.max(1,pairs.length-1);
  cxx/=denom; cyy/=denom; cxy/=denom;
  const root=Math.sqrt(Math.max(0,(cxx-cyy)*(cxx-cyy)+4*cxy*cxy));
  const l1=Math.max(0,(cxx+cyy+root)/2);
  const l2=Math.max(0,(cxx+cyy-root)/2);
  const angle=0.5*Math.atan2(2*cxy,cxx-cyy);
  const ca=Math.cos(angle), sa=Math.sin(angle);
  const a=scale*Math.sqrt(l1), b=scale*Math.sqrt(l2);
  const ex:number[]=[], ey:number[]=[];
  for(let i=0;i<=96;i+=1){
    const t=2*Math.PI*i/96, ct=Math.cos(t), st=Math.sin(t);
    ex.push(mx+a*ct*ca-b*st*sa);
    ey.push(my+a*ct*sa+b*st*ca);
  }
  return {x:ex,y:ey};
}

function baseXYTrace(
  dataset: Dataset,
  figure: FigureSpec,
  preset: PresetDefinition,
  series: PlotColumn,
  sourceIndex: number,
  modeDefault: "lines" | "markers" | "lines+markers",
  yValues?: Array<number | null>
) {
  const override = figure.seriesOverrides[series.id] || {};
  const metrics = resolvePublicationMetrics(preset, figure);
  const palette = resolveSeriesPalette(preset, figure);
  const isFit = /fit|拟合/i.test(series.name);
  const lineVisible =
    override.lineVisible ??
    (modeDefault === "lines" || modeDefault === "lines+markers");
  const markerVisible =
    override.markerVisible ??
    (modeDefault === "markers" || modeDefault === "lines+markers");
  const lineWidthPt = override.lineWidthPt ?? metrics.lineWidthPt;
  const markerSizePt =
    override.markerSizePt ??
    (modeDefault === "markers"
      ? GOLDEN_STYLE.marker.scatterSizePt
      : modeDefault === "lines+markers"
      ? GOLDEN_STYLE.marker.connectedSizePt
      : metrics.markerSizePt);
  const automaticMarkerCap =
    markerVisible &&
    lineVisible &&
    figure.templateId !== "xy-scatter" &&
    figure.templateId !== "xy-errorbar"
      ? metrics.mode === "quad-panel"
        ? 22
        : 28
      : 0;
  const markerMaxDisplayed =
    override.markerMaxDisplayed ?? automaticMarkerCap;
  const color =
    override.color || palette[sourceIndex % palette.length];
  const opacity = override.opacity ?? 1;
  const xIsNumeric = dataset.x.values.every(
    (value) => value === null || typeof value === "number"
  );

  let mode = "";
  if (lineVisible) mode += "lines";
  if (markerVisible) mode += (mode ? "+" : "") + "markers";
  if (!mode) mode = "lines";

  return {
    type: "scatter",
    mode,
    name: normalizePlotlyMathText(override.legendLabel ?? series.name),
    showlegend: override.showInLegend ?? true,
    meta: { figureStudioSeriesId: series.id },
    x: dataset.x.values,
    y: yValues ?? series.values,
    opacity,
    line: {
      color,
      width: ptToPx(
        isFit && override.lineWidthPt === undefined
          ? Math.max(0.65, lineWidthPt * 0.9)
          : lineWidthPt
      ),
      dash: override.lineStyle ?? (isFit ? "dash" : "solid"),
      simplify: false
    },
    marker: {
      color: override.markerHollow
        ? "rgba(0,0,0,0)"
        : override.markerFillColor ?? color,
      size: ptToPx(markerSizePt),
      symbol: override.markerSymbol ?? "circle",
      maxdisplayed:
        markerVisible && markerMaxDisplayed > 0
          ? Math.max(1, Math.round(markerMaxDisplayed))
          : 0,
      line: {
        color: override.markerEdgeColor ?? color,
        width: ptToPx(
          override.markerEdgeWidthPt ??
            (override.markerHollow
              ? GOLDEN_STYLE.marker.hollowEdgePt
              : GOLDEN_STYLE.marker.edgePt)
        )
      }
    },
    hovertemplate:
      "<b>" +
      series.name +
      "</b><br>" +
      dataset.x.name +
      "：" +
      (xIsNumeric ? "%{x:.4g}" : "%{x}") +
      (dataset.x.unit ? " " + dataset.x.unit : "") +
      "<br>%{y:.4g}" +
      (series.unit ? " " + series.unit : "") +
      "<extra></extra>"
  };
}

const SURFACE_MAX_RENDER_CELLS = 140000;

function clampSurfaceUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function surfaceCubic(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number
): number {
  const t2 = t * t;
  const t3 = t2 * t;
  const value =
    0.5 *
    ((2 * p1) +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  // Keep the display interpolation inside the local sample envelope. This
  // prevents publication smoothing from inventing ringing extrema.
  const low = Math.min(p0, p1, p2, p3);
  const high = Math.max(p0, p1, p2, p3);
  return Math.max(low, Math.min(high, value));
}

function surfaceLineSample(
  values: Array<number | null>,
  index: number,
  t: number
): number | null {
  const at = (i: number) => values[Math.max(0, Math.min(values.length - 1, i))] ?? null;
  const p0 = at(index - 1);
  const p1 = at(index);
  const p2 = at(index + 1);
  const p3 = at(index + 2);
  if (p1 === null || p2 === null) return p1 ?? p2;
  if (p0 === null || p3 === null) return p1 + (p2 - p1) * t;
  return surfaceCubic(p0, p1, p2, p3, t);
}

function densifySurfaceGrid(
  xInput: unknown[],
  yInput: unknown[],
  zInput: unknown[][],
  requestedFactor: number
): {
  x: number[];
  y: number[];
  z: Array<Array<number | null>>;
  factor: number;
} {
  const x = xInput.map((value) =>
    typeof value === "number" && Number.isFinite(value) ? value : Number.NaN
  );
  const y = yInput.map((value) =>
    typeof value === "number" && Number.isFinite(value) ? value : Number.NaN
  );
  const z = zInput.map((row) =>
    row.map((value) =>
      typeof value === "number" && Number.isFinite(value) ? value : null
    )
  );
  if (
    x.length < 2 ||
    y.length < 2 ||
    z.length !== y.length ||
    z.some((row) => row.length !== x.length) ||
    x.some((value) => !Number.isFinite(value)) ||
    y.some((value) => !Number.isFinite(value))
  ) {
    return {
      x: x.map((value, index) => Number.isFinite(value) ? value : index),
      y: y.map((value, index) => Number.isFinite(value) ? value : index),
      z,
      factor: 1
    };
  }

  const requested = Math.max(1, Math.min(6, Math.round(requestedFactor)));
  const baseCells = Math.max(1, (x.length - 1) * (y.length - 1));
  const safeFactor = Math.max(
    1,
    Math.min(
      requested,
      Math.floor(Math.sqrt(SURFACE_MAX_RENDER_CELLS / baseCells))
    )
  );
  if (safeFactor <= 1) return { x, y, z, factor: 1 };

  const interpolateAxis = (values: number[]) =>
    Array.from(
      { length: (values.length - 1) * safeFactor + 1 },
      (_unused, denseIndex) => {
        const position = denseIndex / safeFactor;
        const index = Math.min(values.length - 2, Math.floor(position));
        const t = denseIndex === (values.length - 1) * safeFactor
          ? 1
          : position - index;
        return values[index] + (values[index + 1] - values[index]) * t;
      }
    );

  const denseX = interpolateAxis(x);
  const denseY = interpolateAxis(y);
  const denseZ = denseY.map((_value, denseRow) => {
    const yPosition = denseRow / safeFactor;
    const yIndex = Math.min(y.length - 2, Math.floor(yPosition));
    const ty = denseRow === (y.length - 1) * safeFactor
      ? 1
      : yPosition - yIndex;

    return denseX.map((_xValue, denseColumn) => {
      const xPosition = denseColumn / safeFactor;
      const xIndex = Math.min(x.length - 2, Math.floor(xPosition));
      const tx = denseColumn === (x.length - 1) * safeFactor
        ? 1
        : xPosition - xIndex;

      const rowSamples: Array<number | null> = [];
      for (let offset = -1; offset <= 2; offset += 1) {
        const sourceRow = z[Math.max(0, Math.min(z.length - 1, yIndex + offset))];
        rowSamples.push(surfaceLineSample(sourceRow, xIndex, tx));
      }
      return surfaceLineSample(rowSamples, 1, ty);
    });
  });

  return { x: denseX, y: denseY, z: denseZ, factor: safeFactor };
}


type SurfaceContourPoint = [number, number, number];
type SurfaceContourSegment = [SurfaceContourPoint, SurfaceContourPoint];

function surfaceContourSegments(
  xs: number[],
  ys: number[],
  z: Array<Array<number | null>>,
  level: number
): SurfaceContourSegment[] {
  const segments: SurfaceContourSegment[] = [];
  const edge = (
    a: SurfaceContourPoint,
    b: SurfaceContourPoint
  ): SurfaceContourPoint | undefined => {
    const da = a[2] - level;
    const db = b[2] - level;
    if (
      !Number.isFinite(a[2]) ||
      !Number.isFinite(b[2]) ||
      (da < 0 && db < 0) ||
      (da > 0 && db > 0) ||
      Math.abs(a[2] - b[2]) < 1e-14
    ) return undefined;
    const t = (level - a[2]) / (b[2] - a[2]);
    if (!Number.isFinite(t) || t < 0 || t > 1) return undefined;
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      level
    ];
  };

  for (let row = 0; row < ys.length - 1; row += 1) {
    for (let column = 0; column < xs.length - 1; column += 1) {
      const values = [
        z[row]?.[column],
        z[row]?.[column + 1],
        z[row + 1]?.[column + 1],
        z[row + 1]?.[column]
      ];
      if (values.some((value) => value === null || !Number.isFinite(value))) continue;
      const p00: SurfaceContourPoint = [xs[column], ys[row], values[0] as number];
      const p10: SurfaceContourPoint = [xs[column + 1], ys[row], values[1] as number];
      const p11: SurfaceContourPoint = [xs[column + 1], ys[row + 1], values[2] as number];
      const p01: SurfaceContourPoint = [xs[column], ys[row + 1], values[3] as number];
      const hits = [
        edge(p00, p10),
        edge(p10, p11),
        edge(p11, p01),
        edge(p01, p00)
      ].filter((point): point is SurfaceContourPoint => Boolean(point));

      if (hits.length === 2) {
        segments.push([hits[0], hits[1]]);
      } else if (hits.length === 4) {
        const center =
          ((values[0] as number) +
            (values[1] as number) +
            (values[2] as number) +
            (values[3] as number)) / 4;
        if (center >= level) {
          segments.push([hits[0], hits[1]], [hits[2], hits[3]]);
        } else {
          segments.push([hits[0], hits[3]], [hits[1], hits[2]]);
        }
      }
    }
  }
  return segments;
}

function stitchSurfaceContourSegments(
  segments: SurfaceContourSegment[]
): SurfaceContourPoint[][] {
  if (!segments.length) return [];
  const key = (point: SurfaceContourPoint) =>
    point[0].toFixed(8) + ":" + point[1].toFixed(8);
  const adjacency = new Map<string, Array<{ index: number; end: 0 | 1 }>>();
  const add = (point: SurfaceContourPoint, index: number, end: 0 | 1) => {
    const id = key(point);
    const list = adjacency.get(id) ?? [];
    list.push({ index, end });
    adjacency.set(id, list);
  };
  segments.forEach((segment, index) => {
    add(segment[0], index, 0);
    add(segment[1], index, 1);
  });

  const visited = new Set<number>();
  const walk = (startIndex: number, startEnd: 0 | 1) => {
    const start = segments[startIndex][startEnd];
    const line: SurfaceContourPoint[] = [start];
    let index = startIndex;
    let end = startEnd;
    while (!visited.has(index)) {
      visited.add(index);
      const otherEnd = (end === 0 ? 1 : 0) as 0 | 1;
      const nextPoint = segments[index][otherEnd];
      line.push(nextPoint);
      const options = adjacency.get(key(nextPoint)) ?? [];
      const next = options.find((candidate) => !visited.has(candidate.index));
      if (!next) break;
      index = next.index;
      end = next.end;
    }
    return line;
  };

  const lines: SurfaceContourPoint[][] = [];
  segments.forEach((segment, index) => {
    if (visited.has(index)) return;
    const degree0 = adjacency.get(key(segment[0]))?.length ?? 0;
    const degree1 = adjacency.get(key(segment[1]))?.length ?? 0;
    if (degree0 === 1 || degree1 === 1) {
      lines.push(walk(index, degree0 === 1 ? 0 : 1));
    }
  });
  segments.forEach((_segment, index) => {
    if (!visited.has(index)) lines.push(walk(index, 0));
  });
  return lines.filter((line) => line.length >= 2);
}

function smoothSurfaceContourLine(
  points: SurfaceContourPoint[]
): SurfaceContourPoint[] {
  if (points.length < 3) return points;
  const first = points[0];
  const last = points[points.length - 1];
  const closed =
    Math.abs(first[0] - last[0]) < 1e-8 &&
    Math.abs(first[1] - last[1]) < 1e-8;
  const source = closed ? points.slice(0, -1) : points;
  if (source.length < 3) return points;
  const smoothed: SurfaceContourPoint[] = [];
  if (!closed) smoothed.push(source[0]);
  const edgeCount = closed ? source.length : source.length - 1;
  for (let index = 0; index < edgeCount; index += 1) {
    const a = source[index];
    const b = source[(index + 1) % source.length];
    smoothed.push(
      [
        a[0] * 0.75 + b[0] * 0.25,
        a[1] * 0.75 + b[1] * 0.25,
        a[2]
      ],
      [
        a[0] * 0.25 + b[0] * 0.75,
        a[1] * 0.25 + b[1] * 0.75,
        a[2]
      ]
    );
  }
  if (!closed) smoothed.push(source[source.length - 1]);
  else smoothed.push(smoothed[0]);
  return smoothed;
}

function projectionContourColor(
  t: number,
  useColorMap: boolean,
  colorScale: string
): string {
  if (!useColorMap) return "rgba(43,73,86,0.76)";
  const viridis = [
    [0, [68, 1, 84]],
    [0.25, [59, 82, 139]],
    [0.5, [33, 145, 140]],
    [0.75, [94, 201, 98]],
    [1, [253, 231, 37]]
  ] as const;
  const cividis = [
    [0, [0, 34, 78]],
    [0.25, [65, 78, 108]],
    [0.5, [124, 124, 120]],
    [0.75, [188, 173, 108]],
    [1, [254, 232, 56]]
  ] as const;
  const stops: ReadonlyArray<
    readonly [number, readonly [number, number, number]]
  > = colorScale.toLowerCase().includes("cividis") ? cividis : viridis;
  const x = Math.max(0, Math.min(1, t));
  let left: readonly [number, readonly [number, number, number]] = stops[0];
  let right: readonly [number, readonly [number, number, number]] =
    stops[stops.length - 1];
  for (let index = 1; index < stops.length; index += 1) {
    if (x <= stops[index][0]) {
      left = stops[index - 1];
      right = stops[index];
      break;
    }
  }
  const local = (x - left[0]) / Math.max(1e-9, right[0] - left[0]);
  const rgb = left[1].map((value, index) =>
    Math.round(value + (right[1][index] - value) * local)
  );
  return "rgba(" + rgb.join(",") + ",0.78)";
}

export function buildTraces(args: {
  dataset: Dataset;
  figure: FigureSpec;
  preset: PresetDefinition;
}) {
  const { dataset, figure, preset } = args;
  const metrics = resolvePublicationMetrics(preset, figure);
  const palette = resolveSeriesPalette(preset, figure);
  const template = figure.templateId;
  const mappedSeries = orderSeries(
    dataset,
    figure.seriesOrder,
    figure.dataRef?.yColumnIds
  );
  const fieldTemplate =
    template === "heatmap" ||
    template === "contour" ||
    template === "surface-3d" ||
    template === "surface-projection-3d";
  const series = fieldTemplate
    ? mappedSeries
    : mappedSeries.filter(
        (item) => figure.seriesOverrides[item.id]?.visible !== false
      );

  if (template === "pca-ellipse") {
    const ellipseScale = Math.max(0.25, Math.min(6, figure.figureOverrides.pcaEllipseScale ?? 2.45));
    const fillOpacity = Math.max(0, Math.min(0.6, figure.figureOverrides.pcaEllipseFillOpacity ?? 0.14));
    return series.flatMap((column, index) => {
      const color = figure.seriesOverrides[column.id]?.color ?? palette[index % palette.length];
      const points = dataset.x.values.map((xValue, pointIndex) => {
        const yValue = column.values[pointIndex];
        return typeof xValue === "number" && Number.isFinite(xValue) &&
          typeof yValue === "number" && Number.isFinite(yValue)
          ? { x: xValue, y: yValue }
          : undefined;
      }).filter((point): point is {x:number;y:number} => Boolean(point));
      const ellipse = ellipsePolygon(
        points.map(point=>point.x),
        points.map(point=>point.y),
        ellipseScale
      );
      const scatter = baseXYTrace(dataset,figure,preset,column,index,"markers");
      const ellipseTrace = ellipse ? {
        type: "scatter",
        mode: "lines",
        x: ellipse.x,
        y: ellipse.y,
        name: normalizePlotlyMathText(column.name + " confidence"),
        showlegend: false,
        hoverinfo: "skip",
        line: { color, width: ptToPx(0.7), simplify: false },
        fill: "toself",
        fillcolor: rgbaFromHex(color,fillOpacity),
        meta: { figureStudioSeriesId: column.id }
      } : undefined;
      return ellipseTrace ? [ellipseTrace,scatter] : [scatter];
    });
  }

  if (template === "volcano") {
    const column = series[0];
    if (!column) return [];
    const xThreshold = Math.max(0, figure.figureOverrides.volcanoXThreshold ?? 1);
    const yThreshold = Math.max(0, figure.figureOverrides.volcanoYThreshold ?? 1.301);
    const opacity = Math.max(0.1, Math.min(1, figure.figureOverrides.volcanoPointOpacity ?? 0.62));
    const neutral = "#aeb5ba";
    const x = dataset.x.values;
    const y = column.values;
    const colors = x.map((xValue,index) => {
      const yValue=y[index];
      if(typeof xValue!=="number"||!Number.isFinite(xValue)||
         typeof yValue!=="number"||!Number.isFinite(yValue)) return neutral;
      if(yValue>=yThreshold && xValue<=-xThreshold) return palette[0];
      if(yValue>=yThreshold && xValue>=xThreshold) return palette[1] ?? palette[0];
      return neutral;
    });
    return [{
      type:"scatter",
      mode:"markers",
      x,
      y,
      name:normalizePlotlyMathText(column.name),
      showlegend:false,
      meta:{figureStudioSeriesId:column.id},
      opacity,
      marker:{
        color:colors,
        size:ptToPx(figure.seriesOverrides[column.id]?.markerSizePt ?? 2.7),
        line:{color:"rgba(57,67,75,0.20)",width:ptToPx(0.2)}
      },
      hovertemplate:"log2 FC=%{x:.3g}<br>-log10(p)=%{y:.3g}<extra></extra>"
    }];
  }

  if (template === "ridgeline") {
    const offset=Math.max(0.1,figure.figureOverrides.ridgelineOffset ?? 1);
    const scale=Math.max(0.05,Math.min(3,figure.figureOverrides.ridgelineScale ?? 0.88));
    const fillOpacity=Math.max(0,Math.min(0.8,figure.figureOverrides.ridgelineFillOpacity ?? 0.32));
    return series.map((column,index)=>{
      const color=figure.seriesOverrides[column.id]?.color ?? palette[index%palette.length];
      const pairs=dataset.x.values.map((xValue,pointIndex)=>{
        const yValue=column.values[pointIndex];
        return typeof xValue==="number"&&Number.isFinite(xValue)&&
          typeof yValue==="number"&&Number.isFinite(yValue)
          ? {x:xValue,y:yValue}:undefined;
      }).filter((p):p is {x:number;y:number}=>Boolean(p));
      const maxValue=Math.max(1e-12,...pairs.map(p=>Math.max(0,p.y)));
      const baseline=index*offset;
      const xs=pairs.map(p=>p.x);
      const top=pairs.map(p=>baseline+(Math.max(0,p.y)/maxValue)*offset*scale);
      return {
        type:"scatter",
        mode:"lines",
        x:[...xs,...[...xs].reverse()],
        y:[...top,...xs.map(()=>baseline).reverse()],
        name:normalizePlotlyMathText(column.name),
        showlegend:false,
        meta:{figureStudioSeriesId:column.id},
        line:{color,width:ptToPx(0.72),simplify:false},
        fill:"toself",
        fillcolor:rgbaFromHex(color,fillOpacity),
        hoverinfo:"skip"
      };
    });
  }

  if (template === "heatmap" || template === "contour") {
    const xIsNumeric = dataset.x.values.every(
      (value) => value === null || typeof value === "number"
    );
    const yValues = resolveFieldRowCoordinates(dataset, series);
    const zValues = series.map((column) => column.values);
    const zAuto = figure.figureOverrides.zAutoRange !== false;
    let zDataMin = Number.POSITIVE_INFINITY;
    let zDataMax = Number.NEGATIVE_INFINITY;
    for (const row of zValues) {
      for (const value of row) {
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        if (value < zDataMin) zDataMin = value;
        if (value > zDataMax) zDataMax = value;
      }
    }
    if (!Number.isFinite(zDataMin) || !Number.isFinite(zDataMax)) {
      zDataMin = 0;
      zDataMax = 1;
    }
    let zLevelMin =
      !zAuto && Number.isFinite(figure.figureOverrides.zMin)
        ? (figure.figureOverrides.zMin as number)
        : zDataMin;
    let zLevelMax =
      !zAuto && Number.isFinite(figure.figureOverrides.zMax)
        ? (figure.figureOverrides.zMax as number)
        : zDataMax;
    if (!(zLevelMax > zLevelMin)) {
      const padding = Math.max(Math.abs(zLevelMin) * 0.05, 0.5);
      zLevelMin -= padding;
      zLevelMax += padding;
    }
    const fieldFontFamily = plotFontFamily(
      figure.figureOverrides.fontFamily ?? preset.fontFamily
    );
    const fieldFontSizePt =
      figure.figureOverrides.fontSizePt ?? metrics.fontSizePt;
    const colorbar = {
      thickness: GOLDEN_STYLE.field.colorbarThicknessPx,
      outlinewidth: ptToPx(GOLDEN_STYLE.field.colorbarOutlinePt),
      outlinecolor: GOLDEN_STYLE.legend.borderColor,
      ticks: figure.figureOverrides.tickDirection === "outside" ? "outside" : "inside",
      ticklen: ptToPx(metrics.minorTickLengthPt),
      tickwidth: ptToPx(metrics.axisWidthPt * 0.75),
      tickcolor: figure.figureOverrides.tickLabelColor ?? GOLDEN_STYLE.stroke.tickStrokeColor,
      len: GOLDEN_STYLE.field.colorbarLength2d,
      tickfont: {
        family: fieldFontFamily,
        size: ptToPx(
          figure.figureOverrides.tickLabelSizePt ?? fieldFontSizePt * 0.96
        ),
        color: figure.figureOverrides.tickLabelColor ?? GOLDEN_STYLE.typography.tickColor
      },
      title: figure.figureOverrides.colorbarTitle
        ? {
            text: normalizePlotlyMathText(
              figure.figureOverrides.colorbarTitle
            ),
            side: "right",
            font: {
              family: fieldFontFamily,
              size: ptToPx(
                figure.figureOverrides.axisTitleSizePt ??
                  fieldFontSizePt * 1.08
              ),
              color: figure.figureOverrides.axisTitleColor ?? GOLDEN_STYLE.typography.axisTitleColor
            }
          }
        : undefined
    };

    if (template === "contour") {
      const contourFill = figure.figureOverrides.contourFill !== false;
      const contourLabels = figure.figureOverrides.contourLabels ?? false;
      const contourLines =
        figure.figureOverrides.contourLines !== false ||
        contourLabels ||
        !contourFill;
      const contourLevelCount = Math.max(
        3,
        Math.min(64, Math.round(figure.figureOverrides.contourLevels ?? 12))
      );
      const contourLevelSize =
        (zLevelMax - zLevelMin) / Math.max(1, contourLevelCount - 1);
      return [
        {
          type: "contour",
          x: dataset.x.values,
          y: yValues,
          z: zValues,
          colorscale: figure.figureOverrides.colorScale ?? GOLDEN_STYLE.field.colorScale,
          reversescale: figure.figureOverrides.reverseColorScale ?? false,
          showscale: figure.figureOverrides.colorbarVisible ?? true,
          zauto: false,
          zmin: zLevelMin,
          zmax: zLevelMax,
          autocontour: false,
          ncontours: contourLevelCount,
          contours: {
            start: zLevelMin,
            end: zLevelMax,
            size: contourLevelSize,
            coloring: contourFill ? "fill" : "lines",
            showlabels: contourLabels,
            labelfont: {
              family: plotFontFamily(
                figure.figureOverrides.fontFamily ?? preset.fontFamily
              ),
              size: ptToPx(
                (figure.figureOverrides.tickLabelSizePt ??
                  figure.figureOverrides.fontSizePt ??
                  metrics.fontSizePt) * 0.9
              ),
              color: figure.figureOverrides.tickLabelColor ?? GOLDEN_STYLE.typography.tickColor
            }
          },
          line: {
            width: contourLines ? ptToPx(GOLDEN_STYLE.field.contourLinePt) : 0,
            color: GOLDEN_STYLE.field.contourLineColor
          },
          colorbar,
          hovertemplate:
            (xIsNumeric ? "X=%{x:.4g}" : "X=%{x}") +
            "<br>Y=%{y:.4g}<br>Z=%{z:.4g}<extra></extra>"
        }
      ];
    }

    return [
      {
        type: "heatmap",
        x: dataset.x.values,
        y: yValues,
        z: zValues,
        colorscale: figure.figureOverrides.colorScale ?? GOLDEN_STYLE.field.colorScale,
        reversescale: figure.figureOverrides.reverseColorScale ?? false,
        showscale: figure.figureOverrides.colorbarVisible ?? true,
        zauto: zAuto,
        zmin: zAuto ? undefined : figure.figureOverrides.zMin,
        zmax: zAuto ? undefined : figure.figureOverrides.zMax,
        colorbar,
        zsmooth: false,
        hoverongaps: false,
        hovertemplate:
          (xIsNumeric ? "X=%{x:.4g}" : "X=%{x}") +
          "<br>Y=%{y:.4g}<br>Z=%{z:.4g}<extra></extra>"
      }
    ];
  }

  if (template === "surface-3d" || template === "surface-projection-3d") {
    const projectionTemplate = template === "surface-projection-3d";
    const surfaceX = dataset.x.values.every(
      (value) => value === null || typeof value === "number"
    )
      ? dataset.x.values
      : dataset.x.values.map((_value, index) => index + 1);
    const surfaceY = resolveFieldRowCoordinates(dataset, series);
    const surfaceZ = series.map((column) => column.values);
    const denseSurface = densifySurfaceGrid(
      surfaceX,
      surfaceY,
      surfaceZ,
      figure.figureOverrides.surfaceInterpolationFactor ?? 4
    );
    const finiteX = surfaceX.filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value)
    );
    const finiteY = surfaceY.filter((value) => Number.isFinite(value));
    const finiteZ = surfaceZ.flat().filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value)
    );
    const bound = (values: number[], fallback: [number, number]): [number, number] => {
      if (!values.length) return fallback;
      let low = Math.min(...values), high = Math.max(...values);
      if (!(high > low)) { low -= 0.5; high += 0.5; }
      return [low, high];
    };
    const [xLow, xHigh] = bound(finiteX, [0, 1]);
    const [yLow, yHigh] = bound(finiteY, [0, 1]);
    const [zLow, zHigh] = bound(finiteZ, [0, 1]);
    const projectionCount = Math.max(
      4,
      Math.min(24, Math.round(figure.figureOverrides.surfaceProjectionContourCount ?? 10))
    );
    const projectionWidth = ptToPx(
      figure.figureOverrides.surfaceProjectionLineWidthPt ?? 0.28
    );
    const projectionUseColorMap =
      figure.figureOverrides.surfaceProjectionUseColorMap ?? false;
    const sideX = projectionTemplate && (figure.figureOverrides.surfaceProjectionX ?? true);
    const sideY = projectionTemplate && (figure.figureOverrides.surfaceProjectionY ?? true);
    const floorProjection =
      projectionTemplate && (figure.figureOverrides.surfaceProjectionFloor ?? true);
    const zSpan = Math.max(1e-9, zHigh - zLow);
    const floorGap = Math.max(
      0,
      Math.min(1, figure.figureOverrides.surfaceProjectionFloorGap ?? 0.18)
    );
    const floorZ = zLow - zSpan * floorGap;
    const mainSurface = {
        type: "surface",
        x: denseSurface.x,
        y: denseSurface.y,
        z: denseSurface.z,
        meta: {
          figureStudioSurfaceInterpolationFactor: denseSurface.factor,
          figureStudioSurfaceSourceShape: [surfaceY.length, surfaceX.length]
        },
        colorscale: figure.figureOverrides.colorScale ?? GOLDEN_STYLE.field.colorScale,
        reversescale: figure.figureOverrides.reverseColorScale ?? false,
        showscale: figure.figureOverrides.colorbarVisible ?? true,
        cauto: figure.figureOverrides.zAutoRange !== false,
        cmin:
          figure.figureOverrides.zAutoRange === false
            ? figure.figureOverrides.zMin
            : undefined,
        cmax:
          figure.figureOverrides.zAutoRange === false
            ? figure.figureOverrides.zMax
            : undefined,
        // Projection contours are computed by FigureStudio and rendered as
        // independent scatter3d line layers. The publication surface itself
        // stays clean, so no contour ink crawls across the mesh.
        contours: undefined,
        colorbar: {
          thickness: GOLDEN_STYLE.field.colorbarThicknessPx,
          outlinewidth: ptToPx(GOLDEN_STYLE.field.colorbarOutlinePt),
          outlinecolor: GOLDEN_STYLE.legend.borderColor,
          ticks: figure.figureOverrides.tickDirection === "outside" ? "outside" : "inside",
          ticklen: ptToPx(metrics.minorTickLengthPt),
          tickwidth: ptToPx(metrics.axisWidthPt * 0.75),
          tickcolor: figure.figureOverrides.tickLabelColor ?? GOLDEN_STYLE.typography.tickColor,
          len: projectionTemplate
            ? GOLDEN_STYLE.field.projectionColorbarLength
            : GOLDEN_STYLE.field.colorbarLength3d,
          x: projectionTemplate
            ? GOLDEN_STYLE.field.projectionColorbarX
            : 0.88,
          xanchor: "left",
          xpad: 4,
          tickfont: {
            family: plotFontFamily(
              figure.figureOverrides.fontFamily ?? preset.fontFamily
            ),
            size: ptToPx(
              (figure.figureOverrides.tickLabelSizePt ??
                figure.figureOverrides.fontSizePt ??
                metrics.fontSizePt) * 0.96
            ),
            color: figure.figureOverrides.tickLabelColor ?? GOLDEN_STYLE.typography.tickColor
          },
          title: figure.figureOverrides.colorbarTitle
            ? {
                text: normalizePlotlyMathText(
                  figure.figureOverrides.colorbarTitle
                ),
                side: "right",
                font: {
                  family: plotFontFamily(
                    figure.figureOverrides.fontFamily ?? preset.fontFamily
                  ),
                  size: ptToPx(
                    figure.figureOverrides.axisTitleSizePt ??
                      (figure.figureOverrides.fontSizePt ??
                        metrics.fontSizePt) * 1.08
                  ),
                  color: figure.figureOverrides.axisTitleColor ?? GOLDEN_STYLE.typography.axisTitleColor
                }
              }
            : { text: "" }
        },
        lighting: {
          ambient: clampSurfaceUnit(figure.figureOverrides.surfaceAmbient ?? 0.62),
          diffuse: clampSurfaceUnit(figure.figureOverrides.surfaceDiffuse ?? 0.86),
          specular: clampSurfaceUnit(figure.figureOverrides.surfaceSpecular ?? 0.16),
          roughness: clampSurfaceUnit(figure.figureOverrides.surfaceRoughness ?? 0.72),
          fresnel: clampSurfaceUnit(figure.figureOverrides.surfaceFresnel ?? 0.06)
        },
        lightposition: { x: 100, y: 160, z: 220 },
        hovertemplate: "X=%{x:.4g}<br>Y=%{y:.4g}<br>Z=%{z:.4g}<extra></extra>"
      };
    const projectionTraces: any[] = [];
    const xSpan = Math.max(1e-9, xHigh - xLow);
    const ySpan = Math.max(1e-9, yHigh - yLow);
    const floorPlaneZ = floorZ + zSpan * 0.004;
    const floorContourZ = floorZ + zSpan * 0.012;
    const xWall = xLow + xSpan * 0.003;
    const yWall = yHigh - ySpan * 0.003;
    const colorScale = String(
      figure.figureOverrides.colorScale ?? GOLDEN_STYLE.field.colorScale
    );

    if (projectionTemplate && (floorProjection || sideX || sideY)) {
      const levels = Array.from(
        { length: projectionCount },
        (_unused, index) =>
          zLow + (zHigh - zLow) * (index + 1) / (projectionCount + 1)
      );
      for (const level of levels) {
        const rawSegments = surfaceContourSegments(
          denseSurface.x,
          denseSurface.y,
          denseSurface.z,
          level
        );
        const contourLines = stitchSurfaceContourSegments(rawSegments)
          .map(smoothSurfaceContourLine)
          .filter((line) => line.length >= 2);
        if (!contourLines.length) continue;

        const traceX: Array<number | null> = [];
        const traceY: Array<number | null> = [];
        const traceZ: Array<number | null> = [];
        const append = (
          line: SurfaceContourPoint[],
          axis: "floor" | "x" | "y"
        ) => {
          for (const point of line) {
            if (axis === "floor") {
              traceX.push(point[0]);
              traceY.push(point[1]);
              traceZ.push(floorContourZ);
            } else if (axis === "x") {
              traceX.push(xWall);
              traceY.push(point[1]);
              traceZ.push(level);
            } else {
              traceX.push(point[0]);
              traceY.push(yWall);
              traceZ.push(level);
            }
          }
          traceX.push(null);
          traceY.push(null);
          traceZ.push(null);
        };
        for (const line of contourLines) {
          if (floorProjection) append(line, "floor");
          if (sideX) append(line, "x");
          if (sideY) append(line, "y");
        }
        projectionTraces.push({
          type: "scatter3d",
          mode: "lines",
          x: traceX,
          y: traceY,
          z: traceZ,
          showlegend: false,
          hoverinfo: "skip",
          connectgaps: false,
          line: {
            width: Math.max(1.05, projectionWidth * 1.2),
            color: projectionContourColor(
              (level - zLow) / Math.max(1e-9, zHigh - zLow),
              projectionUseColorMap,
              colorScale
            )
          },
          meta: {
            figureStudioProjectionStyle: "refined-contour",
            figureStudioProjectionLevel: level,
            figureStudioProjectionAxes: [
              ...(floorProjection ? ["floor"] : []),
              ...(sideX ? ["x"] : []),
              ...(sideY ? ["y"] : [])
            ]
          }
        });
      }
    }

    const traces: any[] = [mainSurface];
    if (floorProjection) {
      traces.push({
        type: "surface",
        x: denseSurface.x,
        y: denseSurface.y,
        z: denseSurface.y.map(() =>
          denseSurface.x.map(() => floorPlaneZ)
        ),
        surfacecolor: denseSurface.z,
        colorscale: figure.figureOverrides.colorScale ?? GOLDEN_STYLE.field.colorScale,
        reversescale: figure.figureOverrides.reverseColorScale ?? false,
        cauto: false,
        cmin: zLow,
        cmax: zHigh,
        showscale: false,
        opacity: 0.18,
        hoverinfo: "skip",
        meta: {
          figureStudioProjectionPlane: "floor",
          figureStudioProjectionStyle: "soft-scalar"
        },
        lighting: {
          ambient: 1,
          diffuse: 0,
          specular: 0,
          roughness: 1,
          fresnel: 0
        }
      });
    }
    traces.push(...projectionTraces);
    return traces;
  }

  if (
    template === "bar" ||
    template === "grouped-bar" ||
    template === "stacked-bar"
  ) {
    const barSeries = template === "bar" ? series.slice(0, 1) : series;
    return barSeries.map((column, index) => {
      const sourceIndex = Math.max(
        0,
        dataset.ys.findIndex((item) => item.id === column.id)
      );
      const override = figure.seriesOverrides[column.id] || {};
      const fillColor =
        override.color ||
        palette[sourceIndex % palette.length];
      const markerColor =
        override.barColorMode === "points"
          ? column.values.map(
              (_value, pointIndex) =>
                palette[pointIndex % palette.length]
            )
          : fillColor;
      const labelVisible =
        figure.figureOverrides.barLabelsVisible ?? false;
      const labelDecimals = Math.max(
        0,
        Math.min(
          6,
          Math.round(figure.figureOverrides.barLabelDecimals ?? 0)
        )
      );
      const labelPosition =
        figure.figureOverrides.barLabelPosition ??
        (template === "stacked-bar" ? "inside" : "outside");
      return {
        type: "bar",
        name: normalizePlotlyMathText(override.legendLabel ?? column.name),
        showlegend: override.showInLegend ?? true,
        meta: { figureStudioSeriesId: column.id },
        x: dataset.x.values,
        y: column.values,
        opacity: override.opacity ?? 1,
        marker: {
          color: markerColor,
          line: {
            color: override.barBorderColor ?? GOLDEN_STYLE.bar.borderColor,
            width: ptToPx(override.barBorderWidthPt ?? GOLDEN_STYLE.bar.borderWidthPt)
          }
        },
        texttemplate: labelVisible
          ? "%{y:." + String(labelDecimals) + "f}"
          : undefined,
        textposition: labelVisible ? labelPosition : "none",
        textangle: 0,
        cliponaxis: false,
        insidetextfont: {
          family: plotFontFamily(
            figure.figureOverrides.fontFamily ?? preset.fontFamily
          ),
          size: ptToPx(
            (figure.figureOverrides.tickLabelSizePt ??
              figure.figureOverrides.fontSizePt ??
              metrics.fontSizePt) * 0.9
          ),
          color: "#ffffff"
        },
        outsidetextfont: {
          family: plotFontFamily(
            figure.figureOverrides.fontFamily ?? preset.fontFamily
          ),
          size: ptToPx(
            (figure.figureOverrides.tickLabelSizePt ??
              figure.figureOverrides.fontSizePt ??
              metrics.fontSizePt) * 0.9
          ),
          color: figure.figureOverrides.tickLabelColor ?? GOLDEN_STYLE.typography.tickColor
        },
        hovertemplate:
          "<b>" +
          column.name +
          "</b><br>%{x}<br>%{y:.4g}" +
          (column.unit ? " " + column.unit : "") +
          "<extra></extra>"
      };
    });
  }

  if (template === "xy-errorbar") {
    const main = series[0];
    if (!main) return [];
    const sourceIndex = Math.max(
      0,
      dataset.ys.findIndex((item) => item.id === main.id)
    );
    const trace = baseXYTrace(
      dataset,
      figure,
      preset,
      main,
      sourceIndex,
      "markers"
    ) as any;
    const errorId = figure.figureOverrides.errorSeriesId;
    const errorSeries = dataset.ys.find((column) => column.id === errorId);
    if (errorSeries) {
      trace.error_y = {
        type: "data",
        array: errorSeries.values,
        visible: true,
        color:
          figure.seriesOverrides[main.id]?.errorBarColor ??
          trace.line?.color,
        thickness: ptToPx(
          figure.seriesOverrides[main.id]?.errorBarWidthPt ?? GOLDEN_STYLE.marker.errorLinePt
        ),
        width: ptToPx(
          figure.seriesOverrides[main.id]?.errorBarCapSizePt ?? GOLDEN_STYLE.marker.errorCapPt
        )
      };
    }
    return [trace];
  }

  const modeDefault =
    template === "xy-scatter"
      ? "markers"
      : template === "xy-line-marker"
      ? "lines+markers"
      : "lines";

  const offsetStep =
    template === "offset-spectrum"
      ? figure.figureOverrides.offsetStep ?? GOLDEN_STYLE.stackedSpectrum.offsetStep
      : 0;
  const waterfallYOffset =
    template === "waterfall"
      ? figure.figureOverrides.waterfallYOffset ?? GOLDEN_STYLE.stackedSpectrum.waterfallYOffset
      : 0;
  const waterfallXOffset =
    template === "waterfall"
      ? figure.figureOverrides.waterfallXOffset ?? GOLDEN_STYLE.stackedSpectrum.waterfallXOffset
      : 0;
  const xIsNumeric = dataset.x.values.every(
    (value) => value === null || typeof value === "number"
  );

  return series.map((column, index) => {
    const sourceIndex = Math.max(
      0,
      dataset.ys.findIndex((item) => item.id === column.id)
    );
    const totalYOffset = offsetStep + waterfallYOffset;
    const yValues =
      totalYOffset === 0
        ? undefined
        : column.values.map((value) =>
            value === null ? null : value + index * totalYOffset
          );
    const trace = baseXYTrace(
      dataset,
      figure,
      preset,
      column,
      sourceIndex,
      modeDefault,
      yValues
    ) as any;

    if (template === "waterfall" && waterfallXOffset !== 0 && xIsNumeric) {
      trace.x = dataset.x.values.map((value) =>
        typeof value === "number"
          ? value + index * waterfallXOffset
          : value
      );
    }

    if (template === "waterfall" || template === "offset-spectrum") {
      if (figure.seriesOverrides[column.id]?.lineWidthPt === undefined) {
        trace.line.width = ptToPx(GOLDEN_STYLE.stackedSpectrum.lineWidthPt);
      }
      if (figure.seriesOverrides[column.id]?.opacity === undefined) {
        trace.opacity = Math.min(
          1,
          GOLDEN_STYLE.stackedSpectrum.baseOpacity +
            index * GOLDEN_STYLE.stackedSpectrum.opacityStep
        );
      }
    }

    if (template === "double-y") {
      const orderIndex = figure.seriesOrder.indexOf(column.id);
      const stableIndex = orderIndex >= 0 ? orderIndex : sourceIndex;
      const axis =
        figure.seriesOverrides[column.id]?.yAxis ??
        (stableIndex === 0 ? "left" : "right");
      trace.yaxis = axis === "right" ? "y2" : "y";
    }

    return trace;
  });
}

function rangeFor(
  autoRange: boolean | undefined,
  minValue: number | undefined,
  maxValue: number | undefined,
  scale: "linear" | "log",
  reverse: boolean
): [number, number] | undefined {
  if (autoRange !== false) return undefined;
  if (
    minValue === undefined ||
    maxValue === undefined ||
    !Number.isFinite(minValue) ||
    !Number.isFinite(maxValue) ||
    minValue >= maxValue
  ) {
    return undefined;
  }

  const range: [number, number] | undefined =
    scale === "log"
      ? minValue > 0 && maxValue > 0
        ? [Math.log10(minValue), Math.log10(maxValue)]
        : undefined
      : [minValue, maxValue];

  return range && reverse ? [range[1], range[0]] : range;
}

function finiteNumericValues(values: unknown[]): number[] {
  return values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value)
  );
}

function coordinateExtent(
  values: number[],
  extendHalfCell: boolean
): [number, number] | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) {
    const padding = Math.max(Math.abs(sorted[0]) * 0.05, 0.5);
    return [sorted[0] - padding, sorted[0] + padding];
  }
  if (!extendHalfCell) return [sorted[0], sorted[sorted.length - 1]];

  const lowStep = sorted[1] - sorted[0];
  const highStep =
    sorted[sorted.length - 1] - sorted[sorted.length - 2];
  return [
    sorted[0] - lowStep / 2,
    sorted[sorted.length - 1] + highStep / 2
  ];
}

function matplotlibAutoRange(
  values: number[],
  scale: "linear" | "log",
  reverse: boolean,
  margin = 0.05
): [number, number] | undefined {
  const finite =
    scale === "log" ? values.filter((value) => value > 0) : values;
  if (!finite.length) return undefined;

  if (scale === "log") {
    const logs = finite.map((value) => Math.log10(value));
    let low = Math.min(...logs);
    let high = Math.max(...logs);
    let span = high - low;
    if (!(span > 0)) {
      span = 0.2;
      low -= span / 2;
      high += span / 2;
    } else {
      const padding = span * margin;
      low -= padding;
      high += padding;
    }
    return reverse ? [high, low] : [low, high];
  }

  let low = Math.min(...finite);
  let high = Math.max(...finite);
  let span = high - low;
  if (!(span > 0)) {
    const padding = Math.max(Math.abs(low) * margin, 0.5);
    low -= padding;
    high += padding;
  } else {
    const padding = span * margin;
    low -= padding;
    high += padding;
  }
  return reverse ? [high, low] : [low, high];
}

function matplotlibNiceTickStep(
  range: [number, number] | undefined,
  targetIntervals = 6
): number | undefined {
  if (!range) return undefined;
  const span = Math.abs(range[1] - range[0]);
  if (!(span > 0) || !Number.isFinite(span)) return undefined;

  const raw = span / Math.max(2, targetIntervals);
  const exponent = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exponent);
  const candidates = [1, 2, 2.5, 5, 10].map(
    (step) => step * base
  );
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate - raw) < Math.abs(best - raw)
      ? candidate
      : best
  );
}

function tickFormatString(
  format: TickLabelFormat | undefined,
  decimals: number | undefined
): string | undefined {
  if (!format || format === "auto") return undefined;
  const digits = Math.max(
    0,
    Math.min(12, Number.isFinite(decimals) ? Math.round(decimals as number) : 2)
  );
  if (format === "decimal") return "." + digits + "f";
  if (format === "scientific") return "." + digits + "e";
  return "." + Math.max(1, digits + 1) + "s";
}

function rgba(hex: string, opacity: number): string {
  const clean = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return hex;
  const value = Number.parseInt(clean, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  const alpha = Math.max(0, Math.min(1, opacity));
  return "rgba(" + red + "," + green + "," + blue + "," + alpha + ")";
}

export function buildLayout(args: {
  dataset: Dataset;
  figure: FigureSpec;
  preset: PresetDefinition;
  displayText?: {
    plotTitle?: string;
    xTitle?: string;
    yTitle?: string;
    rightYTitle?: string;
  };
}) {
  const { dataset, figure, preset, displayText } = args;
  const overrides = figure.figureOverrides;
  const metrics = resolvePublicationMetrics(preset, figure);
  const palette = resolveSeriesPalette(preset, figure);
  const canvas = resolveCanvasMm(preset, figure);
  const fontFamily = plotFontFamily(overrides.fontFamily || preset.fontFamily);
  const fontSizePt = overrides.fontSizePt ?? metrics.fontSizePt;
  const fontSizePx = ptToPx(fontSizePt);
  const axisStyle = overrides.axisStyle ?? "regular";
  const axisWidthPt =
    overrides.axisLineWidthPt ??
    (axisStyle === "bold"
      ? Math.max(1, metrics.axisWidthPt * 1.45)
      : metrics.axisWidthPt);
  const axisWidthPx = ptToPx(axisWidthPt);
  const majorTickLengthPt =
    overrides.majorTickLengthPt ??
    (axisStyle === "bold"
      ? Math.max(4.5, metrics.majorTickLengthPt * 1.4)
      : metrics.majorTickLengthPt);
  const minorTickLengthPt =
    overrides.minorTickLengthPt ??
    (axisStyle === "bold"
      ? Math.max(2.8, metrics.minorTickLengthPt * 1.45)
      : metrics.minorTickLengthPt);
  const tickLabelSizePx = ptToPx(
    overrides.tickLabelSizePt ?? fontSizePt * 0.96
  );
  const axisTitleSizePx = ptToPx(
    overrides.axisTitleSizePt ?? fontSizePt * metrics.axisTitleScale
  );
  const plotTitleSizePx = ptToPx(
    overrides.plotTitleSizePt ?? fontSizePt * metrics.plotTitleScale
  );
  const background = overrides.background ?? "#ffffff";
  const tickDirection = overrides.tickDirection ?? "inside";
  const gridVisible = overrides.gridVisible ?? preset.showGrid;
  const legendPositionMode =
    overrides.legendPosition ??
    (figure.templateId === "double-y" ? "top-left" : "top-right");
  const presetLegendPosition = legendAnchor(legendPositionMode);
  const legendPosition =
    legendPositionMode === "custom"
      ? {
          x: overrides.legendX ?? presetLegendPosition.x,
          y: overrides.legendY ?? presetLegendPosition.y,
          xanchor: overrides.legendXAnchor ?? "left",
          yanchor: overrides.legendYAnchor ?? "top"
        }
      : presetLegendPosition;
  const legendOrientation = overrides.legendOrientation ?? "vertical";
  const legendColumns = Math.max(1, overrides.legendColumns ?? 1);
  const xIsCategorical = dataset.x.values.some(
    (value) => typeof value === "string"
  );
  const xScale = xIsCategorical ? "linear" : overrides.xScale ?? "linear";
  const yScale = overrides.yScale ?? "linear";
  const rightYScale = overrides.rightYScale ?? "linear";
  const isDoubleY = figure.templateId === "double-y";
  const isRidgeline = figure.templateId === "ridgeline";
  const isVolcano = figure.templateId === "volcano";
  const isField2D =
    figure.templateId === "heatmap" || figure.templateId === "contour";
  const isBarLike =
    figure.templateId === "bar" ||
    figure.templateId === "grouped-bar" ||
    figure.templateId === "stacked-bar";
  const fieldSeriesForTicks = isField2D
    ? orderSeries(
        dataset,
        figure.seriesOrder,
        figure.dataRef?.yColumnIds
      )
    : [];
  const fieldExtendsCells = figure.templateId === "heatmap";
  const fieldXTickRange =
    isField2D && !xIsCategorical
      ? coordinateExtent(
          finiteNumericValues(dataset.x.values),
          fieldExtendsCells
        )
      : undefined;
  const fieldYTickRange = isField2D
    ? coordinateExtent(
        resolveFieldRowCoordinates(dataset, fieldSeriesForTicks),
        fieldExtendsCells
      )
    : undefined;
  const continuousXY =
    !isField2D &&
    figure.templateId !== "surface-3d" &&
    figure.templateId !== "surface-projection-3d" &&
    figure.templateId !== "bar" &&
    figure.templateId !== "grouped-bar" &&
    figure.templateId !== "stacked-bar";
  const rangeTraces: any[] = continuousXY
    ? (buildTraces({ dataset, figure, preset }) as any[])
    : [];
  const autoXValues: number[] = [];
  const autoLeftYValues: number[] = [];
  const autoRightYValues: number[] = [];

  for (const trace of rangeTraces) {
    autoXValues.push(...finiteNumericValues(Array.isArray(trace.x) ? trace.x : []));
    const yValues = Array.isArray(trace.y) ? trace.y : [];
    const targetY =
      isDoubleY && trace.yaxis === "y2"
        ? autoRightYValues
        : autoLeftYValues;
    const errors =
      Array.isArray(trace.error_y?.array) ? trace.error_y.array : undefined;

    for (let index = 0; index < yValues.length; index += 1) {
      const value = yValues[index];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const error = errors?.[index];
      if (typeof error === "number" && Number.isFinite(error)) {
        targetY.push(value - Math.abs(error), value + Math.abs(error));
      } else {
        targetY.push(value);
      }
    }
  }

  const xRange = xIsCategorical
    ? undefined
    : overrides.xAutoRange === false
    ? rangeFor(
        false,
        overrides.xMin,
        overrides.xMax,
        xScale,
        overrides.xReverse ?? false
      )
    : continuousXY
    ? matplotlibAutoRange(
        autoXValues,
        xScale,
        overrides.xReverse ?? false
      )
    : undefined;
  const yRange =
    overrides.yAutoRange === false
      ? rangeFor(
          false,
          overrides.yMin,
          overrides.yMax,
          yScale,
          overrides.yReverse ?? false
        )
      : continuousXY
      ? matplotlibAutoRange(
          autoLeftYValues,
          yScale,
          overrides.yReverse ?? false
        )
      : undefined;
  const rightYRange =
    overrides.rightYAutoRange === false
      ? rangeFor(
          false,
          overrides.rightYMin,
          overrides.rightYMax,
          rightYScale,
          overrides.rightYReverse ?? false
        )
      : isDoubleY
      ? matplotlibAutoRange(
          autoRightYValues,
          rightYScale,
          overrides.rightYReverse ?? false
        )
      : undefined;
  const xTickIntervals = goldenTickIntervalTarget(canvas.widthMm, "x");
  const yTickIntervals = goldenTickIntervalTarget(canvas.heightMm, "y");
  const xAutoTickStep =
    !xIsCategorical &&
    xScale === "linear" &&
    !overrides.xMajorTickStep
      ? matplotlibNiceTickStep(xRange ?? fieldXTickRange, xTickIntervals)
      : undefined;
  const yAutoTickStep =
    yScale === "linear" && !overrides.yMajorTickStep
      ? matplotlibNiceTickStep(yRange ?? fieldYTickRange, yTickIntervals)
      : undefined;
  const rightYAutoTickStep =
    rightYScale === "linear" && !overrides.rightYMajorTickStep
      ? matplotlibNiceTickStep(rightYRange, yTickIntervals)
      : undefined;

  const commonAxis = {
    showline: true,
    mirror: overrides.frameStyle !== "open",
    linewidth: axisWidthPx,
    linecolor: GOLDEN_STYLE.stroke.axisColor,
    ticks: tickDirection,
    ticklen: ptToPx(majorTickLengthPt),
    tickwidth: axisWidthPx,
    tickcolor: GOLDEN_STYLE.stroke.tickStrokeColor,
    tickfont: {
      family: fontFamily,
      size: tickLabelSizePx,
      color: overrides.tickLabelColor ?? GOLDEN_STYLE.typography.tickColor
    },
    showgrid: gridVisible,
    gridcolor: GOLDEN_STYLE.stroke.gridRgba,
    gridwidth: GOLDEN_STYLE.stroke.gridWidthPx,
    zeroline: false,
    automargin: true,
    minor: {
      ticks: overrides.minorTicks ? tickDirection : "",
      ticklen: overrides.minorTicks ? ptToPx(minorTickLengthPt) : 0,
      tickwidth: axisWidthPx * 0.75,
      tickcolor: GOLDEN_STYLE.stroke.tickStrokeColor,
      showgrid: false
    }
  };

  const doubleYAxisSeries = isDoubleY
    ? orderSeries(
        dataset,
        figure.seriesOrder,
        figure.dataRef?.yColumnIds
      ).filter(
        (series) => figure.seriesOverrides[series.id]?.visible !== false
      )
    : [];
  const doubleYAxisSide = (series: PlotColumn) => {
    const orderIndex = figure.seriesOrder.indexOf(series.id);
    const sourceIndex = Math.max(
      0,
      dataset.ys.findIndex((item) => item.id === series.id)
    );
    const stableIndex = orderIndex >= 0 ? orderIndex : sourceIndex;
    return (
      figure.seriesOverrides[series.id]?.yAxis ??
      (stableIndex === 0 ? "left" : "right")
    );
  };
  const leftSeries = doubleYAxisSeries.filter(
    (series) => doubleYAxisSide(series) === "left"
  );
  const rightSeries = doubleYAxisSeries.filter(
    (series) => doubleYAxisSide(series) === "right"
  );
  // Golden Style keeps axes neutral even for a double-Y plot. Series identity
  // is carried by the curves and legend, matching the Lorentz reference and
  // avoiding the louder "colored spine" look.
  const leftYColor = overrides.axisTitleColor ?? GOLDEN_STYLE.stroke.axisColor;
  const rightYColor = overrides.axisTitleColor ?? GOLDEN_STYLE.stroke.axisColor;
  const automaticLegendSeriesCount =
    figure.templateId === "bar" || figure.templateId === "xy-errorbar"
      ? Math.min(1, visibleSeries(dataset, figure).length)
      : visibleSeries(dataset, figure).length;
  const effectiveLegendVisible =
    !isField2D &&
    figure.templateId !== "surface-3d" &&
    (overrides.legendVisible ?? automaticLegendSeriesCount > 1);
  const outsideRightLegend =
    effectiveLegendVisible && legendPositionMode === "outside-right";

  const emptyFigure = dataset.id === "__empty__";
  const resolvedXTitle = normalizePlotlyMathText(
    displayText?.xTitle ??
      overrides.xTitle ??
      (emptyFigure ? "" : autoAxisTitle(dataset.x.name, dataset.x.unit))
  );
  const resolvedYTitle = normalizePlotlyMathText(
    displayText?.yTitle ??
      overrides.yTitle ??
      (emptyFigure
        ? ""
        : isField2D || figure.templateId === "surface-3d"
        ? autoAxisTitle(
            dataset.metadata?.rowAxisName ?? "纵向位置",
            dataset.metadata?.rowAxisUnit
          )
        : isDoubleY && leftSeries[0]
        ? autoAxisTitle(leftSeries[0].name, leftSeries[0].unit)
        : dataset.ys[0]
        ? autoAxisTitle(dataset.ys[0].name, dataset.ys[0].unit)
        : "")
  );
  const resolvedRightYTitle = normalizePlotlyMathText(
    displayText?.rightYTitle ??
      overrides.rightYTitle ??
      (rightSeries[0]
        ? autoAxisTitle(rightSeries[0].name, rightSeries[0].unit)
        : "右 Y")
  );
  const resolvedPlotTitle = normalizePlotlyMathText(
    displayText?.plotTitle ?? overrides.plotTitle
  );
  const hasXTitle = Boolean(String(resolvedXTitle ?? "").trim());
  const hasYTitle = Boolean(String(resolvedYTitle ?? "").trim());
  const hasPlotTitle = Boolean(String(resolvedPlotTitle ?? "").trim());

  const layout: any = {
    width: Math.round(mmToPx(canvas.widthMm)),
    height: Math.round(mmToPx(canvas.heightMm)),
    autosize: false,
    margin: {
      // These are minimum content-safe margins, not decorative whitespace.
      // automargin may only expand them when real tick/title content requires it.
      l: Math.round(
        mmToPx(overrides.marginLeftMm ?? ((hasYTitle
          ? GOLDEN_STYLE.spacing.leftWithTitleMm
          : GOLDEN_STYLE.spacing.leftCompactMm) * metrics.outerMarginScale))
      ),
      r: Math.round(
        mmToPx(overrides.marginRightMm ?? (
          outsideRightLegend
            ? GOLDEN_STYLE.spacing.outsideLegendRightMm * metrics.outerMarginScale
            : isDoubleY
            ? GOLDEN_STYLE.spacing.doubleYRightMm * metrics.outerMarginScale
            : isField2D || figure.templateId === "surface-3d"
            ? GOLDEN_STYLE.spacing.fieldRightMm * metrics.outerMarginScale
            : GOLDEN_STYLE.spacing.rightMm * metrics.outerMarginScale
        ))
      ),
      t: Math.round(
        mmToPx(overrides.marginTopMm ?? ((hasPlotTitle
          ? GOLDEN_STYLE.spacing.topWithTitleMm
          : GOLDEN_STYLE.spacing.topCompactMm) * metrics.outerMarginScale))
      ),
      b: Math.round(
        mmToPx(overrides.marginBottomMm ?? ((hasXTitle
          ? GOLDEN_STYLE.spacing.bottomWithTitleMm
          : GOLDEN_STYLE.spacing.bottomCompactMm) * metrics.outerMarginScale))
      ),
      pad: 0,
      autoexpand: true
    },
    paper_bgcolor: background,
    plot_bgcolor: background,
    title: overrides.plotTitle
      ? {
          text: resolvedPlotTitle,
          x: 0.5,
          xanchor: "center",
          y: 0.985,
          yanchor: "top",
          automargin: true,
          pad: {
            t: 0,
            b: Math.round(ptToPx((overrides.plotTitlePadPt ?? metrics.plotTitlePadPt))),
            l: 0,
            r: 0
          },
          font: {
            family: fontFamily,
            size: plotTitleSizePx,
            color: overrides.plotTitleColor ?? GOLDEN_STYLE.typography.titleColor
          }
        }
      : undefined,
    showlegend: effectiveLegendVisible,
    hovermode: "closest",
    dragmode:
      figure.templateId === "surface-3d" ||
      figure.templateId === "surface-projection-3d"
        ? "orbit"
        : "zoom",
    uirevision: figure.id,
    font: {
      family: fontFamily,
      size: fontSizePx,
      color: GOLDEN_STYLE.typography.textColor
    },
    legend: {
      ...legendPosition,
      orientation: legendOrientation === "horizontal" ? "h" : "v",
      bgcolor: overrides.legendBackground
        ? rgba(
            overrides.legendBackground,
            overrides.legendBackgroundOpacity ?? GOLDEN_STYLE.legend.backgroundOpacity
          )
        : overrides.legendFrame
        ? "rgba(255,255,255," + GOLDEN_STYLE.legend.backgroundOpacity + ")"
        : "rgba(255,255,255,0)",
      bordercolor: overrides.legendBorderColor ?? GOLDEN_STYLE.legend.borderColor,
      borderwidth: overrides.legendFrame
        ? ptToPx(overrides.legendBorderWidthPt ?? GOLDEN_STYLE.stroke.legendBorderPt)
        : 0,
      traceorder: "normal",
      itemsizing: "constant",
      itemwidth: Math.max(GOLDEN_STYLE.legend.sampleLengthPx, overrides.legendItemWidthPx ?? GOLDEN_STYLE.legend.sampleLengthPx),
      entrywidthmode:
        legendOrientation === "horizontal" && legendColumns > 1
          ? "fraction"
          : undefined,
      entrywidth:
        legendOrientation === "horizontal" && legendColumns > 1
          ? 1 / legendColumns
          : undefined,
      font: {
        family: fontFamily,
        size: ptToPx(
          overrides.legendFontSizePt ?? fontSizePt * metrics.legendScale
        ),
        color: overrides.legendFontColor ?? GOLDEN_STYLE.typography.textColor
      }
    },
    barmode: figure.templateId === "stacked-bar" ? "stack" : "group",
    bargap: overrides.barGap ?? GOLDEN_STYLE.bar.gap,
    bargroupgap: overrides.barGroupGap ?? GOLDEN_STYLE.bar.groupGap
  };

  if (
    figure.templateId === "surface-3d" ||
    figure.templateId === "surface-projection-3d"
  ) {
    const projectionSurface =
      figure.templateId === "surface-projection-3d";
    const projectionSeries = projectionSurface
      ? orderSeries(dataset, figure.seriesOrder, figure.dataRef?.yColumnIds)
      : [];
    const projectionZValues = projectionSeries.flatMap((series) =>
      finiteNumericValues(series.values)
    );
    const projectionZMin = projectionZValues.length
      ? Math.min(...projectionZValues)
      : 0;
    const projectionZMax = projectionZValues.length
      ? Math.max(...projectionZValues)
      : 1;
    const projectionZSpan = Math.max(
      1e-9,
      projectionZMax - projectionZMin
    );
    const projectionFloorGap = Math.max(
      0,
      Math.min(1, overrides.surfaceProjectionFloorGap ?? 0.28)
    );
    const projectionZRange = projectionSurface
      ? [
          projectionZMin - projectionZSpan * projectionFloorGap,
          projectionZMax + projectionZSpan * 0.06
        ]
      : undefined;
    const sceneAxisTitleSizePx =
      axisTitleSizePx * GOLDEN_STYLE.field.surfaceAxisTitleScale;
    const sceneTickLabelSizePx =
      tickLabelSizePx * GOLDEN_STYLE.field.surfaceTickScale;
    layout.margin = projectionSurface
      ? {
          l: Math.round(mmToPx(overrides.marginLeftMm ?? 2.8)),
          r: Math.round(mmToPx(overrides.marginRightMm ?? 10.5)),
          t: Math.round(mmToPx(overrides.marginTopMm ?? 2.2)),
          b: Math.round(mmToPx(overrides.marginBottomMm ?? 6.8)),
          pad: 0,
          autoexpand: false
        }
      : {
          l: Math.round(mmToPx(overrides.marginLeftMm ?? 6.5)),
          r: Math.round(mmToPx(overrides.marginRightMm ?? 14)),
          t: Math.round(mmToPx(overrides.marginTopMm ?? 4.5)),
          b: Math.round(mmToPx(overrides.marginBottomMm ?? 11)),
          pad: 0,
          autoexpand: false
        };
    layout.scene = {
      bgcolor: background,
      dragmode: "orbit",
      uirevision: figure.id,
      domain: {
        x: [...(projectionSurface
          ? GOLDEN_STYLE.field.projectionDomainX
          : GOLDEN_STYLE.field.surfaceDomainX)],
        y: [...(projectionSurface
          ? GOLDEN_STYLE.field.projectionDomainY
          : GOLDEN_STYLE.field.surfaceDomainY)]
      },
      xaxis: {
        title: { text: "" },
        showbackground: true,
        backgroundcolor: projectionSurface
          ? GOLDEN_STYLE.field.projectionWallBackground
          : GOLDEN_STYLE.field.planeBackground,
        showline: true,
        linecolor: GOLDEN_STYLE.stroke.axisColor,
        linewidth: axisWidthPx,
        gridcolor: projectionSurface
          ? GOLDEN_STYLE.field.projectionGridColor
          : GOLDEN_STYLE.field.sceneGridColor,
        gridwidth: ptToPx(0.28),
        zeroline: false,
        ticks: tickDirection,
        ticklen: ptToPx(majorTickLengthPt),
        tickcolor: GOLDEN_STYLE.stroke.tickStrokeColor,
        tickfont: {
          family: fontFamily,
          size: sceneTickLabelSizePx,
          color: overrides.tickLabelColor ?? GOLDEN_STYLE.typography.tickColor
        }
      },
      yaxis: {
        title: { text: "" },
        showbackground: true,
        backgroundcolor: projectionSurface
          ? GOLDEN_STYLE.field.projectionWallBackground
          : GOLDEN_STYLE.field.planeBackground,
        showline: true,
        linecolor: GOLDEN_STYLE.stroke.axisColor,
        linewidth: axisWidthPx,
        gridcolor: projectionSurface
          ? GOLDEN_STYLE.field.projectionGridColor
          : GOLDEN_STYLE.field.sceneGridColor,
        gridwidth: ptToPx(0.28),
        zeroline: false,
        ticks: tickDirection,
        ticklen: ptToPx(majorTickLengthPt),
        tickcolor: GOLDEN_STYLE.stroke.tickStrokeColor,
        tickfont: {
          family: fontFamily,
          size: sceneTickLabelSizePx,
          color: overrides.tickLabelColor ?? GOLDEN_STYLE.typography.tickColor
        }
      },
      zaxis: {
        title: { text: "" },
        autorange: projectionSurface ? false : true,
        range: projectionZRange,
        showbackground: true,
        backgroundcolor: projectionSurface
          ? GOLDEN_STYLE.field.projectionFloorBackground
          : GOLDEN_STYLE.field.planeBackground,
        showline: true,
        linecolor: GOLDEN_STYLE.stroke.axisColor,
        linewidth: axisWidthPx,
        gridcolor: projectionSurface
          ? GOLDEN_STYLE.field.projectionFloorGridColor
          : GOLDEN_STYLE.field.sceneGridColor,
        gridwidth: ptToPx(0.28),
        zeroline: false,
        ticks: tickDirection,
        ticklen: ptToPx(majorTickLengthPt),
        tickcolor: GOLDEN_STYLE.stroke.tickStrokeColor,
        tickfont: {
          family: fontFamily,
          size: sceneTickLabelSizePx,
          color: overrides.tickLabelColor ?? GOLDEN_STYLE.typography.tickColor
        }
      },
      camera: {
        eye: {
          ...(projectionSurface
            ? GOLDEN_STYLE.field.projectionCameraEye
            : GOLDEN_STYLE.field.surfaceCameraEye)
        }
      },
      aspectmode: "manual",
      aspectratio: {
        ...(projectionSurface
          ? GOLDEN_STYLE.field.projectionAspect
          : GOLDEN_STYLE.field.surfaceAspect)
      }
    };
    const labelColor =
      overrides.axisTitleColor ?? GOLDEN_STYLE.typography.axisTitleColor;
    const surfaceLabel = (
      text: string,
      spec: { x: number; y: number; angle: number }
    ) => ({
      text,
      x: spec.x,
      y: spec.y,
      xref: "paper",
      yref: "paper",
      xanchor: "center",
      yanchor: "middle",
      showarrow: false,
      textangle: spec.angle,
      font: {
        family: fontFamily,
        size: sceneAxisTitleSizePx,
        color: labelColor
      }
    });
    const labelPositions = projectionSurface
      ? GOLDEN_STYLE.field.projectionLabels
      : GOLDEN_STYLE.field.surfaceLabels;
    layout.annotations = [
      surfaceLabel(String(resolvedXTitle ?? ""), labelPositions.x),
      surfaceLabel(String(resolvedYTitle ?? ""), labelPositions.y),
      surfaceLabel(
        String(normalizePlotlyMathText(overrides.zTitle ?? "Z") ?? ""),
        labelPositions.z
      )
    ];
    return layout;
  }

  layout.xaxis = {
    ...commonAxis,
    showgrid: isBarLike ? false : commonAxis.showgrid,
    type: xIsCategorical ? "category" : xScale,
    autorange: xRange
      ? false
      : overrides.xReverse
      ? "reversed"
      : true,
    range: xRange,
    title: {
      text: resolvedXTitle,
      standoff: Math.round(ptToPx((overrides.axisTitlePadPt ?? metrics.axisTitlePadPt))),
      font: {
        family: fontFamily,
        size: axisTitleSizePx,
        color: overrides.axisTitleColor ?? GOLDEN_STYLE.typography.axisTitleColor
      }
    },
    dtick:
      !xIsCategorical &&
      overrides.xMajorTickStep &&
      overrides.xMajorTickStep > 0
        ? overrides.xMajorTickStep
        : xAutoTickStep,
    tickformat: xIsCategorical
      ? undefined
      : tickFormatString(
          overrides.xTickFormat,
          overrides.xTickDecimals
        ),
    tickprefix: overrides.xTickPrefix || undefined,
    ticksuffix: overrides.xTickSuffix || undefined,
    tickangle: overrides.xTickAngle ?? 0,
    minor: {
      ...commonAxis.minor,
      tickcolor: commonAxis.minor.tickcolor,
      dtick:
        !xIsCategorical &&
        overrides.minorTicks &&
        overrides.xMinorTickStep &&
        overrides.xMinorTickStep > 0
          ? overrides.xMinorTickStep
          : undefined
    }
  };

  layout.yaxis = {
    ...commonAxis,
    mirror: isDoubleY ? false : commonAxis.mirror,
    type: yScale,
    autorange: yRange
      ? false
      : overrides.yReverse
      ? "reversed"
      : true,
    range: yRange,
    linecolor: isDoubleY ? GOLDEN_STYLE.stroke.axisColor : commonAxis.linecolor,
    tickcolor: isDoubleY ? GOLDEN_STYLE.stroke.tickStrokeColor : commonAxis.tickcolor,
    tickfont: {
      ...commonAxis.tickfont,
      color:
        overrides.tickLabelColor ??
        (isDoubleY ? leftYColor : GOLDEN_STYLE.typography.tickColor)
    },
    title: {
      text: resolvedYTitle,
      standoff: Math.round(ptToPx((overrides.axisTitlePadPt ?? metrics.axisTitlePadPt))),
      font: {
        family: fontFamily,
        size: axisTitleSizePx,
        color:
          overrides.axisTitleColor ??
          (isDoubleY ? leftYColor : GOLDEN_STYLE.typography.tickColor)
      }
    },
    dtick:
      overrides.yMajorTickStep && overrides.yMajorTickStep > 0
        ? overrides.yMajorTickStep
        : yAutoTickStep,
    tickformat: tickFormatString(
      overrides.yTickFormat,
      overrides.yTickDecimals
    ),
    tickprefix: overrides.yTickPrefix || undefined,
    ticksuffix: overrides.yTickSuffix || undefined,
    tickangle: overrides.yTickAngle ?? 0,
    minor: {
      ...commonAxis.minor,
      dtick:
        overrides.minorTicks &&
        overrides.yMinorTickStep &&
        overrides.yMinorTickStep > 0
          ? overrides.yMinorTickStep
          : undefined
    }
  };

  if (isDoubleY) {
    layout.yaxis2 = {
      ...commonAxis,
      mirror: false,
      overlaying: "y",
      side: "right",
      type: rightYScale,
      autorange: rightYRange
        ? false
        : overrides.rightYReverse
        ? "reversed"
        : true,
      range: rightYRange,
      linecolor: GOLDEN_STYLE.stroke.axisColor,
      tickcolor: GOLDEN_STYLE.stroke.tickStrokeColor,
      tickfont: {
        ...commonAxis.tickfont,
        color: overrides.tickLabelColor ?? GOLDEN_STYLE.typography.tickColor
      },
      title: {
        text: resolvedRightYTitle,
        standoff: Math.round(ptToPx((overrides.axisTitlePadPt ?? metrics.axisTitlePadPt))),
        font: {
          family: fontFamily,
          size: axisTitleSizePx,
          color: overrides.axisTitleColor ?? GOLDEN_STYLE.typography.axisTitleColor
        }
      },
      showgrid: false,
      dtick:
        overrides.rightYMajorTickStep &&
        overrides.rightYMajorTickStep > 0
          ? overrides.rightYMajorTickStep
          : rightYAutoTickStep,
      tickformat: tickFormatString(
        overrides.rightYTickFormat,
        overrides.rightYTickDecimals
      ),
      tickprefix: overrides.rightYTickPrefix || undefined,
      ticksuffix: overrides.rightYTickSuffix || undefined,
      tickangle: overrides.rightYTickAngle ?? 0,
      minor: {
        ...commonAxis.minor,
        tickcolor: GOLDEN_STYLE.stroke.tickStrokeColor,
        showgrid: false,
        dtick:
          overrides.minorTicks &&
          overrides.rightYMinorTickStep &&
          overrides.rightYMinorTickStep > 0
            ? overrides.rightYMinorTickStep
            : undefined
      }
    };
  }

  if (isVolcano) {
    const xThreshold=Math.max(0,overrides.volcanoXThreshold ?? 1);
    const yThreshold=Math.max(0,overrides.volcanoYThreshold ?? 1.301);
    layout.shapes=[
      {type:"line",xref:"x",yref:"paper",x0:-xThreshold,x1:-xThreshold,y0:0,y1:1,
       line:{color:"rgba(57,67,75,0.55)",width:1,dash:"dash"}},
      {type:"line",xref:"x",yref:"paper",x0:xThreshold,x1:xThreshold,y0:0,y1:1,
       line:{color:"rgba(57,67,75,0.55)",width:1,dash:"dash"}},
      {type:"line",xref:"paper",yref:"y",x0:0,x1:1,y0:yThreshold,y1:yThreshold,
       line:{color:"rgba(57,67,75,0.55)",width:1,dash:"dash"}}
    ];
  }

  if (isRidgeline) {
    const ridgeSeries=orderSeries(dataset,figure.seriesOrder,figure.dataRef?.yColumnIds)
      .filter(series=>figure.seriesOverrides[series.id]?.visible!==false);
    const offset=Math.max(0.1,overrides.ridgelineOffset ?? 1);
    layout.yaxis.tickmode="array";
    layout.yaxis.tickvals=ridgeSeries.map((_series,index)=>index*offset);
    layout.yaxis.ticktext=ridgeSeries.map(series=>normalizePlotlyMathText(
      figure.seriesOverrides[series.id]?.legendLabel ?? series.name
    ));
    layout.yaxis.showgrid=false;
    layout.yaxis.title={...layout.yaxis.title,text:resolvedYTitle || ""};
  }

  const equalFieldAspect =
    overrides.fieldEqualAspect ??
    (figure.templateId === "heatmap");
  if (isField2D && equalFieldAspect) {
    layout.xaxis.scaleanchor = "y";
    layout.xaxis.scaleratio = 1;
    layout.yaxis.constrain = "domain";
  }

  return layout;
}
