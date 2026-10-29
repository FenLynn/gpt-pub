'use strict';
// Version 1 remains available for historical frozen workspaces.
function p109NormalizeOvertimeRules(rules,keepLegacy=false){
 const r={...(rules||{}),outingStatisticsRuleVersion:rules?.outingStatisticsRuleVersion??(keepLegacy?1:2),businessRuleVersion:rules?.businessRuleVersion??(keepLegacy?1:2),
  punchRuleVersion:rules?.punchRuleVersion??(keepLegacy?1:2),leaveReturnRuleVersion:rules?.leaveReturnRuleVersion??(keepLegacy?1:2),statisticsRuleVersion:rules?.statisticsRuleVersion??(keepLegacy?1:2),earlyDepartureRuleVersion:rules?.earlyDepartureRuleVersion??(keepLegacy?1:2),midnightInference:rules?.midnightInference??true,
  midnightCutoffMinutes:rules?.midnightCutoffMinutes??360,maxVisitHours:rules?.maxVisitHours??16},number=(value,fallback,min=0)=>value!=null&&Number.isInteger(+value)&&+value>=min&&+value<=240?+value:fallback;
 if(r.overtimeRuleVersion===1||(keepLegacy&&r.overtimeRuleVersion!==2))
  return {...r,overtimeRuleVersion:1,overtimeMinMinutes:number(r.overtimeMinMinutes,20,20)};
 const modern=r.overtimeRuleVersion===2;
 return {...r,overtimeRuleVersion:2,overtimeAfterMinutes:number(modern?r.overtimeAfterMinutes:r.overtimeMinMinutes,20,modern?0:20),
  overtimeBeforeMinutes:number(modern?r.overtimeBeforeMinutes:null,5),overtimeMinMinutes:number(modern?r.overtimeMinMinutes:null,5,1)};
}
function p109ValidOvertimeRules(rules){
 if(rules==null)return true;
 if(typeof rules!=='object'||Array.isArray(rules))return false;
 if(rules.punchRuleVersion!=null&&![1,2].includes(rules.punchRuleVersion))return false;
 if(rules.leaveReturnRuleVersion!=null&&![1,2].includes(rules.leaveReturnRuleVersion))return false;
 if(rules.statisticsRuleVersion!=null&&![1,2].includes(rules.statisticsRuleVersion))return false;
 if(rules.outingStatisticsRuleVersion!=null&&![1,2].includes(rules.outingStatisticsRuleVersion))return false;
 if(rules.earlyDepartureRuleVersion!=null&&![1,2].includes(rules.earlyDepartureRuleVersion))return false;
 if(rules.midnightInference!=null&&typeof rules.midnightInference!=='boolean')return false;
 if(rules.midnightCutoffMinutes!=null&&(!Number.isInteger(rules.midnightCutoffMinutes)||rules.midnightCutoffMinutes<0||rules.midnightCutoffMinutes>720))return false;
 if(rules.maxVisitHours!=null&&(!Number.isFinite(rules.maxVisitHours)||rules.maxVisitHours<1||rules.maxVisitHours>36))return false;
 if(rules.businessRuleVersion!=null&&![1,2].includes(rules.businessRuleVersion))return false;
 if(rules.overtimeRuleVersion==null)return true;
 if(rules.overtimeRuleVersion===1)return Number.isInteger(rules.overtimeMinMinutes)&&rules.overtimeMinMinutes>=20&&rules.overtimeMinMinutes<=240;
 return rules.overtimeRuleVersion===2&&['overtimeAfterMinutes','overtimeBeforeMinutes','overtimeMinMinutes'].every(key=>
  Number.isInteger(rules[key])&&rules[key]>=(key==='overtimeMinMinutes'?1:0)&&rules[key]<=240);
}
function p109OvertimeSessionRules(visit){
 const key=attendanceDateFromMinute(visit.from).slice(0,7);
 const source=key===monthKey()?RULES:(state.snapshotContext?state.overtimeRuleContexts?.[key]:state.monthStores.get(key)?.rules);
 return {...P109_DEFAULT_RULES,...p109NormalizeOvertimeRules(source||RULES,!!(state.snapshotContext||state.activeBranch))};
}
function p109OvertimeSnapshotRules(){
 const {previous,next}=attendanceNeighborDates(),contexts={};
 for(const key of [previous.slice(0,7),next.slice(0,7)]){
  const rules=state.snapshotContext?state.overtimeRuleContexts?.[key]:state.monthStores.get(key)?.rules;
  if(rules)contexts[key]={...P109_DEFAULT_RULES,...p109NormalizeOvertimeRules(rules,!!(state.snapshotContext||state.activeBranch))};
 }
 contexts[monthKey()]={...RULES};return contexts;
}
function p109BusinessPriority(rules=RULES){return rules.businessRuleVersion===2}
function p109FinalStatistics(){return RULES.statisticsRuleVersion===2}
function p111ReportedOutingStatistics(){return RULES.outingStatisticsRuleVersion===2}
function p109ActualOutingFamily(){return p109FinalStatistics()&&!p111ReportedOutingStatistics()}
function p109LeaveReturnOnly(employeeId,date,shiftStart,returned){
 if(RULES.leaveReturnRuleVersion!==2||!p109BusinessPriority())return false;
 const start=minutes(shiftStart),time=typeof returned==='number'?returned:minutes(returned),
  leaves=analysisUnionSegments(leaveFor(employeeId,date).map(r=>[minutes(r.start||RULES.amStart),minutes(r.end||RULES.pmEnd)]));
 return leaves.some(([a,b])=>a<=start+1e-8&&b>=start-1e-8&&time>=b-1e-8);
}
function p109PriorityAbsences(employeeId,date){
 if(!p109BusinessPriority())return [];
 if(state.snapshotContext&&date.slice(0,7)!==monthKey())return [];
 const source=date.slice(0,7)===monthKey()?state:state.monthStores.get(date.slice(0,7))||state,
  trips=[...(source.trips||[]),...(source===state?[]:state.trips||[])];
 if(trips.some(r=>r.employeeId===employeeId&&date>=r.startDate&&date<=r.endDate))return [[0,1440]];
 return analysisUnionSegments((source.leaves||[]).filter(r=>r.employeeId===employeeId&&r.date===date)
  .map(r=>[minutes(r.start||RULES.amStart),minutes(r.end||RULES.pmEnd)]));
}
function p109CountedOvertimeParts(date,from,to){
 if(!p109BusinessPriority()||!attendanceDateIsWork(date))return [[from,to]];
 const rules=date.slice(0,7)===monthKey()?RULES:(state.snapshotContext?state.overtimeRuleContexts?.[date.slice(0,7)]:state.monthStores.get(date.slice(0,7))?.rules)||RULES;
 return p109SubtractOvertime([[from,to]],[[minutes(rules.amStart),minutes(rules.amEnd)],[minutes(rules.pmStart),minutes(rules.pmEnd)]]);
}
function p109CountedOvertimeAbsolute(from,to){
 const parts=[];
 for(let day=Math.floor(from/1440)*1440;day<to;day+=1440)
  for(const [a,b] of p109CountedOvertimeParts(attendanceDateFromMinute(day),Math.max(from,day)-day,Math.min(to,day+1440)-day))parts.push([day+a,day+b]);
 return analysisUnionSegments(parts);
}
function p109RegisteredOvertime(item){return item.countedOvertime||item.overtime||[]}
function p109OvertimeDaySources(rows,date){
 return rows.flatMap(row=>p109CountedOvertimeParts(date,minutes(row.start),minutes(row.end)).map(([from,to])=>
  ({...row,start:attendanceClock(from),end:attendanceClock(to)})));
}
function p109BufferedVisitParts(visit,rules=RULES){
 const after=rules.overtimeAfterMinutes,before=rules.overtimeBeforeMinutes,parts=[],blocked=[];
 for(let cursor=Math.floor(visit.from/1440)*1440-1440;cursor<visit.to;cursor+=1440){
  if(attendanceDateIsWork(attendanceDateFromMinute(cursor)))for(const end of [rules.amEnd,rules.pmEnd]){
   const start=cursor+minutes(end);blocked.push([start,start+after]);
  }
 }
 for(let cursor=Math.floor(visit.from/1440)*1440;cursor<visit.to;cursor+=1440){
  const from=Math.max(visit.from,cursor),to=Math.min(visit.to,cursor+1440);
  if(!attendanceDateIsWork(attendanceDateFromMinute(cursor))){parts.push([from,to]);continue}
  const amStart=cursor+minutes(rules.amStart),amEnd=cursor+minutes(rules.amEnd),
   pmStart=cursor+minutes(rules.pmStart),pmEnd=cursor+minutes(rules.pmEnd);
  const add=(a,b)=>{const x=Math.max(from,a),y=Math.min(to,b);if(y>x)parts.push([x,y])};
  // A qualifying early arrival counts its entire lead, without deducting the gate.
  if(visit.from<=amStart-before+1e-8)add(cursor,amStart);
  if(visit.from<=pmStart-before+1e-8)add(amEnd+after,pmStart);
  add(pmEnd+after,cursor+1440);
 }
 // Merge across civil midnight BEFORE applying the minimum duration.
 return p109SubtractOvertime(analysisUnionSegments(parts),blocked);
}
function p109SubtractOvertime(parts,registered){
 let result=parts;
 for(const [x,y] of analysisUnionSegments(registered))result=result.flatMap(([a,b])=>y<=a||x>=b?[[a,b]]:
  [[a,Math.min(x,b)],[Math.max(y,a),b]].filter(([p,q])=>q>p));
 return result;
}
function p109ModernPunches(rules=RULES){return rules.punchRuleVersion===2||rules.punchRuleVersion==null&&!state.snapshotContext&&!state.activeBranch}
function p109MidnightOvertimePair(employeeId,date){
 if(!p109ModernPunches()||RULES.midnightInference===false)return [];
 const start=attendanceUtcMinute(date),rows=attendanceEmployeeRows(employeeId),
  first=rows.find(r=>r.datetime.slice(0,10)===date);
 if(!first||first.direction!=='出'||minutes(first.time)<=0||minutes(first.time)>(RULES.midnightCutoffMinutes??360))return [];
 if(attendanceVisitEvents(employeeId).some(v=>v.exit===first||v.exit.recordId&&v.exit.recordId===first.recordId))return [];
 const previous=rows.filter(r=>r.datetime.slice(0,10)<date).at(-1);
 if(previous){
  if(previous.direction!=='出')return [];
  const gap=start+minutes(first.time)-attendanceUtcMinute(previous.datetime.slice(0,10),previous.time);
  if(gap<=Math.max(RULES.dupSeconds/60,p109TempRules().limit+p109TempRules().grace)+1e-8)return [];
 }
 const id='auto-midnight:'+employeeId+':'+(first.recordId||first.datetime),to=start+minutes(first.time);
 return [[{time:'00:00:00',sessionFrom:start,sessionTo:to,sessionId:id,inference:'midnight'},first]];
}
function p109OvertimeAccepted(id,fallback=true){
 const values=[state.overtimeReview?.[id],...[...state.monthStores.values()].map(s=>s.overtimeReview?.[id])];
 return values.includes(false)?false:values.includes(true)?true:fallback;
}
function p109BufferedOvertimeCandidate(pairs,day,registered,pairingUncertain=false,employeeId=null){
 const rules=p109NormalizeOvertimeRules(RULES),min=rules.overtimeMinMinutes,
  empty={minutes:0,rawMinutes:0,threshold:min,ruleVersion:rules.overtimeRuleVersion,segments:[]};
 if(pairingUncertain&&(!p109ModernPunches()||rules.overtimeRuleVersion===1))return {...empty,reason:'打卡进出配对待核'};
 const date=isoDate(day),dayStart=attendanceUtcMinute(date),raw=[],segments=[],policies=new Set(),
  registrations=registered.map(r=>[minutes(r.start),minutes(r.end)]);
 let legacyRaw=0;
 for(const [enter,exit] of [...pairs,...(employeeId?p109MidnightOvertimePair(employeeId,date):[])]){
  const visit={from:enter.sessionFrom??dayStart+minutes(enter.time),to:enter.sessionTo??dayStart+minutes(exit.time)};
  if(!Number.isFinite(visit.from)||!Number.isFinite(visit.to)||visit.to<=visit.from)continue;
  const sessionRules=p109OvertimeSessionRules(visit);
  const requiresConfirmation=p109ModernPunches(sessionRules)&&visit.to-visit.from>(sessionRules.maxVisitHours??16)*60+1e-8;
  if(sessionRules.overtimeRuleVersion===1){
   const legacy=p109LegacyOvertimeCandidate([[enter,exit]],day,registered,false,sessionRules);
   legacyRaw+=legacy.rawMinutes;segments.push(...legacy.segments);policies.add('开始月份保留历史门槛 '+sessionRules.overtimeMinMinutes+' 分钟');continue;
  }
  policies.add('班后扣 '+sessionRules.overtimeAfterMinutes+' 分钟、班前门槛 '+sessionRules.overtimeBeforeMinutes+' 分钟、最低 '+sessionRules.overtimeMinMinutes+' 分钟');
  for(const [a,b] of p109BufferedVisitParts(visit,sessionRules)){
   const from=Math.max(a,dayStart)-dayStart,to=Math.min(b,dayStart+1440)-dayStart;
   if(to<=from)continue;
   const pieces=p109SubtractOvertime([[from,to]],registrations);raw.push(...pieces);
   if(b-a+1e-7<sessionRules.overtimeMinMinutes)continue;
   for(const [x,y] of pieces)segments.push({from:x,to:y,minutes:y-x,sessionFrom:visit.from,sessionTo:visit.to,sessionId:enter.sessionId||null,
    inference:enter.inference||null,requiresConfirmation,accepted:!requiresConfirmation});
  }
 }
 return {...empty,minutes:analysisUnionMinutes(segments.map(s=>[s.from,s.to])),rawMinutes:analysisUnionMinutes(raw)+legacyRaw,segments,
  reason:(policies.size?[...policies].join('；'):'无完整进出证据')+'；按会话对应口径核查，连续有效区间跨午夜先判断再按日分摊；登记重叠扣重'};
}
