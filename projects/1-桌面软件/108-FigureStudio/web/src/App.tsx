import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import Plotly from "plotly.js-dist-min";
import { createInitialProject } from "./data/demo";
import {
  columnLabel,
  defaultDataRef,
  emptyDataset,
  findSheet,
  sheetRowCount,
  sheetToDataset
} from "./data/adapter";
import { resolveFigureInput } from "./data/figureInput";
import { resolveFieldRowCoordinates } from "./data/field";
import { downloadMatplotlibScript } from "./export/matplotlib";
import { useHistoryState } from "./hooks/useHistoryState";
import { parseDelimitedText } from "./lib/csv";
import {
  resolveSafeMathText,
  type MathTextState
} from "./lib/mathText";
import type {
  AspectMode,
  AxisScale,
  AxisStylePreset,
  CellValue,
  ColorScaleId,
  Column,
  ColumnRole,
  DataBook,
  DataSheet,
  DocumentRef,
  ExplorerSelection,
  FigureOverrides,
  FigureSpec,
  InspectorTab,
  LegendOrientation,
  LegendPosition,
  LegendXAnchor,
  LegendYAnchor,
  LineStyle,
  MarkerSymbol,
  PlotTemplateId,
  PresetId,
  ProjectFolder,
  ProjectState,
  SeriesOverride,
  TickDirection,
  TickLabelFormat,
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
import { templates } from "./plot/templates";
import { checkFigure } from "./project/checker";
import {
  downloadProject,
  readProjectFile
} from "./project/projectIO";

const AUTOSAVE_KEY = "figurestudio-p108-autosave-v05";
const USER_DEFAULTS_KEY = "figurestudio-p108-user-defaults-v02";
const UI_SCALE_KEY = "figurestudio-p108-ui-scale";
const PNG_SCALE = PNG_DPI / 96;

const ROLE_OPTIONS: Array<{ value: ColumnRole; label: string }> = [
  { value: "X", label: "X" },
  { value: "Y", label: "Y" },
  { value: "Z", label: "Z" },
  { value: "XErr", label: "XErr" },
  { value: "YErr", label: "YErr" },
  { value: "Label", label: "标签" },
  { value: "None", label: "无" }
];

function makeId(prefix: string): string {
  return prefix + "-" + Math.random().toString(36).slice(2, 10);
}

function docKey(doc: DocumentRef): string {
  return doc.type + ":" + doc.id;
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

function parseCell(text: string, role: ColumnRole): CellValue {
  if (text.trim() === "") return null;
  if (role === "Label") return text;
  const value = Number(text);
  return Number.isFinite(value) ? value : text;
}

function Icon(props: {
  kind: "folder" | "book" | "sheet" | "graph";
  linked?: boolean;
}) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.25,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };

  return (
    <span className={"item-icon-wrap icon-" + props.kind}>
      {props.kind === "folder" && (
        <svg {...common} aria-hidden="true">
          <path className="icon-surface" d="M1.8 4.1h4l1.4 1.5h7v6.9a1.2 1.2 0 0 1-1.2 1.2H3a1.2 1.2 0 0 1-1.2-1.2z" />
          <path d="M1.8 4.1V3.3A1.1 1.1 0 0 1 2.9 2.2h3l1.2 1.2h5.1a1 1 0 0 1 1 1v1.2" />
        </svg>
      )}
      {props.kind === "book" && (
        <svg {...common} aria-hidden="true">
          <rect className="icon-surface" x="2" y="2.1" width="12" height="11.8" rx="1.2" />
          <path d="M2 5.2h12M5.8 2.1v11.8M9.8 2.1v11.8M2 9.2h12" />
        </svg>
      )}
      {props.kind === "sheet" && (
        <svg {...common} aria-hidden="true">
          <path className="icon-surface" d="M3 1.8h7l3 3v9.4H3z" />
          <path d="M10 1.8v3h3M5 7h6M5 9.5h6M5 12h4" />
        </svg>
      )}
      {props.kind === "graph" && (
        <svg {...common} className="graph-flat-icon" aria-hidden="true">
          <path d="M2.4 2.6v10.8h11.2" />
          <path d="M3.8 10.8l2.25-2.15 2.15.9 3.15-4.15 2.05 1.35" />
          <circle cx="6.05" cy="8.65" r=".55" fill="currentColor" stroke="none" />
          <circle cx="8.2" cy="9.55" r=".55" fill="currentColor" stroke="none" />
          <circle cx="11.35" cy="5.4" r=".55" fill="currentColor" stroke="none" />
        </svg>
      )}
      {props.linked && (
        <span className="link-badge" title="链接数据">
          ↗
        </span>
      )}
    </span>
  );
}

function TreeChevron(props: { open: boolean }) {
  return (
    <svg
      className={props.open ? "tree-chevron-svg is-open" : "tree-chevron-svg"}
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      <path d="M4.25 2.5 8 6 4.25 9.5" />
    </svg>
  );
}

function ExplorerActionIcon(props: { kind: "rename" | "delete" }) {
  return props.kind === "rename" ? (
    <svg className="explorer-action-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 11.8 3.6 9l6.7-6.7 2.4 2.4L6 11.4z" />
      <path d="M9.4 3.2 11.8 5.6M2.7 13.3h10.6" />
    </svg>
  ) : (
    <svg className="explorer-action-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.3 5.1v7.4h7.4V5.1M3 3.7h10M6.1 3.7V2.4h3.8v1.3M6.4 7v3.5M9.6 7v3.5" />
    </svg>
  );
}

function LayerArrowIcon(props: { direction: "up" | "down" }) {
  return (
    <svg className="layer-arrow-icon" viewBox="0 0 16 16" aria-hidden="true">
      {props.direction === "up" ? (
        <>
          <path d="M8 12.5V3.5" />
          <path d="M4.7 6.7 8 3.4l3.3 3.3" />
        </>
      ) : (
        <>
          <path d="M8 3.5v9" />
          <path d="M4.7 9.3 8 12.6l3.3-3.3" />
        </>
      )}
    </svg>
  );
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
      <svg className="reset-arrow-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M5.1 5.2H2.8V2.9" />
        <path d="M3 5.1a5.2 5.2 0 1 1-.1 5.9" />
      </svg>
    </button>
  );
}

function CellEditor(props: {
  value: CellValue;
  role: ColumnRole;
  readOnly: boolean;
  onCommit: (value: CellValue) => void;
}) {
  const [text, setText] = useState(
    props.value === null || props.value === undefined
      ? ""
      : String(props.value)
  );

  useEffect(() => {
    setText(
      props.value === null || props.value === undefined
        ? ""
        : String(props.value)
    );
  }, [props.value]);

  return (
    <input
      className="sheet-cell-input"
      value={text}
      readOnly={props.readOnly}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const next = parseCell(text, props.role);
        if (next !== props.value) props.onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
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
  const initialBookId = initialProject.dataBooks[0]?.id ?? "";
  const initialFigureId = initialProject.figures[0]?.id ?? "";

  const history = useHistoryState<ProjectState>(initialProject);
  const project = history.value;

  const plotRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dataInputRef = useRef<HTMLInputElement | null>(null);
  const projectInputRef = useRef<HTMLInputElement | null>(null);
  const dataActionRef = useRef<
    "import" | "append" | "link" | "replace" | "reload"
  >("import");

  const [openDocs, setOpenDocs] = useState<DocumentRef[]>(() => [
    ...(initialBookId ? [{ type: "book", id: initialBookId } as DocumentRef] : []),
    ...(initialFigureId ? [{ type: "figure", id: initialFigureId } as DocumentRef] : [])
  ]);
  const [activeDoc, setActiveDoc] = useState<DocumentRef>(() =>
    initialBookId
      ? { type: "book", id: initialBookId }
      : { type: "figure", id: initialFigureId }
  );
  const [activeSheetByBook, setActiveSheetByBook] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        initialProject.dataBooks.map((book) => [
          book.id,
          book.sheets[0]?.id ?? ""
        ])
      )
  );
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(initialProject.folders.map((folder) => folder.id))
  );
  const [expandedBooks, setExpandedBooks] = useState<Set<string>>(
    () => new Set(initialProject.dataBooks.map((book) => book.id))
  );
  const [explorerSelection, setExplorerSelection] =
    useState<ExplorerSelection | null>(null);
  const [selectedColumnId, setSelectedColumnId] = useState("");
  const [selectedSeriesIds, setSelectedSeriesIds] = useState<string[]>([]);
  const [previewScale, setPreviewScale] = useState(1);
  const [uiScale, setUiScale] = useState(readUiScale);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("series");
  const [dataInspectorTab, setDataInspectorTab] = useState<"data" | "column">("data");
  const [showColumnMeta, setShowColumnMeta] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [toast, setToast] = useState("");

  const showToast = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => {
      setToast((current) => (current === text ? "" : current));
    }, 2200);
  }, []);

  const activeBook =
    activeDoc.type === "book"
      ? project.dataBooks.find((book) => book.id === activeDoc.id)
      : undefined;
  const activeSheet =
    activeBook?.sheets.find(
      (sheet) => sheet.id === activeSheetByBook[activeBook.id]
    ) ?? activeBook?.sheets[0];

  const activeFigure =
    activeDoc.type === "figure"
      ? project.figures.find((figure) => figure.id === activeDoc.id)
      : undefined;

  const figureInput = activeFigure
    ? resolveFigureInput(project, activeFigure)
    : undefined;
  const figureSheetContext =
    activeFigure?.dataRef
      ? findSheet(project, activeFigure.dataRef?.sheetId)
      : undefined;
  const figureSheet = figureSheetContext?.sheet;
  const plotDataset = activeFigure
    ? figureInput?.state === "ready" && figureSheet
      ? sheetToDataset(figureSheet, activeFigure)
      : emptyDataset(activeFigure.name)
    : undefined;
  const preset = activeFigure
    ? presets[activeFigure.presetId]
    : presets.scientific;

  const orderedSeries = useMemo(
    () =>
      plotDataset && activeFigure
        ? orderSeries(
            plotDataset,
            activeFigure.seriesOrder,
            activeFigure.dataRef?.yColumnIds
          )
        : [],
    [plotDataset, activeFigure]
  );

  const primarySeries =
    orderedSeries.find((series) =>
      selectedSeriesIds.includes(series.id)
    ) ?? orderedSeries[0];
  const selectedSeries =
    selectedSeriesIds.length
      ? selectedSeriesIds
      : primarySeries
      ? [primarySeries.id]
      : [];
  const primaryOverride =
    primarySeries && activeFigure
      ? activeFigure.seriesOverrides[primarySeries.id] || {}
      : {};

  const rawPlotTitle = activeFigure?.figureOverrides.plotTitle;
  const rawXTitle = activeFigure?.figureOverrides.xTitle;
  const rawYTitle = activeFigure?.figureOverrides.yTitle;
  const rawRightYTitle = activeFigure?.figureOverrides.rightYTitle;
  const [mathTextState, setMathTextState] = useState<{
    plotTitle: MathTextState;
    xTitle: MathTextState;
    yTitle: MathTextState;
    rightYTitle: MathTextState;
  }>({
    plotTitle: "plain",
    xTitle: "plain",
    yTitle: "plain",
    rightYTitle: "plain"
  });

  useEffect(() => {
    setMathTextState({
      plotTitle: "plain",
      xTitle: "plain",
      yTitle: "plain",
      rightYTitle: "plain"
    });

    let cancelled = false;
    void Promise.all([
      resolveSafeMathText(rawPlotTitle),
      resolveSafeMathText(rawXTitle),
      resolveSafeMathText(rawYTitle),
      resolveSafeMathText(rawRightYTitle)
    ]).then(([plotTitle, xTitle, yTitle, rightYTitle]) => {
      if (cancelled) return;
      setMathTextState({
        plotTitle: plotTitle.state,
        xTitle: xTitle.state,
        yTitle: yTitle.state,
        rightYTitle: rightYTitle.state
      });
    });

    return () => {
      cancelled = true;
    };
  }, [rawPlotTitle, rawXTitle, rawYTitle, rawRightYTitle]);

  const xAxisCategorical =
    plotDataset?.x.values.some((value) => typeof value === "string") ?? false;

  const latexFallbackActive =
    mathTextState.plotTitle === "invalid" ||
    mathTextState.xTitle === "invalid" ||
    mathTextState.yTitle === "invalid" ||
    mathTextState.rightYTitle === "invalid";
  const latexUnavailable =
    mathTextState.plotTitle === "unavailable" ||
    mathTextState.xTitle === "unavailable" ||
    mathTextState.yTitle === "unavailable" ||
    mathTextState.rightYTitle === "unavailable";

  const xAxisIssue = (() => {
    const o = activeFigure?.figureOverrides;
    if (!o || o.xAutoRange !== false) return "";
    if (
      o.xMin === undefined ||
      o.xMax === undefined ||
      !Number.isFinite(o.xMin) ||
      !Number.isFinite(o.xMax) ||
      o.xMin >= o.xMax
    ) {
      return "X 轴手动范围需要满足 最小值 < 最大值";
    }
    if ((o.xScale ?? "linear") === "log" && (o.xMin <= 0 || o.xMax <= 0)) {
      return "X 对数轴范围必须大于 0";
    }
    return "";
  })();

  const yAxisIssue = (() => {
    const o = activeFigure?.figureOverrides;
    if (!o || o.yAutoRange !== false) return "";
    if (
      o.yMin === undefined ||
      o.yMax === undefined ||
      !Number.isFinite(o.yMin) ||
      !Number.isFinite(o.yMax) ||
      o.yMin >= o.yMax
    ) {
      return "Y 轴手动范围需要满足 最小值 < 最大值";
    }
    if ((o.yScale ?? "linear") === "log" && (o.yMin <= 0 || o.yMax <= 0)) {
      return "Y 对数轴范围必须大于 0";
    }
    return "";
  })();

  const rightYAxisIssue = (() => {
    const o = activeFigure?.figureOverrides;
    if (
      activeFigure?.templateId !== "double-y" ||
      !o ||
      o.rightYAutoRange !== false
    ) {
      return "";
    }
    if (
      o.rightYMin === undefined ||
      o.rightYMax === undefined ||
      !Number.isFinite(o.rightYMin) ||
      !Number.isFinite(o.rightYMax) ||
      o.rightYMin >= o.rightYMax
    ) {
      return "右 Y 轴手动范围需要满足 最小值 < 最大值";
    }
    if (
      (o.rightYScale ?? "linear") === "log" &&
      (o.rightYMin <= 0 || o.rightYMax <= 0)
    ) {
      return "右 Y 对数轴范围必须大于 0";
    }
    return "";
  })();

  const layout = useMemo(
    () =>
      plotDataset && activeFigure
        ? buildLayout({
            dataset: plotDataset,
            figure: activeFigure,
            preset
          })
        : { width: 640, height: 480 },
    [plotDataset, activeFigure, preset]
  );

  const traces = useMemo(
    () =>
      plotDataset && activeFigure
        ? buildTraces({
            dataset: plotDataset,
            figure: activeFigure,
            preset
          })
        : [],
    [plotDataset, activeFigure, preset]
  );

  const checkItems = useMemo(
    () =>
      plotDataset && activeFigure
        ? checkFigure(plotDataset, activeFigure, preset)
        : [],
    [plotDataset, activeFigure, preset]
  );

  const warningCount = checkItems.filter((item) => item.level === "warn").length;
  const dependentFigures = activeSheet
    ? project.figures.filter(
        (figure) => figure.dataRef?.sheetId === activeSheet.id
      )
    : [];
  const allSheets = project.dataBooks.flatMap((book) =>
    book.sheets.map((sheet) => ({ book, sheet }))
  );

  useEffect(() => {
    document.documentElement.style.setProperty("--ui-scale", String(uiScale));
    localStorage.setItem(UI_SCALE_KEY, String(uiScale));
  }, [uiScale]);

  useEffect(() => {
    sessionStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
    document.title = project.name + " · FigureStudio";
  }, [project]);

  useEffect(() => {
    if (activeSheet) {
      if (
        !selectedColumnId ||
        !activeSheet.columns.some((column) => column.id === selectedColumnId)
      ) {
        setSelectedColumnId(activeSheet.columns[0]?.id ?? "");
      }
    }
  }, [activeSheet, selectedColumnId]);

  useEffect(() => {
    const isFieldTemplate =
      activeFigure?.templateId === "heatmap" ||
      activeFigure?.templateId === "contour" ||
      activeFigure?.templateId === "surface-3d";
    if (
      isFieldTemplate &&
      (inspectorTab === "series" || inspectorTab === "legend")
    ) {
      setInspectorTab("figure");
    }
  }, [activeFigure?.templateId, inspectorTab]);

  useEffect(() => {
    if (!activeFigure) return;
    const valid = selectedSeriesIds.filter((id) =>
      orderedSeries.some((series) => series.id === id)
    );
    if (valid.length === 0 && orderedSeries[0]) {
      setSelectedSeriesIds([orderedSeries[0].id]);
    } else if (valid.length !== selectedSeriesIds.length) {
      setSelectedSeriesIds(valid);
    }
  }, [activeFigure?.id, orderedSeries, selectedSeriesIds]);

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
        showToast("项目已保存");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [history, project, showToast]);

  useEffect(() => {
    if (!activeFigure) return;
    const node = canvasRef.current;
    if (!node) return;

    const updateScale = () => {
      const rect = node.getBoundingClientRect();
      const fit = Math.min(
        Math.max(160, rect.width - 24) / Number(layout.width),
        Math.max(160, rect.height - 24) / Number(layout.height)
      );
      setPreviewScale(Math.max(0.1, Math.min(4, fit)));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(node);
    return () => observer.disconnect();
  }, [activeFigure, layout.width, layout.height]);

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
      scrollZoom: activeFigure.templateId !== "surface-3d",
      editable: false,
      edits: {
        annotationPosition: false,
        annotationTail: false,
        annotationText: false,
        axisTitleText: false,
        colorbarPosition: false,
        colorbarTitleText: false,
        legendPosition: true,
        legendText: false,
        shapePosition: false,
        titleText: false
      }
    };

    const handleDomClick = (event: globalThis.MouseEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest(".legend")) {
        setInspectorTab("legend");
      } else if (
        target.closest(".gtitle") ||
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
      node.removeAllListeners?.("plotly_relayout");

      node.on?.("plotly_click", (event: any) => {
        const point = event?.points?.[0];
        const metaId = point?.data?.meta?.figureStudioSeriesId;
        const index = point?.curveNumber;
        const series =
          typeof metaId === "string"
            ? orderedSeries.find((item) => item.id === metaId)
            : typeof index === "number"
            ? orderedSeries[index]
            : undefined;
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

      node.on?.("plotly_relayout", (event: Record<string, unknown>) => {
        const changedLegend =
          typeof event["legend.x"] === "number" ||
          typeof event["legend.y"] === "number" ||
          typeof event["legend.xanchor"] === "string" ||
          typeof event["legend.yanchor"] === "string";
        if (!changedLegend) return;

        const liveLegend = node?._fullLayout?.legend;
        const x =
          typeof event["legend.x"] === "number"
            ? event["legend.x"]
            : liveLegend?.x;
        const y =
          typeof event["legend.y"] === "number"
            ? event["legend.y"]
            : liveLegend?.y;
        if (typeof x !== "number" || typeof y !== "number") return;

        const xAnchor =
          typeof event["legend.xanchor"] === "string"
            ? event["legend.xanchor"]
            : liveLegend?.xanchor;
        const yAnchor =
          typeof event["legend.yanchor"] === "string"
            ? event["legend.yanchor"]
            : liveLegend?.yanchor;

        history.commit((current) => ({
          ...current,
          figures: current.figures.map((figure) =>
            figure.id === activeFigure.id
              ? {
                  ...figure,
                  figureOverrides: {
                    ...figure.figureOverrides,
                    legendPosition: "custom",
                    legendX: x,
                    legendY: y,
                    legendXAnchor:
                      xAnchor === "center" || xAnchor === "right"
                        ? xAnchor
                        : "left",
                    legendYAnchor:
                      yAnchor === "middle" || yAnchor === "bottom"
                        ? yAnchor
                        : "top"
                  }
                }
              : figure
          )
        }));
        setInspectorTab("legend");
      });

      node.addEventListener("click", handleDomClick);
    });

    return () => {
      cancelled = true;
      node.removeAllListeners?.("plotly_click");
      node.removeAllListeners?.("plotly_legendclick");
      node.removeAllListeners?.("plotly_relayout");
      node.removeEventListener("click", handleDomClick);
    };
  }, [activeFigure, history, layout, orderedSeries, selectSeries, traces]);

  const patchProject = useCallback(
    (updater: (current: ProjectState) => ProjectState) => {
      history.commit(updater);
    },
    [history]
  );

  const patchSheet = useCallback(
    (sheetId: string, updater: (sheet: DataSheet) => DataSheet) => {
      patchProject((current) => ({
        ...current,
        dataBooks: current.dataBooks.map((book) => ({
          ...book,
          sheets: book.sheets.map((sheet) =>
            sheet.id === sheetId ? updater(sheet) : sheet
          )
        }))
      }));
    },
    [patchProject]
  );

  const patchBook = useCallback(
    (bookId: string, updater: (book: DataBook) => DataBook) => {
      patchProject((current) => ({
        ...current,
        dataBooks: current.dataBooks.map((book) =>
          book.id === bookId ? updater(book) : book
        )
      }));
    },
    [patchProject]
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

  function openDocument(doc: DocumentRef) {
    setOpenDocs((current) =>
      current.some((item) => docKey(item) === docKey(doc))
        ? current
        : [...current, doc]
    );
    setActiveDoc(doc);

    if (doc.type === "figure") {
      history.updateWithoutHistory((current) => ({
        ...current,
        activeFigureId: doc.id
      }));
      setInspectorTab("series");
    } else {
      setDataInspectorTab("data");
    }
  }

  function openSheetDocument(sheetId: string) {
    const context = findSheet(project, sheetId);
    if (!context) return;
    setActiveSheetByBook((current) => ({
      ...current,
      [context.book.id]: sheetId
    }));
    openDocument({ type: "book", id: context.book.id });
  }

  function closeDocument(doc: DocumentRef) {
    setOpenDocs((current) => {
      const next = current.filter((item) => docKey(item) !== docKey(doc));
      if (docKey(activeDoc) === docKey(doc)) {
        const fallback = next[next.length - 1];
        if (fallback) setActiveDoc(fallback);
      }
      return next;
    });
  }

  function resetWorkspace(next: ProjectState) {
    history.replace(next);
    setExpandedFolders(new Set(next.folders.map((folder) => folder.id)));
    setExpandedBooks(new Set(next.dataBooks.map((book) => book.id)));
    const bookId = next.dataBooks[0]?.id;
    const figureId = next.figures[0]?.id;
    const docs: DocumentRef[] = [
      ...(bookId ? [{ type: "book", id: bookId } as DocumentRef] : []),
      ...(figureId ? [{ type: "figure", id: figureId } as DocumentRef] : [])
    ];
    setActiveSheetByBook(
      Object.fromEntries(
        next.dataBooks.map((book) => [book.id, book.sheets[0]?.id ?? ""])
      )
    );
    setOpenDocs(docs);
    setActiveDoc(docs[0] ?? { type: "figure", id: figureId ?? "" });
    setExplorerSelection(null);
  }

  function docTitle(doc: DocumentRef): string {
    if (doc.type === "figure") {
      return project.figures.find((figure) => figure.id === doc.id)?.name ?? "图形";
    }
    return project.dataBooks.find((book) => book.id === doc.id)?.name ?? "数据簿";
  }

  function newProject() {
    if (!window.confirm("新建项目会替换当前工作区，是否继续？")) return;
    resetWorkspace(createInitialProject(readUserDefaults()));
    showToast("已新建项目");
  }

  async function openProject(file: File) {
    try {
      resetWorkspace(await readProjectFile(file));
      showToast("项目已打开");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "项目打开失败。");
    } finally {
      if (projectInputRef.current) projectInputRef.current.value = "";
    }
  }

  function restoreAutosave() {
    try {
      const raw = sessionStorage.getItem(AUTOSAVE_KEY);
      if (!raw) {
        showToast("没有可恢复的 v0.5 自动保存");
        return;
      }
      const next = JSON.parse(raw) as ProjectState;
      if (next.schemaVersion !== "0.5") throw new Error("version");
      resetWorkspace(next);
      showToast("已恢复自动保存");
    } catch {
      showToast("自动保存无法恢复");
    }
  }

  function selectedFolderId(): string | undefined {
    if (!explorerSelection) return undefined;
    if (explorerSelection.type === "folder") return explorerSelection.id;
    if (explorerSelection.type === "book") {
      return project.dataBooks.find((book) => book.id === explorerSelection.id)
        ?.folderId;
    }
    if (explorerSelection.type === "sheet") {
      return findSheet(project, explorerSelection.id)?.book.folderId;
    }
    return project.figures.find((figure) => figure.id === explorerSelection.id)
      ?.folderId;
  }

  function triggerDataFile(
    action: "import" | "append" | "link" | "replace" | "reload"
  ) {
    dataActionRef.current = action;
    dataInputRef.current?.click();
  }

  function reconcileSheet(existing: DataSheet, incoming: DataSheet): DataSheet {
    const used = new Set<string>();
    const columns = incoming.columns.map((incomingColumn) => {
      const matched = existing.columns.find(
        (old) =>
          !used.has(old.id) &&
          (old.id === incomingColumn.id ||
            old.name.trim().toLowerCase() ===
              incomingColumn.name.trim().toLowerCase())
      );

      if (!matched) return incomingColumn;
      used.add(matched.id);

      return {
        ...incomingColumn,
        id: matched.id,
        role: matched.role,
        comment: matched.comment ?? incomingColumn.comment
      };
    });

    return {
      ...incoming,
      id: existing.id,
      name: existing.name,
      comment: existing.comment ?? incoming.comment,
      metadata: incoming.metadata ?? existing.metadata,
      columns
    };
  }

  function referencedColumnIds(figure: FigureSpec): string[] {
    const ref = figure.dataRef;
    if (!ref) return [];
    return [
      ...(ref.xColumnId ? [ref.xColumnId] : []),
      ...ref.yColumnIds,
      ...(ref.yErrorColumnId ? [ref.yErrorColumnId] : []),
      ...(ref.zColumnId ? [ref.zColumnId] : [])
    ].filter(Boolean);
  }

  function replaceSheet(
    bookId: string,
    sheetId: string,
    incoming: DataSheet,
    sourcePatch?: Partial<DataSheet["source"]>
  ): boolean {
    const book = project.dataBooks.find((item) => item.id === bookId);
    const existing = book?.sheets.find((sheet) => sheet.id === sheetId);
    if (!book || !existing) return false;

    const nextSheet = reconcileSheet(existing, incoming);
    const available = new Set(nextSheet.columns.map((column) => column.id));
    const dependents = project.figures.filter(
      (figure) => figure.dataRef?.sheetId === sheetId
    );
    const broken = dependents.filter((figure) =>
      referencedColumnIds(figure).some((id) => !available.has(id))
    );

    if (broken.length) {
      window.alert(
        "此次更新会让 " +
          broken.length +
          " 张图失去已绑定的数据列，因此已取消。\n\n" +
          broken.map((figure) => "• " + figure.name).join("\n") +
          "\n\n请保留原列名，或先在图形的“数据”页修改映射。"
      );
      return false;
    }

    if (
      dependents.length > 0 &&
      !window.confirm(
        "当前工作表被 " +
          dependents.length +
          " 张图引用。更新数据后这些图会同步刷新，但不会改变列映射和图形样式。是否继续？"
      )
    ) {
      return false;
    }

    const updatedSheet = sourcePatch
      ? {
          ...nextSheet,
          source: { ...nextSheet.source, ...sourcePatch }
        }
      : nextSheet;

    patchProject((current) => ({
      ...current,
      dataBooks: current.dataBooks.map((item) =>
        item.id === bookId
          ? {
              ...item,
              sheets: item.sheets.map((sheet) =>
                sheet.id === sheetId ? updatedSheet : sheet
              )
            }
          : item
      )
    }));
    return true;
  }

  async function handleDataFile(file: File) {
    try {
      const sheet = parseDelimitedText(await file.text(), file.name);
      const action = dataActionRef.current;

      if ((action === "replace" || action === "reload") && activeBook && activeSheet) {
        if (activeSheet.source.kind === "linked" && action === "replace") {
          showToast("链接数据请使用“重新加载”");
          return;
        }

        const replaced = replaceSheet(
          activeBook.id,
          activeSheet.id,
          sheet,
          action === "reload"
            ? {
                kind: "linked",
                fileName: file.name,
                size: file.size,
                modifiedMs: file.lastModified,
                status: "ok"
              }
            : undefined
        );
        if (replaced) {
          showToast(
            action === "reload"
              ? "链接数据已重新加载"
              : "数据表已替换"
          );
        }
        return;
      }

      const bookId = makeId("book");
      if (action === "append" && activeBook) {
        const nextSheet: DataSheet = {
          ...sheet,
          id: makeId("sheet"),
          source: { kind: "embedded" }
        };
        patchBook(activeBook.id, (book) => ({
          ...book,
          sheets: [...book.sheets, nextSheet]
        }));
        setActiveSheetByBook((current) => ({
          ...current,
          [activeBook.id]: nextSheet.id
        }));
        setExplorerSelection({ type: "sheet", id: nextSheet.id });
        showToast("已导入为新工作表");
        return;
      }

      const nextSheet: DataSheet = {
        ...sheet,
        id: makeId("sheet"),
        source:
          action === "link"
            ? {
                kind: "linked",
                fileName: file.name,
                size: file.size,
                modifiedMs: file.lastModified,
                status: "ok"
              }
            : { kind: "embedded" }
      };
      const book: DataBook = {
        id: bookId,
        name: sheet.name,
        folderId: selectedFolderId(),
        sheets: [nextSheet]
      };

      patchProject((current) => ({
        ...current,
        dataBooks: [...current.dataBooks, book]
      }));
      setExpandedBooks((current) => new Set([...current, book.id]));
      setActiveSheetByBook((current) => ({
        ...current,
        [book.id]: nextSheet.id
      }));
      openDocument({ type: "book", id: book.id });
      setExplorerSelection({ type: "book", id: book.id });
      showToast(action === "link" ? "已创建链接数据" : "已导入数据表");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "数据导入失败。");
    } finally {
      if (dataInputRef.current) dataInputRef.current.value = "";
    }
  }

  function addBlankBook() {
    const sheet: DataSheet = {
      id: makeId("sheet"),
      name: "工作表1",
      source: { kind: "embedded" },
      columns: [
        { id: makeId("col"), name: "X", role: "X", values: [null, null, null] },
        { id: makeId("col"), name: "Y", role: "Y", values: [null, null, null] }
      ]
    };
    const book: DataBook = {
      id: makeId("book"),
      name: "新数据表",
      folderId: selectedFolderId(),
      sheets: [sheet]
    };

    patchProject((current) => ({
      ...current,
      dataBooks: [...current.dataBooks, book]
    }));
    setExpandedBooks((current) => new Set([...current, book.id]));
    setActiveSheetByBook((current) => ({
      ...current,
      [book.id]: sheet.id
    }));
    openDocument({ type: "book", id: book.id });
  }

  function addSheet() {
    if (!activeBook) return;
    const sheet: DataSheet = {
      id: makeId("sheet"),
      name: "工作表" + String(activeBook.sheets.length + 1),
      source: { kind: "embedded" },
      columns: [
        { id: makeId("col"), name: "X", role: "X", values: [null, null, null] },
        { id: makeId("col"), name: "Y", role: "Y", values: [null, null, null] }
      ]
    };
    patchBook(activeBook.id, (book) => ({
      ...book,
      sheets: [...book.sheets, sheet]
    }));
    setActiveSheetByBook((current) => ({
      ...current,
      [activeBook.id]: sheet.id
    }));
    openDocument({ type: "book", id: activeBook.id });
  }

  function duplicateActiveSheet(withData: boolean) {
    if (!activeBook || !activeSheet) return;
    const copy: DataSheet = {
      ...activeSheet,
      id: makeId("sheet"),
      name: activeSheet.name + (withData ? " 副本" : " 结构"),
      source: { kind: "embedded" },
      columns: activeSheet.columns.map((column) => ({
        ...column,
        id: makeId("col"),
        values: withData ? [...column.values] : []
      }))
    };

    patchBook(activeBook.id, (book) => ({
      ...book,
      sheets: [...book.sheets, copy]
    }));
    setActiveSheetByBook((current) => ({
      ...current,
      [activeBook.id]: copy.id
    }));
    setExplorerSelection({ type: "sheet", id: copy.id });
    showToast(withData ? "已复制工作表" : "已复制工作表结构");
  }

  function reorderSheets(dragId: string, targetId: string) {
    if (!activeBook || dragId === targetId) return;
    patchBook(activeBook.id, (book) => {
      const dragged = book.sheets.find((sheet) => sheet.id === dragId);
      const next = book.sheets.filter((sheet) => sheet.id !== dragId);
      const targetIndex = next.findIndex((sheet) => sheet.id === targetId);
      if (!dragged || targetIndex < 0) return book;
      next.splice(targetIndex, 0, dragged);
      return { ...book, sheets: next };
    });
  }

  function renameSheet(sheet: DataSheet) {
    const name = window.prompt("工作表名称", sheet.name);
    if (!name?.trim()) return;
    patchSheet(sheet.id, (current) => ({
      ...current,
      name: name.trim()
    }));
  }

  function addRow() {
    if (!activeSheet || activeSheet?.source.kind === "linked") return;
    patchSheet(activeSheet.id, (sheet) => ({
      ...sheet,
      columns: sheet.columns.map((column) => ({
        ...column,
        values: [...column.values, null]
      }))
    }));
  }

  function addColumn() {
    if (!activeSheet || activeSheet?.source.kind === "linked") return;
    const rows = sheetRowCount(activeSheet);
    const column: Column = {
      id: makeId("col"),
      name: "列 " + String(activeSheet.columns.length + 1),
      role: "None",
      values: Array.from({ length: Math.max(1, rows) }, () => null)
    };
    patchSheet(activeSheet.id, (sheet) => ({
      ...sheet,
      columns: [...sheet.columns, column]
    }));
    setSelectedColumnId(column.id);
    setDataInspectorTab("column");
  }

  function updateCell(
    sheetId: string,
    columnId: string,
    rowIndex: number,
    value: CellValue
  ) {
    patchSheet(sheetId, (sheet) => ({
      ...sheet,
      columns: sheet.columns.map((column) => {
        if (column.id !== columnId) return column;
        const values = [...column.values];
        while (values.length <= rowIndex) values.push(null);
        values[rowIndex] = value;
        return { ...column, values };
      })
    }));
  }

  function updateColumn(columnId: string, patch: Partial<Column>) {
    if (!activeSheet || activeSheet?.source.kind === "linked") return;
    patchSheet(activeSheet.id, (sheet) => ({
      ...sheet,
      columns: sheet.columns.map((column) =>
        column.id === columnId ? { ...column, ...patch } : column
      )
    }));
  }

  function deleteColumn(columnId: string) {
    if (!activeSheet || activeSheet?.source.kind === "linked") return;
    if (activeSheet.columns.length <= 1) {
      showToast("数据表至少保留一列");
      return;
    }

    const dependents = project.figures.filter(
      (figure) =>
        figure.dataRef?.sheetId === activeSheet.id &&
        referencedColumnIds(figure).includes(columnId)
    );

    if (dependents.length) {
      window.alert(
        "不能删除这列：它正在被 " +
          dependents.length +
          " 张图引用。\n\n" +
          dependents.map((figure) => "• " + figure.name).join("\n") +
          "\n\n请先在图形的“数据”页移除或替换这列。"
      );
      return;
    }

    if (!window.confirm("删除这一列？")) return;

    patchSheet(activeSheet.id, (sheet) => ({
      ...sheet,
      columns: sheet.columns.filter((column) => column.id !== columnId)
    }));
  }

  function reorderColumns(dragId: string, targetId: string) {
    if (!activeSheet || activeSheet?.source.kind === "linked") return;
    patchSheet(activeSheet.id, (sheet) => {
      const columns = sheet.columns.filter((column) => column.id !== dragId);
      const dragged = sheet.columns.find((column) => column.id === dragId);
      const index = columns.findIndex((column) => column.id === targetId);
      if (!dragged || index < 0) return sheet;
      columns.splice(index, 0, dragged);
      return { ...sheet, columns };
    });
  }

  function createGraphFromSheet() {
    if (!activeSheet || !activeBook) return;
    const dataRef = defaultDataRef(activeSheet);
    if (dataRef.yColumnIds.length === 0) {
      window.alert(
        "当前工作表没有识别到可绘制的 Y 数据。你也可以先新建空图，再在图形的“数据”页手动绑定。"
      );
      return;
    }

    const dataset = sheetToDataset(activeSheet);
    const figure: FigureSpec = {
      id: makeId("figure"),
      name: "图 " + String(project.figures.length + 1),
      folderId: activeBook.folderId,
      dataRef,
      templateId: project.defaults.templateId,
      presetId: project.defaults.presetId,
      figureOverrides: {
        aspectMode: "4:3",
        ...project.defaults.figureOverrides,
        errorSeriesId: dataRef.yErrorColumnId
      },
      seriesOverrides: {},
      seriesOrder: dataRef.yColumnIds
    };

    patchProject((current) => ({
      ...current,
      figures: [...current.figures, figure],
      activeFigureId: figure.id
    }));
    openDocument({ type: "figure", id: figure.id });
    setExplorerSelection({ type: "figure", id: figure.id });
    showToast("已从列角色创建图形");
  }

  function createBlankFigure() {
    const figure: FigureSpec = {
      id: makeId("figure"),
      name: "图 " + String(project.figures.length + 1),
      folderId: selectedFolderId(),
      templateId: project.defaults.templateId,
      presetId: project.defaults.presetId,
      figureOverrides: {
        aspectMode: "4:3",
        ...project.defaults.figureOverrides
      },
      seriesOverrides: {},
      seriesOrder: []
    };

    patchProject((current) => ({
      ...current,
      figures: [...current.figures, figure],
      activeFigureId: figure.id
    }));
    openDocument({ type: "figure", id: figure.id });
    setExplorerSelection({ type: "figure", id: figure.id });
    setInspectorTab("data");
    setSelectedSeriesIds([]);
    showToast("已新建空图");
  }

  function unlinkSheet() {
    if (!activeSheet) return;
    if (
      !window.confirm(
        "解除链接后，当前缓存数据会变成可编辑的项目内数据。是否继续？"
      )
    )
      return;
    patchSheet(activeSheet.id, (sheet) => ({
      ...sheet,
      source: { kind: "embedded" }
    }));
    showToast("已解除当前工作表链接，现在可以编辑");
  }

  function pasteAsNewSheet() {
    if (!activeBook || !pasteText.trim()) return;
    try {
      const sheet = parseDelimitedText(pasteText, "粘贴数据.csv");
      const next = {
        ...sheet,
        id: makeId("sheet"),
        name: "工作表" + String(activeBook.sheets.length + 1)
      };
      patchBook(activeBook.id, (book) => ({
        ...book,
        sheets: [...book.sheets, next]
      }));
      setPasteText("");
      setPasteOpen(false);
      setActiveSheetByBook((current) => ({
        ...current,
        [activeBook.id]: next.id
      }));
      openDocument({ type: "book", id: activeBook.id });
      showToast("已粘贴为新工作表");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "无法解析粘贴数据。");
    }
  }

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
    if (!selectedSeries.length) return;
    patchActiveFigure((figure) => {
      const next = { ...figure.seriesOverrides };
      for (const id of selectedSeries) {
        next[id] = { ...(next[id] || {}), ...patch };
      }
      return { ...figure, seriesOverrides: next };
    });
  }

  function resetSelectedSeriesField(field: keyof SeriesOverride) {
    if (!selectedSeries.length) return;
    patchActiveFigure((figure) => {
      const next = { ...figure.seriesOverrides };
      for (const id of selectedSeries) {
        const value = { ...(next[id] || {}) };
        delete value[field];
        if (Object.keys(value).length === 0) delete next[id];
        else next[id] = value;
      }
      return { ...figure, seriesOverrides: next };
    });
  }

  function createFolder() {
    const name = window.prompt("新文件夹名称", "新文件夹");
    if (!name?.trim()) return;
    const parentId =
      explorerSelection?.type === "folder" ? explorerSelection.id : undefined;
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

  function renameSelected() {
    if (!explorerSelection) return;

    if (explorerSelection.type === "folder") {
      const item = project.folders.find((folder) => folder.id === explorerSelection.id);
      const name = item && window.prompt("重命名文件夹", item.name);
      if (!item || !name?.trim()) return;
      patchProject((current) => ({
        ...current,
        folders: current.folders.map((folder) =>
          folder.id === item.id ? { ...folder, name: name.trim() } : folder
        )
      }));
      return;
    }

    if (explorerSelection.type === "book") {
      const item = project.dataBooks.find((book) => book.id === explorerSelection.id);
      const name = item && window.prompt("重命名数据表", item.name);
      if (!item || !name?.trim()) return;
      patchBook(item.id, (book) => ({ ...book, name: name.trim() }));
      return;
    }

    if (explorerSelection.type === "sheet") {
      const context = findSheet(project, explorerSelection.id);
      const name = context && window.prompt("重命名工作表", context.sheet.name);
      if (!context || !name?.trim()) return;
      patchSheet(context.sheet.id, (sheet) => ({ ...sheet, name: name.trim() }));
      return;
    }

    const item = project.figures.find((figure) => figure.id === explorerSelection.id);
    const name = item && window.prompt("重命名图形", item.name);
    if (!item || !name?.trim()) return;
    patchProject((current) => ({
      ...current,
      figures: current.figures.map((figure) =>
        figure.id === item.id ? { ...figure, name: name.trim() } : figure
      )
    }));
  }

  function deleteSelected() {
    if (!explorerSelection) return;

    if (explorerSelection.type === "figure") {
      const id = explorerSelection.id;
      const item = project.figures.find((figure) => figure.id === id);
      if (!item || !window.confirm("删除图形“" + item.name + "”？")) return;
      patchProject((current) => {
        const figures = current.figures.filter((figure) => figure.id !== id);
        return {
          ...current,
          figures,
          activeFigureId:
            current.activeFigureId === id
              ? figures[0]?.id ?? ""
              : current.activeFigureId
        };
      });
      closeDocument({ type: "figure", id });
      return;
    }

    if (explorerSelection.type === "book") {
      const book = project.dataBooks.find((item) => item.id === explorerSelection.id);
      if (!book) return;
      const sheetIds = new Set(book.sheets.map((sheet) => sheet.id));
      const linkedFigures = project.figures.filter((figure) =>
        Boolean(figure.dataRef && sheetIds.has(figure.dataRef?.sheetId))
      );

      if (linkedFigures.length) {
        window.alert(
          "不能删除数据簿“" +
            book.name +
            "”：其中工作表仍被 " +
            linkedFigures.length +
            " 张图引用。\n\n" +
            linkedFigures.map((figure) => "• " + figure.name).join("\n") +
            "\n\n请先删除这些图形，或在图形的“数据”页改用其他工作表。"
        );
        return;
      }

      if (!window.confirm("删除数据簿“" + book.name + "”？")) return;

      patchProject((current) => ({
        ...current,
        dataBooks: current.dataBooks.filter((item) => item.id !== book.id)
      }));
      setOpenDocs((current) => {
        const next = current.filter(
          (doc) => !(doc.type === "book" && doc.id === book.id)
        );
        if (
          activeDoc.type === "book" &&
          activeDoc.id === book.id &&
          next.length
        ) {
          setActiveDoc(next[next.length - 1]);
        }
        return next;
      });
      return;
    }

    if (explorerSelection.type === "sheet") {
      const context = findSheet(project, explorerSelection.id);
      if (!context) return;
      if (context.book.sheets.length <= 1) {
        showToast("数据簿至少保留一个工作表");
        return;
      }
      const linked = project.figures.filter(
        (figure) => figure.dataRef?.sheetId === context.sheet.id
      );
      if (linked.length) {
        window.alert(
          "不能删除工作表“" +
            context.sheet.name +
            "”：它仍被 " +
            linked.length +
            " 张图引用。\n\n" +
            linked.map((figure) => "• " + figure.name).join("\n") +
            "\n\n请先在这些图形的“数据”页修改映射，或删除对应图形。"
        );
        return;
      }

      if (!window.confirm("删除工作表“" + context.sheet.name + "”？")) return;

      patchProject((current) => ({
        ...current,
        dataBooks: current.dataBooks.map((book) =>
          book.id === context.book.id
            ? {
                ...book,
                sheets: book.sheets.filter((sheet) => sheet.id !== context.sheet.id)
              }
            : book
        )
      }));
      const fallbackSheet = context.book.sheets.find(
        (sheet) => sheet.id !== context.sheet.id
      );
      if (fallbackSheet) {
        setActiveSheetByBook((current) => ({
          ...current,
          [context.book.id]: fallbackSheet.id
        }));
      }
      return;
    }

    const folder = project.folders.find((item) => item.id === explorerSelection.id);
    if (!folder) return;
    if (!window.confirm("删除文件夹？其中内容会移动到上一级。")) return;
    patchProject((current) => ({
      ...current,
      folders: current.folders
        .filter((item) => item.id !== folder.id)
        .map((item) =>
          item.parentId === folder.id
            ? { ...item, parentId: folder.parentId }
            : item
        ),
      dataBooks: current.dataBooks.map((book) =>
        book.folderId === folder.id
          ? { ...book, folderId: folder.parentId }
          : book
      ),
      figures: current.figures.map((figure) =>
        figure.folderId === folder.id
          ? { ...figure, folderId: folder.parentId }
          : figure
      )
    }));
  }

  function moveExplorerItem(
    type: "book" | "figure",
    id: string,
    folderId?: string
  ) {
    patchProject((current) => ({
      ...current,
      dataBooks:
        type === "book"
          ? current.dataBooks.map((book) =>
              book.id === id ? { ...book, folderId } : book
            )
          : current.dataBooks,
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
    const source = activeFigure.figureOverrides;
    const defaults: UserDefaults = {
      templateId: activeFigure.templateId,
      presetId: activeFigure.presetId,
      figureOverrides: {
        aspectMode: source.aspectMode,
        customAspectWidth: source.customAspectWidth,
        customAspectHeight: source.customAspectHeight,
        fontFamily: source.fontFamily,
        fontSizePt: source.fontSizePt,
        background: source.background,
        zTitle: source.zTitle,
        tickDirection: source.tickDirection,
        axisStyle: source.axisStyle,
        xReverse: source.xReverse,
        yReverse: source.yReverse,
        rightYReverse: source.rightYReverse,
        rightYTitle: source.rightYTitle,
        rightYScale: source.rightYScale,
        rightYAutoRange: source.rightYAutoRange,
        rightYMin: source.rightYMin,
        rightYMax: source.rightYMax,
        xMajorTickStep: source.xMajorTickStep,
        xMinorTickStep: source.xMinorTickStep,
        yMajorTickStep: source.yMajorTickStep,
        yMinorTickStep: source.yMinorTickStep,
        rightYMajorTickStep: source.rightYMajorTickStep,
        rightYMinorTickStep: source.rightYMinorTickStep,
        rightYTickFormat: source.rightYTickFormat,
        rightYTickDecimals: source.rightYTickDecimals,
        rightYTickPrefix: source.rightYTickPrefix,
        rightYTickSuffix: source.rightYTickSuffix,
        rightYTickAngle: source.rightYTickAngle,
        xTickFormat: source.xTickFormat,
        yTickFormat: source.yTickFormat,
        xTickDecimals: source.xTickDecimals,
        yTickDecimals: source.yTickDecimals,
        xTickPrefix: source.xTickPrefix,
        xTickSuffix: source.xTickSuffix,
        yTickPrefix: source.yTickPrefix,
        yTickSuffix: source.yTickSuffix,
        xTickAngle: source.xTickAngle,
        yTickAngle: source.yTickAngle,
        minorTicks: source.minorTicks,
        gridVisible: source.gridVisible,
        legendVisible: source.legendVisible,
        legendPosition: source.legendPosition,
        legendX: source.legendX,
        legendY: source.legendY,
        legendXAnchor: source.legendXAnchor,
        legendYAnchor: source.legendYAnchor,
        legendOrientation: source.legendOrientation,
        legendFrame: source.legendFrame,
        legendColumns: source.legendColumns,
        legendFontSizePt: source.legendFontSizePt,
        legendFontColor: source.legendFontColor,
        legendBackground: source.legendBackground,
        legendBackgroundOpacity: source.legendBackgroundOpacity,
        legendBorderColor: source.legendBorderColor,
        legendBorderWidthPt: source.legendBorderWidthPt,
        legendItemWidthPx: source.legendItemWidthPx,
        axisTitleColor: source.axisTitleColor,
        axisTitleSizePt: source.axisTitleSizePt,
        tickLabelColor: source.tickLabelColor,
        tickLabelSizePt: source.tickLabelSizePt,
        barGap: source.barGap,
        barGroupGap: source.barGroupGap,
        offsetStep: source.offsetStep,
        waterfallXOffset: source.waterfallXOffset,
        waterfallYOffset: source.waterfallYOffset,
        colorScale: source.colorScale,
        reverseColorScale: source.reverseColorScale,
        zAutoRange: source.zAutoRange,
        zMin: source.zMin,
        zMax: source.zMax,
        colorbarVisible: source.colorbarVisible,
        colorbarTitle: source.colorbarTitle,
        fieldEqualAspect: source.fieldEqualAspect,
        contourLevels: source.contourLevels,
        contourFill: source.contourFill,
        contourLines: source.contourLines,
        contourLabels: source.contourLabels
      }
    };

    if (scope === "user") {
      localStorage.setItem(USER_DEFAULTS_KEY, JSON.stringify(defaults));
      showToast("已保存为我的默认设置");
    } else {
      patchProject((current) => ({ ...current, defaults }));
      showToast("已保存为项目默认设置");
    }
  }

  async function resetView() {
    if (!plotRef.current || !activeFigure) return;
    if (activeFigure.templateId === "surface-3d") {
      await Plotly.relayout(plotRef.current, {
        "scene.camera": { eye: { x: 1.45, y: 1.45, z: 1.12 } }
      });
    } else {
      await Plotly.relayout(plotRef.current, {
        "xaxis.autorange": true,
        "yaxis.autorange": true,
        ...(activeFigure.templateId === "double-y"
          ? { "yaxis2.autorange": true }
          : {})
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

  function moveSheetToBook(sheetId: string, targetBookId: string) {
    const source = findSheet(project, sheetId);
    const target = project.dataBooks.find((book) => book.id === targetBookId);
    if (!source || !target || source.book.id === targetBookId) return;

    if (source.book.sheets.length <= 1) {
      showToast("源数据簿至少需要保留一个工作表");
      return;
    }

    patchProject((current) => ({
      ...current,
      dataBooks: current.dataBooks.map((book) => {
        if (book.id === source.book.id) {
          return {
            ...book,
            sheets: book.sheets.filter((sheet) => sheet.id !== sheetId)
          };
        }
        if (book.id === targetBookId) {
          return {
            ...book,
            sheets: [...book.sheets, source.sheet]
          };
        }
        return book;
      })
    }));

    setActiveSheetByBook((current) => ({
      ...current,
      [targetBookId]: sheetId,
      [source.book.id]:
        source.book.sheets.find((sheet) => sheet.id !== sheetId)?.id ?? ""
    }));
    openDocument({ type: "book", id: targetBookId });
    setExplorerSelection({ type: "sheet", id: sheetId });
    showToast("工作表已移动，图形引用保持不变");
  }

  function renderBook(book: DataBook, depth: number): ReactNode {
    const open = expandedBooks.has(book.id);
    const selected =
      explorerSelection?.type === "book" &&
      explorerSelection.id === book.id;

    return (
      <div key={book.id}>
        <button
          type="button"
          draggable
          className={selected ? "explorer-row is-selected" : "explorer-row"}
          style={{ paddingLeft: 7 + depth * 14 }}
          onDragStart={(event) =>
            event.dataTransfer.setData("text/plain", "book:" + book.id)
          }
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const [type, id] = event.dataTransfer
              .getData("text/plain")
              .split(":");
            if (type === "sheet-tree") moveSheetToBook(id, book.id);
          }}
          onClick={() => {
            setExplorerSelection({ type: "book", id: book.id });
            setExpandedBooks((current) => new Set([...current, book.id]));
            const first = book.sheets[0];
            if (first) {
              setActiveSheetByBook((current) => ({
                ...current,
                [book.id]: current[book.id] || first.id
              }));
            }
            openDocument({ type: "book", id: book.id });
          }}
        >
          <span
            className="folder-chevron"
            onClick={(event) => {
              event.stopPropagation();
              setExpandedBooks((current) => {
                const next = new Set(current);
                if (next.has(book.id)) next.delete(book.id);
                else next.add(book.id);
                return next;
              });
            }}
          >
            <TreeChevron open={open} />
          </span>
          <Icon
            kind="book"
            linked={book.sheets.some((sheet) => sheet.source.kind === "linked")}
          />
          <span className="tree-label">{book.name}</span>
        </button>

        {open &&
          book.sheets.map((sheet) => (
            <button
              key={sheet.id}
              type="button"
              draggable
              title={sheet.comment || sheet.name}
              onDragStart={(event) =>
                event.dataTransfer.setData("text/plain", "sheet-tree:" + sheet.id)
              }
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const [type, id] = event.dataTransfer
                  .getData("text/plain")
                  .split(":");
                if (type === "sheet-tree") {
                  patchBook(book.id, (currentBook) => {
                    const dragged = currentBook.sheets.find((item) => item.id === id);
                    const next = currentBook.sheets.filter((item) => item.id !== id);
                    const targetIndex = next.findIndex((item) => item.id === sheet.id);
                    if (!dragged || targetIndex < 0) return currentBook;
                    next.splice(targetIndex, 0, dragged);
                    return { ...currentBook, sheets: next };
                  });
                }
              }}
              className={
                activeDoc.type === "book" &&
                activeDoc.id === book.id &&
                activeSheet?.id === sheet.id
                  ? "explorer-row is-active"
                  : explorerSelection?.type === "sheet" &&
                    explorerSelection.id === sheet.id
                  ? "explorer-row is-selected"
                  : "explorer-row"
              }
              style={{ paddingLeft: 31 + depth * 14 }}
              onClick={() => {
                setExplorerSelection({ type: "sheet", id: sheet.id });
                setActiveSheetByBook((current) => ({
                  ...current,
                  [book.id]: sheet.id
                }));
                openDocument({ type: "book", id: book.id });
              }}
            >
              <span />
              <Icon kind="sheet" linked={sheet.source.kind === "linked"} />
              <span className="tree-label">{sheet.name}</span>
            </button>
          ))}
      </div>
    );
  }

  function renderFolder(folder: ProjectFolder, depth: number): ReactNode {
    const open = expandedFolders.has(folder.id);
    const selected =
      explorerSelection?.type === "folder" &&
      explorerSelection.id === folder.id;
    const children = project.folders.filter(
      (item) => item.parentId === folder.id
    );
    const books = project.dataBooks.filter(
      (book) => book.folderId === folder.id
    );
    const figures = project.figures.filter(
      (figure) => figure.folderId === folder.id
    );

    return (
      <div key={folder.id}>
        <button
          type="button"
          className={selected ? "explorer-row is-selected" : "explorer-row"}
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
            const [type, id] = event.dataTransfer.getData("text/plain").split(":");
            if (type === "book" || type === "figure") {
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
            <TreeChevron open={open} />
          </span>
          <Icon kind="folder" />
          <span className="tree-label">{folder.name}</span>
        </button>

        {open && (
          <>
            {children.map((child) => renderFolder(child, depth + 1))}
            {books.map((book) => renderBook(book, depth + 1))}
            {figures.map((figure) => (
              <button
                key={figure.id}
                type="button"
                draggable
                className={
                  activeDoc.type === "figure" && activeDoc.id === figure.id
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
                  openDocument({ type: "figure", id: figure.id });
                }}
              >
                <span />
                <Icon kind="graph" />
                <span className="tree-label">{figure.name}</span>
              </button>
            ))}
          </>
        )}
      </div>
    );
  }

  const effectiveFontFamily =
    activeFigure?.figureOverrides.fontFamily || preset.fontFamily;
  const effectiveFontSizePt =
    activeFigure?.figureOverrides.fontSizePt ?? preset.fontSizePt;
  const effectiveLegendVisible =
    activeFigure?.figureOverrides.legendVisible ?? true;
  const aspectMode = activeFigure?.figureOverrides.aspectMode ?? "4:3";
  const canvasMm = activeFigure
    ? resolveCanvasMm(preset, activeFigure)
    : { widthMm: preset.widthMm, heightMm: preset.heightMm };

  const lineWidth = primaryOverride.lineWidthPt ?? preset.lineWidthPt;
  const lineStyle = primaryOverride.lineStyle ?? "solid";
  const lineVisible = primaryOverride.lineVisible ?? true;
  const markerVisible =
    primaryOverride.markerVisible ??
    (activeFigure?.templateId === "xy-scatter" ||
      activeFigure?.templateId === "xy-line-marker" ||
      activeFigure?.templateId === "xy-errorbar");
  const markerSymbol = primaryOverride.markerSymbol ?? "circle";
  const markerSize = primaryOverride.markerSizePt ?? preset.markerSizePt;
  const opacity = primaryOverride.opacity ?? 1;
  const primaryIndex =
    primarySeries && plotDataset
      ? Math.max(
          0,
          plotDataset.ys.findIndex((series) => series.id === primarySeries.id)
        )
      : 0;
  const selectedColor =
    primaryOverride.color ||
    preset.palette[primaryIndex % preset.palette.length];
  const visible = primaryOverride.visible ?? true;
  const surfaceTemplate = activeFigure?.templateId === "surface-3d";
  const contourTemplate = activeFigure?.templateId === "contour";
  const field2DTemplate =
    activeFigure?.templateId === "heatmap" || contourTemplate;
  const fieldTemplate = field2DTemplate || surfaceTemplate;
  const fieldRowSeries = fieldTemplate ? orderedSeries : [];
  const fieldRowCoordinates =
    fieldTemplate && plotDataset
      ? resolveFieldRowCoordinates(plotDataset, fieldRowSeries)
      : [];
  const doubleYTemplate = activeFigure?.templateId === "double-y";
  const waterfallTemplate = activeFigure?.templateId === "waterfall";
  const offsetSpectrumTemplate =
    activeFigure?.templateId === "offset-spectrum";
  const doubleYAxisSide = (
    seriesId: string,
    fallbackIndex: number
  ): "left" | "right" => {
    const orderIndex = activeFigure?.seriesOrder.indexOf(seriesId) ?? -1;
    const stableIndex = orderIndex >= 0 ? orderIndex : fallbackIndex;
    return (
      activeFigure?.seriesOverrides[seriesId]?.yAxis ??
      (stableIndex === 0 ? "left" : "right")
    );
  };
  const leftYSeries = doubleYTemplate
    ? orderedSeries.find(
        (series, index) =>
          (activeFigure?.seriesOverrides[series.id]?.visible ?? true) &&
          doubleYAxisSide(series.id, index) === "left"
      )
    : undefined;
  const rightYSeries = doubleYTemplate
    ? orderedSeries.find(
        (series, index) =>
          (activeFigure?.seriesOverrides[series.id]?.visible ?? true) &&
          doubleYAxisSide(series.id, index) === "right"
      )
    : undefined;
  const graphInspectorTabs: Array<[InspectorTab, string]> = [
    ["data", "数据"],
    ["figure", fieldTemplate ? "图 / 色图" : "图"],
    ...(!fieldTemplate
      ? ([["series", "曲线"]] as Array<[InspectorTab, string]>)
      : []),
    ["axis", surfaceTemplate ? "标题" : "轴"],
    ...(!fieldTemplate
      ? ([["legend", "图例"]] as Array<[InspectorTab, string]>)
      : []),
    ["check", warningCount ? "检查 " + warningCount : "检查"]
  ];
  const barTemplate =
    activeFigure?.templateId === "bar" ||
    activeFigure?.templateId === "grouped-bar" ||
    activeFigure?.templateId === "stacked-bar";
  const layerIndex =
    activeFigure && primarySeries
      ? activeFigure.seriesOrder.indexOf(primarySeries.id)
      : -1;

  const rowCount = activeSheet ? sheetRowCount(activeSheet) : 0;
  const displayedRows = Math.min(rowCount, 1500);
  const selectedColumn =
    activeSheet?.columns.find((column) => column.id === selectedColumnId) ??
    activeSheet?.columns[0];
  const dataReadOnly = activeSheet?.source.kind === "linked";

  const scaledWidth = Math.max(1, Number(layout.width) * previewScale);
  const scaledHeight = Math.max(1, Number(layout.height) * previewScale);

  const rootFolders = project.folders.filter((folder) => !folder.parentId);
  const rootBooks = project.dataBooks.filter((book) => !book.folderId);
  const rootFigures = project.figures.filter((figure) => !figure.folderId);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-group">
          <div className="brand-mark">F</div>
          <div className="brand-title">FigureStudio</div>
        </div>

        <div className="top-file-actions">
          <button type="button" onClick={newProject}>新建项目</button>
          <button type="button" onClick={() => projectInputRef.current?.click()}>打开</button>
          <button type="button" onClick={() => downloadProject(project)}>保存</button>
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
          <button className="quiet-button" type="button" onClick={() => triggerDataFile("link")}>链接数据</button>
          <button className="primary-button" type="button" onClick={() => triggerDataFile("import")}>导入数据</button>
        </div>
      </header>

      <main className="workspace">
        <aside className="left-panel">
          <div className="panel-heading">
            <input
              className="project-name-input"
              value={project.name}
              onChange={(event) =>
                patchProject((current) => ({
                  ...current,
                  name: event.target.value
                }))
              }
            />
          </div>

          <div className="explorer-toolbar">
            <button type="button" onClick={createFolder} title="新建文件夹">
              <Icon kind="folder" />
            </button>
            <button type="button" onClick={addBlankBook} title="新建数据簿">
              <Icon kind="book" />
            </button>
            <button type="button" onClick={createBlankFigure} title="新建空图">
              <Icon kind="graph" />
            </button>
            <span />
            <button type="button" disabled={!explorerSelection} onClick={renameSelected} title="重命名">
              <ExplorerActionIcon kind="rename" />
            </button>
            <button type="button" disabled={!explorerSelection} onClick={deleteSelected} title="删除">
              <ExplorerActionIcon kind="delete" />
            </button>
          </div>

          <div
            className="left-scroll project-tree"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              const target = event.target as Element;
              if (target.closest(".explorer-row")) return;
              const [type, id] = event.dataTransfer.getData("text/plain").split(":");
              if (type === "book" || type === "figure") {
                moveExplorerItem(type, id, undefined);
              }
            }}
          >
            {rootFolders.map((folder) => renderFolder(folder, 0))}
            {rootBooks.map((book) => renderBook(book, 0))}
            {rootFigures.map((figure) => (
              <button
                key={figure.id}
                type="button"
                draggable
                className={
                  activeDoc.type === "figure" && activeDoc.id === figure.id
                    ? "explorer-row is-active"
                    : "explorer-row"
                }
                onDragStart={(event) =>
                  event.dataTransfer.setData("text/plain", "figure:" + figure.id)
                }
                onClick={() => {
                  setExplorerSelection({ type: "figure", id: figure.id });
                  openDocument({ type: "figure", id: figure.id });
                }}
              >
                <span />
                <Icon kind="graph" />
                <span className="tree-label">{figure.name}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="center-panel">
          <div className="document-tabs">
            {openDocs.map((doc) => (
              <button
                key={docKey(doc)}
                type="button"
                className={
                  docKey(doc) === docKey(activeDoc)
                    ? "document-tab is-active"
                    : "document-tab"
                }
                onClick={() => openDocument(doc)}
              >
                <Icon kind={doc.type === "book" ? "book" : "graph"} />
                <span>{docTitle(doc)}</span>
                <i
                  role="button"
                  aria-label="关闭"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeDocument(doc);
                  }}
                >
                  ×
                </i>
              </button>
            ))}
          </div>

          {activeDoc.type === "book" && activeSheet && activeBook ? (
            <>
              <div className="data-toolbar">
                <div className="data-toolbar-left">
                  <span
                    className={
                      activeSheet.source.kind === "linked"
                        ? "source-badge is-linked"
                        : "source-badge"
                    }
                  >
                    {activeSheet.source.kind === "linked" ? "已链接" : "项目内"}
                  </span>
                  <strong>{activeBook.name} · {activeSheet.name}</strong>
                </div>
                <div className="data-toolbar-actions">
                  <button type="button" onClick={() => setShowColumnMeta((value) => !value)}>
                    {showColumnMeta ? "隐藏备注" : "备注行"}
                  </button>
                  <button type="button" disabled={dataReadOnly} onClick={addRow}>+ 行</button>
                  <button type="button" disabled={dataReadOnly} onClick={addColumn}>+ 列</button>
                  <button type="button" onClick={() => triggerDataFile("append")}>导入工作表</button>
                  <button type="button" onClick={() => setPasteOpen(true)}>粘贴表</button>
                  <button type="button" onClick={createGraphFromSheet}>新建图</button>
                  {dataReadOnly ? (
                    <>
                      <button type="button" onClick={() => triggerDataFile("reload")}>重新加载</button>
                      <button type="button" onClick={unlinkSheet}>解除链接</button>
                    </>
                  ) : (
                    <button type="button" onClick={() => triggerDataFile("replace")}>替换表</button>
                  )}
                </div>
              </div>

              <div className="sheet-workspace">
                <div className="sheet-table-scroll">
                  <table className="data-sheet">
                    <thead>
                      <tr className="column-role-row">
                        <th className="row-index-head">#</th>
                        {activeSheet.columns.map((column, index) => (
                          <th
                            key={column.id}
                            draggable
                            className={
                              selectedColumn?.id === column.id
                                ? "data-column is-selected"
                                : "data-column"
                            }
                            onDragStart={(event) =>
                              event.dataTransfer.setData(
                                "text/plain",
                                "column:" + column.id
                              )
                            }
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => {
                              const [type, id] = event.dataTransfer
                                .getData("text/plain")
                                .split(":");
                              if (type === "column") reorderColumns(id, column.id);
                            }}
                            onClick={() => {
                              setSelectedColumnId(column.id);
                              setDataInspectorTab("column");
                            }}
                          >
                            <div className="column-letter">
                              <span>{columnLabel(index, column.role)}</span>
                              {!dataReadOnly && (
                                <button
                                  type="button"
                                  title="删除列"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    deleteColumn(column.id);
                                  }}
                                >
                                  ×
                                </button>
                              )}
                            </div>
                            <select
                              value={column.role}
                              disabled={dataReadOnly}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) =>
                                updateColumn(column.id, {
                                  role: event.target.value as ColumnRole
                                })
                              }
                            >
                              {ROLE_OPTIONS.map((item) => (
                                <option key={item.value} value={item.value}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          </th>
                        ))}
                      </tr>
                      <tr className="column-name-row">
                        <th className="row-index-head">名称</th>
                        {activeSheet.columns.map((column) => (
                          <th key={column.id}>
                            <input
                              value={column.name}
                              readOnly={dataReadOnly}
                              onFocus={() => setSelectedColumnId(column.id)}
                              onChange={(event) =>
                                updateColumn(column.id, { name: event.target.value })
                              }
                            />
                          </th>
                        ))}
                      </tr>
                      <tr className="column-unit-row">
                        <th className="row-index-head">单位</th>
                        {activeSheet.columns.map((column) => (
                          <th key={column.id}>
                            <input
                              value={column.unit ?? ""}
                              readOnly={dataReadOnly}
                              placeholder="—"
                              onFocus={() => setSelectedColumnId(column.id)}
                              onChange={(event) =>
                                updateColumn(column.id, {
                                  unit: event.target.value || undefined
                                })
                              }
                            />
                          </th>
                        ))}
                      </tr>
                      {showColumnMeta && (
                        <tr className="column-comment-row">
                          <th className="row-index-head">备注</th>
                          {activeSheet.columns.map((column) => (
                            <th key={column.id}>
                              <input
                                value={column.comment ?? ""}
                                readOnly={dataReadOnly}
                                placeholder="—"
                                onFocus={() => setSelectedColumnId(column.id)}
                                onChange={(event) =>
                                  updateColumn(column.id, {
                                    comment: event.target.value || undefined
                                  })
                                }
                              />
                            </th>
                          ))}
                        </tr>
                      )}
                    </thead>
                    <tbody>
                      {Array.from({ length: displayedRows }, (_, rowIndex) => (
                        <tr key={rowIndex}>
                          <th className="row-number">{rowIndex + 1}</th>
                          {activeSheet.columns.map((column) => (
                            <td key={column.id}>
                              <CellEditor
                                value={column.values[rowIndex] ?? null}
                                role={column.role}
                                readOnly={Boolean(dataReadOnly)}
                                onCommit={(value) =>
                                  updateCell(
                                    activeSheet.id,
                                    column.id,
                                    rowIndex,
                                    value
                                  )
                                }
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rowCount > displayedRows && (
                    <div className="row-limit-note">
                      当前表有 {rowCount} 行；Web 编辑器为保证流畅仅显示前 {displayedRows} 行，绘图仍使用全部数据。
                    </div>
                  )}
                </div>
                <div className="sheet-tabs">
                  {activeBook.sheets.map((sheet) => (
                    <button
                      key={sheet.id}
                      type="button"
                      draggable={!dataReadOnly}
                      title={sheet.comment || sheet.name}
                      className={sheet.id === activeSheet.id ? "is-active" : ""}
                      onDragStart={(event) =>
                        event.dataTransfer.setData("text/plain", "sheet-tab:" + sheet.id)
                      }
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        const [type, id] = event.dataTransfer
                          .getData("text/plain")
                          .split(":");
                        if (type === "sheet-tab") reorderSheets(id, sheet.id);
                      }}
                      onDoubleClick={() => !dataReadOnly && renameSheet(sheet)}
                      onClick={() => {
                        setExplorerSelection({ type: "sheet", id: sheet.id });
                        setActiveSheetByBook((current) => ({
                          ...current,
                          [activeBook.id]: sheet.id
                        }));
                      }}
                    >
                      <Icon
                        kind="sheet"
                        linked={sheet.source.kind === "linked"}
                      />
                      <span>{sheet.name}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="sheet-tab-add"
                    onClick={addSheet}
                    title="新建项目内工作表"
                  >
                    +
                  </button>
                </div>
              </div>
            </>
          ) : activeFigure && plotDataset ? (
            <>
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
                  <button
                    type="button"
                    disabled={!figureSheet || !activeFigure.dataRef}
                    onClick={() => {
                      if (activeFigure.dataRef) {
                        activeFigure.dataRef && openSheetDocument(activeFigure.dataRef.sheetId);
                      }
                    }}
                  >
                    源数据
                  </button>
                  <button type="button" onClick={() => void resetView()}>重置</button>
                  <button type="button" onClick={() => void exportFigure("svg")}>SVG</button>
                  <button type="button" onClick={() => void exportFigure("png")}>PNG</button>
                  <button
                    type="button"
                    disabled={figureInput?.state !== "ready"}
                    onClick={() =>
                      downloadMatplotlibScript(
                        plotDataset,
                        activeFigure,
                        preset
                      )
                    }
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
            </>
          ) : (
            <div className="empty-document">从左侧打开一个数据表或图形。</div>
          )}
        </section>

        <aside className="right-panel">
          {activeDoc.type === "book" && activeSheet && activeBook ? (
            <>
              <div className="data-inspector-tabs">
                <button
                  type="button"
                  className={dataInspectorTab === "data" ? "is-active" : ""}
                  onClick={() => setDataInspectorTab("data")}
                >
                  数据
                </button>
                <button
                  type="button"
                  className={dataInspectorTab === "column" ? "is-active" : ""}
                  onClick={() => setDataInspectorTab("column")}
                >
                  列
                </button>
              </div>

              <div className="inspector-scroll">
                {dataInspectorTab === "data" && (
                  <section className="inspector-pane">
                    <div className="pane-heading">
                      <strong>{activeBook.name}</strong>
                    </div>

                    <div className="prop-row">
                      <label>来源</label>
                      <span className="property-text">
                        {activeSheet.source.kind === "linked" ? "链接数据" : "项目内数据"}
                      </span>
                    </div>

                    {activeSheet.source.kind === "linked" && (
                      <>
                        <div className="prop-row">
                          <label>文件</label>
                          <span className="property-text ellipsis">
                            {activeSheet.source.fileName ?? "未定位"}
                          </span>
                        </div>
                        <div className="prop-row">
                          <label>状态</label>
                          <span
                            className={
                              activeSheet.source.status === "ok"
                                ? "link-status is-ok"
                                : "link-status"
                            }
                          >
                            {activeSheet.source.status === "ok"
                              ? "已链接"
                              : "需要重新定位"}
                          </span>
                        </div>
                      </>
                    )}

                    <div className="section-divider">数据簿 / 工作表</div>

                    <div className="prop-row">
                      <label>数据簿</label>
                      <input
                        value={activeBook.name}
                        onChange={(event) =>
                          patchBook(activeBook.id, (book) => ({
                            ...book,
                            name: event.target.value
                          }))
                        }
                      />
                    </div>
                    <div className="prop-row">
                      <label>工作表</label>
                      <input
                        value={activeSheet.name}
                        onChange={(event) =>
                          patchSheet(activeSheet.id, (sheet) => ({
                            ...sheet,
                            name: event.target.value
                          }))
                        }
                      />
                    </div>
                    <div className="prop-row">
                      <label>备注</label>
                      <input
                        value={activeSheet.comment ?? ""}
                        readOnly={dataReadOnly}
                        placeholder="实验条件、样品、用途…"
                        onChange={(event) =>
                          patchSheet(activeSheet.id, (sheet) => ({
                            ...sheet,
                            comment: event.target.value || undefined
                          }))
                        }
                      />
                    </div>
                    <div className="prop-row prop-muted">
                      <label>行数</label>
                      <span>{rowCount}</span>
                    </div>
                    <div className="prop-row prop-muted">
                      <label>列数</label>
                      <span>{activeSheet.columns.length}</span>
                    </div>

                    <div className="section-divider">依赖图形 · {dependentFigures.length}</div>
                    <div className="dependents-list">
                      {dependentFigures.length ? (
                        dependentFigures.map((figure) => (
                          <button
                            key={figure.id}
                            type="button"
                            onClick={() => openDocument({ type: "figure", id: figure.id })}
                          >
                            <Icon kind="graph" />
                            <span>{figure.name}</span>
                          </button>
                        ))
                      ) : (
                        <span className="empty-dependents">当前工作表尚未被图形使用</span>
                      )}
                    </div>

                    <div className="source-actions">
                      {activeSheet.source.kind === "linked" ? (
                        <>
                          <button type="button" onClick={() => triggerDataFile("reload")}>重新选择 / 加载</button>
                          <button type="button" onClick={() => duplicateActiveSheet(true)}>创建可编辑副本</button>
                          <button type="button" onClick={unlinkSheet}>解除链接并编辑</button>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={createGraphFromSheet}>按列角色新建图</button>
                          <button type="button" onClick={() => triggerDataFile("replace")}>替换当前表</button>
                          <div className="sheet-copy-actions">
                            <button type="button" onClick={() => duplicateActiveSheet(true)}>
                              复制工作表
                            </button>
                            <button type="button" onClick={() => duplicateActiveSheet(false)}>
                              复制结构
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </section>
                )}

                {dataInspectorTab === "column" && selectedColumn && (
                  <section className="inspector-pane">
                    <div className="pane-heading">
                      <strong>{selectedColumn.name}</strong>
                      <span>{selectedColumn.role}</span>
                    </div>

                    <div className="prop-row">
                      <label>名称</label>
                      <input
                        value={selectedColumn.name}
                        readOnly={dataReadOnly}
                        onChange={(event) =>
                          updateColumn(selectedColumn.id, {
                            name: event.target.value
                          })
                        }
                      />
                    </div>
                    <div className="prop-row">
                      <label>单位</label>
                      <input
                        value={selectedColumn.unit ?? ""}
                        readOnly={dataReadOnly}
                        onChange={(event) =>
                          updateColumn(selectedColumn.id, {
                            unit: event.target.value || undefined
                          })
                        }
                      />
                    </div>
                    <div className="prop-row">
                      <label>备注</label>
                      <input
                        value={selectedColumn.comment ?? ""}
                        readOnly={dataReadOnly}
                        onChange={(event) =>
                          updateColumn(selectedColumn.id, {
                            comment: event.target.value || undefined
                          })
                        }
                      />
                    </div>
                    <div className="prop-row">
                      <label>角色</label>
                      <select
                        value={selectedColumn.role}
                        disabled={dataReadOnly}
                        onChange={(event) =>
                          updateColumn(selectedColumn.id, {
                            role: event.target.value as ColumnRole
                          })
                        }
                      >
                        {ROLE_OPTIONS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="prop-row prop-muted">
                      <label>有效值</label>
                      <span>
                        {
                          selectedColumn.values.filter(
                            (value) => value !== null && value !== ""
                          ).length
                        }
                      </span>
                    </div>

                    <div className="column-role-help">
                      <strong>列角色</strong>
                      <p><b>X</b> 横坐标；<b>Y</b> 主数据；<b>Z</b> 场数据角色；<b>XErr / YErr</b> 误差；<b>Label</b> 文本标签。</p>
                      <p>当前 Heatmap / Contour / 3D 使用“多列组成矩阵”的简单模式；XYZ 散点插值将作为独立输入模式提供。</p>
                      <p>角色只决定“新建图”时的默认映射；已有图通过稳定 Column ID 引用，不会因你改角色而突然换数据。</p>
                    </div>
                  </section>
                )}
              </div>
            </>
          ) : activeFigure && plotDataset ? (
            <>
              <div className="inspector-tabs">
                {graphInspectorTabs.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={inspectorTab === id ? "is-active" : ""}
                    onClick={() => setInspectorTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="inspector-scroll">
                {inspectorTab === "data" && (
                  <section className="inspector-pane">
                    <div className="pane-heading">
                      <strong>数据输入</strong>
                      <span
                        className={
                          "input-state-badge is-" +
                          (figureInput?.state ?? "empty")
                        }
                      >
                        {figureInput?.label ?? "空图"}
                      </span>
                    </div>

                    <div className="input-state-detail">
                      {figureInput?.detail}
                    </div>

                    <div className="prop-row">
                      <label>工作表</label>
                      <select
                        value={activeFigure.dataRef?.sheetId ?? ""}
                        onChange={(event) => {
                          const sheetId = event.target.value;
                          if (!sheetId) {
                            patchActiveFigure((figure) => ({
                              ...figure,
                              dataRef: undefined,
                              seriesOrder: [],
                              seriesOverrides: {},
                              figureOverrides: {
                                ...figure.figureOverrides,
                                errorSeriesId: undefined
                              }
                            }));
                            setSelectedSeriesIds([]);
                            return;
                          }

                          const context = findSheet(project, sheetId);
                          if (!context) return;
                          const dataRef = defaultDataRef(context.sheet);
                          patchActiveFigure((figure) => ({
                            ...figure,
                            dataRef,
                            seriesOrder: dataRef.yColumnIds,
                            seriesOverrides: {},
                            figureOverrides: {
                              ...figure.figureOverrides,
                              errorSeriesId: dataRef.yErrorColumnId
                            }
                          }));
                          setSelectedSeriesIds(dataRef.yColumnIds.slice(0, 1));
                        }}
                      >
                        <option value="">未选择（空图）</option>
                        {allSheets.map(({ book, sheet }) => (
                          <option key={sheet.id} value={sheet.id}>
                            {book.name} / {sheet.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {activeFigure.dataRef && !figureSheet && (
                      <div className="mapping-warning">
                        原工作表无法解析。请选择新的工作表恢复数据映射。
                      </div>
                    )}

                    {activeFigure.dataRef && figureSheet && (
                      <>
                        <div className="prop-row">
                          <label>X</label>
                          <select
                            value={activeFigure.dataRef.xColumnId ?? ""}
                            onChange={(event) =>
                              patchActiveFigure((figure) => ({
                                ...figure,
                                dataRef: {
                                  ...(figure.dataRef ?? {
                                    sheetId: figureSheet.id,
                                    yColumnIds: []
                                  }),
                                  xColumnId: event.target.value || undefined
                                }
                              }))
                            }
                          >
                            <option value="">行号（自动）</option>
                            {figureSheet.columns
                              .filter((column) => column.role !== "Label")
                              .map((column, index) => (
                                <option key={column.id} value={column.id}>
                                  {columnLabel(index, column.role)} · {column.name}
                                </option>
                              ))}
                          </select>
                        </div>

                        <div className="section-divider">
                          {fieldTemplate ? "矩阵行 / Z 数据" : "Y / 数据列"} ·{" "}
                          {activeFigure.dataRef.yColumnIds.length}
                        </div>
                        <div className="mapping-series-list">
                          {figureSheet.columns
                            .filter(
                              (column) =>
                                column.id !== activeFigure.dataRef?.xColumnId &&
                                column.role !== "Label" &&
                                column.role !== "XErr" &&
                                column.role !== "YErr"
                            )
                            .map((column) => {
                              const index = figureSheet.columns.findIndex(
                                (item) => item.id === column.id
                              );
                              const checked =
                                activeFigure.dataRef?.yColumnIds.includes(
                                  column.id
                                ) ?? false;
                              return (
                                <label
                                  key={column.id}
                                  className={checked ? "is-mapped" : ""}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      const current =
                                        activeFigure.dataRef?.yColumnIds ?? [];
                                      const next = checked
                                        ? current.filter((id) => id !== column.id)
                                        : [...current, column.id];
                                      patchActiveFigure((figure) => ({
                                        ...figure,
                                        dataRef: {
                                          ...(figure.dataRef ?? {
                                            sheetId: figureSheet.id,
                                            yColumnIds: []
                                          }),
                                          yColumnIds: next
                                        },
                                        seriesOrder: [
                                          ...figure.seriesOrder.filter((id) =>
                                            next.includes(id)
                                          ),
                                          ...next.filter(
                                            (id) =>
                                              !figure.seriesOrder.includes(id)
                                          )
                                        ]
                                      }));
                                    }}
                                  />
                                  <span>
                                    {columnLabel(index, column.role)} · {column.name}
                                  </span>
                                </label>
                              );
                            })}
                        </div>

                        {fieldTemplate && (
                          <div className="field-data-note">
                            <strong>矩阵模式</strong>
                            <span>
                              每个勾选列是一行 Z 数据；X 列给出横向坐标。
                              Y 行坐标可在下方设置；未设置时会尝试数字列名，否则使用 0, 1, 2…
                            </span>
                          </div>
                        )}

                        {fieldTemplate && (
                          <div className="field-row-axis-editor">
                            <div className="section-divider">Y 行轴</div>
                            <div className="field-axis-name-grid">
                              <label>
                                <span>名称</span>
                                <input
                                  type="text"
                                  value={figureSheet.metadata?.rowAxisName ?? ""}
                                  placeholder="温度 / 时间 / 泵浦功率"
                                  onChange={(event) =>
                                    patchSheet(figureSheet.id, (sheet) => ({
                                      ...sheet,
                                      metadata: {
                                        ...(sheet.metadata ?? {}),
                                        rowAxisName:
                                          event.target.value || undefined
                                      }
                                    }))
                                  }
                                />
                              </label>
                              <label>
                                <span>单位</span>
                                <input
                                  type="text"
                                  value={figureSheet.metadata?.rowAxisUnit ?? ""}
                                  placeholder="°C / min / W"
                                  onChange={(event) =>
                                    patchSheet(figureSheet.id, (sheet) => ({
                                      ...sheet,
                                      metadata: {
                                        ...(sheet.metadata ?? {}),
                                        rowAxisUnit:
                                          event.target.value || undefined
                                      }
                                    }))
                                  }
                                />
                              </label>
                            </div>
                            <label className="field-row-values">
                              <span>
                                行坐标 · 当前 {fieldRowSeries.length} 行
                              </span>
                              <input
                                key={
                                  activeFigure.id +
                                  ":" +
                                  fieldRowSeries.map((row) => row.id).join(",") +
                                  ":" +
                                  fieldRowCoordinates.join(",")
                                }
                                type="text"
                                defaultValue={fieldRowCoordinates.join(", ")}
                                placeholder="例如 0, 5, 10, 15"
                                onBlur={(event) => {
                                  const raw = event.currentTarget.value.trim();
                                  if (!raw) {
                                    patchSheet(figureSheet.id, (sheet) => {
                                      const metadata = {
                                        ...(sheet.metadata ?? {})
                                      };
                                      const map = {
                                        ...(metadata.rowCoordinateByColumnId ??
                                          {})
                                      };
                                      for (const row of fieldRowSeries) {
                                        delete map[row.id];
                                      }
                                      metadata.rowCoordinateByColumnId =
                                        Object.keys(map).length
                                          ? map
                                          : undefined;
                                      metadata.rowCoordinates = undefined;
                                      return { ...sheet, metadata };
                                    });
                                    return;
                                  }

                                  const values = raw
                                    .split(/[，,;；\s]+/)
                                    .filter(Boolean)
                                    .map(Number);
                                  if (
                                    values.length !== fieldRowSeries.length ||
                                    values.some(
                                      (value) => !Number.isFinite(value)
                                    )
                                  ) {
                                    window.alert(
                                      "Y 行坐标需要 " +
                                        fieldRowSeries.length +
                                        " 个有限数字，并与当前矩阵行一一对应。"
                                    );
                                    event.currentTarget.value =
                                      fieldRowCoordinates.join(", ");
                                    return;
                                  }

                                  patchSheet(figureSheet.id, (sheet) => ({
                                    ...sheet,
                                    metadata: {
                                      ...(sheet.metadata ?? {}),
                                      rowCoordinates: undefined,
                                      rowCoordinateByColumnId: {
                                        ...(sheet.metadata
                                          ?.rowCoordinateByColumnId ?? {}),
                                        ...Object.fromEntries(
                                          fieldRowSeries.map((row, index) => [
                                            row.id,
                                            values[index]
                                          ])
                                        )
                                      }
                                    }
                                  }));
                                }}
                              />
                            </label>
                            <div className="field-data-note is-compact">
                              坐标绑定数据列 ID；重排、隐藏或选择子集后仍跟随正确行。
                              清空可恢复自动坐标。
                            </div>
                          </div>
                        )}

                        {activeFigure.templateId === "xy-errorbar" && (
                          <>
                            <div className="section-divider">辅助列</div>
                            <div className="prop-row">
                              <label>Y 误差</label>
                              <select
                                value={
                                  activeFigure.dataRef.yErrorColumnId ?? ""
                                }
                                onChange={(event) =>
                                  patchActiveFigure((figure) => ({
                                    ...figure,
                                    dataRef: {
                                      ...(figure.dataRef ?? {
                                        sheetId: figureSheet.id,
                                        yColumnIds: []
                                      }),
                                      yErrorColumnId:
                                        event.target.value || undefined
                                    },
                                    figureOverrides: {
                                      ...figure.figureOverrides,
                                      errorSeriesId:
                                        event.target.value || undefined
                                    }
                                  }))
                                }
                              >
                                <option value="">无</option>
                                {figureSheet.columns.map((column, index) => (
                                  <option key={column.id} value={column.id}>
                                    {columnLabel(index, column.role)} ·{" "}
                                    {column.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </>
                        )}

                        <div className="mapping-actions">
                          <button
                            type="button"
                            onClick={() =>
                              openSheetDocument(activeFigure.dataRef!.sheetId)
                            }
                          >
                            打开源数据簿
                          </button>
                        </div>
                      </>
                    )}

                    {!activeFigure.dataRef && (
                      <div className="empty-input-card">
                        <Icon kind="graph" />
                        <strong>这是一个空图</strong>
                        <p>
                          可以先设置图型、尺寸和样式。需要数据时，再在上方选择工作表并指定数据列。
                        </p>
                        <p>
                          对当前 XY / 柱状图，X 可以留空并自动使用 1, 2, 3… 行号；至少需要一列 Y 才进入“可绘制”状态。
                        </p>
                      </div>
                    )}

                    <div className="column-role-help">
                      <strong>输入状态</strong>
                      <p>
                        空图 = 未绑定数据；待完成 = 已选工作表但映射不足；可绘制 = 当前图型要求已满足；引用失效 = 原数据对象不存在。
                      </p>
                    </div>
                  </section>
                )}

                {inspectorTab === "figure" && (
                  <section className="inspector-pane">
                    <div className="pane-heading">
                      <strong>{activeFigure.name}</strong>
                      <span>
                        <button type="button" onClick={() => saveDefault("project")}>项目默认</button>
                        <button type="button" onClick={() => saveDefault("user")}>我的默认</button>
                      </span>
                    </div>

                    <div className="prop-row">
                      <label>数据表</label>
                      <span className="property-text ellipsis">
                        {figureSheetContext?.book.name} · {figureSheet?.name}
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

                    <div className="prop-row prop-muted">
                      <label>尺寸</label>
                      <span>
                        {canvasMm.widthMm.toFixed(0)} × {canvasMm.heightMm.toFixed(1)} mm
                      </span>
                    </div>

                    {(offsetSpectrumTemplate || waterfallTemplate) && (
                      <>
                        <div className="section-divider">
                          {waterfallTemplate ? "瀑布偏移" : "堆叠偏移"}
                        </div>
                        {waterfallTemplate && (
                          <div className="prop-row">
                            <label>X 偏移 / 层</label>
                            <input
                              type="number"
                              step="any"
                              disabled={xAxisCategorical}
                              value={
                                activeFigure.figureOverrides.waterfallXOffset ??
                                0.5
                              }
                              onChange={(event) =>
                                setFigureField(
                                  "waterfallXOffset",
                                  Number(event.target.value)
                                )
                              }
                            />
                          </div>
                        )}
                        <div className="prop-row">
                          <label>Y 偏移 / 层</label>
                          <input
                            type="number"
                            step="any"
                            value={
                              waterfallTemplate
                                ? activeFigure.figureOverrides.waterfallYOffset ??
                                  5
                                : activeFigure.figureOverrides.offsetStep ?? 5
                            }
                            onChange={(event) =>
                              setFigureField(
                                waterfallTemplate
                                  ? "waterfallYOffset"
                                  : "offsetStep",
                                Number(event.target.value)
                              )
                            }
                          />
                        </div>
                        {waterfallTemplate && xAxisCategorical && (
                          <div className="axis-note">
                            分类 X 不执行数值 X 偏移；Y 偏移仍然有效。
                          </div>
                        )}
                      </>
                    )}

                    {fieldTemplate && (
                      <>
                        <div className="section-divider">场图 / 色图</div>
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
                            checked={
                              activeFigure.figureOverrides.reverseColorScale ??
                              false
                            }
                            onChange={(value) =>
                              setFigureField("reverseColorScale", value)
                            }
                          />
                        </div>
                        <div className="prop-row">
                          <label>色条</label>
                          <MiniSwitch
                            checked={
                              activeFigure.figureOverrides.colorbarVisible ??
                              true
                            }
                            onChange={(value) =>
                              setFigureField("colorbarVisible", value)
                            }
                          />
                        </div>
                        <div className="prop-row">
                          <label>色条标题</label>
                          <input
                            type="text"
                            value={
                              activeFigure.figureOverrides.colorbarTitle ?? ""
                            }
                            onChange={(event) =>
                              setFigureField(
                                "colorbarTitle",
                                event.target.value || undefined
                              )
                            }
                          />
                        </div>

                        <div className="section-divider">Z 范围</div>
                        <div className="prop-row">
                          <label>自动范围</label>
                          <MiniSwitch
                            checked={
                              activeFigure.figureOverrides.zAutoRange !== false
                            }
                            onChange={(value) =>
                              setFigureField("zAutoRange", value)
                            }
                          />
                        </div>
                        <div className="field-range-grid">
                          <label>
                            <span>最小</span>
                            <input
                              type="number"
                              step="any"
                              disabled={
                                activeFigure.figureOverrides.zAutoRange !== false
                              }
                              value={activeFigure.figureOverrides.zMin ?? ""}
                              onChange={(event) =>
                                setFigureField(
                                  "zMin",
                                  event.target.value === ""
                                    ? undefined
                                    : Number(event.target.value)
                                )
                              }
                            />
                          </label>
                          <label>
                            <span>最大</span>
                            <input
                              type="number"
                              step="any"
                              disabled={
                                activeFigure.figureOverrides.zAutoRange !== false
                              }
                              value={activeFigure.figureOverrides.zMax ?? ""}
                              onChange={(event) =>
                                setFigureField(
                                  "zMax",
                                  event.target.value === ""
                                    ? undefined
                                    : Number(event.target.value)
                                )
                              }
                            />
                          </label>
                        </div>

                        {field2DTemplate && (
                          <div className="prop-row">
                            <label>XY 等比例</label>
                            <MiniSwitch
                              checked={
                                activeFigure.figureOverrides.fieldEqualAspect ??
                                activeFigure.templateId === "heatmap"
                              }
                              onChange={(value) =>
                                setFigureField("fieldEqualAspect", value)
                              }
                            />
                          </div>
                        )}

                        {contourTemplate && (
                          <>
                            <div className="section-divider">等高线</div>
                            <div className="prop-row">
                              <label>级数</label>
                              <input
                                type="number"
                                min="3"
                                max="64"
                                step="1"
                                value={
                                  activeFigure.figureOverrides.contourLevels ??
                                  12
                                }
                                onChange={(event) =>
                                  setFigureField(
                                    "contourLevels",
                                    Math.max(
                                      3,
                                      Math.min(64, Number(event.target.value))
                                    )
                                  )
                                }
                              />
                            </div>
                            <div className="prop-row">
                              <label>填色</label>
                              <MiniSwitch
                                checked={
                                  activeFigure.figureOverrides.contourFill !==
                                  false
                                }
                                onChange={(value) => {
                                  setFigureField("contourFill", value);
                                  if (!value) {
                                    setFigureField("contourLines", true);
                                  }
                                }}
                              />
                            </div>
                            <div className="prop-row">
                              <label>等高线</label>
                              <MiniSwitch
                                checked={
                                  activeFigure.figureOverrides.contourLines !==
                                  false
                                }
                                onChange={(value) =>
                                  setFigureField("contourLines", value)
                                }
                              />
                            </div>
                            <div className="prop-row">
                              <label>线标签</label>
                              <MiniSwitch
                                checked={
                                  activeFigure.figureOverrides.contourLabels ??
                                  false
                                }
                                onChange={(value) => {
                                  setFigureField("contourLabels", value);
                                  if (value) {
                                    setFigureField("contourLines", true);
                                  }
                                }}
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
                        {selectedSeries.length > 1
                          ? selectedSeries.length + " 条曲线"
                          : primarySeries.name}
                      </strong>
                      <span>Ctrl / ⌘ 多选</span>
                    </div>

                    <div className="series-selector">
                      {orderedSeries.map((series) => {
                        const sourceIndex = Math.max(
                          0,
                          plotDataset.ys.findIndex((item) => item.id === series.id)
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
                              selectedSeries.includes(series.id)
                                ? "series-select-row is-selected"
                                : "series-select-row"
                            }
                            onClick={(event) =>
                              selectSeries(series.id, event.ctrlKey || event.metaKey)
                            }
                          >
                            <i style={{ backgroundColor: color }} />
                            <span>{series.name}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="section-divider">样式</div>

                    <div className="prop-row">
                      <label>显示</label>
                      <MiniSwitch
                        checked={visible}
                        onChange={(value) => updateSelectedSeries({ visible: value })}
                      />
                    </div>

                    <div className="prop-row">
                      <label>图例显示</label>
                      <MiniSwitch
                        checked={primaryOverride.showInLegend ?? true}
                        onChange={(value) =>
                          updateSelectedSeries({ showInLegend: value })
                        }
                      />
                    </div>

                    <div className="prop-row">
                      <label>图例名称</label>
                      <div className="control-with-reset">
                        <input
                          type="text"
                          disabled={selectedSeries.length !== 1}
                          placeholder={primarySeries.name}
                          value={primaryOverride.legendLabel ?? ""}
                          onChange={(event) =>
                            updateSelectedSeries({
                              legendLabel:
                                event.target.value === ""
                                  ? undefined
                                  : event.target.value
                            })
                          }
                        />
                        <ResetIcon
                          visible={primaryOverride.legendLabel !== undefined}
                          onReset={() =>
                            resetSelectedSeriesField("legendLabel")
                          }
                        />
                      </div>
                    </div>

                    {doubleYTemplate && (
                      <div className="prop-row">
                        <label>绘制到 Y 轴</label>
                        <select
                          value={
                            primaryOverride.yAxis ??
                            (layerIndex === 0 ? "left" : "right")
                          }
                          onChange={(event) =>
                            updateSelectedSeries({
                              yAxis: event.target.value as "left" | "right"
                            })
                          }
                        >
                          <option value="left">左 Y</option>
                          <option value="right">右 Y</option>
                        </select>
                      </div>
                    )}

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
                        </div>
                      </>
                    )}

                    <div className="prop-row">
                      <label>透明度</label>
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
                    </div>

                    {barTemplate && (
                      <div className="prop-row">
                        <label>颜色模式</label>
                        <select
                          value={primaryOverride.barColorMode ?? "series"}
                          onChange={(event) =>
                            updateSelectedSeries({
                              barColorMode: event.target.value as
                                | "series"
                                | "points"
                            })
                          }
                        >
                          <option value="series">统一 / 按系列</option>
                          <option value="points">按数据点调色板</option>
                        </select>
                      </div>
                    )}

                    <div className="prop-row">
                      <label>{barTemplate ? "填充颜色" : "颜色"}</label>
                      <div className="control-with-reset color-control">
                        <input
                          type="color"
                          disabled={
                            barTemplate &&
                            (primaryOverride.barColorMode ?? "series") === "points"
                          }
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

                    {barTemplate && (
                      <>
                        <div className="prop-row">
                          <label>边框颜色</label>
                          <div className="control-with-reset color-control">
                            <input
                              type="color"
                              value={primaryOverride.barBorderColor ?? selectedColor}
                              onChange={(event) =>
                                updateSelectedSeries({
                                  barBorderColor: event.target.value
                                })
                              }
                            />
                            <span>
                              {(primaryOverride.barBorderColor ?? selectedColor).toUpperCase()}
                            </span>
                            <ResetIcon
                              visible={primaryOverride.barBorderColor !== undefined}
                              onReset={() =>
                                resetSelectedSeriesField("barBorderColor")
                              }
                            />
                          </div>
                        </div>
                        <div className="prop-row">
                          <label>边框宽度</label>
                          <div className="compact-number">
                            <input
                              type="number"
                              min="0"
                              max="4"
                              step="0.1"
                              value={primaryOverride.barBorderWidthPt ?? 0.3}
                              onChange={(event) =>
                                updateSelectedSeries({
                                  barBorderWidthPt: Number(event.target.value)
                                })
                              }
                            />
                            <span>pt</span>
                          </div>
                        </div>
                        <div className="prop-row">
                          <label>柱间距</label>
                          <div className="compact-number">
                            <input
                              type="number"
                              min="0"
                              max="90"
                              step="1"
                              value={Math.round(
                                (activeFigure.figureOverrides.barGap ?? 0.2) * 100
                              )}
                              onChange={(event) =>
                                setFigureField(
                                  "barGap",
                                  Number(event.target.value) / 100
                                )
                              }
                            />
                            <span>%</span>
                          </div>
                        </div>
                        <div className="prop-row">
                          <label>组内间距</label>
                          <div className="compact-number">
                            <input
                              type="number"
                              min="0"
                              max="90"
                              step="1"
                              value={Math.round(
                                (activeFigure.figureOverrides.barGroupGap ?? 0.08) *
                                  100
                              )}
                              onChange={(event) =>
                                setFigureField(
                                  "barGroupGap",
                                  Number(event.target.value) / 100
                                )
                              }
                            />
                            <span>%</span>
                          </div>
                        </div>
                      </>
                    )}

                    <div className="prop-row">
                      <label>图层</label>
                      <div className="layer-inline">
                        <button
                          type="button"
                          disabled={layerIndex <= 0}
                          onClick={() => {
                            if (!primarySeries) return;
                            patchActiveFigure((figure) => {
                              const order = [...figure.seriesOrder];
                              const index = order.indexOf(primarySeries.id);
                              if (index <= 0) return figure;
                              [order[index - 1], order[index]] = [
                                order[index],
                                order[index - 1]
                              ];
                              return { ...figure, seriesOrder: order };
                            });
                          }}
                        >
                          <LayerArrowIcon direction="down" />
                        </button>
                        <button
                          type="button"
                          disabled={
                            !activeFigure ||
                            layerIndex >= activeFigure.seriesOrder.length - 1
                          }
                          onClick={() => {
                            if (!primarySeries) return;
                            patchActiveFigure((figure) => {
                              const order = [...figure.seriesOrder];
                              const index = order.indexOf(primarySeries.id);
                              if (index < 0 || index >= order.length - 1) return figure;
                              [order[index], order[index + 1]] = [
                                order[index + 1],
                                order[index]
                              ];
                              return { ...figure, seriesOrder: order };
                            });
                          }}
                        >
                          <LayerArrowIcon direction="up" />
                        </button>
                      </div>
                    </div>
                  </section>
                )}

                {inspectorTab === "axis" && (
                  <section className="inspector-pane">
                    <div className="pane-heading">
                      <strong>坐标轴与文字</strong>
                      <span>支持 LaTeX</span>
                    </div>

                    {!surfaceTemplate ? (
                      <>
                                            <div className="section-divider">范围</div>
                                            <div className="axis-range-grid">
                                              <div className="axis-range-head">X</div>
                                              <label className="axis-auto">
                                                <MiniSwitch
                                                  checked={
                                                    xAxisCategorical ||
                                                    activeFigure.figureOverrides.xAutoRange !== false
                                                  }
                                                  disabled={xAxisCategorical}
                                                  onChange={(value) =>
                                                    setFigureField("xAutoRange", value)
                                                  }
                                                />
                                                <span>自动</span>
                                              </label>
                                              <input
                                                type="number"
                                                placeholder="最小"
                                                disabled={
                                                  xAxisCategorical ||
                                                  activeFigure.figureOverrides.xAutoRange !== false
                                                }
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
                                                placeholder="最大"
                                                disabled={
                                                  xAxisCategorical ||
                                                  activeFigure.figureOverrides.xAutoRange !== false
                                                }
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
                                              <div className="axis-range-head">
                                                {doubleYTemplate ? "左 Y" : "Y"}
                                              </div>
                                              <label className="axis-auto">
                                                <MiniSwitch
                                                  checked={activeFigure.figureOverrides.yAutoRange !== false}
                                                  onChange={(value) =>
                                                    setFigureField("yAutoRange", value)
                                                  }
                                                />
                                                <span>自动</span>
                                              </label>
                                              <input
                                                type="number"
                                                placeholder="最小"
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
                                                placeholder="最大"
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
                        
                                            <div className="axis-reverse-row">
                                              <label>
                                                <span>X 反向</span>
                                                <MiniSwitch
                                                  checked={activeFigure.figureOverrides.xReverse ?? false}
                                                  onChange={(value) => setFigureField("xReverse", value)}
                                                />
                                              </label>
                                              <label>
                                                <span>Y 反向</span>
                                                <MiniSwitch
                                                  checked={activeFigure.figureOverrides.yReverse ?? false}
                                                  onChange={(value) => setFigureField("yReverse", value)}
                                                />
                                              </label>
                                            </div>
                        
                                            {(xAxisIssue || yAxisIssue) && (
                                              <div className="axis-validation is-error">
                                                {[xAxisIssue, yAxisIssue].filter(Boolean).join("；")}
                                              </div>
                                            )}
                        
                                            {!surfaceTemplate && (
                                              <>
                                                <div className="prop-row">
                                                  <label>X 标度</label>
                                                  {xAxisCategorical ? (
                                                  <span className="property-text">
                                                    分类 / 文本
                                                  </span>
                                                ) : (
                                                  <select
                                                    value={activeFigure.figureOverrides.xScale ?? "linear"}
                                                    onChange={(event) =>
                                                      setFigureField(
                                                        "xScale",
                                                        event.target.value as AxisScale
                                                      )
                                                    }
                                                  >
                                                    <option value="linear">线性</option>
                                                    <option value="log">对数</option>
                                                  </select>
                                                )}
                                                </div>
                                                <div className="prop-row">
                                                  <label>
                                                    {doubleYTemplate
                                                      ? "左 Y 标度"
                                                      : "Y 标度"}
                                                  </label>
                                                  <select
                                                    value={activeFigure.figureOverrides.yScale ?? "linear"}
                                                    onChange={(event) =>
                                                      setFigureField(
                                                        "yScale",
                                                        event.target.value as AxisScale
                                                      )
                                                    }
                                                  >
                                                    <option value="linear">线性</option>
                                                    <option value="log">对数</option>
                                                  </select>
                                                </div>
                                              </>
                                            )}
                        
                                            {doubleYTemplate && (
                                              <>
                                                <div className="section-divider">右 Y 轴</div>
                                                <div className="prop-row">
                                                  <label>标题</label>
                                                  <div className="control-with-reset">
                                                    <input
                                                      type="text"
                                                      placeholder={
                                                        "自动：" +
                                                        (rightYSeries
                                                          ? rightYSeries.unit
                                                            ? rightYSeries.name +
                                                              " (" +
                                                              rightYSeries.unit +
                                                              ")"
                                                            : rightYSeries.name
                                                          : "右 Y")
                                                      }
                                                      value={
                                                        activeFigure.figureOverrides
                                                          .rightYTitle ?? ""
                                                      }
                                                      onChange={(event) =>
                                                        setFigureField(
                                                          "rightYTitle",
                                                          event.target.value ||
                                                            undefined
                                                        )
                                                      }
                                                    />
                                                    <ResetIcon
                                                      visible={
                                                        activeFigure.figureOverrides
                                                          .rightYTitle !== undefined
                                                      }
                                                      onReset={() =>
                                                        resetFigureField("rightYTitle")
                                                      }
                                                    />
                                                  </div>
                                                </div>
                                                <div className="prop-row">
                                                  <label>标度</label>
                                                  <select
                                                    value={
                                                      activeFigure.figureOverrides
                                                        .rightYScale ?? "linear"
                                                    }
                                                    onChange={(event) =>
                                                      setFigureField(
                                                        "rightYScale",
                                                        event.target.value as AxisScale
                                                      )
                                                    }
                                                  >
                                                    <option value="linear">线性</option>
                                                    <option value="log">对数</option>
                                                  </select>
                                                </div>
                                                <div className="prop-row">
                                                  <label>反向</label>
                                                  <MiniSwitch
                                                    checked={
                                                      activeFigure.figureOverrides
                                                        .rightYReverse ?? false
                                                    }
                                                    onChange={(value) =>
                                                      setFigureField(
                                                        "rightYReverse",
                                                        value
                                                      )
                                                    }
                                                  />
                                                </div>
                                                <div className="right-y-range-grid">
                                                  <label className="axis-auto">
                                                    <MiniSwitch
                                                      checked={
                                                        activeFigure.figureOverrides
                                                          .rightYAutoRange !== false
                                                      }
                                                      onChange={(value) =>
                                                        setFigureField(
                                                          "rightYAutoRange",
                                                          value
                                                        )
                                                      }
                                                    />
                                                    <span>自动范围</span>
                                                  </label>
                                                  <input
                                                    type="number"
                                                    step="any"
                                                    placeholder="最小"
                                                    disabled={
                                                      activeFigure.figureOverrides
                                                        .rightYAutoRange !== false
                                                    }
                                                    value={
                                                      activeFigure.figureOverrides
                                                        .rightYMin ?? ""
                                                    }
                                                    onChange={(event) =>
                                                      setFigureField(
                                                        "rightYMin",
                                                        event.target.value === ""
                                                          ? undefined
                                                          : Number(event.target.value)
                                                      )
                                                    }
                                                  />
                                                  <input
                                                    type="number"
                                                    step="any"
                                                    placeholder="最大"
                                                    disabled={
                                                      activeFigure.figureOverrides
                                                        .rightYAutoRange !== false
                                                    }
                                                    value={
                                                      activeFigure.figureOverrides
                                                        .rightYMax ?? ""
                                                    }
                                                    onChange={(event) =>
                                                      setFigureField(
                                                        "rightYMax",
                                                        event.target.value === ""
                                                          ? undefined
                                                          : Number(event.target.value)
                                                      )
                                                    }
                                                  />
                                                </div>
                                                {rightYAxisIssue && (
                                                  <div className="axis-validation is-error">
                                                    {rightYAxisIssue}
                                                  </div>
                                                )}
                                              </>
                                            )}

                                            <div className="section-divider">刻度</div>
                                            <div className="prop-row">
                                              <label>外框 / Tick</label>
                                              <select
                                                value={activeFigure.figureOverrides.axisStyle ?? "regular"}
                                                onChange={(event) =>
                                                  setFigureField(
                                                    "axisStyle",
                                                    event.target.value as AxisStylePreset
                                                  )
                                                }
                                              >
                                                <option value="regular">常规</option>
                                                <option value="bold">加粗</option>
                                              </select>
                                            </div>
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
                                            <div className="tick-step-grid">
                                              <span />
                                              <b>大刻度间距</b>
                                              <b>小刻度间距</b>
                                              <span>X</span>
                                              <input
                                                type="number"
                                                min="0"
                                                step="any"
                                                placeholder="自动"
                                                disabled={xAxisCategorical}
                                                value={activeFigure.figureOverrides.xMajorTickStep ?? ""}
                                                onChange={(event) =>
                                                  setFigureField(
                                                    "xMajorTickStep",
                                                    event.target.value === ""
                                                      ? undefined
                                                      : Number(event.target.value)
                                                  )
                                                }
                                              />
                                              <input
                                                type="number"
                                                min="0"
                                                step="any"
                                                placeholder="自动"
                                                disabled={xAxisCategorical}
                                                value={activeFigure.figureOverrides.xMinorTickStep ?? ""}
                                                onChange={(event) => {
                                                  const value =
                                                    event.target.value === ""
                                                      ? undefined
                                                      : Number(event.target.value);
                                                  setFigureField("xMinorTickStep", value);
                                                  if (value !== undefined) setFigureField("minorTicks", true);
                                                }}
                                              />
                                              <span>Y</span>
                                              <input
                                                type="number"
                                                min="0"
                                                step="any"
                                                placeholder="自动"
                                                value={activeFigure.figureOverrides.yMajorTickStep ?? ""}
                                                onChange={(event) =>
                                                  setFigureField(
                                                    "yMajorTickStep",
                                                    event.target.value === ""
                                                      ? undefined
                                                      : Number(event.target.value)
                                                  )
                                                }
                                              />
                                              <input
                                                type="number"
                                                min="0"
                                                step="any"
                                                placeholder="自动"
                                                value={activeFigure.figureOverrides.yMinorTickStep ?? ""}
                                                onChange={(event) => {
                                                  const value =
                                                    event.target.value === ""
                                                      ? undefined
                                                      : Number(event.target.value);
                                                  setFigureField("yMinorTickStep", value);
                                                  if (value !== undefined) setFigureField("minorTicks", true);
                                                }}
                                              />
                                            </div>
                                            <div className="prop-row">
                                              <label>小刻度</label>
                                              <MiniSwitch
                                                checked={activeFigure.figureOverrides.minorTicks ?? false}
                                                onChange={(value) => setFigureField("minorTicks", value)}
                                              />
                                            </div>
                                            {xAxisCategorical && (
                                              <div className="axis-note">
                                                X 当前是文本 / 分类轴：按数据顺序显示类别；
                                                数值范围、对数标度和数值 Tick 间距对 X 不适用。
                                              </div>
                                            )}

                                            {(activeFigure.figureOverrides.xScale === "log" ||
                                              activeFigure.figureOverrides.yScale === "log") && (
                                              <div className="axis-note">
                                                对数轴的刻度间距使用 log10 单位：1 = 一个 decade，
                                                0.1 = 0.1 decade。
                                              </div>
                                            )}
                        
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
                        
                                            {doubleYTemplate && (
                                              <>
                                                <div className="section-divider">右 Y 刻度</div>
                                                <div className="right-y-tick-grid">
                                                  <label>
                                                    <span>大刻度</span>
                                                    <input
                                                      type="number"
                                                      min="0"
                                                      step="any"
                                                      placeholder="自动"
                                                      value={
                                                        activeFigure.figureOverrides
                                                          .rightYMajorTickStep ?? ""
                                                      }
                                                      onChange={(event) =>
                                                        setFigureField(
                                                          "rightYMajorTickStep",
                                                          event.target.value === ""
                                                            ? undefined
                                                            : Number(event.target.value)
                                                        )
                                                      }
                                                    />
                                                  </label>
                                                  <label>
                                                    <span>小刻度</span>
                                                    <input
                                                      type="number"
                                                      min="0"
                                                      step="any"
                                                      placeholder="自动"
                                                      value={
                                                        activeFigure.figureOverrides
                                                          .rightYMinorTickStep ?? ""
                                                      }
                                                      onChange={(event) => {
                                                        const value =
                                                          event.target.value === ""
                                                            ? undefined
                                                            : Number(event.target.value);
                                                        setFigureField(
                                                          "rightYMinorTickStep",
                                                          value
                                                        );
                                                        if (value !== undefined)
                                                          setFigureField(
                                                            "minorTicks",
                                                            true
                                                          );
                                                      }}
                                                    />
                                                  </label>
                                                  <label>
                                                    <span>格式</span>
                                                    <select
                                                      value={
                                                        activeFigure.figureOverrides
                                                          .rightYTickFormat ?? "auto"
                                                      }
                                                      onChange={(event) =>
                                                        setFigureField(
                                                          "rightYTickFormat",
                                                          event.target.value as TickLabelFormat
                                                        )
                                                      }
                                                    >
                                                      <option value="auto">自动</option>
                                                      <option value="decimal">十进制</option>
                                                      <option value="scientific">科学计数</option>
                                                      <option value="engineering">工程计数</option>
                                                    </select>
                                                  </label>
                                                  <label>
                                                    <span>位数</span>
                                                    <input
                                                      type="number"
                                                      min="0"
                                                      max="12"
                                                      step="1"
                                                      disabled={
                                                        (activeFigure.figureOverrides
                                                          .rightYTickFormat ?? "auto") ===
                                                        "auto"
                                                      }
                                                      value={
                                                        activeFigure.figureOverrides
                                                          .rightYTickDecimals ?? 2
                                                      }
                                                      onChange={(event) =>
                                                        setFigureField(
                                                          "rightYTickDecimals",
                                                          Math.max(
                                                            0,
                                                            Math.min(
                                                              12,
                                                              Number(event.target.value)
                                                            )
                                                          )
                                                        )
                                                      }
                                                    />
                                                  </label>
                                                  <label>
                                                    <span>前缀</span>
                                                    <input
                                                      type="text"
                                                      value={
                                                        activeFigure.figureOverrides
                                                          .rightYTickPrefix ?? ""
                                                      }
                                                      onChange={(event) =>
                                                        setFigureField(
                                                          "rightYTickPrefix",
                                                          event.target.value
                                                        )
                                                      }
                                                    />
                                                  </label>
                                                  <label>
                                                    <span>后缀</span>
                                                    <input
                                                      type="text"
                                                      value={
                                                        activeFigure.figureOverrides
                                                          .rightYTickSuffix ?? ""
                                                      }
                                                      onChange={(event) =>
                                                        setFigureField(
                                                          "rightYTickSuffix",
                                                          event.target.value
                                                        )
                                                      }
                                                    />
                                                  </label>
                                                  <label>
                                                    <span>旋转</span>
                                                    <div className="compact-number">
                                                      <input
                                                        type="number"
                                                        min="-180"
                                                        max="180"
                                                        step="5"
                                                        value={
                                                          activeFigure.figureOverrides
                                                            .rightYTickAngle ?? 0
                                                        }
                                                        onChange={(event) =>
                                                          setFigureField(
                                                            "rightYTickAngle",
                                                            Math.max(
                                                              -180,
                                                              Math.min(
                                                                180,
                                                                Number(event.target.value)
                                                              )
                                                            )
                                                          )
                                                        }
                                                      />
                                                      <span>°</span>
                                                    </div>
                                                  </label>
                                                </div>
                                              </>
                                            )}

                                            <div className="section-divider">刻度标签</div>
                                            <div className="tick-format-grid">
                                              <span />
                                              <b>格式</b>
                                              <b>位数</b>
                                              <span>X</span>
                                              <select
                                                disabled={xAxisCategorical}
                                                value={activeFigure.figureOverrides.xTickFormat ?? "auto"}
                                                onChange={(event) =>
                                                  setFigureField(
                                                    "xTickFormat",
                                                    event.target.value as TickLabelFormat
                                                  )
                                                }
                                              >
                                                <option value="auto">自动</option>
                                                <option value="decimal">十进制</option>
                                                <option value="scientific">科学计数</option>
                                                <option value="engineering">工程计数</option>
                                              </select>
                                              <input
                                                type="number"
                                                min="0"
                                                max="12"
                                                step="1"
                                                disabled={
                                                  xAxisCategorical ||
                                                  (activeFigure.figureOverrides.xTickFormat ?? "auto") ===
                                                    "auto"
                                                }
                                                value={activeFigure.figureOverrides.xTickDecimals ?? 2}
                                                onChange={(event) =>
                                                  setFigureField(
                                                    "xTickDecimals",
                                                    Math.max(0, Math.min(12, Number(event.target.value)))
                                                  )
                                                }
                                              />
                                              <span>Y</span>
                                              <select
                                                value={activeFigure.figureOverrides.yTickFormat ?? "auto"}
                                                onChange={(event) =>
                                                  setFigureField(
                                                    "yTickFormat",
                                                    event.target.value as TickLabelFormat
                                                  )
                                                }
                                              >
                                                <option value="auto">自动</option>
                                                <option value="decimal">十进制</option>
                                                <option value="scientific">科学计数</option>
                                                <option value="engineering">工程计数</option>
                                              </select>
                                              <input
                                                type="number"
                                                min="0"
                                                max="12"
                                                step="1"
                                                disabled={
                                                  (activeFigure.figureOverrides.yTickFormat ?? "auto") ===
                                                  "auto"
                                                }
                                                value={activeFigure.figureOverrides.yTickDecimals ?? 2}
                                                onChange={(event) =>
                                                  setFigureField(
                                                    "yTickDecimals",
                                                    Math.max(0, Math.min(12, Number(event.target.value)))
                                                  )
                                                }
                                              />
                                            </div>
                        
                                            <div className="tick-affix-grid">
                                              <label>
                                                <span>X 前缀</span>
                                                <input
                                                  type="text"
                                                  value={activeFigure.figureOverrides.xTickPrefix ?? ""}
                                                  onChange={(event) =>
                                                    setFigureField("xTickPrefix", event.target.value)
                                                  }
                                                />
                                              </label>
                                              <label>
                                                <span>X 后缀</span>
                                                <input
                                                  type="text"
                                                  value={activeFigure.figureOverrides.xTickSuffix ?? ""}
                                                  onChange={(event) =>
                                                    setFigureField("xTickSuffix", event.target.value)
                                                  }
                                                />
                                              </label>
                                              <label>
                                                <span>Y 前缀</span>
                                                <input
                                                  type="text"
                                                  value={activeFigure.figureOverrides.yTickPrefix ?? ""}
                                                  onChange={(event) =>
                                                    setFigureField("yTickPrefix", event.target.value)
                                                  }
                                                />
                                              </label>
                                              <label>
                                                <span>Y 后缀</span>
                                                <input
                                                  type="text"
                                                  value={activeFigure.figureOverrides.yTickSuffix ?? ""}
                                                  onChange={(event) =>
                                                    setFigureField("yTickSuffix", event.target.value)
                                                  }
                                                />
                                              </label>
                                            </div>
                        
                        
                      <div className="tick-angle-grid">
                        <label>
                          <span>X 旋转</span>
                          <div className="compact-number">
                            <input
                              type="number"
                              min="-180"
                              max="180"
                              step="5"
                              value={activeFigure.figureOverrides.xTickAngle ?? 0}
                              onChange={(event) =>
                                setFigureField(
                                  "xTickAngle",
                                  Math.max(
                                    -180,
                                    Math.min(180, Number(event.target.value))
                                  )
                                )
                              }
                            />
                            <span>°</span>
                          </div>
                        </label>
                        <label>
                          <span>Y 旋转</span>
                          <div className="compact-number">
                            <input
                              type="number"
                              min="-180"
                              max="180"
                              step="5"
                              value={activeFigure.figureOverrides.yTickAngle ?? 0}
                              onChange={(event) =>
                                setFigureField(
                                  "yTickAngle",
                                  Math.max(
                                    -180,
                                    Math.min(180, Number(event.target.value))
                                  )
                                )
                              }
                            />
                            <span>°</span>
                          </div>
                        </label>
                      </div>

                      </>
                    ) : (
                      <div className="axis-note">
                        3D 曲面当前只显示真正生效的文字与色图属性；3D 范围、
                        Tick 和相机参数将在专用 3D 轴面板中统一提供。
                      </div>
                    )}

                    <div className="section-divider">标题与标签</div>
                    <div className="prop-row">
                      <label>图标题</label>
                      <input
                        type="text"
                        placeholder="可输入 $E=mc^2$"
                        value={activeFigure.figureOverrides.plotTitle ?? ""}
                        onChange={(event) =>
                          setFigureField("plotTitle", event.target.value)
                        }
                      />
                    </div>
                    <div className="prop-row">
                      <label>X 标题</label>
                      <div className="control-with-reset">
                        <input
                          type="text"
                          placeholder={
                            "自动：" +
                            (plotDataset.x.unit
                              ? plotDataset.x.name + " (" + plotDataset.x.unit + ")"
                              : plotDataset.x.name)
                          }
                          value={activeFigure.figureOverrides.xTitle ?? ""}
                          onChange={(event) =>
                            setFigureField(
                              "xTitle",
                              event.target.value === ""
                                ? undefined
                                : event.target.value
                            )
                          }
                        />
                        <ResetIcon
                          visible={
                            activeFigure.figureOverrides.xTitle !== undefined
                          }
                          onReset={() => resetFigureField("xTitle")}
                        />
                      </div>
                    </div>
                    <div className="prop-row">
                      <label>
                        {doubleYTemplate ? "左 Y 标题" : "Y 标题"}
                      </label>
                      <div className="control-with-reset">
                        <input
                          type="text"
                          placeholder={
                            "自动：" +
                            (fieldTemplate
                              ? plotDataset.metadata?.rowAxisUnit
                                ? (plotDataset.metadata?.rowAxisName ?? "纵向位置") +
                                  " (" +
                                  plotDataset.metadata.rowAxisUnit +
                                  ")"
                                : plotDataset.metadata?.rowAxisName ?? "纵向位置"
                              : doubleYTemplate && leftYSeries
                              ? leftYSeries.unit
                                ? leftYSeries.name +
                                  " (" +
                                  leftYSeries.unit +
                                  ")"
                                : leftYSeries.name
                              : plotDataset.ys[0]
                              ? plotDataset.ys[0].unit
                                ? plotDataset.ys[0].name +
                                  " (" +
                                  plotDataset.ys[0].unit +
                                  ")"
                                : plotDataset.ys[0].name
                              : "纵轴")
                          }
                          value={activeFigure.figureOverrides.yTitle ?? ""}
                          onChange={(event) =>
                            setFigureField(
                              "yTitle",
                              event.target.value === ""
                                ? undefined
                                : event.target.value
                            )
                          }
                        />
                        <ResetIcon
                          visible={
                            activeFigure.figureOverrides.yTitle !== undefined
                          }
                          onReset={() => resetFigureField("yTitle")}
                        />
                      </div>
                    </div>
                    {surfaceTemplate && (
                      <div className="prop-row">
                        <label>Z 标题</label>
                        <input
                          type="text"
                          value={activeFigure.figureOverrides.zTitle ?? ""}
                          onChange={(event) =>
                            setFigureField("zTitle", event.target.value)
                          }
                        />
                      </div>
                    )}
                    <div className="prop-row">
                      <label>标题字号</label>
                      <div className="compact-number">
                        <input
                          type="number"
                          min="5"
                          max="24"
                          step="0.25"
                          value={
                            activeFigure.figureOverrides.axisTitleSizePt ??
                            effectiveFontSizePt
                          }
                          onChange={(event) =>
                            setFigureField(
                              "axisTitleSizePt",
                              Number(event.target.value)
                            )
                          }
                        />
                        <span>pt</span>
                      </div>
                    </div>
                    <div className="prop-row">
                      <label>标题颜色</label>
                      <input
                        className="compact-color"
                        type="color"
                        value={
                          activeFigure.figureOverrides.axisTitleColor ?? "#17191c"
                        }
                        onChange={(event) =>
                          setFigureField("axisTitleColor", event.target.value)
                        }
                      />
                    </div>
                    <div className="prop-row">
                      <label>图标题字号</label>
                      <div className="compact-number">
                        <input
                          type="number"
                          min="5"
                          max="28"
                          step="0.25"
                          value={
                            activeFigure.figureOverrides.plotTitleSizePt ??
                            effectiveFontSizePt * 1.12
                          }
                          onChange={(event) =>
                            setFigureField(
                              "plotTitleSizePt",
                              Number(event.target.value)
                            )
                          }
                        />
                        <span>pt</span>
                      </div>
                    </div>
                    <div className="prop-row">
                      <label>图标题颜色</label>
                      <input
                        className="compact-color"
                        type="color"
                        value={
                          activeFigure.figureOverrides.plotTitleColor ?? "#17191c"
                        }
                        onChange={(event) =>
                          setFigureField("plotTitleColor", event.target.value)
                        }
                      />
                    </div>
                    <div className="prop-row">
                      <label>刻度字号</label>
                      <div className="compact-number">
                        <input
                          type="number"
                          min="5"
                          max="20"
                          step="0.25"
                          value={
                            activeFigure.figureOverrides.tickLabelSizePt ??
                            effectiveFontSizePt
                          }
                          onChange={(event) =>
                            setFigureField(
                              "tickLabelSizePt",
                              Number(event.target.value)
                            )
                          }
                        />
                        <span>pt</span>
                      </div>
                    </div>
                    <div className="prop-row">
                      <label>刻度颜色</label>
                      <input
                        className="compact-color"
                        type="color"
                        value={
                          activeFigure.figureOverrides.tickLabelColor ?? "#17191c"
                        }
                        onChange={(event) =>
                          setFigureField("tickLabelColor", event.target.value)
                        }
                      />
                    </div>

                    <div
                      className={
                        latexFallbackActive
                          ? "latex-status is-error"
                          : latexUnavailable
                          ? "latex-status is-warn"
                          : "latex-status"
                      }
                    >
                      {latexFallbackActive
                        ? "LaTeX 无法解析：画布已完整显示原始输入，不会中断绘图。"
                        : latexUnavailable
                        ? "MathJax 当前不可用：复杂公式暂显示原始输入；常见希腊字母和上下标仍可本地渲染。"
                        : "LaTeX 即时预览：例如 $\\lambda$, $P_{out}$, $E=mc^2$。"}
                    </div>
                  </section>
                )}

                {inspectorTab === "legend" && !fieldTemplate && (
                  <section className="inspector-pane">
                    <div className="pane-heading">
                      <strong>图例</strong>
                      <span>可直接拖动</span>
                    </div>

                    <div className="legend-drag-hint">
                      在画布上直接拖动图例即可自由定位；拖动后位置会写回项目，并与导出保持一致。名称与单项显示在“曲线”页设置。
                    </div>

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
                          activeFigure.figureOverrides.legendPosition ??
                          "top-left"
                        }
                        onChange={(event) => {
                          const value = event.target.value as LegendPosition;
                          setFigureField("legendPosition", value);
                        }}
                      >
                        <option value="top-left">左上</option>
                        <option value="top-center">上中</option>
                        <option value="top-right">右上</option>
                        <option value="bottom-left">左下</option>
                        <option value="bottom-center">下中</option>
                        <option value="bottom-right">右下</option>
                        <option value="custom">自由</option>
                      </select>
                    </div>

                    {(activeFigure.figureOverrides.legendPosition ?? "top-left") ===
                      "custom" && (
                      <div className="legend-position-grid">
                        <label>
                          <span>X</span>
                          <input
                            type="number"
                            min="-1"
                            max="2"
                            step="0.01"
                            value={activeFigure.figureOverrides.legendX ?? 0.02}
                            onChange={(event) =>
                              setFigureField(
                                "legendX",
                                Number(event.target.value)
                              )
                            }
                          />
                        </label>
                        <label>
                          <span>Y</span>
                          <input
                            type="number"
                            min="-1"
                            max="2"
                            step="0.01"
                            value={activeFigure.figureOverrides.legendY ?? 0.985}
                            onChange={(event) =>
                              setFigureField(
                                "legendY",
                                Number(event.target.value)
                              )
                            }
                          />
                        </label>
                      </div>
                    )}

                    {(activeFigure.figureOverrides.legendPosition ?? "top-left") ===
                      "custom" && (
                      <div className="legend-anchor-grid">
                        <label>
                          <span>水平锚点</span>
                          <select
                            value={
                              activeFigure.figureOverrides.legendXAnchor ?? "left"
                            }
                            onChange={(event) =>
                              setFigureField(
                                "legendXAnchor",
                                event.target.value as LegendXAnchor
                              )
                            }
                          >
                            <option value="left">左</option>
                            <option value="center">中</option>
                            <option value="right">右</option>
                          </select>
                        </label>
                        <label>
                          <span>垂直锚点</span>
                          <select
                            value={
                              activeFigure.figureOverrides.legendYAnchor ?? "top"
                            }
                            onChange={(event) =>
                              setFigureField(
                                "legendYAnchor",
                                event.target.value as LegendYAnchor
                              )
                            }
                          >
                            <option value="top">上</option>
                            <option value="middle">中</option>
                            <option value="bottom">下</option>
                          </select>
                        </label>
                      </div>
                    )}

                    <div className="prop-row">
                      <label>排列</label>
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
                    {(activeFigure.figureOverrides.legendOrientation ??
                      "horizontal") === "horizontal" && (
                      <div className="prop-row">
                        <label>列数</label>
                        <input
                          type="number"
                          min="1"
                          max="8"
                          value={activeFigure.figureOverrides.legendColumns ?? 1}
                          onChange={(event) =>
                            setFigureField(
                              "legendColumns",
                              Math.max(1, Number(event.target.value))
                            )
                          }
                        />
                      </div>
                    )}

                    <div className="section-divider">文字与符号</div>
                    <div className="prop-row">
                      <label>字号</label>
                      <div className="compact-number">
                        <input
                          type="number"
                          min="5"
                          max="20"
                          step="0.25"
                          value={
                            activeFigure.figureOverrides.legendFontSizePt ??
                            effectiveFontSizePt * 0.92
                          }
                          onChange={(event) =>
                            setFigureField(
                              "legendFontSizePt",
                              Number(event.target.value)
                            )
                          }
                        />
                        <span>pt</span>
                      </div>
                    </div>
                    <div className="prop-row">
                      <label>文字颜色</label>
                      <input
                        className="compact-color"
                        type="color"
                        value={
                          activeFigure.figureOverrides.legendFontColor ??
                          "#17191c"
                        }
                        onChange={(event) =>
                          setFigureField(
                            "legendFontColor",
                            event.target.value
                          )
                        }
                      />
                    </div>
                    <div className="prop-row">
                      <label>符号宽度</label>
                      <div className="compact-number">
                        <input
                          type="number"
                          min="30"
                          max="120"
                          step="2"
                          value={
                            activeFigure.figureOverrides.legendItemWidthPx ?? 30
                          }
                          onChange={(event) =>
                            setFigureField(
                              "legendItemWidthPx",
                              Number(event.target.value)
                            )
                          }
                        />
                        <span>px</span>
                      </div>
                    </div>

                    <div className="section-divider">背景与边框</div>
                    <div className="prop-row">
                      <label>背景</label>
                      <div className="control-with-reset color-control">
                        <input
                          type="color"
                          value={
                            activeFigure.figureOverrides.legendBackground ??
                            "#ffffff"
                          }
                          onChange={(event) =>
                            setFigureField(
                              "legendBackground",
                              event.target.value
                            )
                          }
                        />
                        <span>
                          {(
                            activeFigure.figureOverrides.legendBackground ??
                            "透明"
                          ).toUpperCase()}
                        </span>
                        <ResetIcon
                          visible={
                            activeFigure.figureOverrides.legendBackground !==
                            undefined
                          }
                          onReset={() =>
                            resetFigureField("legendBackground")
                          }
                        />
                      </div>
                    </div>
                    <div className="prop-row">
                      <label>背景不透明度</label>
                      <div className="compact-number">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="5"
                          value={Math.round(
                            (activeFigure.figureOverrides
                              .legendBackgroundOpacity ?? 1) * 100
                          )}
                          onChange={(event) =>
                            setFigureField(
                              "legendBackgroundOpacity",
                              Number(event.target.value) / 100
                            )
                          }
                        />
                        <span>%</span>
                      </div>
                    </div>
                    <div className="prop-row">
                      <label>边框</label>
                      <MiniSwitch
                        checked={
                          activeFigure.figureOverrides.legendFrame ?? false
                        }
                        onChange={(value) =>
                          setFigureField("legendFrame", value)
                        }
                      />
                    </div>
                    <div className="prop-row">
                      <label>边框颜色</label>
                      <input
                        className="compact-color"
                        type="color"
                        disabled={
                          !(activeFigure.figureOverrides.legendFrame ?? false)
                        }
                        value={
                          activeFigure.figureOverrides.legendBorderColor ??
                          "#cdd2d7"
                        }
                        onChange={(event) =>
                          setFigureField(
                            "legendBorderColor",
                            event.target.value
                          )
                        }
                      />
                    </div>
                    <div className="prop-row">
                      <label>边框宽度</label>
                      <div className="compact-number">
                        <input
                          type="number"
                          min="0"
                          max="4"
                          step="0.1"
                          disabled={
                            !(activeFigure.figureOverrides.legendFrame ?? false)
                          }
                          value={
                            activeFigure.figureOverrides.legendBorderWidthPt ??
                            0.6
                          }
                          onChange={(event) =>
                            setFigureField(
                              "legendBorderWidthPt",
                              Number(event.target.value)
                            )
                          }
                        />
                        <span>pt</span>
                      </div>
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
            </>
          ) : (
            <div className="empty-inspector">选择数据表或图形查看属性。</div>
          )}
        </aside>
      </main>

      {pasteOpen && activeBook && (
        <div className="modal-backdrop" onMouseDown={() => setPasteOpen(false)}>
          <div className="paste-dialog" onMouseDown={(event) => event.stopPropagation()}>
            <div className="dialog-title">粘贴为新工作表</div>
            <textarea
              autoFocus
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder={"Wavelength (nm),Power (dBm)\n1030,-52.1\n1031,-51.8"}
            />
            <div className="dialog-actions">
              <button type="button" onClick={() => setPasteOpen(false)}>取消</button>
              <button className="primary-button" type="button" onClick={pasteAsNewSheet}>创建工作表</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default App;
