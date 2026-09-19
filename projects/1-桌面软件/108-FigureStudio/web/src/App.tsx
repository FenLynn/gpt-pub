import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Plotly from "plotly.js-dist-min";
import { createInitialProject } from "./data/demo";
import { downloadMatplotlibScript } from "./export/matplotlib";
import { useHistoryState } from "./hooks/useHistoryState";
import { parseDelimitedText } from "./lib/csv";
import type {
  AspectMode,
  AxisScale,
  ColorScaleId,
  Dataset,
  ExplorerSelection,
  FigureOverrides,
  FigureSpec,
  InspectorTab,
  LegendOrientation,
  LegendPosition,
  LineStyle,
  MarkerSymbol,
  PlotTemplateId,
  PresetId,
  ProjectFolder,
  ProjectState,
  SeriesOverride,
  TickDirection,
  UserDefaults
} from "./model";
import {
  buildLayout,
  buildTraces,
  orderSeries,
  PNG_DPI,
  resolveCanvasMm
} from "./plot/renderSpec";
import { presetOrder, presets } from "./plot/presets";
import { templateLabel, templates } from "./plot/templates";
import { checkFigure } from "./project/checker";
import {
  downloadProject,
  readProjectFile
} from "./project/projectIO";
import { figureThumbnailDataUrl } from "./project/thumbnail";

const AUTOSAVE_KEY = "figurestudio-p108-autosave-v02";
const USER_DEFAULTS_KEY = "figurestudio-p108-user-defaults-v02";
const UI_SCALE_KEY = "figurestudio-p108-ui-scale";
const PNG_SCALE = PNG_DPI / 96;

function makeId(prefix: string): string {
  return prefix + "-" + Math.random().toString(36).slice(2, 10);
}

function axisLabel(name: string, unit?: string): string {
  return unit ? name + " (" + unit + ")" : name;
}

function readUserDefaults(): UserDefaults | undefined {
  try {
    const raw = localStorage.getItem(USER_DEFAULTS_KEY);
    return raw ? (JSON.parse(raw) as UserDefaults) : undefined;
  } catch {
    return undefined;
  }
}

function readUiScale(): number {
  const value = Number(localStorage.getItem(UI_SCALE_KEY) ?? "1.1");
  return [0.9, 1, 1.1, 1.25, 1.4].includes(value) ? value : 1.1;
}

function makeFigure(
  dataset: Dataset,
  project: ProjectState,
  folderId?: string,
  name?: string
): FigureSpec {
  return {
    id: makeId("figure"),
    name: name ?? "图 " + String(project.figures.length + 1),
    folderId,
    datasetId: dataset.id,
    templateId: project.defaults.templateId,
    presetId: project.defaults.presetId,
    figureOverrides: {
      aspectMode: "4:3",
      ...project.defaults.figureOverrides,
      xTitle: axisLabel(dataset.x.name, dataset.x.unit),
      yTitle: axisLabel(dataset.ys[0]?.name || "Y", dataset.ys[0]?.unit)
    },
    seriesOverrides: {},
    seriesOrder: dataset.ys.map((series) => series.id)
  };
}

function styleDefaultsFromFigure(figure: FigureSpec): UserDefaults {
  const source = figure.figureOverrides;
  const keep: FigureOverrides = {
    aspectMode: source.aspectMode,
    customAspectWidth: source.customAspectWidth,
    customAspectHeight: source.customAspectHeight,
    fontFamily: source.fontFamily,
    fontSizePt: source.fontSizePt,
    background: source.background,
    tickDirection: source.tickDirection,
    minorTicks: source.minorTicks,
    gridVisible: source.gridVisible,
    legendVisible: source.legendVisible,
    legendPosition: source.legendPosition,
    legendOrientation: source.legendOrientation,
    legendFrame: source.legendFrame,
    legendColumns: source.legendColumns,
    colorScale: source.colorScale,
    reverseColorScale: source.reverseColorScale
  };

  return {
    templateId: figure.templateId,
    presetId: figure.presetId,
    figureOverrides: keep
  };
}

function MiniSwitch(props: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={props.checked ? "mini-switch is-on" : "mini-switch"}
      aria-pressed={props.checked}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    >
      <span />
    </button>
  );
}

function ResetIcon(props: { visible: boolean; onReset: () => void }) {
  if (!props.visible) return null;
  return (
    <button
      className="reset-icon"
      type="button"
      title="恢复继承值"
      onClick={props.onReset}
    >
      ↺
    </button>
  );
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function sparkPath(values: Array<number | null>, width: number, height: number): string {
  const points = values
    .map((value, index) => ({ value, index }))
    .filter(
      (item): item is { value: number; index: number } =>
        typeof item.value === "number" && Number.isFinite(item.value)
    );
  if (points.length < 2) return "";

  const min = Math.min(...points.map((item) => item.value));
  const max = Math.max(...points.map((item) => item.value));
  const span = Math.max(1e-12, max - min);
  const maxIndex = Math.max(1, values.length - 1);

  return points
    .filter((_, index) => index % Math.max(1, Math.floor(points.length / 90)) === 0)
    .map((item, index) => {
      const x = (item.index / maxIndex) * width;
      const y = height - ((item.value - min) / span) * height;
      return (index === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
    })
    .join(" ");
}

function App() {
  const initialProject = useMemo(
    () => createInitialProject(readUserDefaults()),
    []
  );
  const history = useHistoryState<ProjectState>(initialProject);
  const project = history.value;

  const plotRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dataInputRef = useRef<HTMLInputElement | null>(null);
  const projectInputRef = useRef<HTMLInputElement | null>(null);
  const dataActionRef = useRef<"add" | "replace">("add");

  const [selectedSeriesIds, setSelectedSeriesIds] = useState<string[]>([]);
  const [previewScale, setPreviewScale] = useState(1);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [toast, setToast] = useState("");
  const [uiScale, setUiScale] = useState(readUiScale);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("series");
  const [explorerView, setExplorerView] = useState<"list" | "thumb">("list");
  const [explorerSelection, setExplorerSelection] =
    useState<ExplorerSelection | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(initialProject.folders.map((folder) => folder.id))
  );
  const [pendingReplacement, setPendingReplacement] =
    useState<Dataset | null>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => {
      setToast((current) => (current === text ? "" : current));
    }, 2200);
  }, []);

  const activeFigure =
    project.figures.find((figure) => figure.id === project.activeFigureId) ??
    project.figures[0];

  const activeDataset = project.datasets.find(
    (dataset) => dataset.id === activeFigure?.datasetId
  );

  const preset = activeFigure
    ? presets[activeFigure.presetId]
    : presets.scientific;

  const orderedSeries = useMemo(
    () =>
      activeDataset && activeFigure
        ? orderSeries(activeDataset, activeFigure.seriesOrder)
        : [],
    [activeDataset, activeFigure]
  );

  const primarySeries =
    orderedSeries.find((series) =>
      selectedSeriesIds.includes(series.id)
    ) ?? orderedSeries[0];

  const primaryOverride =
    primarySeries && activeFigure
      ? activeFigure.seriesOverrides[primarySeries.id] || {}
      : {};

  const selectedIds = selectedSeriesIds.length
    ? selectedSeriesIds
    : primarySeries
    ? [primarySeries.id]
    : [];

  const effectiveFontFamily =
    activeFigure?.figureOverrides.fontFamily || preset.fontFamily;
  const effectiveFontSizePt =
    activeFigure?.figureOverrides.fontSizePt ?? preset.fontSizePt;
  const effectiveLegendVisible =
    activeFigure?.figureOverrides.legendVisible ?? true;
  const aspectMode =
    activeFigure?.figureOverrides.aspectMode ?? "4:3";

  const canvasMm = activeFigure
    ? resolveCanvasMm(preset, activeFigure)
    : { widthMm: preset.widthMm, heightMm: preset.heightMm };

  const traces = useMemo(
    () =>
      activeDataset && activeFigure
        ? buildTraces({
            dataset: activeDataset,
            figure: activeFigure,
            preset
          })
        : [],
    [activeDataset, activeFigure, preset]
  );

  const layout = useMemo(
    () =>
      activeDataset && activeFigure
        ? buildLayout({
            dataset: activeDataset,
            figure: activeFigure,
            preset
          })
        : { width: 640, height: 480 },
    [activeDataset, activeFigure, preset]
  );

  const checkItems = useMemo(
    () =>
      activeDataset && activeFigure
        ? checkFigure(activeDataset, activeFigure, preset)
        : [],
    [activeDataset, activeFigure, preset]
  );

  const warningCount = checkItems.filter((item) => item.level === "warn").length;

  useEffect(() => {
    document.documentElement.style.setProperty("--ui-scale", String(uiScale));
    localStorage.setItem(UI_SCALE_KEY, String(uiScale));
  }, [uiScale]);

  useEffect(() => {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
  }, [project]);

  useEffect(() => {
    const valid = selectedSeriesIds.filter((id) =>
      orderedSeries.some((series) => series.id === id)
    );
    if (valid.length !== selectedSeriesIds.length) {
      setSelectedSeriesIds(valid);
      return;
    }
    if (valid.length === 0 && orderedSeries[0]) {
      setSelectedSeriesIds([orderedSeries[0].id]);
    }
  }, [orderedSeries, selectedSeriesIds]);

  useEffect(() => {
    if (!activeFigure) return;
    const first = orderSeries(
      project.datasets.find((dataset) => dataset.id === activeFigure.datasetId) ?? {
        id: "",
        name: "",
        x: { id: "", name: "", values: [] },
        ys: []
      },
      activeFigure.seriesOrder
    )[0];
    setSelectedSeriesIds(first ? [first.id] : []);
    setExplorerSelection({ type: "figure", id: activeFigure.id });
  }, [activeFigure?.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const command = event.ctrlKey || event.metaKey;
      if (!command) return;

      if (event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        history.undo();
      } else if (
        event.key.toLowerCase() === "y" ||
        (event.key.toLowerCase() === "z" && event.shiftKey)
      ) {
        event.preventDefault();
        history.redo();
      } else if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        downloadProject(project);
        showToast("项目已保存为 .sfig");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [history, project, showToast]);

  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;

    const updateScale = () => {
      const rect = node.getBoundingClientRect();
      const availableWidth = Math.max(160, rect.width - 24);
      const availableHeight = Math.max(160, rect.height - 24);
      const fit = Math.min(
        availableWidth / Number(layout.width),
        availableHeight / Number(layout.height)
      );
      setPreviewScale(Math.max(0.1, Math.min(4, fit)));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(node);
    return () => observer.disconnect();
  }, [layout.width, layout.height]);

  const selectSeries = useCallback(
    (id: string, additive = false) => {
      setSelectedSeriesIds((current) => {
        if (!additive) return [id];
        if (current.includes(id)) {
          const next = current.filter((item) => item !== id);
          return next.length ? next : [id];
        }
        return [...current, id];
      });
      setInspectorTab("series");
    },
    []
  );

  useEffect(() => {
    const node = plotRef.current as any;
    if (!node || !activeFigure) return;

    const config = {
      responsive: false,
      displaylogo: false,
      displayModeBar: false,
      scrollZoom: activeFigure.templateId !== "surface-3d"
    };

    const handleDomClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest(".legend")) {
        setInspectorTab("legend");
      } else if (
        target.closest(".xtitle") ||
        target.closest(".ytitle") ||
        target.closest(".xaxislayer-above") ||
        target.closest(".yaxislayer-above")
      ) {
        setInspectorTab("axis");
      }
    };

    let cancelled = false;

    Plotly.react(node, traces, layout, config).then(() => {
      if (cancelled) return;
      node.removeAllListeners?.("plotly_click");
      node.removeAllListeners?.("plotly_legendclick");

      node.on?.("plotly_click", (event: any) => {
        const index = event?.points?.[0]?.curveNumber;
        const series =
          typeof index === "number" ? orderedSeries[index] : undefined;
        if (series) {
          selectSeries(
            series.id,
            Boolean(event?.event?.ctrlKey || event?.event?.metaKey)
          );
        }
      });

      node.on?.("plotly_legendclick", () => {
        setInspectorTab("legend");
        return false;
      });

      node.addEventListener("click", handleDomClick);
    });

    return () => {
      cancelled = true;
      node.removeAllListeners?.("plotly_click");
      node.removeAllListeners?.("plotly_legendclick");
      node.removeEventListener("click", handleDomClick);
    };
  }, [activeFigure, layout, orderedSeries, traces, selectSeries]);

  const patchProject = useCallback(
    (updater: (current: ProjectState) => ProjectState) => {
      history.commit(updater);
    },
    [history]
  );

  const patchActiveFigure = useCallback(
    (updater: (figure: FigureSpec) => FigureSpec) => {
      if (!activeFigure) return;
      patchProject((current) => ({
        ...current,
        figures: current.figures.map((figure) =>
          figure.id === activeFigure.id ? updater(figure) : figure
        )
      }));
    },
    [activeFigure, patchProject]
  );

  function setFigureField<K extends keyof FigureOverrides>(
    key: K,
    value: FigureOverrides[K]
  ) {
    patchActiveFigure((figure) => ({
      ...figure,
      figureOverrides: {
        ...figure.figureOverrides,
        [key]: value
      }
    }));
  }

  function resetFigureField(field: keyof FigureOverrides) {
    patchActiveFigure((figure) => {
      const next = { ...figure.figureOverrides };
      delete next[field];
      return { ...figure, figureOverrides: next };
    });
  }

  function updateSelectedSeries(patch: SeriesOverride) {
    if (!selectedIds.length) return;
    patchActiveFigure((figure) => {
      const next = { ...figure.seriesOverrides };
      for (const id of selectedIds) {
        next[id] = { ...(next[id] || {}), ...patch };
      }
      return { ...figure, seriesOverrides: next };
    });
  }

  function resetSelectedSeriesField(field: keyof SeriesOverride) {
    if (!selectedIds.length) return;
    patchActiveFigure((figure) => {
      const next = { ...figure.seriesOverrides };
      for (const id of selectedIds) {
        const value = { ...(next[id] || {}) };
        delete value[field];
        if (Object.keys(value).length === 0) delete next[id];
        else next[id] = value;
      }
      return { ...figure, seriesOverrides: next };
    });
  }

  function activateFigure(figureId: string) {
    history.updateWithoutHistory((current) => ({
      ...current,
      activeFigureId: figureId
    }));
  }

  function reorderSeries(dragId: string, targetId: string) {
    if (!activeFigure || dragId === targetId) return;
    patchActiveFigure((figure) => {
      const next = figure.seriesOrder.filter((id) => id !== dragId);
      const targetIndex = next.indexOf(targetId);
      if (targetIndex < 0) return figure;
      next.splice(targetIndex, 0, dragId);
      return { ...figure, seriesOrder: next };
    });
  }

  function moveSelectedSeries(direction: "up" | "down") {
    if (!primarySeries || !activeFigure) return;

    patchActiveFigure((figure) => {
      const normalized = [...figure.seriesOrder];
      const index = normalized.indexOf(primarySeries.id);
      if (index < 0) return figure;

      const target =
        direction === "up"
          ? Math.min(normalized.length - 1, index + 1)
          : Math.max(0, index - 1);

      if (target === index) return figure;

      [normalized[index], normalized[target]] = [
        normalized[target],
        normalized[index]
      ];
      return { ...figure, seriesOrder: normalized };
    });
  }

  function newProject() {
    if (!window.confirm("新建项目会替换当前工作区，是否继续？")) return;
    history.replace(createInitialProject(readUserDefaults()));
    showToast("已新建项目");
  }

  function restoreAutosave() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) {
        showToast("没有可恢复的自动保存");
        return;
      }
      const recovered = JSON.parse(raw) as ProjectState;
      if (recovered.format !== "sfig" || recovered.schemaVersion !== "0.2") {
        throw new Error("版本不匹配");
      }
      history.replace(recovered);
      showToast("已恢复自动保存");
    } catch {
      showToast("自动保存无法恢复");
    }
  }

  async function openProject(file: File) {
    try {
      const next = await readProjectFile(file);
      history.replace(next);
      setExpandedFolders(new Set(next.folders.map((folder) => folder.id)));
      showToast("项目已打开");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "项目打开失败。");
    } finally {
      if (projectInputRef.current) projectInputRef.current.value = "";
    }
  }

  function saveProject() {
    downloadProject(project);
    showToast("项目已保存为 .sfig");
  }

  function triggerDataFile(action: "add" | "replace") {
    dataActionRef.current = action;
    dataInputRef.current?.click();
  }

  function reconcileReplace(
    currentProject: ProjectState,
    datasetId: string,
    replacement: Dataset
  ): ProjectState | null {
    const oldDataset = currentProject.datasets.find(
      (dataset) => dataset.id === datasetId
    );
    if (!oldDataset) return currentProject;

    const exact = oldDataset.ys.every((column) =>
      replacement.ys.some((next) => next.id === column.id)
    );

    let mapping = new Map<string, string>();

    if (exact) {
      mapping = new Map(
        oldDataset.ys.map((column) => [column.id, column.id])
      );
    } else {
      const proceed = window.confirm(
        "新数据列结构与原数据不完全一致。是否按列顺序重新映射所有关联图？"
      );
      if (!proceed) return null;

      const count = Math.min(oldDataset.ys.length, replacement.ys.length);
      for (let index = 0; index < count; index += 1) {
        mapping.set(oldDataset.ys[index].id, replacement.ys[index].id);
      }
    }

    const stableDataset: Dataset = {
      ...replacement,
      id: oldDataset.id,
      folderId: oldDataset.folderId
    };

    const figures = currentProject.figures.map((figure) => {
      if (figure.datasetId !== datasetId) return figure;

      const nextOverrides: Record<string, SeriesOverride> = {};
      for (const [oldId, override] of Object.entries(figure.seriesOverrides)) {
        const mapped = mapping.get(oldId);
        if (mapped) nextOverrides[mapped] = override;
      }

      const mappedOrder = figure.seriesOrder
        .map((oldId) => mapping.get(oldId))
        .filter((value): value is string => Boolean(value));

      for (const column of replacement.ys) {
        if (!mappedOrder.includes(column.id)) mappedOrder.push(column.id);
      }

      const errorSeriesId = figure.figureOverrides.errorSeriesId
        ? mapping.get(figure.figureOverrides.errorSeriesId)
        : undefined;

      return {
        ...figure,
        seriesOrder: mappedOrder,
        seriesOverrides: nextOverrides,
        figureOverrides: {
          ...figure.figureOverrides,
          errorSeriesId
        }
      };
    });

    return {
      ...currentProject,
      datasets: currentProject.datasets.map((dataset) =>
        dataset.id === datasetId ? stableDataset : dataset
      ),
      figures
    };
  }

  async function handleDataFile(file: File) {
    try {
      const parsed = parseDelimitedText(await file.text(), file.name);

      if (dataActionRef.current === "replace" && activeDataset) {
        setPendingReplacement(parsed);
      } else {
        const targetFolder =
          explorerSelection?.type === "folder"
            ? explorerSelection.id
            : activeDataset?.folderId;
        parsed.folderId = targetFolder;
        patchProject((current) => {
          const figureFolder =
            activeFigure?.folderId ??
            current.folders.find((folder) => folder.name === "主文")?.id;
          const figure = makeFigure(parsed, current, figureFolder);
          return {
            ...current,
            datasets: [...current.datasets, parsed],
            figures: [...current.figures, figure],
            activeFigureId: figure.id
          };
        });
        showToast("已导入数据并创建图形");
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "数据导入失败。");
    } finally {
      if (dataInputRef.current) dataInputRef.current.value = "";
    }
  }

  function acceptReplacement() {
    if (!pendingReplacement || !activeDataset) return;
    patchProject((current) => {
      const next = reconcileReplace(
        current,
        activeDataset.id,
        pendingReplacement
      );
      return next ?? current;
    });
    setPendingReplacement(null);
    showToast("数据已替换，关联图和样式已保留");
  }

  function importPastedData() {
    if (!pasteText.trim()) return;
    try {
      const parsed = parseDelimitedText(pasteText, "剪贴板数据.csv");
      parsed.folderId =
        explorerSelection?.type === "folder"
          ? explorerSelection.id
          : activeDataset?.folderId;
      patchProject((current) => {
        const figure = makeFigure(parsed, current, activeFigure?.folderId);
        return {
          ...current,
          datasets: [...current.datasets, parsed],
          figures: [...current.figures, figure],
          activeFigureId: figure.id
        };
      });
      setPasteOpen(false);
      setPasteText("");
      showToast("已从剪贴板创建数据集");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "无法解析粘贴数据。");
    }
  }

  function addFigureForDataset(dataset: Dataset) {
    patchProject((current) => {
      const folderId =
        explorerSelection?.type === "folder"
          ? explorerSelection.id
          : activeFigure?.folderId;
      const figure = makeFigure(dataset, current, folderId);
      return {
        ...current,
        figures: [...current.figures, figure],
        activeFigureId: figure.id
      };
    });
  }

  function createFolder() {
    const name = window.prompt("新文件夹名称", "新文件夹");
    if (!name?.trim()) return;
    const parentId =
      explorerSelection?.type === "folder"
        ? explorerSelection.id
        : undefined;
    const folder: ProjectFolder = {
      id: makeId("folder"),
      name: name.trim(),
      parentId
    };
    patchProject((current) => ({
      ...current,
      folders: [...current.folders, folder]
    }));
    setExpandedFolders((current) => new Set([...current, folder.id]));
    setExplorerSelection({ type: "folder", id: folder.id });
  }

  function renameExplorerItem() {
    if (!explorerSelection) return;

    if (explorerSelection.type === "folder") {
      const item = project.folders.find(
        (folder) => folder.id === explorerSelection.id
      );
      if (!item) return;
      const name = window.prompt("重命名文件夹", item.name);
      if (!name?.trim()) return;
      patchProject((current) => ({
        ...current,
        folders: current.folders.map((folder) =>
          folder.id === item.id ? { ...folder, name: name.trim() } : folder
        )
      }));
      return;
    }

    if (explorerSelection.type === "dataset") {
      const item = project.datasets.find(
        (dataset) => dataset.id === explorerSelection.id
      );
      if (!item) return;
      const name = window.prompt("重命名数据", item.name);
      if (!name?.trim()) return;
      patchProject((current) => ({
        ...current,
        datasets: current.datasets.map((dataset) =>
          dataset.id === item.id ? { ...dataset, name: name.trim() } : dataset
        )
      }));
      return;
    }

    const item = project.figures.find(
      (figure) => figure.id === explorerSelection.id
    );
    if (!item) return;
    const name = window.prompt("重命名图形", item.name);
    if (!name?.trim()) return;
    patchProject((current) => ({
      ...current,
      figures: current.figures.map((figure) =>
        figure.id === item.id ? { ...figure, name: name.trim() } : figure
      )
    }));
  }

  function duplicateExplorerItem() {
    if (!explorerSelection) return;

    if (explorerSelection.type === "figure") {
      const item = project.figures.find(
        (figure) => figure.id === explorerSelection.id
      );
      if (!item) return;
      const duplicate: FigureSpec = {
        ...structuredClone(item),
        id: makeId("figure"),
        name: item.name + " 副本"
      };
      patchProject((current) => ({
        ...current,
        figures: [...current.figures, duplicate],
        activeFigureId: duplicate.id
      }));
      showToast("已复制图形");
      return;
    }

    if (explorerSelection.type === "dataset") {
      const item = project.datasets.find(
        (dataset) => dataset.id === explorerSelection.id
      );
      if (!item) return;
      const duplicate: Dataset = {
        ...structuredClone(item),
        id: makeId("dataset"),
        name: item.name + " 副本"
      };
      patchProject((current) => {
        const figure = makeFigure(
          duplicate,
          current,
          activeFigure?.folderId,
          "图 " + String(current.figures.length + 1)
        );
        return {
          ...current,
          datasets: [...current.datasets, duplicate],
          figures: [...current.figures, figure],
          activeFigureId: figure.id
        };
      });
      showToast("已复制数据并创建新图");
    }
  }

  function deleteExplorerItem() {
    if (!explorerSelection) return;

    if (explorerSelection.type === "folder") {
      const folder = project.folders.find(
        (item) => item.id === explorerSelection.id
      );
      if (!folder) return;
      if (!window.confirm("删除文件夹？其中内容会移动到上一级，不会删除数据或图形。"))
        return;

      patchProject((current) => ({
        ...current,
        folders: current.folders
          .filter((item) => item.id !== folder.id)
          .map((item) =>
            item.parentId === folder.id
              ? { ...item, parentId: folder.parentId }
              : item
          ),
        datasets: current.datasets.map((dataset) =>
          dataset.folderId === folder.id
            ? { ...dataset, folderId: folder.parentId }
            : dataset
        ),
        figures: current.figures.map((figure) =>
          figure.folderId === folder.id
            ? { ...figure, folderId: folder.parentId }
            : figure
        )
      }));
      setExplorerSelection(null);
      return;
    }

    if (explorerSelection.type === "figure") {
      const item = project.figures.find(
        (figure) => figure.id === explorerSelection.id
      );
      if (!item || project.figures.length <= 1) {
        showToast("项目至少保留一张图");
        return;
      }
      if (!window.confirm("删除图形“" + item.name + "”？")) return;
      patchProject((current) => {
        const figures = current.figures.filter(
          (figure) => figure.id !== item.id
        );
        return {
          ...current,
          figures,
          activeFigureId:
            current.activeFigureId === item.id
              ? figures[0]?.id ?? ""
              : current.activeFigureId
        };
      });
      return;
    }

    const item = project.datasets.find(
      (dataset) => dataset.id === explorerSelection.id
    );
    if (!item) return;
    const linked = project.figures.filter(
      (figure) => figure.datasetId === item.id
    );
    const message = linked.length
      ? "该数据被 " + linked.length + " 张图引用。删除数据会同时删除这些图形，是否继续？"
      : "删除数据“" + item.name + "”？";
    if (!window.confirm(message)) return;

    patchProject((current) => {
      const figures = current.figures.filter(
        (figure) => figure.datasetId !== item.id
      );
      if (!figures.length) return current;
      return {
        ...current,
        datasets: current.datasets.filter(
          (dataset) => dataset.id !== item.id
        ),
        figures,
        activeFigureId: figures.some(
          (figure) => figure.id === current.activeFigureId
        )
          ? current.activeFigureId
          : figures[0].id
      };
    });
  }

  function moveExplorerItem(
    type: "dataset" | "figure",
    id: string,
    folderId?: string
  ) {
    patchProject((current) => ({
      ...current,
      datasets:
        type === "dataset"
          ? current.datasets.map((dataset) =>
              dataset.id === id ? { ...dataset, folderId } : dataset
            )
          : current.datasets,
      figures:
        type === "figure"
          ? current.figures.map((figure) =>
              figure.id === id ? { ...figure, folderId } : figure
            )
          : current.figures
    }));
  }

  function saveDefault(scope: "project" | "user") {
    if (!activeFigure) return;
    const defaults = styleDefaultsFromFigure(activeFigure);

    if (scope === "user") {
      localStorage.setItem(USER_DEFAULTS_KEY, JSON.stringify(defaults));
      showToast("已保存为我的默认设置");
      return;
    }

    patchProject((current) => ({
      ...current,
      defaults
    }));
    showToast("已保存为本项目默认设置");
  }

  async function resetView() {
    if (!plotRef.current || !activeFigure) return;
    if (activeFigure.templateId === "surface-3d") {
      await Plotly.relayout(plotRef.current, {
        "scene.camera": {
          eye: { x: 1.45, y: 1.45, z: 1.12 }
        }
      });
    } else {
      await Plotly.relayout(plotRef.current, {
        "xaxis.autorange": true,
        "yaxis.autorange": true
      });
    }
  }

  async function exportFigure(format: "svg" | "png") {
    const node = plotRef.current as any;
    if (!node || !activeFigure) return;

    const dataUrl = await Plotly.toImage(node, {
      format,
      filename: activeFigure.name,
      width: layout.width,
      height: layout.height,
      scale: format === "png" ? PNG_SCALE : 1
    });

    downloadDataUrl(
      dataUrl,
      activeFigure.name.replace(/[\\/:*?"<>|]+/g, "-") +
        (format === "png" ? "-600dpi.png" : ".svg")
    );
    showToast(format === "png" ? "已导出 600 dpi PNG" : "已导出 SVG");
  }

  function currentItemFolderId(): string | undefined {
    if (!explorerSelection) return undefined;
    if (explorerSelection.type === "folder") return explorerSelection.id;
    if (explorerSelection.type === "dataset") {
      return project.datasets.find(
        (dataset) => dataset.id === explorerSelection.id
      )?.folderId;
    }
    return project.figures.find(
      (figure) => figure.id === explorerSelection.id
    )?.folderId;
  }

  function renderExplorerFolder(
    folder: ProjectFolder,
    depth: number
  ): ReactNode {
    const open = expandedFolders.has(folder.id);
    const childFolders = project.folders.filter(
      (item) => item.parentId === folder.id
    );
    const datasets = project.datasets.filter(
      (item) => item.folderId === folder.id
    );
    const figures = project.figures.filter(
      (item) => item.folderId === folder.id
    );
    const selected =
      explorerSelection?.type === "folder" &&
      explorerSelection.id === folder.id;

    return (
      <div key={folder.id}>
        <button
          type="button"
          className={selected ? "explorer-row is-selected folder-row" : "explorer-row folder-row"}
          style={{ paddingLeft: 7 + depth * 14 }}
          onClick={() => setExplorerSelection({ type: "folder", id: folder.id })}
          onDoubleClick={() =>
            setExpandedFolders((current) => {
              const next = new Set(current);
              if (next.has(folder.id)) next.delete(folder.id);
              else next.add(folder.id);
              return next;
            })
          }
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const value = event.dataTransfer.getData("text/plain");
            const [type, id] = value.split(":");
            if (type === "dataset" || type === "figure") {
              moveExplorerItem(type, id, folder.id);
            }
          }}
        >
          <span
            className="folder-chevron"
            onClick={(event) => {
              event.stopPropagation();
              setExpandedFolders((current) => {
                const next = new Set(current);
                if (next.has(folder.id)) next.delete(folder.id);
                else next.add(folder.id);
                return next;
              });
            }}
          >
            {open ? "⌄" : "›"}
          </span>
          <span className="tree-symbol">▱</span>
          <span className="tree-label">{folder.name}</span>
        </button>

        {open && (
          <>
            {childFolders.map((child) =>
              renderExplorerFolder(child, depth + 1)
            )}
            {datasets.map((dataset) => (
              <button
                key={dataset.id}
                type="button"
                draggable
                className={
                  explorerSelection?.type === "dataset" &&
                  explorerSelection.id === dataset.id
                    ? "explorer-row is-selected"
                    : "explorer-row"
                }
                style={{ paddingLeft: 31 + depth * 14 }}
                onDragStart={(event) =>
                  event.dataTransfer.setData(
                    "text/plain",
                    "dataset:" + dataset.id
                  )
                }
                onClick={() => {
                  setExplorerSelection({ type: "dataset", id: dataset.id });
                  const linked = project.figures.find(
                    (figure) => figure.datasetId === dataset.id
                  );
                  if (linked) activateFigure(linked.id);
                }}
              >
                <span className="tree-symbol">▦</span>
                <span className="tree-label">{dataset.name}</span>
              </button>
            ))}
            {figures.map((figure) => (
              <button
                key={figure.id}
                type="button"
                draggable
                className={
                  figure.id === activeFigure.id
                    ? "explorer-row is-active"
                    : explorerSelection?.type === "figure" &&
                      explorerSelection.id === figure.id
                    ? "explorer-row is-selected"
                    : "explorer-row"
                }
                style={{ paddingLeft: 31 + depth * 14 }}
                onDragStart={(event) =>
                  event.dataTransfer.setData(
                    "text/plain",
                    "figure:" + figure.id
                  )
                }
                onClick={() => {
                  setExplorerSelection({ type: "figure", id: figure.id });
                  activateFigure(figure.id);
                }}
              >
                <span className="tree-symbol">▧</span>
                <span className="tree-label">{figure.name}</span>
              </button>
            ))}
          </>
        )}
      </div>
    );
  }

  if (!activeFigure || !activeDataset) {
    return <div className="fatal-state">项目中没有可显示的图形。</div>;
  }

  const lineWidth = primaryOverride.lineWidthPt ?? preset.lineWidthPt;
  const lineStyle = primaryOverride.lineStyle ?? "solid";
  const lineVisible = primaryOverride.lineVisible ?? true;
  const markerVisible =
    primaryOverride.markerVisible ??
    (activeFigure.templateId === "xy-scatter" ||
      activeFigure.templateId === "xy-line-marker" ||
      activeFigure.templateId === "xy-errorbar");
  const markerSymbol = primaryOverride.markerSymbol ?? "circle";
  const markerSize = primaryOverride.markerSizePt ?? preset.markerSizePt;
  const opacity = primaryOverride.opacity ?? 1;
  const primaryIndex = primarySeries
    ? Math.max(
        0,
        activeDataset.ys.findIndex((series) => series.id === primarySeries.id)
      )
    : 0;
  const selectedColor =
    primaryOverride.color ||
    preset.palette[primaryIndex % preset.palette.length];
  const visible = primaryOverride.visible ?? true;

  const layerIndex = primarySeries
    ? activeFigure.seriesOrder.indexOf(primarySeries.id)
    : -1;
  const isTopLayer = layerIndex === activeFigure.seriesOrder.length - 1;
  const isBottomLayer = layerIndex <= 0;

  const scaledWidth = Math.max(1, Number(layout.width) * previewScale);
  const scaledHeight = Math.max(1, Number(layout.height) * previewScale);
  const fieldTemplate =
    activeFigure.templateId === "heatmap" ||
    activeFigure.templateId === "surface-3d";
  const barTemplate =
    activeFigure.templateId === "bar" ||
    activeFigure.templateId === "grouped-bar" ||
    activeFigure.templateId === "stacked-bar";

  const rootFolders = project.folders.filter((folder) => !folder.parentId);
  const rootDatasets = project.datasets.filter((dataset) => !dataset.folderId);
  const rootFigures = project.figures.filter((figure) => !figure.folderId);

  const oldPreviewPath = sparkPath(
    activeDataset.ys[0]?.values ?? [],
    420,
    120
  );
  const newPreviewPath = sparkPath(
    pendingReplacement?.ys[0]?.values ?? [],
    420,
    120
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-group">
          <div className="brand-mark">F</div>
          <div className="brand-title">FigureStudio</div>
        </div>

        <div className="top-file-actions">
          <button type="button" onClick={newProject}>新建</button>
          <button type="button" onClick={() => projectInputRef.current?.click()}>打开</button>
          <button type="button" onClick={saveProject}>保存</button>
          <span className="toolbar-divider" />
          <button type="button" disabled={!history.canUndo} onClick={history.undo}>撤销</button>
          <button type="button" disabled={!history.canRedo} onClick={history.redo}>重做</button>
        </div>

        <div className="top-actions">
          <label className="ui-scale-control">
            <span>界面</span>
            <select
              value={uiScale}
              onChange={(event) => setUiScale(Number(event.target.value))}
            >
              <option value={0.9}>90%</option>
              <option value={1}>100%</option>
              <option value={1.1}>110%</option>
              <option value={1.25}>125%</option>
              <option value={1.4}>140%</option>
            </select>
          </label>
          <input
            ref={projectInputRef}
            className="hidden-input"
            type="file"
            accept=".sfig,application/octet-stream"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void openProject(file);
            }}
          />
          <input
            ref={dataInputRef}
            className="hidden-input"
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleDataFile(file);
            }}
          />
          <button className="quiet-button" type="button" onClick={restoreAutosave}>恢复</button>
          <button className="quiet-button" type="button" onClick={() => setPasteOpen(true)}>粘贴</button>
          <button className="quiet-button" type="button" onClick={() => triggerDataFile("replace")}>替换</button>
          <button className="primary-button" type="button" onClick={() => triggerDataFile("add")}>导入数据</button>
        </div>
      </header>

      <main className="workspace">
        <aside className="left-panel">
          <div className="panel-heading">
            <input
              className="project-name-input"
              value={project.name}
              aria-label="项目名称"
              onChange={(event) =>
                patchProject((current) => ({
                  ...current,
                  name: event.target.value
                }))
              }
            />
          </div>

          <div className="explorer-toolbar">
            <button type="button" onClick={createFolder} title="新建文件夹">＋</button>
            <button
              type="button"
              onClick={() => setExplorerView((value) => value === "list" ? "thumb" : "list")}
              title="列表 / 缩略图"
            >
              {explorerView === "list" ? "▦" : "☷"}
            </button>
            <span />
            <button type="button" disabled={!explorerSelection} onClick={renameExplorerItem} title="重命名">✎</button>
            <button
              type="button"
              disabled={!explorerSelection || explorerSelection.type === "folder"}
              onClick={duplicateExplorerItem}
              title="复制"
            >
              ⧉
            </button>
            <button type="button" disabled={!explorerSelection} onClick={deleteExplorerItem} title="删除">⌫</button>
          </div>

          <div className="left-scroll">
            {explorerView === "list" ? (
              <div
                className="project-tree"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  const target = event.target as Element;
                  if (target.closest(".folder-row")) return;
                  const value = event.dataTransfer.getData("text/plain");
                  const [type, id] = value.split(":");
                  if (type === "dataset" || type === "figure") {
                    moveExplorerItem(type, id, undefined);
                  }
                }}
              >
                {rootFolders.map((folder) => renderExplorerFolder(folder, 0))}
                {rootDatasets.map((dataset) => (
                  <button
                    key={dataset.id}
                    type="button"
                    draggable
                    className="explorer-row"
                    onDragStart={(event) =>
                      event.dataTransfer.setData("text/plain", "dataset:" + dataset.id)
                    }
                    onClick={() => setExplorerSelection({ type: "dataset", id: dataset.id })}
                  >
                    <span className="tree-symbol">▦</span>
                    <span className="tree-label">{dataset.name}</span>
                  </button>
                ))}
                {rootFigures.map((figure) => (
                  <button
                    key={figure.id}
                    type="button"
                    draggable
                    className={figure.id === activeFigure.id ? "explorer-row is-active" : "explorer-row"}
                    onDragStart={(event) =>
                      event.dataTransfer.setData("text/plain", "figure:" + figure.id)
                    }
                    onClick={() => activateFigure(figure.id)}
                  >
                    <span className="tree-symbol">▧</span>
                    <span className="tree-label">{figure.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="thumbnail-grid">
                {project.figures.map((figure) => {
                  const dataset = project.datasets.find((item) => item.id === figure.datasetId);
                  const itemPreset = presets[figure.presetId];
                  return (
                    <button
                      key={figure.id}
                      type="button"
                      className={figure.id === activeFigure.id ? "thumbnail-card is-active" : "thumbnail-card"}
                      onClick={() => {
                        setExplorerSelection({ type: "figure", id: figure.id });
                        activateFigure(figure.id);
                      }}
                    >
                      <img
                        src={figureThumbnailDataUrl(dataset, figure, itemPreset)}
                        alt=""
                      />
                      <span>{figure.name}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {!fieldTemplate && (
              <div className="series-panel">
                <div className="series-panel-title">
                  <span>曲线</span>
                  <small>{selectedIds.length > 1 ? selectedIds.length + " 条已选" : "Ctrl 多选 · 拖动排序"}</small>
                </div>
                {[...orderedSeries].reverse().map((series) => {
                  const sourceIndex = Math.max(
                    0,
                    activeDataset.ys.findIndex((item) => item.id === series.id)
                  );
                  const override = activeFigure.seriesOverrides[series.id] || {};
                  const color =
                    override.color ||
                    preset.palette[sourceIndex % preset.palette.length];
                  const selected = selectedIds.includes(series.id);

                  return (
                    <button
                      key={series.id}
                      type="button"
                      draggable
                      className={selected ? "series-row series-selected" : "series-row"}
                      onDragStart={(event) =>
                        event.dataTransfer.setData("text/plain", "series:" + series.id)
                      }
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const value = event.dataTransfer.getData("text/plain");
                        const [type, id] = value.split(":");
                        if (type === "series") reorderSeries(id, series.id);
                      }}
                      onClick={(event) =>
                        selectSeries(series.id, event.ctrlKey || event.metaKey)
                      }
                    >
                      <span
                        className="series-color"
                        style={{
                          backgroundColor: color,
                          opacity: override.visible === false ? 0.25 : 1
                        }}
                      />
                      <span className="series-name">{series.name}</span>
                      <span className="drag-handle">⋮⋮</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <section className="center-panel">
          <div className="figure-toolbar">
            <div className="toolbar-selects">
              <label>
                <span>图型</span>
                <select
                  value={activeFigure.templateId}
                  onChange={(event) =>
                    patchActiveFigure((figure) => ({
                      ...figure,
                      templateId: event.target.value as PlotTemplateId
                    }))
                  }
                >
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>样式</span>
                <select
                  value={activeFigure.presetId}
                  onChange={(event) =>
                    patchActiveFigure((figure) => ({
                      ...figure,
                      presetId: event.target.value as PresetId
                    }))
                  }
                >
                  {presetOrder.map((id) => (
                    <option key={id} value={id}>
                      {presets[id].label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="figure-actions">
              <button type="button" onClick={() => void resetView()}>重置</button>
              <button type="button" onClick={() => void exportFigure("svg")}>SVG</button>
              <button type="button" onClick={() => void exportFigure("png")}>PNG</button>
              <button
                type="button"
                onClick={() => downloadMatplotlibScript(activeDataset, activeFigure, preset)}
              >
                Python
              </button>
            </div>
          </div>

          <div ref={canvasRef} className="canvas-area">
            <div
              className="scaled-paper-shell"
              style={{
                width: scaledWidth + "px",
                height: scaledHeight + "px"
              }}
            >
              <div
                className="figure-paper"
                style={{
                  width: layout.width + "px",
                  height: layout.height + "px",
                  transform: "scale(" + previewScale + ")"
                }}
              >
                <div
                  ref={plotRef}
                  className="plot-host"
                  style={{
                    width: layout.width + "px",
                    height: layout.height + "px"
                  }}
                />
              </div>
            </div>
          </div>
        </section>

        <aside className="right-panel">
          <div className="inspector-tabs">
            {([
              ["figure", "图"],
              ["series", "曲线"],
              ["axis", "轴"],
              ["legend", "图例"],
              ["check", warningCount ? "检查 " + warningCount : "检查"]
            ] as Array<[InspectorTab, string]>).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={inspectorTab === id ? "is-active" : ""}
                disabled={id === "series" && fieldTemplate}
                onClick={() => setInspectorTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="inspector-scroll">
            {inspectorTab === "figure" && (
              <section className="inspector-pane">
                <div className="pane-heading">
                  <strong>图形</strong>
                  <span>
                    <button type="button" onClick={() => saveDefault("project")}>项目默认</button>
                    <button type="button" onClick={() => saveDefault("user")}>我的默认</button>
                  </span>
                </div>

                <div className="prop-row">
                  <label>比例</label>
                  <select
                    value={aspectMode}
                    onChange={(event) =>
                      setFigureField("aspectMode", event.target.value as AspectMode)
                    }
                  >
                    <option value="16:9">16 : 9</option>
                    <option value="4:3">4 : 3</option>
                    <option value="3:2">3 : 2</option>
                    <option value="custom">自定义</option>
                  </select>
                </div>

                {aspectMode === "custom" && (
                  <div className="prop-row">
                    <label>自定义</label>
                    <div className="ratio-pair">
                      <input
                        type="number"
                        min="1"
                        step="0.1"
                        value={activeFigure.figureOverrides.customAspectWidth ?? 4}
                        onChange={(event) =>
                          setFigureField("customAspectWidth", Number(event.target.value))
                        }
                      />
                      <span>:</span>
                      <input
                        type="number"
                        min="1"
                        step="0.1"
                        value={activeFigure.figureOverrides.customAspectHeight ?? 3}
                        onChange={(event) =>
                          setFigureField("customAspectHeight", Number(event.target.value))
                        }
                      />
                    </div>
                  </div>
                )}

                <div className="prop-row">
                  <label>字体</label>
                  <div className="control-with-reset">
                    <select
                      value={effectiveFontFamily}
                      onChange={(event) =>
                        setFigureField(
                          "fontFamily",
                          event.target.value as "Arial" | "Times New Roman"
                        )
                      }
                    >
                      <option>Arial</option>
                      <option>Times New Roman</option>
                    </select>
                    <ResetIcon
                      visible={activeFigure.figureOverrides.fontFamily !== undefined}
                      onReset={() => resetFigureField("fontFamily")}
                    />
                  </div>
                </div>

                <div className="prop-row">
                  <label>字号</label>
                  <div className="control-with-reset">
                    <div className="compact-number">
                      <input
                        type="number"
                        min="5"
                        max="18"
                        step="0.25"
                        value={effectiveFontSizePt}
                        onChange={(event) =>
                          setFigureField("fontSizePt", Number(event.target.value))
                        }
                      />
                      <span>pt</span>
                    </div>
                    <ResetIcon
                      visible={activeFigure.figureOverrides.fontSizePt !== undefined}
                      onReset={() => resetFigureField("fontSizePt")}
                    />
                  </div>
                </div>

                <div className="prop-row">
                  <label>背景</label>
                  <div className="control-with-reset color-control">
                    <input
                      type="color"
                      value={activeFigure.figureOverrides.background ?? "#ffffff"}
                      onChange={(event) =>
                        setFigureField("background", event.target.value)
                      }
                    />
                    <span>{activeFigure.figureOverrides.background?.toUpperCase() ?? "#FFFFFF"}</span>
                    <ResetIcon
                      visible={activeFigure.figureOverrides.background !== undefined}
                      onReset={() => resetFigureField("background")}
                    />
                  </div>
                </div>

                <div className="prop-row prop-muted">
                  <label>尺寸</label>
                  <span>
                    {canvasMm.widthMm.toFixed(0)} × {canvasMm.heightMm.toFixed(1)} mm
                  </span>
                </div>

                {(activeFigure.templateId === "xy-errorbar" ||
                  activeFigure.templateId === "offset-spectrum" ||
                  fieldTemplate) && (
                  <>
                    <div className="section-divider">图型参数</div>

                    {activeFigure.templateId === "xy-errorbar" && (
                      <div className="prop-row">
                        <label>误差列</label>
                        <select
                          value={activeFigure.figureOverrides.errorSeriesId ?? ""}
                          onChange={(event) =>
                            setFigureField(
                              "errorSeriesId",
                              event.target.value || undefined
                            )
                          }
                        >
                          <option value="">无</option>
                          {activeDataset.ys.map((series) => (
                            <option key={series.id} value={series.id}>
                              {series.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {activeFigure.templateId === "offset-spectrum" && (
                      <div className="prop-row">
                        <label>层间偏移</label>
                        <div className="compact-number">
                          <input
                            type="number"
                            step="0.5"
                            value={activeFigure.figureOverrides.offsetStep ?? 5}
                            onChange={(event) =>
                              setFigureField("offsetStep", Number(event.target.value))
                            }
                          />
                          <span>Y</span>
                        </div>
                      </div>
                    )}

                    {fieldTemplate && (
                      <>
                        <div className="prop-row">
                          <label>色图</label>
                          <select
                            value={activeFigure.figureOverrides.colorScale ?? "Viridis"}
                            onChange={(event) =>
                              setFigureField(
                                "colorScale",
                                event.target.value as ColorScaleId
                              )
                            }
                          >
                            <option>Viridis</option>
                            <option>Cividis</option>
                            <option>Magma</option>
                            <option>Inferno</option>
                            <option value="RdBu">RdBu</option>
                            <option>Greys</option>
                          </select>
                        </div>
                        <div className="prop-row">
                          <label>反转色图</label>
                          <MiniSwitch
                            checked={activeFigure.figureOverrides.reverseColorScale ?? false}
                            onChange={(value) =>
                              setFigureField("reverseColorScale", value)
                            }
                          />
                        </div>
                      </>
                    )}
                  </>
                )}
              </section>
            )}

            {inspectorTab === "series" && !fieldTemplate && primarySeries && (
              <section className="inspector-pane">
                <div className="pane-heading">
                  <strong>
                    {selectedIds.length > 1
                      ? selectedIds.length + " 条曲线"
                      : primarySeries.name}
                  </strong>
                  <span>Ctrl / ⌘ 多选</span>
                </div>

                <div className="prop-row">
                  <label>显示</label>
                  <MiniSwitch
                    checked={visible}
                    onChange={(value) => updateSelectedSeries({ visible: value })}
                  />
                </div>

                {!barTemplate && (
                  <>
                    <div className="prop-row">
                      <label>线条</label>
                      <MiniSwitch
                        checked={lineVisible}
                        onChange={(value) =>
                          updateSelectedSeries({ lineVisible: value })
                        }
                      />
                    </div>

                    <div className="prop-row">
                      <label>线型</label>
                      <select
                        value={lineStyle}
                        onChange={(event) =>
                          updateSelectedSeries({
                            lineStyle: event.target.value as LineStyle
                          })
                        }
                      >
                        <option value="solid">实线</option>
                        <option value="dash">虚线</option>
                        <option value="dot">点线</option>
                        <option value="dashdot">点划线</option>
                      </select>
                    </div>

                    <div className="prop-row">
                      <label>线宽</label>
                      <div className="control-with-reset">
                        <div className="compact-number">
                          <input
                            type="number"
                            min="0.3"
                            max="6"
                            step="0.05"
                            value={lineWidth}
                            onChange={(event) =>
                              updateSelectedSeries({
                                lineWidthPt: Number(event.target.value)
                              })
                            }
                          />
                          <span>pt</span>
                        </div>
                        <ResetIcon
                          visible={primaryOverride.lineWidthPt !== undefined}
                          onReset={() => resetSelectedSeriesField("lineWidthPt")}
                        />
                      </div>
                    </div>

                    <div className="prop-row">
                      <label>数据点</label>
                      <select
                        value={markerVisible ? markerSymbol : "none"}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (value === "none") {
                            updateSelectedSeries({ markerVisible: false });
                          } else {
                            updateSelectedSeries({
                              markerVisible: true,
                              markerSymbol: value as MarkerSymbol
                            });
                          }
                        }}
                      >
                        <option value="none">无</option>
                        <option value="circle">圆点</option>
                        <option value="square">方形</option>
                        <option value="diamond">菱形</option>
                        <option value="triangle-up">上三角</option>
                        <option value="triangle-down">下三角</option>
                        <option value="cross">十字</option>
                        <option value="x">X</option>
                      </select>
                    </div>

                    <div className="prop-row">
                      <label>点大小</label>
                      <div className="control-with-reset">
                        <div className="compact-number">
                          <input
                            type="number"
                            min="1"
                            max="16"
                            step="0.25"
                            value={markerSize}
                            disabled={!markerVisible}
                            onChange={(event) =>
                              updateSelectedSeries({
                                markerSizePt: Number(event.target.value)
                              })
                            }
                          />
                          <span>pt</span>
                        </div>
                        <ResetIcon
                          visible={primaryOverride.markerSizePt !== undefined}
                          onReset={() => resetSelectedSeriesField("markerSizePt")}
                        />
                      </div>
                    </div>
                  </>
                )}

                <div className="prop-row">
                  <label>透明度</label>
                  <div className="control-with-reset">
                    <div className="compact-number">
                      <input
                        type="number"
                        min="5"
                        max="100"
                        step="5"
                        value={Math.round(opacity * 100)}
                        onChange={(event) =>
                          updateSelectedSeries({
                            opacity: Number(event.target.value) / 100
                          })
                        }
                      />
                      <span>%</span>
                    </div>
                    <ResetIcon
                      visible={primaryOverride.opacity !== undefined}
                      onReset={() => resetSelectedSeriesField("opacity")}
                    />
                  </div>
                </div>

                <div className="prop-row">
                  <label>颜色</label>
                  <div className="control-with-reset color-control">
                    <input
                      type="color"
                      value={selectedColor}
                      onChange={(event) =>
                        updateSelectedSeries({ color: event.target.value })
                      }
                    />
                    <span>{selectedColor.toUpperCase()}</span>
                    <ResetIcon
                      visible={primaryOverride.color !== undefined}
                      onReset={() => resetSelectedSeriesField("color")}
                    />
                  </div>
                </div>

                <div className="prop-row">
                  <label>图层</label>
                  <div className="layer-inline">
                    <button
                      type="button"
                      disabled={isBottomLayer}
                      onClick={() => moveSelectedSeries("down")}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      disabled={isTopLayer}
                      onClick={() => moveSelectedSeries("up")}
                    >
                      ↑
                    </button>
                  </div>
                </div>
              </section>
            )}

            {inspectorTab === "axis" && (
              <section className="inspector-pane">
                <div className="pane-heading">
                  <strong>坐标轴</strong>
                  <span>点击图中坐标轴可直接进入</span>
                </div>

                <div className="prop-row">
                  <label>X 标题</label>
                  <input
                    type="text"
                    value={
                      activeFigure.figureOverrides.xTitle ??
                      axisLabel(activeDataset.x.name, activeDataset.x.unit)
                    }
                    onChange={(event) =>
                      setFigureField("xTitle", event.target.value)
                    }
                  />
                </div>

                <div className="prop-row">
                  <label>Y 标题</label>
                  <input
                    type="text"
                    value={
                      activeFigure.figureOverrides.yTitle ??
                      axisLabel(
                        fieldTemplate
                          ? activeDataset.metadata?.rowAxisName ?? "Y"
                          : activeDataset.ys[0]?.name ?? "Y",
                        fieldTemplate
                          ? activeDataset.metadata?.rowAxisUnit
                          : activeDataset.ys[0]?.unit
                      )
                    }
                    onChange={(event) =>
                      setFigureField("yTitle", event.target.value)
                    }
                  />
                </div>

                {!fieldTemplate && (
                  <>
                    <div className="prop-row">
                      <label>X 标度</label>
                      <select
                        value={activeFigure.figureOverrides.xScale ?? "linear"}
                        onChange={(event) =>
                          setFigureField("xScale", event.target.value as AxisScale)
                        }
                      >
                        <option value="linear">线性</option>
                        <option value="log">对数</option>
                      </select>
                    </div>

                    <div className="prop-row">
                      <label>Y 标度</label>
                      <select
                        value={activeFigure.figureOverrides.yScale ?? "linear"}
                        onChange={(event) =>
                          setFigureField("yScale", event.target.value as AxisScale)
                        }
                      >
                        <option value="linear">线性</option>
                        <option value="log">对数</option>
                      </select>
                    </div>

                    <div className="prop-row">
                      <label>X 范围</label>
                      <div className="range-control">
                        <MiniSwitch
                          checked={activeFigure.figureOverrides.xAutoRange !== false}
                          onChange={(value) => setFigureField("xAutoRange", value)}
                        />
                        <input
                          type="number"
                          placeholder="min"
                          disabled={activeFigure.figureOverrides.xAutoRange !== false}
                          value={activeFigure.figureOverrides.xMin ?? ""}
                          onChange={(event) =>
                            setFigureField(
                              "xMin",
                              event.target.value === "" ? undefined : Number(event.target.value)
                            )
                          }
                        />
                        <input
                          type="number"
                          placeholder="max"
                          disabled={activeFigure.figureOverrides.xAutoRange !== false}
                          value={activeFigure.figureOverrides.xMax ?? ""}
                          onChange={(event) =>
                            setFigureField(
                              "xMax",
                              event.target.value === "" ? undefined : Number(event.target.value)
                            )
                          }
                        />
                      </div>
                    </div>

                    <div className="prop-row">
                      <label>Y 范围</label>
                      <div className="range-control">
                        <MiniSwitch
                          checked={activeFigure.figureOverrides.yAutoRange !== false}
                          onChange={(value) => setFigureField("yAutoRange", value)}
                        />
                        <input
                          type="number"
                          placeholder="min"
                          disabled={activeFigure.figureOverrides.yAutoRange !== false}
                          value={activeFigure.figureOverrides.yMin ?? ""}
                          onChange={(event) =>
                            setFigureField(
                              "yMin",
                              event.target.value === "" ? undefined : Number(event.target.value)
                            )
                          }
                        />
                        <input
                          type="number"
                          placeholder="max"
                          disabled={activeFigure.figureOverrides.yAutoRange !== false}
                          value={activeFigure.figureOverrides.yMax ?? ""}
                          onChange={(event) =>
                            setFigureField(
                              "yMax",
                              event.target.value === "" ? undefined : Number(event.target.value)
                            )
                          }
                        />
                      </div>
                    </div>
                  </>
                )}

                <div className="prop-row">
                  <label>刻度方向</label>
                  <select
                    value={activeFigure.figureOverrides.tickDirection ?? "inside"}
                    onChange={(event) =>
                      setFigureField(
                        "tickDirection",
                        event.target.value as TickDirection
                      )
                    }
                  >
                    <option value="inside">向内</option>
                    <option value="outside">向外</option>
                  </select>
                </div>

                <div className="prop-row">
                  <label>次刻度</label>
                  <MiniSwitch
                    checked={activeFigure.figureOverrides.minorTicks ?? false}
                    onChange={(value) => setFigureField("minorTicks", value)}
                  />
                </div>

                <div className="prop-row">
                  <label>网格</label>
                  <MiniSwitch
                    checked={
                      activeFigure.figureOverrides.gridVisible ??
                      preset.showGrid
                    }
                    onChange={(value) => setFigureField("gridVisible", value)}
                  />
                </div>
              </section>
            )}

            {inspectorTab === "legend" && (
              <section className="inspector-pane">
                <div className="pane-heading">
                  <strong>图例</strong>
                  <span>点击图例可直接进入</span>
                </div>

                <div className="prop-row">
                  <label>显示</label>
                  <MiniSwitch
                    checked={effectiveLegendVisible}
                    onChange={(value) => setFigureField("legendVisible", value)}
                  />
                </div>

                <div className="prop-row">
                  <label>位置</label>
                  <select
                    value={
                      activeFigure.figureOverrides.legendPosition ?? "top-left"
                    }
                    onChange={(event) =>
                      setFigureField(
                        "legendPosition",
                        event.target.value as LegendPosition
                      )
                    }
                  >
                    <option value="top-left">左上</option>
                    <option value="top-center">上中</option>
                    <option value="top-right">右上</option>
                    <option value="bottom-left">左下</option>
                    <option value="bottom-center">下中</option>
                    <option value="bottom-right">右下</option>
                  </select>
                </div>

                <div className="prop-row">
                  <label>方向</label>
                  <select
                    value={
                      activeFigure.figureOverrides.legendOrientation ??
                      "horizontal"
                    }
                    onChange={(event) =>
                      setFigureField(
                        "legendOrientation",
                        event.target.value as LegendOrientation
                      )
                    }
                  >
                    <option value="horizontal">横向</option>
                    <option value="vertical">纵向</option>
                  </select>
                </div>

                <div className="prop-row">
                  <label>列数</label>
                  <input
                    type="number"
                    min="1"
                    max="6"
                    step="1"
                    value={activeFigure.figureOverrides.legendColumns ?? 1}
                    onChange={(event) =>
                      setFigureField(
                        "legendColumns",
                        Math.max(1, Number(event.target.value))
                      )
                    }
                  />
                </div>

                <div className="prop-row">
                  <label>边框</label>
                  <MiniSwitch
                    checked={activeFigure.figureOverrides.legendFrame ?? false}
                    onChange={(value) => setFigureField("legendFrame", value)}
                  />
                </div>
              </section>
            )}

            {inspectorTab === "check" && (
              <section className="inspector-pane checker-pane">
                <div className="pane-heading">
                  <strong>出版检查</strong>
                  <span>{warningCount ? warningCount + " 项需要确认" : "未发现明显问题"}</span>
                </div>

                <div className="checker-list">
                  {checkItems.map((item) => (
                    <div className={"check-item " + item.level} key={item.id}>
                      <span className="check-icon">
                        {item.level === "pass" ? "✓" : item.level === "warn" ? "!" : "i"}
                      </span>
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </aside>
      </main>

      {pasteOpen && (
        <div className="modal-backdrop" onMouseDown={() => setPasteOpen(false)}>
          <div className="paste-dialog" onMouseDown={(event) => event.stopPropagation()}>
            <div className="dialog-title">粘贴数据</div>
            <textarea
              autoFocus
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder={"Wavelength (nm),Power (dBm)\n1030,-52.1\n1031,-51.8"}
            />
            <div className="dialog-actions">
              <button type="button" onClick={() => setPasteOpen(false)}>取消</button>
              <button className="primary-button" type="button" onClick={importPastedData}>导入</button>
            </div>
          </div>
        </div>
      )}

      {pendingReplacement && (
        <div className="modal-backdrop" onMouseDown={() => setPendingReplacement(null)}>
          <div className="replace-dialog" onMouseDown={(event) => event.stopPropagation()}>
            <div className="dialog-title">替换数据预览</div>
            <div className="replace-summary">
              <div>
                <strong>当前数据</strong>
                <span>{activeDataset.name}</span>
                <small>{activeDataset.x.values.length} 行 · {activeDataset.ys.length} 个 Y</small>
              </div>
              <div className="replace-arrow">→</div>
              <div>
                <strong>新数据</strong>
                <span>{pendingReplacement.name}</span>
                <small>{pendingReplacement.x.values.length} 行 · {pendingReplacement.ys.length} 个 Y</small>
              </div>
            </div>
            <div className="diff-preview">
              <div className="diff-legend">
                <span><i className="old-line" />旧数据</span>
                <span><i className="new-line" />新数据</span>
              </div>
              <svg viewBox="0 0 420 120" preserveAspectRatio="none">
                <path d={oldPreviewPath} className="old-path" />
                <path d={newPreviewPath} className="new-path" />
              </svg>
            </div>
            <div className="dialog-actions">
              <button type="button" onClick={() => setPendingReplacement(null)}>取消</button>
              <button className="primary-button" type="button" onClick={acceptReplacement}>确认替换</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default App;
