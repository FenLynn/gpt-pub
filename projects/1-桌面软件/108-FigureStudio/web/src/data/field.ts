import type { Dataset, PlotColumn } from "../model";

function numericName(name: string): number | undefined {
  const value = Number(name.trim());
  return name.trim() !== "" && Number.isFinite(value) ? value : undefined;
}

export function resolveFieldRowCoordinates(
  dataset: Dataset,
  rows: PlotColumn[]
): number[] {
  const byId = dataset.metadata?.rowCoordinateByColumnId;
  const legacy = dataset.metadata?.rowCoordinates;
  const legacyUsable =
    legacy?.length === rows.length &&
    legacy.every((value) => Number.isFinite(value));

  return rows.map((row, index) => {
    const mapped = byId?.[row.id];
    if (mapped !== undefined && Number.isFinite(mapped)) return mapped;
    if (legacyUsable) return legacy![index];
    const fromName = numericName(row.name);
    return fromName ?? index;
  });
}

export function hasExplicitFieldCoordinates(
  dataset: Dataset,
  rows: PlotColumn[]
): boolean {
  const byId = dataset.metadata?.rowCoordinateByColumnId;
  if (
    byId &&
    rows.length > 0 &&
    rows.every((row) => {
      const value = byId[row.id];
      return value !== undefined && Number.isFinite(value);
    })
  ) {
    return true;
  }

  const legacy = dataset.metadata?.rowCoordinates;
  if (
    legacy &&
    legacy.length === rows.length &&
    legacy.every((value) => Number.isFinite(value))
  ) {
    return true;
  }

  return (
    rows.length > 0 &&
    rows.every((row) => numericName(row.name) !== undefined)
  );
}
