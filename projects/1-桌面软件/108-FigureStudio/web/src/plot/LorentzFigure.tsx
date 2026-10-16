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
const W=1200,H=1010,LEFT=98,RIGHT=1168,TOP=55,BOTTOM=935;
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));
const numberTicks=(lo:number,hi:number,step:number)=>{if(!finite(step)||step<=0||hi<=lo)return [];const start=Math.ceil((lo-1e-9)/step)*step;const count=Math.min(150,Math.max(0,Math.floor((hi-start+step*1e-6)/step)+1));return Array.from({length:count},(_,i)=>Number((start+i*step).toFixed(8)));};
function fmt(n:number){return Number(n.toFixed(4)).toString();}
export function LorentzFigure({figure,dataset,width,height,svgRef,onSelectSeries,onSelectAnnotation,onMoveAnnotation,onAxisClick,onLegendClick}:Props){
  const drag=useRef<{id:string;clientX:number;clientY:number;x:number;y:number}|null>(null);
  const c=figure.lorentz??defaultLorentzComposition,o=figure.figureOverrides;
  const gap=clamp(c.panelGap,10,150),panelHeight=(BOTTOM-TOP-gap)/2,bottomTop=TOP+panelHeight+gap;
  const xMin=o.xAutoRange===false&&finite(o.xMin)?o.xMin:.4;
  const xMax=o.xAutoRange===false&&finite(o.xMax)?o.xMax:1.6;
  const x=(v:number)=>LEFT+(v-xMin)/(xMax-xMin||1)*(RIGHT-LEFT);
  const topMin=finite(o.yMin)&&o.yAutoRange===false?o.yMin:c.topMin;
  const topMax=finite(o.yMax)&&o.yAutoRange===false?o.yMax:c.topMax;
  const topY=(v:number)=>TOP+(topMax-v)/(topMax-topMin||1)*panelHeight;
  const bottomY=(v:number)=>bottomTop+(c.phaseMax-v)/(c.phaseMax-c.phaseMin||1)*panelHeight;
  const baseSize=(o.tickLabelSizePt??9.5)*1.7;
  const font=o.fontFamily==="Arial"?"Arial,sans-serif":'"Times New Roman",Georgia,serif';
  const titleFont=(o.plotTitleSizePt??12)*1.7;
  const axisFont=(o.axisTitleSizePt??11)*1.7;
  const axisWidth=(o.axisLineWidthPt??.7)*2;
  const majorLen=(o.majorTickLengthPt??4.5)*1.55;
  const minorLen=(o.minorTickLengthPt??2.3)*1.55;
  const majorX=numberTicks(xMin,xMax,o.xMajorTickStep??.2);
  const minorX=o.minorTicks?numberTicks(xMin,xMax,o.xMinorTickStep??.05):[];
  const majorTop=numberTicks(topMin,topMax,o.yMajorTickStep??2);
  const majorBottom=numberTicks(c.phaseMin,c.phaseMax,c.phaseMajorTickStep||45);
  const minorTop=o.minorTicks?numberTicks(topMin,topMax,o.yMinorTickStep??.5):[];
  const minorBottom=o.minorTicks?numberTicks(c.phaseMin,c.phaseMax,c.phaseMinorTickStep||15):[];
  const bg=o.background??"#fff";
  const [realId,imagId,phaseId]=figure.dataRef?.yColumnIds??["lorentz-real","lorentz-imag","lorentz-phase"];
  const series=(id:string)=>dataset.ys.find(q=>q.id===id);
  const palette:Record<string,string>={"lorentz-real":"#305b76","lorentz-imag":"#a44b3d","lorentz-phase":"#674080"};
  const color=(id:string)=>figure.seriesOverrides[id]?.color??palette[id]??"#333";
  const lineWidth=(id:string)=>(figure.seriesOverrides[id]?.lineWidthPt??1.35)*2.15;
  const points=(id:string,y:(v:number)=>number)=>{
    const data=series(id)?.values??[];
    let path="",started=false;
    for(let i=0;i<Math.min(dataset.x.values.length,data.length);i++){
      const xx=dataset.x.values[i],yy=data[i];
      if(!finite(xx)||!finite(yy)||xx<xMin||xx>xMax){started=false;continue;}
      path+=(started?"L":"M")+x(xx).toFixed(2)+" "+y(yy).toFixed(2)+" ";
      started=true;
    }
    return path.trim();
  };
  const axis=(top:number,ys:number[],minorYs:number[],projectY:(v:number)=>number,labels:boolean)=><g fontFamily={font} fontSize={baseSize} fill={o.tickLabelColor??"#262626"} onClick={onAxisClick} style={{cursor:"pointer"}}>
    {o.gridVisible&&<g stroke="#777" strokeWidth=".8" opacity={clamp(c.gridOpacity,0,1)}>
      {majorX.map(v=><line key={"gx"+v} x1={x(v)} x2={x(v)} y1={top} y2={top+panelHeight}/>)}
      {ys.map(v=><line key={"gy"+v} x1={LEFT} x2={RIGHT} y1={projectY(v)} y2={projectY(v)}/>)}
    </g>}
    <rect x={LEFT} y={top} width={RIGHT-LEFT} height={panelHeight} fill="none" stroke="#262626" strokeWidth={axisWidth}/>
    {majorX.map(v=><g key={"x"+v}><path d={"M"+x(v)+" "+top+"v"+majorLen+" M"+x(v)+" "+(top+panelHeight)+"v-"+majorLen} fill="none" stroke="#333" strokeWidth={axisWidth*.8}/>{labels&&<text x={x(v)} y={top+panelHeight+24} textAnchor="middle">{fmt(v)}</text>}</g>)}
    {minorX.map(v=><path key={"mx"+v} d={"M"+x(v)+" "+top+"v"+minorLen+" M"+x(v)+" "+(top+panelHeight)+"v-"+minorLen} stroke="#333" strokeWidth={axisWidth*.65}/>)}
    {minorYs.map(v=><path key={"my"+v} d={"M"+LEFT+" "+projectY(v)+"h"+minorLen+" M"+RIGHT+" "+projectY(v)+"h-"+minorLen} stroke="#333" strokeWidth={axisWidth*.65}/>)}
    {ys.map(v=><g key={"y"+v}><path d={"M"+LEFT+" "+projectY(v)+"h"+majorLen+" M"+RIGHT+" "+projectY(v)+"h-"+majorLen} stroke="#333" strokeWidth={axisWidth*.8}/><text x={LEFT-11} y={projectY(v)+baseSize*.35} textAnchor="end">{labels?fmt(v)+"°":fmt(v)}</text></g>)}
  </g>;
  const curve=(id:string,y:(v:number)=>number)=>
    figure.seriesOverrides[id]?.visible===false?null:<path data-series-id={id} d={points(id,y)} fill="none" stroke={color(id)} strokeWidth={lineWidth(id)} strokeLinejoin="round" strokeLinecap="round" opacity={figure.seriesOverrides[id]?.opacity??1} onClick={e=>{e.stopPropagation();onSelectSeries(id)}} style={{cursor:"pointer"}}/>;
  const legend=(xx:number,yy:number,ids:string[],bottom=false)=>{
    const entries=ids.filter(id=>figure.seriesOverrides[id]?.visible!==false&&figure.seriesOverrides[id]?.showInLegend!==false);
    if(o.legendVisible===false||!entries.length)return null;
    const f=(o.legendFontSizePt??9.5)*1.7;
    const width=bottom?360:366,row=26;
    return <g onClick={onLegendClick} style={{cursor:"pointer"}} fontFamily={font} fontSize={f}>
      {o.legendFrame!==false&&<rect x={xx-12} y={yy-21} width={width} height={entries.length*row+13} fill={o.legendBackground??"#fff"} fillOpacity={o.legendBackgroundOpacity??.94} stroke={o.legendBorderColor??"#c6c6c6"} strokeWidth={(o.legendBorderWidthPt??.6)*1.6}/>}
      {entries.map((id,i)=><g key={id}><path d={"M"+xx+" "+(yy+i*row)+"h34"} stroke={color(id)} strokeWidth={lineWidth(id)}/><text x={xx+46} y={yy+i*row+5} fill="#262626">{figure.seriesOverrides[id]?.legendLabel??series(id)?.name??id}</text></g>)}
    </g>;
  };
  const renderAnnotation=(a:LorentzAnnotation)=>{
    if(a.visible===false)return null;
    const lines=a.text.split("\n"),size=a.fontSizePt*1.7,lineHeight=size*1.25;
    const width=Math.max(...lines.map(t=>t.length))*size*.54+20;
    const height=lines.length*lineHeight+12;
    return <g key={a.id} data-annotation-id={a.id} style={{cursor:"move",touchAction:"none"}}
      onPointerDown={e=>{if(e.button!==0)return;e.stopPropagation();onSelectAnnotation(a.id);drag.current={id:a.id,clientX:e.clientX,clientY:e.clientY,x:a.x,y:a.y};e.currentTarget.setPointerCapture(e.pointerId)}}
      onPointerMove={e=>{if(!drag.current||drag.current.id!==a.id||!svgRef.current)return;const bounds=svgRef.current.getBoundingClientRect();const dx=(e.clientX-drag.current.clientX)*W/bounds.width,dy=(e.clientY-drag.current.clientY)*H/bounds.height;e.currentTarget.setAttribute("transform","translate("+dx+" "+dy+")")}}
      onPointerUp={e=>{const d=drag.current;if(!d||d.id!==a.id||!svgRef.current)return;drag.current=null;const bounds=svgRef.current.getBoundingClientRect();const xx=clamp(d.x+(e.clientX-d.clientX)*W/bounds.width,0,W),yy=clamp(d.y+(e.clientY-d.clientY)*H/bounds.height,0,H);e.currentTarget.removeAttribute("transform");e.currentTarget.releasePointerCapture(e.pointerId);onMoveAnnotation(a.id,Number(xx.toFixed(1)),Number(yy.toFixed(1)))}}
      onPointerCancel={e=>{drag.current=null;e.currentTarget.removeAttribute("transform")}}>
      {finite(a.arrowX)&&finite(a.arrowY)&&<g stroke={a.color} fill="none" strokeWidth="1.5"><path d={"M"+(a.x+width/2)+" "+(a.y-8)+"L"+a.arrowX+" "+a.arrowY}/><path d={"M"+a.arrowX+" "+a.arrowY+"l-8 -4m8 4l-4 -8"}/></g>}
      <rect x={a.x-6} y={a.y-size} width={width} height={height} fill={a.background} fillOpacity={a.backgroundOpacity} stroke={a.borderColor} strokeWidth={a.borderWidthPt*1.6}/>
      {lines.map((t,i)=><text key={i} x={a.x} y={a.y+i*lineHeight} fontFamily={font} fontSize={size} fontWeight={i===0?"bold":"normal"} fill={a.color}>{t}</text>)}
    </g>;
  };
  const peak=series(imagId),phase=series(phaseId);
  const nearest=(values:(number|null)[]|undefined,xx:number)=>{if(!values?.length)return 0;let best=0,d=Infinity;dataset.x.values.forEach((v,i)=>{if(finite(v)&&Math.abs(v-xx)<d){best=i;d=Math.abs(v-xx)}});return values[best]??0;};
  const resonanceX=clamp(c.resonanceX,xMin,xMax);
  return <svg ref={svgRef} width={width} height={height} viewBox={"0 0 "+W+" "+H} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="FigureStudio Lorentz oscillator editable two-panel scientific figure" style={{display:"block",background:bg}}>
    <defs><clipPath id="lorentz-top-figure-clip"><rect x={LEFT} y={TOP} width={RIGHT-LEFT} height={panelHeight}/></clipPath><clipPath id="lorentz-bottom-figure-clip"><rect x={LEFT} y={bottomTop} width={RIGHT-LEFT} height={panelHeight}/></clipPath></defs>
    <g fontFamily={font} fontSize={titleFont} fontWeight="bold" fill="#151515"><text x={LEFT} y={TOP-13}>{c.topTitle}</text><text x={LEFT} y={bottomTop-14}>{c.bottomTitle}</text></g>
    {c.bandOpacity>0&&<rect x={x(c.bandStart)} y={TOP} width={x(c.bandEnd)-x(c.bandStart)} height={panelHeight} fill={c.bandColor} opacity={clamp(c.bandOpacity,0,1)}/>}
    {axis(TOP,majorTop,minorTop,topY,false)}
    <g clipPath="url(#lorentz-top-figure-clip)">
      {curve(realId,topY)}
      {curve(imagId,topY)}
      {c.showReferenceLines&&<line x1={x(resonanceX)} x2={x(resonanceX)} y1={TOP} y2={TOP+panelHeight} stroke="#777" strokeWidth={c.referenceLineWidth} strokeDasharray="7 5"/>}
    </g>
    {c.showResonanceMarkers&&peak&&<circle cx={x(resonanceX)} cy={topY(nearest(peak.values,resonanceX))} r={c.markerRadius} fill={color(imagId)}/>}
    <text transform={"translate(34 "+(TOP+panelHeight/2)+") rotate(-90)"} textAnchor="middle" fontFamily={font} fontSize={axisFont}>{o.yTitle??"Susceptibility, χ(ω) (a.u.)"}</text>
    {legend(c.topLegendX,c.topLegendY,[realId,imagId])}
    {axis(bottomTop,majorBottom,minorBottom,bottomY,true)}
    <g clipPath="url(#lorentz-bottom-figure-clip)">
      {curve(phaseId,bottomY)}
      {c.showReferenceLines&&<><line x1={x(resonanceX)} x2={x(resonanceX)} y1={bottomTop} y2={BOTTOM} stroke="#777" strokeWidth={c.referenceLineWidth} strokeDasharray="7 5"/><line x1={LEFT} x2={RIGHT} y1={bottomY(90)} y2={bottomY(90)} stroke={color(imagId)} strokeDasharray="2 4" strokeWidth="1.2"/></>}
    </g>
    {c.showResonanceMarkers&&phase&&<circle cx={x(resonanceX)} cy={bottomY(nearest(phase.values,resonanceX))} r={c.markerRadius} fill={color(imagId)}/>}
    <text transform={"translate(34 "+(bottomTop+panelHeight/2)+") rotate(-90)"} textAnchor="middle" fontFamily={font} fontSize={axisFont}>{c.phaseYTitle}</text>
    <text x={(LEFT+RIGHT)/2} y={BOTTOM+48} textAnchor="middle" fontFamily={font} fontSize={axisFont}>{o.xTitle??"Normalized Driving Frequency, ω/ω₀"}</text>
    {legend(c.bottomLegendX,c.bottomLegendY,[phaseId],true)}
    {c.annotations.map(renderAnnotation)}
  </svg>;
}
