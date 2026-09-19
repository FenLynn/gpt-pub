export type NumericValue = number | null;

export interface Column {
  id: string;
  name: string;
  unit?: string;
  values: NumericValue[];
}

export interface Dataset {
  id: string;
  name: string;
  x: Column;
  ys: Column[];
}

export type PresetId = "scientific" | "nature" | "presentation";

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
  lineWidthPt?: number;
  markerVisible?: boolean;
  markerSizePt?: number;
  color?: string;
}

export interface FigureOverrides {
  fontFamily?: "Arial" | "Times New Roman";
  fontSizePt?: number;
  legendVisible?: boolean;
  xTitle?: string;
  yTitle?: string;
}

export interface StoredProject {
  version: 1;
  dataset: Dataset;
  presetId: PresetId;
  figureOverrides: FigureOverrides;
  seriesOverrides: Record<string, SeriesOverride>;
}
