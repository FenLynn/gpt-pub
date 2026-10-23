/* Month-scoped datasets, with independent in-memory workspaces and global manual groups. */
function rememberMonth(){
  state.monthStores.set(monthKey(),{
    schemaVersion:P109_DATA_SCHEMA,
    employees:EMPLOYEES.map(e=>({...e})),groups:{...state.groups},fixedPeople:[...(state.fixedPeople||[])],nameAliases:{...(state.nameAliases||{})},groupCatalog:[...(state.groupCatalog||[])],isDemo:!!state.isDemo,
    records:state.records,leaves:state.leaves,trips:state.trips,
    revisions:state.revisions,revisionSeq:state.revisionSeq,
    imports:state.imports,saved:state.saved,outings:state.outings||[],overtimeEntries:state.overtimeEntries||[],manualStatuses:{...(state.manualStatuses||{})},overtimeReview:{...(state.overtimeReview||{})},judgmentMode:state.judgmentMode||'initial',
    rules:{...RULES},prefs:{...state.prefs},importProfile:structuredClone(r62ImportProfile()),
    attendanceReview:{...(state.attendanceReview||{})},tempOutingReview:{...(state.tempOutingReview||{})},manualTempOutings:structuredClone(state.manualTempOutings||[]),manualOvertime:structuredClone(state.manualOvertime||[]),
    calendarOverrides:{...(state.snapshotContext||state.activeBranch?state.calendarOverrides:{}),...p109CalendarMonthValues(YEAR,MONTH,state.calendarOverrides,!state.snapshotContext&&!state.activeBranch)},snapshotContext:!!state.snapshotContext,activeBranch:state.activeBranch?.month===monthKey()?{...state.activeBranch}:null
  });
}
function monthExists(year,month){return state.monthStores.has(year+'-'+pad(month))}
function switchMonth(year,month,create=false,preserveCurrent=true,internal=false){
  if(!internal&&(state.storageBusy||state.importCommitting||p109ConnectionBusy||p109ProjectBusy)){
    toast('正在处理项目文件，请完成后再切换月份',true);return false;
  }
  if(!Number.isInteger(year)||year<2000||year>2100||!Number.isInteger(month)||month<1||month>12)return;
  const key=year+'-'+pad(month);
  if(!state.monthStores.has(key)){
    if(!create){toast('该月份尚未创建，请点击「新建月份」',true);return false}
    const profile=state.projectProfile||{};
    const pinnedPeople=profile.pinRoster&&Array.isArray(profile.employees)?profile.employees:
      state.isDemo?EMPLOYEES:EMPLOYEES.filter(e=>(state.fixedPeople||[]).includes(e.id));
    const pinnedGroups=profile.pinRoster&&profile.groups?profile.groups:state.groups;
    const pinnedFixed=profile.pinRoster?pinnedPeople.map(e=>e.id):
      (state.fixedPeople||[]).filter(id=>pinnedPeople.some(e=>e.id===id));
    const catalog=profile.pinRoster&&Array.isArray(profile.groupCatalog)?
      profile.groupCatalog:(state.groupCatalog||[]);
    const pinnedImport=profile.pinImport&&profile.importProfile?profile.importProfile:r62ImportProfile();
    state.monthStores.set(key,{employees:pinnedPeople.map(e=>({...e})),groups:{...pinnedGroups},fixedPeople:[...pinnedFixed],nameAliases:{...(profile.nameAliases||state.nameAliases||{})},groupCatalog:[...catalog],isDemo:!!state.isDemo,records:[],leaves:[],trips:[],revisions:[],revisionSeq:0,imports:[],saved:false,outings:[],overtimeEntries:[],manualStatuses:{},overtimeReview:{},judgmentMode:'initial',rules:{...(profile.pinRules&&profile.workRules?profile.workRules:RULES)},prefs:{...state.prefs},importProfile:structuredClone(pinnedImport),
     attendanceReview:{},calendarOverrides:{},activeBranch:null});
  }
  if(key!==monthKey()&&preserveCurrent)rememberMonth();
  YEAR=year;MONTH=month;
  const next=state.monthStores.get(key);
  if(Array.isArray(next.employees))EMPLOYEES=next.employees.map(e=>({...e}));
  state.groups=next.groups?{...next.groups}:{...state.groups};
  const historical=!!(next.snapshotContext||next.activeBranch);
  const globalFixed=!historical&&state.projectProfile?.pinRoster?
    (state.projectProfile.fixedPeople||state.projectProfile.employees?.map(e=>e.id)||[]):null;
  state.fixedPeople=[...(globalFixed??next.fixedPeople??[])];
  state.nameAliases=historical?{...(next.nameAliases||{})}:{...(next.nameAliases||{}),...(state.projectProfile?.nameAliases||{})};
  state.groupCatalog=[...((historical?next.groupCatalog:state.projectProfile?.groupCatalog)||next.groupCatalog||
    [...new Set(Object.values(state.groups).filter(g=>g&&g!=='未分组'))])];
  state.isDemo=!!next.isDemo;
  state.records=next.records;state.leaves=next.leaves;state.trips=next.trips;
  state.revisions=next.revisions;state.revisionSeq=next.revisionSeq;
  state.imports=next.imports;state.saved=next.saved;
  state.activeBranch=next.activeBranch||null;
  state.snapshotContext=!!next.snapshotContext;
  state.attendanceReview={...(next.attendanceReview||{})};state.tempOutingReview={...(next.tempOutingReview||{})};state.manualTempOutings=structuredClone(next.manualTempOutings||[]);state.manualOvertime=structuredClone(next.manualOvertime||[]);
  state.outings=next.outings||[];state.overtimeEntries=next.overtimeEntries||[];state.manualStatuses={...(next.manualStatuses||{})};state.overtimeReview={...(next.overtimeReview||{})};state.judgmentMode=next.judgmentMode==='manual'&&hasManualStatuses()?'manual':'initial';
  Object.assign(RULES,P109_DEFAULT_RULES,next.rules||{});
  RULES.overtimeMinMinutes=Math.max(20,Number(RULES.overtimeMinMinutes)||20);
  if(next.rules&&next.rules.graceAmStart==null)RULES.graceAmStart=Number(next.rules.grace??5);
  if(next.rules&&next.rules.gracePmStart==null)RULES.gracePmStart=Number(next.rules.grace??5);
  if(next.rules&&next.rules.graceAmEnd==null)RULES.graceAmEnd=0;
  if(next.rules&&next.rules.gracePmEnd==null)RULES.gracePmEnd=0;
  state.prefs=next.prefs?structuredClone(next.prefs):{fontScale:1,motion:true,arrowsTowardLine:true,appTitle:'考勤'};
  state.importProfile=structuredClone(next.importProfile||{rules:R62_DEFAULT_DIRECTIONS.map(r=>({...r})),templates:{}});
  state.calendarOverrides={...(next.calendarOverrides||{})};
  state.selection={type:'overall'};state.filter='main';state.chartTab='overview';
  state.chartDay=null;state.rawPage=1;state.timelineRange=null;
  reanalyze();render();
  return true;
}
function chooseMonth(year,month){
  if(monthExists(year,month))return switchMonth(year,month);
  if(window.confirm(year+' 年 '+month+' 月尚无数据。\n是否新建该月份的空白工作空间？')){
    return switchMonth(year,month,true);
  }
  return false;
}
function nearestRecordedDay(employeeId){
  const days=state.records.filter(x=>x.employeeId===employeeId&&x.datetime.startsWith(monthKey()+'-'))
    .map(x=>Number(x.datetime.slice(8,10))).filter(d=>d>=1&&d<=monthDays());
  return days.length?Math.max(...days):monthDays();
}
function setPersonGroup(employeeId){
  const e=EMPLOYEES.find(x=>x.id===employeeId);if(!e)return;
  const current=groupOf(e);
  const value=window.prompt('设置 '+e.name+' 的组别（先在名册管理中创建正式组别）',current);
  if(value===null)return;
  const text=value.trim();
  if(text!=='未分组'&&!state.groupCatalog?.includes(text)){toast('请先在名册与分组中创建组别',true);return}
  state.groups[e.id]=text;
  state.saved=false;
  rememberMonth();
  render();
}
function calendarCount(){return monthDays()}
