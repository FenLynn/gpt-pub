'use strict';
// Version 1 remains available for historical frozen workspaces.
function p109NormalizeOvertimeRules(rules,keepLegacy=false){
 const r={...(rules||{})},number=(value,fallback,min=0)=>value!=null&&Number.isInteger(+value)&&+value>=min&&+value<=240?+value:fallback;
 if(r.overtimeRuleVersion===1||(keepLegacy&&r.overtimeRuleVersion!==2))
  return {...r,overtimeRuleVersion:1,overtimeMinMinutes:number(r.overtimeMinMinutes,20,20)};
 const modern=r.overtimeRuleVersion===2;
 return {...r,overtimeRuleVersion:2,overtimeAfterMinutes:number(modern?r.overtimeAfterMinutes:r.overtimeMinMinutes,20,modern?0:20),
  overtimeBeforeMinutes:number(modern?r.overtimeBeforeMinutes:null,5),overtimeMinMinutes:number(modern?r.overtimeMinMinutes:null,5,1)};
}
function p109ValidOvertimeRules(rules){
 if(rules==null)return true;
 if(typeof rules!=='object'||Array.isArray(rules))return false;
 if(rules.overtimeRuleVersion==null)return true;
 if(rules.overtimeRuleVersion===1)return Number.isInteger(rules.overtimeMinMinutes)&&rules.overtimeMinMinutes>=20&&rules.overtimeMinMinutes<=240;
 return rules.overtimeRuleVersion===2&&['overtimeAfterMinutes','overtimeBeforeMinutes','overtimeMinMinutes'].every(key=>
  Number.isInteger(rules[key])&&rules[key]>=(key==='overtimeMinMinutes'?1:0)&&rules[key]<=240);
}
function p109OvertimeSessionRules(visit){
 const key=attendanceDateFromMinute(visit.from).slice(0,7);
 const source=key===monthKey()?RULES:(state.snapshotContext?state.overtimeRuleContexts?.[key]:state.monthStores.get(key)?.rules);
 return {...P109_DEFAULT_RULES,...p109NormalizeOvertimeRules(source||RULES)};
}
function p109OvertimeSnapshotRules(){
 const {previous,next}=attendanceNeighborDates(),contexts={};
 for(const key of [previous.slice(0,7),next.slice(0,7)]){
  const rules=state.snapshotContext?state.overtimeRuleContexts?.[key]:state.monthStores.get(key)?.rules;
  if(rules)contexts[key]={...P109_DEFAULT_RULES,...p109NormalizeOvertimeRules(rules)};
 }
 contexts[monthKey()]={...RULES};return contexts;
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
function p109BufferedOvertimeCandidate(pairs,day,registered,pairingUncertain=false){
 const rules=p109NormalizeOvertimeRules(RULES),min=rules.overtimeMinMinutes,
  empty={minutes:0,rawMinutes:0,threshold:min,ruleVersion:rules.overtimeRuleVersion,segments:[]};
 if(pairingUncertain)return {...empty,reason:'打卡进出配对待核'};
 const date=isoDate(day),dayStart=attendanceUtcMinute(date),raw=[],segments=[],policies=new Set(),
  registrations=registered.map(r=>[minutes(r.start),minutes(r.end)]);
 let legacyRaw=0;
 for(const [enter,exit] of pairs){
  const visit={from:enter.sessionFrom??dayStart+minutes(enter.time),to:enter.sessionTo??dayStart+minutes(exit.time)};
  if(!Number.isFinite(visit.from)||!Number.isFinite(visit.to)||visit.to<=visit.from)continue;
  const sessionRules=p109OvertimeSessionRules(visit);
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
   for(const [x,y] of pieces)segments.push({from:x,to:y,minutes:y-x,sessionFrom:visit.from,sessionTo:visit.to,sessionId:enter.sessionId||null});
  }
 }
 return {...empty,minutes:analysisUnionMinutes(segments.map(s=>[s.from,s.to])),rawMinutes:analysisUnionMinutes(raw)+legacyRaw,segments,
  reason:(policies.size?[...policies].join('；'):'无完整进出证据')+'；按会话对应口径核查，连续有效区间跨午夜先判断再按日分摊；登记重叠扣重'};
}
