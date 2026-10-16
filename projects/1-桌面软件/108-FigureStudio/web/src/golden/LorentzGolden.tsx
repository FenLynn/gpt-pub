import { useRef, useState } from "react";
type P={gamma:number;amplitude:number;widthMm:number;heightMm:number;lineWidth:number;axisWidth:number;fontSize:number;gridOpacity:number;bandOpacity:number;bandStart:number;bandEnd:number;blue:string;red:string;purple:string;annotations:boolean;legends:boolean;minorTicks:boolean;grid:boolean;};
const initial:P={gamma:.115,amplitude:.76,widthMm:183,heightMm:154,lineWidth:2.8,axisWidth:1,fontSize:16,gridOpacity:.12,bandOpacity:.06,bandStart:.92,bandEnd:1.07,blue:"#305b76",red:"#a44b3d",purple:"#674080",annotations:true,legends:true,minorTicks:true,grid:true};
const fields:Array<[keyof P,string,number]>=[["gamma","Damping gamma",.005],["amplitude","Response amplitude",.01],["widthMm","Width (mm)",1],["heightMm","Height (mm)",1],["lineWidth","Curve width (px)",.1],["axisWidth","Axis width (px)",.1],["fontSize","Font size (px)",1],["gridOpacity","Grid opacity",.01],["bandOpacity","Band opacity",.01],["bandStart","Band start",.01],["bandEnd","Band end",.01]];
const x=(v:number)=>98+(v-.4)/1.2*1070;
const response=(v:number,g:number)=>{const d=(1-v*v)**2+(g*v)**2;return [(1-v*v)/d,g*v/d];};
function save(name:string,data:string,type:string){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
export default function LorentzGolden(){
const [p,setP]=useState<P>(initial);const ref=useRef<SVGSVGElement>(null);
const set=<K extends keyof P>(k:K,v:P[K])=>setP(q=>({...q,[k]:v}));
const y1=(v:number)=>55+(7.8-v)/11.7*412;
const y2=(v:number)=>523+(195-v)/195*412;
const path=(f:(v:number)=>number,y:(v:number)=>number)=>Array.from({length:1601},(_,i)=>{const v=.4+i*1.2/1600;return (i?"L":"M")+x(v).toFixed(2)+" "+y(f(v)).toFixed(2)}).join(" ");
const ticks=Array.from({length:7},(_,i)=>.4+i*.2);
const box=(top:number,y:(v:number)=>number,ys:number[],showX:boolean)=><g fontFamily="Georgia,serif" fontSize={p.fontSize} fill="#222">
{p.grid&&<g stroke="#777" strokeWidth=".7" opacity={p.gridOpacity}>{ticks.map(t=><line key={t} x1={x(t)} x2={x(t)} y1={top} y2={top+412}/>)}{ys.map(t=><line key={t} x1="98" x2="1168" y1={y(t)} y2={y(t)}/>)}</g>}
<rect x="98" y={top} width="1070" height="412" fill="none" stroke="#242424" strokeWidth={p.axisWidth}/>
{ticks.map(t=><g key={t} stroke="#222" strokeWidth={p.axisWidth}><path d={"M"+x(t)+" "+top+"v7 M"+x(t)+" "+(top+412)+"v-7"}/>{showX&&<text x={x(t)} y={top+434} stroke="none" textAnchor="middle">{t.toFixed(1)}</text>}</g>)}
{p.minorTicks&&Array.from({length:25},(_,i)=>.4+i*.05).map(t=><path key={t} d={"M"+x(t)+" "+top+"v3 M"+x(t)+" "+(top+412)+"v-3"} stroke="#333" strokeWidth=".65"/>)}
{ys.map(t=><g key={t}><path d={"M98 "+y(t)+"h7 M1168 "+y(t)+"h-7"} stroke="#222" strokeWidth={p.axisWidth}/><text x="86" y={y(t)+5} textAnchor="end">{showX?t+"°":t}</text></g>)}
</g>;
const note=(xx:number,yy:number,lines:string[],color:string)=><g fontFamily="Georgia,serif" fontSize={p.fontSize-1}><rect x={xx-5} y={yy-18} width={Math.max(...lines.map(a=>a.length))*8+18} height={lines.length*21+8} fill="white" fillOpacity=".92" stroke="#ccc" strokeWidth=".7"/>{lines.map((a,i)=><text key={i} x={xx} y={yy+i*21} fill={color} fontWeight={i?"normal":"bold"}>{a}</text>)}</g>;
const legend=(top:number,entries:Array<[string,string]>)=><g fontFamily="Georgia,serif" fontSize={p.fontSize-1}><rect x="793" y={top-22} width="368" height={entries.length*25+14} fill="white" fillOpacity=".94" stroke="#ccc"/>{entries.map(([c,t],i)=><g key={t}><path d={"M807 "+(top+i*25)+"h34"} stroke={c} strokeWidth={p.lineWidth}/><text x="850" y={top+i*25+5}>{t}</text></g>)}</g>;
const exportSvg=()=>{if(!ref.current)return;const svg=ref.current.cloneNode(true) as SVGSVGElement;svg.setAttribute("xmlns","http://www.w3.org/2000/svg");svg.setAttribute("width",p.widthMm+"mm");svg.setAttribute("height",p.heightMm+"mm");save("FigureStudio-Lorentz.svg",new XMLSerializer().serializeToString(svg),"image/svg+xml")};
return <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 290px",height:"100vh",background:"#f3f4f6",fontFamily:"system-ui,sans-serif"}}>
<main style={{padding:20,overflow:"auto"}}><header style={{display:"flex",justifyContent:"space-between",marginBottom:12}}><b>FigureStudio · Lorentz Golden Reference</b><a href="./?gallery=1">Nature Gallery</a></header>
<div style={{background:"white",padding:10,maxWidth:1200,margin:"auto"}}><svg ref={ref} viewBox="0 0 1200 1010" width="100%" role="img" aria-label="Lorentz golden reference editable scientific SVG" xmlns="http://www.w3.org/2000/svg">
<defs><clipPath id="lorentz-clip1"><rect x="98" y="55" width="1070" height="412"/></clipPath><clipPath id="lorentz-clip2"><rect x="98" y="523" width="1070" height="412"/></clipPath></defs>
<g fontFamily="Georgia,serif" fontSize={p.fontSize+5} fontWeight="bold"><text x="98" y="37">(a) Complex Frequency Response of the Lorentz Oscillator</text><text x="98" y="506">(b) Phase Lag Between Driving Electric Field and Electron Displacement</text></g>
{p.bandOpacity>0&&<rect x={x(p.bandStart)} y="55" width={x(p.bandEnd)-x(p.bandStart)} height="412" fill={p.red} opacity={p.bandOpacity}/>}
{box(55,y1,[-2,0,2,4,6],false)}
<g clipPath="url(#lorentz-clip1)"><path d={path(v=>p.amplitude*response(v,p.gamma)[0],y1)} stroke={p.blue} strokeWidth={p.lineWidth} strokeLinejoin="round" strokeLinecap="round" fill="none"/><path d={path(v=>p.amplitude*response(v,p.gamma)[1],y1)} stroke={p.red} strokeWidth={p.lineWidth} strokeLinejoin="round" strokeLinecap="round" fill="none"/><path d={"M"+x(1)+" 55v412"} stroke="#777" strokeWidth="1.3" strokeDasharray="7 5"/></g>
<circle cx={x(1)} cy={y1(p.amplitude/p.gamma)} r="6" fill={p.red}/>
<text transform="translate(34 260) rotate(-90)" textAnchor="middle" fontFamily="Georgia,serif" fontSize={p.fontSize+4}>Susceptibility, χ(ω) (a.u.)</text>
{p.annotations&&<>{note(210,95,["Absorption Peak (ω = ω₀)","Im[χ] ∝ 1/γ"],p.red)}<path d={"M460 99L"+x(1)+" "+y1(p.amplitude/p.gamma)} stroke={p.red} fill="none" strokeWidth="1.5"/>{note(160,230,["Normal Dispersion","(dn/dω > 0)"],p.blue)}{note(470,400,["Anomalous Dispersion","(dn/dω < 0)"],p.red)}</>}
{p.legends&&legend(84,[[p.blue,"Re[χ(ω)] · Dispersion"],[p.red,"Im[χ(ω)] · Absorption"],["#c5a29a","Anomalous dispersion zone"]])}
{box(523,y2,[0,45,90,135,180],true)}
<g clipPath="url(#lorentz-clip2)"><path d={path(v=>Math.atan2(p.gamma*v,1-v*v)*180/Math.PI,y2)} stroke={p.purple} strokeWidth={p.lineWidth} strokeLinecap="round" strokeLinejoin="round" fill="none"/><path d={"M"+x(1)+" 523v412"} stroke="#777" strokeDasharray="7 5" strokeWidth="1.3"/><path d={"M98 "+y2(90)+"h1070"} stroke={p.red} strokeDasharray="2 4" strokeWidth="1.2"/></g>
<circle cx={x(1)} cy={y2(90)} r="6" fill={p.red}/>
<text transform="translate(34 730) rotate(-90)" textAnchor="middle" fontFamily="Georgia,serif" fontSize={p.fontSize+4}>Phase Lag, φ (degrees)</text>
<text x="630" y="985" textAnchor="middle" fontFamily="Georgia,serif" fontSize={p.fontSize+4}>Normalized Driving Frequency, ω/ω₀</text>
{p.annotations&&<>{note(160,850,["ω ≪ ω₀ : φ → 0°","In-phase elastic response"],p.blue)}{note(735,738,["Resonance Lag: 90°","Maximum dissipation"],p.red)}{note(865,595,["ω ≫ ω₀ : φ → 180°","Out-of-phase response"],p.purple)}</>}
{p.legends&&legend(895,[[p.purple,"Phase lag φ(ω) = atan2(γω,1−ω²)"]])}
</svg></div></main>
<aside style={{background:"white",padding:15,overflow:"auto",borderLeft:"1px solid #ddd"}}><b>Editable Golden Reference</b><p style={{fontSize:12,color:"#666"}}>Live SVG; parameters are independent and numerical.</p>
<div style={{display:"flex",gap:5,marginBottom:14}}><button onClick={exportSvg}>Export SVG</button><button onClick={()=>save("Lorentz-parameters.json",JSON.stringify(p,null,2),"application/json")}>JSON</button><button onClick={()=>setP(initial)}>Reset</button></div>
{fields.map(([k,label,step])=><label key={k} style={{display:"grid",gridTemplateColumns:"1fr 85px",gap:8,fontSize:12,alignItems:"center",marginBottom:8}}>{label}<input type="number" step={step} value={p[k] as number} onChange={e=>set(k,Number(e.target.value))} style={{width:78,padding:5}}/></label>)}
{([["blue","Dispersion"],["red","Absorption"],["purple","Phase"]] as const).map(([k,label])=><label key={k} style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:8}}>{label}<input type="color" value={p[k]} onChange={e=>set(k,e.target.value)}/></label>)}
{([["annotations","Annotations"],["legends","Legends"],["minorTicks","Minor ticks"],["grid","Grid"]] as const).map(([k,label])=><label key={k} style={{display:"block",fontSize:12,marginBottom:8}}><input type="checkbox" checked={p[k]} onChange={e=>set(k,e.target.checked)}/>{label}</label>)}
<p style={{fontSize:11,color:"#777"}}>Analytical Lorentz response, 1601 sampled points. SVG exports at exact mm dimensions. This dedicated golden workspace does not replace the existing FigureSpec editor.</p></aside></div>;
}
