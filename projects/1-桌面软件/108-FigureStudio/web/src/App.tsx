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
  findSheet,
  normalizeFigureForSheet,
  sheetRowCount,
  sheetToDataset
} from "./data/adapter";
import { downloadMatplotlibScript } from "./export/matplotlib";
import { useHistoryState } from "./hooks/useHistoryState";
import { parseDelimitedText } from "./lib/csv";
import type {
  AspectMode,
  AxisScale,
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
import { templates } from "./plot/templates";
import { checkFigure } from "./project/checker";
import {
  downloadProject,
  readProjectFile
} from "./project/projectIO";

const AUTOSAVE_KEY = "figurestudio-p108-autosave-v03";
const USER_DEFAULTS_KEY = "figurestudio-p108-user-defaults-v02";
const UI_SCALE_KEY = "figurestudio-p108-ui-scale";
const PNG_SCALE = PNG_DPI / 96;

const ROLE_OPTIONS: Array<{ value: ColumnRole; label: string }> = [
  { value: "X", label: "X" },
  { value: "Y", label: "Y" },
  { value: "Z", label: "Z" },
  { value: "XErr", label: "XErr" },
  { value: "YErr", label: "YErr" },
  { value: "Label", label: "Label" },
  { value: "None", label: "无" }
];

function makeId(prefix: string): string {
  return prefix + "-" + Math.random().toString(36).slice(2, 10);
}

function docKey(doc: DocumentRef): string {
  return doc.type + ":" + doc.id;
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
        <svg {...common} aria-hidden="true">
          <rect className="icon-surface" x="1.5" y="1.5" width="13" height="13" rx="2.1" />
          <path d="M3 3v9.5h10" />
          <path d="M4.3 10.6l2.2-2 2 .7 3.1-4 1.3.8" />
        </svg>
      )}
      {props.linked && (
        <span className="link-badge" title="Linked Data">
          ↗
        </span>
      )}
    </span>
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
      ↺
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
  const initialSheetId = initialProject.dataBooks[0]?.sheets[0]?.id ?? "";
  const initialFigureId = initialProject.figures[0]?.id ?? "";

  const history = useHistoryState<ProjectState>(initialProject);
  const project = history.value;

  const plotRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dataInputRef = useRef<HTMLInputElement | null>(null);
  const projectInputRef = useRef<HTMLInputElement | null>(null);
  const dataActionRef = useRef<"import" | "link" | "replace" | "reload">("import");

  const [openDocs, setOpenDocs] = useState<DocumentRef[]>(() => [
    ...(initialSheetId ? [{ type: "sheet", id: initialSheetId } as DocumentRef] : []),
    ...(initialFigureId ? [{ type: "figure", id: initialFigureId } as DocumentRef] : [])
  ]);
  const [activeDoc, setActiveDoc] = useState<DocumentRef>(() =>
    initialSheetId
      ? { type: "sheet", id: initialSheetId }
      : { type: "figure", id: initialFigureId }
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
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [toast, setToast] = useState("");

  const showToast = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => {
      setToast((current) => (current === text ? "" : current));
    }, 2200);
  }, []);

  const activeSheetContext =
    activeDoc.type === "sheet" ? findSheet(project, activeDoc.id) : undefined;
  const activeBook = activeSheetContext?.book;
  const activeSheet = activeSheetContext?.sheet;

  const activeFigure =
    activeDoc.type === "figure"
      ? project.figures.find((figure) => figure.id === activeDoc.id)
      : undefined;

  const figureSheetContext = activeFigure
    ? findSheet(project, activeFigure.dataRef.sheetId)
    : undefined;
  const figureSheet = figureSheetContext?.sheet;
  const plotDataset =
    activeFigure && figureSheet
      ? sheetToDataset(figureSheet, activeFigure)
      : undefined;
  const preset = activeFigure
    ? presets[activeFigure.presetId]
    : presets.scientific;

  const orderedSeries = useMemo(
    () =>
      plotDataset && activeFigure
        ? orderSeries(plotDataset, activeFigure.seriesOrder)
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

  useEffect(() => {
    document.documentElement.style.setProperty("--ui-scale", String(uiScale));
    localStorage.setItem(UI_SCALE_KEY, String(uiScale));
  }, [uiScale]);

  useEffect(() => {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
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
      scrollZoom: activeFigure.templateId !== "surface-3d"
    };

    const handleDomClick = (event: globalThis.MouseEvent) => {
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
  }, [activeFigure, layout, orderedSeries, selectSeries, traces]);

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
    const sheetId = next.dataBooks[0]?.sheets[0]?.id;
    const figureId = next.figures[0]?.id;
    const docs: DocumentRef[] = [
      ...(sheetId ? [{ type: "sheet", id: sheetId } as DocumentRef] : []),
      ...(figureId ? [{ type: "figure", id: figureId } as DocumentRef] : [])
    ];
    setOpenDocs(docs);
    setActiveDoc(
      docs[0] ?? { type: "figure", id: figureId ?? "" }
    );
    setExplorerSelection(null);
  }

  function docTitle(doc: DocumentRef): string {
    if (doc.type === "figure") {
      return project.figures.find((figure) => figure.id === doc.id)?.name ?? "图形";
    }
    const context = findSheet(project, doc.id);
    return context ? context.book.name + " · " + context.sheet.name : "数据表";
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
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) {
        showToast("没有可恢复的 v0.3 自动保存");
        return;
      }
      const next = JSON.parse(raw) as ProjectState;
      if (next.schemaVersion !== "0.3") throw new Error("version");
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

  function triggerDataFile(action: "import" | "link" | "replace" | "reload") {
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
        role: matched.role
      };
    });

    return {
      ...incoming,
      id: existing.id,
      name: existing.name,
      metadata: incoming.metadata ?? existing.metadata,
      columns
    };
  }

  function replaceSheet(
    bookId: string,
    sheetId: string,
    incoming: DataSheet,
    sourcePatch?: Partial<DataBook["source"]>
  ) {
    patchProject((current) => {
      const book = current.dataBooks.find((item) => item.id === bookId);
      const existing = book?.sheets.find((sheet) => sheet.id === sheetId);
      if (!book || !existing) return current;

      const nextSheet = reconcileSheet(existing, incoming);
      const nextBooks = current.dataBooks.map((item) =>
        item.id === bookId
          ? {
              ...item,
              source: sourcePatch
                ? { ...item.source, ...sourcePatch }
                : item.source,
              sheets: item.sheets.map((sheet) =>
                sheet.id === sheetId ? nextSheet : sheet
              )
            }
          : item
      );

      const nextFigures = current.figures.map((figure) =>
        figure.dataRef.sheetId === sheetId
          ? normalizeFigureForSheet(figure, nextSheet)
          : figure
      );

      return {
        ...current,
        dataBooks: nextBooks,
        figures: nextFigures
      };
    });
  }

  async function handleDataFile(file: File) {
    try {
      const sheet = parseDelimitedText(await file.text(), file.name);
      const action = dataActionRef.current;

      if ((action === "replace" || action === "reload") && activeBook && activeSheet) {
        if (activeBook.source.kind === "linked" && action === "replace") {
          showToast("Linked Data 请使用“重新加载”");
          return;
        }

        replaceSheet(
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
        showToast(action === "reload" ? "Linked Data 已重新加载" : "数据表已替换");
        return;
      }

      const bookId = makeId("book");
      const nextSheet = {
        ...sheet,
        id: makeId("sheet")
      };
      const book: DataBook = {
        id: bookId,
        name: sheet.name,
        folderId: selectedFolderId(),
        source:
          action === "link"
            ? {
                kind: "linked",
                fileName: file.name,
                size: file.size,
                modifiedMs: file.lastModified,
                status: "ok"
              }
            : { kind: "embedded" },
        sheets: [nextSheet]
      };

      patchProject((current) => ({
        ...current,
        dataBooks: [...current.dataBooks, book]
      }));
      setExpandedBooks((current) => new Set([...current, book.id]));
      openDocument({ type: "sheet", id: nextSheet.id });
      setExplorerSelection({ type: "book", id: book.id });
      showToast(action === "link" ? "已创建 Linked Data" : "已导入数据表");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "数据导入失败。");
    } finally {
      if (dataInputRef.current) dataInputRef.current.value = "";
    }
  }

  function addBlankBook() {
    const sheet: DataSheet = {
      id: makeId("sheet"),
      name: "Sheet1",
      columns: [
        { id: makeId("col"), name: "X", role: "X", values: [null, null, null] },
        { id: makeId("col"), name: "Y", role: "Y", values: [null, null, null] }
      ]
    };
    const book: DataBook = {
      id: makeId("book"),
      name: "新数据表",
      folderId: selectedFolderId(),
      source: { kind: "embedded" },
      sheets: [sheet]
    };

    patchProject((current) => ({
      ...current,
      dataBooks: [...current.dataBooks, book]
    }));
    setExpandedBooks((current) => new Set([...current, book.id]));
    openDocument({ type: "sheet", id: sheet.id });
  }

  function addSheet() {
    if (!activeBook) return;
    const sheet: DataSheet = {
      id: makeId("sheet"),
      name: "Sheet" + String(activeBook.sheets.length + 1),
      columns: [
        { id: makeId("col"), name: "X", role: "X", values: [null, null, null] },
        { id: makeId("col"), name: "Y", role: "Y", values: [null, null, null] }
      ]
    };
    patchBook(activeBook.id, (book) => ({
      ...book,
      sheets: [...book.sheets, sheet]
    }));
    openDocument({ type: "sheet", id: sheet.id });
  }

  function addRow() {
    if (!activeSheet || activeBook?.source.kind === "linked") return;
    patchSheet(activeSheet.id, (sheet) => ({
      ...sheet,
      columns: sheet.columns.map((column) => ({
        ...column,
        values: [...column.values, null]
      }))
    }));
  }

  function addColumn() {
    if (!activeSheet || activeBook?.source.kind === "linked") return;
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
    if (!activeSheet || activeBook?.source.kind === "linked") return;
    patchSheet(activeSheet.id, (sheet) => ({
      ...sheet,
      columns: sheet.columns.map((column) =>
        column.id === columnId ? { ...column, ...patch } : column
      )
    }));
  }

  function deleteColumn(columnId: string) {
    if (!activeSheet || activeBook?.source.kind === "linked") return;
    if (activeSheet.columns.length <= 1) {
      showToast("数据表至少保留一列");
      return;
    }
    if (!window.confirm("删除这一列？引用它的图会自动修复数据映射。")) return;

    patchProject((current) => {
      const context = findSheet(current, activeSheet.id);
      if (!context) return current;
      const nextSheet = {
        ...context.sheet,
        columns: context.sheet.columns.filter((column) => column.id !== columnId)
      };
      return {
        ...current,
        dataBooks: current.dataBooks.map((book) =>
          book.id === context.book.id
            ? {
                ...book,
                sheets: book.sheets.map((sheet) =>
                  sheet.id === nextSheet.id ? nextSheet : sheet
                )
              }
            : book
        ),
        figures: current.figures.map((figure) =>
          figure.dataRef.sheetId === nextSheet.id
            ? normalizeFigureForSheet(figure, nextSheet)
            : figure
        )
      };
    });
  }

  function reorderColumns(dragId: string, targetId: string) {
    if (!activeSheet || activeBook?.source.kind === "linked") return;
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
    if (!dataRef.xColumnId || dataRef.yColumnIds.length === 0) {
      window.alert("请先指定至少一列 X 和一列 Y。");
      return;
    }

    const dataset = sheetToDataset(activeSheet);
    const figure: FigureSpec = {
      id: makeId("figure"),
      name: "Graph " + String(project.figures.length + 1),
      folderId: activeBook.folderId,
      dataRef,
      templateId: project.defaults.templateId,
      presetId: project.defaults.presetId,
      figureOverrides: {
        aspectMode: "4:3",
        ...project.defaults.figureOverrides,
        xTitle: axisLabel(dataset.x.name, dataset.x.unit),
        yTitle: axisLabel(dataset.ys[0]?.name || "Y", dataset.ys[0]?.unit),
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

  function unlinkBook() {
    if (!activeBook) return;
    if (
      !window.confirm(
        "解除链接后，当前缓存数据会变成可编辑的 Embedded Data。是否继续？"
      )
    )
      return;
    patchBook(activeBook.id, (book) => ({
      ...book,
      source: { kind: "embedded" }
    }));
    showToast("已解除链接，现在可以编辑数据");
  }

  function pasteAsNewSheet() {
    if (!activeBook || !pasteText.trim()) return;
    try {
      const sheet = parseDelimitedText(pasteText, "粘贴数据.csv");
      const next = {
        ...sheet,
        id: makeId("sheet"),
        name: "Sheet" + String(activeBook.sheets.length + 1)
      };
      patchBook(activeBook.id, (book) => ({
        ...book,
        sheets: [...book.sheets, next]
      }));
      setPasteText("");
      setPasteOpen(false);
      openDocument({ type: "sheet", id: next.id });
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
        sheetIds.has(figure.dataRef.sheetId)
      );
      if (
        !window.confirm(
          "删除数据表“" +
            book.name +
            "”会同时删除引用它的 " +
            linkedFigures.length +
            " 张图。是否继续？"
        )
      )
        return;

      patchProject((current) => {
        const figures = current.figures.filter(
          (figure) => !sheetIds.has(figure.dataRef.sheetId)
        );
        return {
          ...current,
          dataBooks: current.dataBooks.filter((item) => item.id !== book.id),
          figures,
          activeFigureId: figures[0]?.id ?? ""
        };
      });
      setOpenDocs((current) =>
        current.filter(
          (doc) =>
            !(
              (doc.type === "sheet" && sheetIds.has(doc.id)) ||
              (doc.type === "figure" &&
                linkedFigures.some((figure) => figure.id === doc.id))
            )
        )
      );
      return;
    }

    if (explorerSelection.type === "sheet") {
      const context = findSheet(project, explorerSelection.id);
      if (!context) return;
      if (context.book.sheets.length <= 1) {
        showToast("DataBook 至少保留一个 Sheet");
        return;
      }
      const linked = project.figures.filter(
        (figure) => figure.dataRef.sheetId === context.sheet.id
      );
      if (
        !window.confirm(
          "删除 Sheet 会同时删除引用它的 " + linked.length + " 张图。是否继续？"
        )
      )
        return;

      patchProject((current) => ({
        ...current,
        dataBooks: current.dataBooks.map((book) =>
          book.id === context.book.id
            ? {
                ...book,
                sheets: book.sheets.filter((sheet) => sheet.id !== context.sheet.id)
              }
            : book
        ),
        figures: current.figures.filter(
          (figure) => figure.dataRef.sheetId !== context.sheet.id
        )
      }));
      closeDocument({ type: "sheet", id: context.sheet.id });
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
          onClick={() => {
            setExplorerSelection({ type: "book", id: book.id });
            setExpandedBooks((current) => new Set([...current, book.id]));
            const first = book.sheets[0];
            if (first) openDocument({ type: "sheet", id: first.id });
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
            {open ? "⌄" : "›"}
          </span>
          <Icon kind="book" linked={book.source.kind === "linked"} />
          <span className="tree-label">{book.name}</span>
        </button>

        {open &&
          book.sheets.map((sheet) => (
            <button
              key={sheet.id}
              type="button"
              className={
                activeDoc.type === "sheet" && activeDoc.id === sheet.id
                  ? "explorer-row is-active"
                  : explorerSelection?.type === "sheet" &&
                    explorerSelection.id === sheet.id
                  ? "explorer-row is-selected"
                  : "explorer-row"
              }
              style={{ paddingLeft: 31 + depth * 14 }}
              onClick={() => {
                setExplorerSelection({ type: "sheet", id: sheet.id });
                openDocument({ type: "sheet", id: sheet.id });
              }}
            >
              <span />
              <Icon kind="sheet" />
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
            {open ? "⌄" : "›"}
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
  const fieldTemplate =
    activeFigure?.templateId === "heatmap" ||
    activeFigure?.templateId === "surface-3d";
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
  const dataReadOnly = activeBook?.source.kind === "linked";

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
          <button type="button" onClick={newProject}>新建</button>
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
            <button type="button" onClick={addBlankBook} title="新建数据表">
              <Icon kind="book" />
            </button>
            <span />
            <button type="button" disabled={!explorerSelection} onClick={renameSelected} title="重命名">✎</button>
            <button type="button" disabled={!explorerSelection} onClick={deleteSelected} title="删除">⌫</button>
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
                <Icon kind={doc.type === "sheet" ? "sheet" : "graph"} />
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

          {activeDoc.type === "sheet" && activeSheet && activeBook ? (
            <>
              <div className="data-toolbar">
                <div className="data-toolbar-left">
                  <span
                    className={
                      activeBook.source.kind === "linked"
                        ? "source-badge is-linked"
                        : "source-badge"
                    }
                  >
                    {activeBook.source.kind === "linked" ? "LINKED" : "EMBEDDED"}
                  </span>
                  <strong>{activeSheet.name}</strong>
                </div>
                <div className="data-toolbar-actions">
                  <button type="button" onClick={addSheet}>+ Sheet</button>
                  <button type="button" disabled={dataReadOnly} onClick={addRow}>+ 行</button>
                  <button type="button" disabled={dataReadOnly} onClick={addColumn}>+ 列</button>
                  <button type="button" onClick={() => setPasteOpen(true)} disabled={dataReadOnly}>粘贴表</button>
                  <button type="button" onClick={createGraphFromSheet}>新建图</button>
                  {dataReadOnly ? (
                    <>
                      <button type="button" onClick={() => triggerDataFile("reload")}>重新加载</button>
                      <button type="button" onClick={unlinkBook}>解除链接</button>
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
                            draggable={!dataReadOnly}
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
                  <button type="button" onClick={() => openDocument({ type: "sheet", id: activeFigure.dataRef.sheetId })}>数据</button>
                  <button type="button" onClick={() => void resetView()}>重置</button>
                  <button type="button" onClick={() => void exportFigure("svg")}>SVG</button>
                  <button type="button" onClick={() => void exportFigure("png")}>PNG</button>
                  <button
                    type="button"
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
          {activeDoc.type === "sheet" && activeSheet && activeBook ? (
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
                        {activeBook.source.kind === "linked" ? "Linked Data" : "Embedded Data"}
                      </span>
                    </div>

                    {activeBook.source.kind === "linked" && (
                      <>
                        <div className="prop-row">
                          <label>文件</label>
                          <span className="property-text ellipsis">
                            {activeBook.source.fileName ?? "未定位"}
                          </span>
                        </div>
                        <div className="prop-row">
                          <label>状态</label>
                          <span
                            className={
                              activeBook.source.status === "ok"
                                ? "link-status is-ok"
                                : "link-status"
                            }
                          >
                            {activeBook.source.status === "ok"
                              ? "已链接"
                              : "需要重新定位"}
                          </span>
                        </div>
                      </>
                    )}

                    <div className="section-divider">工作表</div>

                    <div className="prop-row">
                      <label>名称</label>
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
                    <div className="prop-row prop-muted">
                      <label>行数</label>
                      <span>{rowCount}</span>
                    </div>
                    <div className="prop-row prop-muted">
                      <label>列数</label>
                      <span>{activeSheet.columns.length}</span>
                    </div>

                    <div className="source-actions">
                      {activeBook.source.kind === "linked" ? (
                        <>
                          <button type="button" onClick={() => triggerDataFile("reload")}>重新选择 / 加载</button>
                          <button type="button" onClick={unlinkBook}>解除链接并编辑</button>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => triggerDataFile("replace")}>替换当前表</button>
                          <button type="button" onClick={createGraphFromSheet}>按列角色新建图</button>
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
                      <p><b>X</b> 横坐标；<b>Y</b> 主数据；<b>Z</b> 二维/三维场；<b>XErr / YErr</b> 误差；<b>Label</b> 文本标签。</p>
                      <p>角色只决定“新建图”时的默认映射；已有图通过稳定 Column ID 引用，不会因你改角色而突然换数据。</p>
                    </div>
                  </section>
                )}
              </div>
            </>
          ) : activeFigure && plotDataset ? (
            <>
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

                    {fieldTemplate && (
                      <>
                        <div className="section-divider">场图</div>
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
                          ↓
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
                          ↑
                        </button>
                      </div>
                    </div>
                  </section>
                )}

                {inspectorTab === "axis" && (
                  <section className="inspector-pane">
                    <div className="pane-heading"><strong>坐标轴</strong></div>

                    <div className="prop-row">
                      <label>X 标题</label>
                      <input
                        type="text"
                        value={activeFigure.figureOverrides.xTitle ?? ""}
                        onChange={(event) => setFigureField("xTitle", event.target.value)}
                      />
                    </div>
                    <div className="prop-row">
                      <label>Y 标题</label>
                      <input
                        type="text"
                        value={activeFigure.figureOverrides.yTitle ?? ""}
                        onChange={(event) => setFigureField("yTitle", event.target.value)}
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
                    <div className="pane-heading"><strong>图例</strong></div>
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
              <button className="primary-button" type="button" onClick={pasteAsNewSheet}>创建 Sheet</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default App;
