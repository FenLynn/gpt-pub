/* P109 month-scoped persistence. Raw imports are copied into their month, never rewritten. */
function downloadBlob(blob,name){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),60000);
}
function r62CsvCell(v){
 let s=String(v??'');
 if(typeof v==='string'&&/^[\s\u0000-\u001f]*[=+\-@]/.test(s))s="'"+s;
 return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function p109ExportRows(rows,name){
 if(!rows.length){toast('当前没有可导出数据',true);return false}
 const keys=Object.keys(rows[0]),lines=[keys.map(r62CsvCell).join(','),
  ...rows.map(r=>keys.map(k=>r62CsvCell(r[k])).join(','))];
 downloadBlob(new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}),name);
 toast('已导出 UTF-8 CSV');return true;
}
function downloadCurrentCSV(){
 if(state.workspaceMode==='stats')return asStatExport();
 return p109ExportRows(traditionalRows(),r63FileStem()+'_'+monthKey()+'_每日考勤明细.csv');
}
const P109_IMPORT_TEMPLATES={
 attendance:['考勤记录',['姓名','打卡时间','进出']],
 leave:['请假',['姓名','开始日期','开始时间','结束日期','结束时间','类型','备注']],
 trip:['出差',['姓名','开始日期','结束日期','类型','地点','备注']],
 outing:['外出',['姓名','开始日期','结束日期','开始时间','结束时间','类型','地点','备注']],
 overtime:['登记加班',['姓名','开始日期','开始时间','结束日期','结束时间','类型','备注']]
};
function downloadBlankTemplate(kind){
 const template=P109_IMPORT_TEMPLATES[kind];if(!template)return;
 const [title,columns]=template;
 downloadBlob(P109_TABLES.writeXlsx([Object.fromEntries(columns.map(k=>[k,'']))],title),title+'_空白模板.xlsx');
}
function exportCurrentTable(){
 if(state.workspaceMode!=='stats')return exportTraditionalTable();
 const rows=asStatExportRows();
 if(!rows.length){toast('当前没有可导出统计',true);return}
 downloadBlob(P109_TABLES.writeXlsx(rows,'当前统计'),monthKey()+'_统计_'+asStatPrefs().family+'_'+asStatPrefs().metric+'.xlsx');
 toast('已导出当前统计 XLSX');
}
function downloadAttendance(){downloadBlob(P109_TABLES.writeXlsx(state.records.map(r=>({姓名:r.name,打卡时间:r.datetime,进出:r.direction})),'考勤'),'考勤_'+monthKey()+'.xlsx')}
function downloadLeaves(){downloadBlob(P109_TABLES.writeXlsx(state.leaves.map(r=>({姓名:r.name,开始日期:r.date,开始时间:r.start,结束日期:r.date,结束时间:r.end,类型:r.type,备注:r.note})),'请假'),'请假_'+monthKey()+'.xlsx')}
function downloadTrips(){downloadBlob(P109_TABLES.writeXlsx(state.trips.map(r=>({姓名:r.name,开始日期:r.startDate,结束日期:r.endDate,类型:r.type,地点:r.place,备注:r.note})),'出差'),'出差_'+monthKey()+'.xlsx')}
function downloadOutings(){
 const rows=state.outings.flatMap(r=>Array.from({length:monthDays()},(_,i)=>isoDate(i+1))
  .filter(date=>date>=(r.startDate||r.date)&&date<=(r.endDate||r.date))
  .map(date=>({姓名:r.name,开始日期:date,结束日期:date,开始时间:r.start,结束时间:r.end,类型:r.type,地点:r.place,备注:r.note})));
 if(!rows.length)rows.push({姓名:'',开始日期:'',结束日期:'',开始时间:'',结束时间:'',类型:'',地点:'',备注:''});
 downloadBlob(P109_TABLES.writeXlsx(rows,'外出'),'外出_'+monthKey()+'.xlsx');
}
function downloadOvertimeEntries(){
 const rows=state.overtimeEntries.map(r=>({姓名:r.name,开始日期:r.date,开始时间:r.start,
  结束日期:attendanceDateFromMinute(attendanceUtcMinute(r.date,r.end)+(minutes(r.end)<minutes(r.start)?1440:0)),
  结束时间:minutes(r.end)===1440?'00:00:00':r.end,类型:r.type,备注:r.note}));
 if(!rows.length)rows.push({姓名:'',开始日期:'',开始时间:'',结束日期:'',结束时间:'',类型:'',备注:''});
 downloadBlob(P109_TABLES.writeXlsx(rows,'加班'),'登记加班_'+monthKey()+'.xlsx');
}
function judgmentChinese(k){return ({normal:'正常',anomaly:'异常',absent:'缺勤',rest:'休息'})[k]||k}
function traditionalRows(){
  const rows=[];
  for(const e of (state.workspaceMode==='stats'&&state.statsIncludeIgnored?EMPLOYEES:p109ActivePeople()))for(let d=1;d<=monthDays();d++){
    const a=state.analysis.get(e.id+'|'+d);
    rows.push({姓名:e.name,部门:e.department,组别:groupOf(e),日期:a.date,星期:'周'+weekdayLabel(d),
      日期性质:a.dayType==='work'?'工作日':'休息日',
      状态:a.status,严重度:a.severity==='problem'?'明确问题':a.severity==='suspect'?'疑似异常':a.severity==='excused'?'请假/出差':a.severity==='rest'?'休息':'正常',
      系统判定:judgmentChinese(attendanceJudgmentSystem(a)),人工判定:manualStatusFor(a)?judgmentChinese(manualStatusFor(a)):'',最终判定:judgmentChinese(attendanceJudgment(a)),
      迟到纳入次数:activeAttendanceFlags(a).filter(f=>f.kind==='late').length,早退纳入次数:activeAttendanceFlags(a).filter(f=>f.kind==='early').length,
      迟到早退排除次数:(a.attendanceFlags||[]).filter(f=>!f.accepted).length,
      首次进入:a.firstIn||'',最后离开:a.lastOut||'',确认在岗分钟:Math.round(a.presence||0),
      班内工时分钟:Math.round(a.workMinutes||0),加班候选分钟:Math.round(a.autoOvertime?.minutes||0),
      加班自动纳入分钟:Math.round(activeAutoOvertimeSegments(a).reduce((sum,seg)=>sum+seg.minutes,0)),
      加班自动排除分钟:Math.round((a.autoOvertime?.segments||[]).filter(seg=>seg.accepted===false)
       .reduce((sum,seg)=>sum+seg.minutes,0)),
      午休证据:a.lunchEvidence||'',加班候选说明:a.autoOvertime?.reason||'',
      登记加班记录数:a.overtime?.length||0,
      临时外出次数:activeTemporaryOutings(a).length,临时外出红色次数:activeTemporaryOutings(a).filter(r=>r.status==='red').length,
      临时外出绿色次数:activeTemporaryOutings(a).filter(r=>r.status==='green').length,临时外出班内分钟:behaviorMinutes(a,'tempOuting'),
      手工补录加班分钟:activeAutoOvertimeSegments(a).filter(r=>r.origin==='manual').reduce((sum,r)=>sum+r.minutes,0),
      异常摘要:a.issues.join('；'),业务标记:attendanceBehaviors(a).map(k=>({trip:'出差',leave:'请假',outing:'外出',overtime:'加班',tempOuting:'临时外出'})[k]).join('；'),
      人工处理:(state.revisions.some(r=>r.key===e.id+'|'+d)||!!manualStatusFor(a))?'是':'否'});
  }
  return rows;
}
function exportTraditionalTable(){
  downloadBlob(P109_TABLES.writeXlsx(traditionalRows(),'每日考勤明细'),monthKey()+'_每日考勤明细.xlsx');
  toast('已导出当前月份的考勤明细（含系统、人工及最终判定）');
}
async function dir(root,n){return root.getDirectoryHandle(n,{create:true})}
async function existingDir(root,n){return root.getDirectoryHandle(n,{create:false})}
async function writeFile(handle,name,data){
  const f=await handle.getFileHandle(name,{create:true}),w=await f.createWritable();
  try{await w.write(data);await w.close()}catch(e){try{await w.abort?.()}catch(_){}throw e}
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
  for(const part of ['raw','working','snapshots','output'])await dir(m,part);
  if(!await readJSON(state.projectDir,'project.json'))await writeFile(state.projectDir,'project.json',JSON.stringify(projectPayload(),null,2));
  if(!await readJSON(config,'employees.json'))await writeFile(config,'employees.json',JSON.stringify({schemaVersion:2,employees:EMPLOYEES.map(e=>({...e,group:groupOf(e)}))},null,2));
  if(!await readJSON(config,'work_rules.json'))await writeFile(config,'work_rules.json',JSON.stringify({schemaVersion:1,...RULES},null,2));
  if(!await readJSON(config,'fixed-calendar.json'))await writeFile(config,'fixed-calendar.json',JSON.stringify(p109FixedCalendar,null,2));
  const calendarFile=String(YEAR)+'.json';
  if(!await readJSON(calendar,calendarFile)){
    await writeFile(calendar,calendarFile,JSON.stringify({schemaVersion:1,year:YEAR,overrides:{}},null,2));
  }
}
function normalizeSavedMonth(payload,keepLegacyOvertime=false){
  const schema=payload?.schemaVersion==null?1:Number(payload.schemaVersion);
  if(!payload||!Array.isArray(payload.records)||!Number.isInteger(schema)||schema<1||schema>P109_DATA_SCHEMA)return null;
  if(!p109ValidOvertimeRules(payload.rules))return null;
  if(payload.ignoredPeople!=null&&(!Array.isArray(payload.ignoredPeople)||payload.ignoredPeople.some(id=>typeof id!=='string'||!id)||new Set(payload.ignoredPeople).size!==payload.ignoredPeople.length))return null;
  if(payload.overtimeRuleContexts!=null&&(typeof payload.overtimeRuleContexts!=='object'||Array.isArray(payload.overtimeRuleContexts)||Object.entries(payload.overtimeRuleContexts).some(([key,rules])=>!/^20\d{2}-(0[1-9]|1[0-2])$/.test(key)||!rules||typeof rules!=='object'||!p109ValidOvertimeRules(rules))))return null;
  for(const key of ['employees','leaves','trips','outings','overtimeEntries','imports','revisions','manualTempOutings','manualOvertime'])
    if(payload[key]!=null&&!Array.isArray(payload[key]))return null;
  if(payload.tempOutingReview!=null&&(typeof payload.tempOutingReview!=='object'||Array.isArray(payload.tempOutingReview)))return null;
  if(Object.values(payload.tempOutingReview||{}).some(v=>!['green','red','exclude'].includes(v)))return null;
  if(payload.attendanceReview!=null&&(typeof payload.attendanceReview!=='object'||Array.isArray(payload.attendanceReview)||Object.values(payload.attendanceReview).some(v=>typeof v!=='boolean')))return null;
  for(const field of ['manualTempOutings','manualOvertime']){
    const ids=new Set();
    for(const row of payload[field]||[]){
      if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id)||typeof row.employeeId!=='string'||
        !strictISODate(row.date)||!validClock(row.start)||!validClock(row.end)||minutes(row.start)===minutes(row.end)||
        (field==='manualTempOutings'&&(minutes(row.end)<=minutes(row.start)||(row.part!=null&&!['am','pm'].includes(row.part)))))return null;
      ids.add(row.id);
    }
  }
  payload=r62MigratePayload(p109Clone(payload));
  const prunedManual=p109PruneExcludedManual(payload);
  const rules=payload.rules?p109NormalizeOvertimeRules(payload.rules,keepLegacyOvertime||payload.snapshotContext||payload.branch?.parentSnapshotId):null,
    overtimeRulesMigrated=!!rules&&JSON.stringify(rules)!==JSON.stringify(payload.rules);
  const splitManual=p109SplitManualOutings(payload),calendar=p109CalendarValues(payload.calendarOverrides,payload.year,payload.month,schema<4),
    calendarChanged=JSON.stringify(calendar)!==JSON.stringify(payload.calendarOverrides??null);
  return {schemaVersion:P109_DATA_SCHEMA,ignoredPeople:[...(payload.ignoredPeople||[])],records:payload.records,leaves:payload.leaves||[],trips:payload.trips||[],
    attendanceReview:payload.attendanceReview||{},tempOutingReview:payload.tempOutingReview||{},manualTempOutings:payload.manualTempOutings||[],manualOvertime:payload.manualOvertime||[],
    employees:payload.employees||null,groups:payload.groups||null,overtimeRuleContexts:p109Clone(payload.overtimeRuleContexts||{}),
    fixedPeople:payload.fixedPeople??null,nameAliases:payload.nameAliases||{},groupCatalog:payload.groupCatalog||null,snapshotContext:!!payload.snapshotContext,isDemo:typeof payload.isDemo==='boolean'?payload.isDemo:payload.records.some(r=>String(r.recordId||'').startsWith('demo:')),calendarOverrides:calendar,
    revisions:payload.revisions||[],revisionSeq:payload.revisionSeq||0,imports:payload.imports||[],saved:!prunedManual&&!splitManual&&!calendarChanged&&!overtimeRulesMigrated,overtimeRulesMigrated,outings:payload.outings||[],overtimeEntries:payload.overtimeEntries||[],manualStatuses:payload.manualStatuses||{},overtimeReview:payload.overtimeReview||{},judgmentMode:payload.judgmentMode||'initial',rules,prefs:payload.prefs||null,importProfile:payload.importProfile||null};
}
let p109ConnectionBusy=false;
function p109CaptureSession(){
 return {values:{...state},employees:EMPLOYEES,year:YEAR,month:MONTH,rules:{...RULES},
  navigation:{...asNavHistory,back:[...asNavHistory.back],forward:[...asNavHistory.forward]}};
}
function p109RestoreSession(saved){
 for(const key of Object.keys(state))if(!(key in saved.values))delete state[key];
 Object.assign(state,saved.values);EMPLOYEES=saved.employees;YEAR=saved.year;MONTH=saved.month;
 Object.assign(RULES,saved.rules);Object.assign(asNavHistory,saved.navigation);render();
}
function p109ConfirmProjectSwitch(){
  rememberMonth();
  const dirty=[...state.monthStores].filter(([,m])=>!m.saved&&!m.isDemo).map(([key])=>key);
  if(state.projectDir?.__p109Portable&&state.projectDir.pending&&!dirty.includes(monthKey()))dirty.push(monthKey());
  return !dirty.length||window.confirm('以下月份有未保存内容：'+dirty.join('、')+'。切换项目会放弃这些内存修改；建议取消并先保存。仍要切换？');
}
async function p109OptionalDirectory(root,name){
  try{return await existingDir(root,name)}catch(e){if(e.name==='NotFoundError')return null;throw e}
}
async function p109ReadWorking(folder,key){
  let payload,error;
  try{payload=await readJSON(folder,'state.json')}catch(e){error=e}
  if(Number(payload?.schemaVersion)>P109_DATA_SCHEMA)throw Error(key+' 来自更高数据版本，请先升级软件');
  let normalized=normalizeSavedMonth(payload);
  if(normalized)return {normalized,recovered:false};
  const previous=await readJSON(folder,'state.previous.json');
  normalized=normalizeSavedMonth(previous);
  if(!normalized)throw Error(key+' 的工作状态及备用版本无效'+(error?'：'+error.message:''));
  return {normalized:{...normalized,saved:false},recovered:true};
}
async function p109ReadProject(handle,project){
  if(project.projectId!=='P109-AttendScope')throw Error('所选目录不是有效的考勤项目');
  if(Number(project.schemaVersion)>P109_DATA_SCHEMA)throw Error('这个项目来自更新的数据版本，请先升级软件');
  const active=project.current||{year:YEAR,month:MONTH};
  if(!Number.isInteger(active.year)||active.year<2000||active.year>2100||
    !Number.isInteger(active.month)||active.month<1||active.month>12)throw Error('项目当前年月无效');
  if(project.monthBranches!=null&&(typeof project.monthBranches!=='object'||Array.isArray(project.monthBranches)))throw Error('月份修订索引无效');
  const monthBranches=new Map(Object.entries(project.monthBranches||{}));
  if(project.activeBranch){
    const branch=project.activeBranch,other=monthBranches.get(branch.month);
    if(other&&other.id!==branch.id)throw Error('当前修订与月份修订索引不一致');
    monthBranches.set(branch.month,branch);
  }
  for(const [key,branch] of monthBranches)if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(key)||
    !branch||branch.month!==key||!/^[A-Za-z0-9-]+$/.test(branch.id))throw Error('独立修订引用无效');
  const conf=await p109OptionalDirectory(handle,'config');
  const rules={...((conf?await readJSON(conf,'work_rules.json'):null)||P109_DEFAULT_RULES)};
  const people=(conf?await readJSON(conf,'employees.json'):null)?.employees||[];
  if(!Array.isArray(people))throw Error('项目人员配置无效');
  const profile=conf?await readJSON(conf,'project-profile.json'):null;
  const fixedCalendar=conf?await readJSON(conf,'fixed-calendar.json'):null;
  if(profile&&profile.schemaVersion!==1)throw Error('项目默认配置版本不兼容');
  if(profile?.ignoredPeople!=null&&(!Array.isArray(profile.ignoredPeople)||profile.ignoredPeople.some(id=>typeof id!=='string'||!id)||new Set(profile.ignoredPeople).size!==profile.ignoredPeople.length))throw Error('项目忽略人员名单无效');
  if(profile?.ignoredEmployees!=null&&(!Array.isArray(profile.ignoredEmployees)||profile.ignoredEmployees.some(e=>!e||typeof e.id!=='string'||typeof e.name!=='string')))throw Error('项目忽略人员资料无效');
  const validatedFixedCalendar=fixedCalendar?p109ValidateCalendarBook(fixedCalendar):null;
  const calendar={},months=new Map(),keys=new Set([...(project.months||[]),...monthBranches.keys()]),recovered=[];
  const data=await p109OptionalDirectory(handle,'data');
  if(data)for(const year of await p109Entries(data)){
    if(year.kind!=='directory'||!/^20\d{2}$/.test(year.name))continue;
    const y=await existingDir(data,year.name);
    for(const m of await p109Entries(y))if(m.kind==='directory'&&/^(0[1-9]|1[0-2])$/.test(m.name))keys.add(year.name+'-'+m.name);
  }
  const caldir=conf?await p109OptionalDirectory(conf,'calendar'):null;
  for(const year of new Set([active.year,...[...keys].map(k=>Number(String(k).slice(0,4)))])){
    const cal=caldir?await readJSON(caldir,String(year)+'.json'):null;
    if(cal?.overrides)Object.assign(calendar,cal.overrides);
  }
  for(const key of keys){
    if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(key))throw Error('项目月份索引无效：'+key);
    if(!data)continue;
    const [y,m]=key.split('-'),year=await p109OptionalDirectory(data,y);
    const month=year?await p109OptionalDirectory(year,m):null;
    const folder=month?await p109OptionalDirectory(month,'working'):null;
    if(!folder)continue;
    const result=await p109ReadWorking(folder,key),stored=result.normalized;
    const raw=await readJSON(folder,result.recovered?'state.previous.json':'state.json');
    if(raw.year!=null&&(Number(raw.year)!==Number(y)||Number(raw.month)!==Number(m)))throw Error(key+' 工作状态年月与目录不一致');
    if(!stored.employees)stored.employees=p109Clone(people);
    if(!stored.rules){stored.rules=p109NormalizeOvertimeRules(rules,stored.snapshotContext);if(JSON.stringify(stored.rules)!==JSON.stringify(rules)){stored.saved=false;stored.overtimeRulesMigrated=true}}
    const beforeCalendar=JSON.stringify(stored.calendarOverrides);
    stored.calendarOverrides=p109CalendarValues(stored.calendarOverrides??calendar,y,m,Number(raw.schemaVersion||1)<4);
    if(beforeCalendar!==JSON.stringify(stored.calendarOverrides))stored.saved=false;
    months.set(key,stored);if(result.recovered)recovered.push(key);
  }
  let current=active.year+'-'+pad(active.month);
  if(!months.has(current)){
    const seed={schemaVersion:P109_DATA_SCHEMA,year:active.year,month:active.month,
      employees:people,records:[],leaves:[],trips:[],groups:Object.fromEntries(people.map(e=>[e.id,e.group||'未分组'])),
      calendarOverrides:calendar,rules,isDemo:!!project.notes?.includes('演示')};
    months.set(current,{...normalizeSavedMonth(seed),saved:false});
  }
  for(const branch of monthBranches.values()){
    const [y,m]=branch.month.split('-'),year=await existingDir(data,y),month=await existingDir(year,m),
      branches=await existingDir(month,'branches'),b=await existingDir(branches,branch.id),folder=await existingDir(b,'working');
    const result=await p109ReadWorking(folder,branch.month+' 修订');
    const payload=await readJSON(folder,result.recovered?'state.previous.json':'state.json');
    const [yearNumber,monthNumber]=branch.month.split('-').map(Number);
    if((payload.year!=null&&(Number(payload.year)!==yearNumber||Number(payload.month)!==monthNumber))||
      (payload.branch&&(payload.branch.id!==branch.id||payload.branch.month!==branch.month)))throw Error('修订文件与月份引用不一致');
    months.set(branch.month,{...result.normalized,activeBranch:branch});
    if(result.recovered)recovered.push(branch.month+' 修订');
  }
  if(project.activeBranch)current=project.activeBranch.month;
  return {months,current,profile,calendar,rules,recovered,project,fixedCalendar:validatedFixedCalendar};
}
async function connectProjectDir(savedHandle=null,options={}){
  if(savedHandle?.kind!=='directory')savedHandle=null;
  if(!savedHandle&&!window.showDirectoryPicker){p109ShowStorageFallback('当前浏览器不支持目录读写。可新建便携项目或打开项目 ZIP');return false}
  if(p109ConnectionBusy||p109ProjectBusy||state.storageBusy||r63ReadingImport||r62ImportDraft){toast('请等待当前文件操作完成并关闭导入预览后再切换项目',true);return false}
  p109ConnectionBusy=true;
  try{
    const handle=savedHandle&&savedHandle.kind==='directory'?savedHandle:await showDirectoryPicker({mode:'readwrite'});
    await p109RequireWriteAccess(handle,!options.automatic);
    const project=await readJSON(handle,'project.json');
    if(!project){p109PendingDirectory=handle;await openProjectControl('initialize');return false}
    const loaded=await p109ReadProject(handle,project);
    if(!p109ConfirmProjectSwitch())return false;
    if(r62ImportDraft||r63ReadingImport)throw Error('请先完成或取消当前导入');
    const before=p109CaptureSession();
    try{
      if(loaded.fixedCalendar){
        const merged={...p109FixedCalendar,updatedAt:Math.max(Date.now(),p109FixedCalendar.updatedAt+1),months:{...p109FixedCalendar.months,...loaded.fixedCalendar.months}};
        await p109StoreFixedCalendar(merged);
      }
      Object.assign(state,{projectDir:handle,monthStores:loaded.months,projectProfile:loaded.profile,
        projectIdentity:{projectInstanceId:loaded.project.projectInstanceId||p109UniqueId(),createdAt:loaded.project.createdAt||new Date().toISOString(),lineage:loaded.project.lineage||null},
        calendarOverrides:{},groups:{},fixedPeople:[],nameAliases:{},groupCatalog:[],activeBranch:null,
        prefs:{fontScale:1,motion:true,arrowsTowardLine:true,appTitle:'考勤'},captureItems:[],
        selectedGroup:null,statsGroup:'',statsPersonId:'',statsConfig:null,statsExpandedKey:'',
        scopeSearch:'',attentionOnly:false,rawPopout:false,importProfile:null});
      EMPLOYEES=[];Object.assign(RULES,P109_DEFAULT_RULES);
      const [y,m]=loaded.current.split('-').map(Number);
      if(!switchMonth(y,m,false,false,true))throw Error('无法载入当前月份');
    }catch(e){
      p109RestoreSession(before);throw e;
    }
    p109PendingDirectory=null;p109Audit=null;p109ActivateWorkSession();
    if(typeof p109RememberProject==='function')await p109RememberProject(handle,project.projectName,{explicit:!options.automatic});
    Object.assign(asNavHistory,{back:[],forward:[],current:null,restoring:false});
    Object.assign(r68UI,{chosen:new Set(),fixedChosen:new Set(),search:'',fixedSearch:'',groupFilter:'all',
      latestRoot:null,latestReport:null,latestTree:null,latestScanAt:0});
    r68UI.projectSerial++;r68UI.treeSerial++;if(typeof p109CloseTransfer==='function')p109CloseTransfer();document.getElementById('p109ModeOverlay')?.remove();render();
    const notice=(typeof p109RecentState!=='undefined'&&!p109RecentState.available?'；浏览器未能保存项目历史，下次需重新选择目录':'')+
      ([...loaded.months.values()].some(m=>m.overtimeRulesMigrated)?'；旧规则已更新：出差/请假优先，自动加班按三参数核查，请核查后保存':'');
    toast((loaded.recovered.length?'已连接，使用上一有效版本：'+loaded.recovered.join('、')+'；请检查后保存':'已连接并载入项目')+notice);
    return true;
  }catch(e){if(e.name!=='AbortError')p109ShowStorageFallback('目录连接失败：'+e.message);return false}
  finally{p109ConnectionBusy=false}
}
async function p109RequireWriteAccess(handle,request=true){
 if(!handle||typeof handle.queryPermission!=='function')return true;
 let permission=await handle.queryPermission({mode:'readwrite'});
 if(permission!=='granted'&&request&&typeof handle.requestPermission==='function')
  permission=await handle.requestPermission({mode:'readwrite'});
 if(permission!=='granted')throw new DOMException('项目目录没有读写权限，请重新授权后重试','NotAllowedError');
 return true;
}
async function persistImportedFile(file,type,count,importId){
  const bytes=await file.arrayBuffer();
  const sha256=await p109Digest(bytes);
  const meta={id:importId,type,name:file.name,count,sha256,importedAt:new Date().toISOString()};
  if(state.projectDir){
    const m=await monthDirectory(),raw=await dir(m,'raw'),sub=await dir(raw,type);
    const exists=await existingDir(sub,importId).then(()=>true,e=>e.name==='NotFoundError'?false:Promise.reject(e));
    if(exists)throw new Error('导入目录已存在，拒绝覆盖原始文件');
    const folder=await dir(sub,importId);
    try{await writeFile(folder,file.name,bytes)}catch(e){
      try{if(typeof sub.removeEntry==='function')await sub.removeEntry(importId,{recursive:true})}catch(_){}
      throw e;
    }
  }
  return meta;
}
function projectPayload(){
  rememberMonth();
  if(!state.projectIdentity)state.projectIdentity={projectInstanceId:p109UniqueId(),createdAt:new Date().toISOString(),lineage:null};
  return {schemaVersion:P109_DATA_SCHEMA,projectId:'P109-AttendScope',projectInstanceId:state.projectIdentity.projectInstanceId,
    projectName:attendTitle(),createdAt:state.projectIdentity.createdAt,lineage:state.projectIdentity.lineage||null,appVersion:P109_APP_VERSION,
    analysisEngineVersion:P109_ENGINE_VERSION,current:{year:YEAR,month:MONTH},
    months:[...state.monthStores.keys()].sort(),activeBranch:state.activeBranch||null,
    monthBranches:Object.fromEntries([...state.monthStores].filter(([,m])=>m.activeBranch).map(([key,m])=>[key,m.activeBranch])),
    updatedAt:new Date().toISOString()};
}
function workingPayload(){
  return {schemaVersion:P109_DATA_SCHEMA,context:'working',year:YEAR,month:MONTH,savedAt:new Date().toISOString(),
    ignoredPeople:[...(state.ignoredPeople||[])],
    employees:EMPLOYEES.map(e=>({...e})),isDemo:!!state.isDemo,calendarOverrides:{...(state.snapshotContext||state.activeBranch?state.calendarOverrides:{}),...p109CalendarMonthValues(YEAR,MONTH,state.calendarOverrides,!state.snapshotContext&&!state.activeBranch)},importProfile:r62ImportProfile(),
    records:state.records,leaves:state.leaves,trips:state.trips,
    revisions:state.revisions,revisionSeq:state.revisionSeq,imports:state.imports,
    attendanceReview:{...(state.attendanceReview||{})},tempOutingReview:{...(state.tempOutingReview||{})},manualTempOutings:state.manualTempOutings||[],manualOvertime:state.manualOvertime||[],
    outings:state.outings||[],overtimeEntries:state.overtimeEntries||[],manualStatuses:{...(state.manualStatuses||{})},overtimeReview:{...(state.overtimeReview||{})},judgmentMode:state.judgmentMode||'initial',rules:{...RULES},prefs:{...state.prefs},
    groups:state.groups,fixedPeople:[...(state.fixedPeople||[])],nameAliases:{...(state.nameAliases||{})},groupCatalog:[...(state.groupCatalog||[])],
    // All derived analyses are recalculated from raw facts and manual decisions.
    appVersion:P109_APP_VERSION,analysisEngineVersion:P109_ENGINE_VERSION,snapshotContext:!!state.snapshotContext,overtimeRuleContexts:p109Clone(state.overtimeRuleContexts||{}),branch:state.activeBranch||null};
}
async function saveWorking(options={}){
  if(state.storageBusy||state.importCommitting||p109ConnectionBusy||(p109ProjectBusy&&!options.initializing)){toast('正在处理项目文件，请稍后保存',true);return false}
  if((state.projectDir?.__p109Portable||!state.projectDir&&!state.isDemo)&&!options.initializing)return p109SaveLocalCache();
  state.storageBusy=true;
  try{
  const payload=JSON.stringify(workingPayload(),null,2);
  if(state.projectDir){
    try{
      await ensureProjectSkeleton();
      const m=await monthDirectory();let w;
      if(state.activeBranch?.month===monthKey()){
       const branches=await dir(m,'branches');
       const branch=await existingDir(branches,state.activeBranch.id);
       w=await dir(branch,'working');
      }else w=await dir(m,'working');
      // Keep a verified last-good copy before replacing the working state.
      let old;try{old=await readJSON(w,'state.json')}catch(e){if(e.name!=='SyntaxError')throw e}
      if(normalizeSavedMonth(old))await writeFile(w,'state.previous.json',JSON.stringify(old,null,2));
      await writeFile(w,'state.json',payload);
      const verified=await readJSON(w,'state.json');
      if(!verified||JSON.stringify(verified)!==JSON.stringify(JSON.parse(payload)))
       throw new Error('写入校验失败，保留上一有效版本');
      // Working is authoritative; config files are optional legacy defaults.
      await writeFile(state.projectDir,'project.json',JSON.stringify(projectPayload(),null,2));
      const config=await dir(state.projectDir,'config');
      if(state.projectProfile)await writeFile(config,'project-profile.json',JSON.stringify(state.projectProfile,null,2));
      await writeFile(config,'fixed-calendar.json',JSON.stringify(p109FixedCalendar,null,2));
      const current=workingPayload(),written=JSON.parse(payload);delete current.savedAt;delete written.savedAt;
      state.saved=JSON.stringify(current)===JSON.stringify(written);rememberMonth();
      if(typeof p109CloseTransfer==='function')p109CloseTransfer();render();toast(state.saved?'已保存 '+monthKey()+(state.activeBranch?' 的独立修订副本':' 的工作状态'):'已保存，操作期间的新修改仍需再次保存');return true;
    }catch(e){p109ShowStorageFallback('目录保存失败：'+e.message);return false}
  }
  downloadBlob(new Blob([payload],{type:'application/json'}),r63FileStem()+'_'+monthKey()+'_working.json');
  state.saved=true;rememberMonth();render();toast('已下载当前月份工作状态 JSON');
  return true;
  }finally{state.storageBusy=false}
}
async function restoreWorkingFile(file){
 if(state.storageBusy||state.importCommitting||p109ConnectionBusy||p109ProjectBusy)throw Error('请等待当前项目文件操作完成');
 state.storageBusy=true;
 try{
 let source;try{source=JSON.parse(await file.text())}catch(e){throw new Error('无法解析 JSON，文件可能不完整')}
 const working=source?.working||source;
 const yr=Number(working?.year),mo=Number(working?.month);
 if(!Number.isInteger(yr)||yr<2000||yr>2100||!Number.isInteger(mo)||mo<1||mo>12)
  throw new Error('工作文件缺少有效年月');
 const normalized=normalizeSavedMonth(working,!!source?.working);
 if(!normalized)throw new Error('文件不是有效的考勤工作状态或冻结快照');
 const frozen=!!source?.working;
 if(frozen&&(Number(source.manifest?.year)!==yr||Number(source.manifest?.month)!==mo||
   Number(source.manifest?.schemaVersion)>P109_DATA_SCHEMA))throw Error('冻结元数据与工作状态不一致或版本不兼容');
 if(frozen){normalized.snapshotContext=true;
   if(normalized.calendarOverrides==null)normalized.calendarOverrides=p109CalendarValues(source.config?.calendarOverrides||{},yr,mo,Number(working.schemaVersion||1)<4);
   if(!normalized.rules)normalized.rules=p109NormalizeOvertimeRules(source.config?.rules,true);
 }
 if(normalized.calendarOverrides==null)normalized.calendarOverrides=p109CalendarValues({},yr,mo,Number(working.schemaVersion||1)<4);
 const isolated=!!state.projectDir&&(frozen||!!working.branch);
 if(!window.confirm('将导入 '+yr+' 年 '+mo+' 月'+(isolated?'到独立修订副本，保留主 working 和已有冻结。':'工作状态（包括人工修订），同月未保存内容将被替换。')+'是否继续？'))return false;
 rememberMonth();
 const key=yr+'-'+pad(mo),before=state.monthStores.get(key);
 let branch=null;
 if(isolated){
   const id='B'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
   branch={id,month:key,parentSnapshotId:source.manifest?.snapshotId||working.branch?.parentSnapshotId||null};
   const month=await monthDirectory(yr,mo),branches=await dir(month,'branches');
   if(await p109Child(branches,id))throw Error('修订标识重复，请重试');
   const folder=await dir(branches,id),work=await dir(folder,'working');
   await writeFile(folder,'branch.json',JSON.stringify({schemaVersion:1,...branch,createdAt:new Date().toISOString(),appVersion:P109_APP_VERSION},null,2));
   await writeFile(work,'state.json',JSON.stringify({...working,snapshotContext:frozen,context:'branch',branch},null,2));
 }
 const current={values:{...state},employees:EMPLOYEES,year:YEAR,month:MONTH,rules:{...RULES}};
 state.monthStores.set(key,{...normalized,activeBranch:branch,saved:false});
 try{
  if(!switchMonth(yr,mo,false,false,true))throw new Error('无法打开导入月份');
  state.saved=false;rememberMonth();render();toast('工作状态已恢复，建议检查后保存');
  return true;
 }catch(e){Object.assign(state,current.values);EMPLOYEES=current.employees;YEAR=current.year;MONTH=current.month;Object.assign(RULES,current.rules);
  if(before)state.monthStores.set(key,before);else state.monthStores.delete(key);render();throw e}
 }finally{state.storageBusy=false}
}
async function freezeSnapshot(){
  if(state.storageBusy||state.importCommitting||p109ConnectionBusy||p109ProjectBusy){toast('正在处理项目文件，请稍后冻结',true);return false}
  if(!state.projectDir&&!state.isDemo&&!await p109UsePortable())return false;
  state.storageBusy=true;
  try{
  const id='F'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9),manifest={schemaVersion:P109_DATA_SCHEMA,snapshotId:id,year:YEAR,month:MONTH,createdAt:new Date().toISOString(),
    appVersion:P109_APP_VERSION,sourceImports:state.imports,parentSnapshot:state.activeBranch?.parentSnapshotId||null};
  const calendar=p109CalendarSnapshotValues(),snapshot={manifest:{...manifest,analysisEngineVersion:P109_ENGINE_VERSION,workingSchema:P109_DATA_SCHEMA},config:{
 employees:EMPLOYEES.map(e=>({...e,group:groupOf(e)})),rules:{...RULES},calendarOverrides:calendar
 },working:{...workingPayload(),calendarOverrides:calendar,overtimeRuleContexts:p109OvertimeSnapshotRules()}};
  const txt=JSON.stringify(snapshot,null,2);
  if(state.projectDir){
    try{
      await ensureProjectSkeleton();
      const m=await monthDirectory(), snapshots=await dir(m,'snapshots');
      const already=await existingDir(snapshots,id).then(()=>true,e=>e.name==='NotFoundError'?false:Promise.reject(e));
      if(already)throw new Error('快照编号已存在，拒绝覆盖');
      const folder=await dir(snapshots,id);
      await writeFile(folder,'snapshot.json',txt);
      if(JSON.stringify(await readJSON(folder,'snapshot.json'))!==JSON.stringify(snapshot))throw Error('冻结写入校验失败');
      if(state.projectDir.__p109Portable)render();toast(state.projectDir.__p109Portable?'已生成冻结；请下载新的完整项目包保存':'已冻结 '+monthKey()+' · '+id);return true;
    }catch(e){p109ShowStorageFallback('冻结未完成：'+e.message+'。重新授权后重试，或转为便携项目后重新冻结');return false}
  }
  downloadBlob(new Blob([txt],{type:'application/json'}),r63FileStem()+'_'+monthKey()+'_'+id+'.json');
  toast('已下载不可变冻结快照 '+id);
  return true;
  }finally{state.storageBusy=false}
}
function toast(msg,error=false){
  document.querySelector('.toast')?.remove();const el=document.createElement('div');
  el.className='toast';el.style.background=error?'#b42318':'#1f2937';el.textContent=msg;
  document.body.appendChild(el);setTimeout(()=>el.remove(),3200);
}
const demo=generateMock();
state.records=demo.records;state.leaves=demo.leaves;state.trips=demo.trips;state.outings=demo.outings||[];state.overtimeEntries=demo.overtimeEntries||[];state.manualStatuses={};state.overtimeReview={};state.judgmentMode='initial';
rememberMonth();reanalyze();render();
