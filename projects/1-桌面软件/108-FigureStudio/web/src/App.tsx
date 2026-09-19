import { useEffect, useMemo, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import { createDemoDataset } from "./data/demo";
import { parseDelimitedText } from "./lib/csv";
import type {
  AspectMode,
  Dataset,
  FigureOverrides,
  PresetId,
  SeriesOverride,
  StoredProject
} from "./model";
import {
  buildLayout,
  buildTraces,
  orderSeries,
  PNG_DPI,
  resolveCanvasMm
} from "./plot/renderSpec";
import { presetOrder, presets } from "./plot/presets";

const STORAGE_KEY = "figurestudio-p108-demo-v3";
const PNG_SCALE = PNG_DPI / 96;

function axisLabel(name: string, unit?: string): string {
  return unit ? name + " (" + unit + ")" : name;
}

function MiniSwitch(props: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={props.checked ? "mini-switch is-on" : "mini-switch"}
      aria-pressed={props.checked}
      onClick={() => props.onChange(!props.checked)}
    >
      <span />
    </button>
  );
}

function ResetIcon(props: { visible: boolean; onReset: () => void }) {
  if (!props.visible) return null;
  return (
    <button className="reset-icon" type="button" title="恢复继承值" onClick={props.onReset}>
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
  const plotRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [dataset, setDataset] = useState<Dataset>(() => createDemoDataset());
  const [presetId, setPresetId] = useState<PresetId>("scientific");
  const [selectedSeriesId, setSelectedSeriesId] = useState("measured");
  const [seriesOrder, setSeriesOrder] = useState<string[]>(["measured", "fit"]);
  const [previewScale, setPreviewScale] = useState(1);
  const [figureOverrides, setFigureOverrides] = useState<FigureOverrides>({
    xTitle: "波长 λ (nm)",
    yTitle: "功率 (dBm)",
    aspectMode: "4:3"
  });
  const [seriesOverrides, setSeriesOverrides] = useState<Record<string, SeriesOverride>>({});

  const preset = presets[presetId];
  const orderedSeries = useMemo(
    () => orderSeries(dataset, seriesOrder),
    [dataset, seriesOrder]
  );

  const selectedSeries =
    dataset.ys.find((series) => series.id === selectedSeriesId) || dataset.ys[0];
  const selectedOverride = selectedSeries
    ? seriesOverrides[selectedSeries.id] || {}
    : {};

  const effectiveFontFamily = figureOverrides.fontFamily || preset.fontFamily;
  const effectiveFontSizePt = figureOverrides.fontSizePt ?? preset.fontSizePt;
  const effectiveLegendVisible = figureOverrides.legendVisible ?? true;
  const effectiveXTitle =
    figureOverrides.xTitle || axisLabel(dataset.x.name, dataset.x.unit);
  const effectiveYTitle =
    figureOverrides.yTitle ||
    axisLabel(dataset.ys[0]?.name || "Y", dataset.ys[0]?.unit);
  const aspectMode = figureOverrides.aspectMode ?? "4:3";
  const canvasMm = resolveCanvasMm(preset, figureOverrides);

  const traces = useMemo(
    () =>
      buildTraces({
        dataset,
        orderedSeries,
        preset,
        seriesOverrides
      }),
    [dataset, orderedSeries, preset, seriesOverrides]
  );

  const layout = useMemo(
    () =>
      buildLayout({
        preset,
        figureOverrides,
        xTitle: effectiveXTitle,
        yTitle: effectiveYTitle
      }),
    [preset, figureOverrides, effectiveXTitle, effectiveYTitle]
  );

  useEffect(() => {
    if (!dataset.ys.some((series) => series.id === selectedSeriesId)) {
      setSelectedSeriesId(dataset.ys[0]?.id || "");
    }
  }, [dataset, selectedSeriesId]);

  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;

    const updateScale = () => {
      const rect = node.getBoundingClientRect();
      const availableWidth = Math.max(160, rect.width - 28);
      const availableHeight = Math.max(160, rect.height - 28);
      const fit = Math.min(
        availableWidth / layout.width,
        availableHeight / layout.height
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
    if (!node) return;

    const config = {
      responsive: false,
      displaylogo: false,
      displayModeBar: false,
      scrollZoom: true
    };

    let cancelled = false;

    Plotly.react(node, traces, layout, config).then(() => {
      if (cancelled) return;
      node.removeAllListeners?.("plotly_click");
      node.on?.("plotly_click", (event: any) => {
        const index = event?.points?.[0]?.curveNumber;
        const series = typeof index === "number" ? orderedSeries[index] : undefined;
        if (series) setSelectedSeriesId(series.id);
      });
    });

    return () => {
      cancelled = true;
      node.removeAllListeners?.("plotly_click");
    };
  }, [traces, layout, orderedSeries]);

  function updateSeriesOverride(patch: SeriesOverride) {
    if (!selectedSeries) return;
    setSeriesOverrides((current) => ({
      ...current,
      [selectedSeries.id]: {
        ...(current[selectedSeries.id] || {}),
        ...patch
      }
    }));
  }

  function resetSeriesField(field: keyof SeriesOverride) {
    if (!selectedSeries) return;
    setSeriesOverrides((current) => {
      const next = { ...current };
      const currentSeries = { ...(next[selectedSeries.id] || {}) };
      delete currentSeries[field];

      if (Object.keys(currentSeries).length === 0) {
        delete next[selectedSeries.id];
      } else {
        next[selectedSeries.id] = currentSeries;
      }

      return next;
    });
  }

  function setFigureField<K extends keyof FigureOverrides>(
    key: K,
    value: FigureOverrides[K]
  ) {
    setFigureOverrides((current) => ({ ...current, [key]: value }));
  }

  function resetFigureField(field: keyof FigureOverrides) {
    setFigureOverrides((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function moveSelectedSeries(direction: "up" | "down") {
    if (!selectedSeries) return;

    setSeriesOrder((current) => {
      const normalized = orderSeries(dataset, current).map((series) => series.id);
      const index = normalized.indexOf(selectedSeries.id);
      if (index < 0) return normalized;

      const target =
        direction === "up"
          ? Math.min(normalized.length - 1, index + 1)
          : Math.max(0, index - 1);

      if (target === index) return normalized;

      const next = [...normalized];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function importFile(file: File) {
    try {
      const text = await file.text();
      const parsed = parseDelimitedText(text, file.name);
      setDataset(parsed);
      setSelectedSeriesId(parsed.ys[0]?.id || "");
      setSeriesOrder(parsed.ys.map((series) => series.id));
      setSeriesOverrides({});
      setFigureOverrides((current) => ({
        ...current,
        xTitle: axisLabel(parsed.x.name, parsed.x.unit),
        yTitle: axisLabel(parsed.ys[0]?.name || "Y", parsed.ys[0]?.unit)
      }));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "数据导入失败。");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function saveDemoProject() {
    const project: StoredProject = {
      version: 3,
      dataset,
      presetId,
      figureOverrides,
      seriesOverrides,
      seriesOrder
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  }

  function restoreDemoProject() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    try {
      const project = JSON.parse(raw) as StoredProject;
      setDataset(project.dataset);
      setPresetId(project.presetId);
      setFigureOverrides({
        aspectMode: "4:3",
        ...(project.figureOverrides || {})
      });
      setSeriesOverrides(project.seriesOverrides || {});
      setSeriesOrder(
        project.seriesOrder?.length
          ? project.seriesOrder
          : project.dataset.ys.map((series) => series.id)
      );
      setSelectedSeriesId(project.dataset.ys[0]?.id || "");
    } catch {
      window.alert("保存的项目状态无法恢复。");
    }
  }

  function resetDemo() {
    const demo = createDemoDataset();
    setDataset(demo);
    setPresetId("scientific");
    setSelectedSeriesId("measured");
    setSeriesOrder(demo.ys.map((series) => series.id));
    setFigureOverrides({
      xTitle: "波长 λ (nm)",
      yTitle: "功率 (dBm)",
      aspectMode: "4:3"
    });
    setSeriesOverrides({});
  }

  async function resetView() {
    if (!plotRef.current) return;
    await Plotly.relayout(plotRef.current, {
      "xaxis.autorange": true,
      "yaxis.autorange": true
    });
  }

  async function exportFigure(format: "svg" | "png") {
    const node = plotRef.current as any;
    if (!node) return;

    const dataUrl = await Plotly.toImage(node, {
      format,
      filename: "figurestudio-" + presetId,
      width: layout.width,
      height: layout.height,
      scale: format === "png" ? PNG_SCALE : 1
    });

    downloadDataUrl(
      dataUrl,
      "figurestudio-" +
        presetId +
        (format === "png" ? "-600dpi.png" : ".svg")
    );
  }

  const lineWidth = selectedOverride.lineWidthPt ?? preset.lineWidthPt;
  const markerVisible = selectedOverride.markerVisible ?? false;
  const markerSize = selectedOverride.markerSizePt ?? preset.markerSizePt;
  const opacity = selectedOverride.opacity ?? 1;
  const selectedIndex = selectedSeries
    ? Math.max(
        0,
        dataset.ys.findIndex((series) => series.id === selectedSeries.id)
      )
    : 0;
  const selectedColor =
    selectedOverride.color || preset.palette[selectedIndex % preset.palette.length];

  const layerIndex = selectedSeries ? seriesOrder.indexOf(selectedSeries.id) : -1;
  const isTopLayer = layerIndex === seriesOrder.length - 1;
  const isBottomLayer = layerIndex <= 0;

  const scaledWidth = Math.max(1, layout.width * previewScale);
  const scaledHeight = Math.max(1, layout.height * previewScale);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-group">
          <div className="brand-mark">F</div>
          <div className="brand-title">FigureStudio</div>
        </div>

        <nav className="menu-strip" aria-label="主菜单">
          <button type="button">文件</button>
          <button type="button">编辑</button>
          <button type="button">绘图</button>
          <button type="button">模板</button>
        </nav>

        <div className="top-actions">
          <input
            ref={fileInputRef}
            className="hidden-input"
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
            }}
          />
          <button className="quiet-button" type="button" onClick={restoreDemoProject}>
            恢复
          </button>
          <button className="quiet-button" type="button" onClick={saveDemoProject}>
            保存
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            导入数据
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="left-panel">
          <div className="panel-heading">
            <span>项目</span>
            <button type="button" title="恢复演示数据" onClick={resetDemo}>
              ↺
            </button>
          </div>

          <div className="left-scroll">
            <div className="tree">
              <div className="tree-row tree-root">
                <span className="chevron">⌄</span>
                <span className="tree-icon">◇</span>
                <span>未命名项目</span>
              </div>

              <div className="tree-row tree-folder">
                <span className="tree-indent" />
                <span className="chevron">⌄</span>
                <span className="tree-icon">▱</span>
                <span>数据</span>
              </div>

              <button className="tree-row tree-button tree-selected" type="button">
                <span className="tree-indent wide" />
                <span className="tree-icon">▦</span>
                <span className="tree-label">{dataset.name}</span>
              </button>

              <div className="column-list">
                <div className="column-row">
                  <span className="role-chip">X</span>
                  <span>{axisLabel(dataset.x.name, dataset.x.unit)}</span>
                </div>
                {dataset.ys.map((series, index) => (
                  <button
                    key={series.id}
                    type="button"
                    className={
                      selectedSeries?.id === series.id
                        ? "column-row column-button column-selected"
                        : "column-row column-button"
                    }
                    onClick={() => setSelectedSeriesId(series.id)}
                  >
                    <span className="role-chip">Y{index + 1}</span>
                    <span>{axisLabel(series.name, series.unit)}</span>
                  </button>
                ))}
              </div>

              <div className="tree-row tree-folder tree-space">
                <span className="tree-indent" />
                <span className="chevron">⌄</span>
                <span className="tree-icon">▱</span>
                <span>图形</span>
              </div>

              <button className="tree-row tree-button" type="button">
                <span className="tree-indent wide" />
                <span className="tree-icon">▧</span>
                <span>图 1 · 光谱</span>
              </button>
            </div>

            <div className="left-section">
              <div className="section-label">曲线</div>
              <div className="series-list">
                {[...orderedSeries].reverse().map((series) => {
                  const sourceIndex = Math.max(
                    0,
                    dataset.ys.findIndex((item) => item.id === series.id)
                  );
                  const override = seriesOverrides[series.id] || {};
                  const color =
                    override.color || preset.palette[sourceIndex % preset.palette.length];

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
                      <span className="series-color" style={{ backgroundColor: color }} />
                      <span className="series-name">{series.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>

        <section className="center-panel">
          <div className="figure-toolbar">
            <div className="toolbar-field">
              <span>样式</span>
              <select
                value={presetId}
                onChange={(event) => setPresetId(event.target.value as PresetId)}
              >
                {presetOrder.map((id) => (
                  <option key={id} value={id}>
                    {presets[id].label}
                  </option>
                ))}
              </select>
            </div>

            <div className="figure-actions">
              <button type="button" onClick={() => void resetView()}>
                重置视图
              </button>
              <button type="button" onClick={() => void exportFigure("svg")}>
                SVG
              </button>
              <button type="button" onClick={() => void exportFigure("png")}>
                PNG
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
          <div className="inspector-heading">
            <span>属性</span>
            <strong>{selectedSeries?.name || "图形"}</strong>
          </div>

          <div className="inspector-scroll">
            <section className="inspector-group">
              <div className="group-title">画布</div>

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
                      value={figureOverrides.customAspectWidth ?? 4}
                      onChange={(event) =>
                        setFigureField("customAspectWidth", Number(event.target.value))
                      }
                    />
                    <span>:</span>
                    <input
                      type="number"
                      min="1"
                      step="0.1"
                      value={figureOverrides.customAspectHeight ?? 3}
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
                    visible={figureOverrides.fontFamily !== undefined}
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
                    visible={figureOverrides.fontSizePt !== undefined}
                    onReset={() => resetFigureField("fontSizePt")}
                  />
                </div>
              </div>

              <div className="prop-row">
                <label>图例</label>
                <MiniSwitch
                  checked={effectiveLegendVisible}
                  onChange={(value) => setFigureField("legendVisible", value)}
                />
              </div>

              <div className="prop-row prop-muted">
                <label>尺寸</label>
                <span>
                  {canvasMm.widthMm.toFixed(0)} × {canvasMm.heightMm.toFixed(1)} mm
                </span>
              </div>
            </section>

            <section className="inspector-group">
              <div className="group-title">曲线</div>

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

              <div className="prop-row">
                <label>线宽</label>
                <div className="control-with-reset">
                  <div className="compact-number">
                    <input
                      type="number"
                      min="0.4"
                      max="3"
                      step="0.05"
                      value={lineWidth}
                      onChange={(event) =>
                        updateSeriesOverride({ lineWidthPt: Number(event.target.value) })
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
                <label>透明度</label>
                <div className="control-with-reset">
                  <div className="compact-number">
                    <input
                      type="number"
                      min="10"
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
                <label>数据点</label>
                <select
                  value={markerVisible ? "circle" : "none"}
                  onChange={(event) =>
                    updateSeriesOverride({ markerVisible: event.target.value !== "none" })
                  }
                >
                  <option value="none">无</option>
                  <option value="circle">圆点</option>
                </select>
              </div>

              <div className="prop-row">
                <label>点大小</label>
                <div className="control-with-reset">
                  <div className="compact-number">
                    <input
                      type="number"
                      min="2"
                      max="10"
                      step="0.25"
                      value={markerSize}
                      disabled={!markerVisible}
                      onChange={(event) =>
                        updateSeriesOverride({ markerSizePt: Number(event.target.value) })
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
            </section>

            <section className="inspector-group">
              <div className="group-title">坐标轴</div>

              <div className="prop-row">
                <label>X 标题</label>
                <input
                  type="text"
                  value={effectiveXTitle}
                  onChange={(event) => setFigureField("xTitle", event.target.value)}
                />
              </div>

              <div className="prop-row">
                <label>Y 标题</label>
                <input
                  type="text"
                  value={effectiveYTitle}
                  onChange={(event) => setFigureField("yTitle", event.target.value)}
                />
              </div>
            </section>
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
