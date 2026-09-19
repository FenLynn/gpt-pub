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
  const xIndex = Math.max(
    0,
    sheet.columns.findIndex((column) => column.role === "X") >= 0
      ? sheet.columns.findIndex((column) => column.role === "X")
      : sheet.columns.findIndex((column) => column.role !== "Label")
  );
  const x = sheet.columns[xIndex] ?? sheet.columns[0];
  const nextXOffset = sheet.columns
    .slice(xIndex + 1)
    .findIndex((column) => column.role === "X");
  const segmentEnd =
    nextXOffset >= 0 ? xIndex + 1 + nextXOffset : sheet.columns.length;
  const segment = sheet.columns.slice(xIndex + 1, segmentEnd);

  const ys = segment.filter((column) => column.role === "Y");
  const fallbackYs = segment.filter(
    (column) => !["Label", "XErr", "YErr"].includes(column.role)
  );
  const yColumns = ys.length ? ys : fallbackYs;
  const yError = segment.find((column) => column.role === "YErr");
  const z = segment.find((column) => column.role === "Z");

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
  const explicitMapping = Boolean(figure);
  const x =
    sheet.columns.find((column) => column.id === dataRef.xColumnId) ??
    (!explicitMapping
      ? sheet.columns.find((column) => column.role === "X") ??
        sheet.columns[0]
      : undefined);

  const yIds = new Set([
    ...dataRef.yColumnIds,
    ...(dataRef.yErrorColumnId ? [dataRef.yErrorColumnId] : []),
    ...(dataRef.zColumnId ? [dataRef.zColumnId] : [])
  ]);

  let ys = sheet.columns.filter(
    (column) => column.id !== x?.id && yIds.has(column.id)
  );

  if (!explicitMapping && ys.length === 0) {
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
          id: dataRef.xColumnId || "missing-x",
          name: "缺失的 X 数据列",
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
