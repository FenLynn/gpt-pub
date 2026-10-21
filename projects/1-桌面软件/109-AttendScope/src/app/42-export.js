/* R62 · Offline PNG captures and landscape A4 one-image-per-page PDF. */
function captureStamp(){const d=new Date();return d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'_'+pad(d.getHours())+pad(d.getMinutes())+pad(d.getSeconds())}
function captureCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,w,h);return [c,g]}
function captureLabel(g,s,x,y,size=13,color='#47627e'){g.font=size+'px "Microsoft YaHei",system-ui,sans-serif';g.fillStyle=color;g.fillText(String(s),x,y)}
async function captureImage(src){const i=new Image();i.src=src;await new Promise((ok,no)=>{i.onload=ok;i.onerror=no});return i}
function captureMatrixCanvas(){
 const people=state.workspaceMode==='group'?EMPLOYEES.filter(e=>groupOf(e)===state.selectedGroup):EMPLOYEES;
 const w=Math.max(1260,165+monthDays()*32),h=Math.max(400,140+people.length*25);
 const [canvas,g]=captureCanvas(w,h);captureLabel(g,'AttendScope  ·  月度考勤矩阵',26,43,23,'#27456b');
 captureLabel(g,periodText()+'  /  '+people.length+' 人',26,72);
 for(let d=1;d<=monthDays();d++)captureLabel(g,pad(d),166+(d-1)*32,108,12);
 people.forEach((p,row)=>{
  const y=122+row*25;captureLabel(g,p.name,20,y+15);
  for(let d=1;d<=monthDays();d++){
   const a=state.analysis.get(p.id+'|'+d);if(!a)continue;
   const kind=attendanceJudgment(a);
   g.fillStyle=ATTEND_STATUS_COLORS[kind]||ATTEND_BEHAVIOR_COLORS[kind]||'#dce5ef';
   g.fillRect(164+(d-1)*32,y,28,21);
  }
 });
 return canvas;
}
function captureStatisticsCanvas(){
 const data=asStatRows(),rows=data.visible||[],w=Math.max(1230,rows.length*28+90),h=720;
 const [canvas,g]=captureCanvas(w,h),left=70,bottom=587,max=Math.max(1,...rows.map(x=>x.value||0));
 captureLabel(g,'AttendScope  ·  统计分析',26,42,23,'#27456b');
 captureLabel(g,periodText()+'  ·  '+rows.length+' 项 / '+data.effectiveUnit,26,69);
 const palette=asStatPalette(asStatPrefs().family,asStatPrefs().metric);
 rows.forEach((r,i)=>{
  const slot=(w-left-20)/rows.length,x=left+(i+.5)*slot;
  const bh=Math.max(0,r.value/max*450),gradient=g.createLinearGradient(0,bottom-bh,0,bottom);
  gradient.addColorStop(0,palette.top);gradient.addColorStop(1,palette.bottom);
  g.fillStyle=gradient;g.fillRect(x-Math.min(20,slot*.35),bottom-bh,Math.min(40,slot*.7),bh);
  g.save();g.translate(x,bottom+18);g.rotate(-Math.PI/5.6);
  g.textAlign='right';captureLabel(g,r.label,0,0,12);g.restore();g.textAlign='left';
 });
 return canvas;
}
function captureTimelineCanvas(){
 const e=EMPLOYEES.find(x=>x.id===state.selection?.employeeId)||EMPLOYEES[0],day=state.chartDay||state.selection?.day||1;
 const a=state.analysis.get(e.id+'|'+day),[canvas,g]=captureCanvas(1320,530);
 captureLabel(g,'AttendScope  ·  个人考勤时间轴',26,42,23,'#27456b');
 captureLabel(g,e.name+'  ·  '+isoDate(day),26,72);
 const x=v=>105+1100*Math.max(0,Math.min(1440,v))/1440;
 const tracks=['进出','出差','请假','外出','加班'],loc={trip:1,leave:2,outing:3,overtime:4};
 tracks.forEach((n,i)=>{const y=143+i*66;captureLabel(g,n,26,y);g.strokeStyle='#e4ecf3';g.beginPath();g.moveTo(100,y);g.lineTo(1230,y);g.stroke()});
 if(a){
  const chart=r14TrackData(a);
  for(const band of chart.bars||[]){
   const row=loc[band.track];if(row===undefined)continue;
   g.globalAlpha=band.accepted===false?.28:.82;
   g.fillStyle=band.track==='overtime'?(band.origin==='auto'?
    OVERTIME_VISUALS.auto.top:OVERTIME_VISUALS.registered.top):
    ({trip:'#7d95d9',leave:'#af94de',outing:'#6eb3d3'})[band.track];
   g.fillRect(x(band.value[0]),130+row*66,Math.max(2,x(band.value[1])-x(band.value[0])),22);
   g.globalAlpha=1;
  }
  for(const event of chart.events||[]){const minute=Number(event.value[0]);
   g.fillStyle='#527fba';g.fillRect(x(minute)-1,131,3,24)}
 }
 return canvas;
}
async function captureCurrentImage(kind){
 let canvas=null;
 if(kind==='stats'||kind==='timeline'){
  const el=document.getElementById(kind==='stats'?'asStatChart':'attendanceTimelineChart'),
    chart=el&&window.echarts?.getInstanceByDom(el);
  if(chart){
   const image=await captureImage(chart.getDataURL({type:'png',pixelRatio:2,backgroundColor:'#fff'}));
   const [c,g]=captureCanvas(Math.max(image.width,1100),image.height+74);
   captureLabel(g,'AttendScope  ·  '+(kind==='stats'?'统计图':'时间轴')+'  ·  '+periodText(),25,43,21);
   g.drawImage(image,0,72);canvas=c;
  }
 }
 if(!canvas)canvas=kind==='matrix'?captureMatrixCanvas():
   kind==='stats'?captureStatisticsCanvas():captureTimelineCanvas();
 return {kind,filename:'AttendScope_'+kind+'_'+monthKey()+'_'+captureStamp()+'.png',
  data:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height};
}
function captureBytes(data){return Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0))}
async function captureSave(item){
 if(!state.captureItems)state.captureItems=[];
 state.captureItems.push(item);
 const bytes=captureBytes(item.data);
 if(state.projectDir){
  const month=await monthDirectory(),out=await dir(month,'output'),folder=await dir(out,'captures');
  await writeFile(folder,item.filename,bytes);
 }else downloadBlob(new Blob([bytes],{type:'image/png'}),item.filename);
}
async function captureCurrentView(){
 const kind=state.workspaceMode==='stats'?'stats':state.chartTab==='timeline'?'timeline':'matrix';
 try{await captureSave(await captureCurrentImage(kind));toast('已保存截图：'+kind)}
 catch(e){toast('截图失败：'+e.message,true)}
}
async function captureStoredFiles(){
 if(!state.projectDir)return [];
 const folder=await dir(await dir(await monthDirectory(),'output'),'captures');
 const found=[];
 for await(const [name,handle] of folder.entries()){
  if(handle.kind!=='file'||!name.endsWith('.png'))continue;
  const bytes=new Uint8Array(await (await handle.getFile()).arrayBuffer());
  let binary='';for(let i=0;i<bytes.length;i+=12000)binary+=String.fromCharCode(...bytes.slice(i,i+12000));
  found.push({filename:name,data:'data:image/png;base64,'+btoa(binary)});
 }
 return found.sort((a,b)=>a.filename.localeCompare(b.filename));
}
async function capturePdf(items){
 const E=new TextEncoder(),parts=[],offset=[],ids=items.map((_,i)=>[i*3+3,i*3+4,i*3+5]);
 let total=0;
 function put(a){const v=typeof a==='string'?E.encode(a):a;parts.push(v);total+=v.length}
 function object(id,segments){offset[id]=total;put(id+' 0 obj\n');for(const s of segments)put(s);put('\nendobj\n')}
 put('%PDF-1.4\n%Offline AttendScope\n');
 object(1,['<< /Type /Catalog /Pages 2 0 R >>']);
 object(2,['<< /Type /Pages /Kids [',ids.map(i=>i[0]+' 0 R').join(' '),'] /Count '+items.length+' >>']);
 for(let i=0;i<items.length;i++){
  const img=await captureImage(items[i].data),[canvas,g]=captureCanvas(img.width,img.height);
  g.drawImage(img,0,0);
  const data=captureBytes(canvas.toDataURL('image/jpeg',.91));
  const scale=Math.min(800/canvas.width,550/canvas.height),w=canvas.width*scale,h=canvas.height*scale,
    x=(842-w)/2,y=(595-h)/2,idsThis=ids[i],op='Im'+i;
  const script='q '+w.toFixed(4)+' 0 0 '+h.toFixed(4)+' '+x.toFixed(4)+' '+y.toFixed(4)+' cm /'+op+' Do Q\n';
  object(idsThis[0],['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /XObject << /'+op+' '+idsThis[2]+' 0 R >> >> /Contents '+idsThis[1]+' 0 R >>']);
  object(idsThis[1],['<< /Length '+E.encode(script).length+' >>\nstream\n',script,'endstream']);
  object(idsThis[2],['<< /Type /XObject /Subtype /Image /Width '+canvas.width+' /Height '+canvas.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+data.length+' >>\nstream\n',data,'\nendstream']);
 }
 const at=total;put('xref\n0 '+(3+3*items.length)+'\n0000000000 65535 f \n');
 for(let id=1;id<=2+items.length*3;id++)put(String(offset[id]).padStart(10,'0')+' 00000 n \n');
 put('trailer\n<< /Size '+(3+3*items.length)+' /Root 1 0 R >>\nstartxref\n'+at+'\n%%EOF');
 return new Blob(parts,{type:'application/pdf'});
}
async function captureAllPdf(){
 try{
  let list=state.captureItems||[];
  const previous=await captureStoredFiles().catch(()=>[]);
  list=[...previous,...list.filter(x=>!previous.some(y=>y.filename===x.filename))];
  if(!list.length)list=await Promise.all(['matrix','stats','timeline'].map(captureCurrentImage));
  const pdf=await capturePdf(list),name='AttendScope_Report_'+monthKey()+'_'+captureStamp()+'.pdf';
  if(state.projectDir){const output=await dir(await monthDirectory(),'output');await writeFile(output,name,await pdf.arrayBuffer())}
  else downloadBlob(pdf,name);
  toast('已生成横向 PDF · '+list.length+' 页，每页一张截图');
 }catch(e){toast('生成 PDF 失败：'+e.message,true)}
}
