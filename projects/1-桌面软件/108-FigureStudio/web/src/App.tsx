import { useEffect, useMemo, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import { createDemoDataset } from "./data/demo";
import { parseDelimitedText } from "./lib/csv";
import type {
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
  PNG_DPI
} from "./plot/renderSpec";
import { presetOrder, presets } from "./plot/presets";

const STORAGE_KEY = "figurestudio-p108-demo-v2";
const PNG_SCALE = PNG_DPI / 96;

function axisLabel(name: string, unit?: string): string {
  return unit ? name + " (" + unit + ")" : name;
}

function Toggle(props: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <label className="toggle-row">
      <span>{props.label}</span>
      <button
        type="button"
        className={props.checked ? "switch switch-on" : "switch"}
        aria-pressed={props.checked}
        onClick={() => props.onChange(!props.checked)}
      >
        <span />
      </button>
    </label>
  );
}

function ResetButton(props: { visible: boolean; onReset: () => void }) {
  if (!props.visible) return null;
  return (
    <button className="reset-button" type="button" onClick={props.onReset}>
      恢复
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
  const [previewScale, setPreviewScale] = useState(1.6);
  const [figureOverrides, setFigureOverrides] = useState<FigureOverrides>({
    xTitle: "波长 λ (nm)",
    yTitle: "功率 (dBm)"
  });
  const [seriesOverrides, setSeriesOverrides] = useState<Record<string, SeriesOverride>>({});
  const [message, setMessage] = useState("当前为合成演示数据，可放心调整");

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
      const availableWidth = Math.max(320, rect.width - 90);
      const availableHeight = Math.max(260, rect.height - 90);
      const fit = Math.min(
        availableWidth / layout.width,
        availableHeight / layout.height
      );
      setPreviewScale(Math.max(0.75, Math.min(2.35, fit)));
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
      setFigureOverrides({
        xTitle: axisLabel(parsed.x.name, parsed.x.unit),
        yTitle: axisLabel(parsed.ys[0]?.name || "Y", parsed.ys[0]?.unit)
      });
      setMessage(
        "已导入 " + file.name + " · " + String(parsed.ys.length) + " 条 Y 曲线"
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "数据导入失败。");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function saveDemoProject() {
    const project: StoredProject = {
      version: 2,
      dataset,
      presetId,
      figureOverrides,
      seriesOverrides,
      seriesOrder
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    setMessage("当前项目状态已保存到本浏览器");
  }

  function restoreDemoProject() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setMessage("本浏览器还没有保存过项目状态。");
      return;
    }

    try {
      const project = JSON.parse(raw) as StoredProject;
      setDataset(project.dataset);
      setPresetId(project.presetId);
      setFigureOverrides(project.figureOverrides || {});
      setSeriesOverrides(project.seriesOverrides || {});
      setSeriesOrder(
        project.seriesOrder?.length
          ? project.seriesOrder
          : project.dataset.ys.map((series) => series.id)
      );
      setSelectedSeriesId(project.dataset.ys[0]?.id || "");
      setMessage("已恢复浏览器中的项目状态");
    } catch {
      setMessage("保存的项目状态无法恢复。");
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
      yTitle: "功率 (dBm)"
    });
    setSeriesOverrides({});
    setMessage("已恢复为默认合成演示数据");
  }

  async function resetView() {
    if (!plotRef.current) return;
    await Plotly.relayout(plotRef.current, {
      "xaxis.autorange": true,
      "yaxis.autorange": true
    });
    setMessage("已恢复完整坐标范围");
  }

  async function exportFigure(format: "svg" | "png") {
    const node = plotRef.current as any;
    if (!node) return;

    setMessage(format === "svg" ? "正在生成 SVG…" : "正在生成 600 dpi PNG…");

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

    setMessage(
      "已导出 " +
        format.toUpperCase() +
        " · 与当前预览使用同一 Plotly 画布、同一布局和同一图层"
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

  const layerIndex = selectedSeries
    ? seriesOrder.indexOf(selectedSeries.id)
    : -1;
  const isTopLayer = layerIndex === seriesOrder.length - 1;
  const isBottomLayer = layerIndex <= 0;

  const scaledWidth = Math.round(layout.width * previewScale);
  const scaledHeight = Math.round(layout.height * previewScale);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-group">
          <div className="brand-mark">F</div>
          <div>
            <div className="brand-title">FigureStudio</div>
            <div className="brand-subtitle">P108 · 科研论文绘图工作台</div>
          </div>
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
            恢复项目
          </button>
          <button className="quiet-button" type="button" onClick={saveDemoProject}>
            保存状态
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
            <button type="button" title="恢复默认演示" onClick={resetDemo}>
              ↺
            </button>
          </div>

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

            <div className="tree-row tree-folder">
              <span className="tree-indent" />
              <span className="chevron">›</span>
              <span className="tree-icon">▱</span>
              <span>模板</span>
            </div>
          </div>

          <div className="left-section">
            <div className="section-label">曲线与图层</div>
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
                    <span>{series.name}</span>
                    <span className="layer-mark">图层</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="left-footer">
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              + 添加数据
            </button>
          </div>
        </aside>

        <section className="center-panel">
          <div className="figure-toolbar">
            <div className="preset-tabs">
              {presetOrder.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={id === presetId ? "preset-tab preset-active" : "preset-tab"}
                  onClick={() => setPresetId(id)}
                >
                  {presets[id].label}
                </button>
              ))}
            </div>

            <div className="figure-actions">
              <span className="wysiwyg-badge">所见即所得</span>
              <button type="button" onClick={() => void resetView()}>
                重置视图
              </button>
              <button type="button" onClick={() => void exportFigure("svg")}>
                导出 SVG
              </button>
              <button type="button" onClick={() => void exportFigure("png")}>
                导出 PNG 600 dpi
              </button>
            </div>
          </div>

          <div ref={canvasRef} className="canvas-area">
            <div className="paper-stage" style={{ width: scaledWidth + "px" }}>
              <div className="paper-caption">
                <span>图 1</span>
                <span>
                  {preset.widthMm} × {preset.heightMm} mm · 预览缩放{" "}
                  {Math.round(previewScale * 100)}%
                </span>
              </div>

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
          </div>

          <div className="statusbar">
            <span className="status-message">{message}</span>
            <span className="status-meta">
              {preset.label} · {preset.widthMm} × {preset.heightMm} mm ·{" "}
              {effectiveFontFamily} · {effectiveFontSizePt} pt
            </span>
          </div>
        </section>

        <aside className="right-panel">
          <div className="inspector-heading">
            <div>
              <div className="inspector-kicker">属性</div>
              <div className="inspector-title">{selectedSeries?.name || "图形"}</div>
            </div>
            <span className="selection-badge">曲线</span>
          </div>

          <section className="property-section">
            <div className="property-title">图形</div>

            <label className="field">
              <span>预设</span>
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
            </label>

            <div className="field-with-reset">
              <label className="field">
                <span>字体</span>
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
              </label>
              <ResetButton
                visible={figureOverrides.fontFamily !== undefined}
                onReset={() => resetFigureField("fontFamily")}
              />
            </div>

            <div className="field-with-reset">
              <label className="field">
                <span>字号</span>
                <div className="number-unit">
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
              </label>
              <ResetButton
                visible={figureOverrides.fontSizePt !== undefined}
                onReset={() => resetFigureField("fontSizePt")}
              />
            </div>

            <Toggle
              label="显示图例"
              checked={effectiveLegendVisible}
              onChange={(value) => setFigureField("legendVisible", value)}
            />

            <label className="field">
              <span>X 轴标题</span>
              <input
                type="text"
                value={effectiveXTitle}
                onChange={(event) => setFigureField("xTitle", event.target.value)}
              />
            </label>

            <label className="field">
              <span>Y 轴标题</span>
              <input
                type="text"
                value={effectiveYTitle}
                onChange={(event) => setFigureField("yTitle", event.target.value)}
              />
            </label>

            <div className="hint">
              支持 Unicode 与 LaTeX，例如：<code>$\lambda$</code>
            </div>
          </section>

          <section className="property-section">
            <div className="property-title">曲线</div>

            <div className="layer-controls">
              <button
                type="button"
                disabled={isTopLayer}
                onClick={() => moveSelectedSeries("up")}
              >
                上移一层
              </button>
              <button
                type="button"
                disabled={isBottomLayer}
                onClick={() => moveSelectedSeries("down")}
              >
                下移一层
              </button>
            </div>

            <div className="field-with-reset">
              <label className="field">
                <span>线宽</span>
                <div className="range-line">
                  <input
                    type="range"
                    min="0.4"
                    max="3"
                    step="0.05"
                    value={lineWidth}
                    onChange={(event) =>
                      updateSeriesOverride({ lineWidthPt: Number(event.target.value) })
                    }
                  />
                  <strong>{lineWidth.toFixed(2)} pt</strong>
                </div>
              </label>
              <ResetButton
                visible={selectedOverride.lineWidthPt !== undefined}
                onReset={() => resetSeriesField("lineWidthPt")}
              />
            </div>

            <div className="field-with-reset">
              <label className="field">
                <span>透明度</span>
                <div className="range-line">
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={opacity}
                    onChange={(event) =>
                      updateSeriesOverride({ opacity: Number(event.target.value) })
                    }
                  />
                  <strong>{Math.round(opacity * 100)}%</strong>
                </div>
              </label>
              <ResetButton
                visible={selectedOverride.opacity !== undefined}
                onReset={() => resetSeriesField("opacity")}
              />
            </div>

            <Toggle
              label="显示数据点"
              checked={markerVisible}
              onChange={(value) => updateSeriesOverride({ markerVisible: value })}
            />

            <div className="field-with-reset">
              <label className="field">
                <span>数据点大小</span>
                <div className="range-line">
                  <input
                    type="range"
                    min="2"
                    max="10"
                    step="0.25"
                    value={markerSize}
                    disabled={!markerVisible}
                    onChange={(event) =>
                      updateSeriesOverride({ markerSizePt: Number(event.target.value) })
                    }
                  />
                  <strong>{markerSize.toFixed(1)} pt</strong>
                </div>
              </label>
              <ResetButton
                visible={selectedOverride.markerSizePt !== undefined}
                onReset={() => resetSeriesField("markerSizePt")}
              />
            </div>

            <div className="field-with-reset">
              <label className="field color-field">
                <span>颜色</span>
                <div>
                  <input
                    type="color"
                    value={selectedColor}
                    onChange={(event) =>
                      updateSeriesOverride({ color: event.target.value })
                    }
                  />
                  <span className="color-value">{selectedColor.toUpperCase()}</span>
                </div>
              </label>
              <ResetButton
                visible={selectedOverride.color !== undefined}
                onReset={() => resetSeriesField("color")}
              />
            </div>
          </section>

          <section className="property-section property-summary">
            <div className="property-title">出版信息</div>
            <dl>
              <div>
                <dt>画布尺寸</dt>
                <dd>
                  {preset.widthMm} × {preset.heightMm} mm
                </dd>
              </div>
              <div>
                <dt>轴线宽度</dt>
                <dd>{preset.axisWidthPt} pt</dd>
              </div>
              <div>
                <dt>网格</dt>
                <dd>{preset.showGrid ? "开启" : "关闭"}</dd>
              </div>
              <div>
                <dt>PNG</dt>
                <dd>{PNG_DPI} dpi</dd>
              </div>
              <div>
                <dt>渲染器</dt>
                <dd>Plotly.js</dd>
              </div>
            </dl>
          </section>
        </aside>
      </main>
    </div>
  );
}

export default App;
