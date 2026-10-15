import { useMemo, useRef, type RefObject } from "react";
import type { FigureSpec } from "../model";

/**
 * Experimental publication SVG renderer.
 * Consumes the SAME resolved layout/traces as Plotly, not a second parameter
 * schema. Every existing inspector value stays editable and round-trippable.
 * Unsupported plot families and rich MathJax remain on the legacy renderer.
 * Paths connect measured samples directly: no visually misleading smoothing.
 */
type DataTrace = {
  x?: unknown[];
  y?: unknown[];
  mode?: string;
  name?: string;
  showlegend?: boolean;
  yaxis?: string;
  meta?: { figureStudioSeriesId?: string };
  line?: { color?: string; width?: number; dash?: string };
  marker?: {
    color?: string; size?: number; symbol?: string; maxdisplayed?: number;
    line?: { color?: string; width?: number };
  };
  opacity?: number;
  error_y?: { array?: unknown[]; color?: string; thickness?: number; width?: number };
};
type Axis = {
  type?: string; range?: number[]; autorange?: boolean | string;
  dtick?: number; tickformat?: string; tickprefix?: string; ticksuffix?: string;
  tickangle?: number; tickfont?: { size?: number; family?: string; color?: string };
  title?: { text?: string; font?: { size?: number; family?: string; color?: string }; standoff?: number };
  linecolor?: string; linewidth?: number; tickcolor?: string;
  ticks?: string; ticklen?: number; tickwidth?: number;
  mirror?: boolean; showgrid?: boolean; gridcolor?: string; gridwidth?: number;
  minor?: { ticks?: string; dtick?: number; ticklen?: number; tickcolor?: string; tickwidth?: number };
};
type Layout = {
  width: number; height: number;
  xaxis?: Axis; yaxis?: Axis; yaxis2?: Axis;
  margin?: { l?: number; r?: number; t?: number; b?: number };
  font?: { family?: string; size?: number; color?: string };
  title?: { text?: string; font?: { family?: string; size?: number; color?: string }; pad?: {b?:number} };
  legend?: {
    x?: number; y?: number; xanchor?: string; yanchor?: string;
    orientation?: string; bgcolor?: string; bordercolor?: string; borderwidth?: number;
    font?: { size?: number; family?: string; color?: string };
    itemwidth?: number;
  };
  showlegend?: boolean; paper_bgcolor?: string;
};
export interface PrecisionSvgProps {
  figure: FigureSpec;
  layout: Layout;
  traces: DataTrace[];
  svgRef: RefObject<SVGSVGElement>;
  onSelectSeries: (id: string, additive?: boolean) => void;
  onAxisClick: () => void;
  onLegendClick: () => void;
  onLegendDrag: (x: number, y: number) => void;
}
const fnum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const finite = (v: unknown): number | undefined => fnum(v) ? v : undefined;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const coord = (v: number) => Number(v.toFixed(3));
const DASH: Record<string, string | undefined> = { solid: undefined, dash: "5 3", dot: "1 2.7", dashdot: "5 2 1 2" };
const rangeOf = (traces: DataTrace[], key: "x" | "y", axisId?: string) => {
  const values: number[] = [];
  for (const tr of traces) {
    if (key === "y" && (tr.yaxis === "y2" ? "y2" : "y") !== (axisId ?? "y")) continue;
    const arr = tr[key] ?? [];
    for (const value of arr) if (fnum(value)) values.push(value);
    if (key === "y" && tr.error_y?.array && tr.y) {
      tr.y.forEach((value, i) => {
        const err = tr.error_y?.array?.[i];
        if (fnum(value) && fnum(err)) values.push(value - Math.abs(err), value + Math.abs(err));
      });
    }
  }
  return values;
};
function resolveDomain(axis: Axis, values: number[]): [number, number] {
  const log = axis.type === "log";
  // Avoid Math.min(...100k) stack overflows on real instrument spectra.
  let low = Number.POSITIVE_INFINITY, high = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!fnum(value) || (log && value <= 0)) continue;
    if (value < low) low = value;
    if (value > high) high = value;
  }
  if (!Number.isFinite(low)) low = log ? 0.1 : 0;
  if (!Number.isFinite(high)) high = log ? 10 : 1;
  if (axis.range?.length === 2 && axis.range.every(fnum)) {
    const start = log ? Math.pow(10, axis.range[0]) : axis.range[0];
    const end = log ? Math.pow(10, axis.range[1]) : axis.range[1];
    if (Number.isFinite(start) && Number.isFinite(end) && start !== end) return [start, end];
  }
  if (low === high) {
    const delta = log ? Math.max(low * 0.2, 0.0001) : Math.max(Math.abs(low) * 0.05, 0.5);
    low -= delta; high += delta;
  } else if (log) {
    low /= 1.12; high *= 1.12;
  } else {
    const pad = (high - low) * 0.045;
    low -= pad; high += pad;
  }
  if (log) low = Math.max(low, Number.MIN_VALUE);
  return axis.autorange === "reversed" ? [high, low] : [low, high];
}
function projector(axis: Axis, domain: [number, number], from: number, to: number) {
  const conv = (v: number) => axis.type === "log" ? Math.log10(v) : v;
  const a = conv(domain[0]), b = conv(domain[1]);
  return (v: number) => {
    if (!fnum(v) || (axis.type === "log" && v <= 0)) return NaN;
    return from + (conv(v) - a) / (b - a || 1) * (to - from);
  };
}
function niceStep(span: number): number {
  const raw = Math.max(span, 1e-12) / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const scaled = raw / pow;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10) * pow;
}
function ticks(axis: Axis, domain: [number, number], minor = false): number[] {
  const low = Math.min(...domain), high = Math.max(...domain);
  if (axis.type === "log") {
    const output: number[] = [];
    const start = Math.floor(Math.log10(low)), stop = Math.ceil(Math.log10(high));
    for (let power = start; power <= stop && output.length < 200; power++) {
      const base = Math.pow(10, power);
      for (const m of (minor ? [2,3,4,5,6,7,8,9] : [1])) {
        const v = base * m;
        if (v >= low * (1 - 1e-10) && v <= high * (1 + 1e-10)) output.push(v);
      }
    }
    return output;
  }
  let step = minor ? axis.minor?.dtick : axis.dtick;
  if (!fnum(step) || step <= 0) {
    if (minor) step = (fnum(axis.dtick) && axis.dtick > 0 ? axis.dtick : niceStep(high-low)) / 5;
    else step = niceStep(high - low);
  }
  if ((high - low) / step > 140) step = (high - low) / 140;
  const start = Math.ceil((low - Math.abs(step) * 1e-8) / step);
  const end = Math.floor((high + Math.abs(step) * 1e-8) / step);
  const out: number[] = [];
  for (let n = start; n <= end && out.length < 150; n++) out.push(Number((n * step).toPrecision(13)));
  if (minor) {
    const major = ticks(axis, domain);
    return out.filter(x => !major.some(m => Math.abs(m - x) < Math.abs(step) * 0.015));
  }
  return out;
}
function formatTick(v: number, axis: Axis) {
  let label = "";
  const fm = axis.tickformat ?? "";
  const precision = Number(fm.match(/\.(\d+)/)?.[1] ?? 0);
  if (fm.endsWith("f")) label = v.toFixed(precision);
  else if (fm.endsWith("e")) label = v.toExponential(precision);
  else if (fm.endsWith("s")) label = v.toPrecision(Math.max(1, precision));
  else if (v === 0) label = "0";
  else if (Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3) label = v.toExponential(1).replace("e+", "e");
  else label = String(Number(v.toPrecision(5)));
  return (axis.tickprefix ?? "") + label + (axis.ticksuffix ?? "");
}
function markerShape(symbol: string | undefined, x: number, y: number, size: number) {
  const r = size / 2;
  switch (symbol) {
    case "square": return <rect x={x-r} y={y-r} width={size} height={size}/>;
    case "diamond": return <path d={"M "+x+" "+(y-r*1.3)+" L "+(x+r*1.3)+" "+y+" L "+x+" "+(y+r*1.3)+" L "+(x-r*1.3)+" "+y+" Z"}/>;
    case "triangle-up": return <path d={"M "+x+" "+(y-r*1.35)+" L "+(x+r*1.25)+" "+(y+r)+" L "+(x-r*1.25)+" "+(y+r)+" Z"}/>;
    case "triangle-down": return <path d={"M "+x+" "+(y+r*1.35)+" L "+(x+r*1.25)+" "+(y-r)+" L "+(x-r*1.25)+" "+(y-r)+" Z"}/>;
    case "cross": return <path d={"M "+(x-r)+" "+y+" H "+(x+r)+" M "+x+" "+(y-r)+" V "+(y+r)}/>;
    case "x": return <path d={"M "+(x-r)+" "+(y-r)+" L "+(x+r)+" "+(y+r)+" M "+(x+r)+" "+(y-r)+" L "+(x-r)+" "+(y+r)}/>;
    default: return <circle cx={x} cy={y} r={r}/>;
  }
}
/** Detect unsupported rich math before selecting this renderer. MathJax is never silently flattened. */
export function supportsPrecisionSvg(figure: FigureSpec): boolean {
  if (["heatmap", "contour", "surface-3d", "bar", "grouped-bar", "stacked-bar"].includes(figure.templateId)) return false;
  const o = figure.figureOverrides;
  const texts = [o.plotTitle, o.xTitle, o.yTitle, o.rightYTitle,
    ...Object.values(figure.seriesOverrides).map(x => x.legendLabel)];
  return !texts.some(t => t && (/[$\\]/.test(t) || /<\/?(?:sup|sub)>/i.test(t)));
}
export function PrecisionSvg({figure,layout,traces,svgRef,onSelectSeries,onAxisClick,onLegendClick,onLegendDrag}: PrecisionSvgProps) {
  const drag = useRef<{ clientX:number;clientY:number;initialX:number;initialY:number } | null>(null);
  const width = Math.max(1, Number(layout.width) || 640), height = Math.max(1, Number(layout.height) || 480);
  const plot = useMemo(() => {
    const margin = layout.margin || {};
    // Respect every user-entered margin value. Earlier hard-coded minima
    // silently ignored valid physical mm controls on the SVG renderer.
    const left = margin.l ?? 40, right = width - (margin.r ?? 20);
    const top = margin.t ?? 25, bottom = height - (margin.b ?? 30);
    return { left, right: Math.max(left + 1, right),
      top, bottom: Math.max(top + 1, bottom) };
  }, [layout, width, height]);
  const xAxis = layout.xaxis ?? {}, yAxis = layout.yaxis ?? {}, rightAxis = layout.yaxis2;
  const xDomain = resolveDomain(xAxis, rangeOf(traces,"x"));
  const yDomain = resolveDomain(yAxis, rangeOf(traces,"y","y"));
  const rDomain = rightAxis ? resolveDomain(rightAxis, rangeOf(traces,"y","y2")) : yDomain;
  const xp = projector(xAxis,xDomain,plot.left,plot.right);
  const yp = projector(yAxis,yDomain,plot.bottom,plot.top);
  const rp = projector(rightAxis ?? yAxis,rDomain,plot.bottom,plot.top);
  const uid = "fs-svg-" + figure.id.replace(/[^a-z0-9_-]/gi,"");
  const baseFont = layout.font?.family ?? "Arial, sans-serif";
  const baseColor = layout.font?.color ?? "#202328";
  const textSize = layout.font?.size ?? 11;
  const bg = layout.paper_bgcolor ?? "#fff";
  const textOf = (v?: string) => v ?? "";
  const axisNodes = (axis: Axis, side: "x"|"y"|"y2", dom: [number,number], fn: (v:number)=>number) => {
    const isX = side === "x";
    const opposite = side === "y2";
    const major = ticks(axis,dom), minor = axis.minor?.ticks ? ticks(axis,dom,true) : [];
    const base = isX ? plot.bottom : opposite ? plot.right : plot.left;
    const tickLen = axis.ticklen ?? 4.5;
    const dir = axis.ticks === "outside" ? 1 : -1;
    const tickSign = isX ? dir : opposite ? dir : -dir;
    const labelShift = tickLen * (axis.ticks === "outside" ? 1 : 0) + 5;
    const font = axis.tickfont ?? {};
    const c = font.color ?? baseColor;
    const majorNodes = major.map((v,i) => {
      const pos = fn(v);
      if (!fnum(pos) || (isX ? pos < plot.left-0.1 || pos > plot.right+0.1 : pos < plot.top-0.1 || pos > plot.bottom+0.1)) return null;
      const labelX = isX ? pos : base+(opposite?labelShift:-labelShift);
      const labelY = isX ? base+labelShift+(font.size??10)*0.85 : pos+(font.size??10)*0.34;
      return <g key={"mj-"+side+"-"+i}>
        {axis.showgrid && !opposite && <line x1={isX?pos:plot.left} x2={isX?pos:plot.right} y1={isX?plot.top:pos} y2={isX?plot.bottom:pos} stroke={axis.gridcolor??"#e3e7ec"} strokeWidth={axis.gridwidth??0.5}/>}
        <path d={isX?"M "+coord(pos)+" "+base+" v "+coord(tickSign*tickLen):"M "+base+" "+coord(pos)+" h "+coord(tickSign*tickLen)} fill="none" stroke={axis.tickcolor??baseColor} strokeWidth={axis.tickwidth??0.85}/>
        <text x={labelX} y={labelY} fill={c} fontSize={font.size??textSize} fontFamily={font.family??baseFont} textAnchor={isX?"middle":opposite?"start":"end"}
           transform={axis.tickangle?"rotate("+axis.tickangle+" "+labelX+" "+labelY+")":undefined}>{formatTick(v,axis)}</text>
      </g>;
    });
    const minorNodes = minor.map((v,i) => {
      const pos=fn(v);if (!fnum(pos)) return null;
      if (isX ? pos<plot.left||pos>plot.right : pos<plot.top||pos>plot.bottom) return null;
      const len=axis.minor?.ticklen??2.4;
      return <path key={"mn-"+side+"-"+i} d={isX?"M "+coord(pos)+" "+base+" v "+coord(tickSign*len):"M "+base+" "+coord(pos)+" h "+coord(tickSign*len)} stroke={axis.minor?.tickcolor??axis.tickcolor??baseColor} strokeWidth={axis.minor?.tickwidth??0.6}/>;
    });
    const pad = axis.title?.standoff ?? 5;
    const labelHeight = axis.tickfont?.size ?? textSize;
    const titleHeight = axis.title?.font?.size ?? textSize*1.08;
    const tx = isX ? (plot.left+plot.right)/2
      : opposite ? Math.min(width-8, plot.right+labelHeight+pad+titleHeight)
      : Math.max(8, plot.left-labelHeight-pad-titleHeight);
    // Tick labels and the X title need separate line boxes. The old 1-line
    // estimate made "Wavelength (nm)" visibly collide with tick numbers.
    const ty = isX
      ? Math.min(height-3, plot.bottom+labelShift+labelHeight*1.65+pad+titleHeight)
      : (plot.top+plot.bottom)/2;
    const title = axis.title?.text;
    return <g key={"axis-"+side} onClick={onAxisClick}>
      {majorNodes}{minorNodes}
      <path d={isX?"M "+plot.left+" "+base+" H "+plot.right:"M "+base+" "+plot.top+" V "+plot.bottom} stroke={axis.linecolor??"#252c34"} strokeWidth={axis.linewidth??0.9} fill="none"/>
      {title && <text x={tx} y={ty} transform={!isX?"rotate("+(opposite?90:-90)+" "+tx+" "+ty+")":undefined} fill={axis.title?.font?.color??baseColor} fontFamily={axis.title?.font?.family??baseFont} fontSize={axis.title?.font?.size??textSize*1.08} textAnchor="middle">{textOf(title)}</text>}
    </g>;
  };
  const legendItems = traces.filter(t=>t.showlegend!==false && t.name);
  const legend = layout.legend ?? {};
  const lfont = legend.font?.size ?? textSize*0.93;
  const lh = lfont + 7;
  const cols = legend.orientation==="h" ? Math.max(1,Math.min(legendItems.length, figure.figureOverrides.legendColumns ?? legendItems.length)) : 1;
  const itemWidth = Math.max(legend.itemwidth ?? 30, 40, ...legendItems.map(t=>(t.name?.length??0)*lfont*0.56+35));
  const lw = cols * itemWidth;
  const lhTotal = lh * Math.ceil(legendItems.length/cols);
  const lx = plot.left+(legend.x??0.98)*(plot.right-plot.left);
  const ly = plot.bottom-(legend.y??0.985)*(plot.bottom-plot.top);
  const lX = lx-(legend.xanchor==="right"?lw:legend.xanchor==="center"?lw/2:0);
  const lY = ly-(legend.yanchor==="bottom"?lhTotal:legend.yanchor==="middle"?lhTotal/2:0);
  const doMarkers = (tr:DataTrace)=> (tr.mode??"").includes("markers");
  const doLines = (tr:DataTrace)=> (tr.mode??"").includes("lines");
  return <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width={width} height={height}
    viewBox={"0 0 "+width+" "+height} style={{display:"block",background:bg,shapeRendering:"geometricPrecision",textRendering:"geometricPrecision"}}
    role="img" aria-label={figure.name+"，精细 SVG 绘图"}>
    <defs><clipPath id={uid}><rect x={plot.left} y={plot.top} width={Math.max(1,plot.right-plot.left)} height={Math.max(1,plot.bottom-plot.top)}/></clipPath></defs>
    <rect width={width} height={height} fill={bg}/>
    {layout.title?.text && <text x={width/2} y={Math.max(15,plot.top-7-(layout.title.pad?.b??0))} fill={layout.title.font?.color??baseColor}
      fontFamily={layout.title.font?.family??baseFont} fontSize={layout.title.font?.size??textSize*1.15} textAnchor="middle">{layout.title.text}</text>}
    {axisNodes(xAxis,"x",xDomain,xp)}
    {axisNodes(yAxis,"y",yDomain,yp)}
    {rightAxis && axisNodes(rightAxis,"y2",rDomain,rp)}
    {figure.figureOverrides.frameStyle==="boxed" && xAxis.mirror && <path d={"M "+plot.left+" "+plot.top+" H "+plot.right} stroke={xAxis.linecolor??"#252c34"} strokeWidth={xAxis.linewidth??0.8}/>}
    {figure.figureOverrides.frameStyle==="boxed" && yAxis.mirror && !rightAxis && <path d={"M "+plot.right+" "+plot.top+" V "+plot.bottom} stroke={yAxis.linecolor??"#252c34"} strokeWidth={yAxis.linewidth??0.8}/>} 
    <g clipPath={"url(#"+uid+")"}>
      {traces.map((tr,index)=>{
        const sid = tr.meta?.figureStudioSeriesId;
        const projectY = tr.yaxis==="y2" ? rp : yp;
        const pairs = (tr.x??[]).map((v,i)=>{
          const y = tr.y?.[i];
          if (!fnum(v)||!fnum(y)) return null;
          const xx = xp(v), yy = projectY(y);
          return fnum(xx)&&fnum(yy)?{x:xx,y:yy,i}:null;
        });
        let path="";
        let started=false;
        pairs.forEach(p=>{if(!p){started=false;return;}path+=(started?"L":"M")+coord(p.x)+" "+coord(p.y)+" ";started=true;});
        const color = tr.line?.color??"#26749b", widthLine = tr.line?.width??1.3;
        const maxMarkers = tr.marker?.maxdisplayed??0;
        const stride = maxMarkers>0?Math.max(1,Math.ceil(pairs.length/maxMarkers)):1;
        return <g key={"trace-"+index} opacity={tr.opacity??1}
          onClick={e=>{if(sid){e.stopPropagation();onSelectSeries(sid,e.ctrlKey||e.metaKey);}}}
          style={{cursor:sid?"pointer":"default"}}>
          {doLines(tr) && <path d={path} fill="none" stroke={color} strokeWidth={widthLine}
             strokeDasharray={DASH[tr.line?.dash??"solid"]} strokeLinecap="round" strokeLinejoin="round"/>}
          {tr.error_y?.array?.map((v,i)=>{
            const p=pairs[i],dy=tr.y?.[i]; if(!p||!fnum(v)||!fnum(dy))return null;
            const hi=projectY(dy+Math.abs(v)),lo=projectY(dy-Math.abs(v));if(!fnum(hi)||!fnum(lo))return null;
            const cap=tr.error_y?.width??0;
            return <path key={"err-"+i} d={"M "+p.x+" "+coord(hi)+" V "+coord(lo)+" M "+coord(p.x-cap)+" "+coord(hi)+" H "+coord(p.x+cap)+" M "+coord(p.x-cap)+" "+coord(lo)+" H "+coord(p.x+cap)} fill="none" stroke={tr.error_y?.color??color} strokeWidth={tr.error_y?.thickness??1} strokeLinecap="square"/>;
          })}
          {doMarkers(tr) && pairs.filter((p,i)=>p && i%stride===0).map((p,i)=>p &&
            <g key={"mk-"+i} fill={["cross","x"].includes(tr.marker?.symbol??"")?"none":tr.marker?.color??color}
              stroke={tr.marker?.line?.color??color} strokeWidth={tr.marker?.line?.width??0.5}>
              {markerShape(tr.marker?.symbol,p.x,p.y,tr.marker?.size??5)}
            </g>)}
        </g>;
      })}
    </g>
    {layout.showlegend && legendItems.length>0 && <g onClick={onLegendClick} style={{cursor:"grab",touchAction:"none"}}
      onPointerDown={event => {
        if (event.button !== 0 || !svgRef.current) return;
        onLegendClick();
        drag.current={clientX:event.clientX,clientY:event.clientY,initialX:legend.x??0.98,initialY:legend.y??0.985};
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={event => {
        if (!drag.current || !svgRef.current) return;
        const bounds=svgRef.current.getBoundingClientRect();
        if (bounds.width<=0 || bounds.height<=0) return;
        const dx=(event.clientX-drag.current.clientX)*width/bounds.width;
        const dy=(event.clientY-drag.current.clientY)*height/bounds.height;
        event.currentTarget.setAttribute("transform","translate("+dx+","+dy+")");
      }}
      onPointerUp={event => {
        const current=drag.current;
        if (!current || !svgRef.current) return;
        drag.current=null;
        const bounds=svgRef.current.getBoundingClientRect();
        if (bounds.width>0 && bounds.height>0) {
          const dx=(event.clientX-current.clientX)*width/bounds.width;
          const dy=(event.clientY-current.clientY)*height/bounds.height;
          onLegendDrag(
            clamp(current.initialX+dx/(plot.right-plot.left),-1,2),
            clamp(current.initialY-dy/(plot.bottom-plot.top),-1,2)
          );
        }
        event.currentTarget.removeAttribute("transform");
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={event => {
        drag.current=null;
        event.currentTarget.removeAttribute("transform");
      }}>
      {Number(legend.borderwidth??0)>0 && <rect x={lX-6} y={lY-4} width={lw+12} height={lhTotal+8}
        fill={legend.bgcolor??"#fff"} stroke={legend.bordercolor??"#cdd2d7"} strokeWidth={legend.borderwidth}/>}
      {legendItems.map((tr,i)=>{
        const tx=lX+(i%cols)*itemWidth;
        const ty=lY+Math.floor(i/cols)*lh;
        return <g key={"legend-"+i}>
          <path d={"M "+tx+" "+(ty+lh/2)+" h 18"} stroke={tr.line?.color??"#26749b"} strokeWidth={tr.line?.width??1.3}
             strokeLinecap="round" strokeDasharray={DASH[tr.line?.dash??"solid"]}/>
          {doMarkers(tr) && <g transform={"translate("+(tx+9)+","+(ty+lh/2)+")"} fill={tr.marker?.color??tr.line?.color??"#26749b"}
             stroke={tr.marker?.line?.color??tr.line?.color??"#26749b"} strokeWidth={tr.marker?.line?.width??0.5}>
             {markerShape(tr.marker?.symbol,0,0,Math.min(tr.marker?.size??5,8))}
          </g>}
          <text x={tx+24} y={ty+lh/2+lfont*0.34} fill={legend.font?.color??baseColor} fontFamily={legend.font?.family??baseFont} fontSize={lfont}>{tr.name}</text>
        </g>;
      })}
    </g>}
  </svg>;
}
