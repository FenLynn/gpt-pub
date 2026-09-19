import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type {
  CellValue,
  Column,
  DataBook,
  DataSheet,
  DataSource,
  FigureSpec,
  ProjectState
} from "../model";

const APP_VERSION = "0.4.0-web";

interface ColumnMeta extends Omit<Column, "values"> {
  [key: string]: unknown;
}

interface SheetMetaV04 extends Omit<DataSheet, "columns"> {
  columns: ColumnMeta[];
  dataPath: string;
  [key: string]: unknown;
}

interface BookMetaV04 extends Omit<DataBook, "sheets"> {
  sheets: SheetMetaV04[];
  [key: string]: unknown;
}

interface ProjectDocumentV04 {
  format: "sfig";
  schemaVersion: "0.4";
  projectId: string;
  name: string;
  folders: ProjectState["folders"];
  dataBooks: BookMetaV04[];
  figures: FigureSpec[];
  activeFigureId: string;
  defaults: ProjectState["defaults"];
  [key: string]: unknown;
}

interface SheetMetaV03 {
  id: string;
  name: string;
  comment?: string;
  columns: ColumnMeta[];
  metadata?: DataSheet["metadata"];
  dataPath: string;
  [key: string]: unknown;
}

interface BookMetaV03 {
  id: string;
  name: string;
  folderId?: string;
  source: DataSource;
  sheets: SheetMetaV03[];
  [key: string]: unknown;
}

interface ProjectDocumentV03 {
  format: "sfig";
  schemaVersion: "0.3";
  projectId: string;
  name: string;
  folders: ProjectState["folders"];
  dataBooks: BookMetaV03[];
  figures: FigureSpec[];
  activeFigureId: string;
  defaults: ProjectState["defaults"];
  [key: string]: unknown;
}

interface LegacyDatasetMeta {
  id: string;
  name: string;
  folderId?: string;
  x: {
    id: string;
    name: string;
    unit?: string;
    [key: string]: unknown;
  };
  ys: Array<{
    id: string;
    name: string;
    unit?: string;
    [key: string]: unknown;
  }>;
  metadata?: DataSheet["metadata"];
  dataPath: string;
  [key: string]: unknown;
}

interface LegacyProjectDocument {
  format: "sfig";
  schemaVersion: "0.1" | "0.2";
  projectId: string;
  name: string;
  folders?: ProjectState["folders"];
  datasets: LegacyDatasetMeta[];
  figures: Array<Record<string, any>>;
  activeFigureId: string;
  defaults: ProjectState["defaults"];
  [key: string]: unknown;
}

function normalizeLoadedSource(source: DataSource): DataSource {
  return source.kind === "linked"
    ? { ...source, status: "needs-relink" }
    : source;
}

function stripSheet(sheet: DataSheet): SheetMetaV04 {
  const columns = sheet.columns.map((column) => {
    const { values: _values, ...meta } = column;
    return meta;
  });
  return {
    ...sheet,
    columns,
    dataPath: "data/" + sheet.id + ".json"
  };
}

function stripBook(book: DataBook): BookMetaV04 {
  return {
    ...book,
    sheets: book.sheets.map(stripSheet)
  };
}

export function encodeProject(project: ProjectState): Uint8Array {
  const document: ProjectDocumentV04 = {
    ...(project as ProjectState & Record<string, unknown>),
    schemaVersion: "0.4",
    dataBooks: project.dataBooks.map(stripBook)
  } as ProjectDocumentV04;

  const files: Record<string, Uint8Array> = {
    "manifest.json": strToU8(
      JSON.stringify(
        {
          format: "sfig",
          schemaVersion: "0.4",
          projectId: project.projectId,
          createdWith: APP_VERSION
        },
        null,
        2
      )
    ),
    "project.json": strToU8(JSON.stringify(document, null, 2))
  };

  for (const book of project.dataBooks) {
    for (const sheet of book.sheets) {
      files["data/" + sheet.id + ".json"] = strToU8(
        JSON.stringify(
          Object.fromEntries(
            sheet.columns.map((column) => [column.id, column.values])
          )
        )
      );
    }
  }

  return zipSync(files, { level: 6 });
}

function loadSheetValues(
  archive: Record<string, Uint8Array>,
  sheetMeta: { id: string; name: string; columns: ColumnMeta[]; dataPath: string }
): Record<string, CellValue[]> {
  const bytes = archive[sheetMeta.dataPath];
  if (!bytes) throw new Error("项目文件缺少数据表：" + sheetMeta.name);
  return JSON.parse(strFromU8(bytes)) as Record<string, CellValue[]>;
}

function loadV04(
  archive: Record<string, Uint8Array>,
  document: ProjectDocumentV04
): ProjectState {
  const dataBooks: DataBook[] = document.dataBooks.map((book) => ({
    ...book,
    sheets: book.sheets.map((sheetMeta) => {
      const values = loadSheetValues(archive, sheetMeta);
      const { dataPath: _dataPath, ...sheetRest } = sheetMeta;
      return {
        ...sheetRest,
        source: normalizeLoadedSource(sheetMeta.source),
        columns: sheetMeta.columns.map((column) => ({
          ...column,
          values: values[column.id] ?? []
        }))
      } as DataSheet;
    })
  }));

  return {
    ...(document as unknown as ProjectState),
    format: "sfig",
    schemaVersion: "0.4",
    dataBooks,
    activeFigureId: document.figures.some(
      (figure) => figure.id === document.activeFigureId
    )
      ? document.activeFigureId
      : document.figures[0]?.id ?? ""
  };
}

function migrateV03(
  archive: Record<string, Uint8Array>,
  document: ProjectDocumentV03
): ProjectState {
  const dataBooks: DataBook[] = document.dataBooks.map((book) => {
    const { source, sheets, ...bookRest } = book;
    return {
      ...bookRest,
      sheets: sheets.map((sheetMeta) => {
        const values = loadSheetValues(archive, sheetMeta);
        const { dataPath: _dataPath, ...sheetRest } = sheetMeta;
        return {
          ...sheetRest,
          source: normalizeLoadedSource(source),
          columns: sheetMeta.columns.map((column) => ({
            ...column,
            values: values[column.id] ?? []
          }))
        } as DataSheet;
      })
    };
  });

  return {
    ...(document as unknown as Record<string, unknown>),
    format: "sfig",
    schemaVersion: "0.4",
    projectId: document.projectId,
    name: document.name,
    folders: document.folders ?? [],
    dataBooks,
    figures: document.figures,
    activeFigureId: document.figures.some(
      (figure) => figure.id === document.activeFigureId
    )
      ? document.activeFigureId
      : document.figures[0]?.id ?? "",
    defaults: document.defaults
  } as ProjectState;
}

function legacyRole(
  column: LegacyDatasetMeta["ys"][number],
  index: number
): Column["role"] {
  const text = (column.id + " " + column.name).toLowerCase();
  if (/yerr|y error|sigma|std|error/.test(text)) return "YErr";
  return index >= 0 ? "Y" : "Y";
}

function migrateLegacy(
  archive: Record<string, Uint8Array>,
  document: LegacyProjectDocument
): ProjectState {
  const books: DataBook[] = document.datasets.map((dataset) => {
    const bytes = archive[dataset.dataPath];
    if (!bytes) throw new Error("旧项目缺少数据：" + dataset.name);
    const values = JSON.parse(strFromU8(bytes)) as {
      x: Array<number | null>;
      ys: Record<string, Array<number | null>>;
    };

    const sheet: DataSheet = {
      id: dataset.id,
      name: dataset.name,
      source: { kind: "embedded" },
      metadata: dataset.metadata,
      columns: [
        {
          ...dataset.x,
          role: "X",
          values: values.x
        },
        ...dataset.ys.map((column, index) => ({
          ...column,
          role: legacyRole(column, index),
          values: values.ys[column.id] ?? []
        }))
      ]
    };

    return {
      id: "book-" + dataset.id,
      name: dataset.name,
      folderId: dataset.folderId,
      sheets: [sheet]
    };
  });

  const datasetById = new Map(
    document.datasets.map((dataset) => [dataset.id, dataset])
  );

  const figures: FigureSpec[] = document.figures.map((legacy) => {
    const dataset = datasetById.get(String(legacy.datasetId));
    const yIds = Array.isArray(legacy.seriesOrder)
      ? legacy.seriesOrder.filter((id: string) =>
          dataset?.ys.some((column) => column.id === id)
        )
      : dataset?.ys.map((column) => column.id) ?? [];
    const errorId = legacy.figureOverrides?.errorSeriesId;
    return {
      ...legacy,
      dataRef: {
        sheetId: String(legacy.datasetId),
        xColumnId: dataset?.x.id ?? "",
        yColumnIds: yIds.filter((id: string) => id !== errorId),
        yErrorColumnId: errorId
      },
      seriesOrder: yIds.filter((id: string) => id !== errorId)
    } as FigureSpec;
  });

  return {
    ...(document as unknown as Record<string, unknown>),
    format: "sfig",
    schemaVersion: "0.4",
    projectId: document.projectId,
    name: document.name,
    folders: document.folders ?? [],
    dataBooks: books,
    figures,
    activeFigureId: figures.some(
      (figure) => figure.id === document.activeFigureId
    )
      ? document.activeFigureId
      : figures[0]?.id ?? "",
    defaults: document.defaults
  } as ProjectState;
}

export function decodeProject(bytes: Uint8Array): ProjectState {
  const archive = unzipSync(bytes);
  const projectBytes = archive["project.json"];
  if (!projectBytes) throw new Error("项目文件缺少 project.json。");

  const raw = JSON.parse(strFromU8(projectBytes)) as {
    format?: string;
    schemaVersion?: string;
  };

  if (raw.format !== "sfig") {
    throw new Error("不是有效的 FigureStudio 项目文件。");
  }
  if (raw.schemaVersion === "0.4") {
    return loadV04(archive, raw as ProjectDocumentV04);
  }
  if (raw.schemaVersion === "0.3") {
    return migrateV03(archive, raw as ProjectDocumentV03);
  }
  if (raw.schemaVersion === "0.1" || raw.schemaVersion === "0.2") {
    return migrateLegacy(archive, raw as LegacyProjectDocument);
  }

  throw new Error("暂不支持这个项目文件版本。");
}

export function downloadProject(project: ProjectState) {
  const bytes = encodeProject(project);
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const safeName = (project.name || "figurestudio-project")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .trim();

  anchor.href = url;
  anchor.download = (safeName || "figurestudio-project") + ".sfig";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readProjectFile(file: File): Promise<ProjectState> {
  return decodeProject(new Uint8Array(await file.arrayBuffer()));
}
