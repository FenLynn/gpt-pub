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
 // Preserve the old effective October schedule only while reading old months.
 if(legacy&&Number(year)===2026&&Number(month)===10){
  for(let day=1;day<=7;day++)result['2026-10-0'+day]??='rest';
  result['2026-10-10']??='work';
 }
 return result;
}
function p109OpenCalendar(){
 if(state.storageBusy||state.importCommitting||p109ConnectionBusy||p109ProjectBusy){toast('请先完成当前文件操作',true);return}
 document.getElementById('p109CalendarOverlay')?.remove();
 const key=monthKey(),project=state.projectDir,previous=document.activeElement,
  draft=Object.fromEntries(Array.from({length:monthDays()},(_,i)=>[isoDate(i+1),dayType(i+1)]));
 const overlay=document.createElement('div');overlay.id='p109CalendarOverlay';overlay.className='p109-interval-overlay';
 overlay.innerHTML='<section class="p109-calendar-dialog" role="dialog" aria-modal="true" aria-labelledby="p109CalendarTitle">'+
  '<header><strong id="p109CalendarTitle">'+periodText()+' · 工作与休息日</strong><button type="button" data-calendar-close aria-label="关闭">×</button></header>'+
  '<p>点击日期切换工作 / 休息；仅应用当前月份。绿色为工作，灰色为休息。</p><div class="p109-calendar-grid" id="p109CalendarGrid"></div>'+
  '<footer><button type="button" id="p109CalendarWeekdays">按周一至周五重置</button><span></span><button type="button" data-calendar-close>取消</button><button type="button" class="primary" id="p109CalendarApply">应用本月日历</button></footer></section>';
 document.body.appendChild(overlay);const panel=overlay.querySelector('section'),grid=overlay.querySelector('#p109CalendarGrid');
 const paint=()=>{
  grid.innerHTML=['一','二','三','四','五','六','日'].map(x=>'<b>周'+x+'</b>').join('')+
   '<span></span>'.repeat((new Date(YEAR,MONTH-1,1).getDay()+6)%7)+Object.entries(draft).map(([date,type])=>
    '<button type="button" data-calendar-date="'+date+'" class="'+type+'" aria-pressed="'+(type==='work')+'" aria-label="'+date+' '+(type==='work'?'工作日':'休息日')+'"><strong>'+Number(date.slice(8))+'</strong><small>'+(type==='work'?'工作':'休息')+'</small></button>').join('');
  grid.querySelectorAll('button').forEach(button=>button.onclick=()=>{const date=button.dataset.calendarDate;draft[date]=draft[date]==='work'?'rest':'work';paint();grid.querySelector('[data-calendar-date="'+date+'"]').focus()});
 };
 const close=()=>{overlay.remove();document.removeEventListener('keydown',onKey,true);if(previous?.isConnected)previous.focus()};
 const onKey=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close()}else p109TrapDialogFocus(e,panel)};
 document.addEventListener('keydown',onKey,true);overlay.querySelectorAll('[data-calendar-close]').forEach(n=>n.onclick=close);
 overlay.onclick=e=>{if(e.target===overlay)close()};
 overlay.querySelector('#p109CalendarWeekdays').onclick=()=>{for(const date of Object.keys(draft))draft[date]=p109CalendarType(date);paint()};
 overlay.querySelector('#p109CalendarApply').onclick=()=>{
  if(monthKey()!==key||state.projectDir!==project){toast('工作区已改变，请重新编辑日历',true);close();return}
  const before=Object.fromEntries(Object.keys(draft).map(date=>[date,dayType(Number(date.slice(8)))]));
  if(JSON.stringify(before)!==JSON.stringify(draft)){
   state.calendarOverrides={...Object.fromEntries(Object.entries(state.calendarOverrides||{}).filter(([date])=>!date.startsWith(key+'-'))),...draft};
   state.revisions.push({id:'R'+(++state.revisionSeq),action:'month-calendar',month:key,time:new Date().toISOString(),from:before,to:{...draft}});
   state.saved=false;rememberMonth();reanalyze();
  }
  close();render();toast('本月日历已应用；请保存月份');
 };
 paint();overlay.querySelector('#p109CalendarWeekdays').focus();
}
document.addEventListener('click',event=>{if(event.target.closest?.('[data-calendar-editor]'))p109OpenCalendar()});
