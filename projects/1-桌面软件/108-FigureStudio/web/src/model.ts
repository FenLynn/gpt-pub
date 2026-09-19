export type NumericValue = number | null;

export interface Column {
  id: string;
  name: string;
  unit?: string;
  values: NumericValue[];
}

export interface DatasetMetadata {
  rowCoordinates?: number[];
  rowAxisName?: string;
  rowAxisUnit?: string;
}

export interface Dataset {
  id: string;
  name: string;
  x: Column;
  ys: Column[];
  metadata?: DatasetMetadata;
}

export type PresetId = "scientific" | "nature" | "presentation";
export type AspectMode = "16:9" | "4:3" | "3:2" | "custom";
export type PlotTemplateId =
  | "xy-line"
  | "xy-scatter"
  | "xy-line-marker"
  | "xy-errorbar"
  | "spectrum"
  | "offset-spectrum"
  | "bar"
  | "grouped-bar"
  | "stacked-bar"
  | "heatmap"
  | "surface-3d";
export type LineStyle = "solid" | "dash" | "dot" | "dashdot";
export type MarkerSymbol =
  | "circle"
  | "square"
  | "diamond"
  | "triangle-up"
  | "cross"
  | "x";
export type AxisScale = "linear" | "log";
export type TickDirection = "inside" | "outside";
export type LegendPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";
export type LegendOrientation = "horizontal" | "vertical";
export type ColorScaleId =
  | "Viridis"
  | "Cividis"
  | "Magma"
  | "Inferno"
  | "RdBu"
  | "Greys";

export interface PresetDefinition {
  id: PresetId;
  label: string;
  description: string;
  widthMm: number;
  heightMm: number;
  fontFamily: "Arial" | "Times New Roman";
  fontSizePt: number;
  lineWidthPt: number;
  axisWidthPt: number;
  markerSizePt: number;
  showGrid: boolean;
  palette: string[];
}

export interface SeriesOverride {
  visible?: boolean;
  lineVisible?: boolean;
  lineWidthPt?: number;
  lineStyle?: LineStyle;
  markerVisible?: boolean;
  markerSymbol?: MarkerSymbol;
  markerSizePt?: number;
  color?: string;
  opacity?: number;
}

export interface FigureOverrides {
  fontFamily?: "Arial" | "Times New Roman";
  fontSizePt?: number;
  background?: string;
  xTitle?: string;
  yTitle?: string;
  aspectMode?: AspectMode;
  customAspectWidth?: number;
  customAspectHeight?: number;

  xScale?: AxisScale;
  yScale?: AxisScale;
  xAutoRange?: boolean;
  yAutoRange?: boolean;
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  tickDirection?: TickDirection;
  minorTicks?: boolean;
  gridVisible?: boolean;

  legendVisible?: boolean;
  legendPosition?: LegendPosition;
  legendOrientation?: LegendOrientation;
  legendFrame?: boolean;
  legendColumns?: number;

  errorSeriesId?: string;
  offsetStep?: number;
  colorScale?: ColorScaleId;
  reverseColorScale?: boolean;
}

export interface FigureSpec {
  id: string;
  name: string;
  datasetId: string;
  templateId: PlotTemplateId;
  presetId: PresetId;
  figureOverrides: FigureOverrides;
  seriesOverrides: Record<string, SeriesOverride>;
  seriesOrder: string[];
}

export interface ProjectDefaults {
  templateId: PlotTemplateId;
  presetId: PresetId;
  figureOverrides: FigureOverrides;
}

export interface ProjectState {
  format: "sfig";
  schemaVersion: "0.1";
  projectId: string;
  name: string;
  datasets: Dataset[];
  figures: FigureSpec[];
  activeFigureId: string;
  defaults: ProjectDefaults;
}

export interface UserDefaults {
  templateId: PlotTemplateId;
  presetId: PresetId;
  figureOverrides: FigureOverrides;
}
