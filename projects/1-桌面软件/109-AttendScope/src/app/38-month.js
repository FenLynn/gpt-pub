/* Month-scoped datasets, with independent in-memory workspaces and global manual groups. */
function rememberMonth(){
  state.monthStores.set(monthKey(),{
    employees:EMPLOYEES.map(e=>({...e})),groups:{...state.groups},isDemo:!!state.isDemo,
    records:state.records,leaves:state.leaves,trips:state.trips,
    revisions:state.revisions,revisionSeq:state.revisionSeq,
    imports:state.imports,saved:state.saved,outings:state.outings||[],overtimeEntries:state.overtimeEntries||[],manualStatuses:{...(state.manualStatuses||{})},overtimeReview:{...(state.overtimeReview||{})},judgmentMode:state.judgmentMode||'initial',
    rules:{...RULES},prefs:{...state.prefs},importProfile:structuredClone(r62ImportProfile()),
    calendarOverrides:{...state.calendarOverrides}
  });
}
function monthExists(year,month){return state.monthStores.has(year+'-'+pad(month))}
function switchMonth(year,month,create=false,preserveCurrent=true){
  if(!Number.isInteger(year)||year<2000||year>2100||!Number.isInteger(month)||month<1||month>12)return;
  const key=year+'-'+pad(month);
  if(!state.monthStores.has(key)){
    if(!create){toast('该月份尚未创建，请点击「新建月份」',true);return false}
    state.monthStores.set(key,{employees:EMPLOYEES.map(e=>({...e})),groups:{...state.groups},isDemo:!!state.isDemo,records:[],leaves:[],trips:[],revisions:[],revisionSeq:0,imports:[],saved:false,outings:[],overtimeEntries:[],manualStatuses:{},overtimeReview:{},judgmentMode:'initial',rules:{...RULES},prefs:{...state.prefs},importProfile:structuredClone(r62ImportProfile()),
     calendarOverrides:{...state.calendarOverrides}});
  }
  if(key!==monthKey()&&preserveCurrent)rememberMonth();
  YEAR=year;MONTH=month;
  const next=state.monthStores.get(key);
  if(Array.isArray(next.employees))EMPLOYEES=next.employees.map(e=>({...e}));
  state.groups=next.groups?{...next.groups}:{...state.groups};state.isDemo=!!next.isDemo;
  state.records=next.records;state.leaves=next.leaves;state.trips=next.trips;
  state.revisions=next.revisions;state.revisionSeq=next.revisionSeq;
  state.imports=next.imports;state.saved=next.saved;
  state.outings=next.outings||[];state.overtimeEntries=next.overtimeEntries||[];state.manualStatuses={...(next.manualStatuses||{})};state.overtimeReview={...(next.overtimeReview||{})};state.judgmentMode=next.judgmentMode==='manual'&&Object.keys(state.manualStatuses).length?'manual':'initial';
  if(next.rules)Object.assign(RULES,next.rules);
  if(next.rules&&next.rules.graceAmStart==null)RULES.graceAmStart=Number(next.rules.grace??5);
  if(next.rules&&next.rules.gracePmStart==null)RULES.gracePmStart=Number(next.rules.grace??5);
  if(next.rules&&next.rules.graceAmEnd==null)RULES.graceAmEnd=0;
  if(next.rules&&next.rules.gracePmEnd==null)RULES.gracePmEnd=0;
  if(next.prefs)state.prefs={...state.prefs,...next.prefs};
  if(next.importProfile)state.importProfile=structuredClone(next.importProfile);
  if(next.calendarOverrides)state.calendarOverrides={...state.calendarOverrides,...next.calendarOverrides};
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
  const value=window.prompt('设置 '+e.name+' 的组别（可输入已有或新组名）',current);
  if(value===null)return;
  const text=value.trim();
  if(!text||text.length>24){toast('组别应为 1–24 个字符',true);return}
  state.groups[e.id]=text;
  state.saved=false;
  rememberMonth();
  render();
}
function calendarCount(){return monthDays()}
