import assert from "node:assert/strict";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInitialProject } from "../src/data/demo";
import { findSheet, sheetToDataset } from "../src/data/adapter";
import { presets } from "../src/plot/presets";
import { buildLayout, buildTraces, resolveCanvasMm, mmToPx } from "../src/plot/renderSpec";
import { PrecisionSvg, supportsPrecisionSvg } from "../src/plot/PrecisionSvg";
import { LorentzFigure } from "../src/plot/LorentzFigure";
import { LorentzInspector } from "../src/plot/LorentzInspector";
import { encodeProject, decodeProject } from "../src/project/projectIO";
import { mathJaxExpressionForText, plainSvgMathFallback } from "../src/lib/mathText";
import { GOLDEN_STYLE } from "../src/plot/goldenStyle";

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
  if(n===0){
    assert.ok(xTitle.includes("$\\lambda$"),"N01 must exercise normal FigureStudio $...$ math syntax");
    assert.ok(mathJaxExpressionForText(xTitle)?.includes("\\lambda"),"LaTeX expression should retain lambda");
  }
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
  const goldenAxis=(layout as any).xaxis;
  if(goldenAxis){
    assert.equal(goldenAxis.linecolor,GOLDEN_STYLE.stroke.axisColor,
      figure.name+" must inherit the Lorentz Golden axis language");
    assert.equal(goldenAxis.tickcolor,GOLDEN_STYLE.stroke.tickStrokeColor,
      figure.name+" must inherit the Lorentz Golden tick language");
  }
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
    assert.ok(svg.includes('data-style-family="'+GOLDEN_STYLE.id+'"'),
      figure.name+" did not inherit FigureStudio Golden Style");
    assert.ok(svg.includes(plainSvgMathFallback(xTitle)) && svg.includes(plainSvgMathFallback(yTitle)),
      figure.name+" lost readable SVG axis labels");
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
  assert.ok(markup.includes('data-style-family="'+GOLDEN_STYLE.id+'"'),
    "Lorentz must remain the canonical FigureStudio Golden Style renderer");
  assert.ok(markup.includes('data-series-id="lorentz-real"'),"real dispersion missing");
  assert.ok(markup.includes('data-series-id="lorentz-imag"'),"absorption missing");
  assert.ok(markup.includes('data-series-id="lorentz-phase"'),"phase lag missing");
  assert.ok(markup.includes('data-annotation-id="absorption"'),"annotation missing");
  assert.ok(markup.includes('data-annotation-id="resonance"'),"phase annotation missing");
  assert.ok(golden!.figureOverrides.xTitle?.includes("$\\omega/\\omega_0$"));
  assert.ok(golden!.figureOverrides.yTitle?.includes("$\\chi(\\omega)$"));
  assert.ok(golden!.lorentz!.phaseYTitle.includes("$\\phi$"));
  assert.ok(golden!.lorentz!.annotations.some(a=>a.text.includes("$\\omega=\\omega_0$")));
  assert.ok(markup.includes('data-math-pending="true"'),
    "SSR must retain a visible math fallback until browser MathJax resolves");
  assert.ok(mathJaxExpressionForText("Coefficient $\\alpha_0$")?.includes("\\alpha_0"),
    "FigureStudio must parse $\\alpha$ syntax without rewriting the source");
  assert.ok(!markup.includes("NaN")&&!markup.includes("Infinity"),"invalid Lorentz SVG coordinates");
  const ptScale=Number(markup.match(/data-pt-scale="([^"]+)"/)?.[1]);
  assert.ok(Number.isFinite(ptScale)&&Math.abs(ptScale*Number(ll.width)/1200-96/72)<1e-9,
    "Physical point units must equal 1/72 inch at the exported figure width");
  const narrower={...golden!,figureOverrides:{...golden!.figureOverrides,figureWidthMm:89}};
  const narrowerLayout=buildLayout({dataset:ds,figure:narrower,preset:presets.nature});
  const narrowerMarkup=renderToStaticMarkup(createElement(LorentzFigure,{
    figure:narrower,dataset:ds,width:Number(narrowerLayout.width),height:Number(narrowerLayout.height),
    svgRef:createRef<SVGSVGElement>(),onSelectSeries:()=>{},
    onSelectAnnotation:()=>{},onMoveAnnotation:()=>{},onAxisClick:()=>{},onLegendClick:()=>{}
  }));
  const narrowerScale=Number(narrowerMarkup.match(/data-pt-scale="([^"]+)"/)?.[1]);
  assert.ok(Math.abs(narrowerScale*Number(narrowerLayout.width)/1200-96/72)<1e-9,
    "Changing figure mm must not change the physical point size");

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
  // Callouts and legends must not mask the actual scientific data.
  const x0=golden!.figureOverrides.xMin??.4;
  const x1=golden!.figureOverrides.xMax??1.6;
  const y0=golden!.figureOverrides.yMin??-3.9;
  const y1=golden!.figureOverrides.yMax??7.8;
  const plotW=(c.plotRight??1160)-(c.plotLeft??104);
  const panelH=((c.plotBottom??932)-(c.plotTop??65)-c.panelGap)/2;
  for(const box of boxes){
    const columns=box.panel==="top"?ds.ys.slice(0,2):ds.ys.slice(2,3);
    for(const column of columns){
      for(let k=0;k<ds.x.values.length;k++){
        const xx=ds.x.values[k],yy=column.values[k];
        if(typeof xx!=="number"||typeof yy!=="number")continue;
        const px=(c.plotLeft??104)+(xx-x0)/(x1-x0)*plotW;
        const py=box.panel==="top"
          ?(c.plotTop??65)+(y1-yy)/(y1-y0)*panelH
          :bottomStart+(c.phaseMax-yy)/(c.phaseMax-c.phaseMin)*panelH;
        assert.ok(!(px>=box.x-1&&px<=box.x+box.w+1&&py>=box.y-1&&py<=box.y+box.h+1),
          box.id+" obscures actual "+column.id+" data at "+xx);
      }
    }
  }
  const inspector=renderToStaticMarkup(createElement(LorentzInspector,{
    value:c,selectedId:"absorption",onSelect:()=>{},onChange:()=>{}
  }));
  assert.ok(inspector.includes("lorentz-group")&&inspector.includes("自动换行宽度"),
    "Inspector must expose independent annotation width and grouped controls");
  const markerFigure={...golden!,seriesOverrides:{
    ...golden!.seriesOverrides,
    "lorentz-real":{...golden!.seriesOverrides["lorentz-real"],
      markerVisible:true,markerSymbol:"diamond" as const,markerMaxDisplayed:25,lineVisible:false}
  }};
  const markerMarkup=renderToStaticMarkup(createElement(LorentzFigure,{
    figure:markerFigure,dataset:ds,width:Number(ll.width),height:Number(ll.height),
    svgRef:createRef<SVGSVGElement>(),onSelectSeries:()=>{},
    onSelectAnnotation:()=>{},onMoveAnnotation:()=>{},onAxisClick:()=>{},onLegendClick:()=>{}
  }));
  assert.ok(markerMarkup.includes('data-marker-series-id="lorentz-real"'),
    "Editable marker settings must render in the SVG canvas");
  assert.ok(!markerMarkup.includes('data-series-id="lorentz-real"'),
    "lineVisible=false must hide only the line, not the markers");
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
  assert.equal(restored.figureOverrides.xTitle,golden!.figureOverrides.xTitle,
    ".sfig must preserve the original LaTeX source string");
  assert.equal(restored.lorentz.phaseYTitle,golden!.lorentz!.phaseYTitle);
}
console.log("Nature gallery smoke OK: 14 Nature figures + real editable Lorentz Graph, normal+QA");
