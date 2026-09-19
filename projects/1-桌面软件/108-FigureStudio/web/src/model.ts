export type NumericValue = number | null;
export type AxisValue = number | string | null;
export type CellValue = number | string | null;
export type ColumnRole = "X" | "Y" | "Z" | "XErr" | "YErr" | "Label" | "None";

export interface Column {
  id: string;
  name: string;
  unit?: string;
  comment?: string;
  role: ColumnRole;
  values: CellValue[];
}

export interface PlotColumn extends Omit<Column, "values"> {
  values: NumericValue[];
}

export interface PlotAxisColumn extends Omit<Column, "values"> {
  values: AxisValue[];
}

export interface SheetMetadata {
  rowCoordinates?: number[];
  rowAxisName?: string;
  rowAxisUnit?: string;
}

export interface DataSheet {
  id: string;
  name: string;
  comment?: string;
  source: DataSource;
  columns: Column[];
  metadata?: SheetMetadata;
}

export type DataSourceKind = "embedded" | "linked";
export type LinkedStatus = "ok" | "changed" | "needs-relink" | "missing";

export interface DataSource {
  kind: DataSourceKind;
  fileName?: string;
  path?: string;
  relativePath?: string;
  size?: number;
  modifiedMs?: number;
  status?: LinkedStatus;
}

export interface DataBook {
  id: string;
  name: string;
  folderId?: string;
  sheets: DataSheet[];
}

export interface Dataset {
  id: string;
  name: string;
  x: PlotAxisColumn;
  ys: PlotColumn[];
  metadata?: SheetMetadata;
}

export interface ProjectFolder {
  id: string;
  name: string;
  parentId?: string;
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
  | "waterfall"
  | "double-y"
  | "bar"
  | "grouped-bar"
  | "stacked-bar"
  | "heatmap"
  | "contour"
  | "surface-3d";
export type LineStyle = "solid" | "dash" | "dot" | "dashdot";
export type MarkerSymbol =
  | "circle"
  | "square"
  | "diamond"
  | "triangle-up"
  | "triangle-down"
  | "cross"
  | "x";
export type AxisScale = "linear" | "log";
export type TickDirection = "inside" | "outside";
export type AxisStylePreset = "regular" | "bold";
export type TickLabelFormat =
  | "auto"
  | "decimal"
  | "scientific"
  | "engineering";
export type LegendXAnchor = "left" | "center" | "right";
export type LegendYAnchor = "top" | "middle" | "bottom";
export type LegendPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | "custom";
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
  showInLegend?: boolean;
  legendLabel?: string;
  yAxis?: "left" | "right";
  lineVisible?: boolean;
  lineWidthPt?: number;
  lineStyle?: LineStyle;
  markerVisible?: boolean;
  markerSymbol?: MarkerSymbol;
  markerSizePt?: number;
  color?: string;
  opacity?: number;
  barBorderColor?: string;
  barBorderWidthPt?: number;
  barColorMode?: "series" | "points";
}

export interface FigureOverrides {
  fontFamily?: "Arial" | "Times New Roman";
  fontSizePt?: number;
  background?: string;

  plotTitle?: string;
  plotTitleColor?: string;
  plotTitleSizePt?: number;

  xTitle?: string;
  yTitle?: string;
  rightYTitle?: string;
  zTitle?: string;
  axisTitleColor?: string;
  axisTitleSizePt?: number;
  tickLabelColor?: string;
  tickLabelSizePt?: number;
  xTickFormat?: TickLabelFormat;
  yTickFormat?: TickLabelFormat;
  xTickDecimals?: number;
  yTickDecimals?: number;
  xTickPrefix?: string;
  xTickSuffix?: string;
  yTickPrefix?: string;
  yTickSuffix?: string;
  xTickAngle?: number;
  yTickAngle?: number;
  aspectMode?: AspectMode;
  customAspectWidth?: number;
  customAspectHeight?: number;

  xScale?: AxisScale;
  yScale?: AxisScale;
  rightYScale?: AxisScale;
  xAutoRange?: boolean;
  yAutoRange?: boolean;
  rightYAutoRange?: boolean;
  xReverse?: boolean;
  yReverse?: boolean;
  rightYReverse?: boolean;
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  rightYMin?: number;
  rightYMax?: number;
  tickDirection?: TickDirection;
  axisStyle?: AxisStylePreset;
  xMajorTickStep?: number;
  xMinorTickStep?: number;
  yMajorTickStep?: number;
  yMinorTickStep?: number;
  rightYMajorTickStep?: number;
  rightYMinorTickStep?: number;
  rightYTickFormat?: TickLabelFormat;
  rightYTickDecimals?: number;
  rightYTickPrefix?: string;
  rightYTickSuffix?: string;
  rightYTickAngle?: number;
  minorTicks?: boolean;
  gridVisible?: boolean;

  legendVisible?: boolean;
  legendPosition?: LegendPosition;
  legendX?: number;
  legendY?: number;
  legendXAnchor?: LegendXAnchor;
  legendYAnchor?: LegendYAnchor;
  legendOrientation?: LegendOrientation;
  legendFrame?: boolean;
  legendColumns?: number;
  legendFontSizePt?: number;
  legendFontColor?: string;
  legendBackground?: string;
  legendBackgroundOpacity?: number;
  legendBorderColor?: string;
  legendBorderWidthPt?: number;
  legendItemWidthPx?: number;

  barGap?: number;
  barGroupGap?: number;

  errorSeriesId?: string;
  offsetStep?: number;
  waterfallXOffset?: number;
  waterfallYOffset?: number;
  colorScale?: ColorScaleId;
  reverseColorScale?: boolean;
  zAutoRange?: boolean;
  zMin?: number;
  zMax?: number;
  colorbarVisible?: boolean;
  colorbarTitle?: string;
  fieldEqualAspect?: boolean;
  contourLevels?: number;
  contourFill?: boolean;
  contourLines?: boolean;
  contourLabels?: boolean;

}

export interface FigureDataRef {
  sheetId: string;
  xColumnId?: string;
  yColumnIds: string[];
  yErrorColumnId?: string;
  zColumnId?: string;
}

export interface FigureSpec {
  id: string;
  name: string;
  folderId?: string;
  dataRef?: FigureDataRef;
  templateId: PlotTemplateId;
  presetId: PresetId;
  figureOverrides: FigureOverrides;
  seriesOverrides: Record<string, SeriesOverride>;
  seriesOrder: string[];
  datasetId?: string;
}

export interface ProjectDefaults {
  templateId: PlotTemplateId;
  presetId: PresetId;
  figureOverrides: FigureOverrides;
}

export type FigureInputState =
  | "empty"
  | "incomplete"
  | "ready"
  | "broken";

export interface ProjectState {
  format: "sfig";
  schemaVersion: "0.5";
  projectId: string;
  name: string;
  folders: ProjectFolder[];
  dataBooks: DataBook[];
  figures: FigureSpec[];
  activeFigureId: string;
  defaults: ProjectDefaults;
}

export interface UserDefaults {
  templateId: PlotTemplateId;
  presetId: PresetId;
  figureOverrides: FigureOverrides;
}

export type DocumentRef =
  | { type: "book"; id: string }
  | { type: "figure"; id: string };

export type ExplorerSelection =
  | { type: "folder"; id: string }
  | { type: "book"; id: string }
  | { type: "sheet"; id: string }
  | { type: "figure"; id: string };

export type InspectorTab =
  | "data"
  | "figure"
  | "series"
  | "axis"
  | "legend"
  | "check";
