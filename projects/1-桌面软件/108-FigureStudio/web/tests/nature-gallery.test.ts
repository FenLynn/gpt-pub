import assert from "node:assert/strict";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInitialProject } from "../src/data/demo";
import { findSheet, sheetToDataset } from "../src/data/adapter";
import { presets } from "../src/plot/presets";
import { buildLayout, buildTraces, resolveCanvasMm, mmToPx } from "../src/plot/renderSpec";
import { PrecisionSvg, supportsPrecisionSvg } from "../src/plot/PrecisionSvg";
import { LorentzFigure } from "../src/plot/LorentzFigure";
import { encodeProject, decodeProject } from "../src/project/projectIO";

for (const includeVisualQa of [false, true]) {
const project = createInitialProject(undefined, includeVisualQa);
const gallery = project.figures.filter(f => f.folderId === "folder-nature" && f.name.startsWith("N") && f.name.includes(" · "));
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
  assert.ok(markup.includes('data-series-id="lorentz-real"'),"real dispersion missing");
  assert.ok(markup.includes('data-series-id="lorentz-imag"'),"absorption missing");
  assert.ok(markup.includes('data-series-id="lorentz-phase"'),"phase lag missing");
  assert.ok(markup.includes('data-annotation-id="absorption"'),"annotation missing");
  assert.ok(markup.includes('data-annotation-id="resonance"'),"phase annotation missing");
  assert.ok(!markup.includes("NaN")&&!markup.includes("Infinity"),"invalid Lorentz SVG coordinates");
  assert.equal(golden!.lorentz!.annotations.length,6);
  assert.equal(golden!.folderId,"folder-golden","Golden Graph should not inflate 14 Nature cases");
  const readBox=(kind:"annotation-id"|"legend-panel",id:string)=>{
    const match=markup.match(new RegExp('data-'+kind+'="'+id+'" data-box-x="([^"]+)" data-box-y="([^"]+)" data-box-width="([^"]+)" data-box-height="([^"]+)"'));
    assert.ok(match,"Missing geometry for "+id);
    return {x:Number(match[1]),y:Number(match[2]),w:Number(match[3]),h:Number(match[4])};
  };
  const boxes=[
    ...golden!.lorentz!.annotations.map(a=>({...readBox("annotation-id",a.id),id:a.id,panel:a.panel})),
    {...readBox("legend-panel","top"),id:"top legend",panel:"top" as const},
    {...readBox("legend-panel","bottom"),id:"bottom legend",panel:"bottom" as const}
  ];
  const c=golden!.lorentz!;
  const top=c.plotTop??65, bottom=c.plotBottom??932;
  const topEnd=top+(bottom-top-c.panelGap)/2;
  const bottomStart=topEnd+c.panelGap;
  for(const box of boxes){
    assert.ok(box.x>=c.plotLeft!-2&&box.x+box.w<=c.plotRight!+2,
      box.id+" extends beyond horizontal plot area");
    const minY=box.panel==="top"?top:bottomStart;
    const maxY=box.panel==="top"?topEnd:bottom;
    assert.ok(box.y>=minY-2&&box.y+box.h<=maxY+2,
      box.id+" extends beyond its panel");
  }
  const intersect=(a:typeof boxes[number],b:typeof boxes[number])=>
    Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*
    Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    if(boxes[i].panel!==boxes[j].panel)continue;
    assert.equal(intersect(boxes[i],boxes[j]),0,
      boxes[i].id+" overlaps "+boxes[j].id);
  }
  const longFigure={...golden!,lorentz:{...c,annotations:[{
    ...c.annotations[0],text:"A very long user-editable scientific note with symbols χ(ω), phase lag and multiple lines",
    maxWidth:155
  }]}};
  const wrapped=renderToStaticMarkup(createElement(LorentzFigure,{
    figure:longFigure,dataset:ds,width:Number(ll.width),height:Number(ll.height),
    svgRef:createRef<SVGSVGElement>(),onSelectSeries:()=>{},
    onSelectAnnotation:()=>{},onMoveAnnotation:()=>{},onAxisClick:()=>{},onLegendClick:()=>{}
  }));
  const wrapWidth=wrapped.match(/data-annotation-id="absorption" data-box-x="[^"]+" data-box-y="[^"]+" data-box-width="([^"]+)"/);
  assert.ok(wrapWidth&&Number(wrapWidth[1])<=155,"Long annotations must wrap within user-defined width");

  assert.equal(golden!.figureOverrides.figureWidthMm,183);
  const roundTrip=decodeProject(encodeProject(project));
  const restored=roundTrip.figures.find(f=>f.id===golden!.id);
  assert.ok(restored?.lorentz,"Lorentz composition lost on .sfig roundtrip");
  assert.equal(restored.lorentz.annotations.length,6);
  assert.equal(restored.lorentz.annotations[0].arrowX,632);
  assert.equal(restored.seriesOverrides["lorentz-phase"].color,"#674080");
}
console.log("Nature gallery smoke OK: 14 Nature figures + real editable Lorentz Graph, normal+QA");
