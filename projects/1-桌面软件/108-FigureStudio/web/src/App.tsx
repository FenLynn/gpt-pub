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
import { presetOrder, presets } from "./plot/presets";

const STORAGE_KEY = "figurestudio-p108-demo-v1";

function ptToPx(value: number): number {
  return value * (96 / 72);
}

function mmToPx(value: number): number {
  return value * (96 / 25.4);
}

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
      Reset
    </button>
  );
}

function App() {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [dataset, setDataset] = useState<Dataset>(() => createDemoDataset());
  const [presetId, setPresetId] = useState<PresetId>("scientific");
  const [selectedSeriesId, setSelectedSeriesId] = useState("measured");
  const [figureOverrides, setFigureOverrides] = useState<FigureOverrides>({
    xTitle: "Wavelength $\\lambda$ (nm)",
    yTitle: "Power (dBm)"
  });
  const [seriesOverrides, setSeriesOverrides] = useState<Record<string, SeriesOverride>>({});
  const [message, setMessage] = useState("Synthetic demo data · safe to edit");

  const preset = presets[presetId];

  useEffect(() => {
    if (!dataset.ys.some((series) => series.id === selectedSeriesId)) {
      setSelectedSeriesId(dataset.ys[0]?.id || "");
    }
  }, [dataset, selectedSeriesId]);

  const selectedSeries = dataset.ys.find((series) => series.id === selectedSeriesId) || dataset.ys[0];
  const selectedOverride = selectedSeries ? seriesOverrides[selectedSeries.id] || {} : {};

  const effectiveFontFamily = figureOverrides.fontFamily || preset.fontFamily;
  const effectiveFontSizePt = figureOverrides.fontSizePt || preset.fontSizePt;
  const effectiveLegendVisible = figureOverrides.legendVisible ?? true;
  const effectiveXTitle = figureOverrides.xTitle || axisLabel(dataset.x.name, dataset.x.unit);
  const effectiveYTitle =
    figureOverrides.yTitle ||
    axisLabel(dataset.ys[0]?.name === "Measured" ? "Power" : dataset.ys[0]?.name || "Y", dataset.ys[0]?.unit);

  const traces = useMemo(() => {
    return dataset.ys.map((series, index) => {
      const override = seriesOverrides[series.id] || {};
      const lineWidthPt = override.lineWidthPt || preset.lineWidthPt;
      const markerVisible = override.markerVisible ?? false;
      const markerSizePt = override.markerSizePt || preset.markerSizePt;
      const color = override.color || preset.palette[index % preset.palette.length];
      const isFit = /fit/i.test(series.name);

      return {
        type: "scatter",
        mode: markerVisible ? "lines+markers" : "lines",
        name: series.name,
        x: dataset.x.values,
        y: series.values,
        line: {
          color,
          width: ptToPx(isFit ? Math.max(0.65, lineWidthPt * 0.9) : lineWidthPt),
          dash: isFit ? "dash" : "solid"
        },
        marker: {
          color,
          size: ptToPx(markerSizePt),
          symbol: "circle",
          line: {
            color: "#ffffff",
            width: 0.45
          }
        },
        hovertemplate:
          "<b>" +
          series.name +
          "</b><br>" +
          dataset.x.name +
          ": %{x:.4f}" +
          (dataset.x.unit ? " " + dataset.x.unit : "") +
          "<br>" +
          (series.unit ? "%{y:.3f} " + series.unit : "%{y:.3f}") +
          "<extra></extra>"
      };
    });
  }, [dataset, preset, seriesOverrides]);

  useEffect(() => {
    const node = plotRef.current as any;
    if (!node) return;

    const fontSizePx = ptToPx(effectiveFontSizePt);
    const axisWidthPx = ptToPx(preset.axisWidthPt);

    const layout = {
      autosize: true,
      height: 548,
      margin: { l: 76, r: 30, t: 26, b: 68, pad: 0 },
      paper_bgcolor: "#ffffff",
      plot_bgcolor: "#ffffff",
      showlegend: effectiveLegendVisible,
      hovermode: "closest",
      dragmode: "zoom",
      uirevision: "figurestudio-preview",
      font: {
        family: effectiveFontFamily,
        size: fontSizePx,
        color: "#17191c"
      },
      legend: {
        orientation: "h",
        x: 0.02,
        y: 0.985,
        xanchor: "left",
        yanchor: "top",
        bgcolor: "rgba(255,255,255,0.78)",
        borderwidth: 0,
        font: {
          family: effectiveFontFamily,
          size: fontSizePx * 0.92
        }
      },
      xaxis: {
        title: {
          text: effectiveXTitle,
          standoff: 12,
          font: { family: effectiveFontFamily, size: fontSizePx * 1.02 }
        },
        showline: true,
        mirror: true,
        linewidth: axisWidthPx,
        linecolor: "#202328",
        ticks: "inside",
        ticklen: ptToPx(3.6),
        tickwidth: axisWidthPx,
        tickcolor: "#202328",
        showgrid: preset.showGrid,
        gridcolor: "#e8eaed",
        gridwidth: 0.7,
        zeroline: false,
        automargin: true
      },
      yaxis: {
        title: {
          text: effectiveYTitle,
          standoff: 10,
          font: { family: effectiveFontFamily, size: fontSizePx * 1.02 }
        },
        showline: true,
        mirror: true,
        linewidth: axisWidthPx,
        linecolor: "#202328",
        ticks: "inside",
        ticklen: ptToPx(3.6),
        tickwidth: axisWidthPx,
        tickcolor: "#202328",
        showgrid: preset.showGrid,
        gridcolor: "#e8eaed",
        gridwidth: 0.7,
        zeroline: false,
        automargin: true
      }
    };

    const config = {
      responsive: true,
      displaylogo: false,
      scrollZoom: true,
      modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
      toImageButtonOptions: {
        filename: "figurestudio-demo"
      }
    };

    let cancelled = false;

    Plotly.react(node, traces, layout, config).then(() => {
      if (cancelled) return;
      node.removeAllListeners?.("plotly_click");
      node.on?.("plotly_click", (event: any) => {
        const index = event?.points?.[0]?.curveNumber;
        const series = typeof index === "number" ? dataset.ys[index] : undefined;
        if (series) setSelectedSeriesId(series.id);
      });
    });

    return () => {
      cancelled = true;
      node.removeAllListeners?.("plotly_click");
    };
  }, [
    dataset,
    traces,
    preset,
    effectiveFontFamily,
    effectiveFontSizePt,
    effectiveLegendVisible,
    effectiveXTitle,
    effectiveYTitle
  ]);

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

  function setFigureField<K extends keyof FigureOverrides>(key: K, value: FigureOverrides[K]) {
    setFigureOverrides((current) => ({ ...current, [key]: value }));
  }

  function resetFigureField(field: keyof FigureOverrides) {
    setFigureOverrides((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function importFile(file: File) {
    try {
      const text = await file.text();
      const parsed = parseDelimitedText(text, file.name);
      setDataset(parsed);
      setSelectedSeriesId(parsed.ys[0]?.id || "");
      setSeriesOverrides({});
      setFigureOverrides({
        xTitle: axisLabel(parsed.x.name, parsed.x.unit),
        yTitle: axisLabel(parsed.ys[0]?.name || "Y", parsed.ys[0]?.unit)
      });
      setMessage("Imported " + file.name + " · " + String(parsed.ys.length) + " Y series");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import file.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function saveDemoProject() {
    const project: StoredProject = {
      version: 1,
      dataset,
      presetId,
      figureOverrides,
      seriesOverrides
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    setMessage("Saved in this browser · prototype local storage");
  }

  function restoreDemoProject() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setMessage("No saved browser project yet.");
      return;
    }

    try {
      const project = JSON.parse(raw) as StoredProject;
      setDataset(project.dataset);
      setPresetId(project.presetId);
      setFigureOverrides(project.figureOverrides || {});
      setSeriesOverrides(project.seriesOverrides || {});
      setSelectedSeriesId(project.dataset.ys[0]?.id || "");
      setMessage("Restored browser project.");
    } catch {
      setMessage("Saved project could not be restored.");
    }
  }

  function resetDemo() {
    setDataset(createDemoDataset());
    setPresetId("scientific");
    setSelectedSeriesId("measured");
    setFigureOverrides({
      xTitle: "Wavelength $\\lambda$ (nm)",
      yTitle: "Power (dBm)"
    });
    setSeriesOverrides({});
    setMessage("Reset to synthetic demo data.");
  }

  async function exportFigure(format: "svg" | "png") {
    if (!plotRef.current) return;
    const width = Math.round(mmToPx(preset.widthMm));
    const height = Math.round(mmToPx(preset.heightMm));

    await Plotly.downloadImage(plotRef.current, {
      format,
      filename: "figurestudio-" + presetId,
      width,
      height,
      scale: format === "png" ? 3 : 1
    });

    setMessage(
      "Exported " +
        format.toUpperCase() +
        " · " +
        String(preset.widthMm) +
        " × " +
        String(preset.heightMm) +
        " mm"
    );
  }

  const lineWidth = selectedOverride.lineWidthPt || preset.lineWidthPt;
  const markerVisible = selectedOverride.markerVisible ?? false;
  const markerSize = selectedOverride.markerSizePt || preset.markerSizePt;
  const selectedIndex = selectedSeries
    ? Math.max(
        0,
        dataset.ys.findIndex((series) => series.id === selectedSeries.id)
      )
    : 0;
  const selectedColor =
    selectedOverride.color || preset.palette[selectedIndex % preset.palette.length];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-group">
          <div className="brand-mark">F</div>
          <div>
            <div className="brand-title">FigureStudio</div>
            <div className="brand-subtitle">P108 · scientific plotting prototype</div>
          </div>
        </div>

        <nav className="menu-strip" aria-label="Main menu">
          <button type="button">File</button>
          <button type="button">Edit</button>
          <button type="button">Plot</button>
          <button type="button">Template</button>
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
            Restore
          </button>
          <button className="quiet-button" type="button" onClick={saveDemoProject}>
            Save demo
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            Import data
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="left-panel">
          <div className="panel-heading">
            <span>Project</span>
            <button type="button" title="Reset demo" onClick={resetDemo}>
              ↺
            </button>
          </div>

          <div className="tree">
            <div className="tree-row tree-root">
              <span className="chevron">⌄</span>
              <span className="tree-icon">◇</span>
              <span>Untitled project</span>
            </div>

            <div className="tree-row tree-folder">
              <span className="tree-indent" />
              <span className="chevron">⌄</span>
              <span className="tree-icon">▱</span>
              <span>Data</span>
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
              <span>Figures</span>
            </div>

            <button className="tree-row tree-button" type="button">
              <span className="tree-indent wide" />
              <span className="tree-icon">▧</span>
              <span>Figure 1 · Spectrum</span>
            </button>

            <div className="tree-row tree-folder">
              <span className="tree-indent" />
              <span className="chevron">›</span>
              <span className="tree-icon">▱</span>
              <span>Templates</span>
            </div>
          </div>

          <div className="left-section">
            <div className="section-label">Series</div>
            <div className="series-list">
              {dataset.ys.map((series, index) => {
                const override = seriesOverrides[series.id] || {};
                const color = override.color || preset.palette[index % preset.palette.length];
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
                  </button>
                );
              })}
            </div>
          </div>

          <div className="left-footer">
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              + Add dataset
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
              <button type="button" onClick={() => exportFigure("svg")}>
                SVG
              </button>
              <button type="button" onClick={() => exportFigure("png")}>
                PNG
              </button>
            </div>
          </div>

          <div className="canvas-area">
            <div className="paper-stage">
              <div className="paper-caption">
                <span>Figure 1</span>
                <span>{preset.widthMm} × {preset.heightMm} mm</span>
              </div>
              <div className="figure-paper">
                <div ref={plotRef} className="plot-host" />
              </div>
            </div>
          </div>

          <div className="statusbar">
            <span className="status-message">{message}</span>
            <span className="status-meta">
              {preset.label} · {preset.widthMm} mm · {effectiveFontFamily} · {effectiveFontSizePt} pt
            </span>
          </div>
        </section>

        <aside className="right-panel">
          <div className="inspector-heading">
            <div>
              <div className="inspector-kicker">Properties</div>
              <div className="inspector-title">{selectedSeries?.name || "Figure"}</div>
            </div>
            <span className="selection-badge">Series</span>
          </div>

          <section className="property-section">
            <div className="property-title">Figure</div>

            <label className="field">
              <span>Preset</span>
              <select value={presetId} onChange={(event) => setPresetId(event.target.value as PresetId)}>
                {presetOrder.map((id) => (
                  <option key={id} value={id}>
                    {presets[id].label}
                  </option>
                ))}
              </select>
            </label>

            <div className="field-with-reset">
              <label className="field">
                <span>Font</span>
                <select
                  value={effectiveFontFamily}
                  onChange={(event) =>
                    setFigureField("fontFamily", event.target.value as "Arial" | "Times New Roman")
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
                <span>Font size</span>
                <div className="number-unit">
                  <input
                    type="number"
                    min="5"
                    max="16"
                    step="0.25"
                    value={effectiveFontSizePt}
                    onChange={(event) => setFigureField("fontSizePt", Number(event.target.value))}
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
              label="Legend"
              checked={effectiveLegendVisible}
              onChange={(value) => setFigureField("legendVisible", value)}
            />

            <label className="field">
              <span>X label</span>
              <input
                type="text"
                value={effectiveXTitle}
                onChange={(event) => setFigureField("xTitle", event.target.value)}
              />
            </label>

            <label className="field">
              <span>Y label</span>
              <input
                type="text"
                value={effectiveYTitle}
                onChange={(event) => setFigureField("yTitle", event.target.value)}
              />
            </label>

            <div className="hint">
              LaTeX is enabled for the Pages prototype. Try <code>$\lambda$</code>.
            </div>
          </section>

          <section className="property-section">
            <div className="property-title">Series</div>

            <div className="field-with-reset">
              <label className="field">
                <span>Line width</span>
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

            <Toggle
              label="Markers"
              checked={markerVisible}
              onChange={(value) => updateSeriesOverride({ markerVisible: value })}
            />

            <div className="field-with-reset">
              <label className="field">
                <span>Marker size</span>
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
                <span>Color</span>
                <div>
                  <input
                    type="color"
                    value={selectedColor}
                    onChange={(event) => updateSeriesOverride({ color: event.target.value })}
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
            <div className="property-title">Publication</div>
            <dl>
              <div>
                <dt>Canvas</dt>
                <dd>{preset.widthMm} × {preset.heightMm} mm</dd>
              </div>
              <div>
                <dt>Axes</dt>
                <dd>{preset.axisWidthPt} pt</dd>
              </div>
              <div>
                <dt>Grid</dt>
                <dd>{preset.showGrid ? "On" : "Off"}</dd>
              </div>
              <div>
                <dt>Renderer</dt>
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
