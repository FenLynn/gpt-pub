import type { FigureSpec } from "../model";

type V3 = [number, number, number];
type V2 = [number, number];

const VIRIDIS = [
  [0.0, "#440154"],
  [0.13, "#482878"],
  [0.25, "#3E4989"],
  [0.38, "#31688E"],
  [0.5, "#26828E"],
  [0.63, "#1F9E89"],
  [0.75, "#35B779"],
  [0.88, "#6DCD59"],
  [1.0, "#FDE725"]
] as const;

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function add(a: V3,b: V3):V3{return[a[0]+b[0],a[1]+b[1],a[2]+b[2]];}
function sub(a: V3,b: V3):V3{return[a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
function mul(a: V3,s:number):V3{return[a[0]*s,a[1]*s,a[2]*s];}
function dot(a: V3,b: V3):number{return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function cross(a: V3,b: V3):V3{return[
  a[1]*b[2]-a[2]*b[1],
  a[2]*b[0]-a[0]*b[2],
  a[0]*b[1]-a[1]*b[0]
];}
function norm(a:V3):number{return Math.hypot(a[0],a[1],a[2]);}
function normalize(a:V3):V3{const n=Math.max(1e-12,norm(a));return[a[0]/n,a[1]/n,a[2]/n];}
function rgb(hex:string):[number,number,number]{
  const value=Number.parseInt(hex.slice(1),16);
  return[(value>>16)&255,(value>>8)&255,value&255];
}
function colorAt(t:number):string{
  const x=Math.max(0,Math.min(1,t));
  for(let i=1;i<VIRIDIS.length;i+=1){
    if(x<=VIRIDIS[i][0]){
      const [p0,c0]=VIRIDIS[i-1], [p1,c1]=VIRIDIS[i];
      const k=(x-p0)/Math.max(1e-12,p1-p0);
      const a=rgb(c0),b=rgb(c1);
      return "#"+a.map((v,j)=>Math.round(v+(b[j]-v)*k).toString(16).padStart(2,"0")).join("");
    }
  }
  return VIRIDIS[VIRIDIS.length-1][1];
}
function minmax(values:number[]):[number,number]{
  let lo=Infinity,hi=-Infinity;
  for(const v of values){if(Number.isFinite(v)){if(v<lo)lo=v;if(v>hi)hi=v;}}
  if(!Number.isFinite(lo)||!Number.isFinite(hi))return[0,1];
  if(!(hi>lo))return[lo-.5,hi+.5];
  return[lo,hi];
}
function ticks(lo:number,hi:number,count=5):number[]{
  return Array.from({length:count},(_,i)=>lo+(hi-lo)*i/(count-1));
}
function fmt(v:number):string{
  if(Math.abs(v)>=1000||Math.abs(v)<0.01&&v!==0)return v.toExponential(1);
  return String(Number(v.toFixed(2)));
}
function contourSegments(
  xs:number[],ys:number[],z:number[][],level:number
):Array<[V3,V3]>{
  const segments:Array<[V3,V3]>=[];
  const edge=(a:V3,b:V3):V3|undefined=>{
    const da=a[2]-level,db=b[2]-level;
    if((da<0&&db<0)||(da>0&&db>0)||a[2]===b[2])return undefined;
    const t=(level-a[2])/(b[2]-a[2]);
    if(t<0||t>1||!Number.isFinite(t))return undefined;
    return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,level];
  };
  for(let j=0;j<ys.length-1;j+=1){
    for(let i=0;i<xs.length-1;i+=1){
      const p00:[number,number,number]=[xs[i],ys[j],finite(z[j]?.[i],NaN)];
      const p10:[number,number,number]=[xs[i+1],ys[j],finite(z[j]?.[i+1],NaN)];
      const p11:[number,number,number]=[xs[i+1],ys[j+1],finite(z[j+1]?.[i+1],NaN)];
      const p01:[number,number,number]=[xs[i],ys[j+1],finite(z[j+1]?.[i],NaN)];
      if(![p00,p10,p11,p01].every(p=>Number.isFinite(p[2])))continue;
      const hit=[edge(p00,p10),edge(p10,p11),edge(p11,p01),edge(p01,p00)]
        .filter((p):p is V3=>Boolean(p));
      if(hit.length===2)segments.push([hit[0],hit[1]]);
      else if(hit.length===4){segments.push([hit[0],hit[1]],[hit[2],hit[3]]);}
    }
  }
  return segments;
}

export interface SurfaceVectorSvgInput {
  trace: any;
  figure: FigureSpec;
  layout: any;
  width: number;
  height: number;
  widthMm: number;
  heightMm: number;
  camera?: any;
}

export function buildSurfaceVectorSvg(input:SurfaceVectorSvgInput):string{
  const {trace,figure,layout}=input;
  const width=Math.max(320,input.width),height=Math.max(240,input.height);
  const rawX=Array.isArray(trace?.x)?trace.x:[];
  const rawY=Array.isArray(trace?.y)?trace.y:[];
  const z:Array<Array<number|null>>=Array.isArray(trace?.z)?trace.z:[];
  const cols=Math.max(2,z[0]?.length??rawX.length??2);
  const rows=Math.max(2,z.length??rawY.length??2);
  const xs=Array.from({length:cols},(_,i)=>
    typeof rawX[i]==="number"&&Number.isFinite(rawX[i])?rawX[i]:i
  );
  const ys=Array.from({length:rows},(_,i)=>
    typeof rawY[i]==="number"&&Number.isFinite(rawY[i])?rawY[i]:i
  );
  const zv:number[][]=Array.from({length:rows},(_,j)=>
    Array.from({length:cols},(_,i)=>finite(z[j]?.[i],NaN))
  );
  const [xmin,xmax]=minmax(xs),[ymin,ymax]=minmax(ys);
  const allZ=zv.flat().filter(Number.isFinite);
  const [zmin,zmax]=minmax(allZ);
  const gap=Math.max(0,Math.min(1,figure.figureOverrides.surfaceProjectionFloorGap??0.28));
  const zfloor=zmin-(zmax-zmin)*gap;
  const aspect=layout?.scene?.aspectratio??{x:1,y:1,z:.64};
  const nx=(v:number)=>(v-(xmin+xmax)/2)/((xmax-xmin)/2||1)*finite(aspect.x,1);
  const ny=(v:number)=>(v-(ymin+ymax)/2)/((ymax-ymin)/2||1)*finite(aspect.y,1);
  const nz=(v:number)=>(v-(zfloor+zmax)/2)/((zmax-zfloor)/2||1)*finite(aspect.z,.64);
  const eyeObj=input.camera?.eye??layout?.scene?.camera?.eye??{x:1.34,y:1.34,z:.96};
  const eye:V3=[finite(eyeObj.x,1.34),finite(eyeObj.y,1.34),finite(eyeObj.z,.96)];
  const forward=normalize(mul(eye,-1));
  const worldUp:V3=Math.abs(dot(forward,[0,0,1]))>.97?[0,1,0]:[0,0,1];
  const right=normalize(cross(forward,worldUp));
  const up=normalize(cross(right,forward));
  const cameraPoint=(p:V3):[number,number,number]=>{
    const q=sub(p,eye);
    return[dot(q,right),dot(q,up),dot(q,forward)];
  };
  const rawProject=(p:V3):V2=>{
    const [cx,cy,depth]=cameraPoint(p);
    const perspective=Math.max(.55,Math.min(1.45,2.7/Math.max(1.6,depth)));
    return[cx*perspective,cy*perspective];
  };
  const surfacePoint=(x:number,y:number,zv0:number):V3=>[nx(x),ny(y),nz(zv0)];
  const boundsPoints:V3[]=[
    [nx(xmin),ny(ymin),nz(zfloor)],[nx(xmax),ny(ymin),nz(zfloor)],
    [nx(xmax),ny(ymax),nz(zfloor)],[nx(xmin),ny(ymax),nz(zfloor)],
    [nx(xmin),ny(ymin),nz(zmax)],[nx(xmax),ny(ymin),nz(zmax)],
    [nx(xmax),ny(ymax),nz(zmax)],[nx(xmin),ny(ymax),nz(zmax)]
  ];
  for(let j=0;j<rows;j+=1)for(let i=0;i<cols;i+=1){
    if(Number.isFinite(zv[j][i]))boundsPoints.push(surfacePoint(xs[i],ys[j],zv[j][i]));
  }
  const projectedBounds=boundsPoints.map(rawProject);
  const bx=minmax(projectedBounds.map(p=>p[0])),by=minmax(projectedBounds.map(p=>p[1]));
  const margin={l:74,r:100,t:58,b:64};
  const sx=(width-margin.l-margin.r)/(bx[1]-bx[0]||1);
  const sy=(height-margin.t-margin.b)/(by[1]-by[0]||1);
  const scale=Math.min(sx,sy)*.94;
  const cx=(bx[0]+bx[1])/2,cy=(by[0]+by[1])/2;
  const project=(p:V3):V2=>{
    const q=rawProject(p);
    return[width/2+(q[0]-cx)*scale,height/2-(q[1]-cy)*scale+8];
  };
  const pstr=(p:V2)=>p[0].toFixed(2)+","+p[1].toFixed(2);
  const line=(a:V3,b:V3,stroke:string,width0=.7,dash="")=>{
    const pa=project(a),pb=project(b);
    return '<path d="M '+pstr(pa)+' L '+pstr(pb)+'" fill="none" stroke="'+stroke+'" stroke-width="'+width0+'"'+(dash?' stroke-dasharray="'+dash+'"':'')+'/>';
  };
  const floor=[
    surfacePoint(xmin,ymin,zfloor),surfacePoint(xmax,ymin,zfloor),
    surfacePoint(xmax,ymax,zfloor),surfacePoint(xmin,ymax,zfloor)
  ].map(project);
  const quads:Array<{d:number;xml:string}>=[];
  for(let j=0;j<rows-1;j+=1){
    for(let i=0;i<cols-1;i+=1){
      const vals=[zv[j][i],zv[j][i+1],zv[j+1][i+1],zv[j+1][i]];
      if(!vals.every(Number.isFinite))continue;
      const pts:V3[]=[
        surfacePoint(xs[i],ys[j],vals[0]),
        surfacePoint(xs[i+1],ys[j],vals[1]),
        surfacePoint(xs[i+1],ys[j+1],vals[2]),
        surfacePoint(xs[i],ys[j+1],vals[3])
      ];
      const avg=vals.reduce((a,b)=>a+b,0)/4;
      const t=(avg-zmin)/(zmax-zmin||1);
      const depth=pts.reduce((sum,p)=>sum+cameraPoint(p)[2],0)/4;
      quads.push({
        d:depth,
        xml:'<polygon points="'+pts.map(p=>pstr(project(p))).join(" ")+'" fill="'+colorAt(t)+'" stroke="rgba(255,255,255,.20)" stroke-width=".34"/>'
      });
    }
  }
  quads.sort((a,b)=>b.d-a.d);
  const projection=figure.templateId==="surface-projection-3d";
  const count=Math.max(4,Math.min(28,Math.round(figure.figureOverrides.surfaceProjectionContourCount??12)));
  const levels=Array.from({length:count},(_,i)=>zmin+(zmax-zmin)*(i+1)/(count+1));
  let contours="";
  if(projection){
    levels.forEach((level,li)=>{
      const color=colorAt((level-zmin)/(zmax-zmin||1));
      const opacity=.82;
      for(const seg of contourSegments(xs,ys,zv,level)){
        const floorA=surfacePoint(seg[0][0],seg[0][1],zfloor);
        const floorB=surfacePoint(seg[1][0],seg[1][1],zfloor);
        if(figure.figureOverrides.surfaceProjectionFloor??true)
          contours+=line(floorA,floorB,color,.72);
        if(figure.figureOverrides.surfaceProjectionX??true)
          contours+=line(
            surfacePoint(xmin,seg[0][1],level),
            surfacePoint(xmin,seg[1][1],level),
            color,.64
          );
        if(figure.figureOverrides.surfaceProjectionY??true)
          contours+=line(
            surfacePoint(seg[0][0],ymax,level),
            surfacePoint(seg[1][0],ymax,level),
            color,.64
          );
      }
      void li; void opacity;
    });
  }
  const axisColor="#404a52",gridColor="#d8dde1";
  let axes="";
  axes+=line(surfacePoint(xmin,ymin,zfloor),surfacePoint(xmax,ymin,zfloor),axisColor,.9);
  axes+=line(surfacePoint(xmin,ymin,zfloor),surfacePoint(xmin,ymax,zfloor),axisColor,.9);
  axes+=line(surfacePoint(xmin,ymin,zfloor),surfacePoint(xmin,ymin,zmax),axisColor,.9);
  const tickText=(values:number[],axis:"x"|"y"|"z")=>{
    return values.map(v=>{
      const p=axis==="x"?surfacePoint(v,ymin,zfloor):
        axis==="y"?surfacePoint(xmin,v,zfloor):surfacePoint(xmin,ymin,v);
      const q=project(p);
      return '<text x="'+q[0].toFixed(2)+'" y="'+(q[1]+(axis==="z"?3:15)).toFixed(2)+'" font-family="Times New Roman, Georgia, serif" font-size="10.5" fill="#4d565d" text-anchor="middle">'+esc(fmt(v))+'</text>';
    }).join("");
  };
  const title=figure.figureOverrides.plotTitle??figure.name;
  const xTitle=figure.figureOverrides.xTitle??"x";
  const yTitle=figure.figureOverrides.yTitle??"y";
  const zTitle=figure.figureOverrides.zTitle??"z";
  const xEnd=project(surfacePoint(xmax,ymin,zfloor));
  const yEnd=project(surfacePoint(xmin,ymax,zfloor));
  const zEnd=project(surfacePoint(xmin,ymin,zmax));
  const defs='<defs><linearGradient id="fs-viridis" x1="0" y1="1" x2="0" y2="0">'+
    VIRIDIS.map(([p,c])=>'<stop offset="'+(p*100)+'%" stop-color="'+c+'"/>').join("")+
    '</linearGradient></defs>';
  const cbX=width-55,cbY=height*.24,cbH=height*.48;
  const colorbar='<rect x="'+cbX+'" y="'+cbY+'" width="12" height="'+cbH+'" fill="url(#fs-viridis)" rx="1"/>'+
    ticks(zmin,zmax,5).map((v,i)=>{
      const y=cbY+cbH*(1-i/4);
      return '<path d="M '+(cbX+12)+' '+y+' h 5" stroke="'+axisColor+'" stroke-width=".8"/>'+
        '<text x="'+(cbX+22)+'" y="'+(y+3.5)+'" font-family="Times New Roman, Georgia, serif" font-size="11" fill="'+axisColor+'">'+esc(fmt(v))+'</text>';
    }).join("")+
    '<text x="'+(cbX+42)+'" y="'+(cbY+cbH/2)+'" transform="rotate(-90 '+(cbX+42)+' '+(cbY+cbH/2)+')" text-anchor="middle" font-family="Times New Roman, Georgia, serif" font-size="13" fill="'+axisColor+'">'+esc(figure.figureOverrides.colorbarTitle??"z")+'</text>';
  const gridPlane='<polygon points="'+floor.map(p=>pstr(p)).join(" ")+'" fill="#f6f8f8" stroke="#ccd3d8" stroke-width=".7"/>';
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+input.widthMm+'mm" height="'+input.heightMm+'mm" viewBox="0 0 '+width+' '+height+'" data-figurestudio-vector-surface="true">'+
    defs+'<rect width="100%" height="100%" fill="#ffffff"/>'+
    '<text x="'+(width/2)+'" y="31" text-anchor="middle" font-family="Times New Roman, Georgia, serif" font-size="18" fill="#222a30">'+esc(title)+'</text>'+
    gridPlane+contours+quads.map(q=>q.xml).join("")+axes+
    tickText(ticks(xmin,xmax),"x")+tickText(ticks(ymin,ymax),"y")+tickText(ticks(zmin,zmax),"z")+
    '<text x="'+(xEnd[0]+14)+'" y="'+(xEnd[1]+20)+'" font-family="Times New Roman, Georgia, serif" font-size="13" fill="'+axisColor+'">'+esc(xTitle)+'</text>'+
    '<text x="'+(yEnd[0]-14)+'" y="'+(yEnd[1]+20)+'" font-family="Times New Roman, Georgia, serif" font-size="13" fill="'+axisColor+'">'+esc(yTitle)+'</text>'+
    '<text x="'+(zEnd[0]-4)+'" y="'+(zEnd[1]-12)+'" text-anchor="middle" font-family="Times New Roman, Georgia, serif" font-size="13" fill="'+axisColor+'">'+esc(zTitle)+'</text>'+
    colorbar+'</svg>';
  return svg;
}
