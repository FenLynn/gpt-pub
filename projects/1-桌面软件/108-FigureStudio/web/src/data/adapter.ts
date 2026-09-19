import type {
  CellValue,
  Column,
  DataBook,
  DataSheet,
  Dataset,
  FigureDataRef,
  PlotColumn,
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
  const firstXIndex = sheet.columns.findIndex((column) => column.role === "X");
  const x = firstXIndex >= 0 ? sheet.columns[firstXIndex] : undefined;

  const nextXOffset =
    firstXIndex >= 0
      ? sheet.columns
          .slice(firstXIndex + 1)
          .findIndex((column) => column.role === "X")
      : -1;
  const segmentEnd =
    firstXIndex >= 0 && nextXOffset >= 0
      ? firstXIndex + 1 + nextXOffset
      : sheet.columns.length;
  const segment =
    firstXIndex >= 0
      ? sheet.columns.slice(firstXIndex + 1, segmentEnd)
      : sheet.columns;

  const ys = segment.filter((column) => column.role === "Y");
  const fallbackYs = segment.filter(
    (column) =>
      column.id !== x?.id &&
      !["X", "Label", "XErr", "YErr"].includes(column.role)
  );
  const yColumns = ys.length ? ys : fallbackYs;
  const yError = segment.find((column) => column.role === "YErr");
  const z = segment.find((column) => column.role === "Z");

  return {
    sheetId: sheet.id,
    xColumnId: x?.id,
    yColumnIds: yColumns.map((column) => column.id),
    yErrorColumnId: yError?.id,
    zColumnId: z?.id
  };
}

export function emptyDataset(name = "空图"): Dataset {
  return {
    id: "__empty__",
    name,
    x: {
      id: "__row_index__",
      name: "X",
      role: "X",
      values: []
    },
    ys: []
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
  const explicitMapping = Boolean(figure?.dataRef);
  const explicitX = dataRef.xColumnId
    ? sheet.columns.find((column) => column.id === dataRef.xColumnId)
    : undefined;

  const yIds = new Set([
    ...dataRef.yColumnIds,
    ...(dataRef.yErrorColumnId ? [dataRef.yErrorColumnId] : []),
    ...(dataRef.zColumnId ? [dataRef.zColumnId] : [])
  ]);

  let ys = sheet.columns.filter(
    (column) => column.id !== explicitX?.id && yIds.has(column.id)
  );

  if (!explicitMapping && ys.length === 0) {
    ys = sheet.columns.filter(
      (column) => column.id !== explicitX?.id && column.role !== "Label"
    );
  }

  const rowCount = Math.max(
    0,
    ...ys.map((column) => column.values.length)
  );

  const x: PlotColumn = explicitX
    ? { ...explicitX, values: numericValues(explicitX.values) }
    : dataRef.xColumnId
    ? {
        id: dataRef.xColumnId,
        name: "缺失的 X 数据列",
        role: "X",
        values: []
      }
    : {
        id: "__row_index__",
        name: "行号",
        role: "X",
        values: Array.from({ length: rowCount }, (_, index) => index + 1)
      };

  return {
    id: sheet.id,
    name: sheet.name,
    x,
    ys: ys.map((column) => ({
      ...column,
      values: numericValues(column.values)
    })),
    metadata: sheet.metadata
  };
}
