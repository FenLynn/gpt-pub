import { useRef, type RefObject } from "react";
import type { Dataset, FigureSpec, LorentzAnnotation } from "../model";
import { defaultLorentzComposition } from "../data/lorentz";

interface Props {
  figure:FigureSpec;
  dataset:Dataset;
  width:number;
  height:number;
  svgRef:RefObject<SVGSVGElement>;
  onSelectSeries:(id:string)=>void;
  onSelectAnnotation:(id:string)=>void;
  onMoveAnnotation:(id:string,x:number,y:number)=>void;
  onAxisClick:()=>void;
  onLegendClick:()=>void;
}
const W=1200,H=1010;
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));
const numberTicks=(lo:number,hi:number,step:number)=>{if(!finite(step)||step<=0||hi<=lo)return [];const start=Math.ceil((lo-1e-9)/step)*step;const count=Math.min(150,Math.max(0,Math.floor((hi-start+step*1e-6)/step)+1));return Array.from({length:count},(_,i)=>Number((start+i*step).toFixed(8)));};
function fmt(n:number){return Number(n.toFixed(4)).toString();}
export function LorentzFigure({figure,dataset,width,height,svgRef,onSelectSeries,onSelectAnnotation,onMoveAnnotation,onAxisClick,onLegendClick}:Props){
  const drag=useRef<{id:string;clientX:number;clientY:number;x:number;y:number}|null>(null);
  const c=figure.lorentz??defaultLorentzComposition,o=figure.figureOverrides;
  const LEFT=clamp(c.plotLeft??104,60,500),RIGHT=clamp(c.plotRight??1160,LEFT+320,W-18);
  const TOP=clamp(c.plotTop??65,48,210),BOTTOM=clamp(c.plotBottom??932,TOP+420,H-68);
  const gap=clamp(c.panelGap,16,150),panelHeight=(BOTTOM-TOP-gap)/2,bottomTop=TOP+panelHeight+gap;
  const xMin=o.xAutoRange===false&&finite(o.xMin)?o.xMin:.4;
  const xMax=o.xAutoRange===false&&finite(o.xMax)?o.xMax:1.6;
  const x=(v:number)=>LEFT+(o.xReverse?1-(v-xMin)/(xMax-xMin||1):(v-xMin)/(xMax-xMin||1))*(RIGHT-LEFT);
  const topMin=finite(o.yMin)&&o.yAutoRange===false?o.yMin:c.topMin;
  const topMax=finite(o.yMax)&&o.yAutoRange===false?o.yMax:c.topMax;
  const topY=(v:number)=>TOP+(o.yReverse?(v-topMin):(topMax-v))/(topMax-topMin||1)*panelHeight;
  const bottomY=(v:number)=>bottomTop+(c.phaseMax-v)/(c.phaseMax-c.phaseMin||1)*panelHeight;
  // 1 pt = 96/72 CSS px; the fixed SVG viewBox must preserve real publication typography.
  const ptScale=(96/72)*W/Math.max(1,width);
  const baseSize=(o.tickLabelSizePt??9.5)*ptScale;
  const axisColor=o.axisTitleColor??"#34383d";
  const font=o.fontFamily==="Arial"?"Arial,sans-serif":'"Times New Roman",Georgia,serif';
  const titleFont=(o.plotTitleSizePt??12)*ptScale;
  const axisFont=(o.axisTitleSizePt??11)*ptScale;
  const axisWidth=(o.axisLineWidthPt??.7)*ptScale;
  const majorLen=(o.majorTickLengthPt??4.5)*ptScale;
  const minorLen=(o.minorTickLengthPt??2.3)*ptScale;
  const majorX=numberTicks(xMin,xMax,o.xMajorTickStep??.2);
  const minorX=o.minorTicks?numberTicks(xMin,xMax,o.xMinorTickStep??.05):[];
  const majorTop=numberTicks(topMin,topMax,o.yMajorTickStep??2);
  const majorBottom=numberTicks(c.phaseMin,c.phaseMax,c.phaseMajorTickStep||45);
  const minorTop=o.minorTicks?numberTicks(topMin,topMax,o.yMinorTickStep??.5):[];
  const minorBottom=o.minorTicks?numberTicks(c.phaseMin,c.phaseMax,c.phaseMinorTickStep||15):[];
  const bg=o.background??"#fff";
  const axisTick=(v:number,axis:"x"|"y")=>{
    const decimals=axis==="x"?o.xTickDecimals:o.yTickDecimals;
    const prefix=axis==="x"?o.xTickPrefix:o.yTickPrefix;
    const suffix=axis==="x"?o.xTickSuffix:o.yTickSuffix;
    return (prefix??"")+(decimals===undefined?fmt(v):v.toFixed(clamp(decimals,0,8)))+(suffix??"");
  };
  const [realId,imagId,phaseId]=figure.dataRef?.yColumnIds??["lorentz-real","lorentz-imag","lorentz-phase"];
  const series=(id:string)=>dataset.ys.find(q=>q.id===id);
  const palette:Record<string,string>={"lorentz-real":"#305b76","lorentz-imag":"#a44b3d","lorentz-phase":"#674080"};
  const color=(id:string)=>figure.seriesOverrides[id]?.color??palette[id]??"#333";
  const lineWidth=(id:string)=>(figure.seriesOverrides[id]?.lineWidthPt??1.35)*ptScale;
  const points=(id:string,y:(v:number)=>number)=>{
    const data=series(id)?.values??[];
    let path="",started=false;
    for(let i=0;i<Math.min(dataset.x.values.length,data.length);i++){
      const xx=dataset.x.values[i],yy=data[i];
      if(!finite(xx)||!finite(yy)||xx<xMin||xx>xMax){started=false;continue;}
      path+=(started?"L":"M")+x(xx).toFixed(3)+" "+y(yy).toFixed(3)+" ";
      started=true;
    }
    return path.trim();
  };
  const axis=(top:number,ys:number[],minorYs:number[],projectY:(v:number)=>number,labels:boolean)=><g fontFamily={font} fontSize={baseSize} fill={o.tickLabelColor??"#262626"} onClick={onAxisClick} style={{cursor:"pointer"}}>
    {o.gridVisible&&<g stroke="#777" strokeWidth=".8" opacity={clamp(c.gridOpacity,0,1)}>
      {majorX.map(v=><line key={"gx"+v} x1={x(v)} x2={x(v)} y1={top} y2={top+panelHeight}/>)}
      {ys.map(v=><line key={"gy"+v} x1={LEFT} x2={RIGHT} y1={projectY(v)} y2={projectY(v)}/>)}
    </g>}
    {o.frameStyle==="open" ? <path d={"M"+LEFT+" "+top+"V"+(top+panelHeight)+"H"+RIGHT} fill="none" stroke="#39434b" strokeWidth={axisWidth}/> : <rect x={LEFT} y={top} width={RIGHT-LEFT} height={panelHeight} fill="none" stroke="#39434b" strokeWidth={axisWidth}/>}
    {majorX.map(v=><g key={"x"+v}><path d={"M"+x(v)+" "+top+"v"+(o.tickDirection==="outside"?-majorLen:majorLen)+" M"+x(v)+" "+(top+panelHeight)+"v"+(o.tickDirection==="outside"?majorLen:-majorLen)} fill="none" stroke="#4d5359" strokeWidth={axisWidth*.8}/>{labels&&<text x={x(v)} y={top+panelHeight+25} textAnchor="middle">{axisTick(v,"x")}</text>}</g>)}
    {minorX.map(v=><path key={"mx"+v} d={"M"+x(v)+" "+top+"v"+(o.tickDirection==="outside"?-minorLen:minorLen)+" M"+x(v)+" "+(top+panelHeight)+"v"+(o.tickDirection==="outside"?minorLen:-minorLen)} stroke="#4d5359" strokeWidth={axisWidth*.65}/>)} 
    {minorYs.map(v=><path key={"my"+v} d={"M"+LEFT+" "+projectY(v)+"h"+(o.tickDirection==="outside"?-minorLen:minorLen)+" M"+RIGHT+" "+projectY(v)+"h"+(o.tickDirection==="outside"?minorLen:-minorLen)} stroke="#4d5359" strokeWidth={axisWidth*.65}/>)} 
    {ys.map(v=><g key={"y"+v}><path d={"M"+LEFT+" "+projectY(v)+"h"+(o.tickDirection==="outside"?-majorLen:majorLen)+" M"+RIGHT+" "+projectY(v)+"h"+(o.tickDirection==="outside"?majorLen:-majorLen)} stroke="#4d5359" strokeWidth={axisWidth*.8}/><text x={LEFT-13} y={projectY(v)+baseSize*.35} textAnchor="end">{labels?fmt(v)+"°":axisTick(v,"y")}</text></g>)}
  </g>;
  const curve=(id:string,y:(v:number)=>number)=>{
    const override=figure.seriesOverrides[id];
    if(override?.visible===false)return null;
    const dash=override?.lineStyle==="dash"?"9 5":override?.lineStyle==="dot"?"2 4":override?.lineStyle==="dashdot"?"10 4 2 4":undefined;
    const markerSize=clamp((override?.markerSizePt??4)*ptScale,1.5,60);
    const data=series(id)?.values??[];
    const step=Math.max(1,Math.ceil(data.length/clamp(override?.markerMaxDisplayed??80,1,1601)));
    const markers=override?.markerVisible?data.flatMap((v,i)=>{
      const xx=dataset.x.values[i];
      if(i%step!==0||!finite(v)||!finite(xx)||xx<xMin||xx>xMax)return [];
      const px=x(xx),py=y(v),rr=markerSize/2;
      const stroke=override?.markerEdgeColor??color(id);
      const fill=override?.markerHollow?"#fff":(override?.markerFillColor??color(id));
      const edge=(override?.markerEdgeWidthPt??.5)*ptScale;
      const props={fill,stroke,strokeWidth:edge,opacity:override?.opacity??1};
      const symbol=override?.markerSymbol??"circle";
      const d=symbol==="diamond"
        ?"M"+px+" "+(py-rr)+"L"+(px+rr)+" "+py+"L"+px+" "+(py+rr)+"L"+(px-rr)+" "+py+"Z"
        :symbol==="triangle-up"
        ?"M"+px+" "+(py-rr)+"L"+(px+rr)+" "+(py+rr)+"L"+(px-rr)+" "+(py+rr)+"Z"
        :symbol==="triangle-down"
        ?"M"+px+" "+(py+rr)+"L"+(px+rr)+" "+(py-rr)+"L"+(px-rr)+" "+(py-rr)+"Z"
        :symbol==="cross"||symbol==="x"
        ?"M"+(px-rr)+" "+py+"H"+(px+rr)+"M"+px+" "+(py-rr)+"V"+(py+rr)
        :"M"+(px-rr)+" "+(py-rr)+"h"+(2*rr)+"v"+(2*rr)+"h-"+(2*rr)+"Z";
      return [<g key={i} onClick={e=>{e.stopPropagation();onSelectSeries(id)}} style={{cursor:"pointer"}}>
        {symbol==="circle"?<circle cx={px} cy={py} r={rr} {...props}/>:<path d={d} {...props} fill={symbol==="cross"||symbol==="x"?"none":fill} transform={symbol==="x"?"rotate(45 "+px+" "+py+")":undefined}/>}
      </g>];
    }):null;
    return <g>
      {override?.lineVisible!==false&&<path data-series-id={id} d={points(id,y)} fill="none" stroke={color(id)} strokeWidth={lineWidth(id)}
        strokeDasharray={dash} strokeLinejoin="round" strokeLinecap="round" opacity={override?.opacity??1}
        onClick={e=>{e.stopPropagation();onSelectSeries(id)}} style={{cursor:"pointer"}}/>}
      {markers&&<g data-marker-series-id={id}>{markers}</g>}
    </g>;
  };
  const legend=(xx:number,yy:number,ids:string[],bottom=false)=>{
    const entries=ids.filter(id=>(id!=="__band__"||c.bandOpacity>0)&&(id==="__band__"||figure.seriesOverrides[id]?.visible!==false&&figure.seriesOverrides[id]?.showInLegend!==false));
    if(o.legendVisible===false||!entries.length)return null;
    const f=(o.legendFontSizePt??9)*ptScale,row=clamp(c.legendRowHeight??25,18,52);
    const legendWidth=clamp(bottom?(c.bottomLegendWidth??270):(c.topLegendWidth??298),145,500);
    const boxX=xx-12,boxY=yy-f-7,boxH=entries.length*row+15;
    const id=bottom?"lorentz-legend-bottom-clip":"lorentz-legend-top-clip";
    const fullLabel=(entry:string)=>entry==="__band__"?(c.bandLegendLabel??"Resonant band"):(figure.seriesOverrides[entry]?.legendLabel??series(entry)?.name??entry);
    return <g data-legend-panel={bottom?"bottom":"top"} data-box-x={boxX} data-box-y={boxY} data-box-width={legendWidth} data-box-height={boxH}
      onClick={onLegendClick} style={{cursor:"pointer"}} fontFamily={font} fontSize={f}>
      <defs><clipPath id={id}><rect x={xx+44} y={boxY} width={Math.max(0,legendWidth-67)} height={boxH}/></clipPath></defs>
      {o.legendFrame!==false&&<rect x={boxX} y={boxY} width={legendWidth} height={boxH}
        rx="1.5" fill={o.legendBackground??"#fff"} fillOpacity={o.legendBackgroundOpacity??.95}
        stroke={o.legendBorderColor??"#d4d9dd"} strokeWidth={(o.legendBorderWidthPt??.45)*ptScale}/>}
      {entries.map((entry,i)=>{
        const yyRow=yy+i*row,label=fullLabel(entry);
        return <g key={entry}>
          <title>{label}</title>
          {entry==="__band__"
            ?<rect x={xx} y={yyRow-9} width="31" height="13" fill={c.bandColor} fillOpacity={Math.max(.18,c.bandOpacity*3)} stroke="none"/>
            :<path d={"M"+xx+" "+yyRow+"h31"} stroke={color(entry)} strokeWidth={lineWidth(entry)} strokeLinecap="round"/>}
          <text x={xx+44} y={yyRow+f*.31} fill={o.legendFontColor??"#313940"} clipPath={"url(#"+id+")"}>{label}</text>
        </g>;
      })}
    </g>;
  };
  const charWidth=(ch:string,size:number)=>{
    if(ch===" ")return size*.28;
    if(/[il.,;:!|]/.test(ch))return size*.27;
    if(/[MW@%]/.test(ch))return size*.8;
    if(/[^\u0000-\u007f]/.test(ch))return size*.69;
    return size*.53;
  };
  const textWidth=(value:string,size:number)=>Array.from(value).reduce((w,ch)=>w+charWidth(ch,size),0);
  const wrapText=(text:string,maxWidth:number,size:number)=>{
    const out:string[]=[];
    for(const original of text.split("\n")){
      const tokens=original.split(/(\s+)/).filter(Boolean);
      let line="";
      for(const token of tokens){
        if(textWidth(line+token,size)<=maxWidth){line+=token;continue;}
        if(line.trim()){out.push(line.trimEnd());line="";}
        for(const ch of Array.from(token.trimStart())){
          if(line&&textWidth(line+ch,size)>maxWidth){out.push(line);line="";}
          line+=ch;
        }
      }
      out.push(line.trimEnd());
    }
    return out;
  };
  const renderAnnotation=(a:LorentzAnnotation)=>{
    if(a.visible===false)return null;
    const size=clamp(a.fontSizePt*ptScale,8,100),lineHeight=size*1.3;
    const maxWidth=clamp(a.maxWidth??300,100,600);
    const lines=wrapText(a.text,maxWidth-20,size);
    const contentWidth=Math.max(0,...lines.map(t=>textWidth(t,size)));
    const boxW=Math.min(maxWidth,contentWidth+22),boxH=lines.length*lineHeight+13;
    const boxX=a.x-9,boxY=a.y-size-8;
    const hasArrow=finite(a.arrowX)&&finite(a.arrowY);
    const startX=hasArrow?clamp(a.arrowX!,boxX,boxX+boxW):0;
    const startY=hasArrow?clamp(a.arrowY!,boxY,boxY+boxH):0;
    const dx=hasArrow?a.arrowX!-startX:0,dy=hasArrow?a.arrowY!-startY:0;
    const dist=Math.hypot(dx,dy);
    const arrowHead=dist>0?{
      x:a.arrowX!,y:a.arrowY!,ux:dx/dist,uy:dy/dist
    }:null;
    return <g key={a.id} data-annotation-id={a.id} data-box-x={boxX} data-box-y={boxY}
      data-box-width={boxW} data-box-height={boxH} style={{cursor:"move",touchAction:"none"}}
      onPointerDown={e=>{if(e.button!==0)return;e.stopPropagation();onSelectAnnotation(a.id);drag.current={id:a.id,clientX:e.clientX,clientY:e.clientY,x:a.x,y:a.y};e.currentTarget.setPointerCapture(e.pointerId)}}
      onPointerMove={e=>{if(!drag.current||drag.current.id!==a.id||!svgRef.current)return;const bounds=svgRef.current.getBoundingClientRect();const dx=(e.clientX-drag.current.clientX)*W/bounds.width,dy=(e.clientY-drag.current.clientY)*H/bounds.height;e.currentTarget.setAttribute("transform","translate("+dx+" "+dy+")")}}
      onPointerUp={e=>{const d=drag.current;if(!d||d.id!==a.id||!svgRef.current)return;drag.current=null;const bounds=svgRef.current.getBoundingClientRect();const xx=clamp(d.x+(e.clientX-d.clientX)*W/bounds.width,0,W),yy=clamp(d.y+(e.clientY-d.clientY)*H/bounds.height,0,H);e.currentTarget.removeAttribute("transform");e.currentTarget.releasePointerCapture(e.pointerId);if(Math.abs(xx-d.x)+Math.abs(yy-d.y)>.2)onMoveAnnotation(a.id,Number(xx.toFixed(1)),Number(yy.toFixed(1)))}}
      onPointerCancel={e=>{drag.current=null;e.currentTarget.removeAttribute("transform")}}>
      <title>{a.text}</title>
      {arrowHead&&dist>6&&<g stroke={a.color} fill="none" strokeWidth="1.15" opacity=".8" pointerEvents="none">
        <path d={"M"+startX+" "+startY+"L"+arrowHead.x+" "+arrowHead.y}/>
        <path d={"M"+(arrowHead.x-arrowHead.ux*9-arrowHead.uy*3.5)+" "+(arrowHead.y-arrowHead.uy*9+arrowHead.ux*3.5)+"L"+arrowHead.x+" "+arrowHead.y+"L"+(arrowHead.x-arrowHead.ux*9+arrowHead.uy*3.5)+" "+(arrowHead.y-arrowHead.uy*9-arrowHead.ux*3.5)}/>
      </g>}
      <rect x={boxX} y={boxY} width={boxW} height={boxH} rx="1.5"
        fill={a.background} fillOpacity={a.backgroundOpacity}
        stroke={a.borderColor} strokeWidth={a.borderWidthPt*ptScale}/>
      {lines.map((t,i)=><text key={i} x={a.x} y={a.y+i*lineHeight}
        fontFamily={font} fontSize={size} fontWeight={i===0?600:400}
        fill={a.color} opacity={i===0?1:.92}>{t}</text>)}
    </g>;
  };
  const peak=series(imagId),phase=series(phaseId);
  const nearest=(values:(number|null)[]|undefined,xx:number)=>{if(!values?.length)return 0;let best=0,d=Infinity;dataset.x.values.forEach((v,i)=>{if(finite(v)&&Math.abs(v-xx)<d){best=i;d=Math.abs(v-xx)}});return values[best]??0;};
  const resonanceX=clamp(c.resonanceX,xMin,xMax);
  return <svg ref={svgRef} width={width} height={height} viewBox={"0 0 "+W+" "+H} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="FigureStudio Lorentz oscillator editable two-panel scientific figure" style={{display:"block",background:bg,shapeRendering:"geometricPrecision",textRendering:"geometricPrecision"}}>
    <defs><clipPath id="lorentz-top-figure-clip"><rect x={LEFT} y={TOP} width={RIGHT-LEFT} height={panelHeight}/></clipPath><clipPath id="lorentz-bottom-figure-clip"><rect x={LEFT} y={bottomTop} width={RIGHT-LEFT} height={panelHeight}/></clipPath></defs>
    <g fontFamily={font} fontSize={titleFont} fontWeight={c.titleWeight??600} fill={o.plotTitleColor??"#262b30"}><text x={LEFT} y={TOP-13}>{c.topTitle}</text><text x={LEFT} y={bottomTop-14}>{c.bottomTitle}</text></g>
    {c.bandOpacity>0&&<rect x={Math.min(x(c.bandStart),x(c.bandEnd))} y={TOP} width={Math.abs(x(c.bandEnd)-x(c.bandStart))} height={panelHeight} fill={c.bandColor} opacity={clamp(c.bandOpacity,0,1)}/>}
    {axis(TOP,majorTop,minorTop,topY,false)}
    <g clipPath="url(#lorentz-top-figure-clip)">
      {curve(realId,topY)}
      {curve(imagId,topY)}
      {c.showReferenceLines&&<line x1={x(resonanceX)} x2={x(resonanceX)} y1={TOP} y2={TOP+panelHeight} stroke="#777" strokeWidth={c.referenceLineWidth} strokeDasharray="7 5"/>}
    </g>
    {c.showResonanceMarkers&&peak&&<circle cx={x(resonanceX)} cy={topY(nearest(peak.values,resonanceX))} r={c.markerRadius} fill={color(imagId)}/>}
    <text transform={"translate(36 "+(TOP+panelHeight/2)+") rotate(-90)"} textAnchor="middle" fontFamily={font} fontSize={axisFont} fill={axisColor}>{o.yTitle??"Susceptibility, χ(ω) (a.u.)"}</text>
    {legend(c.topLegendX,c.topLegendY,[realId,imagId,"__band__"])}
    {axis(bottomTop,majorBottom,minorBottom,bottomY,true)}
    <g clipPath="url(#lorentz-bottom-figure-clip)">
      {curve(phaseId,bottomY)}
      {c.showReferenceLines&&<><line x1={x(resonanceX)} x2={x(resonanceX)} y1={bottomTop} y2={BOTTOM} stroke="#777" strokeWidth={c.referenceLineWidth} strokeDasharray="7 5"/><line x1={LEFT} x2={RIGHT} y1={bottomY(90)} y2={bottomY(90)} stroke={color(imagId)} strokeDasharray="2 4" strokeWidth="1.2"/></>}
    </g>
    {c.showResonanceMarkers&&phase&&<circle cx={x(resonanceX)} cy={bottomY(nearest(phase.values,resonanceX))} r={c.markerRadius} fill={color(imagId)}/>}
    <text transform={"translate(36 "+(bottomTop+panelHeight/2)+") rotate(-90)"} textAnchor="middle" fontFamily={font} fontSize={axisFont} fill={axisColor}>{c.phaseYTitle}</text>
    <text x={(LEFT+RIGHT)/2} y={BOTTOM+48} textAnchor="middle" fontFamily={font} fontSize={axisFont} fill={axisColor}>{o.xTitle??"Normalized Driving Frequency, ω/ω₀"}</text>
    {legend(c.bottomLegendX,c.bottomLegendY,[phaseId],true)}
    {c.annotations.map(renderAnnotation)}
  </svg>;
}
