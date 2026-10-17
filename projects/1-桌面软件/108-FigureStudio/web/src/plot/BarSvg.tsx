import type { RefObject } from "react";
import type { FigureSpec } from "../model";
import { SvgMathText } from "./SvgMathText";
import { GOLDEN_STYLE } from "./goldenStyle";

interface Props {
  figure: FigureSpec;
  layout: any;
  traces: any[];
  svgRef: RefObject<SVGSVGElement>;
  onAxisClick: () => void;
  onSelectSeries: (id:string,additive?:boolean)=>void;
}
const fnum=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,v));
const fmt=(v:number)=>v===0?"0":Math.abs(v)>=1e4||Math.abs(v)<1e-3?v.toExponential(1):String(Number(v.toPrecision(4)));
function niceStep(span:number){const r=Math.max(span,1e-12)/5,p=10**Math.floor(Math.log10(r)),s=r/p;return(s<=1?1:s<=2?2:s<=2.5?2.5:s<=5?5:10)*p;}
function ticks(lo:number,hi:number,step?:number){const s=fnum(step)&&step!>0?step!:niceStep(hi-lo),out:number[]=[];for(let v=Math.ceil((lo-s*1e-9)/s)*s;v<=hi+s*1e-9&&out.length<100;v+=s)out.push(Number(v.toPrecision(12)));return out;}
function colorAt(value:any,index:number,fallback:string){return Array.isArray(value)?value[index]??fallback:typeof value==="string"?value:fallback;}

export function BarSvg({figure,layout,traces,svgRef,onAxisClick,onSelectSeries}:Props){
  const width=Math.max(1,Number(layout.width)||640),height=Math.max(1,Number(layout.height)||480);
  const m=layout.margin??{},left=m.l??48,right=width-(m.r??28),top=m.t??28,bottom=height-(m.b??46);
  const categories=(traces[0]?.x??[]).map((v:any)=>String(v));
  const n=Math.max(1,categories.length),mode=layout.barmode==="stack"?"stack":"group";
  const visible=traces.filter(t=>t&&Array.isArray(t.y));
  let yLow=0,yHigh=1;
  if(layout.yaxis?.range?.length===2&&layout.yaxis.range.every(fnum)){[yLow,yHigh]=layout.yaxis.range;}
  else if(mode==="stack"){
    const pos=Array(n).fill(0),neg=Array(n).fill(0);
    visible.forEach(t=>t.y.forEach((v:any,i:number)=>{if(fnum(v)){if(v>=0)pos[i]+=v;else neg[i]+=v;}}));
    yLow=Math.min(0,...neg);yHigh=Math.max(1,...pos);
  }else{
    const vals=visible.flatMap(t=>t.y.filter(fnum));yLow=Math.min(0,...vals);yHigh=Math.max(1,...vals);
  }
  const pad=(yHigh-yLow)*.04;if(layout.yaxis?.range==null){yLow-=pad;yHigh+=pad;}
  const yp=(v:number)=>bottom-(v-yLow)/(yHigh-yLow||1)*(bottom-top);
  const groupW=(right-left)/n,gap=clamp(Number(layout.bargap??.22),0,.9),usable=groupW*(1-gap);
  const barCount=Math.max(1,visible.length),fontFamily=layout.font?.family??GOLDEN_STYLE.typography.serifFamily;
  const fontSize=layout.font?.size??11,tickSize=layout.yaxis?.tickfont?.size??fontSize*.92;
  const yTicks=ticks(Math.min(yLow,yHigh),Math.max(yLow,yHigh),layout.yaxis?.dtick);
  const axisColor=layout.yaxis?.linecolor??GOLDEN_STYLE.stroke.axisColor;
  const positive=Array(n).fill(0),negative=Array(n).fill(0);
  const legendItems=visible.filter(t=>t.showlegend!==false&&t.name);
  return <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width={width} height={height}
    viewBox={"0 0 "+width+" "+height} role="img" aria-label={figure.name+"，矢量柱图"}
    data-vector-bar="true" data-style-family={GOLDEN_STYLE.id}
    style={{display:"block",background:layout.paper_bgcolor??"#fff",shapeRendering:"geometricPrecision",textRendering:"geometricPrecision"}}>
    <rect width={width} height={height} fill={layout.paper_bgcolor??"#fff"}/>
    {layout.title?.text&&<SvgMathText text={layout.title.text} x={width/2} y={Math.max(16,top-8)}
      fontFamily={layout.title.font?.family??fontFamily} fontSize={layout.title.font?.size??fontSize*1.15}
      fill={layout.title.font?.color??GOLDEN_STYLE.typography.textColor} textAnchor="middle" fontWeight={600}/>}
    {layout.yaxis?.showgrid&&yTicks.map((v,i)=><path key={"g-"+i} d={"M "+left+" "+yp(v)+" H "+right} stroke={layout.yaxis.gridcolor??GOLDEN_STYLE.stroke.gridRgba} strokeWidth={layout.yaxis.gridwidth??.5}/>)}
    <g>
      {visible.flatMap((tr,si)=>{
        const sid=tr.meta?.figureStudioSeriesId,fillFallback=GOLDEN_STYLE.palette[si%GOLDEN_STYLE.palette.length],out:any[]=[];
        for(let i=0;i<n;i++){
          const value=tr.y?.[i];if(!fnum(value))continue;
          let x=left+i*groupW+(groupW-usable)/2,w=usable,base=0,topValue=value;
          if(mode==="group"){w=usable/barCount;x+=si*w;}
          else if(value>=0){base=positive[i];topValue=base+value;positive[i]=topValue;}
          else{base=negative[i];topValue=base+value;negative[i]=topValue;}
          const yA=yp(base),yB=yp(topValue),color=colorAt(tr.marker?.color,i,fillFallback);
          out.push(<g key={si+"-"+i} onClick={e=>{if(sid){e.stopPropagation();onSelectSeries(sid,e.ctrlKey||e.metaKey);}}} style={{cursor:sid?"pointer":"default"}}>
            <rect x={x+.25} y={Math.min(yA,yB)} width={Math.max(.5,w-.5)} height={Math.max(.3,Math.abs(yB-yA))}
              fill={color} fillOpacity={tr.opacity??1} stroke={tr.marker?.line?.color??GOLDEN_STYLE.bar.borderColor} strokeWidth={tr.marker?.line?.width??.45}/>
            {tr.texttemplate&&<text x={x+w/2} y={tr.textposition==="inside"?(yA+yB)/2:Math.min(yA,yB)-4}
              textAnchor="middle" dominantBaseline={tr.textposition==="inside"?"middle":"auto"}
              fontFamily={tr.textposition==="inside"?tr.insidetextfont?.family??fontFamily:tr.outsidetextfont?.family??fontFamily}
              fontSize={tr.textposition==="inside"?tr.insidetextfont?.size??tickSize*.9:tr.outsidetextfont?.size??tickSize*.9}
              fill={tr.textposition==="inside"?tr.insidetextfont?.color??"#fff":tr.outsidetextfont?.color??GOLDEN_STYLE.typography.tickColor}>
              {fnum(value)?value.toFixed(Math.max(0,figure.figureOverrides.barLabelDecimals??0)):String(value)}
            </text>}
          </g>);
        }
        return out;
      })}
    </g>
    <g onClick={onAxisClick}>
      <path d={"M "+left+" "+bottom+" H "+right+" M "+left+" "+top+" V "+bottom} fill="none" stroke={axisColor} strokeWidth={layout.yaxis?.linewidth??.9}/>
      {categories.map((label:string,i:number)=>{const x=left+(i+.5)*groupW;return <g key={label+i}>
        <path d={"M "+x+" "+bottom+" v "+(layout.xaxis?.ticklen??4)} stroke={layout.xaxis?.tickcolor??axisColor} strokeWidth={layout.xaxis?.tickwidth??.8}/>
        <text x={x} y={bottom+(layout.xaxis?.ticklen??4)+tickSize+3} textAnchor="middle"
          fontFamily={layout.xaxis?.tickfont?.family??fontFamily} fontSize={layout.xaxis?.tickfont?.size??tickSize}
          fill={layout.xaxis?.tickfont?.color??GOLDEN_STYLE.typography.tickColor}>{label}</text>
      </g>})}
      {yTicks.map((v,i)=><g key={i}>
        <path d={"M "+left+" "+yp(v)+" h "+(-(layout.yaxis?.ticklen??4))} stroke={layout.yaxis?.tickcolor??axisColor} strokeWidth={layout.yaxis?.tickwidth??.8}/>
        <text x={left-(layout.yaxis?.ticklen??4)-5} y={yp(v)+tickSize*.34} textAnchor="end" fontFamily={layout.yaxis?.tickfont?.family??fontFamily}
          fontSize={layout.yaxis?.tickfont?.size??tickSize} fill={layout.yaxis?.tickfont?.color??GOLDEN_STYLE.typography.tickColor}>{fmt(v)}</text>
      </g>)}
      {layout.xaxis?.title?.text&&<SvgMathText text={layout.xaxis.title.text} x={(left+right)/2} y={height-7}
        fontFamily={layout.xaxis.title.font?.family??fontFamily} fontSize={layout.xaxis.title.font?.size??fontSize}
        fill={layout.xaxis.title.font?.color??GOLDEN_STYLE.typography.axisTitleColor} textAnchor="middle"/>}
      {layout.yaxis?.title?.text&&<SvgMathText text={layout.yaxis.title.text} x={15} y={(top+bottom)/2} rotate={-90}
        fontFamily={layout.yaxis.title.font?.family??fontFamily} fontSize={layout.yaxis.title.font?.size??fontSize}
        fill={layout.yaxis.title.font?.color??GOLDEN_STYLE.typography.axisTitleColor} textAnchor="middle"/>}
    </g>
    {layout.showlegend&&legendItems.length>0&&(()=>{
      const fs=layout.legend?.font?.size??tickSize*.9,row=fs+5,lx=layout.legend?.xanchor==="right"?right-3:right+8,ly=top+5;
      return <g data-vector-legend="true">
        {legendItems.map((tr,i)=>{const c=colorAt(tr.marker?.color,0,GOLDEN_STYLE.palette[i%GOLDEN_STYLE.palette.length]);return <g key={i}>
          <rect x={lx} y={ly+i*row} width="12" height="7" fill={c} stroke={tr.marker?.line?.color??GOLDEN_STYLE.bar.borderColor} strokeWidth=".4"/>
          <SvgMathText text={tr.name} x={lx+17} y={ly+i*row+7} fontFamily={layout.legend?.font?.family??fontFamily}
            fontSize={fs} fill={layout.legend?.font?.color??GOLDEN_STYLE.typography.textColor} textAnchor="start"/>
        </g>})}
      </g>;
    })()}
  </svg>;
}
