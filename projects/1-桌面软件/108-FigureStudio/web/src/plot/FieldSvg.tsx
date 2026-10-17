import type { RefObject } from "react";
import type { FigureSpec, ColorScaleId } from "../model";
import { SvgMathText } from "./SvgMathText";
import { GOLDEN_STYLE } from "./goldenStyle";

interface Props {
  figure: FigureSpec;
  layout: any;
  traces: any[];
  svgRef: RefObject<SVGSVGElement>;
  onAxisClick: () => void;
}

type Stop = readonly [number,string];
const SCALES: Record<ColorScaleId, readonly Stop[]> = {
  Viridis: [[0,"#440154"],[.25,"#3b528b"],[.5,"#21918c"],[.75,"#5ec962"],[1,"#fde725"]],
  Cividis: [[0,"#00204c"],[.25,"#414d6b"],[.5,"#7d7c78"],[.75,"#bcae6c"],[1,"#fee838"]],
  Magma: [[0,"#000004"],[.25,"#51127c"],[.5,"#b73779"],[.75,"#fc8961"],[1,"#fcfdbf"]],
  Inferno: [[0,"#000004"],[.25,"#57106e"],[.5,"#bc3754"],[.75,"#f98e09"],[1,"#fcffa4"]],
  RdBu: [[0,"#67001f"],[.25,"#d6604d"],[.5,"#f7f7f7"],[.75,"#4393c3"],[1,"#053061"]],
  Greys: [[0,"#ffffff"],[.25,"#d9d9d9"],[.5,"#969696"],[.75,"#525252"],[1,"#000000"]]
};

const fnum=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,v));
function rgb(hex:string):[number,number,number]{
  const n=Number.parseInt(hex.slice(1),16); return[(n>>16)&255,(n>>8)&255,n&255];
}
function mix(a:string,b:string,t:number){
  const A=rgb(a),B=rgb(b),k=clamp(t,0,1);
  return "#"+A.map((v,i)=>Math.round(v+(B[i]-v)*k).toString(16).padStart(2,"0")).join("");
}
function colorAt(scale:ColorScaleId,t:number,reverse:boolean){
  const x=reverse?1-clamp(t,0,1):clamp(t,0,1), stops=SCALES[scale];
  for(let i=1;i<stops.length;i++){
    if(x<=stops[i][0]){
      const [p0,c0]=stops[i-1],[p1,c1]=stops[i];
      return mix(c0,c1,(x-p0)/Math.max(1e-12,p1-p0));
    }
  }
  return stops[stops.length-1][1];
}
function minmax(vals:number[]):[number,number]{
  let lo=Infinity,hi=-Infinity;
  for(const v of vals){if(fnum(v)){lo=Math.min(lo,v);hi=Math.max(hi,v);}}
  if(!Number.isFinite(lo)||!Number.isFinite(hi))return[0,1];
  if(lo===hi)return[lo-.5,hi+.5];
  return[lo,hi];
}
function edges(values:number[]):number[]{
  if(values.length===0)return[0,1];
  if(values.length===1)return[values[0]-.5,values[0]+.5];
  const out=[values[0]-(values[1]-values[0])/2];
  for(let i=0;i<values.length-1;i++)out.push((values[i]+values[i+1])/2);
  out.push(values[values.length-1]+(values[values.length-1]-values[values.length-2])/2);
  return out;
}
function niceStep(span:number,target=5){
  const raw=Math.max(span,1e-12)/target,p=Math.pow(10,Math.floor(Math.log10(raw))),s=raw/p;
  return(s<=1?1:s<=2?2:s<=2.5?2.5:s<=5?5:10)*p;
}
function ticks(lo:number,hi:number,step?:number){
  const s=fnum(step)&&step!>0?step!:niceStep(hi-lo);
  const first=Math.ceil((lo-s*1e-9)/s)*s,out:number[]=[];
  for(let v=first;v<=hi+s*1e-9&&out.length<100;v+=s)out.push(Number(v.toPrecision(12)));
  return out;
}
function fmt(v:number){return v===0?"0":Math.abs(v)>=1e4||Math.abs(v)<1e-3?v.toExponential(1):String(Number(v.toPrecision(4)));}
function contourSegments(xs:number[],ys:number[],z:any[][],level:number){
  const result:Array<[[number,number],[number,number]]>=[];
  const edge=(a:[number,number,number],b:[number,number,number])=>{
    if(!fnum(a[2])||!fnum(b[2])||a[2]===b[2])return undefined;
    const da=a[2]-level,db=b[2]-level;if(da*db>0)return undefined;
    const t=(level-a[2])/(b[2]-a[2]);if(t<0||t>1)return undefined;
    return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t] as [number,number];
  };
  for(let j=0;j<ys.length-1;j++)for(let i=0;i<xs.length-1;i++){
    const p:[number,number,number][]=[
      [xs[i],ys[j],z[j]?.[i]],[xs[i+1],ys[j],z[j]?.[i+1]],
      [xs[i+1],ys[j+1],z[j+1]?.[i+1]],[xs[i],ys[j+1],z[j+1]?.[i]]
    ];
    if(!p.every(q=>fnum(q[2])))continue;
    const hits=[edge(p[0],p[1]),edge(p[1],p[2]),edge(p[2],p[3]),edge(p[3],p[0])]
      .filter((q):q is [number,number]=>Boolean(q));
    if(hits.length===2)result.push([hits[0],hits[1]]);
    else if(hits.length===4){result.push([hits[0],hits[1]],[hits[2],hits[3]]);}
  }
  return result;
}

export function FieldSvg({figure,layout,traces,svgRef,onAxisClick}:Props){
  const trace=traces[0]??{},width=Math.max(1,Number(layout.width)||640),height=Math.max(1,Number(layout.height)||480);
  const margin=layout.margin??{},left=margin.l??48,right=width-(margin.r??72),top=margin.t??28,bottom=height-(margin.b??46);
  const rawX=Array.isArray(trace.x)?trace.x:[],rawY=Array.isArray(trace.y)?trace.y:[],z:any[][]=Array.isArray(trace.z)?trace.z:[];
  const xNumeric=rawX.every((v:any)=>v==null||fnum(v));
  const xs=rawX.map((v:any,i:number)=>fnum(v)?v:i);
  const ys=rawY.map((v:any,i:number)=>fnum(v)?v:i);
  const xLabels=xNumeric?undefined:rawX.map(String);
  const [x0,x1]=layout.xaxis?.range?.length===2&&layout.xaxis.range.every(fnum)?layout.xaxis.range:minmax(xs);
  const [y0,y1]=layout.yaxis?.range?.length===2&&layout.yaxis.range.every(fnum)?layout.yaxis.range:minmax(ys);
  const xp=(v:number)=>left+(v-x0)/(x1-x0||1)*(right-left);
  const yp=(v:number)=>bottom-(v-y0)/(y1-y0||1)*(bottom-top);
  const finiteZ=z.flat().filter(fnum),[dataMin,dataMax]=minmax(finiteZ);
  const zmin=fnum(trace.zmin)?trace.zmin:dataMin,zmax=fnum(trace.zmax)?trace.zmax:dataMax;
  const scale=(figure.figureOverrides.colorScale??"Viridis") as ColorScaleId;
  const reverse=figure.figureOverrides.reverseColorScale??false;
  const xEdges=edges(xs),yEdges=edges(ys);
  const isContour=figure.templateId==="contour";
  const fillContour=figure.figureOverrides.contourFill!==false;
  const showLines=figure.figureOverrides.contourLines!==false||!fillContour;
  const levelCount=Math.max(3,Math.min(64,Math.round(figure.figureOverrides.contourLevels??12)));
  const levels=Array.from({length:levelCount},(_,i)=>zmin+(zmax-zmin)*i/Math.max(1,levelCount-1));
  const fontFamily=layout.font?.family??GOLDEN_STYLE.typography.serifFamily;
  const fontSize=layout.font?.size??11,tickSize=layout.xaxis?.tickfont?.size??fontSize*.92;
  const axisColor=layout.xaxis?.linecolor??GOLDEN_STYLE.stroke.axisColor;
  const gridColor=layout.xaxis?.gridcolor??GOLDEN_STYLE.stroke.gridRgba;
  const gradientId="field-gradient-"+figure.id.replace(/[^a-z0-9_-]/gi,"");
  const cellRects=z.flatMap((row,j)=>row.map((value:any,i:number)=>{
    if(!fnum(value)||i>=xs.length||j>=ys.length)return null;
    const xa=xp(xEdges[i]),xb=xp(xEdges[i+1]),ya=yp(yEdges[j]),yb=yp(yEdges[j+1]);
    return <rect key={"cell-"+j+"-"+i} x={Math.min(xa,xb)} y={Math.min(ya,yb)}
      width={Math.abs(xb-xa)+.4} height={Math.abs(yb-ya)+.4}
      fill={colorAt(scale,(value-zmin)/(zmax-zmin||1),reverse)} stroke="none"/>;
  }));
  const xTicks=xNumeric?ticks(Math.min(x0,x1),Math.max(x0,x1),layout.xaxis?.dtick):xs;
  const yTicks=ticks(Math.min(y0,y1),Math.max(y0,y1),layout.yaxis?.dtick);
  return <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width={width} height={height}
    viewBox={"0 0 "+width+" "+height} role="img" aria-label={figure.name+"，矢量场图"}
    data-vector-field="true" data-style-family={GOLDEN_STYLE.id}
    style={{display:"block",background:layout.paper_bgcolor??"#fff",shapeRendering:"geometricPrecision",textRendering:"geometricPrecision"}}>
    <defs>
      <clipPath id={gradientId+"-clip"}><rect x={left} y={top} width={right-left} height={bottom-top}/></clipPath>
      <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
        {SCALES[scale].map(([p,c])=><stop key={p} offset={(reverse?1-p:p)*100+"%"} stopColor={c}/>)}
      </linearGradient>
    </defs>
    <rect width={width} height={height} fill={layout.paper_bgcolor??"#fff"}/>
    {layout.title?.text&&<SvgMathText text={layout.title.text} x={width/2} y={Math.max(16,top-8)}
      fontFamily={layout.title.font?.family??fontFamily} fontSize={layout.title.font?.size??fontSize*1.15}
      fill={layout.title.font?.color??GOLDEN_STYLE.typography.textColor} textAnchor="middle" fontWeight={600}/>}
    <g clipPath={"url(#"+gradientId+"-clip)"}>
      {(figure.templateId==="heatmap"||fillContour)&&cellRects}
      {isContour&&showLines&&levels.map((level,li)=>{
        const segs=contourSegments(xs,ys,z,level);
        const lineColor=trace.line?.color??GOLDEN_STYLE.field.contourLineColor;
        return <g key={"level-"+li}>
          {segs.map((seg,si)=><path key={si}
            d={"M "+xp(seg[0][0])+" "+yp(seg[0][1])+" L "+xp(seg[1][0])+" "+yp(seg[1][1])}
            fill="none" stroke={lineColor} strokeWidth={trace.line?.width??.65}
            strokeLinecap="round"/>)}
          {figure.figureOverrides.contourLabels&&segs[0]&&
            <text x={(xp(segs[0][0][0])+xp(segs[0][1][0]))/2}
              y={(yp(segs[0][0][1])+yp(segs[0][1][1]))/2-2}
              fontFamily={fontFamily} fontSize={tickSize*.78} fill={GOLDEN_STYLE.typography.tickColor}
              textAnchor="middle">{fmt(level)}</text>}
        </g>;
      })}
    </g>
    {layout.xaxis?.showgrid&&xTicks.map((v:number,i:number)=><path key={"xg-"+i} d={"M "+xp(v)+" "+top+" V "+bottom} stroke={gridColor} strokeWidth={layout.xaxis?.gridwidth??.5}/>)}
    {layout.yaxis?.showgrid&&yTicks.map((v:number,i:number)=><path key={"yg-"+i} d={"M "+left+" "+yp(v)+" H "+right} stroke={gridColor} strokeWidth={layout.yaxis?.gridwidth??.5}/>)}
    <g onClick={onAxisClick}>
      <path d={"M "+left+" "+bottom+" H "+right+" M "+left+" "+top+" V "+bottom} fill="none" stroke={axisColor} strokeWidth={layout.xaxis?.linewidth??.9}/>
      {xTicks.map((v:number,i:number)=>{
        const x=xp(v),label=xLabels?.[i]??fmt(v); return <g key={"xt-"+i}>
          <path d={"M "+x+" "+bottom+" v "+(layout.xaxis?.ticklen??4)} stroke={layout.xaxis?.tickcolor??axisColor} strokeWidth={layout.xaxis?.tickwidth??.8}/>
          <text x={x} y={bottom+(layout.xaxis?.ticklen??4)+tickSize+3} textAnchor="middle"
            fontFamily={layout.xaxis?.tickfont?.family??fontFamily} fontSize={tickSize}
            fill={layout.xaxis?.tickfont?.color??GOLDEN_STYLE.typography.tickColor}>{label}</text>
        </g>;
      })}
      {yTicks.map((v,i)=><g key={"yt-"+i}>
        <path d={"M "+left+" "+yp(v)+" h "+(-(layout.yaxis?.ticklen??4))} stroke={layout.yaxis?.tickcolor??axisColor} strokeWidth={layout.yaxis?.tickwidth??.8}/>
        <text x={left-(layout.yaxis?.ticklen??4)-5} y={yp(v)+tickSize*.34} textAnchor="end"
          fontFamily={layout.yaxis?.tickfont?.family??fontFamily} fontSize={layout.yaxis?.tickfont?.size??tickSize}
          fill={layout.yaxis?.tickfont?.color??GOLDEN_STYLE.typography.tickColor}>{fmt(v)}</text>
      </g>)}
      {layout.xaxis?.title?.text&&<SvgMathText text={layout.xaxis.title.text} x={(left+right)/2} y={height-7}
        fontFamily={layout.xaxis.title.font?.family??fontFamily} fontSize={layout.xaxis.title.font?.size??fontSize}
        fill={layout.xaxis.title.font?.color??GOLDEN_STYLE.typography.axisTitleColor} textAnchor="middle"/>}
      {layout.yaxis?.title?.text&&<SvgMathText text={layout.yaxis.title.text} x={15} y={(top+bottom)/2} rotate={-90}
        fontFamily={layout.yaxis.title.font?.family??fontFamily} fontSize={layout.yaxis.title.font?.size??fontSize}
        fill={layout.yaxis.title.font?.color??GOLDEN_STYLE.typography.axisTitleColor} textAnchor="middle"/>}
    </g>
    {(figure.figureOverrides.colorbarVisible??true)&&(()=>{
      const cb=trace.colorbar??{},cw=cb.thickness??10,ch=(bottom-top)*(cb.len??.76);
      const cx=right+Math.max(12,(width-right-cw-8)*.34),cy=(top+bottom-ch)/2;
      return <g data-vector-colorbar="true">
        <rect x={cx} y={cy} width={cw} height={ch} fill={"url(#"+gradientId+")"} stroke={cb.outlinecolor??GOLDEN_STYLE.legend.borderColor} strokeWidth={cb.outlinewidth??.45}/>
        {Array.from({length:5},(_,i)=>zmin+(zmax-zmin)*i/4).map((v,i)=>{
          const y=cy+ch*(1-i/4);return <g key={i}>
            <path d={"M "+(cx+cw)+" "+y+" h 4"} stroke={GOLDEN_STYLE.stroke.tickStrokeColor} strokeWidth=".7"/>
            <text x={cx+cw+7} y={y+tickSize*.34} fontFamily={fontFamily} fontSize={tickSize*.9} fill={GOLDEN_STYLE.typography.tickColor}>{fmt(v)}</text>
          </g>;
        })}
        {figure.figureOverrides.colorbarTitle&&<SvgMathText text={figure.figureOverrides.colorbarTitle}
          x={Math.min(width-5,cx+cw+37)} y={cy+ch/2} rotate={-90}
          fontFamily={fontFamily} fontSize={layout.yaxis?.title?.font?.size??fontSize}
          fill={GOLDEN_STYLE.typography.axisTitleColor} textAnchor="middle"/>}
      </g>;
    })()}
  </svg>;
}
