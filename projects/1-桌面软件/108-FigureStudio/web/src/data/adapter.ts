import type {
  CellValue,
  Column,
  DataBook,
  DataSheet,
  Dataset,
  FigureDataRef,
  FigureSpec,
  ProjectState
} from "../model";

export function findSheet(
  project: ProjectState,
  sheetId: string
): { book: DataBook; sheet: DataSheet } | undefined {
  for (const book of project.dataBooks) {
    const sheet = book.sheets.find((item) => item.id === sheetId);
    if (sheet) return { book, sheet };
  }
  return undefined;
}

export function sheetRowCount(sheet: DataSheet): number {
  return Math.max(0, ...sheet.columns.map((column) => column.values.length));
}

export function columnLabel(index: number, role: Column["role"]): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return role === "None" ? letters : letters + "(" + role + ")";
}

export function defaultDataRef(sheet: DataSheet): FigureDataRef {
  const x =
    sheet.columns.find((column) => column.role === "X") ??
    sheet.columns.find((column) => column.role !== "Label") ??
    sheet.columns[0];

  const ys = sheet.columns.filter((column) => column.role === "Y");
  const fallbackYs = sheet.columns.filter(
    (column) =>
      column.id !== x?.id &&
      !["Label", "XErr", "YErr"].includes(column.role)
  );

  const yColumns = ys.length ? ys : fallbackYs;
  const yError = sheet.columns.find((column) => column.role === "YErr");
  const z = sheet.columns.find((column) => column.role === "Z");

  return {
    sheetId: sheet.id,
    xColumnId: x?.id ?? "",
    yColumnIds: yColumns.map((column) => column.id),
    yErrorColumnId: yError?.id,
    zColumnId: z?.id
  };
}

function numericValues(values: CellValue[]): Array<number | null> {
  return values.map((value) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  });
}

export function sheetToDataset(
  sheet: DataSheet,
  figure?: FigureSpec
): Dataset {
  const dataRef = figure?.dataRef ?? defaultDataRef(sheet);
  const x =
    sheet.columns.find((column) => column.id === dataRef.xColumnId) ??
    sheet.columns.find((column) => column.role === "X") ??
    sheet.columns[0];

  const yIds = new Set([
    ...dataRef.yColumnIds,
    ...(dataRef.yErrorColumnId ? [dataRef.yErrorColumnId] : []),
    ...(dataRef.zColumnId ? [dataRef.zColumnId] : [])
  ]);

  let ys = sheet.columns.filter(
    (column) => column.id !== x?.id && yIds.has(column.id)
  );

  if (ys.length === 0) {
    ys = sheet.columns.filter(
      (column) => column.id !== x?.id && column.role !== "Label"
    );
  }

  return {
    id: sheet.id,
    name: sheet.name,
    x: x
      ? { ...x, values: numericValues(x.values) }
      : {
          id: "x",
          name: "X",
          role: "X",
          values: []
        },
    ys: ys.map((column) => ({
      ...column,
      values: numericValues(column.values)
    })),
    metadata: sheet.metadata
  };
}

export function normalizeFigureForSheet(
  figure: FigureSpec,
  sheet: DataSheet
): FigureSpec {
  const available = new Set(sheet.columns.map((column) => column.id));
  const fallback = defaultDataRef(sheet);
  const xColumnId = available.has(figure.dataRef.xColumnId)
    ? figure.dataRef.xColumnId
    : fallback.xColumnId;
  const yColumnIds = figure.dataRef.yColumnIds.filter((id) =>
    available.has(id)
  );

  return {
    ...figure,
    dataRef: {
      ...figure.dataRef,
      sheetId: sheet.id,
      xColumnId,
      yColumnIds: yColumnIds.length ? yColumnIds : fallback.yColumnIds,
      yErrorColumnId:
        figure.dataRef.yErrorColumnId &&
        available.has(figure.dataRef.yErrorColumnId)
          ? figure.dataRef.yErrorColumnId
          : fallback.yErrorColumnId,
      zColumnId:
        figure.dataRef.zColumnId && available.has(figure.dataRef.zColumnId)
          ? figure.dataRef.zColumnId
          : fallback.zColumnId
    },
    seriesOrder: figure.seriesOrder.filter((id) => available.has(id))
  };
}
