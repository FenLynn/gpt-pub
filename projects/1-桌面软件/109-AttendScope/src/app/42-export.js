/* R62 · Offline PNG captures and landscape A4 one-image-per-page PDF. */
function captureStamp(){const d=new Date();return d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'_'+pad(d.getHours())+pad(d.getMinutes())+pad(d.getSeconds())+'_'+String(d.getMilliseconds()).padStart(3,'0')}
function captureCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,w,h);return [c,g]}
function captureLabel(g,s,x,y,size=13,color='#47627e'){g.font=size+'px "Microsoft YaHei",system-ui,sans-serif';g.fillStyle=color;g.fillText(String(s),x,y)}
async function captureImage(src){
 const image=new Image();
 await new Promise((resolve,reject)=>{
  image.onload=resolve;
  image.onerror=()=>reject(new Error('无法解码导出的图片，已取消损坏图片的使用'));
  image.src=src;
 });
 return image;
}

/* R63: faithfully compose chart, legends, context counts, and right-hand facts. */
function r63Title(){return typeof attendTitle==='function'?attendTitle():'考勤'}
function r63FileStem(){return r63Title().replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').trim()||'考勤'}
function r63ReportData(kind){
 if(kind==='stats'){
  const d=asStatRows(),p=asStatPrefs(),label=asStatFamily(p.family)[2].find(x=>x[0]===p.metric)?.[1]||'统计';
  return {heading:(document.querySelector('.as-stats-chart-context')?.textContent?.trim()||'当前范围')+' · '+periodText()+' · '+d.rows.length+' 项 · '+label,
   lines:[['范围',document.querySelector('.as-stats-chart-context')?.textContent?.trim()||periodText()],
    ['统计指标',label],['范围总量',document.querySelector('.as-stats-total strong')?.textContent?.trim()||'—'],
    ...(d.rankRows||d.rows).slice(0,12).map((x,i)=>[String(i+1)+'. '+x.label,Math.round(x.value*100)/100+' '+d.effectiveUnit])]};
 }
 const e=EMPLOYEES.find(x=>x.id===state.selection?.employeeId)||EMPLOYEES[0],
  day=state.chartDay||state.selection?.day||1,a=e&&state.analysis.get(e.id+'|'+day);
 if(!a)return {heading:periodText(),lines:[['状态','暂无可用记录']]};
 const auto=(a.autoOvertime?.segments||[]).filter(x=>x.accepted!==false).reduce((n,x)=>n+(x.minutes||0),0);
 return {heading:e.name+' · '+isoDate(day),
  lines:[['姓名',e.name],['日期',isoDate(day)],['最终判定',JUDGMENT_LABELS[attendanceJudgment(a)]||a.status||'—'],
   ['打卡次数',a.punches.length+' 条'],['首进',a.firstIn?.slice(0,8)||'—'],
   ['末出',a.lastOut?.slice(0,8)||'—'],['在岗',fmtMinutes(a.presence)],
   ['班内工时',fmtMinutes(a.workMinutes??0)],['自动加班（已纳入）',fmtMinutes(auto)],
   ['登记加班',a.overtime?.length+' 条'],['出差',a.trips?.length+' 条'],
   ['请假',a.leaves?.length+' 条'],[FILTER_LABELS.outing,timelineBehaviorRows(a,'outing').length+' 次'],
   ['异常说明',(a.issues||[]).join('、')||'无']]};
}
function r63Legend(g,kind,x,y){
 const o=OVERTIME_VISUALS;
 const legend=kind==='matrix'?
  [['正常','#78caa0'],['待核','#e6c36f'],['缺勤','#e58f90'],['非工作日','#e4eaf1']]:
  kind==='stats'?(asStatPrefs().family==='overtime'?
   [['登记加班',o.registered.top],['自动加班',o.auto.top]]:
   [[asStatFamily(asStatPrefs().family)[1],asStatPalette(asStatPrefs().family,asStatPrefs().metric).top]]):
  [['进','#1f5a9f'],['出','#8a5b3d'],['出差','#7d95d9'],['请假','#af94de'],
   ['外出','#6eb3d3'],['登记加班',o.registered.top],['自动加班',o.auto.top]];
 g.save();g.font='14px system-ui';for(const [label,color] of legend){
  g.fillStyle=color;g.fillRect(x,y-10,13,13);g.fillStyle='#536980';g.fillText(label,x+19,y+2);
  x+=g.measureText(label).width+46;
 }g.restore();
}
function r63Compose(kind,visual){
 const d=r63ReportData(kind),sidebar=kind==='matrix'?0:360;
 const infoHeight=sidebar?d.lines.reduce((n,[_,value])=>n+34+
  Math.max(1,Math.ceil(Math.min(80,String(value??'—').length)/26))*20,0)+255:0;
 const width=Math.max(1060,visual.width)+sidebar+58,top=131,
  height=Math.max(690,visual.height+top+25,infoHeight);
 const [c,g]=captureCanvas(width,height);
 captureLabel(g,r63Title()+' · '+({matrix:'月度考勤矩阵',stats:'统计分析',timeline:'个人考勤时间轴'}[kind]),26,43,25,'#284766');
 captureLabel(g,kind==='matrix'?periodText()+' · '+scopeVisibleEmployees().length+' 人':d.heading,26,75,16);
 r63Legend(g,kind,26,108);g.drawImage(visual,25,top);
 if(sidebar){
  const x=Math.max(1060,visual.width)+46;g.strokeStyle='#e3eaf1';g.beginPath();g.moveTo(x-15,150);g.lineTo(x-15,height-22);g.stroke();
  captureLabel(g,kind==='stats'?'统计信息 · 排行':'当日考勤信息',x,176,20,'#284766');
  let y=208;for(const [key,value] of d.lines){
   if(y>=height-52)break;
   captureLabel(g,key,x,y,13,'#76899d');y+=22;
   const str=String(value??'—');for(let i=0;i<Math.min(str.length,80);i+=26){
    captureLabel(g,str.slice(i,i+26),x,y,14,'#294663');y+=20;
   }
   if(!str.length)y+=20;y+=12;
  }
 }
 return c;
}

function captureMatrixCanvas(){
 const people=scopeVisibleEmployees();
 const w=Math.max(1260,165+monthDays()*32),h=Math.max(315,55+people.length*25);
 const [canvas,g]=captureCanvas(w,h);
 for(let d=1;d<=monthDays();d++)captureLabel(g,pad(d),166+(d-1)*32,28,12);
 people.forEach((p,row)=>{
  const y=40+row*25;captureLabel(g,p.name,20,y+15);
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
 const e=EMPLOYEES.find(x=>x.id===state.selection?.employeeId)||EMPLOYEES[0],
  day=state.chartDay||state.selection?.day||1,a=e&&state.analysis.get(e.id+'|'+day);
 const [canvas,g]=captureCanvas(1320,535);
 const left=100,right=1240,width=right-left,top=66,rowHeight=67;
 const x=t=>left+width*Math.max(0,Math.min(1440,Number(t)||0))/1440;
 const cy=i=>top+i*rowHeight;
 const labels=['进','出','出差','请假','外出','加班'];
 const palette=['#1f5a9f','#8a5b3d','#7d95d9','#af94de','#6eb3d3','#c876a0'];
 // Every lane remains present even with no records. Work windows are faint guides.
 labels.forEach((label,i)=>{
  const yy=cy(i),isBehavior=i>=2;
  if(isBehavior){g.fillStyle='#f8fafc';g.fillRect(left,yy-28,width,56)}
  if(a&&isWorkday(a.day)&&state.prefs?.timelineTracks?.rules!==false){
   for(const [a,b] of [[RULES.amStart,RULES.amEnd],[RULES.pmStart,RULES.pmEnd]]){
    g.fillStyle='rgba(108,139,179,.055)';g.fillRect(x(minutes(a)),yy-28,x(minutes(b))-x(minutes(a)),56);
   }
  }
  captureLabel(g,label,23,yy+5,16,palette[i]);
  g.strokeStyle='#dce6ef';g.lineWidth=1;g.beginPath();
  g.moveTo(left,yy+29);g.lineTo(right,yy+29);g.stroke();
 });
 if(a){
  const model=r14TrackData(a,{start:0,end:1440,key:'export'},width);
  for(const bar of model.bars||[]){
   const row=Number(bar.value[2]);if(row<2||row>5)continue;
   const from=x(bar.value[0]),to=x(bar.value[1]),y=cy(row)-25;
   const grad=g.createLinearGradient(from,y,to,y);
   const colors=bar.track==='overtime'?
    (bar.accepted===false?OVERTIME_VISUALS.excluded:
     OVERTIME_VISUALS[bar.origin==='auto'?'auto':'registered']):
    ({trip:{top:'#aeb8ec',bottom:'#6b7fd7'},leave:{top:'#d4c5f0',bottom:'#8a6fd1'},
      outing:{top:'#acdce9',bottom:'#3c9dc4'}})[bar.track];
   if(!colors)continue;
   grad.addColorStop(0,colors.top);grad.addColorStop(1,colors.bottom);
   g.globalAlpha=bar.accepted===false?.58:.9;g.fillStyle=grad;
   g.fillRect(from,y,Math.max(2,to-from),50);g.globalAlpha=1;
  }
  const baseline=(cy(0)+cy(1))/2;
  for(const ev of model.events||[]){
   const xx=x(ev.value[0]),incoming=ev.direction==='进';
   const origin=incoming?cy(0)-24:cy(1)+24,target=baseline+(incoming?-3:3);
   g.strokeStyle=incoming?palette[0]:palette[1];g.lineWidth=3;
   g.beginPath();g.moveTo(xx,origin);g.lineTo(xx,target);g.stroke();
   g.fillStyle=g.strokeStyle;g.beginPath();g.moveTo(xx,target);
   g.lineTo(xx-6,target+(incoming?-9:9));
   g.lineTo(xx+6,target+(incoming?-9:9));g.closePath();g.fill();
   if(ev.count>1)captureLabel(g,'×'+ev.count,xx+6,origin,12,g.fillStyle);
  }
 }
 for(let hour=0;hour<=24;hour+=3){
  const xx=x(hour*60);
  g.strokeStyle='#dce6ef';g.beginPath();g.moveTo(xx,cy(5)+41);
  g.lineTo(xx,cy(5)+48);g.stroke();
  captureLabel(g,pad(hour)+':00',xx-17,cy(5)+69,12,'#71859b');
 }
 return canvas;
}
async function captureCurrentImage(kind){
 let visual=null;
 if(kind==='stats'||kind==='timeline'){
  const el=document.getElementById(kind==='stats'?'asStatChart':'attendanceTimelineChart');
  const chart=el&&window.echarts?.getInstanceByDom(el);
  if(chart&&!chart.isDisposed()){
   try{
    const data=chart.getDataURL({type:'png',pixelRatio:2,backgroundColor:'#fff'});
    const img=await captureImage(data);
    const [canvas,g]=captureCanvas(img.width,img.height);g.drawImage(img,0,0);visual=canvas;
   }catch(error){
    // Some SVG-backed ECharts instances return an image Chrome cannot decode.
    // Never abandon the report: redraw from the same authoritative facts.
    console.warn('图表原图无法解码，改用离线归档绘图',error?.message||error);
   }
  }
 }
 if(!visual)visual=kind==='matrix'?captureMatrixCanvas():
  kind==='stats'?captureStatisticsCanvas():captureTimelineCanvas();
 const canvas=r63Compose(kind,visual);
 return {kind,month:monthKey(),filename:r63FileStem()+'_'+kind+'_'+monthKey()+'_'+captureStamp()+'.png',
  data:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height};
}
function captureBytes(data){return Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0))}
async function r63Thumbnail(data){
 const img=await captureImage(data),scale=Math.min(1,180/img.width,110/img.height);
 const [canvas,g]=captureCanvas(Math.max(1,Math.round(img.width*scale)),Math.max(1,Math.round(img.height*scale)));
 g.drawImage(img,0,0,canvas.width,canvas.height);
 return canvas.toDataURL('image/jpeg',.65);
}
async function captureSave(item){
 if(!state.captureItems)state.captureItems=[];
 item.thumb=await r63Thumbnail(item.data);
 state.captureItems.push(item);if(state.captureItems.length>16)state.captureItems.splice(0,state.captureItems.length-16);
 const bytes=captureBytes(item.data);
 return p109PersistOutput(new Blob([bytes],{type:'image/png'}),item.filename,['captures']);
}
async function captureCurrentView(){
 const kind=state.workspaceMode==='stats'?'stats':state.workspaceMode==='person'||state.chartTab==='timeline'?'timeline':'matrix';
 try{const result=await captureSave(await captureCurrentImage(kind));toast(p109OutputNotice(result,'截图'))}
 catch(e){toast('截图失败：'+e.message,true)}
}
async function captureStoredFiles(){
 if(!state.projectDir)return [];
 let folder;try{folder=await existingDir(await existingDir(await monthDirectory(),'output'),'captures')}
 catch(e){if(e.name==='NotFoundError')return [];throw e}
 const matches=[];
 for await(const [name,handle] of folder.entries())if(handle.kind==='file'&&name.endsWith('.png'))matches.push([name,handle]);
 matches.sort((a,b)=>b[0].localeCompare(a[0]));
 const found=[];
 for(const [filename,handle] of matches.slice(0,16)){
  const file=await handle.getFile();if(file.size>14*1024*1024)continue;
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
  for(let i=0;i<bytes.length;i+=12000)binary+=String.fromCharCode(...bytes.subarray(i,i+12000));
  found.push({filename,month:monthKey(),data:'data:image/png;base64,'+btoa(binary)});
 }
 return found;
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
async function captureAllPdf(selected){
 try{
  const items=Array.isArray(selected)?selected:(state.captureItems||[]).filter(x=>x.month===monthKey());
  if(!items.length){toast('请先截图，再从 PDF 菜单选择图片',true);return}
  const pdf=await capturePdf(items),name=r63FileStem()+'_Report_'+monthKey()+'_'+captureStamp()+'.pdf';
  const result=await p109PersistOutput(pdf,name,[]);
  toast(p109OutputNotice(result,items.length+' 页横向 A4 PDF'));return true;
 }catch(e){toast('生成 PDF 失败：'+e.message,true);return false}

}

/* Explicit, transient image tray; no fabricated pages, all items checked by default. */
async function r63TogglePdfPicker(event){
 event?.stopPropagation();
 const picker=document.getElementById('r63PdfPicker'),button=document.getElementById('printReport');
 if(!picker)return;
 if(!picker.hidden){picker.hidden=true;button.setAttribute('aria-expanded','false');return}
 picker.hidden=false;button.setAttribute('aria-expanded','true');
 picker.innerHTML='<p class="r63-pdf-status">正在读取最近截图…</p>';
 let previous=[],warning='';try{previous=await captureStoredFiles()}catch(e){warning='目录截图暂时不可读，仍可使用本次页面截图：'+e.message}
 if(picker.hidden)return;
 const memory=(state.captureItems||[]).filter(x=>x.month===monthKey()).slice().reverse();
 const names=new Set(memory.map(x=>x.filename));
 const captures=[...memory,...previous.filter(x=>!names.has(x.filename))].slice(0,16);
 await Promise.all(captures.map(async x=>{if(!x.thumb)x.thumb=await r63Thumbnail(x.data)}));
 if(picker.hidden)return;
 picker._captures=captures;
 picker.innerHTML='<div class="r63-pdf-header"><strong>最近截图</strong><button type="button" id="r63PdfClose" aria-label="关闭">×</button></div>'+(warning?'<p class="r63-pdf-status">'+escapeNameChar(warning)+'</p>':'')+
  (captures.length?'<div class="r63-pdf-list">'+captures.map((x,i)=>
    '<label class="r63-pdf-row"><input type="checkbox" data-capture-index="'+i+'" checked>'+
    '<img src="'+x.thumb+'" alt=""><span title="'+escapeNameChar(x.filename)+'">'+escapeNameChar(x.filename)+'</span></label>').join('')+'</div>':
   '<p class="r63-pdf-status">暂无截图。先点击旁边的「截图」保存需要的视图。</p>')+
  '<footer><span id="r63PdfCount">'+captures.length+' 张已选</span><button type="button" id="r63PdfExport" '+(captures.length?'':'disabled')+'>导出 PDF</button></footer>';
 picker.querySelector('#r63PdfClose').onclick=()=>{picker.hidden=true;button.setAttribute('aria-expanded','false');document.getElementById('exportMenuButton')?.focus()};
 const sync=()=>{const n=picker.querySelectorAll('input[data-capture-index]:checked').length;
  picker.querySelector('#r63PdfCount').textContent=n+' 张已选';
  picker.querySelector('#r63PdfExport').disabled=!n};
 picker.querySelectorAll('input[data-capture-index]').forEach(x=>x.onchange=sync);
 picker.querySelector('#r63PdfExport').onclick=async()=>{
  const chosen=[...picker.querySelectorAll('input[data-capture-index]:checked')]
   .map(x=>captures[Number(x.dataset.captureIndex)]);
  if(!chosen.length)return;
  const exportBtn=picker.querySelector('#r63PdfExport');exportBtn.disabled=true;exportBtn.textContent='导出中…';
  const success=await captureAllPdf(chosen);
  if(!success){exportBtn.disabled=false;exportBtn.textContent='导出 PDF';return}
  if(picker.isConnected){picker.hidden=true;button.setAttribute('aria-expanded','false')}
 };
}
