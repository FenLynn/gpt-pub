/* Fixed calendars are independent of project directories and business months. */
'use strict';
const P109_CALENDAR_KEY='p109-fixed-calendar-v1';
let p109FixedCalendar={schemaVersion:1,kind:'P109-Fixed-Calendar',updatedAt:0,months:{}};
function p109CalendarDates(key){
 const [year,month]=key.split('-').map(Number);
 return Array.from({length:new Date(Date.UTC(year,month,0)).getUTCDate()},(_,i)=>key+'-'+String(i+1).padStart(2,'0'));
}
function p109ValidateCalendarBook(book){
 if(!book||book.schemaVersion!==1||book.kind!=='P109-Fixed-Calendar'||!Number.isSafeInteger(book.updatedAt)||book.updatedAt<0||!book.months||typeof book.months!=='object'||Array.isArray(book.months))throw Error('日历文件格式或版本无效');
 const months={};if(Object.keys(book.months).length>1212)throw Error('日历月份过多');
 for(const [key,values] of Object.entries(book.months)){
  if(!/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(key)||!values||typeof values!=='object'||Array.isArray(values))throw Error('日历月份无效');
  const dates=p109CalendarDates(key);
  if(Object.keys(values).length!==dates.length||dates.some(date=>!Object.hasOwn(values,date)||!['work','rest'].includes(values[date])))throw Error('日历日期不完整或类型无效');
  months[key]=Object.fromEntries(dates.map(date=>[date,values[date]]));
 }
 return {schemaVersion:1,kind:'P109-Fixed-Calendar',updatedAt:book.updatedAt,months};
}
try{const saved=localStorage.getItem(P109_CALENDAR_KEY);if(saved)p109FixedCalendar=p109ValidateCalendarBook(JSON.parse(saved))}catch(_){}
function p109CalendarType(date,calendar={},useFixed=true){
 const value=calendar?.[date]??(useFixed?p109FixedCalendar.months[date.slice(0,7)]?.[date]:null);
 if(['work','adjust','adjusted-work'].includes(value))return 'work';
 if(['rest','holiday'].includes(value))return 'rest';
 const day=new Date(date+'T00:00:00Z').getUTCDay();return day===0||day===6?'rest':'work';
}
function p109CalendarMonthValues(year,month,calendar={},useFixed=true){
 return Object.fromEntries(p109CalendarDates(year+'-'+String(month).padStart(2,'0')).map(date=>[date,p109CalendarType(date,calendar,useFixed)]));
}
function p109CalendarSnapshotValues(){
 const own={...state.calendarOverrides,...p109CalendarMonthValues(YEAR,MONTH,state.calendarOverrides,!state.snapshotContext&&!state.activeBranch)};
 if(state.snapshotContext||state.activeBranch)return own;
 for(const offset of [-1,1]){
  const date=new Date(Date.UTC(YEAR,MONTH-1+offset,1)),year=date.getUTCFullYear(),month=date.getUTCMonth()+1,key=year+'-'+pad(month),other=state.monthStores.get(key);
  Object.assign(own,p109CalendarMonthValues(year,month,other?.calendarOverrides||own,!other?.snapshotContext&&!other?.activeBranch));
 }
 return own;
}
function p109CalendarValues(source,year,month,legacy=false){
 if(source==null)return null;
 const result={};for(const [date,value] of Object.entries(source))
  if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&['work','adjust','adjusted-work','rest','holiday'].includes(value))
   result[date]=['rest','holiday'].includes(value)?'rest':'work';
 if(legacy&&Number(year)===2026&&Number(month)===10){
  for(let day=1;day<=7;day++)result['2026-10-0'+day]??='rest';
  result['2026-10-10']??='work';
 }
 return result;
}
function p109ExportCalendar(book=p109FixedCalendar){downloadBlob(new Blob([JSON.stringify(book,null,2)],{type:'application/json'}),'工作日历.json')}
async function p109CalendarDb(book){
 const db=await p109RecentOpenDb();
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction('settings',book?'readwrite':'readonly'),store=tx.objectStore('settings');
  const request=book?store.put(book,'fixedCalendar'):store.get('fixedCalendar');
  tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 })}finally{db.close()}
}
async function p109LoadFixedCalendar(){
 try{const saved=await p109CalendarDb();if(saved){const book=p109ValidateCalendarBook(saved);if(book.updatedAt>p109FixedCalendar.updatedAt&&!p109CalendarUI.dirty){p109FixedCalendar=book;p109CalendarUI.key='';reanalyze();render()}}}catch(_){}
}
async function p109StoreFixedCalendar(candidate){
 const book=p109ValidateCalendarBook(candidate);let local=false,db=false;
 try{localStorage.setItem(P109_CALENDAR_KEY,JSON.stringify(book));local=localStorage.getItem(P109_CALENDAR_KEY)===JSON.stringify(book)}catch(_){}
 try{await p109CalendarDb(book);db=true}catch(_){}
 p109FixedCalendar=book;return local||db;
}
function p109CalendarFallback(){
 p109CalendarUI.dirty=true;
 const message='本次日历已生效，但浏览器无法持久保存。';
 try{p109ExportCalendar();p109CalendarUI.status=message+'已发起日历文件下载，请保存文件；下次使用“导入日历”恢复。'}
 catch(_){p109CalendarUI.status=message+'下载未开始，请允许下载后点击“导出全部日历”备份。'}
}
const p109CalendarUI={key:'',draft:{},chosen:new Set(),dirty:false,saving:false,status:''};
function p109CalendarBusy(){return !!(p109CalendarUI.saving||state.storageBusy||state.importCommitting||p109ConnectionBusy||p109ProjectBusy)}
function p109CalendarSelect(key){
 const [year,month]=key.split('-').map(Number),stored=p109FixedCalendar.months[key];
 const current=key===monthKey()?state.calendarOverrides:state.monthStores.get(key)?.calendarOverrides;
 Object.assign(p109CalendarUI,{key,draft:{...(stored||p109CalendarMonthValues(year,month,current||{}))},chosen:new Set(),dirty:false,status:''});
}
function p109OpenCalendar(){
 if(p109CalendarBusy()){toast('请先完成当前文件操作',true);return}
 state.dataSection='calendar';navigateWorkspace('data');
}
function p109CalendarPageHtml(){
 if(!p109CalendarUI.key)p109CalendarSelect(monthKey());
 const {key,draft,chosen,dirty,saving,status}=p109CalendarUI,[year,month]=key.split('-').map(Number),dates=p109CalendarDates(key),work=Object.values(draft).filter(x=>x==='work').length;
 return '<section class="p109-calendar-page"><header><h2>工作日管理</h2><div class="p109-calendar-period"><button type="button" id="p109CalendarYearPrev" aria-label="上一年" '+(year<=2000?'disabled':'')+'>‹</button><strong id="p109CalendarYear">'+year+' 年</strong><button type="button" id="p109CalendarYearNext" aria-label="下一年" '+(year>=2100?'disabled':'')+'>›</button><label>月份 <select id="p109CalendarMonth">'+Array.from({length:12},(_,i)=>'<option value="'+(i+1)+'" '+(month===i+1?'selected':'')+'>'+(i+1)+' 月</option>').join('')+'</select></label></div></header>'+
  '<p>日历独立保存，无需先建项目或业务月份。多选日期、设置类型，再确认保存当月。</p>'+
  '<div class="p109-calendar-tools"><button type="button" id="p109CalendarAll">全选</button><button type="button" id="p109CalendarClear">清除选择</button><span id="p109CalendarCount" aria-live="polite">已选 '+chosen.size+' 天</span><button type="button" data-calendar-set="work" '+(chosen.size?'':'disabled')+'>设为工作日</button><button type="button" data-calendar-set="rest" '+(chosen.size?'':'disabled')+'>设为休息日</button></div>'+
  '<div class="p109-calendar-grid" id="p109CalendarGrid" aria-label="'+year+' 年 '+month+' 月日期多选">'+['一','二','三','四','五','六','日'].map(x=>'<b>周'+x+'</b>').join('')+'<span></span>'.repeat((new Date(Date.UTC(year,month-1,1)).getUTCDay()+6)%7)+dates.map((date,i)=>{
   const type=draft[date];return '<button type="button" data-calendar-date="'+date+'" class="'+type+(chosen.has(date)?' is-selected':'')+'" aria-pressed="'+chosen.has(date)+'" aria-label="'+date+' '+(type==='work'?'工作日':'休息日')+'"><strong>'+(i+1)+'</strong><small>'+(type==='work'?'工作日':'休息日')+'</small></button>';
  }).join('')+'</div><footer><span>工作日 '+work+' 天 · 休息日 '+(dates.length-work)+' 天</span><button type="button" id="p109CalendarWeekdays">按周一至周五重置</button><button type="button" id="p109CalendarConfirm" '+(saving?'disabled':'')+'>'+(saving?'正在保存…':'确认保存当月')+'</button></footer>'+
  '<div id="p109CalendarStatus" role="status">'+r68Esc(status||(dirty?'有未确认的日历修改':p109FixedCalendar.months[key]?'当月固定日历已保存':'尚未保存当月固定日历'))+'</div><div class="p109-calendar-transfer"><button type="button" id="p109CalendarExport">导出全部日历</button><button type="button" id="p109CalendarImport">导入日历</button><input id="p109CalendarFile" type="file" accept=".json" hidden><span>换浏览器或程序位置前，请导出日历备份。</span></div></section>';
}
function p109ApplyCalendar(changes){
 if(p109CalendarBusy())return false;
 const dates=new Set(p109CalendarDates(p109CalendarUI.key));let changed=false;
 for(const [date,type] of Object.entries(changes))if(dates.has(date)&&['work','rest'].includes(type)&&p109CalendarUI.draft[date]!==type){p109CalendarUI.draft[date]=type;changed=true}
 if(changed){p109CalendarUI.dirty=true;p109CalendarUI.status='';render()}
 return changed;
}
function p109ApplyFixedToWorking(key,calendar){
 const apply=target=>{
  if(target.snapshotContext||target.activeBranch)return false;
  const before=target.calendarOverrides||{};if(JSON.stringify(before)===JSON.stringify(calendar))return false;
  const people=target===state?EMPLOYEES:target.employees||[];
  if(!state.projectDir&&!people.length&&!target.records.length&&!target.imports.length&&target.saved){target.calendarOverrides={...calendar};return false}
  target.calendarOverrides={...calendar};target.saved=false;
  target.revisions.push({id:'R'+(++target.revisionSeq),action:'month-calendar',month:key,time:new Date().toISOString(),from:{...before},to:{...calendar}});return true;
 };
 if(key===monthKey()){if(apply(state)){reanalyze();rememberMonth();return true}}
 else{const stored=state.monthStores.get(key);if(stored)return apply(stored)}
 return false;
}
async function p109ConfirmCalendar(){
 if(p109CalendarBusy())return false;
 p109CalendarUI.saving=true;render();
 try{
  const key=p109CalendarUI.key,calendar={...p109CalendarUI.draft},book={...p109FixedCalendar,updatedAt:Math.max(Date.now(),p109FixedCalendar.updatedAt+1),months:{...p109FixedCalendar.months,[key]:calendar}};
  const persisted=await p109StoreFixedCalendar(book);
  p109CalendarUI.dirty=false;const applied=p109ApplyFixedToWorking(key,calendar);
  if(!persisted){p109CalendarFallback();return false}
  p109CalendarUI.status='已保存 '+key+' 固定日历。'+(applied?'同月工作数据已更新，请另行保存业务月份。':'可供新建月份使用；冻结与修订保持原日历。');return true;
 }catch(e){p109CalendarUI.status='日历未保存：'+e.message;return false}
 finally{p109CalendarUI.saving=false;render()}
}
async function p109ImportCalendar(file){
 if(!file||p109CalendarBusy())return false;
 p109CalendarUI.saving=true;render();
 try{
  if(file.size>2000000)throw Error('日历文件过大');
  const incoming=p109ValidateCalendarBook(JSON.parse(await file.text()));
  if(!Object.keys(incoming.months).length)throw Error('文件没有日历月份');
  if(!window.confirm('导入 '+Object.keys(incoming.months).length+' 个月的固定日历？同月固定日历将替换，其他月份保留。未确认的日历编辑将丢弃。'))return false;
  const book={...p109FixedCalendar,updatedAt:Math.max(Date.now(),p109FixedCalendar.updatedAt+1),months:{...p109FixedCalendar.months,...incoming.months}};
  const persisted=await p109StoreFixedCalendar(book);
  for(const [key,values] of Object.entries(incoming.months))p109ApplyFixedToWorking(key,values);
  p109CalendarSelect(p109CalendarUI.key);if(!persisted)p109CalendarFallback();else p109CalendarUI.status='已导入 '+Object.keys(incoming.months).length+' 个月的固定日历';return true;
 }catch(e){p109CalendarUI.status='导入未完成：'+e.message;return false}
 finally{p109CalendarUI.saving=false;render()}
}
function p109WireCalendarPage(root){
 const navigate=(year,month)=>{
  if(p109CalendarBusy())return;
  if(p109CalendarUI.dirty&&!window.confirm('当月日历尚未确认保存，放弃编辑并切换？')){render();return}
  p109CalendarSelect(year+'-'+String(month).padStart(2,'0'));render();
 },[year,month]=p109CalendarUI.key.split('-').map(Number);
 root.querySelector('#p109CalendarYearPrev').onclick=()=>navigate(year-1,month);
 root.querySelector('#p109CalendarYearNext').onclick=()=>navigate(year+1,month);
 root.querySelector('#p109CalendarMonth').onchange=e=>navigate(year,Number(e.target.value));
 const paint=()=>{
  root.querySelectorAll('[data-calendar-date]').forEach(n=>{const selected=p109CalendarUI.chosen.has(n.dataset.calendarDate);n.classList.toggle('is-selected',selected);n.setAttribute('aria-pressed',String(selected))});
  root.querySelector('#p109CalendarCount').textContent='已选 '+p109CalendarUI.chosen.size+' 天';
  root.querySelectorAll('[data-calendar-set]').forEach(n=>n.disabled=!p109CalendarUI.chosen.size);
 };
 root.querySelectorAll('[data-calendar-date]').forEach(n=>n.onclick=()=>{if(p109CalendarBusy())return;const date=n.dataset.calendarDate;if(p109CalendarUI.chosen.has(date))p109CalendarUI.chosen.delete(date);else p109CalendarUI.chosen.add(date);paint()});
 root.querySelector('#p109CalendarAll').onclick=()=>{p109CalendarUI.chosen=new Set(p109CalendarDates(p109CalendarUI.key));paint()};
 root.querySelector('#p109CalendarClear').onclick=()=>{p109CalendarUI.chosen.clear();paint()};
 root.querySelectorAll('[data-calendar-set]').forEach(n=>n.onclick=()=>p109ApplyCalendar(Object.fromEntries([...p109CalendarUI.chosen].map(date=>[date,n.dataset.calendarSet]))));
 root.querySelector('#p109CalendarWeekdays').onclick=()=>p109ApplyCalendar(Object.fromEntries(p109CalendarDates(p109CalendarUI.key).map(date=>[date,p109CalendarType(date,{},false)])));
 root.querySelector('#p109CalendarConfirm').onclick=p109ConfirmCalendar;
 root.querySelector('#p109CalendarExport').onclick=()=>p109ExportCalendar();
 root.querySelector('#p109CalendarImport').onclick=()=>root.querySelector('#p109CalendarFile').click();
 root.querySelector('#p109CalendarFile').onchange=e=>p109ImportCalendar(e.target.files[0]);
 if(p109CalendarUI.saving)root.querySelectorAll('.p109-calendar-page button,.p109-calendar-page select,.p109-calendar-page input').forEach(n=>n.disabled=true);
}
document.addEventListener('click',event=>{if(event.target.closest?.('[data-calendar-editor]'))p109OpenCalendar()});
