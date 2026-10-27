/* R62 · file preview, editable columns, and deterministic access-direction rules.
 * No raw data changes until the user explicitly confirms this preview. */
const R62_FIELDS={
 attendance:[['name','姓名'],['datetime','日期时间'],['date','日期'],['time','时间'],['direction','进出识别']],
 leave:[['name','姓名'],['startDate','开始日期'],['start','开始时间'],['endDate','结束日期'],['end','结束时间'],['startDatetime','开始日期时间'],['endDatetime','结束日期时间'],['type','类型'],['note','备注']],
 trip:[['name','姓名'],['startDate','开始日期'],['endDate','结束日期'],['type','类型'],['place','地点'],['note','备注']],
 outing:[['name','姓名'],['startDate','开始日期'],['start','开始时间'],['endDate','结束日期'],['end','结束时间'],['startDatetime','开始日期时间'],['endDatetime','结束日期时间'],['dateRange','起止日期'],['timeRange','起止时间'],['type','类型'],['place','地点'],['note','备注']],
 overtime:[['name','姓名'],['startDate','开始日期'],['start','开始时间'],['endDate','结束日期'],['end','结束时间'],['startDatetime','开始日期时间'],['endDatetime','结束日期时间'],['type','类型'],['note','备注']]
};
const R62_ALIASES={
 name:['姓名','员工姓名','人员姓名','人员','员工','name','employee','user'],
 datetime:['打卡时间','刷卡时间','通行时间','日期时间','datetime','timestamp','刷卡日期时间'],
 date:['日期','打卡日期','请假日期','加班日期','date','day'],
 time:['时间','打卡时刻','刷卡时刻','time'],
 direction:['进出','进出方向','通行方向','门禁方向','方向','进出状态','状态','direction','inout'],
 startDate:['开始日期','起始日期','出差开始','startdate','fromdate','日期','请假日期','加班日期','date'],
 endDate:['结束日期','截止日期','终止日期','enddate','todate'],
 startDatetime:['开始日期时间','开始日期及时间','开始日時','开始时间','起始时间','startdatetime','starttimestamp','start'],
 endDatetime:['结束日期时间','结束日期及时间','结束日時','结束时间','截止时间','enddatetime','endtimestamp','end'],
 dateRange:['起止日期','日期范围','开始结束日期','外出日期范围','daterange','dates'],
 timeRange:['起止时间','时间范围','开始结束时间','外出时间范围','timerange','times'],
 start:['开始时间','起始时间','开始时刻','开始','start','starttime','fromtime'],
 end:['结束时间','截止时间','结束时刻','结束','end','endtime','totime'],
 type:['类型','假别','事项','type'],
 place:['地点','目的地','place'],
 note:['备注','说明','note']
};
const R62_DEFAULT_DIRECTIONS=[
 {text:'进',direction:'进',match:'exact'},
 {text:'出',direction:'出',match:'exact'}
];
function normalizedPerson(name){return String(name??'').normalize('NFKC').replace(/\s+/g,' ').trim()}
function personIdentity(name){return 'name:'+encodeURIComponent(normalizedPerson(name))}
function r62MatchDirection(source,rules){
 const v=String(source??'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
 if(!v)return '';
 const matches=(rules||R62_DEFAULT_DIRECTIONS).filter(r=>{
  const text=String(r.text??'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
  return text&&((r.match==='contains')?v.includes(text):v===text);
 }).map(r=>({...r,length:String(r.text).length}));
 if(!matches.length)return '';
 matches.sort((a,b)=>Number(b.match==='exact')-Number(a.match==='exact')||b.length-a.length);
 const strongest=matches.filter(r=>r.match===matches[0].match&&r.length===matches[0].length);
 return new Set(strongest.map(r=>r.direction)).size>1?'ambiguous':strongest[0].direction;
}
function r62Date(v){
 const raw=String(v??'').normalize('NFKC').trim();
 let match=/^(\d{4})(\d{2})(\d{2})$/.exec(raw),date='';
 if(match)date=match[1]+'-'+match[2]+'-'+match[3];
 else if((typeof v==='number'||/^\d{5}(?:\.\d+)?$/.test(raw))&&+v>=36526&&+v<73051)
  date=excelSerialToDateTime(+v).slice(0,10);
 else{
  const text=raw.replace(/[年月/.]/g,'-').replace(/日/g,'');
  match=/^(\d{4})-(\d{1,2})-(\d{1,2})(?=$|[T\s])/.exec(text);
  if(match)date=match[1]+'-'+pad(+match[2])+'-'+pad(+match[3]);
  else{
   match=/^(\d{1,2})-(\d{1,2})-(\d{4})(?=$|[T\s])/.exec(text);
   if(match){
    const a=+match[1],b=+match[2];
    if(a===b||a>12||b>12)date=match[3]+'-'+pad(a>12?b:a)+'-'+pad(a>12?a:b);
   }
  }
 }
 return strictISODate(date)&&+date.slice(0,4)>=2000&&+date.slice(0,4)<=2099?date:'';
}
function r62Time(v,allowEnd=false){
 const raw=String(v??'').normalize('NFKC').trim();
 if(raw==='')return '';
 if((typeof v==='number'||/^(?:[01]|\d*\.\d+|\d{5})$/.test(raw))&&Number.isFinite(+v)){
  if(allowEnd&&+v===1)return '24:00:00';
  if(+v<0||(+v>=1&&+v<36526)||+v>=73051)return '';
  const frac=((+v%1)+1)%1,secs=Math.round(frac*86400)%86400;
  return pad(Math.floor(secs/3600))+':'+pad(Math.floor(secs%3600/60))+':'+pad(secs%60);
 }
 const clock=r62Date(raw)?raw.replace(/^.*?(?:[T\s])(?=(?:上午|下午|AM|PM)?\s*\d{1,2}:)/i,''):raw;
 const m=/^(?:(上午|下午|AM|PM)\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i.exec(clock);
 if(!m)return '';
 let h=+m[2];const meridian=(m[1]||m[5]||'').toUpperCase();
 if(meridian){if(h<1||h>12)return '';h=h%12+(['下午','PM'].includes(meridian)?12:0)}
 const result=pad(h)+':'+m[3]+':'+pad(+(m[4]||0));
 return validClock(result)||(allowEnd&&result==='24:00:00')?result:'';
}
function r62DateTime(datetime,date,time){
 if(datetime!==undefined&&datetime!==null&&String(datetime).trim()!==''){
  const d=r62Date(datetime),t=r62Time(datetime);
  if(d&&t)return d+' '+t;
 }
 const d=r62Date(date),t=r62Time(time);
 return d&&t?d+' '+t:'';
}
function r104DateRange(value){
 const raw=String(value??'').normalize('NFKC').trim(),token='(\\d{8}|\\d{4}[-/.年]\\d{1,2}[-/.月]\\d{1,2}日?)';
 const match=new RegExp('^\\s*'+token+'\\s*(?:至|到|~|～|—|–|-(?=\\s*\\d{4}))\\s*'+token+'\\s*$').exec(raw);
 if(!match)return null;
 const start=r62Date(match[1]),end=r62Date(match[2]);
 return start&&end&&end>=start?{start,end}:null;
}
function r104TimeRange(value){
 const raw=String(value??'').normalize('NFKC').trim(),clock='((?:(?:上午|下午|AM|PM)\\s*)?\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s*(?:AM|PM))?)';
 const match=new RegExp('^\\s*'+clock+'\\s*(?:-|至|到|~|～|—|–)\\s*'+clock+'\\s*$','i').exec(raw);
 if(!match)return null;
 const start=r62Time(match[1]),end=r62Time(match[2],true);
 return start&&end?{start,end}:null;
}
function r62MigratePayload(data){
 if(!data||!Array.isArray(data.employees))return data;
 const translation=new Map(),people=new Map();
 for(const e of data.employees){
  const name=normalizedPerson(e.name);if(!name)continue;
  const id=personIdentity(name);translation.set(e.id,id);
  if(!people.has(id))people.set(id,{...e,id,name});
 }
 data.employees=[...people.values()];
 const change=id=>translation.get(id)||id;
 for(const field of ['records','leaves','trips','outings','overtimeEntries']){
  for(const r of data[field]||[]){
   r.employeeId=change(r.employeeId);
   if(r.name)r.name=normalizedPerson(r.name);
  }
 }
 const groups={};for(const [id,value] of Object.entries(data.groups||{}))groups[change(id)]=value;
 data.groups=groups;
 if(Array.isArray(data.fixedPeople))data.fixedPeople=[...new Set(data.fixedPeople.map(change).filter(id=>people.has(id)))];
 const statuses={};for(const [key,value] of Object.entries(data.manualStatuses||{})){
  const i=key.lastIndexOf('|');
  if(i>=0)statuses[change(key.slice(0,i))+'|'+key.slice(i+1)]=value;
  else statuses[key]=value;
 }data.manualStatuses=statuses;
 const reviews={};for(const [key,value] of Object.entries(data.overtimeReview||{})){
  let next=key;
  for(const [oldId,newId] of translation){
   if(oldId!==newId)next=next.replace('auto-visit:'+oldId+':','auto-visit:'+newId+':')
    .replace('auto:'+oldId+':','auto:'+newId+':');
  }reviews[next]=value;
 }data.overtimeReview=reviews;
 for(const [oldId,newId] of translation)p109RenameIntervalState(data,oldId,newId);
 return data;
}
function r62MigrateActive(){
 const previousPerson=EMPLOYEES.find(e=>e.id===state.selection?.employeeId)?.name||null;
 const data={employees:EMPLOYEES,groups:state.groups,records:state.records,
  leaves:state.leaves,trips:state.trips,outings:state.outings,
  overtimeEntries:state.overtimeEntries,manualStatuses:state.manualStatuses,
  attendanceReview:state.attendanceReview,overtimeReview:state.overtimeReview,tempOutingReview:state.tempOutingReview,
  manualTempOutings:state.manualTempOutings,manualOvertime:state.manualOvertime};
 r62MigratePayload(data);
 EMPLOYEES=data.employees;state.groups=data.groups;
 state.manualStatuses=data.manualStatuses;state.overtimeReview=data.overtimeReview;
 state.attendanceReview=data.attendanceReview;state.tempOutingReview=data.tempOutingReview;
 if(previousPerson)state.selection.employeeId=personIdentity(previousPerson);
}
function r62ImportProfile(){
 if(!state.importProfile)state.importProfile={rules:R62_DEFAULT_DIRECTIONS.map(r=>({...r}))};
 return state.importProfile;
}
const R96_IMPORT_SETTINGS_KEY='p109-import-settings-v1';
const r96ImportSettingsMemory={};
function r96CleanSettings(kind,value){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const mapping={};for(const [key] of R62_FIELDS[kind]){
  const index=value.mapping?.[key];mapping[key]=Number.isInteger(index)&&index>=-1&&index<=4095?index:-1;
 }
 if(kind==='leave'||kind==='overtime')mapping.date=Number.isInteger(value.mapping?.date)?value.mapping.date:-1;
 const result={header:value.header!==false,skip:Math.min(100,Math.max(0,Math.floor(+value.skip)||0)),mapping,
  labels:Array.isArray(value.labels)?value.labels.slice(0,512).map(v=>String(v??'').trim().slice(0,200)):[],
  labelColumns:Array.isArray(value.labelColumns)?[...new Set(value.labelColumns.filter(Number.isInteger).filter(i=>i>=0&&i<=4095))].slice(0,12):[],
  columnCount:Number.isInteger(value.columnCount)?value.columnCount:0,
  encoding:['auto','utf-8','gb18030'].includes(value.encoding)?value.encoding:'auto',
  importMode:value.importMode==='replace'?'replace':'merge',
  dateMode:['split','combined'].includes(value.dateMode)?value.dateMode:mapping.datetime>=0?'combined':'split',
  updatedAt:Number.isFinite(value.updatedAt)?value.updatedAt:0};
 for(const key of ['startMode','endMode'])if(['split','combined'].includes(value[key]))result[key]=value[key];
 if(kind==='outing')result.outingMode=value.outingMode==='range'?'range':'traditional';
 if(kind==='attendance'&&Array.isArray(value.rules))result.rules=value.rules.slice(0,100)
  .filter(r=>r&&typeof r.text==='string'&&r.text.trim()&&['进','出'].includes(r.direction)&&['exact','contains'].includes(r.match))
  .map(r=>({text:r.text.trim().slice(0,120),direction:r.direction,match:r.match}));
 return result;
}
function r96SavedImportSettings(kind){
 let local=null;
 try{
  const raw=localStorage.getItem(R96_IMPORT_SETTINGS_KEY);
  if(raw&&raw.length<1024*1024){const parsed=JSON.parse(raw);if(parsed.schemaVersion===1)local=r96CleanSettings(kind,parsed.templates?.[kind])}
 }catch(_){}
 const candidates=[r96CleanSettings(kind,r62ImportProfile().templates?.[kind]),local,r96ImportSettingsMemory[kind]].filter(Boolean);
 return candidates.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0]||null;
}
function r96SettingsFromDraft(d){
 return r96CleanSettings(d.kind,{...d,columnCount:Math.max(0,...d.grid.rows.slice(0,80).map(r=>r.cells.length)),
  labels:d.header?(d.grid.rows[d.skip]?.cells||[]):[],updatedAt:Date.now()});
}
function r96RememberImport(d,notify=false){
 const value=r96SettingsFromDraft(d);r96ImportSettingsMemory[d.kind]=value;
 let durable=false;
 try{
  let existing={};const raw=localStorage.getItem(R96_IMPORT_SETTINGS_KEY);
  if(raw&&raw.length<1024*1024){try{const parsed=JSON.parse(raw);if(parsed.schemaVersion===1)existing=parsed.templates||{}}catch(_){}}
  const templates={};for(const kind of Object.keys(R62_FIELDS)){
   const clean=r96CleanSettings(kind,existing[kind]);if(clean)templates[kind]=clean;
  }
  Object.assign(templates,r96ImportSettingsMemory);
  localStorage.setItem(R96_IMPORT_SETTINGS_KEY,JSON.stringify({schemaVersion:1,templates}));durable=true;
 }catch(_){}
 d.settingsRetained=true;d.settingsDurable=durable;
 if(notify)toast(durable?'已保留本类导入设置，下次自动使用':'设置仅在当前页面保留；浏览器禁止记忆，导入后请保存项目',!durable);
 return value;
}
function r96RestoreMapping(saved,grid,kind,header,skip){
 const inferred=r62InferColumns({...grid,kind},header,skip);
 if(!saved)return {mapping:inferred,changed:false,reused:false};
 const labels=(grid.rows[skip]?.cells||[]).map(v=>String(v??'').trim()),width=Math.max(0,...grid.rows.slice(0,80).map(r=>r.cells.length));
 if(!header)return saved.columnCount===width?{mapping:{...saved.mapping},changed:false,reused:true}:{mapping:inferred,changed:true,reused:false};
 const same=saved.labels.length===labels.length&&saved.labels.every((v,i)=>v===labels[i]);
 if(same)return {mapping:{...saved.mapping},changed:false,reused:true};
 const mapping={...inferred};
 for(const [key,index] of Object.entries(saved.mapping)){
  if(index<0){if(['type','note','place'].includes(key))mapping[key]=-1;continue}
  const label=saved.labels[index];if(!label)continue;
  const matches=labels.flatMap((v,i)=>v===label?[i]:[]);
  // Reordered or missing columns must never inherit an old numeric position.
  if(matches.length===1)mapping[key]=matches[0];
  else if(matches.length>1)mapping[key]=-1;
 }
 return {mapping,changed:true,reused:false};
}
function r104DefaultLabelColumns(kind,mapping){
 if(!['leave','trip','outing'].includes(kind))return [];
 return [...new Set(['type','place','note'].map(key=>mapping[key]).filter(index=>Number.isInteger(index)&&index>=0))];
}
function r104RestoreLabelColumns(saved,grid,kind,header,skip,mapping){
 const fallback=r104DefaultLabelColumns(kind,mapping),width=Math.max(0,...grid.rows.slice(0,80).map(r=>r.cells.length));
 if(!saved?.labelColumns?.length)return fallback;
 if(!header)return saved.columnCount===width?saved.labelColumns.filter(i=>i<width):fallback;
 const current=(grid.rows[skip]?.cells||[]).map(v=>String(v??'').trim());
 if(saved.labels.length===current.length&&saved.labels.every((v,i)=>v===current[i]))return saved.labelColumns.filter(i=>i<width);
 const restored=[];
 for(const index of saved.labelColumns){
  const name=saved.labels[index];if(!name)continue;
  const matches=current.flatMap((value,i)=>value===name?[i]:[]);if(matches.length===1&&!restored.includes(matches[0]))restored.push(matches[0]);
 }
 return restored.length?restored:fallback;
}
function r96DirectionSummary(d){
 return '<section class="r96-direction-summary"><button type="button" id="r96EditDirections">进出识别规则</button><div class="r96-rule-keywords">'+
  d.rules.map((r,i)=>'<button type="button" data-direction-edit="'+i+'" title="编辑全部进出规则"><span>'+pad(i+1)+'</span><strong>'+r62Esc(r.text)+'</strong></button>').join('')+
  (!d.rules.length?'<button type="button" data-direction-edit="0">添加关键字</button>':'')+'</div></section>';
}
function r96ShowDirectionEditor(selected=0){
 const d=r62ImportDraft,parent=document.querySelector('.r62-overlay');if(!d||d.kind!=='attendance'||!parent)return;
 document.getElementById('r96DirectionOverlay')?.remove();
 const rows=d.rules.map(r=>({...r})),previous=document.activeElement,node=document.createElement('section');
 node.id='r96DirectionOverlay';node.className='r96-direction-overlay';node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.setAttribute('aria-labelledby','r96DirectionTitle');
 node.innerHTML='<form class="r96-direction-dialog"><header><h2 id="r96DirectionTitle">进出识别规则</h2><button type="button" data-rule-close aria-label="关闭进出规则">×</button></header>'+
  '<div class="r96-direction-body"><div class="r96-rule-columns"><span>序号</span><span>关键字</span><span>进出</span><span>匹配</span><span></span></div><div id="r96RuleRows"></div><button type="button" id="r62AddRule">＋ 添加规则</button><p id="r96RuleError" role="alert"></p></div>'+
  '<footer><button type="button" data-rule-close>取消</button><button type="submit" class="primary">应用规则</button></footer></form>';
 parent.inert=true;parent.setAttribute('aria-hidden','true');document.body.appendChild(node);
 const error=node.querySelector('#r96RuleError');
 const renderRows=()=>{
  node.querySelector('#r96RuleRows').innerHTML=rows.map((r,i)=>'<div class="r96-rule-row"><span>'+pad(i+1)+'</span>'+
   '<input data-rule="'+i+'" data-part="text" aria-label="规则'+(i+1)+'关键字" maxlength="120" value="'+r62Esc(r.text)+'">'+
   '<select data-rule="'+i+'" data-part="direction" aria-label="规则'+(i+1)+'进出">'+['进','出'].map(v=>'<option '+(r.direction===v?'selected':'')+'>'+v+'</option>').join('')+'</select>'+
   '<select data-rule="'+i+'" data-part="match" aria-label="规则'+(i+1)+'匹配"><option value="exact" '+(r.match==='exact'?'selected':'')+'>完全匹配</option><option value="contains" '+(r.match==='contains'?'selected':'')+'>包含关键字</option></select>'+
   '<button type="button" data-rule-remove="'+i+'" aria-label="删除规则'+(i+1)+'">×</button></div>').join('');
  node.querySelectorAll('[data-rule]').forEach(el=>el.oninput=()=>{rows[+el.dataset.rule][el.dataset.part]=el.value;error.textContent=''});
  node.querySelectorAll('[data-rule-remove]').forEach(el=>el.onclick=()=>{rows.splice(+el.dataset.ruleRemove,1);renderRows();error.textContent='';node.querySelector('#r62AddRule').focus()});
 };
 const close=(apply=false)=>{
  node.remove();parent.inert=false;parent.removeAttribute('aria-hidden');
  if(apply){r96RememberImport(d);r62ShowImport();document.querySelector('#r96EditDirections')?.focus({preventScroll:true})}
  else if(previous?.isConnected)previous.focus({preventScroll:true});
 };
 node.querySelectorAll('[data-rule-close]').forEach(b=>b.onclick=()=>close());
 node.querySelector('#r62AddRule').onclick=()=>{if(rows.length>=100){error.textContent='最多保留100条规则';return}rows.push({text:'',direction:'进',match:'exact'});renderRows();node.querySelector('[data-rule="'+(rows.length-1)+'"][data-part="text"]').focus()};
 node.querySelector('form').onsubmit=e=>{
  e.preventDefault();const seen=new Map();
  for(let i=0;i<rows.length;i++){
   const r=rows[i],text=r.text.normalize('NFKC').replace(/\s+/g,'').toLowerCase(),key=r.match+'|'+text;
   if(!text){error.textContent='第'+(i+1)+'条关键字不能为空';return}
   if(seen.has(key)){error.textContent='第'+(i+1)+'条与第'+seen.get(key)+'条关键字重复，请合并后应用';return}seen.set(key,i+1);
  }
  d.rules=rows.map(r=>({...r,text:r.text.trim()}));close(true);
 };
 node.onclick=e=>{if(e.target===node)close()};
 node.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}else p109TrapDialogFocus(e,node)};
 renderRows();(node.querySelector('[data-rule="'+selected+'"][data-part="text"]')||node.querySelector('#r62AddRule')).focus();
}
let r62ImportDraft=null;
function r62ColumnLabel(index){let s='';for(let i=index+1;i>0;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s}
function r62InferColumns(grid,headerRow,skip=0){
 const rows=grid.rows||[],width=Math.max(0,...rows.slice(0,40).map(r=>r.cells.length));
 const headers=headerRow?rows[skip]?.cells||[]:[];
 const scores={},result={};
 for(const [field] of R62_FIELDS[grid.kind]){
  const terms=R62_ALIASES[field]||[];
  const ranked=Array.from({length:width},(_,col)=>{
   const word=String(headers[col]??'').normalize('NFKC').toLowerCase().replace(/[\s_()]/g,'');
   let score=terms.some(x=>word===x.toLowerCase())?100:terms.some(x=>word.includes(x.toLowerCase()))?55:0;
   const samples=rows.slice(skip+(headerRow?1:0),skip+18).map(x=>x.cells[col]);
   if(['datetime','startDatetime','endDatetime'].includes(field)){
    const complete=samples.filter(v=>r62Date(v)&&r62Time(v)).length;
    score+=complete*2;
    if(field!=='datetime'&&!complete)score=0;
    const dateField={startDatetime:'startDate',endDatetime:'endDate'}[field];
    if(dateField&&R62_ALIASES[dateField].some(v=>v.toLowerCase()===word))score=0;
   }
   if(field==='date'||field==='startDate'||field==='endDate')score+=samples.filter(v=>r62Date(v)).length;
   if(['start','end','time'].includes(field))score+=samples.filter(v=>r62Time(v)).length;
   if(field==='dateRange')score+=samples.filter(v=>r104DateRange(v)).length*2;
   if(field==='timeRange')score+=samples.filter(v=>r104TimeRange(v)).length*2;
   if(field==='name')score+=samples.filter(v=>typeof v==='string'&&
     normalizedPerson(v)&&!r62Date(v)&&!r62Time(v)).length*.5;
   if(field==='direction')score+=samples.filter(v=>r62MatchDirection(v,r62ImportProfile().rules)&&
      r62MatchDirection(v,r62ImportProfile().rules)!=='ambiguous').length*2;
   return {col,score};
  }).sort((a,b)=>b.score-a.score);
  scores[field]=ranked;
  result[field]=ranked[0]?.score>0?ranked[0].col:-1;
 }
 // Explicit split-date headers win over sampled numeric serial guesses.
 if(grid.kind==='attendance'&&result.date>=0&&result.time>=0&&
  scores.date[0]?.score>=100&&scores.time[0]?.score>=100&&scores.datetime[0]?.score<100)result.datetime=-1;
 // Never silently map two mandatory fields to the same source column.
 const used=new Set();
 for(const field of ['name','datetime','date','time','direction','dateRange','timeRange','startDate','endDate'].filter(k=>scores[k])
  .sort((a,b)=>(scores[b][0]?.score||0)-(scores[a][0]?.score||0))){
  const index=result[field];if(index<0)continue;
  if(used.has(index))result[field]=-1;else used.add(index);
 }
 // Combined endpoints need their own directional header, not just a plausible date sample.
 for(const field of ['startDatetime','endDatetime'])if((scores[field]?.[0]?.score||0)<55)result[field]=-1;
 if(grid.kind!=='attendance'&&grid.kind!=='trip'){
  if(result.startDatetime>=0&&result.startDate===result.startDatetime)result.startDate=-1;
  if(result.endDatetime>=0&&result.endDate===result.endDatetime)result.endDate=-1;
 }
 return result;
}
function r95ImportModes(d){
 if(!['leave','outing','overtime'].includes(d.kind))return;
 if((d.mapping.startDate==null||d.mapping.startDate<0)&&d.mapping.date>=0)d.mapping.startDate=d.mapping.date;
 for(const key of ['startDate','endDate','startDatetime','endDatetime','start','end'])if(d.mapping[key]==null)d.mapping[key]=-1;
 d.startMode=d.startMode||(d.mapping.startDatetime>=0?'combined':'split');
 d.endMode=d.endMode||(d.mapping.endDatetime>=0?'combined':'split');
 if(d.kind==='outing')d.outingMode=d.outingMode||(d.mapping.dateRange>=0&&d.mapping.timeRange>=0?'range':'traditional');
}
function r95ImportValue(d,cells,key){
 const value=d.mapping[key]>=0?cells[d.mapping[key]]:'';
 return d.grid.date1904&&typeof value==='number'&&value>=1&&
  ['datetime','date','startDate','endDate','startDatetime','endDatetime'].includes(key)?value+1462:value;
}
function r62Esc(s){return escapeNameChar(String(s??''))}
function p109TrapDialogFocus(event,root){
 if(event.key!=='Tab')return;
 const nodes=[...root.querySelectorAll('button,input,textarea,select,summary,[tabindex="0"]')]
  .filter(el=>!el.disabled&&!el.hidden&&el.getClientRects().length),first=nodes[0],last=nodes.at(-1);
 if(!first)return;
 if(event.shiftKey&&(document.activeElement===first||!root.contains(document.activeElement))){event.preventDefault();last.focus()}
 else if(!event.shiftKey&&(document.activeElement===last||!root.contains(document.activeElement))){event.preventDefault();first.focus()}
}
function r79SourcePeriod(){
 const d=r62ImportDraft,dates=[],counts=new Map();let intersectsTarget=false;
 if(d.kind==='outing'&&d.outingMode==='range'){
  const col=d.mapping.dateRange,first=d.skip+(d.header?1:0);
  if(col>=0)for(const row of d.grid.rows.filter(row=>(row.sourceIndex??d.grid.rows.indexOf(row))>=first)){
   const range=r104DateRange(r95ImportValue(d,row.cells,'dateRange'));if(!range)continue;
   dates.push(range.start,range.end);for(const date of [range.start,range.end])counts.set(date.slice(0,7),(counts.get(date.slice(0,7))||0)+1);
   if(range.start<=d.targetMonth+'-31'&&range.end>=d.targetMonth+'-01')intersectsTarget=true;
  }
  dates.sort();return {first:dates[0]||'',last:dates.at(-1)||'',main:intersectsTarget?d.targetMonth:[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0]||''};
 }
 const field=d.kind==='attendance'?(d.mapping.datetime>=0?'datetime':'date'):
  d.startMode==='combined'?'startDatetime':d.mapping.startDate>=0?'startDate':'date';
 const col=d.mapping[field];
 const first=d.skip+(d.header?1:0);
 if(col>=0)for(const row of d.grid.rows.filter(row=>(row.sourceIndex??d.grid.rows.indexOf(row))>=first)){
  const date=r62Date(r95ImportValue(d,row.cells,field));if(!strictISODate(date))continue;
  dates.push(date);const key=date.slice(0,7);counts.set(key,(counts.get(key)||0)+1);
  const endField=d.endMode==='combined'?'endDatetime':'endDate',end=r62Date(r95ImportValue(d,row.cells,endField));
  if(end)dates.push(end);
  if(d.kind!=='attendance'&&date<=d.targetMonth+'-31'&&(end||date)>=d.targetMonth+'-01')intersectsTarget=true;
 }
 dates.sort();return {first:dates[0]||'',last:dates.at(-1)||'',
  main:intersectsTarget?d.targetMonth:[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0]||''};
}
function r62PreviewHtml(){
 const d=r62ImportDraft;if(!d)return '';
 r95ImportModes(d);
 const width=Math.max(0,...d.grid.rows.slice(0,80).map(r=>r.cells.length));
 const dataStart=d.skip+(d.header?1:0),cols=Array.from({length:width},(_,i)=>i),source=r79SourcePeriod();
 const label=i=>r62ColumnLabel(i)+' · '+r62Esc(d.header?d.grid.rows[d.skip]?.cells[i]??'':'列 '+(i+1));
 const interval=['leave','outing','overtime'].includes(d.kind);
 const required=key=>['name','datetime','date','time','startDate','startDatetime','endDatetime'].includes(key)||
  (d.kind==='outing'&&d.outingMode==='range'&&['dateRange','timeRange'].includes(key))||
  (['start','end'].includes(key)&&['outing','overtime'].includes(d.kind)&&d.outingMode!=='range');
 const select=(key,title,display=title)=>'<label class="r62-field"><span>'+display+(required(key)?' <b class="r80-required" title="必填">*</b>':'')+'</span><select aria-label="'+title+'" data-map="'+key+'"><option value="-1" '+(d.mapping[key]<0?'selected':'')+'>'+
  (required(key)?'请选择':d.kind==='leave'&&['start','end'].includes(key)?'无（使用班次'+(key==='start'?'开始':'结束')+'）':key==='endDate'?'无（同开始日期）':'无')+'</option>'+
  cols.map(i=>'<option value="'+i+'" '+(d.mapping[key]===i?'selected':'')+'>'+label(i)+'</option>').join('')+'</select></label>';
 const fields=d.kind==='attendance'?[['name','姓名'],...(d.dateMode==='split'?[['date','日期'],['time','时间']]:[['datetime','打卡时间']]),['direction','进出']]:R62_FIELDS[d.kind];
 const endpoint=side=>'<section class="r95-endpoint"><div><h4>'+(side==='start'?'开始':'结束')+'</h4><select data-endpoint="'+side+'" aria-label="'+(side==='start'?'开始':'结束')+'格式"><option value="split" '+(d[side+'Mode']==='split'?'selected':'')+'>日期 / 时间分列</option><option value="combined" '+(d[side+'Mode']==='combined'?'selected':'')+'>日期时间同列</option></select></div><div class="r62-mapping">'+
  (d[side+'Mode']==='combined'?select(side+'Datetime',(side==='start'?'开始':'结束')+'日期时间','日期时间'):
   select(side+'Date',(side==='start'?'开始':'结束')+'日期')+select(side,(side==='start'?'开始':'结束')+'时间'))+'</div></section>';
 const outingRange=d.kind==='outing'&&d.outingMode==='range';
 const mapping=interval?'<div class="r62-mapping">'+select('name','姓名')+select('type','类型')+'</div>'+(
  outingRange?'<section class="r95-endpoint r104-range-fields"><div><h4>时间范围</h4></div><div class="r62-mapping">'+select('dateRange','起止日期')+select('timeRange','起止时间')+'</div></section>':endpoint('start')+endpoint('end'))+
  '<div class="r62-mapping">'+(d.kind==='outing'?select('place','地点'):'')+select('note','备注')+'</div>':
  '<div class="r62-mapping">'+fields.map(([key,title])=>select(key,title)).join('')+'</div>';
 const labelConfig=['leave','trip','outing'].includes(d.kind)?(()=>{
  const chosen=d.labelColumns||[],available=cols.filter(i=>!chosen.includes(i));
  return '<section class="r104-label-config"><div class="r104-label-head"><strong>轨道标签</strong><select id="r104LabelAdd" aria-label="添加轨道标签列"><option value="">添加字段…</option>'+available.map(i=>'<option value="'+i+'">'+label(i)+'</option>').join('')+'</select></div><div class="r104-label-list">'+
   (chosen.length?chosen.map((i,pos)=>'<div><span title="'+label(i)+'">'+label(i)+'</span><button type="button" data-label-move="up" data-label-pos="'+pos+'" '+(!pos?'disabled':'')+' aria-label="上移">↑</button><button type="button" data-label-move="down" data-label-pos="'+pos+'" '+(pos===chosen.length-1?'disabled':'')+' aria-label="下移">↓</button><button type="button" data-label-remove="'+pos+'" aria-label="移除">×</button></div>').join(''):'<p>不显示文字标签</p>')+
   '</div></section>';
 })():'';
 const manySheets=(d.grid.selectedSheets||[]).length>1;
 const rowAt=r=>manySheets?r.sheet+'!'+r.rowNumber:r.rowNumber;
 const preview=d.grid.rows.slice(0,25).map(r=>{
  const index=r.sourceIndex??d.grid.rows.indexOf(r),hidden=index<dataStart,head=d.header&&index===d.skip;
  return '<tr class="'+(hidden?'r62-skipped ':'')+(head?'r62-header':'')+'"><th>'+r62Esc(rowAt(r))+(head?' · 表头':hidden?' · 跳过':'')+'</th>'+
   cols.map(c=>'<td title="'+r62Esc(r.cells[c])+'">'+r62Esc(r.cells[c])+'</td>').join('')+'</tr>';
 }).join('');
 const title={attendance:'考勤记录',leave:'请假',trip:'出差',outing:'外出',overtime:'登记加班'}[d.kind];
 return '<section class="r62-overlay" role="dialog" aria-modal="true" aria-labelledby="r62Title"><div class="r62-dialog r95-dialog">'+
  '<header><div class="r95-import-heading"><strong id="r62Title">导入'+title+'</strong><p class="r79-import-file" title="'+r62Esc(d.file.name)+'">'+r62Esc(d.file.name)+'</p></div>'+
  '<div class="r79-import-context"><label>导入月份<input id="r79ImportMonth" aria-label="导入月份" type="month" min="2000-01" max="2099-12" value="'+d.targetMonth+'"></label>'+
  (d.grid.sheets?.length>1?'<label>工作表<select id="r100Sheet" aria-label="工作表">'+d.grid.sheets.map(sheet=>'<option value="'+r62Esc(sheet.name)+'" '+(d.grid.sheetChoice===sheet.name?'selected':'')+' '+(sheet.empty?'disabled':'')+'>'+r62Esc(sheet.name)+(sheet.empty?' · 空表':' · '+sheet.rows+' 行')+'</option>').join('')+(d.grid.sheets.filter(sheet=>!sheet.empty).length>1?'<option value="__all__" '+(d.grid.sheetChoice==='__all__'?'selected':'')+'>合并全部非空表</option>':'')+'</select></label>':'')+
  '<div class="r79-source-period">文件日期<b>'+r62Esc(source.first?(source.first===source.last?source.first:source.first+' 至 '+source.last):'待识别')+'</b></div>'+
  (source.main&&source.main!==d.targetMonth?'<button type="button" id="r79UseFileMonth" data-month="'+source.main+'">改为 '+source.main+'</button>':'')+'</div><div class="r96-import-actions"><button type="button" id="r96KeepImport" title="本类设置自动记忆；也可立即保留，不导入数据">保留导入设置</button><button id="r62Close" aria-label="关闭导入">×</button></div></header>'+
  (r80ImportQueue?'<div class="r80-import-queue">文件 '+(r80ImportQueue.index+1)+' / '+r80ImportQueue.files.length+' · 逐个核对并合并<button id="r80SkipFile" type="button">跳过此文件</button></div>':'')+
  '<div class="r62-body">'+
  '<div class="r95-import-layout"><div class="r95-import-fields"><div class="r79-import-section-head"><h3>字段对应</h3>'+(d.kind==='attendance'?'<label>时间格式<select id="r79DateMode" aria-label="时间格式"><option value="combined" '+(d.dateMode!=='split'?'selected':'')+'>日期时间在同一列</option><option value="split" '+(d.dateMode==='split'?'selected':'')+'>日期、时间分列</option></select></label>':d.kind==='outing'?'<label>外出格式<select id="r104OutingMode" aria-label="外出时间格式"><option value="traditional" '+(d.outingMode!=='range'?'selected':'')+'>传统起止字段</option><option value="range" '+(d.outingMode==='range'?'selected':'')+'>起止日期 + 起止时间</option></select></label>':'')+'</div>'+
  (d.mappingChanged?'<p class="r96-columns-changed">列结构已变化，请核对字段</p>':'')+mapping+
  (d.kind==='attendance'&&d.mapping.direction<0?'<p class="r80-mapping-hint">未提供进出方向的打卡将标为待核。</p>':'')+
  (d.kind==='attendance'?r96DirectionSummary(d):'')+labelConfig+
  '<details id="r79Advanced" class="r79-import-advanced" '+(d.advanced?'open':'')+'><summary>更多选项</summary><div class="r62-options">'+
  '<label>导入方式<select id="r80ImportMode"><option value="merge" '+(d.importMode!=='replace'?'selected':'')+'>合并到已有数据</option><option value="replace" '+(d.importMode==='replace'?'selected':'')+'>替换本月此类数据</option></select></label>'+
  '<label><input type="checkbox" id="r62Header" '+(d.header?'checked':'')+'> 首行为表头</label><label>跳过开头 <input id="r62Skip" type="number" min="0" max="100" value="'+d.skip+'"> 行</label>'+
  (d.file.name.toLowerCase().endsWith('.csv')?'<label>编码<select id="r62Encoding">'+[['auto','自动'],['utf-8','UTF-8'],['gb18030','GB18030/GBK']].map(([v,t])=>'<option value="'+v+'" '+(d.encoding===v?'selected':'')+'>'+t+'</option>').join('')+'</select></label>':'')+
  '</div></details>'+
  '</div><div class="r95-import-preview"><div class="r79-import-section-head"><h3>数据预览</h3><div class="r95-preview-tabs"><button type="button" data-preview="parsed" aria-pressed="'+(d.preview!=='raw')+'">识别结果</button><button type="button" data-preview="raw" aria-pressed="'+(d.preview==='raw')+'">原始表格</button></div></div>'+
  (d.kind==='trip'?'<p class="r95-import-note">出差按整天，结束日期当天也计入。</p>':interval?'<p class="r95-import-note">跨日连续计算 · 跨月只导入所选月的部分</p>':'')+
  '<div id="r95ParsedPreview" class="r62-grid-wrap" '+(d.preview==='raw'?'hidden':'')+'></div><div id="r95RawPreview" class="r62-grid-wrap" '+(d.preview!=='raw'?'hidden':'')+'><table><thead><tr><th>原始行号</th>'+cols.map(i=>'<th>'+r62ColumnLabel(i)+'</th>').join('')+'</tr></thead><tbody>'+preview+'</tbody></table></div>'+
  '<div id="r79ImportErrors"></div></div></div></div><footer><div id="r62Validation" class="r62-validation" role="status" aria-live="polite"></div>'+
  '<div class="r79-import-buttons"><button id="r62Validate">重新检查</button><button id="r62Cancel">取消</button><button id="r62Commit" disabled>确认导入</button></div></footer></div></section>';
}
function r62BuildCanonical(){
 const d=r62ImportDraft,rows=d.grid.rows,first=d.skip+(d.header?1:0),mapped=[],fail=[];
 r95ImportModes(d);
 let period;try{period=p109ImportPeriod(d.targetMonth||monthKey())}catch(e){return {rows:[],failed:[{row:'—',reason:e.message}],scanned:0}};
 const val=(cells,key)=>r95ImportValue(d,cells,key);
 const selected=d.grid.selectedSheets||[d.grid.sheet],primary=selected[0],headerFor=sheet=>rows.find(row=>row.sheet===sheet&&(row.sourceIndex??0)===d.skip)?.cells.map(value=>String(value??'').trim())||[];
 const expected=d.header?headerFor(primary):[],compatible=new Set(selected);
 if(d.header)for(const sheet of selected.slice(1))if(JSON.stringify(headerFor(sheet))!==JSON.stringify(expected)){
  compatible.delete(sheet);fail.push({row:sheet,reason:'表头与 '+primary+' 不一致，请单独选择此工作表导入'});
 }
 for(let i=0;i<rows.length;i++){
  const r=rows[i],c=r.cells,name=normalizedPerson(val(c,'name'));
  if(!compatible.has(r.sheet||primary)||(r.sourceIndex??i)<first)continue;
  if(!c.some(x=>String(x??'').trim()!==''))continue;
  const base={姓名:name,__rowNumber:r.rowNumber,__sheet:r.sheet||primary};
  let reason='';
  if(!name)reason='姓名为空';
  if(d.kind==='attendance'){
   const dt=r62DateTime(val(c,'datetime'),val(c,'date'),val(c,'time'));
   const rawDirection=val(c,'direction'),direction=d.mapping.direction<0||!String(rawDirection??'').trim()||String(rawDirection).trim()==='未标注'?'未标注':r62MatchDirection(rawDirection,d.rules);
   if(!strictDateTime(dt))reason=reason||'日期时间格式错误';
   if(!['进','出','未标注'].includes(direction))reason=reason||('进出无法明确识别：'+String(val(c,'direction')).slice(0,35));
   Object.assign(base,{打卡时间:dt,进出:direction});
  }else if(d.kind==='trip'){
   Object.assign(base,{开始日期:val(c,'startDate'),结束日期:val(c,'endDate')});
  }else if(d.kind==='outing'&&d.outingMode==='range'){
   const dates=r104DateRange(val(c,'dateRange')),times=r104TimeRange(val(c,'timeRange'));
   if(!dates)reason=reason||'起止日期格式错误，请使用 2026-09-06-2026-09-06';
   if(!times)reason=reason||'起止时间格式错误，请使用 09:30-10:40';
   if(dates&&times)Object.assign(base,{开始日期:dates.start,开始时间:times.start,结束日期:dates.end,结束时间:times.end});
  }else{
   for(const side of ['start','end']){
    const title=side==='start'?'开始':'结束';
    if(d[side+'Mode']==='combined')base[title+'日期时间']=val(c,side+'Datetime');
    else{base[title+'日期']=val(c,side+'Date');base[title+'时间']=val(c,side)}
   }
  }
  if(d.kind!=='attendance')Object.assign(base,{类型:String(val(c,'type')||''),地点:String(val(c,'place')||''),备注:String(val(c,'note')||''),
   __labelParts:(d.labelColumns||[]).map(index=>String(c[index]??'').normalize('NFKC').trim()).filter(Boolean).slice(0,12)});
  if(!reason)try{p109ParseBusinessRow(d.kind,base,i,period)}catch(e){reason=e.message}
  if(reason)fail.push({row:(selected.length>1?(r.sheet+'!'):'')+r.rowNumber,reason});else mapped.push(base);
 }
 return {rows:mapped,failed:fail,scanned:rows.filter(row=>compatible.has(row.sheet||primary)&&(row.sourceIndex??0)>=first).length};
}
function r79ValidateImport(){
 const d=r62ImportDraft,modal=document.querySelector('.r62-overlay');if(!d||!modal)return;
 const result=r62BuildCanonical();d.validated=result;
 const parsed=result.rows.length?p109ParseImportTable(d.kind,{rows:result.rows},p109ImportPeriod(d.targetMonth||monthKey())):{rows:[]};
 const headings=d.kind==='attendance'?['姓名','打卡时间','进出']:d.kind==='trip'?['姓名','开始日期','结束日期','类型']:['姓名','开始日期时间','结束日期时间','类型'];
 const previewRows=result.rows.slice(0,25).map((row,index)=>{
  const item=p109ParseBusinessRow(d.kind,row,index,p109ImportPeriod(d.targetMonth||monthKey())),values=d.kind==='attendance'?[item.name,item.datetime,item.direction]:d.kind==='trip'?[item.name,item.startDate,item.endDate,item.type]:[item.name,item.rangeStart,item.rangeEnd,item.type];
  return '<tr><th>'+r62Esc((d.grid.selectedSheets||[]).length>1?row.__sheet+'!'+row.__rowNumber:row.__rowNumber)+'</th>'+values.map(v=>'<td title="'+r62Esc(v)+'">'+r62Esc(v)+'</td>').join('')+'</tr>';
 }).join('');
 modal.querySelector('#r95ParsedPreview').innerHTML='<table><thead><tr><th>行号</th>'+headings.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+previewRows+'</tbody></table>'+
  (!result.rows.length?'<p class="r95-preview-empty">请先完成字段对应，识别结果将在这里显示。</p>':'');
 const msg=modal.querySelector('#r62Validation'),bad=result.failed.length,source=r79SourcePeriod();
 msg.classList.toggle('r62-has-errors',!!bad||!!d.error);
 msg.textContent=d.error||(!result.rows.length&&bad?'没有可导入记录，请检查月份或字段':('可导入 '+result.rows.length+' 条'+(parsed.rows.length!==result.rows.length?' · '+parsed.rows.length+' 个日段':'')+(bad?' · '+bad+' 条需检查':' · 检查通过')));
 const errors=modal.querySelector('#r79ImportErrors');
 errors.innerHTML=bad?(!result.rows.length?'<p class="r79-import-issue">'+r62Esc(source.main&&source.main!==d.targetMonth?'文件主要为 '+source.main+'，请更改导入月份。':result.failed[0].reason)+'</p>':'')+
  '<details class="r79-row-errors"><summary>查看 '+bad+' 条未通过的记录</summary><ul>'+result.failed.slice(0,12).map(x=>'<li>第 '+r62Esc(x.row)+' 行：'+r62Esc(x.reason)+'</li>').join('')+'</ul></details>':'';
 const button=modal.querySelector('#r62Commit');button.disabled=!result.rows.length;
 button.textContent=result.rows.length?'导入 '+result.rows.length+' 条':'确认导入';
}
function r79ImportCapture(){
 const before=p109CaptureSession();before.employees=p109Clone(EMPLOYEES);
 Object.assign(before.values,p109Clone({records:state.records,leaves:state.leaves,trips:state.trips,
  outings:state.outings,overtimeEntries:state.overtimeEntries,imports:state.imports,
  attendanceReview:state.attendanceReview,tempOutingReview:state.tempOutingReview,manualTempOutings:state.manualTempOutings,manualOvertime:state.manualOvertime,
  monthStores:state.monthStores,groups:state.groups,manualStatuses:state.manualStatuses,overtimeReview:state.overtimeReview}));
 return before;
}
function r62WireImport(){
 const d=r62ImportDraft,modal=document.querySelector('.r62-overlay');if(!modal)return;
 const rerender=(retain=true)=>{d.error='';if(retain)r96RememberImport(d);r62ShowImport()};
 modal.querySelectorAll('[data-preview]').forEach(b=>b.onclick=()=>{d.preview=b.dataset.preview;rerender(false)});
 modal.querySelectorAll('[data-endpoint]').forEach(el=>el.onchange=()=>{d[el.dataset.endpoint+'Mode']=el.value;rerender()});
 modal.querySelector('#r104OutingMode')?.addEventListener('change',e=>{d.outingMode=e.target.value;rerender()});
 modal.querySelector('#r104LabelAdd')?.addEventListener('change',e=>{const index=Number(e.target.value);if(Number.isInteger(index)&&index>=0&&!d.labelColumns.includes(index))d.labelColumns.push(index);rerender()});
 modal.querySelectorAll('[data-label-remove]').forEach(el=>el.onclick=()=>{d.labelColumns.splice(+el.dataset.labelRemove,1);rerender()});
 modal.querySelectorAll('[data-label-move]').forEach(el=>el.onclick=()=>{const from=+el.dataset.labelPos,to=from+(el.dataset.labelMove==='up'?-1:1);if(to>=0&&to<d.labelColumns.length)[d.labelColumns[from],d.labelColumns[to]]=[d.labelColumns[to],d.labelColumns[from]];rerender()});
 modal.querySelector('#r79Advanced')?.addEventListener('toggle',e=>{d.advanced=e.target.open});
 modal.querySelector('#r96KeepImport').onclick=()=>r96RememberImport(d,true);
 modal.querySelector('#r96EditDirections')?.addEventListener('click',()=>r96ShowDirectionEditor());
 modal.querySelectorAll('[data-direction-edit]').forEach(b=>b.onclick=()=>r96ShowDirectionEditor(+b.dataset.directionEdit));
 const close=(continueQueue=false)=>{if(state.importCommitting)return;modal.remove();r62ImportDraft=null;
  if(continueQueue!==true)r80ImportQueue=null;document.getElementById('importBtn')?.focus({preventScroll:true})};
 modal.querySelector('#r80ImportMode').onchange=e=>{d.importMode=e.target.value;r96RememberImport(d)};
 modal.querySelector('#r80SkipFile')?.addEventListener('click',async()=>{close(true);await r80NextImportFile()});
 modal.querySelector('#r62Close').onclick=close;modal.querySelector('#r62Cancel').onclick=close;
 modal.addEventListener('keydown',e=>p109TrapDialogFocus(e,modal));
 modal.querySelector('#r62Header').onchange=e=>{d.header=e.target.checked;d.mapping=r62InferColumns({...d.grid,kind:d.kind},d.header,d.skip);d.labelColumns=r104DefaultLabelColumns(d.kind,d.mapping);d.startMode=d.endMode=d.outingMode=null;d.dateMode=d.mapping.datetime>=0?'combined':'split';rerender()};
 modal.querySelector('#r62Skip').onchange=e=>{d.skip=Math.max(0,Math.min(100,Number(e.target.value)||0));d.mapping=r62InferColumns({...d.grid,kind:d.kind},d.header,d.skip);d.labelColumns=r104DefaultLabelColumns(d.kind,d.mapping);d.startMode=d.endMode=d.outingMode=null;d.dateMode=d.mapping.datetime>=0?'combined':'split';rerender()};
 modal.querySelector('#r79ImportMonth').onchange=e=>{d.targetMonth=e.target.value;rerender(false)};
 modal.querySelector('#r79UseFileMonth')?.addEventListener('click',e=>{d.targetMonth=e.currentTarget.dataset.month;rerender(false)});
 modal.querySelector('#r100Sheet')?.addEventListener('change',async e=>{
  const previous=r96SettingsFromDraft(d),choice=e.target.value;r63ReadingImport=true;
  modal.querySelectorAll('select,input,button').forEach(el=>el.disabled=true);
  try{
   const grid=await P109_TABLES.readGrid(d.file,d.encoding,choice),restored=r96RestoreMapping(previous,grid,d.kind,d.header,d.skip);
   if(r62ImportDraft!==d)return;
   d.grid=grid;d.mapping=restored.mapping;d.labelColumns=r104RestoreLabelColumns(previous,grid,d.kind,d.header,d.skip,d.mapping);d.mappingChanged=restored.changed;d.validated=null;rerender(false);
  }catch(err){if(r62ImportDraft===d){d.error=err.message;r62ShowImport()}}
  finally{r63ReadingImport=false}
 });
 modal.querySelector('#r79DateMode')?.addEventListener('change',e=>{
  d.dateMode=e.target.value;const inferred=r62InferColumns({...d.grid,kind:d.kind},d.header,d.skip);
  if(d.dateMode==='split'){d.mapping.datetime=-1;d.mapping.date=inferred.date;d.mapping.time=inferred.time}
  else{d.mapping.datetime=inferred.datetime;d.mapping.date=-1;d.mapping.time=-1}rerender();
 });
 modal.querySelector('#r62Encoding')?.addEventListener('change',async e=>{
  const previous=r96SettingsFromDraft(d);d.encoding=e.target.value;r63ReadingImport=true;
  modal.querySelectorAll('select,input,#r62Commit,#r96KeepImport').forEach(el=>el.disabled=true);
  try{
   const grid=await P109_TABLES.readGrid(d.file,d.encoding,d.grid.sheetChoice),restored=r96RestoreMapping(previous,grid,d.kind,d.header,d.skip);
   if(r62ImportDraft!==d)return;
   d.grid=grid;d.mapping=restored.mapping;d.labelColumns=r104RestoreLabelColumns(previous,grid,d.kind,d.header,d.skip,d.mapping);d.mappingChanged=restored.changed;rerender();
  }
  catch(err){if(r62ImportDraft===d){d.encoding=previous.encoding;d.error=err.message;r62ShowImport()}}
  finally{r63ReadingImport=false}
 });
 modal.querySelectorAll('[data-map]').forEach(el=>el.onchange=e=>{const key=el.dataset.map;d.mapping[key]=Number(e.target.value);rerender();document.querySelector('[data-map="'+key+'"]')?.focus()});
 modal.ondragover=e=>{if(Array.from(e.dataTransfer?.types||[]).includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';modal.querySelector('.r95-import-preview').classList.add('r96-drop-target')}};
 modal.ondragleave=e=>{if(!modal.contains(e.relatedTarget))modal.querySelector('.r95-import-preview').classList.remove('r96-drop-target')};
 modal.ondrop=async e=>{
  e.preventDefault();e.stopPropagation();modal.querySelector('.r95-import-preview').classList.remove('r96-drop-target');
  if(r80ImportQueue||state.importCommitting||r63ReadingImport){toast('请先完成当前文件队列',true);return}
  const files=[...(e.dataTransfer?.files||[])];if(!r96CheckDropFiles(files))return;
  r96RememberImport(d);r62ImportDraft=null;modal.remove();
  try{await r80OpenImportFiles(files,d.kind)}catch(error){r80ImportQueue=null;r62ImportDraft=d;d.error='新文件未打开：'+error.message;r62ShowImport()}
 };
 modal.querySelector('#r62Validate').onclick=()=>{d.error='';r79ValidateImport()};
 modal.querySelector('#r62Commit').onclick=async()=>{
  if(r63ReadingImport||state.importCommitting||state.storageBusy||p109ConnectionBusy||p109ProjectBusy){d.error='正在处理文件，请稍后重试';r79ValidateImport();return}
  d.error='';r79ValidateImport();const data=d.validated;if(!data.rows.length)return;
  if(data.failed.length&&!window.confirm('将导入 '+data.rows.length+' 条记录，跳过 '+data.failed.length+' 条未通过记录。是否继续？'))return;
  const before=r79ImportCapture(),button=modal.querySelector('#r62Commit');state.importCommitting=true;
  modal.querySelectorAll('button,select,input').forEach(el=>el.disabled=true);button.textContent='正在导入…';
  try{
   // Request permission while this user click still has transient activation.
   await p109RequireWriteAccess(state.projectDir,true);
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   if(d.targetMonth!==monthKey()){
    const [y,m]=d.targetMonth.split('-').map(Number);
    if(!switchMonth(y,m,true,true,true))throw Error('无法打开所选导入月份');
   }
   const converter={attendance:importAttendance,leave:importLeaves,trip:importTrips,outing:importOutings,overtime:importOvertime}[d.kind];
   const oldProfile=r62ImportProfile();await converter(d.file,{sheet:d.grid.sheet,selectedSheets:d.grid.selectedSheets,rows:data.rows,headers:Object.keys(data.rows[0]),importMode:d.importMode});
   const settings=r96RememberImport(d),nextProfile={...oldProfile,templates:{...(oldProfile.templates||{}),[d.kind]:settings}};
   if(d.kind==='attendance')nextProfile.rules=d.rules.map(r=>({...r}));
   state.importProfile=nextProfile;state.saved=false;rememberMonth();state.importCommitting=false;close(true);render();await r80NextImportFile();
  }catch(e){
   p109RestoreSession(before);reanalyze();render();
   d.error=e.name==='AbortError'?'已取消，原数据已保留。':e.name==='NotAllowedError'?'项目目录没有写入权限，请重新授权后重试。':('导入失败：'+e.message);
   r62ShowImport();
   const help=document.createElement('button');help.id='r85ImportFallback';help.type='button';help.textContent='目录不可写？转为便携模式后重试';
   document.querySelector('.r62-dialog footer')?.prepend(help);
   help.onclick=async()=>{const draft=r62ImportDraft;r62ImportDraft=null;document.querySelector('.r62-overlay')?.remove();
    try{if(await p109UsePortable()){draft.error='已转为便携模式，请再次确认导入。关闭前须下载完整项目包。'}}finally{r62ImportDraft=draft;r62ShowImport()}
   };
  }finally{state.importCommitting=false}
 };
 r79ValidateImport();
}
function r62ShowImport(){
 document.querySelector('.r62-overlay')?.remove();
 const shell=document.createElement('div');shell.innerHTML=r62PreviewHtml();
 document.body.appendChild(shell.firstChild);r62WireImport();
 document.querySelector('#r79ImportMonth')?.focus();
}
let r63ReadingImport=false;
let r80ImportQueue=null;
function r96CheckDropFiles(files){
 if(!files.length)return false;
 if(files.some(f=>!(/\.(xls|xlsx|csv)$/i.test(f.name)))){toast('请拖入 XLS、XLSX 或 CSV 业务文件',true);return false}
 if(p109ConnectionBusy||state.storageBusy||state.importCommitting||p109ProjectBusy){toast('请先完成当前项目文件操作',true);return false}
 return true;
}
async function r80OpenImportFiles(files,kind){
 if(r62ImportDraft||r63ReadingImport){toast('请先完成或取消当前导入',true);return}
 r80ImportQueue=files.length>1?{files:[...files],kind,index:0}:null;
 try{await r62OpenImport(files[0],kind)}catch(e){r80ImportQueue=null;throw e}
}
async function r80NextImportFile(){
 const queue=r80ImportQueue;if(!queue)return;
 queue.index++;if(queue.index>=queue.files.length){r80ImportQueue=null;return}
 try{await r62OpenImport(queue.files[queue.index],queue.kind)}catch(e){r80ImportQueue=null;toast('后续文件未导入：'+e.message+'。已完成的文件保留。',true)}
}
async function r62OpenImport(file,kind){
 if(r63ReadingImport){toast('正在处理上一个文件，请先完成导入',true);return}
 if(file.size>40*1024*1024)throw new Error('文件超过 40 MB；请按月份拆分后导入');
 r63ReadingImport=true;
 const old=document.querySelector('#r63ImportBusy');old?.remove();
 const indicator=document.createElement('div');indicator.id='r63ImportBusy';
 indicator.className='r63-import-busy';indicator.setAttribute('role','status');
 indicator.innerHTML='<span class="r63-spinner"></span><strong>正在读取文件</strong><small>表格在本机解析，请勿重复点击</small>';
 document.body.appendChild(indicator);
 try{
 // Allow Chrome to paint the busy state before XLSX/CSV parsing starts.
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 const profile=r62ImportProfile(),saved=r96SavedImportSettings(kind),encoding=saved?.encoding||'auto';
 const grid=await P109_TABLES.readGrid(file,encoding);
 if(!grid.rows.length)throw new Error('文件中没有可预览的数据');
 const header=saved?.header!==false;let skip=saved?.skip||0;
 if(header&&saved?.labels.length){
  const candidates=grid.rows.slice(0,101).flatMap((row,i)=>{
   const labels=row.cells.map(v=>String(v??'').trim());return labels.length===saved.labels.length&&saved.labels.every((v,j)=>v===labels[j])?[i]:[];
  });
  if(candidates.length===1)skip=candidates[0];
 }
 const restored=r96RestoreMapping(saved,grid,kind,header,skip);
 const legacyRules=r96CleanSettings('attendance',{rules:profile.rules})?.rules||R62_DEFAULT_DIRECTIONS;
 r62ImportDraft={file,kind,grid,header,skip,encoding,mapping:restored.mapping,labelColumns:r104RestoreLabelColumns(saved,grid,kind,header,skip,restored.mapping),mappingChanged:restored.changed,
  rules:kind==='attendance'?(saved?.rules||legacyRules).map(r=>({...r})):[],validated:null,
  targetMonth:monthKey(),advanced:false,error:'',importMode:saved?.importMode||'merge',
  startMode:restored.reused?saved?.startMode:null,endMode:restored.reused?saved?.endMode:null,
  outingMode:restored.reused?saved?.outingMode:null};
 r62ImportDraft.dateMode=restored.reused&&saved?.dateMode?saved.dateMode:r62ImportDraft.mapping.datetime>=0?'combined':'split';
 r62ShowImport();
 }finally{indicator.remove();r63ReadingImport=false}
}
