/* A month's work/rest choices are explicit facts; no holiday service is used. */
'use strict';
function p109CalendarType(date,calendar={}){
 const value=calendar?.[date];
 if(['work','adjust','adjusted-work'].includes(value))return 'work';
 if(['rest','holiday'].includes(value))return 'rest';
 const day=new Date(date+'T00:00:00Z').getUTCDay();return day===0||day===6?'rest':'work';
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
const p109CalendarUI={key:'',project:null,context:null,chosen:new Set()};
function p109CalendarBusy(){return !!(state.storageBusy||state.importCommitting||p109ConnectionBusy||p109ProjectBusy)}
function p109OpenCalendar(){
 if(p109CalendarBusy()){toast('请先完成当前文件操作',true);return}
 state.dataSection='calendar';navigateWorkspace('data');
}
function p109CalendarPageHtml(){
 const context=state.activeBranch?.id||state.snapshotContext||null;
 if(p109CalendarUI.key!==monthKey()||p109CalendarUI.project!==state.projectDir||p109CalendarUI.context!==context)
  Object.assign(p109CalendarUI,{key:monthKey(),project:state.projectDir,context,chosen:new Set()});
 const chosen=p109CalendarUI.chosen,work=Array.from({length:monthDays()},(_,i)=>dayType(i+1)).filter(x=>x==='work').length;
 return '<section class="p109-calendar-page"><header><h2>工作日管理</h2><label>月份 <input type="month" id="p109CalendarMonth" min="2000-01" max="2100-12" value="'+monthKey()+'"></label></header>'+
  '<p>选择日期后统一设置，仅影响本月。修改后请点击顶部保存。</p>'+
  '<div class="p109-calendar-tools"><button type="button" id="p109CalendarAll">全选</button><button type="button" id="p109CalendarClear">清除选择</button><span id="p109CalendarCount" aria-live="polite">已选 '+chosen.size+' 天</span>'+
  '<button type="button" data-calendar-set="work" '+(chosen.size?'':'disabled')+'>设为工作日</button><button type="button" data-calendar-set="rest" '+(chosen.size?'':'disabled')+'>设为休息日</button></div>'+
  '<div class="p109-calendar-grid" id="p109CalendarGrid" aria-label="'+periodText()+' 日期多选">'+['一','二','三','四','五','六','日'].map(x=>'<b>周'+x+'</b>').join('')+
  '<span></span>'.repeat((new Date(YEAR,MONTH-1,1).getDay()+6)%7)+Array.from({length:monthDays()},(_,i)=>{
   const date=isoDate(i+1),type=dayType(i+1);return '<button type="button" data-calendar-date="'+date+'" class="'+type+(chosen.has(date)?' is-selected':'')+'" aria-pressed="'+chosen.has(date)+'" aria-label="'+date+' '+(type==='work'?'工作日':'休息日')+'"><strong>'+(i+1)+'</strong><small>'+(type==='work'?'工作日':'休息日')+'</small></button>';
  }).join('')+'</div><footer><span>工作日 '+work+' 天 · 休息日 '+(monthDays()-work)+' 天</span><button type="button" id="p109CalendarWeekdays">按周一至周五重置</button></footer></section>';
}
function p109ApplyCalendar(changes){
 if(p109CalendarBusy()){toast('请先完成当前文件操作',true);return false}
 if(p109CalendarUI.key!==monthKey()||p109CalendarUI.project!==state.projectDir)return false;
 const before={},after={};for(const [date,type] of Object.entries(changes)){
  if(!date.startsWith(monthKey()+'-')||!['work','rest'].includes(type))continue;
  const day=Number(date.slice(8));if(!Number.isInteger(day)||day<1||day>monthDays()||date!==isoDate(day))continue;
  if(dayType(day)!==type){before[date]=dayType(day);after[date]=type}
 }
 if(!Object.keys(after).length){toast('所选日期已是该类型');return false}
 state.calendarOverrides={...state.calendarOverrides,...after};
 state.revisions.push({id:'R'+(++state.revisionSeq),action:'month-calendar',month:monthKey(),time:new Date().toISOString(),from:before,to:after});
 state.saved=false;reanalyze();rememberMonth();render();toast('本月日历已更新；请保存月份');return true;
}
function p109WireCalendarPage(root){
 root.querySelector('#p109CalendarMonth')?.addEventListener('change',e=>{
  const value=e.target.value;if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)){e.target.value=monthKey();return}
  if(value===monthKey())return;
  const [year,month]=value.split('-').map(Number);if(!chooseMonth(year,month))e.target.value=monthKey();
 });
 const paintSelection=()=>{
  root.querySelectorAll('[data-calendar-date]').forEach(n=>{const selected=p109CalendarUI.chosen.has(n.dataset.calendarDate);n.classList.toggle('is-selected',selected);n.setAttribute('aria-pressed',String(selected))});
  root.querySelector('#p109CalendarCount').textContent='已选 '+p109CalendarUI.chosen.size+' 天';
  root.querySelectorAll('[data-calendar-set]').forEach(n=>n.disabled=!p109CalendarUI.chosen.size);
 };
 root.querySelectorAll('[data-calendar-date]').forEach(n=>n.onclick=()=>{const date=n.dataset.calendarDate;if(p109CalendarUI.chosen.has(date))p109CalendarUI.chosen.delete(date);else p109CalendarUI.chosen.add(date);paintSelection()});
 root.querySelector('#p109CalendarAll').onclick=()=>{p109CalendarUI.chosen=new Set(Array.from({length:monthDays()},(_,i)=>isoDate(i+1)));paintSelection()};
 root.querySelector('#p109CalendarClear').onclick=()=>{p109CalendarUI.chosen.clear();paintSelection()};
 root.querySelectorAll('[data-calendar-set]').forEach(n=>n.onclick=()=>p109ApplyCalendar(Object.fromEntries([...p109CalendarUI.chosen].map(date=>[date,n.dataset.calendarSet]))));
 root.querySelector('#p109CalendarWeekdays').onclick=()=>p109ApplyCalendar(Object.fromEntries(Array.from({length:monthDays()},(_,i)=>[isoDate(i+1),p109CalendarType(isoDate(i+1))])));
}
document.addEventListener('click',event=>{if(event.target.closest?.('[data-calendar-editor]'))p109OpenCalendar()});
