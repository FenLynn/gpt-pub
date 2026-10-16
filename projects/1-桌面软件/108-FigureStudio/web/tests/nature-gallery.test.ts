import assert from "node:assert/strict";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInitialProject } from "../src/data/demo";
import { findSheet, sheetToDataset } from "../src/data/adapter";
import { presets } from "../src/plot/presets";
import { buildLayout, buildTraces, resolveCanvasMm, mmToPx } from "../src/plot/renderSpec";
import { PrecisionSvg, supportsPrecisionSvg } from "../src/plot/PrecisionSvg";
import { LorentzFigure } from "../src/plot/LorentzFigure";

for (const includeVisualQa of [false, true]) {
const project = createInitialProject(undefined, includeVisualQa);
const gallery = project.figures.filter(f => f.folderId === "folder-nature" && /^N\\d{2} ·/.test(f.name));
assert.equal(gallery.length, 14, "All 14 Nature visual cases must be accessible");
assert.equal(project.folders.filter(f => f.id === "folder-nature").length, 1);
assert.equal(gallery.filter(f => supportsPrecisionSvg(f)).length, 11,
  "Eleven XY samples should use real SVG; heatmap/contour/bar remain on Plotly");
assert.equal(gallery.filter(f => !supportsPrecisionSvg(f)).length, 3);

for (let n=0; n<gallery.length; n++) {
  const figure = gallery[n];
  assert.ok(figure.name.startsWith("N"+String(n+1).padStart(2,"0")),figure.name);
  assert.equal(figure.presetId,"nature");
  assert.equal(figure.figureOverrides.fontSizePt,6.5);
  const { xTitle, yTitle } = figure.figureOverrides;
  assert.ok(xTitle && yTitle, figure.name+" must have explicit English axes");
  assert.ok(/^[\x20-\x7e\u00b0]+$/.test(xTitle), figure.name+" non-English X");
  assert.ok(/^[\x20-\x7e\u00b0]+$/.test(yTitle), figure.name+" non-English Y");
  assert.ok(!xTitle.includes("$") && !yTitle.includes("$"), "No MathJax fallback");
  const ctx = findSheet(project, figure.dataRef!.sheetId);
  assert.ok(ctx, figure.name+" lost the source sheet");
  const dataset = sheetToDataset(ctx!.sheet, figure);
  assert.ok(dataset.ys.length>0, figure.name+" has no series");
  assert.ok(dataset.x.values.length>0 &&
    dataset.x.values.some(v=>typeof v==="number" && Number.isFinite(v)) ||
    dataset.x.values.some(v=>typeof v==="string" && v.length>0),
    figure.name+" has no actual X values");
  assert.ok(dataset.ys.some(y=>y.values.some(v=>typeof v==="number" && Number.isFinite(v))),
    figure.name+" has no actual numeric Y samples");
  const layout = buildLayout({dataset,figure,preset:presets.nature});
  const traces = buildTraces({dataset,figure,preset:presets.nature});
  assert.ok(layout.width>0 && layout.height>0);
  assert.ok(traces.length>0,figure.name+" produced zero traces");
  for(const tr of traces as Array<{x?:unknown[];y?:unknown[]}>) {
    if (!Array.isArray(tr.x) || !Array.isArray(tr.y)) continue; // 2D field matrix
    assert.ok(tr.x.length>0 && tr.y.length>0, figure.name+" contains a blank XY trace");
  }
  assert.ok(figure.figureOverrides.axisLineWidthPt!>=0.25 &&
    figure.figureOverrides.axisLineWidthPt!<=1.0);
  const mm = resolveCanvasMm(presets.nature,figure);
  assert.equal(mm.widthMm, n===13?183:89, figure.name+" print width");
  if(n===13) assert.equal(mm.heightMm,72,"Double-column height should be independent");
  assert.ok(Math.abs(layout.width-mmToPx(mm.widthMm))<1.0);
  if(supportsPrecisionSvg(figure)) {
    const svg = renderToStaticMarkup(createElement(PrecisionSvg, {
      figure, layout, traces, svgRef:createRef<SVGSVGElement>(),
      onSelectSeries:()=>{}, onAxisClick:()=>{}, onLegendClick:()=>{},
      onLegendDrag:()=>{}
    }));
    assert.ok(svg.startsWith("<svg"),figure.name+" did not render SVG");
    assert.ok(svg.includes(xTitle) && svg.includes(yTitle),
      figure.name+" lost English axis labels");
    assert.ok(svg.includes('viewBox="0 0 '),figure.name+" missing exact SVG viewbox");
    assert.ok(svg.includes("<path"),figure.name+" does not contain editable vector paths");
    assert.ok(!svg.includes("NaN") && !svg.includes("Infinity"),
      figure.name+" contains invalid geometry");
  }
}
  const golden=project.figures.find(f=>f.lorentz?.kind==="lorentz-two-panel");
  assert.ok(golden,"Lorentz golden Graph must exist in ordinary project");
  assert.equal(golden!.dataRef?.sheetId,"sheet-lorentz-golden");
  const source=findSheet(project,golden!.dataRef!.sheetId);
  assert.ok(source,"Lorentz editable source sheet must exist");
  assert.equal(source!.sheet.columns[0].values.length,1601);
  const ds=sheetToDataset(source!.sheet,golden!);
  assert.deepEqual(ds.ys.map(y=>y.id),["lorentz-real","lorentz-imag","lorentz-phase"]);
  const ll=buildLayout({dataset:ds,figure:golden!,preset:presets.nature});
  const markup=renderToStaticMarkup(createElement(LorentzFigure,{
    figure:golden!,dataset:ds,width:Number(ll.width),height:Number(ll.height),
    svgRef:createRef<SVGSVGElement>(),onSelectSeries:()=>{},
    onSelectAnnotation:()=>{},onMoveAnnotation:()=>{},onAxisClick:()=>{},onLegendClick:()=>{}
  }));
  assert.ok(markup.includes("data-series-id=\\\"lorentz-real\\\""),"real dispersion missing");
  assert.ok(markup.includes("data-series-id=\\\"lorentz-imag\\\""),"absorption missing");
  assert.ok(markup.includes("data-series-id=\\\"lorentz-phase\\\""),"phase lag missing");
  assert.ok(markup.includes("data-annotation-id=\\\"absorption\\\""),"annotation missing");
  assert.ok(markup.includes("data-annotation-id=\\\"resonance\\\""),"phase annotation missing");
  assert.ok(!markup.includes("NaN")&&!markup.includes("Infinity"),"invalid Lorentz SVG coordinates");
  assert.equal(golden!.lorentz!.annotations.length,6);
  assert.equal(golden!.figureOverrides.figureWidthMm,183);
}
console.log("Nature gallery smoke OK: 14 Nature figures + real editable Lorentz Graph, normal+QA");
