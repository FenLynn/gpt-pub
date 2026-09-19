import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import { createInitialProject } from "./data/demo";
import { useHistoryState } from "./hooks/useHistoryState";
import { parseDelimitedText } from "./lib/csv";
import type {
  AspectMode,
  AxisScale,
  ColorScaleId,
  Dataset,
  FigureOverrides,
  FigureSpec,
  LegendOrientation,
  LegendPosition,
  LineStyle,
  MarkerSymbol,
  PlotTemplateId,
  PresetId,
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
import {
  downloadProject,
  readProjectFile
} from "./project/projectIO";

const AUTOSAVE_KEY = "figurestudio-p108-autosave-v01";
const USER_DEFAULTS_KEY = "figurestudio-p108-user-defaults-v01";
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

function makeFigure(
  dataset: Dataset,
  project: ProjectState,
  name?: string
): FigureSpec {
  return {
    id: makeId("figure"),
    name: name ?? "图 " + String(project.figures.length + 1),
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

  const [selectedSeriesId, setSelectedSeriesId] = useState("");
  const [previewScale, setPreviewScale] = useState(1);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [toast, setToast] = useState("");

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

  const selectedSeries =
    activeDataset?.ys.find((series) => series.id === selectedSeriesId) ??
    orderedSeries[0];

  const selectedOverride =
    selectedSeries && activeFigure
      ? activeFigure.seriesOverrides[selectedSeries.id] || {}
      : {};

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

  useEffect(() => {
    if (!selectedSeries || !activeDataset?.ys.some((item) => item.id === selectedSeriesId)) {
      setSelectedSeriesId(orderedSeries[0]?.id || "");
    }
  }, [activeDataset, orderedSeries, selectedSeries, selectedSeriesId]);

  useEffect(() => {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
  }, [project]);

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
      const availableWidth = Math.max(160, rect.width - 28);
      const availableHeight = Math.max(160, rect.height - 28);
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

  useEffect(() => {
    const node = plotRef.current as any;
    if (!node || !activeFigure) return;

    const config = {
      responsive: false,
      displaylogo: false,
      displayModeBar: false,
      scrollZoom: activeFigure.templateId !== "surface-3d"
    };

    let cancelled = false;

    Plotly.react(node, traces, layout, config).then(() => {
      if (cancelled) return;
      node.removeAllListeners?.("plotly_click");
      node.on?.("plotly_click", (event: any) => {
        const index = event?.points?.[0]?.curveNumber;
        const series =
          typeof index === "number" ? orderedSeries[index] : undefined;
        if (series) setSelectedSeriesId(series.id);
      });
    });

    return () => {
      cancelled = true;
      node.removeAllListeners?.("plotly_click");
    };
  }, [activeFigure, layout, orderedSeries, traces]);

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

  function updateSeriesOverride(patch: SeriesOverride) {
    if (!selectedSeries) return;
    patchActiveFigure((figure) => ({
      ...figure,
      seriesOverrides: {
        ...figure.seriesOverrides,
        [selectedSeries.id]: {
          ...(figure.seriesOverrides[selectedSeries.id] || {}),
          ...patch
        }
      }
    }));
  }

  function resetSeriesField(field: keyof SeriesOverride) {
    if (!selectedSeries) return;
    patchActiveFigure((figure) => {
      const next = { ...figure.seriesOverrides };
      const series = { ...(next[selectedSeries.id] || {}) };
      delete series[field];
      if (Object.keys(series).length === 0) {
        delete next[selectedSeries.id];
      } else {
        next[selectedSeries.id] = series;
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

  function moveSelectedSeries(direction: "up" | "down") {
    if (!selectedSeries || !activeDataset || !activeFigure) return;

    patchActiveFigure((figure) => {
      const normalized = orderSeries(activeDataset, figure.seriesOrder).map(
        (series) => series.id
      );
      const index = normalized.indexOf(selectedSeries.id);
      if (index < 0) return figure;

      const target =
        direction === "up"
          ? Math.min(normalized.length - 1, index + 1)
          : Math.max(0, index - 1);

      if (target === index) return figure;

      const next = [...normalized];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...figure, seriesOrder: next };
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
      if (recovered.format !== "sfig" || recovered.schemaVersion !== "0.1") {
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
        "新数据的列名与原数据不完全一致。是否按列顺序重新映射所有关联图？"
      );
      if (!proceed) return null;

      const count = Math.min(oldDataset.ys.length, replacement.ys.length);
      for (let index = 0; index < count; index += 1) {
        mapping.set(oldDataset.ys[index].id, replacement.ys[index].id);
      }
    }

    const stableDataset: Dataset = {
      ...replacement,
      id: oldDataset.id
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
        patchProject((current) => {
          const next = reconcileReplace(current, activeDataset.id, parsed);
          return next ?? current;
        });
        showToast("数据已替换，关联图保持不变");
      } else {
        patchProject((current) => {
          const figure = makeFigure(parsed, current);
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

  function importPastedData() {
    if (!pasteText.trim()) return;
    try {
      const parsed = parseDelimitedText(pasteText, "剪贴板数据.csv");
      patchProject((current) => {
        const figure = makeFigure(parsed, current);
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
      const figure = makeFigure(dataset, current);
      return {
        ...current,
        figures: [...current.figures, figure],
        activeFigureId: figure.id
      };
    });
  }

  function duplicateFigure() {
    if (!activeFigure) return;
    const duplicate: FigureSpec = {
      ...structuredClone(activeFigure),
      id: makeId("figure"),
      name: activeFigure.name + " 副本"
    };
    patchProject((current) => ({
      ...current,
      figures: [...current.figures, duplicate],
      activeFigureId: duplicate.id
    }));
    showToast("已复制当前图形");
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

  if (!activeFigure || !activeDataset) {
    return <div className="fatal-state">项目中没有可显示的图形。</div>;
  }

  const lineWidth = selectedOverride.lineWidthPt ?? preset.lineWidthPt;
  const lineStyle = selectedOverride.lineStyle ?? "solid";
  const lineVisible = selectedOverride.lineVisible ?? true;
  const markerVisible =
    selectedOverride.markerVisible ??
    (activeFigure.templateId === "xy-scatter" ||
      activeFigure.templateId === "xy-line-marker" ||
      activeFigure.templateId === "xy-errorbar");
  const markerSymbol = selectedOverride.markerSymbol ?? "circle";
  const markerSize = selectedOverride.markerSizePt ?? preset.markerSizePt;
  const opacity = selectedOverride.opacity ?? 1;
  const selectedIndex = selectedSeries
    ? Math.max(
        0,
        activeDataset.ys.findIndex((series) => series.id === selectedSeries.id)
      )
    : 0;
  const selectedColor =
    selectedOverride.color ||
    preset.palette[selectedIndex % preset.palette.length];
  const visible = selectedOverride.visible ?? true;

  const layerIndex = selectedSeries
    ? activeFigure.seriesOrder.indexOf(selectedSeries.id)
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
          <button type="button" disabled={!history.canUndo} onClick={history.undo} title="Ctrl+Z">撤销</button>
          <button type="button" disabled={!history.canRedo} onClick={history.redo} title="Ctrl+Y">重做</button>
        </div>

        <div className="top-actions">
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
          <button className="quiet-button" type="button" onClick={() => triggerDataFile("replace")}>替换数据</button>
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

          <div className="left-scroll">
            <div className="tree-group">
              <div className="tree-section-head">
                <span>数据</span>
                <button type="button" title="导入数据" onClick={() => triggerDataFile("add")}>＋</button>
              </div>
              {project.datasets.map((dataset) => {
                const linkedFigure =
                  project.figures.find((figure) => figure.datasetId === dataset.id);
                return (
                  <button
                    className={
                      dataset.id === activeDataset.id
                        ? "tree-item is-active"
                        : "tree-item"
                    }
                    key={dataset.id}
                    type="button"
                    onClick={() => {
                      if (linkedFigure) activateFigure(linkedFigure.id);
                    }}
                  >
                    <span className="tree-symbol">▦</span>
                    <span>{dataset.name}</span>
                    <small>{dataset.ys.length}Y</small>
                  </button>
                );
              })}
            </div>

            <div className="tree-group">
              <div className="tree-section-head">
                <span>图形</span>
                <button
                  type="button"
                  title="基于当前数据新建图形"
                  onClick={() => addFigureForDataset(activeDataset)}
                >
                  ＋
                </button>
              </div>
              {project.figures.map((figure) => (
                <button
                  key={figure.id}
                  className={
                    figure.id === activeFigure.id
                      ? "tree-item is-active"
                      : "tree-item"
                  }
                  type="button"
                  onClick={() => activateFigure(figure.id)}
                >
                  <span className="tree-symbol">▧</span>
                  <span>{figure.name}</span>
                  <small>{templateLabel(figure.templateId)}</small>
                </button>
              ))}
            </div>

            <div className="tree-group curves-group">
              <div className="tree-section-head">
                <span>{fieldTemplate ? "数据行" : "曲线"}</span>
                <button type="button" title="复制当前图形" onClick={duplicateFigure}>⧉</button>
              </div>
              {[...orderedSeries].reverse().slice(0, 40).map((series) => {
                const sourceIndex = Math.max(
                  0,
                  activeDataset.ys.findIndex((item) => item.id === series.id)
                );
                const override = activeFigure.seriesOverrides[series.id] || {};
                const color =
                  override.color ||
                  preset.palette[sourceIndex % preset.palette.length];

                return (
                  <button
                    key={series.id}
                    type="button"
                    className={
                      selectedSeries?.id === series.id
                        ? "series-row series-selected"
                        : "series-row"
                    }
                    onClick={() => setSelectedSeriesId(series.id)}
                  >
                    <span
                      className="series-color"
                      style={{
                        backgroundColor: color,
                        opacity: override.visible === false ? 0.25 : 1
                      }}
                    />
                    <span className="series-name">{series.name}</span>
                  </button>
                );
              })}
            </div>
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
              <button type="button" onClick={() => void resetView()}>重置视图</button>
              <button type="button" onClick={() => void exportFigure("svg")}>SVG</button>
              <button type="button" onClick={() => void exportFigure("png")}>PNG</button>
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
          <div className="inspector-heading">
            <span>属性</span>
            <strong>{selectedSeries?.name || activeFigure.name}</strong>
          </div>

          <div className="inspector-scroll">
            <details className="inspector-group" open>
              <summary>
                <span>画布</span>
                <span className="summary-actions">
                  <button type="button" onClick={(event) => { event.preventDefault(); saveDefault("project"); }}>项目默认</button>
                  <button type="button" onClick={(event) => { event.preventDefault(); saveDefault("user"); }}>我的默认</button>
                </span>
              </summary>

              <div className="prop-body">
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
                        max="16"
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
              </div>
            </details>

            {!fieldTemplate && selectedSeries && (
              <details className="inspector-group" open>
                <summary><span>曲线</span></summary>
                <div className="prop-body">
                  <div className="prop-row">
                    <label>显示</label>
                    <MiniSwitch
                      checked={visible}
                      onChange={(value) => updateSeriesOverride({ visible: value })}
                    />
                  </div>

                  {!barTemplate && (
                    <>
                      <div className="prop-row">
                        <label>线条</label>
                        <MiniSwitch
                          checked={lineVisible}
                          onChange={(value) =>
                            updateSeriesOverride({ lineVisible: value })
                          }
                        />
                      </div>

                      <div className="prop-row">
                        <label>线型</label>
                        <select
                          value={lineStyle}
                          onChange={(event) =>
                            updateSeriesOverride({
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
                              max="5"
                              step="0.05"
                              value={lineWidth}
                              onChange={(event) =>
                                updateSeriesOverride({
                                  lineWidthPt: Number(event.target.value)
                                })
                              }
                            />
                            <span>pt</span>
                          </div>
                          <ResetIcon
                            visible={selectedOverride.lineWidthPt !== undefined}
                            onReset={() => resetSeriesField("lineWidthPt")}
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
                              updateSeriesOverride({ markerVisible: false });
                            } else {
                              updateSeriesOverride({
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
                          <option value="triangle-up">三角</option>
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
                              max="14"
                              step="0.25"
                              value={markerSize}
                              disabled={!markerVisible}
                              onChange={(event) =>
                                updateSeriesOverride({
                                  markerSizePt: Number(event.target.value)
                                })
                              }
                            />
                            <span>pt</span>
                          </div>
                          <ResetIcon
                            visible={selectedOverride.markerSizePt !== undefined}
                            onReset={() => resetSeriesField("markerSizePt")}
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
                            updateSeriesOverride({
                              opacity: Number(event.target.value) / 100
                            })
                          }
                        />
                        <span>%</span>
                      </div>
                      <ResetIcon
                        visible={selectedOverride.opacity !== undefined}
                        onReset={() => resetSeriesField("opacity")}
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
                          updateSeriesOverride({ color: event.target.value })
                        }
                      />
                      <span>{selectedColor.toUpperCase()}</span>
                      <ResetIcon
                        visible={selectedOverride.color !== undefined}
                        onReset={() => resetSeriesField("color")}
                      />
                    </div>
                  </div>

                  <div className="prop-row">
                    <label>图层</label>
                    <div className="layer-inline">
                      <button
                        type="button"
                        title="下移一层"
                        disabled={isBottomLayer}
                        onClick={() => moveSelectedSeries("down")}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        title="上移一层"
                        disabled={isTopLayer}
                        onClick={() => moveSelectedSeries("up")}
                      >
                        ↑
                      </button>
                    </div>
                  </div>
                </div>
              </details>
            )}

            {(activeFigure.templateId === "xy-errorbar" ||
              activeFigure.templateId === "offset-spectrum" ||
              fieldTemplate) && (
              <details className="inspector-group" open>
                <summary><span>图型参数</span></summary>
                <div className="prop-body">
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
                </div>
              </details>
            )}

            <details className="inspector-group">
              <summary><span>坐标轴</span></summary>
              <div className="prop-body">
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
                          onChange={(value) =>
                            setFigureField("xAutoRange", value)
                          }
                        />
                        <input
                          type="number"
                          placeholder="min"
                          disabled={activeFigure.figureOverrides.xAutoRange !== false}
                          value={activeFigure.figureOverrides.xMin ?? ""}
                          onChange={(event) =>
                            setFigureField(
                              "xMin",
                              event.target.value === ""
                                ? undefined
                                : Number(event.target.value)
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
                              event.target.value === ""
                                ? undefined
                                : Number(event.target.value)
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
                          onChange={(value) =>
                            setFigureField("yAutoRange", value)
                          }
                        />
                        <input
                          type="number"
                          placeholder="min"
                          disabled={activeFigure.figureOverrides.yAutoRange !== false}
                          value={activeFigure.figureOverrides.yMin ?? ""}
                          onChange={(event) =>
                            setFigureField(
                              "yMin",
                              event.target.value === ""
                                ? undefined
                                : Number(event.target.value)
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
                              event.target.value === ""
                                ? undefined
                                : Number(event.target.value)
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
              </div>
            </details>

            {!fieldTemplate && (
              <details className="inspector-group">
                <summary><span>图例</span></summary>
                <div className="prop-body">
                  <div className="prop-row">
                    <label>显示</label>
                    <MiniSwitch
                      checked={effectiveLegendVisible}
                      onChange={(value) =>
                        setFigureField("legendVisible", value)
                      }
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
                </div>
              </details>
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
              placeholder={"Wavelength (nm),Power (dBm)\\n1030,-52.1\\n1031,-51.8"}
            />
            <div className="dialog-actions">
              <button type="button" onClick={() => setPasteOpen(false)}>取消</button>
              <button className="primary-button" type="button" onClick={importPastedData}>导入</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default App;
