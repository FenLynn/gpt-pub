/* R68 · Scope-specific evidence summary. Replaces low-information pie + giant bars. */
'use strict';
function r68ScopeRankData(people,work){
 const grouped=state.workspaceMode==='group'
  ?people.map(e=>({label:e.name,people:[e],id:e.id}))
  :workspaceGroups().map(g=>({label:g,people:people.filter(e=>groupOf(e)===g),id:g}))
   .filter(x=>x.people.length);
 return grouped.map(group=>{
  const ids=new Set(group.people.map(e=>e.id)),
   days=work.filter(a=>ids.has(a.employee.id)),normal=days.filter(a=>attendanceJudgment(a)==='normal').length,
   anomaly=days.filter(a=>attendanceJudgment(a)==='anomaly').length,
   absent=days.filter(a=>attendanceJudgment(a)==='absent').length;
  const total=normal+anomaly+absent;
  return {...group,normal,anomaly,absent,issues:anomaly+absent,total,
   rate:total?100*(anomaly+absent)/total:0};
 });
}
function r68ScopeMetric(row,metric){
 return metric==='absent'?row.absent:metric==='rate'?row.rate:row.issues;
}
function r68ScopeRender(){
 const target=document.getElementById('scopeSummary');if(target)target.innerHTML='';
 const insight=document.getElementById('scopeInsights');if(!insight)return;
 if(typeof disposeAttendCharts==='function')disposeAttendCharts();
 const {people,items}=scopeAnalysisItems();
 const hint=document.querySelector('.workspace-toolbar .workspace-hint');if(hint)hint.textContent=people.length+' 人';
 const work=items.filter(a=>isWorkday(a.day));
 const tally={normal:0,anomaly:0,absent:0};
 for(const row of work){const v=attendanceJudgment(row);if(v in tally)tally[v]++}
 const total=tally.normal+tally.anomaly+tally.absent,issues=tally.anomaly+tally.absent,
   pct=n=>total?100*n/total:0,group=state.workspaceMode==='group',mode=r68UI.rankMode||'issue';
 const daily=Array.from({length:monthDays()},(_,i)=>i+1).filter(isWorkday)
  .map(day=>({day,value:work.filter(a=>a.day===day&&['anomaly','absent'].includes(attendanceJudgment(a))).length}));
 const peak=[...daily].sort((a,b)=>b.value-a.value)[0]||{day:0,value:0};
 const data=r68ScopeRankData(people,work).sort((a,b)=>
  r68ScopeMetric(b,mode)-r68ScopeMetric(a,mode)||a.label.localeCompare(b.label,'zh-CN'));
 const max=Math.max(1,...data.map(x=>r68ScopeMetric(x,mode)));
 const leader=data[0],leaderLabel=leader?r68Esc(leader.label):'无';
 const statusTotal=total?total:1;
 const label=group?'组内成员':'组别';
 insight.innerHTML='<section class="r68-scope-top"><div class="r68-scope-topline"><h3>'+
  (group?r68Esc(state.selectedGroup||'分组')+' · 组别概览':'全员 · 考勤概览')+
   '</h3><span>'+people.length+' 人</span></div>'+
  '<div class="r68-scope-kpis">'+
   [['正常',tally.normal,'good'],['异常',tally.anomaly,'warn'],
    ['缺勤',tally.absent,'bad'],['异常及缺勤率',pct(issues).toFixed(1)+'%','neutral']].map(([n,v,t])=>
     '<div class="r68-kpi '+t+'"><small>'+n+'</small><strong>'+v+'</strong></div>').join('')+'</div>'+
  '<div class="r68-scope-composition"><div class="r68-scope-section-title">工作日状态分布<span>'+total+' 人日</span></div>'+
  '<div class="r68-stacked-track" aria-label="正常 '+tally.normal+' 异常 '+tally.anomaly+' 缺勤 '+tally.absent+'">'+
   '<span class="good" style="width:'+pct(tally.normal)+'%" title="正常 '+tally.normal+'"></span>'+
   '<span class="warn" style="width:'+pct(tally.anomaly)+'%" title="异常 '+tally.anomaly+'"></span>'+
   '<span class="bad" style="width:'+pct(tally.absent)+'%" title="缺勤 '+tally.absent+'"></span></div>'+
  '<div class="r68-stacked-legend">'+[
   ['正常',tally.normal,'good'],['异常',tally.anomaly,'warn'],['缺勤',tally.absent,'bad']
  ].map(([n,v,k])=>'<span><i class="'+k+'"></i>'+n+' '+pct(v).toFixed(1)+'%</span>').join('')+'</div></div></section>'+
  '<section class="r68-scope-block"><div class="r68-scope-section-title">每日异常趋势<span>点击日期可定位</span></div>'+
   '<div id="scopeDailyChart" class="r68-scope-daily"></div></section>'+
  '<section class="r68-scope-block"><div class="r68-scope-section-title">'+label+'风险排行<span>按可比较的工作人日计算</span></div>'+
  '<div class="r68-rank-switch" role="group" aria-label="排行指标">'+
   [['issue','异常及缺勤'],['absent','缺勤'],['rate','异常率']].map(([id,n])=>
    '<button type="button" data-r68-rank="'+id+'" class="'+(mode===id?'active':'')+'">'+n+'</button>').join('')+'</div>'+
  '<div class="r68-scope-rank">'+(data.length?data.slice(0,6).map((item,index)=>{
   const value=r68ScopeMetric(item,mode);
   return '<button type="button" class="r68-rank-row" data-r68-drill="'+r68Esc(item.id)+'" title="'+r68Esc(item.label)+'，'+
    (mode==='rate'?value.toFixed(1)+'%':value+' 人日')+'"><span class="r68-rank-num">'+String(index+1).padStart(2,'0')+'</span>'+
    '<span class="r68-rank-name">'+r68Esc(item.label)+'</span>'+
    '<span class="r68-rank-track"><i style="width:'+Math.max(0,value/max*100).toFixed(1)+'%"></i></span>'+
    '<strong>'+(mode==='rate'?value.toFixed(1)+'%':value)+'</strong></button>';
  }).join(''):'<div class="r68-empty">当前范围暂无工作日记录。</div>')+'</div></section>'+
  '<section class="r68-scope-note"><div class="r68-scope-section-title">本月洞察</div>'+
  '<p>异常高峰：<strong>'+(peak.day?pad(peak.day)+' 日 · '+peak.value+' 人日':'暂无')+'</strong></p>'+
  '<p>'+(group?'需优先核对成员':'需优先核对组别')+'：<strong>'+leaderLabel+'</strong>'+
  (leader?' · '+(mode==='rate'?leader.rate.toFixed(1)+'%':r68ScopeMetric(leader,mode)+' 人日'):'')+'</p>'+
  '<small>按当前筛选和初始／人工判定实时计算；统计单位为工作人日。</small></section>';
 const chart=initAttendChart(document.getElementById('scopeDailyChart'));
 if(chart){
  chart.setOption({animation:false,grid:{left:28,right:8,top:12,bottom:24},
   tooltip:{trigger:'axis',valueFormatter:v=>v+' 人日'},
   xAxis:{type:'category',boundaryGap:false,data:daily.map(d=>pad(d.day)),
    axisTick:{show:false},axisLine:{lineStyle:{color:'#e5edf4'}},
    axisLabel:{color:'#9aabba',fontSize:10,interval:Math.max(0,Math.floor(daily.length/7))}},
   yAxis:{type:'value',minInterval:1,splitLine:{lineStyle:{color:'#edf2f7'}},
    axisLabel:{fontSize:10,color:'#9aabba'},axisLine:{show:false}},
   series:[{name:'异常及缺勤',type:'line',data:daily.map(d=>d.value),smooth:.2,symbol:'circle',
    symbolSize:4,lineStyle:{color:'#759e91',width:2},
    itemStyle:{color:'#759e91'},areaStyle:{color:'rgba(129,177,155,.085)'}}]});
  chart.on('click',e=>{const d=daily[e.dataIndex];if(d)selectDate(d.day,true)});
 }
 insight.querySelectorAll('[data-r68-rank]').forEach(b=>b.onclick=()=>{
  r68UI.rankMode=b.dataset.r68Rank;r68ScopeRender();
 });
 insight.querySelectorAll('[data-r68-drill]').forEach(b=>b.onclick=()=>{
  if(group)selectPerson(b.dataset.r68Drill);
  else{state.workspaceMode='group';state.selectedGroup=b.dataset.r68Drill;state.selection={type:'overall'};render()}
 });
}
renderScopeSummary=r68ScopeRender;
// R40 storage initializes the first screen before this optional module loads.
// Repaint once to activate the final data/scope renderers immediately.
render();
