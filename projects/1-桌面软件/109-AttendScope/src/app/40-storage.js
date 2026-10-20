/* P109 month-scoped persistence. Raw imports are copied into their month, never rewritten. */
function downloadBlob(blob,name){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),500);
}
function downloadAttendance(){downloadBlob(XLSX.writeXlsx(state.records.map(r=>({姓名:r.name,打卡时间:r.datetime,进出:r.direction})),'考勤'),'考勤_'+monthKey()+'.xlsx')}
function downloadLeaves(){downloadBlob(XLSX.writeXlsx(state.leaves.map(r=>({姓名:r.name,日期:r.date,开始时间:r.start,结束时间:r.end,类型:r.type,备注:r.note})),'请假'),'请假_'+monthKey()+'.xlsx')}
function downloadTrips(){downloadBlob(XLSX.writeXlsx(state.trips.map(r=>({姓名:r.name,开始日期:r.startDate,结束日期:r.endDate,类型:r.type,地点:r.place,备注:r.note})),'出差'),'出差_'+monthKey()+'.xlsx')}
function downloadOutings(){
 const rows=state.outings.map(r=>({姓名:r.name,开始日期:r.startDate||r.date,结束日期:r.endDate||r.date,
  开始时间:r.start,结束时间:r.end,类型:r.type,地点:r.place,备注:r.note}));
 if(!rows.length)rows.push({姓名:'',开始日期:'',结束日期:'',开始时间:'',结束时间:'',类型:'',地点:'',备注:''});
 downloadBlob(XLSX.writeXlsx(rows,'外出'),'外出_'+monthKey()+'.xlsx');
}
function downloadOvertimeEntries(){
 const rows=state.overtimeEntries.map(r=>({姓名:r.name,日期:r.date,开始时间:r.start,结束时间:r.end,类型:r.type,备注:r.note}));
 if(!rows.length)rows.push({姓名:'',日期:'',开始时间:'',结束时间:'',类型:'',备注:''});
 downloadBlob(XLSX.writeXlsx(rows,'加班'),'登记加班_'+monthKey()+'.xlsx');
}
function judgmentChinese(k){return ({normal:'正常',anomaly:'异常',absent:'缺勤',rest:'休息'})[k]||k}
function traditionalRows(){
  const rows=[];
  for(const e of EMPLOYEES)for(let d=1;d<=monthDays();d++){
    const a=state.analysis.get(e.id+'|'+d);
    rows.push({姓名:e.name,部门:e.department,组别:groupOf(e),日期:a.date,星期:'周'+weekdayLabel(d),
      日期性质:a.dayType==='adjust'?'调休工作日':a.dayType==='work'?'工作日':a.dayType==='holiday'?'节假日':'休息日',
      状态:a.status,严重度:a.severity==='problem'?'明确问题':a.severity==='suspect'?'疑似异常':a.severity==='excused'?'请假/出差':a.severity==='rest'?'休息':'正常',
      系统判定:judgmentChinese(attendanceJudgmentSystem(a)),人工判定:manualStatusFor(a)?judgmentChinese(manualStatusFor(a)):'',最终判定:judgmentChinese(manualStatusFor(a)||attendanceJudgmentSystem(a)),
      首次进入:a.firstIn||'',最后离开:a.lastOut||'',确认在岗分钟:Math.round(a.presence||0),
      班内工时分钟:Math.round(a.workMinutes||0),加班候选分钟:Math.round(a.autoOvertime?.minutes||0),
      午休证据:a.lunchEvidence||'',加班候选说明:a.autoOvertime?.reason||'',
      登记加班记录数:a.overtime?.length||0,
      异常摘要:a.issues.join('；'),业务标记:attendanceBehaviors(a).map(k=>({trip:'出差',leave:'请假',outing:'外出',overtime:'加班'})[k]).join('；'),
      人工处理:(state.revisions.some(r=>r.key===e.id+'|'+d)||!!manualStatusFor(a))?'是':'否'});
  }
  return rows;
}
function exportTraditionalTable(){
  downloadBlob(XLSX.writeXlsx(traditionalRows(),'每日考勤明细'),monthKey()+'_每日考勤明细.xlsx');
  toast('已导出当前月份的考勤明细（含系统、人工及最终判定）');
}
async function dir(root,n){return root.getDirectoryHandle(n,{create:true})}
async function existingDir(root,n){return root.getDirectoryHandle(n,{create:false})}
async function writeFile(handle,name,data){
  const f=await handle.getFileHandle(name,{create:true}),w=await f.createWritable();
  await w.write(data);await w.close();
}
async function readJSON(handle,name){
  try{const fh=await handle.getFileHandle(name,{create:false});return JSON.parse(await (await fh.getFile()).text())}
  catch(e){if(e.name==='NotFoundError')return null;throw e}
}
async function monthDirectory(y=YEAR,m=MONTH){
  const data=await dir(state.projectDir,'data'),year=await dir(data,String(y));
  return dir(year,pad(m));
}
async function ensureProjectSkeleton(){
  if(!state.projectDir)return;
  const config=await dir(state.projectDir,'config'),calendar=await dir(config,'calendar');
  const m=await monthDirectory();
  for(const part of ['raw','working','snapshots','branches','output'])await dir(m,part);
  if(!await readJSON(state.projectDir,'project.json'))await writeFile(state.projectDir,'project.json',JSON.stringify(projectPayload(),null,2));
  if(!await readJSON(config,'employees.json'))await writeFile(config,'employees.json',JSON.stringify({schemaVersion:2,employees:EMPLOYEES.map(e=>({...e,group:groupOf(e)}))},null,2));
  if(!await readJSON(config,'work_rules.json'))await writeFile(config,'work_rules.json',JSON.stringify({schemaVersion:1,...RULES},null,2));
  const calendarFile=String(YEAR)+'.json';
  if(!await readJSON(calendar,calendarFile)){
    await writeFile(calendar,calendarFile,JSON.stringify({schemaVersion:1,year:YEAR,overrides:YEAR===2026?
      {'2026-10-01':'holiday','2026-10-02':'holiday','2026-10-03':'holiday','2026-10-04':'holiday','2026-10-05':'holiday','2026-10-06':'holiday','2026-10-07':'holiday','2026-10-10':'adjusted-work'}:{}},null,2));
  }
}
function normalizeSavedMonth(payload){
  if(!payload||!Array.isArray(payload.records))return null;
  return {records:payload.records,leaves:payload.leaves||[],trips:payload.trips||[],
    employees:payload.employees||null,groups:payload.groups||null,isDemo:typeof payload.isDemo==='boolean'?payload.isDemo:payload.records.some(r=>String(r.recordId||'').startsWith('demo:')),calendarOverrides:payload.calendarOverrides||null,
    revisions:payload.revisions||[],revisionSeq:payload.revisionSeq||0,imports:payload.imports||[],saved:true,outings:payload.outings||[],overtimeEntries:payload.overtimeEntries||[],manualStatuses:payload.manualStatuses||{},judgmentMode:payload.judgmentMode||'initial',rules:payload.rules||null,prefs:payload.prefs||null};
}
async function connectProjectDir(){
  if(!window.showDirectoryPicker){toast('当前浏览器不支持目录读写，请使用最新版 Chrome/Edge',true);return}
  try{
    const handle=await showDirectoryPicker({mode:'readwrite'});
    const project=await readJSON(handle,'project.json');
    if(project&&project.projectId!=='P109-AttendScope')throw new Error('所选目录不是 AttendScope 项目，请更换目录，避免覆盖其他数据');
    state.projectDir=handle;
    if(project?.projectId==='P109-AttendScope'){
      const conf=await existingDir(handle,'config').catch(()=>null);
      if(conf){
        const savedRules=await readJSON(conf,'work_rules.json');
        if(savedRules)for(const k of ['amStart','amEnd','pmStart','pmEnd','grace','dupSeconds','overtimeMinMinutes'])if(savedRules[k]!=null)RULES[k]=savedRules[k];
        const caldir=await existingDir(conf,'calendar').catch(()=>null);
        const years=new Set([YEAR,...(project.months||[]).map(k=>Number(String(k).slice(0,4))).filter(Number.isInteger)]);
        for(const yr of years){
          const cal=caldir?await readJSON(caldir,String(yr)+'.json'):null;
          if(cal?.overrides)Object.assign(state.calendarOverrides,cal.overrides);
        }
      }
      if(conf){
        const people=await readJSON(conf,'employees.json');
        if(people?.employees?.length){
          EMPLOYEES=people.employees.map(e=>({id:e.id,name:e.name,department:e.department||'未分类'}));
          for(const e of people.employees)if(e.id&&e.group)state.groups[e.id]=e.group;
        }
      }
      const monthKeys=new Set([...(project.months||[]),monthKey()]);
      for(const key of monthKeys){
        if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(key))continue;
        const [yr,mo]=key.split('-');
        try{
          const data=await existingDir(handle,'data');
          const year=await existingDir(data,yr),month=await existingDir(year,mo);
          const work=await existingDir(month,'working');
          const stored=normalizeSavedMonth(await readJSON(work,'state.json'));
          if(stored)state.monthStores.set(key,stored);
        }catch(e){if(e.name!=='NotFoundError')throw e}
      }
      const active=project.current||{year:YEAR,month:MONTH};
      const key=active.year+'-'+pad(active.month);
      if(state.monthStores.has(key))switchMonth(active.year,active.month,false,false);
    }
    await ensureProjectSkeleton();render();toast(project?'已连接并载入月度工作空间':'已创建项目目录');
  }catch(e){if(e.name!=='AbortError')toast('目录连接失败：'+e.message,true)}
}
async function persistImportedFile(file,type,count,importId){
  const bytes=await file.arrayBuffer();
  let sha256=null;
  if(globalThis.crypto?.subtle){
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    sha256=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  const meta={id:importId,type,name:file.name,count,sha256,importedAt:new Date().toISOString()};
  if(state.projectDir){
    const m=await monthDirectory(),raw=await dir(m,'raw'),sub=await dir(raw,type);
    const exists=await existingDir(sub,importId).then(()=>true,e=>e.name==='NotFoundError'?false:Promise.reject(e));
    if(exists)throw new Error('导入目录已存在，拒绝覆盖原始文件');
    const folder=await dir(sub,importId);
    await writeFile(folder,file.name,bytes);
  }
  state.imports.push(meta);rememberMonth();return meta;
}
function projectPayload(){
  rememberMonth();
  return {schemaVersion:2,projectId:'P109-AttendScope',projectName:'AttendScope',appVersion:'0.1.0-preview',
    analysisEngineVersion:'0.1.0',current:{year:YEAR,month:MONTH},
    months:[...state.monthStores.keys()].sort(),updatedAt:new Date().toISOString()};
}
function workingPayload(){
  return {schemaVersion:2,context:'working',year:YEAR,month:MONTH,savedAt:new Date().toISOString(),
    employees:EMPLOYEES.map(e=>({...e})),isDemo:!!state.isDemo,calendarOverrides:{...state.calendarOverrides},
    records:state.records,leaves:state.leaves,trips:state.trips,
    revisions:state.revisions,revisionSeq:state.revisionSeq,imports:state.imports,
    outings:state.outings||[],overtimeEntries:state.overtimeEntries||[],manualStatuses:{...(state.manualStatuses||{})},judgmentMode:state.judgmentMode||'initial',rules:{...RULES},prefs:{...state.prefs},
    groups:state.groups,
    analysis:[...state.analysis.values()].map(a=>({employeeId:a.employee.id,date:a.date,severity:a.severity,status:a.status,
      firstIn:a.firstIn,lastOut:a.lastOut,presence:a.presence,issues:a.issues,marker:a.marker}))};
}
async function saveWorking(){
  const payload=JSON.stringify(workingPayload(),null,2);
  if(state.projectDir){
    try{
      await ensureProjectSkeleton();
      const m=await monthDirectory(),w=await dir(m,'working');
      await writeFile(w,'state.json',payload);
      const config=await dir(state.projectDir,'config');
      await writeFile(config,'employees.json',JSON.stringify({schemaVersion:2,employees:EMPLOYEES.map(e=>({...e,group:groupOf(e)}))},null,2));
      await writeFile(config,'work_rules.json',JSON.stringify({schemaVersion:1,...RULES},null,2));
      state.saved=true;rememberMonth();
      await writeFile(state.projectDir,'project.json',JSON.stringify(projectPayload(),null,2));
      render();toast('已保存 '+monthKey()+' 的工作状态');return;
    }catch(e){toast('目录保存失败：'+e.message,true);return}
  }
  downloadBlob(new Blob([payload],{type:'application/json'}),'AttendScope_'+monthKey()+'_working.json');
  state.saved=true;rememberMonth();render();toast('已下载当前月份工作状态 JSON');
}
async function freezeSnapshot(){
  const id='F'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9),manifest={schemaVersion:2,snapshotId:id,year:YEAR,month:MONTH,createdAt:new Date().toISOString(),
    appVersion:'0.1.0-preview',sourceImports:state.imports,parentSnapshot:null};
  const snapshot={manifest,config:{employees:EMPLOYEES.map(e=>({...e,group:groupOf(e)})),rules:{...RULES},calendarOverrides:{...state.calendarOverrides}},working:workingPayload()};
  const txt=JSON.stringify(snapshot,null,2);
  if(state.projectDir){
    try{
      await ensureProjectSkeleton();
      const m=await monthDirectory(), snapshots=await dir(m,'snapshots');
      const already=await existingDir(snapshots,id).then(()=>true,e=>e.name==='NotFoundError'?false:Promise.reject(e));
      if(already)throw new Error('快照编号已存在，拒绝覆盖');
      const folder=await dir(snapshots,id);
      await writeFile(folder,'snapshot.json',txt);toast('已冻结 '+monthKey()+' · '+id);return;
    }catch(e){toast('冻结失败：'+e.message,true);return}
  }
  downloadBlob(new Blob([txt],{type:'application/json'}),'AttendScope_'+monthKey()+'_'+id+'.json');
  toast('已下载不可变冻结快照 '+id);
}
function toast(msg,error=false){
  document.querySelector('.toast')?.remove();const el=document.createElement('div');
  el.className='toast';el.style.background=error?'#b42318':'#1f2937';el.textContent=msg;
  document.body.appendChild(el);setTimeout(()=>el.remove(),3200);
}
const demo=generateMock();
state.records=demo.records;state.leaves=demo.leaves;state.trips=demo.trips;state.outings=demo.outings||[];state.overtimeEntries=demo.overtimeEntries||[];state.manualStatuses={};state.judgmentMode='initial';
rememberMonth();reanalyze();render();
