import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { Dataset, ProjectState } from "../model";

const APP_VERSION = "0.2.0-web";

interface ColumnMeta {
  id: string;
  name: string;
  unit?: string;
  [key: string]: unknown;
}

interface DatasetIndexEntry {
  id: string;
  name: string;
  folderId?: string;
  x: ColumnMeta;
  ys: ColumnMeta[];
  metadata?: Dataset["metadata"];
  dataPath: string;
  [key: string]: unknown;
}

interface ProjectDocument {
  format: "sfig";
  schemaVersion: "0.1" | "0.2";
  projectId: string;
  name: string;
  folders?: ProjectState["folders"];
  datasets: DatasetIndexEntry[];
  figures: ProjectState["figures"];
  activeFigureId: string;
  defaults: ProjectState["defaults"];
  [key: string]: unknown;
}

function datasetIndex(dataset: Dataset): DatasetIndexEntry {
  const { x, ys, ...datasetRest } = dataset as Dataset & Record<string, unknown>;
  const { values: _xValues, ...xMeta } = x;
  const yMeta = ys.map((column) => {
    const { values: _values, ...meta } = column;
    return meta;
  });

  return {
    ...datasetRest,
    id: dataset.id,
    name: dataset.name,
    folderId: dataset.folderId,
    x: xMeta,
    ys: yMeta,
    metadata: dataset.metadata,
    dataPath: "data/" + dataset.id + ".json"
  };
}

export function encodeProject(project: ProjectState): Uint8Array {
  const projectDocument = {
    ...(project as ProjectState & Record<string, unknown>),
    datasets: project.datasets.map(datasetIndex)
  } as unknown as ProjectDocument;

  const files: Record<string, Uint8Array> = {
    "manifest.json": strToU8(
      JSON.stringify(
        {
          format: "sfig",
          schemaVersion: project.schemaVersion,
          projectId: project.projectId,
          createdWith: APP_VERSION
        },
        null,
        2
      )
    ),
    "project.json": strToU8(JSON.stringify(projectDocument, null, 2))
  };

  for (const dataset of project.datasets) {
    files["data/" + dataset.id + ".json"] = strToU8(
      JSON.stringify({
        x: dataset.x.values,
        ys: Object.fromEntries(
          dataset.ys.map((column) => [column.id, column.values])
        )
      })
    );
  }

  return zipSync(files, { level: 6 });
}

function migrateProjectDocument(document: ProjectDocument): ProjectDocument {
  if (document.schemaVersion === "0.2") return document;

  return {
    ...document,
    schemaVersion: "0.2",
    folders: document.folders ?? [
      { id: "folder-data", name: "数据" },
      { id: "folder-figures", name: "图形" }
    ],
    datasets: document.datasets.map((dataset) => ({
      ...dataset,
      folderId: dataset.folderId ?? "folder-data"
    })),
    figures: document.figures.map((figure) => ({
      ...figure,
      folderId: figure.folderId ?? "folder-figures"
    }))
  };
}

export function decodeProject(bytes: Uint8Array): ProjectState {
  const archive = unzipSync(bytes);
  const projectBytes = archive["project.json"];
  if (!projectBytes) throw new Error("项目文件缺少 project.json。");

  const raw = JSON.parse(strFromU8(projectBytes)) as ProjectDocument;

  if (raw.format !== "sfig") {
    throw new Error("不是有效的 FigureStudio 项目文件。");
  }

  if (raw.schemaVersion !== "0.1" && raw.schemaVersion !== "0.2") {
    throw new Error("暂不支持这个项目文件版本。");
  }

  const projectDocument = migrateProjectDocument(raw);

  const datasets: Dataset[] = projectDocument.datasets.map((meta) => {
    const dataBytes = archive[meta.dataPath];
    if (!dataBytes) {
      throw new Error("项目文件缺少数据：" + meta.name);
    }

    const data = JSON.parse(strFromU8(dataBytes)) as {
      x: Dataset["x"]["values"];
      ys: Record<string, Dataset["ys"][number]["values"]>;
    };

    const { dataPath: _dataPath, ...datasetMeta } = meta;

    return {
      ...datasetMeta,
      id: meta.id,
      name: meta.name,
      folderId: meta.folderId,
      x: {
        ...meta.x,
        values: data.x
      },
      ys: meta.ys.map((column) => ({
        ...column,
        values: data.ys[column.id] ?? []
      })),
      metadata: meta.metadata
    } as Dataset;
  });

  const fallbackActive = projectDocument.figures[0]?.id ?? "";

  return {
    ...(projectDocument as unknown as ProjectState),
    format: "sfig",
    schemaVersion: "0.2",
    folders: projectDocument.folders ?? [],
    datasets,
    activeFigureId:
      projectDocument.figures.some(
        (figure) => figure.id === projectDocument.activeFigureId
      )
        ? projectDocument.activeFigureId
        : fallbackActive
  };
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
