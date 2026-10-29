/* Short departures use adjacent exit/entry evidence. Manual intervals remain
 * separate from imported files and are persisted with monthly working state. */
'use strict';
function p109TempRules(){
 const number=(value,fallback,max)=>Number.isFinite(+value)&&+value>=0&&+value<=max?+value:fallback;
 return {limit:number(RULES.tempOutingMinutes,10,240),grace:number(RULES.tempOutingGraceMinutes,2,60)};
}
function p109IntervalClock(value){const t=attendanceClock(value);return t.endsWith(':00')?t.slice(0,5):t}
function p109IntervalDuration(value){
 const seconds=Math.round(value*60);return seconds%60?Math.floor(seconds/60)+' 分 '+seconds%60+' 秒':fmtMinutes(value);
}
function p109IntervalIcon(kind){
 const shape=kind==='circle'?'<circle cx="10" cy="10" r="5" fill="currentColor"/>':
  '<path d="'+({plus:'M10 4v12M4 10h12',close:'M5 5l10 10M15 5L5 15',check:'M4 10l4 4 8-8'}[kind]||'')+'" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
 return '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">'+shape+'</svg>';
}
function p109WorkParts(from,to,day){
 if(!isWorkday(day)||!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return [];
 return [[minutes(RULES.amStart),minutes(RULES.amEnd)],[minutes(RULES.pmStart),minutes(RULES.pmEnd)]]
  .map(([a,b])=>[Math.max(a,from),Math.min(b,to)]).filter(([a,b])=>b>a);
}
function p109TempDecision(parts,reports,day,shift=null){
 const {limit,grace}=p109TempRules(),duration=analysisUnionMinutes(parts);
 const coverage=analysisUnionSegments(reports.map(r=>[minutes(r.start),minutes(r.end)]));
 if(parts.every(([a,b])=>coverage.some(([from,to])=>from<=a+1e-8&&to>=b-1e-8)))
  return {system:'green',businessCovered:true,reason:'出差/外出报备完全覆盖，以报备为准'};
 if(duration<=limit+grace+1e-8)return {system:'green',reason:'班内外出不超过 '+limit+' + '+grace+' 分钟'};
 // Merge overlapping registrations without adding their durations twice.
 const clusters=analysisUnionSegments(reports.map(r=>[minutes(r.start),minutes(r.end)]));
 for(const [from,to] of clusters){
  if(!parts.some(([a,b])=>intervalOverlap(a,b,from,to)>0))continue;
  if(parts.every(([a,b])=>a>=from-grace-1e-8&&b<=to+grace+1e-8))
   return {system:'green',reason:'报备覆盖实际班内外出（起止各容差 '+grace+' 分钟）'};
  let reported=p109WorkParts(from,to,day);
  if(shift){const window=shift==='am'?[minutes(RULES.amStart),minutes(RULES.amEnd)]:[minutes(RULES.pmStart),minutes(RULES.pmEnd)];
   reported=reported.map(([a,b])=>[Math.max(a,window[0]),Math.min(b,window[1])]).filter(([a,b])=>b>a)}
  const registered=analysisUnionMinutes(reported);
  if(Math.abs(duration-registered)<=grace+1e-8)
   return {system:'green',reason:'与报备有实际重叠，班内时长相差不超过 '+grace+' 分钟'};
 }
 return {system:'red',reason:'超过短时外出限额，且报备未覆盖或时长不匹配'};
}
function p109TemporaryOutings(employee,date,punches,pairs=attendanceDailyVisits(employee.id,date)){
 const day=Number(date.slice(8,10));if(!isWorkday(day))return [];
 const candidates=[],priority=p109PriorityAbsences(employee.id,date),modern=p109BusinessPriority();
 const candidatePunches=punches.filter(p=>!modern||['进','出'].includes(p.direction)||!priority.some(([a,b])=>minutes(p.time)>=a&&minutes(p.time)<=b));
 for(let i=1;i<candidatePunches.length;i++){
  const exit=candidatePunches[i-1],enter=candidatePunches[i];
  if(exit.direction!=='出'||enter.direction!=='进')continue;
  const from=minutes(exit.time),to=minutes(enter.time);
  if(to<=from)continue;
  const evidence=r=>r.recordId||[r.importId||'',r.datetime,r.row||''].join('/');
  candidates.push({id:'temp:'+employee.id+':'+evidence(exit)+'>'+evidence(enter),
   from,to,origin:'auto',sourceIds:[exit.recordId,enter.recordId].filter(Boolean)});
 }
 // A leave touching a shift boundary can establish a missing return/departure
 // without inventing an unknown punch. The actual terminal card remains evidence.
 if(modern&&priority.length&&punches.length){
  const first=punches[0],last=punches.at(-1),begin=minutes(RULES.amStart),finish=minutes(RULES.pmEnd),
   addBoundary=(from,to,card,side)=>{
    if(to<=from||!priority.some(([a,b])=>intervalOverlap(from,to,a,b)>0))return;
    candidates.push({id:'temp-boundary:'+employee.id+':'+date+':'+side+':'+(card.recordId||card.datetime),from,to,origin:'auto',leaveBoundary:true,sourceIds:[card.recordId].filter(Boolean)});
   };
  if(first.direction==='进'&&pairs.some(([enter])=>minutes(enter.time)===minutes(first.time)))addBoundary(begin,minutes(first.time),first,'return');
  if(last.direction==='出'&&pairs.some(([,exit])=>minutes(exit.time)===minutes(last.time)))addBoundary(minutes(last.time),finish,last,'departure');
 }
 for(const row of state.manualTempOutings||[]){
  if(row.employeeId===employee.id&&row.date===date&&validClock(row.start)&&validClock(row.end))
   candidates.push({id:row.id,from:minutes(row.start),to:minutes(row.end),origin:'manual',note:row.note||''});
 }
 const reports=[...outingFor(employee.id,date),...(modern?[]:tripFor(employee.id,date).map(r=>({...r,start:'00:00',end:'24:00'})))],completedExits=new Set(pairs.map(([,exit])=>minutes(exit.time)));
 return candidates.flatMap(row=>{
  const manual=(state.manualTempOutings||[]).find(r=>r.id===row.id),
   windows=[['am',minutes(RULES.amStart),minutes(RULES.amEnd)],['pm',minutes(RULES.pmStart),minutes(RULES.pmEnd)]],
   pieces=windows.filter(([shift])=>!manual?.part||manual.part===shift).map(([shift,a,b])=>({shift,part:[Math.max(a,row.from),Math.min(b,row.to)]})).filter(r=>r.part[1]>r.part[0]),split=pieces.length>1;
  return pieces.flatMap(({shift,part})=>{
   const baseId=split?row.id+':'+shift:row.id,uncovered=p109SubtractOvertime([part],priority),clipped=analysisUnionMinutes(uncovered)<part[1]-part[0]-1e-8;
   return uncovered.map(part=>{
   const id=clipped?baseId+':gap:'+Math.round(part[0]*60)+'-'+Math.round(part[1]*60):baseId,parts=[part],decision=p109TempDecision(parts,reports,day,shift),
    override=state.tempOutingReview?.[id]??state.tempOutingReview?.[baseId]??state.tempOutingReview?.[row.id];
   return {...row,...decision,id,parentId:row.id,leaveBoundary:row.leaveBoundary||clipped,sourceFrom:row.from,sourceTo:row.to,from:part[0],to:part[1],split,shift,employeeId:employee.id,date,parts,minutes:analysisUnionMinutes(parts),
    reason:(clipped?'已扣除出差/请假覆盖，仅核查本段；':'')+decision.reason,
    status:override==='exclude'?'exclude':decision.businessCovered?'green':['green','red'].includes(override)?override:decision.system,manualDecision:!!override&&(!decision.businessCovered||override==='exclude')};
  })});
 }).filter(row=>row.minutes>0&&!(row.origin==='manual'&&row.status==='exclude')&&
  !(row.origin==='auto'&&!row.leaveBoundary&&row.minutes<p109TempRules().limit+p109TempRules().grace-1e-8&&
    completedExits.has(row.sourceFrom)&&row.sourceTo>=minutes(row.shift==='am'?RULES.amEnd:RULES.pmEnd)&&
    row.sourceFrom>=minutes(row.shift==='am'?RULES.amStart:RULES.pmStart)));
}
function p109SplitManualOutings(data){
 const rules={...P109_DEFAULT_RULES,...(data.rules||RULES)},next=[];let changed=false;
 for(const row of data.manualTempOutings||[]){
  if(row.part){next.push(row);continue}
  const pieces=[['am',rules.amStart,rules.amEnd],['pm',rules.pmStart,rules.pmEnd]]
   .filter(([,a,b])=>Math.min(minutes(row.end),minutes(b))>Math.max(minutes(row.start),minutes(a)));
  if(!pieces.length){next.push(row);continue}
  changed=true;
  for(const [part] of pieces){
   const id=pieces.length>1?row.id+':'+part:row.id;next.push({...row,id,part});
   if(id!==row.id&&Object.prototype.hasOwnProperty.call(data.tempOutingReview||{},row.id))data.tempOutingReview[id]=data.tempOutingReview[row.id];
  }
  if(pieces.length>1){
   if(data.tempOutingReview)delete data.tempOutingReview[row.id];
   data.revisions=(data.revisions||[]).flatMap(revision=>revision.segmentId===row.id?pieces.map(([part])=>({...revision,id:revision.id+':'+part,segmentId:row.id+':'+part})):revision);
  }
 }
 if(changed)data.manualTempOutings=next;return changed;
}
function p109SetAttendanceDecision(id,accepted){
 const flag=[...state.analysis.values()].flatMap(a=>a.attendanceFlags||[]).find(r=>r.id===id);
 if(!flag)return false;
 state.attendanceReview??={};const before=state.attendanceReview[id]!==false;
 if(accepted)delete state.attendanceReview[id];else state.attendanceReview[id]=false;
 if(!accepted)state.judgmentMode='manual';else if(!hasManualStatuses())state.judgmentMode='initial';
 state.revisions.push({id:'R'+(++state.revisionSeq),key:flag.employeeId+'|'+Number(flag.date.slice(8,10)),action:'attendance-flag-inclusion',segmentId:id,from:before,to:!!accepted,time:new Date().toISOString()});
 state.saved=false;rememberMonth();reanalyze();render();return true;
}
function activeTemporaryOutings(a){return (a?.temporaryOutings||[]).filter(row=>row.status!=='exclude')}
function p109RenameIntervalState(data,oldId,newId){
 if(oldId===newId)return;
 const change=key=>String(key).replace('temp:'+oldId+':','temp:'+newId+':')
  .replace('auto-midnight:'+oldId+':','auto-midnight:'+newId+':')
  .replace('manual-temp:'+oldId+':','manual-temp:'+newId+':')
  .replace('manual-overtime:'+oldId+':','manual-overtime:'+newId+':').replace('attendance:'+oldId+':','attendance:'+newId+':');
 for(const field of ['manualTempOutings','manualOvertime'])for(const row of data[field]||[]){
  if(row.employeeId===oldId)row.employeeId=newId;row.id=change(row.id);
 }
 for(const field of ['tempOutingReview','overtimeReview','attendanceReview'])
  data[field]=Object.fromEntries(Object.entries(data[field]||{}).map(([key,v])=>[change(key),v]));
 for(const revision of data.revisions||[])if(revision.segmentId)revision.segmentId=change(revision.segmentId);
}
function p109TempSummary(items){
 const days=items.filter(Boolean),rows=days.flatMap(activeTemporaryOutings);
 return {count:rows.length,green:rows.filter(r=>r.status==='green').length,
  red:rows.filter(r=>r.status==='red').length,minutes:p109FinalStatistics()?days.reduce((sum,a)=>sum+behaviorMinutes(a,'outing'),0):rows.reduce((sum,r)=>sum+r.minutes,0)};
}
function p109TempSummaryHtml(items,compact=false){
 const total=p109TempSummary(items),{limit,grace}=p109TempRules();
 return '<section tabindex="0" data-r73-tip="班次内统计；短时限额 '+limit+' 分钟，冗余 '+grace+' 分钟。自动 × 排除留痕，手工 × 删除本段；跨午休分别统计。" class="p109-temp-summary'+(compact?' compact':'')+'" aria-label="临时外出统计">'+
  '<header><strong>临时外出</strong><span>'+total.count+' 次</span></header>'+
  '<div><span class="temp-green">绿色 <b>'+total.green+'</b></span><span class="temp-red">红色 <b>'+total.red+'</b></span><span>'+p109IntervalDuration(total.minutes)+'</span></div>'+
  '</section>';
}
function p109IntervalDirty(action,row,extra={}){
 const facts=action==='add-temporary-outing'?(state.manualTempOutings||[]).filter(r=>r.id===row.id||r.id.startsWith(row.id+':')):[row];
 for(const fact of facts)state.revisions.push({id:'R'+(++state.revisionSeq),key:fact.employeeId+'|'+Number(fact.date.slice(8,10)),
  action,segmentId:fact.id,time:new Date().toISOString(),...extra});
 state.saved=false;rememberMonth();reanalyze();render();
}
function p109RemoveManualFacts(data,ids){
 let changed=false;
 for(const field of ['manualTempOutings','manualOvertime','revisions']){
  const rows=data[field]||[],next=rows.filter(r=>!ids.has(field==='revisions'?r.segmentId:r.id));
  if(rows.length!==next.length){data[field]=next;changed=true}
 }
 for(const field of ['tempOutingReview','overtimeReview'])if(data[field])for(const id of ids){
  if(Object.prototype.hasOwnProperty.call(data[field],id)){delete data[field][id];changed=true}
 }
 return changed;
}
function p109PruneExcludedManual(data){
 const ids=new Set([
  ...(data.manualTempOutings||[]).filter(r=>data.tempOutingReview?.[r.id]==='exclude'),
  ...(data.manualOvertime||[]).filter(r=>data.overtimeReview?.[r.id]===false)
 ].map(r=>r.id));
 return ids.size?p109RemoveManualFacts(data,ids):false;
}
function p109DeleteManualInterval(kind,id){
 const field=kind==='outing'?'manualTempOutings':'manualOvertime',ids=new Set([id]),
  exists=[state,...state.monthStores.values()].some(s=>(s[field]||[]).some(r=>r.id===id));
 if(!exists)return false;
 p109RemoveManualFacts(state,ids);const touched=[];
 for(const [key,store] of state.monthStores)if(p109RemoveManualFacts(store,ids)){store.saved=false;touched.push(key)}
 state.saved=false;rememberMonth();reanalyze();render();
 const other=touched.filter(key=>key!==monthKey());
 if(other.length&&!state.projectDir?.__p109Portable)toast('补录已删除；另请保存涉及的月份：'+other.join('、'));
 return true;
}
function p109SetTempDecision(id,status){
 if(![null,'green','red','exclude'].includes(status))return false;
 const row=[...state.analysis.values()].flatMap(a=>a.temporaryOutings||[]).find(r=>r.id===id);
 if(!row)return false;
 if(row.businessCovered&&status==='red'){toast('该时段已由出差/外出报备完全覆盖，以报备为准',true);return false}
 if(row.origin==='manual'&&status==='exclude')return p109DeleteManualInterval('outing',row.parentId||id);
 if(status!=='exclude'&&activeTemporaryOutings(state.analysis.get(row.employeeId+'|'+Number(row.date.slice(8,10))))
  .some(other=>other.id!==id&&other.parts.some(([a,b])=>row.parts.some(([x,y])=>intervalOverlap(a,b,x,y)>0)))){
  toast('与已纳入的临时外出重叠，请先排除重复区间',true);return false;
 }
 const before=state.tempOutingReview?.[id]||null;state.tempOutingReview??={};
 if(row.parentId!==id&&Object.prototype.hasOwnProperty.call(state.tempOutingReview,row.parentId)){
  for(const sibling of [...state.analysis.values()].flatMap(a=>a.temporaryOutings||[]).filter(r=>r.parentId===row.parentId))
   if(!Object.prototype.hasOwnProperty.call(state.tempOutingReview,sibling.id))state.tempOutingReview[sibling.id]=state.tempOutingReview[row.parentId];
  delete state.tempOutingReview[row.parentId];
 }
 if(status)state.tempOutingReview[id]=status;else delete state.tempOutingReview[id];
 p109IntervalDirty('temporary-outing-review',row,{from:before,to:status});return true;
}
function p109TempDayHtml(item){
 const rows=item.temporaryOutings||[];
 const details='<button class="p109-temp-detail-button" type="button" data-temp-details="'+safeTableText(item.employee.id)+'" data-temp-day="'+item.day+'" '+(rows.length?'':'disabled')+'>区间明细 · '+rows.length+' 段</button>';
 return '<div class="p109-temp-block">'+p109TempSummaryHtml([item]).replace('</header>',(rows.length?details:'')+'</header>')+'</div>';
}
function p109ShowTempDetails(employeeId,day){
 const item=state.analysis.get(employeeId+'|'+day);if(!item)return;
 document.getElementById('p109TempDetailsDialog')?.remove();
 const node=document.createElement('section');node.id='p109TempDetailsDialog';node.className='p109-recent-overlay';node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.setAttribute('aria-labelledby','p109TempDetailsTitle');
 node.innerHTML='<div class="p109-temp-dialog"><header><h2 id="p109TempDetailsTitle">'+safeTableText(item.employee.name)+' · '+pad(day)+' 日临时外出</h2><button type="button" data-temp-close aria-label="关闭临时外出明细">×</button></header><div class="p109-temp-details">'+(item.temporaryOutings||[]).map(row=>
  '<div class="'+row.status+'"><span>'+safeTableText((row.origin==='manual'?'补录 ':'')+p109IntervalClock(row.from)+'–'+p109IntervalClock(row.to))+
  ' · '+p109IntervalDuration(row.minutes)+(row.status==='exclude'?' · 已排除':'')+'</span>'+
  '<span>'+({red:'红色',green:'绿色',exclude:'排除'}[row.status])+'</span>'+(row.manualDecision?'<button type="button" data-temp-reset="'+safeTableText(row.id)+'">恢复自动</button>':'')+'</div>').join('')+'</div></div>';
 document.body.appendChild(node);
 const close=()=>{node.remove();document.querySelector('[data-temp-details="'+CSS.escape(employeeId)+'"]')?.focus()};
 node.querySelector('[data-temp-close]').onclick=close;
 node.querySelectorAll('[data-temp-reset]').forEach(button=>button.onclick=()=>{p109SetTempDecision(button.dataset.tempReset,null);p109ShowTempDetails(employeeId,day)});
 node.onclick=e=>{if(e.target===node)close()};node.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}else p109TrapDialogFocus(e,node)};
 node.querySelector('[data-temp-close]').focus();
}
document.addEventListener('click',e=>{const b=e.target.closest?.('[data-temp-details]');if(b)p109ShowTempDetails(b.dataset.tempDetails,Number(b.dataset.tempDay))});
function p109ManualOvertimeFor(employeeId,date){
 const day=attendanceUtcMinute(date),rows=[];
 for(const row of attendanceAdjacentRows('manualOvertime')){
  if(row.employeeId!==employeeId||!strictISODate(row.date)||!validClock(row.start)||!validClock(row.end))continue;
  const from=attendanceUtcMinute(row.date,row.start),to=attendanceUtcMinute(row.date,row.end)+
   (minutes(row.end)<minutes(row.start)?1440:0);
  if(to<=from||to-from>1440||to<=day||from>=day+1440)continue;
  rows.push({id:row.id,from:Math.max(from,day)-day,to:Math.min(to,day+1440)-day,
   sessionFrom:from,sessionTo:to,origin:'manual',note:row.note||''});
 }
 return rows;
}
function p109CompleteOvertime(candidate,employeeId,date,registered){
 const manual=p109ManualOvertimeFor(employeeId,date).flatMap(row=>p109CountedOvertimeParts(date,row.from,row.to).map(([from,to])=>({...row,from,to}))),
  excluded=id=>state.overtimeReview?.[id]===false||[...state.monthStores.values()].some(s=>s.overtimeReview?.[id]===false),
  regs=registered.map(r=>[minutes(r.start),minutes(r.end)]),taken=[...regs],segments=[];
 const subtract=(row,intervals)=>{
  let pieces=[[row.from,row.to]];
  for(const [x,y] of analysisUnionSegments(intervals))pieces=pieces.flatMap(([a,b])=>
   y<=a||x>=b?[[a,b]]:[[a,Math.min(x,b)],[Math.max(y,a),b]].filter(([p,q])=>q>p));
  return pieces.map(([from,to])=>({...row,from,to,minutes:to-from,employeeId,date}));
 };
 // Deleting a manual addition restores genuine automatic evidence underneath.
 for(const row of manual){
  if(excluded(row.id))continue;
  const accepted=!excluded(row.id),parts=subtract({...row,accepted},taken);
  segments.push(...parts);if(accepted)taken.push(...parts.map(p=>[p.from,p.to]));
 }
 for(const row of candidate.segments){
  for(const [from,to] of p109CountedOvertimeParts(date,row.from,row.to))
   segments.push(...subtract({...row,from,to,id:row.sessionId,origin:'auto',accepted:p109OvertimeAccepted(row.sessionId,row.accepted!==false)},taken));
 }
 return {...candidate,segments,minutes:analysisUnionMinutes(segments.filter(s=>s.accepted!==false).map(s=>[s.from,s.to])),
  reason:manual.length?'自动推算与手工补录共用统计；登记、补录与自动区间不重复计时':candidate.reason};
}
function p109OpenIntervalEditor(kind,employeeId,date){
 const employee=EMPLOYEES.find(e=>e.id===employeeId),key=monthKey(),project=state.projectDir;
 if(!employee||!strictISODate(date)||!date.startsWith(key+'-'))return;
 if(state.storageBusy||state.importCommitting||p109ConnectionBusy||p109ProjectBusy){toast('请先完成当前文件操作',true);return}
 document.getElementById('p109IntervalOverlay')?.remove();
 const previous=document.activeElement,outing=kind==='outing',title=outing?'补录临时外出':'补录加班';
 const overlay=document.createElement('div');overlay.id='p109IntervalOverlay';overlay.className='p109-interval-overlay';
 overlay.innerHTML='<form class="p109-interval-dialog" role="dialog" aria-modal="true" aria-labelledby="p109IntervalTitle">'+
  '<header><strong id="p109IntervalTitle">'+title+'</strong><button type="button" data-interval-close aria-label="关闭">×</button></header>'+
  '<p>'+safeTableText(employee.name)+' · '+date+'</p><div class="p109-interval-times">'+
  '<label>开始时间<input id="p109IntervalStart" type="time" required step="60"></label>'+
  '<label>结束时间<input id="p109IntervalEnd" type="time" required step="60"></label></div>'+
  '<label>备注（可选）<input id="p109IntervalNote" type="text" maxlength="200"></label>'+
  '<p class="p109-interval-hint">'+(outing?'只计工作日班次内部分；与自动识别区间重叠时，请先排除原区间。补录不等于报备。':'结束早于开始表示次日结束，最长 24 小时。补录不受自动加班门槛限制，重叠分钟不重复统计。')+'</p>'+
  '<p id="p109IntervalError" role="alert"></p><footer><button type="button" data-interval-close>取消</button><button type="submit" class="primary">添加</button></footer></form>';
 document.body.appendChild(overlay);
 const form=overlay.querySelector('form'),start=form.querySelector('#p109IntervalStart'),end=form.querySelector('#p109IntervalEnd'),error=form.querySelector('#p109IntervalError');
 start.value=outing?'10:00':RULES.pmEnd;end.value=outing?'10:20':'18:00';
 const close=()=>{overlay.remove();document.removeEventListener('keydown',keyDown,true);if(previous?.isConnected)previous.focus()};
 const keyDown=e=>{
  if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close()}
  if(e.key==='Tab'){
   const focus=[...form.querySelectorAll('button,input')].filter(n=>!n.disabled),first=focus[0],last=focus.at(-1);
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
   else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  }
 };
 document.addEventListener('keydown',keyDown,true);
 overlay.querySelectorAll('[data-interval-close]').forEach(b=>b.onclick=close);overlay.onclick=e=>{if(e.target===overlay)close()};
 form.onsubmit=e=>{
  e.preventDefault();error.textContent='';
  if(monthKey()!==key||state.projectDir!==project||!EMPLOYEES.some(e=>e.id===employeeId)){error.textContent='工作区已改变，请关闭后重试';return}
  if(!validClock(start.value)||!validClock(end.value)||start.value===end.value){error.textContent='请填写不同的有效起止时间';return}
  const from=minutes(start.value),to=minutes(end.value),parts=p109WorkParts(from,to,Number(date.slice(8,10)));
  if(outing&&(to<=from||!parts.length)){error.textContent='临时外出须在同日结束，并与工作日班次相交';return}
  const row={id:(outing?'manual-temp:':'manual-overtime:')+employeeId+':'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),
   employeeId,date,start:start.value,end:end.value,note:form.querySelector('#p109IntervalNote').value.trim(),origin:'manual'};
  if(outing){
   if(!p109SubtractOvertime(parts,p109PriorityAbsences(employeeId,date)).length){error.textContent='所选班内时段已由出差或请假完整覆盖，无需补录临时外出';return}
   const conflict=activeTemporaryOutings(state.analysis.get(employeeId+'|'+Number(date.slice(8,10))))
    .some(r=>r.parts.some(([a,b])=>p109SubtractOvertime(parts,p109PriorityAbsences(employeeId,date)).some(([x,y])=>intervalOverlap(a,b,x,y)>0)));
   if(conflict){error.textContent='与已有临时外出重叠。请先用 × 排除原区间，再补录，避免重复统计';return}
  }else{
   const begin=attendanceUtcMinute(date,row.start),finish=attendanceUtcMinute(date,row.end)+(to<from?1440:0),
    covered=[...attendanceAdjacentRows('overtimeEntries'),...attendanceAdjacentRows('manualOvertime').filter(r=>state.overtimeReview?.[r.id]!==false)]
     .filter(r=>r.employeeId===employeeId&&strictISODate(r.date)&&validClock(r.start)&&validClock(r.end))
     .map(r=>[Math.max(begin,attendanceUtcMinute(r.date,r.start)),Math.min(finish,attendanceUtcMinute(r.date,r.end)+(minutes(r.end)<minutes(r.start)?1440:0))]);
   if(!p109CountedOvertimeAbsolute(begin,finish).length){error.textContent='所选时段全部处于工作日班次内，不能补录为加班；原有登记仍可在原始记录中核查';return}
   if(analysisUnionMinutes(covered)>=finish-begin-1e-8){error.textContent='所选时段已由登记或已纳入的补录覆盖，无需重复添加';return}
  }
  const field=outing?'manualTempOutings':'manualOvertime';state[field]??=[];state[field].push(row);
  if(outing)p109SplitManualOutings(state);
  close();p109IntervalDirty(outing?'add-temporary-outing':'add-manual-overtime',row,{start:row.start,end:row.end,note:row.note});
 };
 start.focus();
}
