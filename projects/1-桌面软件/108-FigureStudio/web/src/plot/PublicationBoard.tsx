import type { RefObject, ReactNode } from "react";
import type { FigureSpec } from "../model";
import { PUBLICATION_PALETTES, publicationPalette } from "./palettes";

type BoardPaletteId = keyof typeof PUBLICATION_PALETTES;

interface Props {
  figure: FigureSpec;
  width: number;
  height: number;
  svgRef: RefObject<SVGSVGElement>;
}

const SERIF = '"Times New Roman", Georgia, serif';
const SANS = 'Arial, "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';

function rgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized.length === 3
    ? normalized.split("").map(ch=>ch+ch).join("")
    : normalized,16);
  return [(value>>16)&255,(value>>8)&255,value&255];
}
function mix(a: string,b: string,t: number): string {
  const ar=rgb(a), br=rgb(b), k=Math.max(0,Math.min(1,t));
  return "#" + ar.map((v,i)=>Math.round(v*(1-k)+br[i]*k).toString(16).padStart(2,"0")).join("");
}
function alpha(hex:string,a:number):string {
  const [r,g,b]=rgb(hex);
  return "rgba("+r+","+g+","+b+","+Math.max(0,Math.min(1,a))+")";
}
function luminance(hex:string):number {
  const [r,g,b]=rgb(hex).map(v=>{
    const c=v/255;
    return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);
  });
  return 0.2126*r+0.7152*g+0.0722*b;
}
function path(points:Array<[number,number]>):string {
  return points.map((p,i)=>(i?"L":"M")+p[0].toFixed(2)+" "+p[1].toFixed(2)).join(" ");
}

function Panel(props:{
  x:number;y:number;w:number;h:number;letter:string;title:string;
  accent:string;tint:string;children:ReactNode;
}) {
  const {x,y,w,h,letter,title,accent,tint,children}=props;
  return <g transform={"translate("+x+" "+y+")"}>
    <rect width={w} height={h} rx="7" fill="#fff" stroke="#edf0f2" strokeWidth=".8"/>
    <rect width={w} height="40" rx="7" fill={tint}/>
    <rect y="33" width={w} height="7" fill={tint}/>
    <rect x="0" y="0" width="40" height="40" rx="7" fill={accent}/>
    <rect x="33" y="0" width="7" height="40" fill={accent}/>
    <text x="20" y="27" textAnchor="middle" fontFamily={SERIF} fontWeight="700" fontSize="22" fill="#fff">{letter}</text>
    <text x="53" y="27" fontFamily={SERIF} fontWeight="600" fontSize="19" fill="#25313c">{title}</text>
    <g transform="translate(0 38)">{children}</g>
  </g>;
}

function Axes({w,h}:{w:number;h:number}) {
  return <g>
    <path d={"M 42 14 V "+(h-34)+" H "+(w-16)} fill="none" stroke="#3f4a53" strokeWidth="1.05"/>
    {[0,1,2,3].map(i=><path key={"x"+i} d={"M "+(42+i*(w-64)/3)+" "+(h-34)+" v 5"} stroke="#4e5860" strokeWidth=".85"/>)}
    {[0,1,2,3].map(i=><path key={"y"+i} d={"M 37 "+(h-34-i*(h-58)/3)+" h 5"} stroke="#4e5860" strokeWidth=".85"/>)}
  </g>;
}

function PcaPanel({w,h,c}:{w:number;h:number;c:string[]}) {
  const centers=[[92,82],[224,78],[108,190],[235,185]];
  return <g><Axes w={w} h={h}/>
    {centers.map((center,g)=>{
      const color=c[(g+1)%c.length], rx=48+(g%2)*8, ry=28+(g%3)*3;
      return <g key={g}>
        <ellipse cx={center[0]} cy={center[1]} rx={rx} ry={ry} transform={"rotate("+(g%2?12:-10)+" "+center[0]+" "+center[1]+")"} fill={alpha(color,.16)} stroke={alpha(color,.62)} strokeWidth="1"/>
        {Array.from({length:16},(_,i)=>{
          const t=i*2.399+g*.6, r=.35+.55*((i*37)%11)/10;
          return <circle key={i} cx={center[0]+Math.cos(t)*rx*r} cy={center[1]+Math.sin(t)*ry*r} r="3.1" fill={alpha(color,.76)}/>;
        })}
      </g>;
    })}
    <text x={w/2} y={h-10} textAnchor="middle" fontFamily={SERIF} fontSize="13" fill="#2f3941">PC1 (37.1%)</text>
    <text x="14" y={h/2} transform={"rotate(-90 14 "+h/2+")"} textAnchor="middle" fontFamily={SERIF} fontSize="13" fill="#2f3941">PC2 (21.4%)</text>
  </g>;
}

function SpectraPanel({w,h,c}:{w:number;h:number;c:string[]}) {
  const left=42,right=w-16,top=18,bottom=h-34;
  return <g><Axes w={w} h={h}/>
    {[0,1,2,3].map(g=>{
      const pts=Array.from({length:70},(_,i)=>{
        const x=i/69, peak1=Math.exp(-Math.pow((x-(.26+g*.045))/.12,2));
        const peak2=.45*Math.exp(-Math.pow((x-(.55-g*.018))/.16,2));
        const y=.12+(.74-g*.12)*peak1+.24*peak2;
        return [left+x*(right-left),bottom-y*(bottom-top)] as [number,number];
      });
      const color=c[(g+1)%c.length];
      return <g key={g}>
        <path d={path([...pts,[right,bottom],[left,bottom]])+" Z"} fill={alpha(color,.12)} stroke="none"/>
        <path d={path(pts)} fill="none" stroke={color} strokeWidth="1.35" strokeLinecap="round"/>
      </g>;
    })}
    <text x={w/2} y={h-10} textAnchor="middle" fontFamily={SERIF} fontSize="13" fill="#2f3941">Wavelength (nm)</text>
    <text x="14" y={h/2} transform={"rotate(-90 14 "+h/2+")"} textAnchor="middle" fontFamily={SERIF} fontSize="13" fill="#2f3941">Intensity (a.u.)</text>
  </g>;
}

function VolcanoPanel({w,h,c}:{w:number;h:number;c:string[]}) {
  const left=42,right=w-16,top=16,bottom=h-34;
  const mapX=(v:number)=>left+(v+4)/8*(right-left), mapY=(v:number)=>bottom-v/8*(bottom-top);
  const points=Array.from({length:220},(_,i)=>{
    const q=((i*73)%219)/219, x=(q-.5)*8+.18*Math.sin(i*1.7);
    const y=Math.min(8,.45+.68*Math.abs(x)+2.25*Math.pow(.5+.5*Math.sin(i*2.13),2)*(1-.55*Math.exp(-x*x/1.6)));
    const color=y>1.3&&x<-1?c[1]:y>1.3&&x>1?c[3]??c[2]:"#b9bec2";
    return <circle key={i} cx={mapX(x)} cy={mapY(y)} r="2.2" fill={alpha(color,.62)}/>;
  });
  return <g><Axes w={w} h={h}/>{points}
    <path d={"M "+mapX(-1)+" "+top+" V "+bottom+" M "+mapX(1)+" "+top+" V "+bottom+" M "+left+" "+mapY(1.3)+" H "+right} stroke="#70777d" strokeWidth=".9" strokeDasharray="5 4"/>
    <text x={w/2} y={h-10} textAnchor="middle" fontFamily={SERIF} fontSize="13" fill="#2f3941">log₂ fold change</text>
    <text x="14" y={h/2} transform={"rotate(-90 14 "+h/2+")"} textAnchor="middle" fontFamily={SERIF} fontSize="13" fill="#2f3941">−log₁₀(p)</text>
  </g>;
}

function ResponsePanel({w,h,c}:{w:number;h:number;c:string[]}) {
  const left=42,right=w-16,top=16,bottom=h-34;
  return <g><Axes w={w} h={h}/>
    {[0,1,2,3].map(g=>{
      const pts=Array.from({length:52},(_,i)=>{
        const x=i/51, y=.06+.82/(1+Math.exp(-8*(x-(.42+g*.07))));
        return [left+x*(right-left),bottom-y*(bottom-top)] as [number,number];
      });
      const color=c[(g+1)%c.length];
      const upper=pts.map(([x,y])=>[x,y-7] as [number,number]);
      const lower=[...pts].reverse().map(([x,y])=>[x,y+7] as [number,number]);
      return <g key={g}>
        <path d={path([...upper,...lower])+" Z"} fill={alpha(color,.12)} stroke="none"/>
        <path d={path(pts)} fill="none" stroke={color} strokeWidth="1.4"/>
        {pts.filter((_p,i)=>i%10===0).map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r="3" fill={color}/>)}
      </g>;
    })}
    <text x={w/2} y={h-10} textAnchor="middle" fontFamily={SERIF} fontSize="13" fill="#2f3941">Concentration (µM)</text>
  </g>;
}

function RidgePanel({w,h,c}:{w:number;h:number;c:string[]}) {
  const left=48,right=w-16,top=22,bottom=h-30;
  return <g>
    {Array.from({length:6},(_,g)=>{
      const base=bottom-g*(bottom-top)/5.5, color=c[(g+1)%c.length];
      const pts=Array.from({length:55},(_,i)=>{
        const x=i/54, peak=Math.exp(-.5*Math.pow((x-(.43+g*.025))/(.13+g*.006),2))+.24*Math.exp(-.5*Math.pow((x-.72)/.09,2));
        return [left+x*(right-left),base-peak*34] as [number,number];
      });
      return <g key={g}>
        <path d={path([[left,base],...pts,[right,base]])+" Z"} fill={alpha(color,.34)} stroke="none"/>
        <path d={path(pts)} fill="none" stroke={alpha(color,.75)} strokeWidth="1"/>
        <text x="9" y={base+4} fontFamily={SERIF} fontSize="12" fill="#46515a">Group {g+1}</text>
      </g>;
    })}
    <path d={"M "+left+" "+bottom+" H "+right} stroke="#434e57" strokeWidth="1"/>
    <text x={(left+right)/2} y={h-8} textAnchor="middle" fontFamily={SERIF} fontSize="13" fill="#2f3941">Expression level</text>
  </g>;
}

function BarPanel({w,h,c}:{w:number;h:number;c:string[]}) {
  const left=42,right=w-16,top=18,bottom=h-34, groups=4;
  const data=[[2.1,3.5,2.6],[4.0,6.2,3.8],[1.6,2.8,2.2],[3.6,5.0,3.2]];
  return <g><Axes w={w} h={h}/>
    {data.map((row,g)=>row.map((v,s)=>{
      const gw=(right-left)/groups, bw=gw*.2, x=left+g*gw+gw*.16+s*bw, y=bottom-v/7*(bottom-top);
      const color=c[(s+1)%c.length];
      return <g key={g+"-"+s}>
        <rect x={x} y={y} width={bw*.82} height={bottom-y} fill={alpha(color,.78)} stroke={alpha(mix(color,"#26313a",.35),.55)} strokeWidth=".45"/>
        <path d={"M "+(x+bw*.41)+" "+(y-9)+" V "+(y+3)+" M "+(x+bw*.25)+" "+(y-9)+" H "+(x+bw*.57)} stroke="#535c63" strokeWidth=".8"/>
      </g>;
    }))}
    <text x={w/2} y={h-10} textAnchor="middle" fontFamily={SERIF} fontSize="13" fill="#2f3941">Group</text>
  </g>;
}

function AssociationPanel({w,h,c}:{w:number;h:number;c:string[]}) {
  const left=42,right=w-16,top=18,bottom=h-34;
  const points=Array.from({length:85},(_,i)=>{
    const x=((i*37)%83)/83, noise=.13*Math.sin(i*2.7)+.07*Math.cos(i*1.13);
    const y=.1+.78*x+noise, color=c[(i%4)+1]??c[0];
    return <circle key={i} cx={left+x*(right-left)} cy={bottom-Math.max(0,Math.min(1,y))*(bottom-top)} r="2.5" fill={alpha(color,.6)}/>;
  });
  return <g><Axes w={w} h={h}/>{points}
    <path d={"M "+left+" "+(bottom-.12*(bottom-top))+" L "+right+" "+(bottom-.88*(bottom-top))} stroke={c[0]} strokeWidth="1.6"/>
    <text x="58" y="38" fontFamily={SERIF} fontStyle="italic" fontSize="14" fill="#33404b">R = 0.82</text>
    <text x={w/2} y={h-10} textAnchor="middle" fontFamily={SERIF} fontSize="13" fill="#2f3941">Variable X</text>
  </g>;
}

function HeatmapPanel({w,h,c,gradientId}:{w:number;h:number;c:string[];gradientId:string}) {
  const n=8, size=Math.min(27,(w-92)/n), x0=46, y0=32;
  const lo=c[1]??c[0], hi=c[4]??c[0], mid="#f5f6f4";
  return <g>
    {Array.from({length:n},(_,r)=>Array.from({length:n},(_,col)=>{
      const v=Math.sin((r+1)*1.17+(col+1)*.83)*.72+Math.cos((r-col)*.71)*.28;
      const fill=v<0?mix(mid,lo,Math.min(1,-v*.72)):mix(mid,hi,Math.min(1,v*.72));
      return <rect key={r+"-"+col} x={x0+col*size} y={y0+r*size} width={size+.4} height={size+.4} fill={fill}/>;
    }))}
    <path d={"M "+(x0-15)+" "+(y0+8)+" h 8 v "+(size*3)+" h -8 M "+(x0-15)+" "+(y0+size*4+6)+" h 8 v "+(size*3)+" h -8"} fill="none" stroke="#58626a" strokeWidth="1"/>
    <rect x={x0+n*size+18} y={y0} width="10" height={n*size} fill={"url(#"+gradientId+")"}/>
    {Array.from({length:n},(_,r)=><text key={r} x={x0+n*size+37} y={y0+r*size+size*.7} fontFamily={SANS} fontSize="10" fill="#48535b">G{r+1}</text>)}
  </g>;
}

function SurfacePanel({w,h,c,gradientId}:{w:number;h:number;c:string[];gradientId:string}) {
  const project=(x:number,y:number,z:number):[number,number]=>[
    w*.47+(x-y)*38,
    h*.56+(x+y)*17-z*36
  ];
  const zf=(x:number,y:number)=>1.15*Math.exp(-.55*((x-.55)**2+(y+.25)**2))-.62*Math.exp(-.8*((x+1.1)**2+(y-.8)**2))+.28*Math.sin(x*1.45)*Math.cos(y*1.25);
  const quads:ReactNode[]=[];
  const N=9;
  for(let yi=N-1;yi>=0;yi-=1){
    for(let xi=0;xi<N;xi+=1){
      const x0=-2+4*xi/N,x1=-2+4*(xi+1)/N,y0=-2+4*yi/N,y1=-2+4*(yi+1)/N;
      const zs=[zf(x0,y0),zf(x1,y0),zf(x1,y1),zf(x0,y1)];
      const pts=[project(x0,y0,zs[0]),project(x1,y0,zs[1]),project(x1,y1,zs[2]),project(x0,y1,zs[3])];
      const avg=zs.reduce((a,b)=>a+b,0)/4, t=Math.max(0,Math.min(1,(avg+.7)/2));
      quads.push(<path key={xi+"-"+yi} d={path(pts)+" Z"} fill={mix(c[1]??c[0],c[4]??c[2]??c[0],t)} stroke={alpha("#ffffff",.22)} strokeWidth=".35"/>);
    }
  }
  const floorY=h*.79;
  return <g>
    <g opacity=".62">
      <ellipse cx={w*.47} cy={floorY} rx="92" ry="34" fill="none" stroke={c[1]} strokeWidth="1"/>
      <ellipse cx={w*.47} cy={floorY} rx="66" ry="24" fill="none" stroke={c[2]??c[1]} strokeWidth=".9"/>
      <ellipse cx={w*.47} cy={floorY} rx="38" ry="14" fill="none" stroke={c[4]??c[0]} strokeWidth=".9"/>
    </g>
    {quads}
    <path d={"M 38 "+(h*.79)+" L "+(w*.47)+" "+(h*.91)+" L "+(w-30)+" "+(h*.79)} fill="none" stroke="#727a80" strokeWidth=".8"/>
    <rect x={w-22} y="42" width="9" height="142" rx="2" fill={"url(#"+gradientId+")"}/>
    <text x={w/2} y={h-8} textAnchor="middle" fontFamily={SERIF} fontSize="12" fill="#2f3941">x / y / z projection</text>
  </g>;
}

export function PublicationBoard({figure,width,height,svgRef}:Props) {
  const composition=figure.publicationBoard;
  const requested=(figure.figureOverrides.colorCycle &&
    !["matplotlib","matlab"].includes(figure.figureOverrides.colorCycle))
    ? figure.figureOverrides.colorCycle as BoardPaletteId
    : composition?.paletteId ?? "golden";
  const palette=publicationPalette(requested);
  const colors=[...palette.colors];
  const primary=colors.reduce((best,color)=>
    luminance(color)<luminance(best)?color:best,colors[0]);
  const dataColors=colors.filter(color=>luminance(color)<0.82);
  while(dataColors.length<5) dataColors.push(mix(primary,"#ffffff",0.24+dataColors.length*0.08));
  const accent=mix(primary,"#172433",.18);
  const tint=mix(primary,"#ffffff",.80);
  const scale=Math.min(width/1200,height/1560);
  const ox=(width-1200*scale)/2, oy=(height-1560*scale)/2;
  const panelW=350,panelH=330,gapX=25,gapY=24,startX=50,startY=330;
  const gradientId=("board-"+figure.id).replace(/[^a-zA-Z0-9_-]/g,"-");
  const heatGradientId=gradientId+"-heat";
  const swatches=colors.slice(0,8);
  while(swatches.length<8) swatches.push(mix(primary,"#ffffff",.75+swatches.length*.02));
  return <svg ref={svgRef} width={width} height={height} viewBox={"0 0 "+width+" "+height}
    xmlns="http://www.w3.org/2000/svg" role="img"
    aria-label={"Publication Style Board · "+palette.label}
    data-publication-board="true" data-palette-id={palette.id}
    style={{display:"block",background:"#ffffff",shapeRendering:"geometricPrecision",textRendering:"geometricPrecision"}}>
    <defs>
      <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stopColor={colors[0]}/>
        <stop offset="50%" stopColor={colors[Math.min(2,colors.length-1)]}/>
        <stop offset="100%" stopColor={colors[Math.min(4,colors.length-1)]}/>
      </linearGradient>
      <linearGradient id={heatGradientId} x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stopColor={colors[1]??colors[0]}/>
        <stop offset="50%" stopColor="#f7f7f5"/>
        <stop offset="100%" stopColor={colors[4]??colors[0]}/>
      </linearGradient>
    </defs>
    <g transform={"translate("+ox+" "+oy+") scale("+scale+")"}>
      <rect width="1200" height="1560" fill="#fff"/>
      <rect x="538" y="46" width="124" height="5" rx="2.5" fill={primary}/>
      <text x="600" y="116" textAnchor="middle" fontFamily={SERIF} fontWeight="700" fontSize="58" fill={accent}>
        {"科研配色 · "+palette.label}
      </text>
      <text x="600" y="158" textAnchor="middle" fontFamily={SERIF} fontSize="22" fill="#59656f">{palette.englishLabel+" / "+palette.description}</text>
      <text x="600" y="194" textAnchor="middle" fontFamily={SANS} fontSize="12" letterSpacing="1.65" fill="#899198">PUBLICATION STYLE BOARD · GOLDEN GEOMETRY × PALETTE SKIN</text>

      {swatches.map((color,i)=>{
        const x=50+i*137;
        return <g key={color+i}>
          <rect x={x} y="218" width="118" height="64" rx="9" fill={color} stroke="#e1e5e8" strokeWidth=".7"/>
          <text x={x+59} y="305" textAnchor="middle" fontFamily={SANS} fontWeight="600" fontSize="14.5" fill="#34404a">{color.toUpperCase()}</text>
        </g>;
      })}

      <Panel x={startX} y={startY} w={panelW} h={panelH} letter="a" title="PCA scores" accent={primary} tint={tint}><PcaPanel w={panelW} h={panelH-38} c={dataColors}/></Panel>
      <Panel x={startX+panelW+gapX} y={startY} w={panelW} h={panelH} letter="b" title="Spectral distribution" accent={primary} tint={tint}><SpectraPanel w={panelW} h={panelH-38} c={dataColors}/></Panel>
      <Panel x={startX+(panelW+gapX)*2} y={startY} w={panelW} h={panelH} letter="c" title="Volcano plot" accent={primary} tint={tint}><VolcanoPanel w={panelW} h={panelH-38} c={dataColors}/></Panel>

      <Panel x={startX} y={startY+panelH+gapY} w={panelW} h={panelH} letter="d" title="Response curves" accent={primary} tint={tint}><ResponsePanel w={panelW} h={panelH-38} c={dataColors}/></Panel>
      <Panel x={startX+panelW+gapX} y={startY+panelH+gapY} w={panelW} h={panelH} letter="e" title="Density ridges" accent={primary} tint={tint}><RidgePanel w={panelW} h={panelH-38} c={dataColors}/></Panel>
      <Panel x={startX+(panelW+gapX)*2} y={startY+panelH+gapY} w={panelW} h={panelH} letter="f" title="Group response" accent={primary} tint={tint}><BarPanel w={panelW} h={panelH-38} c={dataColors}/></Panel>

      <Panel x={startX} y={startY+(panelH+gapY)*2} w={panelW} h={panelH} letter="g" title="Association" accent={primary} tint={tint}><AssociationPanel w={panelW} h={panelH-38} c={dataColors}/></Panel>
      <Panel x={startX+panelW+gapX} y={startY+(panelH+gapY)*2} w={panelW} h={panelH} letter="h" title="Correlation heatmap" accent={primary} tint={tint}><HeatmapPanel w={panelW} h={panelH-38} c={dataColors} gradientId={heatGradientId}/></Panel>
      <Panel x={startX+(panelW+gapX)*2} y={startY+(panelH+gapY)*2} w={panelW} h={panelH} letter="i" title="3D surface projection" accent={primary} tint={tint}><SurfacePanel w={panelW} h={panelH-38} c={dataColors} gradientId={gradientId}/></Panel>

      <path d="M 50 1452 H 1150" stroke="#dfe3e6" strokeWidth="1"/>
      <text x="50" y="1492" fontFamily={SANS} fontSize="14" fill="#7b858d">FigureStudio Publication System · palette + geometry + plot-family profile</text>
      <text x="1150" y="1492" textAnchor="end" fontFamily={SANS} fontSize="14" fill="#7b858d">{String(composition?.boardNumber ?? 1).padStart(2,"0")} / 07</text>
    </g>
  </svg>;
}
