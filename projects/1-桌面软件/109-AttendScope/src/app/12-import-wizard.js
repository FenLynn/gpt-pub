/* R62 · file preview, editable columns, and deterministic access-direction rules.
 * No raw data changes until the user explicitly confirms this preview. */
const R62_FIELDS={
 attendance:[['name','姓名'],['datetime','日期时间'],['date','日期'],['time','时间'],['direction','进出识别']],
 leave:[['name','姓名'],['date','请假日期'],['start','开始时间'],['end','结束时间'],['type','类型'],['note','备注']],
 trip:[['name','姓名'],['startDate','开始日期'],['endDate','结束日期'],['type','类型'],['place','地点'],['note','备注']],
 outing:[['name','姓名'],['startDate','开始日期'],['endDate','结束日期'],['start','开始时间'],['end','结束时间'],['type','类型'],['place','地点'],['note','备注']],
 overtime:[['name','姓名'],['date','加班日期'],['start','开始时间'],['end','结束时间'],['type','类型'],['note','备注']]
};
const R62_ALIASES={
 name:['姓名','员工姓名','人员姓名','人员','员工','name','employee','user'],
 datetime:['打卡时间','刷卡时间','通行时间','日期时间','datetime','timestamp','刷卡日期时间'],
 date:['日期','打卡日期','请假日期','加班日期','date','day'],
 time:['时间','打卡时刻','刷卡时刻','time'],
 direction:['进出','进出方向','通行方向','门禁方向','方向','进出状态','状态','direction','inout'],
 startDate:['开始日期','起始日期','出差开始','startdate','fromdate'],
 endDate:['结束日期','截止日期','终止日期','enddate','todate'],
 start:['开始时间','起始时间','开始','start'],
 end:['结束时间','截止时间','结束','end'],
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
 if(typeof v==='number'&&Number.isFinite(v)){
  if(v<1)return '';
  return excelSerialToDateTime(v).slice(0,10);
 }
 const text=String(v??'').trim().replace(/[年月]/g,'-').replace(/[日]/g,'')
  .replace(/\//g,'-').replace(/[.]/g,'-');
 const match=/^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
 return match?match[1]+'-'+pad(Number(match[2]))+'-'+pad(Number(match[3])):'';
}
function r62Time(v){
 if(typeof v==='number'&&Number.isFinite(v)){
  const frac=((v%1)+1)%1,secs=Math.round(frac*86400)%86400;
  return pad(Math.floor(secs/3600))+':'+pad(Math.floor(secs%3600/60))+':'+pad(secs%60);
 }
 const m=/(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(v??''));
 return m?pad(+m[1])+':'+m[2]+':'+pad(+(m[3]||0)):'';
}
function r62DateTime(datetime,date,time){
 if(datetime!==undefined&&datetime!==null&&String(datetime).trim()!==''){
  if(typeof datetime==='number')return excelSerialToDateTime(datetime);
  const raw=String(datetime).replace('T',' ').trim();
  const d=r62Date(raw),t=r62Time(raw);
  if(d&&t)return d+' '+t;
 }
 const d=r62Date(date),t=r62Time(time);
 return d&&t?d+' '+t:'';
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
 return data;
}
function r62MigrateActive(){
 const previousPerson=EMPLOYEES.find(e=>e.id===state.selection?.employeeId)?.name||null;
 const data={employees:EMPLOYEES,groups:state.groups,records:state.records,
  leaves:state.leaves,trips:state.trips,outings:state.outings,
  overtimeEntries:state.overtimeEntries,manualStatuses:state.manualStatuses,
  overtimeReview:state.overtimeReview};
 r62MigratePayload(data);
 EMPLOYEES=data.employees;state.groups=data.groups;
 state.manualStatuses=data.manualStatuses;state.overtimeReview=data.overtimeReview;
 if(previousPerson)state.selection.employeeId=personIdentity(previousPerson);
}
function r62ImportProfile(){
 if(!state.importProfile)state.importProfile={rules:R62_DEFAULT_DIRECTIONS.map(r=>({...r}))};
 return state.importProfile;
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
   if(field==='datetime')score+=samples.filter(v=>typeof v==='number'?v>=1&&Math.abs(v-Math.round(v))>1e-8:!!(r62Date(v)&&r62Time(v))).length*2;
   if(field==='date'||field==='startDate'||field==='endDate')score+=samples.filter(v=>r62Date(v)).length;
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
 for(const field of ['name','datetime','date','time','direction','startDate','endDate']){
  const index=result[field];if(index<0)continue;
  if(used.has(index))result[field]=-1;else used.add(index);
 }
 return result;
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
 const d=r62ImportDraft,dates=[],counts=new Map();
 const field=d.kind==='attendance'?(d.mapping.datetime>=0?'datetime':'date'):
  ['trip','outing'].includes(d.kind)?'startDate':'date';
 const col=d.mapping[field];
 if(col>=0)for(const row of d.grid.rows.slice(d.skip+(d.header?1:0))){
  const date=r62Date(row.cells[col]);if(!strictISODate(date))continue;
  dates.push(date);const key=date.slice(0,7);counts.set(key,(counts.get(key)||0)+1);
 }
 dates.sort();return {first:dates[0]||'',last:dates.at(-1)||'',
  main:[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0]||''};
}
function r62PreviewHtml(){
 const d=r62ImportDraft;if(!d)return '';
 const width=Math.max(0,...d.grid.rows.slice(0,80).map(r=>r.cells.length));
 const dataStart=d.skip+(d.header?1:0),cols=Array.from({length:width},(_,i)=>i),source=r79SourcePeriod();
 const label=i=>r62ColumnLabel(i)+' · '+r62Esc(d.header?d.grid.rows[d.skip]?.cells[i]??'':'列 '+(i+1));
 const required=key=>['name','datetime','date','time','startDate'].includes(key)||(['start','end'].includes(key)&&['outing','overtime'].includes(d.kind));
 const select=(key,title)=>'<label class="r62-field">'+title+(required(key)?' <b class="r80-required">必填</b>':'')+'<select data-map="'+key+'"><option value="-1" '+(d.mapping[key]<0?'selected':'')+'>'+
  (required(key)?'请选择':d.kind==='leave'&&['start','end'].includes(key)?'无（使用班次'+(key==='start'?'开始':'结束')+'）':key==='endDate'?'无（同开始日期）':'无')+'</option>'+
  cols.map(i=>'<option value="'+i+'" '+(d.mapping[key]===i?'selected':'')+'>'+label(i)+'</option>').join('')+'</select></label>';
 const fields=d.kind==='attendance'?[['name','姓名'],...(d.dateMode==='split'?[['date','日期'],['time','时间']]:[['datetime','打卡时间']]),['direction','进出']]:R62_FIELDS[d.kind];
 const mapping=fields.map(([key,title])=>select(key,title)).join('');
 const preview=d.grid.rows.slice(0,25).map((r,i)=>{
  const hidden=i<dataStart,head=d.header&&i===d.skip;
  return '<tr class="'+(hidden?'r62-skipped ':'')+(head?'r62-header':'')+'"><th>'+r.rowNumber+(head?' · 表头':hidden?' · 跳过':'')+'</th>'+
   cols.map(c=>'<td title="'+r62Esc(r.cells[c])+'">'+r62Esc(r.cells[c])+'</td>').join('')+'</tr>';
 }).join('');
 const rules=d.rules.map((r,i)=>'<div class="r62-rule">'+
  '<input aria-label="关键字" data-rule="'+i+'" data-part="text" value="'+r62Esc(r.text)+'" placeholder="刷卡关键字">'+
  '<select aria-label="进出方向" data-rule="'+i+'" data-part="direction"><option value="进" '+(r.direction==='进'?'selected':'')+'>进</option><option value="出" '+(r.direction==='出'?'selected':'')+'>出</option></select>'+
  '<select aria-label="匹配方式" data-rule="'+i+'" data-part="match"><option value="exact" '+(r.match==='exact'?'selected':'')+'>完全匹配</option><option value="contains" '+(r.match==='contains'?'selected':'')+'>包含关键字</option></select>'+
  '<button type="button" data-rule-remove="'+i+'" aria-label="删除规则">×</button></div>').join('');
 const title={attendance:'考勤记录',leave:'请假',trip:'出差',outing:'外出',overtime:'登记加班'}[d.kind];
 return '<section class="r62-overlay" role="dialog" aria-modal="true" aria-labelledby="r62Title"><div class="r62-dialog">'+
  '<header><div><strong id="r62Title">导入'+title+'</strong><p class="r79-import-file" title="'+r62Esc(d.file.name)+'">'+r62Esc(d.file.name)+'</p></div><button id="r62Close" aria-label="关闭导入">×</button></header>'+
  (r80ImportQueue?'<div class="r80-import-queue">文件 '+(r80ImportQueue.index+1)+' / '+r80ImportQueue.files.length+' · 逐个核对并合并<button id="r80SkipFile" type="button">跳过此文件</button></div>':'')+
  '<div class="r62-body"><div class="r79-import-context"><label>导入月份<input id="r79ImportMonth" aria-label="导入月份" type="month" min="2000-01" max="2099-12" value="'+d.targetMonth+'"></label>'+
  '<div class="r79-source-period">文件日期<b>'+r62Esc(source.first?(source.first===source.last?source.first:source.first+' 至 '+source.last):'待识别')+'</b></div>'+
  (source.main&&source.main!==d.targetMonth?'<button type="button" id="r79UseFileMonth" data-month="'+source.main+'">改为 '+source.main+'</button>':'')+'</div>'+
  '<div class="r79-import-section-head"><h3>字段对应</h3>'+(d.kind==='attendance'?'<label>时间格式<select id="r79DateMode" aria-label="时间格式"><option value="combined" '+(d.dateMode!=='split'?'selected':'')+'>日期时间在同一列</option><option value="split" '+(d.dateMode==='split'?'selected':'')+'>日期、时间分列</option></select></label>':'')+'</div>'+
  '<div class="r62-mapping">'+mapping+'</div>'+
  (d.kind==='attendance'&&d.mapping.direction<0?'<p class="r80-mapping-hint">未提供进出方向的打卡将标为待核。</p>':'')+
  '<details id="r79Advanced" class="r79-import-advanced" '+(d.advanced?'open':'')+'><summary>更多选项</summary><div class="r62-options">'+
  '<label>导入方式<select id="r80ImportMode"><option value="merge" '+(d.importMode!=='replace'?'selected':'')+'>合并到已有数据</option><option value="replace" '+(d.importMode==='replace'?'selected':'')+'>替换本月此类数据</option></select></label>'+
  '<label><input type="checkbox" id="r62Header" '+(d.header?'checked':'')+'> 首行为表头</label><label>跳过开头 <input id="r62Skip" type="number" min="0" max="100" value="'+d.skip+'"> 行</label>'+
  (d.file.name.toLowerCase().endsWith('.csv')?'<label>编码<select id="r62Encoding">'+[['auto','自动'],['utf-8','UTF-8'],['gb18030','GB18030/GBK']].map(([v,t])=>'<option value="'+v+'" '+(d.encoding===v?'selected':'')+'>'+t+'</option>').join('')+'</select></label>':'')+
  '<label><input type="checkbox" id="r65SaveTemplate" '+(d.saveTemplate?'checked':'')+'> 记住字段对应</label></div>'+
  (d.kind==='attendance'?'<details id="r63DirectionDetails" class="r63-rules-details" '+(d.rulesExpanded?'open':'')+'><summary>进出识别规则</summary><div class="r62-rules">'+rules+'<button type="button" id="r62AddRule">添加规则</button></div></details>':'')+'</details>'+
  '<div class="r79-import-section-head"><h3>数据预览</h3><span>前 '+Math.min(25,d.grid.rows.length)+' 行</span></div>'+
  '<div class="r62-grid-wrap"><table><thead><tr><th>原始行号</th>'+cols.map(i=>'<th>'+r62ColumnLabel(i)+'</th>').join('')+'</tr></thead><tbody>'+preview+'</tbody></table></div>'+
  '<div id="r79ImportErrors"></div></div><footer><div id="r62Validation" class="r62-validation" role="status" aria-live="polite"></div>'+
  '<div class="r79-import-buttons"><button id="r62Validate">重新检查</button><button id="r62Cancel">取消</button><button id="r62Commit" disabled>确认导入</button></div></footer></div></section>';
}
function r62BuildCanonical(){
 const d=r62ImportDraft,rows=d.grid.rows,first=d.skip+(d.header?1:0),mapped=[],fail=[];
 let period;try{period=p109ImportPeriod(d.targetMonth||monthKey())}catch(e){return {rows:[],failed:[{row:'—',reason:e.message}],scanned:0}};
 const val=(cells,key)=>d.mapping[key]>=0?cells[d.mapping[key]]:'';
 for(let i=first;i<rows.length;i++){
  const r=rows[i],c=r.cells,name=normalizedPerson(val(c,'name'));
  if(!c.some(x=>String(x??'').trim()!==''))continue;
  const base={姓名:name,__rowNumber:r.rowNumber};
  let reason='';
  if(!name)reason='姓名为空';
  if(d.kind==='attendance'){
   const dt=r62DateTime(val(c,'datetime'),val(c,'date'),val(c,'time'));
   const rawDirection=val(c,'direction'),direction=d.mapping.direction<0||!String(rawDirection??'').trim()||String(rawDirection).trim()==='未标注'?'未标注':r62MatchDirection(rawDirection,d.rules);
   if(!strictDateTime(dt))reason=reason||'日期时间格式错误';
   if(!['进','出','未标注'].includes(direction))reason=reason||('进出无法明确识别：'+String(val(c,'direction')).slice(0,35));
   Object.assign(base,{打卡时间:dt,进出:direction});
  }else if(d.kind==='leave'||d.kind==='overtime'){
   const date=r62Date(val(c,'date'));
   if(!strictISODate(date))reason=reason||'日期格式错误';
   for(const key of ['start','end'])if(String(val(c,key)??'').trim()&&!r62Time(val(c,key)))reason=reason||'起止时间格式错误';
   Object.assign(base,{日期:date,开始时间:r62Time(val(c,'start')),
    结束时间:r62Time(val(c,'end')),类型:String(val(c,'type')||''),备注:String(val(c,'note')||'')});
  }else{
   const start=r62Date(val(c,'startDate')),end=r62Date(val(c,'endDate'))||start;
   if(!strictISODate(start)||!strictISODate(end))reason=reason||'起止日期格式错误';
   if(String(val(c,'endDate')??'').trim()&&!r62Date(val(c,'endDate')))reason=reason||'结束日期格式错误';
   if(d.kind==='outing')for(const key of ['start','end'])if(String(val(c,key)??'').trim()&&!r62Time(val(c,key)))reason=reason||'起止时间格式错误';
   Object.assign(base,{开始日期:start,结束日期:end,开始时间:r62Time(val(c,'start')),
    结束时间:r62Time(val(c,'end')),类型:String(val(c,'type')||''),
    地点:String(val(c,'place')||''),备注:String(val(c,'note')||'')});
  }
  if(!reason)try{p109ParseBusinessRow(d.kind,base,i,period)}catch(e){reason=e.message}
  if(reason)fail.push({row:r.rowNumber,reason});else mapped.push(base);
 }
 return {rows:mapped,failed:fail,scanned:rows.length-first};
}
function r79ValidateImport(){
 const d=r62ImportDraft,modal=document.querySelector('.r62-overlay');if(!d||!modal)return;
 const result=r62BuildCanonical();d.validated=result;
 const msg=modal.querySelector('#r62Validation'),bad=result.failed.length,source=r79SourcePeriod();
 msg.classList.toggle('r62-has-errors',!!bad||!!d.error);
 msg.textContent=d.error||(!result.rows.length&&bad?'没有可导入记录，请检查月份或字段':('可导入 '+result.rows.length+' 条'+(bad?' · '+bad+' 条需检查':' · 检查通过')));
 const errors=modal.querySelector('#r79ImportErrors');
 errors.innerHTML=bad?(!result.rows.length?'<p class="r79-import-issue">'+r62Esc(source.main&&source.main!==d.targetMonth?'文件主要为 '+source.main+'，请更改导入月份。':result.failed[0].reason)+'</p>':'')+
  '<details class="r79-row-errors"><summary>查看 '+bad+' 条未通过的记录</summary><ul>'+result.failed.slice(0,12).map(x=>'<li>第 '+r62Esc(x.row)+' 行：'+r62Esc(x.reason)+'</li>').join('')+'</ul></details>':'';
 const button=modal.querySelector('#r62Commit');button.disabled=!result.rows.length;
 button.textContent=result.rows.length?'导入 '+result.rows.length+' 条':'确认导入';
}
function r79ImportCapture(){
 const before=p109CaptureSession();before.employees=structuredClone(EMPLOYEES);
 Object.assign(before.values,structuredClone({records:state.records,leaves:state.leaves,trips:state.trips,
  outings:state.outings,overtimeEntries:state.overtimeEntries,imports:state.imports,
  monthStores:state.monthStores,groups:state.groups,manualStatuses:state.manualStatuses,overtimeReview:state.overtimeReview}));
 return before;
}
function r62WireImport(){
 const d=r62ImportDraft,modal=document.querySelector('.r62-overlay');if(!modal)return;
 const rerender=()=>{d.error='';r62ShowImport()};
 modal.querySelector('#r79Advanced')?.addEventListener('toggle',e=>{d.advanced=e.target.open});
 modal.querySelector('#r63DirectionDetails')?.addEventListener('toggle',e=>{d.rulesExpanded=e.target.open});
 const close=(continueQueue=false)=>{if(state.importCommitting)return;modal.remove();r62ImportDraft=null;
  if(continueQueue!==true)r80ImportQueue=null;document.getElementById('importBtn')?.focus({preventScroll:true})};
 modal.querySelector('#r80ImportMode').onchange=e=>{d.importMode=e.target.value};
 modal.querySelector('#r80SkipFile')?.addEventListener('click',async()=>{close(true);await r80NextImportFile()});
 modal.querySelector('#r62Close').onclick=close;modal.querySelector('#r62Cancel').onclick=close;
 modal.addEventListener('keydown',e=>p109TrapDialogFocus(e,modal));
 modal.querySelector('#r65SaveTemplate').onchange=e=>{d.saveTemplate=e.target.checked};
 modal.querySelector('#r62Header').onchange=e=>{d.header=e.target.checked;d.mapping=r62InferColumns({...d.grid,kind:d.kind},d.header,d.skip);d.dateMode=d.mapping.datetime>=0?'combined':'split';rerender()};
 modal.querySelector('#r62Skip').onchange=e=>{d.skip=Math.max(0,Math.min(100,Number(e.target.value)||0));d.mapping=r62InferColumns({...d.grid,kind:d.kind},d.header,d.skip);rerender()};
 modal.querySelector('#r79ImportMonth').onchange=e=>{d.targetMonth=e.target.value;rerender()};
 modal.querySelector('#r79UseFileMonth')?.addEventListener('click',e=>{d.targetMonth=e.currentTarget.dataset.month;rerender()});
 modal.querySelector('#r79DateMode')?.addEventListener('change',e=>{
  d.dateMode=e.target.value;const inferred=r62InferColumns({...d.grid,kind:d.kind},d.header,d.skip);
  if(d.dateMode==='split'){d.mapping.datetime=-1;d.mapping.date=inferred.date;d.mapping.time=inferred.time}
  else{d.mapping.datetime=inferred.datetime;d.mapping.date=-1;d.mapping.time=-1}rerender();
 });
 modal.querySelector('#r62Encoding')?.addEventListener('change',async e=>{
  d.encoding=e.target.value;try{d.grid=await XLSX.readGrid(d.file,d.encoding);d.mapping=r62InferColumns({...d.grid,kind:d.kind},d.header,d.skip);rerender()}
  catch(err){d.error=err.message;r79ValidateImport()}
 });
 modal.querySelectorAll('[data-map]').forEach(el=>el.onchange=e=>{const key=el.dataset.map;d.mapping[key]=Number(e.target.value);rerender();document.querySelector('[data-map="'+key+'"]')?.focus()});
 modal.querySelectorAll('[data-rule]').forEach(el=>el.oninput=e=>{d.rules[Number(el.dataset.rule)][el.dataset.part]=e.target.value;d.error='';r79ValidateImport()});
 modal.querySelectorAll('[data-rule-remove]').forEach(el=>el.onclick=()=>{d.rules.splice(Number(el.dataset.ruleRemove),1);rerender()});
 modal.querySelector('#r62AddRule')?.addEventListener('click',()=>{d.rules.push({text:'',direction:'进',match:'exact'});rerender()});
 modal.querySelector('#r62Validate').onclick=()=>{d.error='';r79ValidateImport()};
 modal.querySelector('#r62Commit').onclick=async()=>{
  if(state.importCommitting||state.storageBusy||p109ConnectionBusy||p109ProjectBusy){d.error='正在处理项目文件，请稍后重试';r79ValidateImport();return}
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
   const oldProfile=state.importProfile;await converter(d.file,{sheet:d.grid.sheet,rows:data.rows,headers:Object.keys(data.rows[0]),importMode:d.importMode});
   const nextProfile={...oldProfile,rules:d.rules.filter(r=>r.text.trim()).map(r=>({...r}))};
   if(d.saveTemplate)nextProfile.templates={...(nextProfile.templates||{}),[d.kind]:{header:d.header,skip:d.skip,
    labels:d.grid.rows[d.skip]?.cells.map(x=>String(x??'').trim())||[],mapping:{...d.mapping},encoding:d.encoding}};
   state.importProfile=nextProfile;state.saved=false;rememberMonth();state.importCommitting=false;close(true);render();await r80NextImportFile();
  }catch(e){
   p109RestoreSession(before);reanalyze();render();
   d.error=e.name==='AbortError'?'已取消，原数据已保留。':e.name==='NotAllowedError'?'项目目录没有写入权限，请重新授权后重试。':('导入失败：'+e.message);
   r62ShowImport();
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
 const grid=await XLSX.readGrid(file);
 if(!grid.rows.length)throw new Error('文件中没有可预览的数据');
 const header=true,profile=r62ImportProfile();
 const saved=profile.templates?.[kind];
 const currentLabels=grid.rows[0]?.cells.map(x=>String(x??'').trim())||[];
 const matches=saved?.header===true&&saved.skip===0&&Array.isArray(saved.labels)&&
   saved.labels.length===currentLabels.length&&saved.labels.every((x,i)=>x===currentLabels[i]);
 r62ImportDraft={file,kind,grid,header,skip:0,encoding:'auto',
  mapping:matches?{...saved.mapping}:r62InferColumns({...grid,kind},header),
  rules:profile.rules.map(r=>({...r})),rulesExpanded:false,saveTemplate:false,validated:null,
  targetMonth:monthKey(),advanced:false,error:'',importMode:'merge'};
 r62ImportDraft.dateMode=r62ImportDraft.mapping.datetime>=0?'combined':'split';
 r62ShowImport();
 }finally{indicator.remove();r63ReadingImport=false}
}
