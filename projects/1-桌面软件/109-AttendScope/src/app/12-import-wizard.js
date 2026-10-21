/* R62 · file preview, editable columns, and deterministic access-direction rules.
 * No raw data changes until the user explicitly confirms this preview. */
const R62_FIELDS={
 attendance:[['name','姓名'],['datetime','日期时间'],['date','日期'],['time','时间'],['direction','进出识别']],
 leave:[['name','姓名'],['date','请假日期'],['start','开始时间'],['end','结束时间'],['type','类型'],['note','备注']],
 trip:[['name','姓名'],['startDate','开始日期'],['endDate','结束日期'],['type','类型'],['place','地点'],['note','备注']],
 outing:[['name','姓名'],['startDate','开始日期'],['endDate','结束日期'],['start','开始时间'],['end','结束时间'],['type','类型'],['note','备注']],
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
   if(field==='datetime')score+=samples.filter(v=>r62DateTime(v)&&r62Time(v)).length*2;
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
 // Never silently map two mandatory fields to the same source column.
 const used=new Set();
 for(const field of ['name','datetime','date','time','direction','startDate','endDate']){
  const index=result[field];if(index<0)continue;
  if(used.has(index))result[field]=-1;else used.add(index);
 }
 return result;
}
function r62Esc(s){return escapeNameChar(String(s??''))}
function r62PreviewHtml(){
 const d=r62ImportDraft;if(!d)return '';
 const width=Math.max(0,...d.grid.rows.slice(0,80).map(r=>r.cells.length));
 const dataStart=d.skip+(d.header?1:0);
 const cols=Array.from({length:width},(_,i)=>i);
 const label=i=>r62ColumnLabel(i)+' · '+r62Esc(d.header?d.grid.rows[d.skip]?.cells[i]??'':'列 '+(i+1));
 const mapping=R62_FIELDS[d.kind].map(([key,title])=>
  '<label class="r62-field">'+title+'<select data-map="'+key+'"><option value="-1">不使用</option>'+
  cols.map(i=>'<option value="'+i+'" '+(d.mapping[key]===i?'selected':'')+'>'+label(i)+'</option>').join('')+
  '</select></label>').join('');
 const preview=d.grid.rows.slice(0,25).map((r,i)=>{
  const hidden=i<dataStart,head=d.header&&i===d.skip;
  return '<tr class="'+(hidden?'r62-skipped ':'')+(head?'r62-header':'')+'"><th>'+
   r.rowNumber+(head?' · 表头':hidden?' · 跳过':'')+'</th>'+
   cols.map(c=>'<td title="'+r62Esc(r.cells[c])+'">'+r62Esc(r.cells[c])+'</td>').join('')+'</tr>';
 }).join('');
 const rules=d.rules.map((r,i)=>'<div class="r62-rule">'+
  '<input aria-label="关键字" data-rule="'+i+'" data-part="text" value="'+r62Esc(r.text)+'" placeholder="例如 进1">'+
  '<select data-rule="'+i+'" data-part="direction"><option value="进" '+(r.direction==='进'?'selected':'')+'>进</option>'+
  '<option value="出" '+(r.direction==='出'?'selected':'')+'>出</option></select>'+
  '<select data-rule="'+i+'" data-part="match"><option value="exact" '+(r.match==='exact'?'selected':'')+'>完全匹配</option>'+
  '<option value="contains" '+(r.match==='contains'?'selected':'')+'>部分匹配</option></select>'+
  '<button data-rule-remove="'+i+'" title="删除规则">×</button></div>').join('');
 return '<section class="r62-overlay" role="dialog" aria-modal="true" aria-labelledby="r62Title">'+
  '<div class="r62-dialog"><header><div><strong id="r62Title">导入预览 · '+r62Esc(d.file.name)+'</strong>'+
  '<p>'+r62Esc(({attendance:'考勤',leave:'请假',trip:'出差',outing:'外出',overtime:'登记加班'})[d.kind])+
  ' · '+d.grid.rows.length+' 行 · 所有处理在本机完成</p></div><button id="r62Close">×</button></header>'+
  '<div class="r62-body"><div class="r62-options">'+
  '<label><input type="checkbox" id="r62Header" '+(d.header?'checked':'')+'> 将首行作为表头（预览仍显示）</label>'+
  '<label>额外跳过开头行数 <input id="r62Skip" type="number" min="0" max="100" value="'+d.skip+'"></label>'+
  (d.file.name.toLowerCase().endsWith('.csv')?'<label>CSV 编码 <select id="r62Encoding">'+
   [['auto','自动'],['utf-8','UTF-8'],['gb18030','GB18030/GBK']].map(([v,t])=>
    '<option value="'+v+'" '+(d.encoding===v?'selected':'')+'>'+t+'</option>').join('')+
   '</select></label>':'')+
   '<label class="r65-template-choice"><input type="checkbox" id="r65SaveTemplate" '+(d.saveTemplate?'checked':'')+'> 此映射下月复用</label></div>'+
  '<div class="r62-section-title">列映射 <small>识别不准确时直接修改；日期时间可选一列，或分别选择日期＋时间</small></div>'+
  '<div class="r62-mapping">'+mapping+'</div>'+
  (d.kind==='attendance'?'<div class="r62-section-title">进出识别 <small>默认「进 / 出」，特殊闸机可自定义</small></div>'+
   '<details id="r63DirectionDetails" class="r63-rules-details" '+(d.rulesExpanded?'open':'')+'><summary>自定义识别规则 <em>'+d.rules.filter(r=>r.text.trim()).length+' 条 · 例如「进1」完全匹配为「进」</em></summary>'+
   '<div class="r62-rules">'+rules+'<button id="r62AddRule">+ 添加规则</button></div></details>':'')+
  '<div class="r62-section-title">数据预览 <small>前 25 行 · 灰色行不计入导入</small></div>'+
  '<div class="r62-grid-wrap"><table><thead><tr><th>行号</th>'+
   cols.map(i=>'<th>'+r62ColumnLabel(i)+'</th>').join('')+'</tr></thead><tbody>'+
   preview+'</tbody></table></div><p id="r62Validation" class="r62-validation">检查映射与关键字后点击「验证数据」。</p></div>'+
  '<footer><button id="r62Validate">验证数据</button><span></span>'+
  '<button id="r62Cancel">取消</button><button id="r62Commit" disabled>确认导入</button></footer></div></section>';
}
function r62BuildCanonical(){
 const d=r62ImportDraft,rows=d.grid.rows,first=d.skip+(d.header?1:0),mapped=[],fail=[];
 const val=(cells,key)=>d.mapping[key]>=0?cells[d.mapping[key]]:'';
 for(let i=first;i<rows.length;i++){
  const r=rows[i],c=r.cells,name=normalizedPerson(val(c,'name'));
  if(!c.some(x=>String(x??'').trim()!==''))continue;
  const base={姓名:name,__rowNumber:r.rowNumber};
  let reason='';
  if(!name)reason='姓名为空';
  if(d.kind==='attendance'){
   const dt=r62DateTime(val(c,'datetime'),val(c,'date'),val(c,'time'));
   const direction=r62MatchDirection(val(c,'direction'),d.rules);
   if(!strictDateTime(dt))reason=reason||'日期时间格式错误';
   if(!['进','出'].includes(direction))reason=reason||('进出无法明确识别：'+String(val(c,'direction')).slice(0,35));
   Object.assign(base,{打卡时间:dt,进出:direction});
  }else if(d.kind==='leave'||d.kind==='overtime'){
   const date=r62Date(val(c,'date'));
   if(!strictISODate(date))reason=reason||'日期格式错误';
   Object.assign(base,{日期:date,开始时间:r62Time(val(c,'start')),
    结束时间:r62Time(val(c,'end')),类型:String(val(c,'type')||''),备注:String(val(c,'note')||'')});
  }else{
   const start=r62Date(val(c,'startDate')),end=r62Date(val(c,'endDate'))||start;
   if(!strictISODate(start)||!strictISODate(end))reason=reason||'起止日期格式错误';
   Object.assign(base,{开始日期:start,结束日期:end,开始时间:r62Time(val(c,'start')),
    结束时间:r62Time(val(c,'end')),类型:String(val(c,'type')||''),
    地点:String(val(c,'place')||''),备注:String(val(c,'note')||'')});
  }
  if(reason)fail.push({row:r.rowNumber,reason});else mapped.push(base);
 }
 return {rows:mapped,failed:fail,scanned:rows.length-first};
}
function r62WireImport(){
 const d=r62ImportDraft,modal=document.querySelector('.r62-overlay');if(!modal)return;
 const rerender=()=>r62ShowImport();
 modal.querySelector('#r63DirectionDetails')?.addEventListener('toggle',e=>{d.rulesExpanded=e.target.open});
 const close=()=>{modal.remove();r62ImportDraft=null};
 modal.querySelector('#r62Close').onclick=close;
 modal.querySelector('#r62Cancel').onclick=close;
 modal.querySelector('#r65SaveTemplate').onchange=e=>{d.saveTemplate=e.target.checked};
 modal.querySelector('#r62Header').onchange=e=>{d.header=e.target.checked;d.mapping=r62InferColumns({...d.grid,kind:d.kind},d.header,d.skip);rerender()};
 modal.querySelector('#r62Skip').onchange=e=>{d.skip=Math.max(0,Math.min(100,Number(e.target.value)||0));rerender()};
 modal.querySelector('#r62Encoding')?.addEventListener('change',async e=>{
  d.encoding=e.target.value;try{d.grid=await XLSX.readGrid(d.file,d.encoding);d.mapping=r62InferColumns({...d.grid,kind:d.kind},d.header,d.skip);rerender()}
  catch(err){toast(err.message,true)}
 });
 modal.querySelectorAll('[data-map]').forEach(el=>el.onchange=e=>{d.mapping[el.dataset.map]=Number(e.target.value);d.validated=null;
  modal.querySelector('#r62Commit').disabled=true});
 modal.querySelectorAll('[data-rule]').forEach(el=>el.oninput=e=>{
  d.rules[Number(el.dataset.rule)][el.dataset.part]=e.target.value;d.validated=null;
  modal.querySelector('#r62Commit').disabled=true;
 });
 modal.querySelectorAll('[data-rule-remove]').forEach(el=>el.onclick=()=>{
  d.rules.splice(Number(el.dataset.ruleRemove),1);d.validated=null;rerender();
 });
 const add=modal.querySelector('#r62AddRule');
 if(add)add.onclick=()=>{d.rules.push({text:'',direction:'进',match:'exact'});d.validated=null;rerender()};
 modal.querySelector('#r62Validate').onclick=()=>{
  const validate=modal.querySelector('#r62Validate');
  validate.disabled=true;validate.textContent='正在核对…';
  const result=r62BuildCanonical();d.validated=result;
  validate.disabled=false;validate.textContent='验证数据';
  const msg=modal.querySelector('#r62Validation');
  msg.textContent='可导入 '+result.rows.length+' 行；跳过 '+result.failed.length+' 行'+
   (result.failed.length?'（'+result.failed.slice(0,6).map(f=>'第 '+f.row+' 行：'+f.reason).join('；')+'）':'');
  msg.classList.toggle('r62-has-errors',result.failed.length>0);
  modal.querySelector('#r62Commit').disabled=result.rows.length===0;
 };
 modal.querySelector('#r62Commit').onclick=async()=>{
  const data=d.validated;if(!data?.rows.length)return;
  if(data.failed.length&&!window.confirm('有 '+data.failed.length+' 行无法识别，将跳过这些行。是否继续？'))return;
  const button=modal.querySelector('#r62Commit');button.disabled=true;
  button.textContent='正在导入…';
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  try{
   const converter={attendance:importAttendance,leave:importLeaves,trip:importTrips,
    outing:importOutings,overtime:importOvertime}[d.kind];
   const oldProfile=state.importProfile;
   await converter(d.file,{sheet:d.grid.sheet,rows:data.rows,headers:Object.keys(data.rows[0])});
   const nextProfile={...oldProfile,rules:d.rules.filter(r=>r.text.trim()).map(r=>({...r}))};
   if(d.saveTemplate){
    nextProfile.templates={...(nextProfile.templates||{}),
     [d.kind]:{header:d.header,skip:d.skip,
       labels:d.grid.rows[d.skip]?.cells.map(x=>String(x??'').trim())||[],
       mapping:{...d.mapping},encoding:d.encoding}};
   }
   state.importProfile=nextProfile;
   state.saved=false;rememberMonth();close();render();
  }catch(e){button.disabled=false;button.textContent='确认导入';toast('导入失败：'+e.message,true)}
 };
}
function r62ShowImport(){
 document.querySelector('.r62-overlay')?.remove();
 const shell=document.createElement('div');shell.innerHTML=r62PreviewHtml();
 document.body.appendChild(shell.firstChild);r62WireImport();
}
let r63ReadingImport=false;
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
  rules:profile.rules.map(r=>({...r})),rulesExpanded:false,saveTemplate:false,validated:null};
 r62ShowImport();
 }finally{indicator.remove();r63ReadingImport=false}
}
