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
 const work=items.filter(a=>isWorkday(a.day));
 const tally={normal:0,anomaly:0,absent:0};
 for(const row of work){const v=attendanceJudgment(row);if(v in tally)tally[v]++}
 const total=tally.normal+tally.anomaly+tally.absent,issues=tally.anomaly+tally.absent,
   pct=n=>total?100*n/total:0,group=state.workspaceMode==='group',mode=r68UI.rankMode||'issue';
 const daily=Array.from({length:monthDays()},(_,i)=>i+1).filter(isWorkday)
  .map(day=>({day,value:work.filter(a=>a.day===day&&['anomaly','absent'].includes(attendanceJudgment(a))).length}));
 const data=r68ScopeRankData(people,work).sort((a,b)=>
  r68ScopeMetric(b,mode)-r68ScopeMetric(a,mode)||a.label.localeCompare(b.label,'zh-CN'));
 const max=Math.max(1,...data.map(x=>r68ScopeMetric(x,mode)));
 const label=group?'组内成员':'组别';
 insight.innerHTML='<div class="r71-insights">'+
  '<header class="r71-insights-heading"><h3>考勤概况</h3><span class="r71-headcount">'+people.length+' 人</span></header>'+
  '<div class="r68-scope-kpis r70-metric-list r71-scope-metrics" aria-label="工作日考勤统计">'+
   [['正常人日',tally.normal,'good'],['异常人日',tally.anomaly,'warn'],
    ['缺勤人日',tally.absent,'bad'],['异常及缺勤率',pct(issues).toFixed(1)+'%','neutral']].map(([n,v,t])=>
    '<div class="r68-kpi '+t+'"><small>'+n+'</small><strong>'+v+'</strong></div>').join('')+'</div>'+
  '<div class="r68-stacked-track r71-composition" aria-label="正常 '+tally.normal+' 异常 '+tally.anomaly+' 缺勤 '+tally.absent+'">'+
   '<span class="good" style="width:'+pct(tally.normal)+'%" title="正常 '+tally.normal+' 人日"></span>'+
   '<span class="warn" style="width:'+pct(tally.anomaly)+'%" title="异常 '+tally.anomaly+' 人日"></span>'+
   '<span class="bad" style="width:'+pct(tally.absent)+'%" title="缺勤 '+tally.absent+' 人日"></span></div>'+
  '<section class="r71-insights-trend"><div class="r68-scope-section-title">每日异常趋势'+
   '<button class="r71-help" type="button" title="点击日期可定位到考勤矩阵" aria-label="说明：点击趋势图日期可定位">ⓘ</button></div>'+
   '<div id="scopeDailyChart" class="r68-scope-daily"></div></section>'+
  '<section class="r71-insights-rank"><div class="r68-scope-section-title">'+label+'风险排行'+
   '<button class="r71-help" type="button" title="按当前筛选后的工作人日计算；点击排行可下钻，完整排行见统计分析" aria-label="说明：排行口径与操作">ⓘ</button></div>'+
   '<div class="r68-rank-switch" role="group" aria-label="排行指标">'+
   [['issue','异常及缺勤'],['absent','缺勤'],['rate','异常率']].map(([id,n])=>
    '<button type="button" data-r68-rank="'+id+'" class="'+(mode===id?'active':'')+'" aria-pressed="'+(mode===id)+'">'+n+'</button>').join('')+'</div>'+
   '<div class="r68-scope-rank">'+(data.length?data.slice(0,5).map((item,index)=>{
    const value=r68ScopeMetric(item,mode);
    return '<button type="button" class="r68-rank-row" data-r68-drill="'+r68Esc(item.id)+'" title="'+
     r68Esc(item.label)+' · '+(mode==='rate'?value.toFixed(1)+'%':value+' 人日')+'">'+
     '<span class="r68-rank-num">'+String(index+1).padStart(2,'0')+'</span>'+
     '<span class="r68-rank-name">'+r68Esc(item.label)+'</span>'+
     '<span class="r68-rank-track"><i style="width:'+(value?Math.max(3,value/max*100):0).toFixed(1)+'%"></i></span>'+
     '<strong>'+(mode==='rate'?value.toFixed(1)+'%':value)+'</strong></button>';
   }).join(''):'<div class="r71-rank-empty">暂无可比较数据</div>')+'</div></section></div>';
 const chart=initAttendChart(document.getElementById('scopeDailyChart'));
 if(chart){
  chart.setOption({animation:false,grid:{left:28,right:8,top:12,bottom:24},
   tooltip:{trigger:'axis',valueFormatter:v=>v+' 人日'},
   xAxis:{type:'category',boundaryGap:false,data:daily.map(d=>pad(d.day)),
    axisTick:{show:false},axisLine:{lineStyle:{color:'#e5edf4'}},
    axisLabel:{color:'#62788a',fontSize:12,interval:Math.max(0,Math.floor(daily.length/7))}},
   yAxis:{type:'value',minInterval:1,splitLine:{lineStyle:{color:'#edf2f7'}},
    axisLabel:{fontSize:12,color:'#62788a'},axisLine:{show:false}},
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
