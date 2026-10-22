/* AttendScope ECharts integration — Apache ECharts 6.1.0, vendored locally. */
const AS_CHART_COLORS={
  ink:'#203247',
  text:'#4e6880',
  muted:'#899fb1',
  grid:'rgba(185,201,213,.26)',
  in:'#415b6d',
  out:'#8b6650',
  first:'#334d60',
  last:'#76533e',
  normal:'#78caa0',
  suspect:'#e6c36f',
  problem:'#e6c36f',
  absent:'#e58f90',
  excused:'#5eaddc',
  accent:'#2288d8',
  area:'rgba(80,151,198,.10)'
};

let __attendCharts=[];

function registerAttendTheme(){
  if(!window.echarts||window.__attendThemeRegistered)return;
  echarts.registerTheme('attendScope',{
    color:['#2288d8','#85cca3','#e8c777','#e39792','#9cc7e8','#74aacb'],
    backgroundColor:'transparent',
    textStyle:{
      fontFamily:'Segoe UI, Microsoft YaHei, PingFang SC, sans-serif',
      color:AS_CHART_COLORS.text
    },
    animationDuration:420,
    animationDurationUpdate:320,
    animationEasing:'cubicOut',
    animationEasingUpdate:'cubicOut',
    categoryAxis:{
      axisLine:{lineStyle:{color:'#cdd9e2'}},
      axisTick:{show:false},
      axisLabel:{color:AS_CHART_COLORS.muted,fontSize:9},
      splitLine:{show:false}
    },
    valueAxis:{
      axisLine:{show:false},
      axisTick:{show:false},
      axisLabel:{color:AS_CHART_COLORS.muted,fontSize:9},
      splitLine:{lineStyle:{color:AS_CHART_COLORS.grid}}
    },
    tooltip:{
      backgroundColor:'rgba(250,252,254,.98)',
      borderColor:'rgba(194,207,219,.78)',
      borderWidth:1,
      padding:[9,11],
      textStyle:{color:'#42566a',fontSize:12}
    }
  });
  window.__attendThemeRegistered=true;
}

function rememberAttendChart(chart,el){
  const ro=window.ResizeObserver?new ResizeObserver(()=>{if(!chart.isDisposed())chart.resize({animation:{duration:160}})}):null;
  if(ro)ro.observe(el);
  __attendCharts.push({chart,ro});
  return chart;
}

function disposeAttendCharts(){
  for(const item of __attendCharts){
    try{item.ro?.disconnect()}catch(_){}
    try{if(item.chart&&!item.chart.isDisposed())item.chart.dispose()}catch(_){}
  }
  __attendCharts=[];
}

function disposeAnalysisCharts(){disposeAttendCharts()}

function initAttendChart(el){
  if(!el||!window.echarts)return null;
  registerAttendTheme();
  return rememberAttendChart(echarts.init(el,'attendScope',{renderer:'svg'}),el);
}

function minuteText(v){
  const m=Math.max(0,Math.min(1440,Math.round(v)));
  if(m===1440)return '24:00';
  return pad(Math.floor(m/60))+':'+pad(m%60);
}

function timelineRange(a){
  const key=`${a.employee.id}|${a.day}`;
  if(!state.timelineRange||state.timelineRange.key!==key){
   // A midnight-spanning session cannot be displayed in the legacy
   // 05:00–23:00 viewport: the last/first hours would be cropped.
   const touchesMidnight=(a.pairs||[]).some(([x,y])=>minutes(x.time)<1||minutes(y.time)>=1440)||
    (a.autoOvertime?.segments||[]).some(s=>s.from<1||s.to>=1440);
   state.timelineRange={key,start:touchesMidnight?0:300,end:touchesMidnight?1440:1380};
  }
  return state.timelineRange;
}

/* Legacy timeline retired in R38; active six-track renderer lives in 36-tracks.js. */
function chartAxisCommon(){
  return {
    axisLine:{lineStyle:{color:'#d5e0e7'}},
    axisTick:{show:false},
    axisLabel:{color:AS_CHART_COLORS.muted,fontSize:9},
    splitLine:{lineStyle:{color:'rgba(190,205,216,.28)'}}
  };
}

function chartTooltipAxis(){
  return {
    trigger:'axis',confine:true,
    axisPointer:{type:'line',lineStyle:{color:'rgba(70,121,156,.35)',width:1}},
    extraCssText:'border-radius:10px;box-shadow:0 12px 32px rgba(25,45,62,.15);'
  };
}

function mountOverallStats(ctx){
  const main=initAttendChart(document.getElementById('statsChartMain'));
  const sub=initAttendChart(document.getElementById('statsChartSecondary'));
  if(main){
    const data=Array.from({length:monthDays()},(_,i)=>{
      const d=i+1,arr=EMPLOYEES.map(e=>state.analysis.get(`${e.id}|${d}`));
      return [String(d),arr.filter(x=>x.severity==='problem'||x.severity==='suspect').length,isWorkday(d)];
    }).filter(x=>x[2]);
    main.setOption({
      grid:{left:34,right:12,top:14,bottom:26},
      tooltip:chartTooltipAxis(),
      xAxis:{type:'category',data:data.map(x=>x[0]),boundaryGap:false,...chartAxisCommon(),axisLabel:{color:AS_CHART_COLORS.muted,fontSize:10.5,interval:1}},
      yAxis:{type:'value',minInterval:1,...chartAxisCommon()},
      series:[{
        type:'line',data:data.map(x=>x[1]),smooth:false,showSymbol:false,
        lineStyle:{color:AS_CHART_COLORS.accent,width:2},
        areaStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'rgba(60,143,202,.20)'},{offset:1,color:'rgba(60,143,202,.015)'}])},
        emphasis:{focus:'series'}
      }]
    });
    main.on('click',p=>{const d=+p.name;if(d)selectDate(d,true)});
  }
  if(sub){
    const rows=EMPLOYEES.map(e=>({
      name:e.name,value:Array.from({length:monthDays()},(_,i)=>state.analysis.get(`${e.id}|${i+1}`)).filter(x=>x.severity==='problem'||x.severity==='suspect').length,id:e.id
    })).sort((a,b)=>b.value-a.value).slice(0,8).reverse();
    sub.setOption({
      grid:{left:54,right:22,top:8,bottom:12},
      tooltip:{trigger:'item',confine:true,formatter:p=>`${p.name}<br>异常 ${p.value}`},
      xAxis:{type:'value',show:false},
      yAxis:{type:'category',data:rows.map(x=>x.name),axisLine:{show:false},axisTick:{show:false},axisLabel:{color:AS_CHART_COLORS.text,fontSize:9}},
      series:[{type:'bar',data:rows.map(x=>x.value),barWidth:7,itemStyle:{color:'#87abc3',borderRadius:[0,5,5,0]},showBackground:true,backgroundStyle:{color:'rgba(211,223,231,.44)',borderRadius:5}}]
    });
    sub.on('click',p=>{const row=rows[p.dataIndex];if(row)selectPerson(row.id)});
  }
}

function mountPersonStats(ctx){
  const main=initAttendChart(document.getElementById('statsChartMain'));
  const sub=initAttendChart(document.getElementById('statsChartSecondary'));
  const days=Array.from({length:monthDays()},(_,i)=>state.analysis.get(`${ctx.employee.id}|${i+1}`));
  if(main){
    const work=days.filter(a=>isWorkday(a.day));
    main.setOption({
      animation:false,
      grid:{left:44,right:14,top:14,bottom:32},
      tooltip:{...chartTooltipAxis(),formatter:p=>{const q=p[0],a=work[q.dataIndex];return `${pad(a.day)} 日<br>确认在岗 <b>${(a.presence/60).toFixed(1)} h</b><br>${a.status}`}},
      xAxis:{type:'category',data:work.map(a=>String(a.day)),boundaryGap:false,...chartAxisCommon(),axisLabel:{color:AS_CHART_COLORS.muted,fontSize:12,interval:1}},
      yAxis:{type:'value',min:0,...chartAxisCommon(),axisLabel:{color:AS_CHART_COLORS.muted,fontSize:12,formatter:v=>v+'h'}},
      series:[{
        type:'line',data:work.map(a=>+(a.presence/60).toFixed(2)),smooth:.28,showSymbol:false,
        lineStyle:{color:'#5899c3',width:2},areaStyle:{color:'rgba(88,153,195,.07)'}
      }]
    });
    main.on('click',p=>{const a=work[p.dataIndex];if(a)selectCellAndFocusEvidence(ctx.employee.id,a.day)});
  }
  if(sub)mountStatusBarChart(sub,days.filter(a=>isWorkday(a.day)));
}

function mountDateStats(ctx){
  const main=initAttendChart(document.getElementById('statsChartMain'));
  const sub=initAttendChart(document.getElementById('statsChartSecondary'));
  if(main)mountStatusBarChart(main,ctx.items);
  if(sub){
    const bins=[['≤08:30',0],['08:31–08:45',0],['08:46–09:00',0],['>09:00',0],['无记录',0]];
    ctx.items.forEach(a=>{
      if(!a.firstIn)bins[4][1]++;
      else{const m=minutes(a.firstIn);if(m<=510)bins[0][1]++;else if(m<=525)bins[1][1]++;else if(m<=540)bins[2][1]++;else bins[3][1]++}
    });
    sub.setOption({
      grid:{left:72,right:22,top:8,bottom:14},
      tooltip:{trigger:'item',confine:true},
      xAxis:{type:'value',show:false},
      yAxis:{type:'category',data:bins.map(x=>x[0]),axisLine:{show:false},axisTick:{show:false},axisLabel:{color:AS_CHART_COLORS.text,fontSize:9}},
      series:[{type:'bar',data:bins.map(x=>x[1]),barWidth:7,itemStyle:{color:'#8db0c6',borderRadius:[0,5,5,0]},showBackground:true,backgroundStyle:{color:'rgba(211,223,231,.40)',borderRadius:5}}]
    });
  }
}

function mountCellStats(ctx){
  const main=initAttendChart(document.getElementById('statsChartMain'));
  const sub=initAttendChart(document.getElementById('statsChartSecondary'));
  const days=Array.from({length:monthDays()},(_,i)=>state.analysis.get(`${ctx.employee.id}|${i+1}`)).filter(a=>isWorkday(a.day));
  if(main){
    main.setOption({
      grid:{left:36,right:14,top:14,bottom:28},
      tooltip:{...chartTooltipAxis(),formatter:p=>{const a=days[p[0].dataIndex];return `${pad(a.day)} 日<br>${a.status}<br>在岗 ${(a.presence/60).toFixed(1)} h`}},
      xAxis:{type:'category',data:days.map(a=>String(a.day)),boundaryGap:false,...chartAxisCommon(),axisLabel:{color:AS_CHART_COLORS.muted,fontSize:10.5,interval:1}},
      yAxis:{type:'value',min:0,...chartAxisCommon(),axisLabel:{color:AS_CHART_COLORS.muted,fontSize:10.5,formatter:v=>v+'h'}},
      series:[
        {type:'line',data:days.map(a=>a.status==='未导入'?null:+(a.presence/60).toFixed(2)),smooth:.28,showSymbol:false,lineStyle:{color:'#5a9bc5',width:2},areaStyle:{color:'rgba(90,155,197,.06)'}},
        {type:'scatter',symbolSize:10,data:days.map((a,i)=>a.day===ctx.day?[i,+(a.presence/60).toFixed(2)]:null).filter(Boolean),itemStyle:{color:'#2c7fd1',borderColor:'#fff',borderWidth:2}}
      ]
    });
    main.on('click',p=>{if(p.seriesType==='scatter'){selectCellAndFocusEvidence(ctx.employee.id,ctx.day);return}const a=days[p.dataIndex];if(a)selectCellAndFocusEvidence(ctx.employee.id,a.day)});
  }
  if(sub)mountStatusBarChart(sub,days);
}

function mountStatusBarChart(chart,items){
  const rows=[
    ['正常',items.filter(x=>attendanceJudgment(x)==='normal').length,ATTEND_STATUS_COLORS.normal],
    ['异常',items.filter(x=>attendanceJudgment(x)==='anomaly').length,ATTEND_STATUS_COLORS.anomaly],
    ['缺勤',items.filter(x=>attendanceJudgment(x)==='absent').length,ATTEND_STATUS_COLORS.absent]
  ].filter(x=>x[1]>0).reverse();
  chart.setOption({
    animation:false,
    grid:{left:70,right:28,top:8,bottom:12},
    tooltip:{trigger:'item',confine:true},
    xAxis:{type:'value',show:false},
    yAxis:{type:'category',data:rows.map(x=>x[0]),axisLine:{show:false},axisTick:{show:false},axisLabel:{color:AS_CHART_COLORS.text,fontSize:12}},
    series:[{
      type:'bar',barWidth:12,
      data:rows.map(x=>({value:x[1],itemStyle:{color:x[2],borderRadius:[0,5,5,0]}})),
      showBackground:true,backgroundStyle:{color:'rgba(211,223,231,.40)',borderRadius:5},
      label:{show:true,position:'right',color:AS_CHART_COLORS.text,fontSize:12}
    }]
  });
}

function dateRangeRender(data){
  return function(params,api){
    const item=data[params.dataIndex];
    if(!item)return null;
    const start=api.coord([api.value(0),api.value(2)]);
    const end=api.coord([api.value(1),api.value(2)]);
    const h=Math.max(3,Math.min(5,api.size([0,1])[1]*.28));
    return {
      type:'rect',
      shape:{x:start[0],y:start[1]-h/2,width:Math.max(1,end[0]-start[0]),height:h,r:3},
      style:{fill:'#78a7c2',opacity:.82}
    };
  };
}

function mountDayTimeline(ctx){
  const el=document.getElementById('attendanceDayChart');
  if(!el||!window.echarts)return;
  const chart=initAttendChart(el);if(!chart)return;
  const ranges=[];
  const ins=[];
  const outs=[];
  ctx.items.forEach((a,row)=>{
    a.pairs.forEach(([x,y])=>ranges.push({
      value:[minutes(x.time),minutes(y.time),row],
      employeeId:a.employee.id,day:a.day,status:a.status,
      start:x.time,end:y.time
    }));
    a.punches.forEach(p=>{
      const obj={value:[minutes(p.time),row],employeeId:a.employee.id,day:a.day,time:p.time,direction:p.direction,status:a.status};
      (p.direction==='进'?ins:outs).push(obj);
    });
  });

  chart.setOption({
    animationDuration:380,
    grid:{left:66,right:14,top:12,bottom:34},
    tooltip:{
      trigger:'item',confine:true,
      extraCssText:'border-radius:10px;box-shadow:0 12px 32px rgba(25,45,62,.15);',
      formatter:p=>{
        const d=p.data||{};
        const a=ctx.items[d.value?.[2]??d.value?.[1]];
        if(!a)return '';
        if(p.seriesId==='day-ranges')return `<b>${a.employee.name}</b><br>${d.start}–${d.end}<br><span style="color:#aebdca">${a.status}</span>`;
        return `<b>${a.employee.name}</b><br>${d.time} · ${d.direction}<br><span style="color:#aebdca">${a.status}</span>`;
      }
    },
    xAxis:{
      type:'value',min:360,max:1320,
      axisLine:{lineStyle:{color:'#cbd8e1'}},axisTick:{show:false},
      axisLabel:{color:AS_CHART_COLORS.muted,fontSize:10.5,formatter:v=>minuteText(v),hideOverlap:true},
      splitNumber:8,
      splitLine:{show:true,lineStyle:{color:'rgba(190,205,216,.25)'}}
    },
    yAxis:{
      type:'category',inverse:true,
      data:ctx.items.map(a=>a.employee.name),
      axisLine:{show:false},axisTick:{show:false},
      axisLabel:{color:'#607487',fontSize:10.5,width:48,overflow:'truncate',margin:8},
      splitLine:{show:true,lineStyle:{color:'rgba(222,231,237,.42)'}}
    },
    series:[
      {
        id:'day-work',type:'line',data:[],silent:true,symbol:'none',lineStyle:{opacity:0},
        markArea:{
          silent:true,itemStyle:{color:'rgba(126,166,193,.055)'},
          data:[[{xAxis:510},{xAxis:720}],[{xAxis:840},{xAxis:1050}]]
        },z:0
      },
      {
        id:'day-ranges',type:'custom',coordinateSystem:'cartesian2d',
        renderItem:dateRangeRender(ranges),data:ranges,
        encode:{x:[0,1],y:2},clip:true,z:3
      },
      {
        id:'day-in',name:'进',type:'scatter',data:ins,
        symbol:'rect',symbolSize:[2.2,6],symbolOffset:[0,-3],
        itemStyle:{color:AS_CHART_COLORS.in,opacity:.9},z:6
      },
      {
        id:'day-out',name:'出',type:'scatter',data:outs,
        symbol:'rect',symbolSize:[2.2,6],symbolOffset:[0,3],
        itemStyle:{color:AS_CHART_COLORS.out,opacity:.9},z:6
      }
    ]
  });
  chart.on('click',p=>{
    const d=p.data;
    if(d?.employeeId&&d?.day)selectCellAndFocusEvidence(d.employeeId,d.day);
  });
}

function mountStatsCharts(ctx){
  if(!window.echarts)return;
  if(ctx.type==='overall')mountOverallStats(ctx);
  else if(ctx.employee&&state.workspaceMode==='person')mountPersonStats(ctx);
  else if(ctx.type==='person')mountPersonStats(ctx);
  else if(ctx.type==='date')mountDateStats(ctx);
  else mountCellStats(ctx);
}

function mountOverviewTrend(){
  const el=document.getElementById('overviewTrendChart');
  if(!el)return;
  const chart=initAttendChart(el);
  if(!chart)return;
  const rows=Array.from({length:monthDays()},(_,i)=>{
    const day=i+1;
    const list=EMPLOYEES.map(e=>state.analysis.get(`${e.id}|${day}`));
    return {day,anomaly:list.filter(a=>attendanceJudgment(a)==='anomaly').length,absent:list.filter(a=>attendanceJudgment(a)==='absent').length};
  }).filter(x=>isWorkday(x.day));
  chart.setOption({
    grid:{left:30,right:15,top:12,bottom:26},
    tooltip:{
      trigger:'axis',confine:true,
      axisPointer:{type:'line',lineStyle:{color:'#abc8d9',width:1}},
      formatter:p=>{
        const d=rows[p[0]?.dataIndex];return d?`${pad(d.day)} 日<br>异常 ${d.anomaly}<br>缺勤 ${d.absent}`:'';
      }
    },
    legend:{show:false},
    xAxis:{type:'category',boundaryGap:false,data:rows.map(x=>pad(x.day)),axisTick:{show:false},axisLine:{lineStyle:{color:'#dae5ec'}},axisLabel:{fontSize:11,color:'#9aa8b3',interval:2}},
    yAxis:{type:'value',min:0,minInterval:1,axisTick:{show:false},axisLine:{show:false},axisLabel:{fontSize:11,color:'#9aa8b3'},splitLine:{lineStyle:{color:'rgba(199,215,225,.37)',type:'dashed'}}},
    series:[
      {name:'异常',type:'line',smooth:false,symbol:'none',data:rows.map(x=>x.anomaly),lineStyle:{width:2,color:ATTEND_STATUS_COLORS.anomaly},areaStyle:{color:'rgba(230,195,111,.09)'},itemStyle:{color:ATTEND_STATUS_COLORS.anomaly}},
      {name:'缺勤',type:'line',smooth:false,symbol:'none',data:rows.map(x=>x.absent),lineStyle:{width:2,color:ATTEND_STATUS_COLORS.absent},itemStyle:{color:ATTEND_STATUS_COLORS.absent}}
    ]
  });
  chart.on('click',p=>{const day=rows[p.dataIndex]?.day;if(day)selectDate(day,true)});
}

function mountFocusedOverviewChart(ctx){
  const el=document.getElementById('overviewTrendChart');
  if(!el)return;
  const chart=initAttendChart(el);
  if(!chart)return;
  if(ctx.type==='date'){
    const items=ctx.items;
    const rows=[
      {name:'正常',value:items.filter(a=>attendanceJudgment(a)==='normal').length,color:ATTEND_STATUS_COLORS.normal},
      {name:'异常',value:items.filter(a=>attendanceJudgment(a)==='anomaly').length,color:ATTEND_STATUS_COLORS.anomaly},
      {name:'缺勤',value:items.filter(a=>attendanceJudgment(a)==='absent').length,color:ATTEND_STATUS_COLORS.absent}
    ].reverse();
    chart.setOption({
      grid:{left:103,right:36,top:14,bottom:10},
      tooltip:{trigger:'item',confine:true,formatter:params=>params.name+'：'+params.value+' 人'},
      xAxis:{type:'value',show:false},
      yAxis:{type:'category',data:rows.map(a=>a.name),axisTick:{show:false},axisLine:{show:false},axisLabel:{color:'#617b91',fontSize:11}},
      series:[{type:'bar',barWidth:13,showBackground:true,backgroundStyle:{color:'#f0f5f8',borderRadius:7},data:rows.map(a=>({value:a.value,itemStyle:{color:a.color,borderRadius:[0,7,7,0]}})),label:{show:true,position:'right',color:'#3b586e',fontSize:11,fontWeight:650}}]
    });
    chart.on('click',()=>{state.chartTab='stats';renderAnalysisPanel()});
    return;
  }
  const days=Array.from({length:monthDays()},(_,i)=>state.analysis.get(`${ctx.employee.id}|${i+1}`)).filter(a=>isWorkday(a.day));
  chart.setOption({
    grid:{left:42,right:16,top:14,bottom:28},
    tooltip:{trigger:'axis',confine:true,formatter:ps=>{const d=days[ps[0]?.dataIndex];return d?`${pad(d.day)} 日 · ${d.status}<br>确认在岗：${fmtMinutes(d.presence)}`:''}},
    xAxis:{type:'category',boundaryGap:false,data:days.map(a=>pad(a.day)),axisTick:{show:false},axisLine:{lineStyle:{color:'#d9e5ed'}},axisLabel:{fontSize:10,color:'#879bad',interval:1}},
    yAxis:{type:'value',min:0,axisTick:{show:false},axisLine:{show:false},axisLabel:{color:'#879bad',fontSize:10,formatter:v=>v+'h'},splitLine:{lineStyle:{color:'rgba(175,198,214,.40)',type:'dashed'}}},
    series:[{type:'line',smooth:false,showSymbol:true,symbolSize:8,
      data:days.map(a=>({value:a.status==='未导入'?null:+(a.presence/60).toFixed(2),
        itemStyle:{color:categoryColor(attendanceJudgment(a)),borderColor:'#fff',borderWidth:1.5}})),
      lineStyle:{width:2.5,color:'#4f9bdb'},itemStyle:{color:'#4f9bdb'},areaStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'rgba(32,139,222,.20)'},{offset:1,color:'rgba(32,139,222,.015)'}])}}]
  });
  chart.on('click',ev=>{const a=days[ev.dataIndex];if(a)selectCellAndFocusEvidence(ctx.employee.id,a.day)});
}

function mountFilteredOverview(ctx){
  const el=document.getElementById('overviewTrendChart');if(!el)return;
  const chart=initAttendChart(el);if(!chart)return;
  const filter=state.filter,color=['normal','anomaly','absent'].includes(filter)?categoryColor(filter):ATTEND_BEHAVIOR_COLORS[filter]||AS_CHART_COLORS.accent;
  if(ctx.type==='date'){
    const view=analysisViewItems(ctx);
    chart.setOption({
      grid:{left:18,right:18,top:22,bottom:16},
      tooltip:{trigger:'item',formatter:()=>currentFilterLabel()+'：'+view.length+' 人'},
      xAxis:{type:'value',show:false},yAxis:{type:'category',data:[currentFilterLabel()],axisLine:{show:false},axisTick:{show:false},axisLabel:{fontSize:11,color:'#617b91'}},
      series:[{type:'bar',barWidth:16,data:[{value:view.length,itemStyle:{color,borderRadius:[0,8,8,0]}}],label:{show:true,position:'right',formatter:'{c} 人',color:'#425d73',fontSize:11}}]
    });
    return;
  }
  const person=ctx.employee||null;
  const rows=Array.from({length:monthDays()},(_,i)=>{
    const day=i+1;
    const list=person?[state.analysis.get(person.id+'|'+day)]:EMPLOYEES.map(e=>state.analysis.get(e.id+'|'+day));
    const value=list.filter(a=>state.filter==='main'?true:analysisViewItems({items:[a]}).length>0).length;
    return {day,value};
  }).filter(x=>isWorkday(x.day)||behaviorFilterActive()||state.filter==='lateEarly');
  chart.setOption({
    grid:{left:30,right:12,top:12,bottom:26},
    tooltip:{trigger:'axis',confine:true,formatter:p=>{const d=rows[p[0]?.dataIndex];return d?pad(d.day)+' 日 · '+currentFilterLabel()+' '+d.value+(person?'':' 人'):''}},
    xAxis:{type:'category',data:rows.map(x=>pad(x.day)),axisTick:{show:false},axisLine:{lineStyle:{color:'#dae5ec'}},axisLabel:{fontSize:10,color:'#8a9eae',interval:1}},
    yAxis:{type:'value',min:0,minInterval:1,axisLine:{show:false},axisTick:{show:false},axisLabel:{fontSize:10,color:'#8a9eae'},splitLine:{lineStyle:{color:'rgba(199,215,225,.34)',type:'dashed'}}},
    series:[{type:'bar',barMaxWidth:14,data:rows.map(x=>({value:x.value,itemStyle:{color,borderRadius:[4,4,0,0]}}))}]
  });
  chart.on('click',p=>{const d=rows[p.dataIndex]?.day;if(!d)return;if(person)selectCellAndFocusEvidence(person.id,d);else selectDate(d,true)});
}

function mountAnalysisVisuals(ctx){
  if(!window.echarts)return;
  requestAnimationFrame(()=>{
    const tab=state.chartTab||'overview';
    if(tab==='timeline'){
      const day=plotAnalysis(ctx);
      if(day)mountAttendanceTimeline(day);
      else if(ctx.type==='date')mountDayTimeline(ctx);
    }else if(tab==='stats')mountStatsCharts(ctx);
    else if(tab==='issues')mountIssueChart(ctx);
    else if(state.filter!=='main')mountFilteredOverview(ctx.type==='cell'?{type:'person',employee:ctx.employee,items:Array.from({length:monthDays()},(_,i)=>state.analysis.get(ctx.employee.id+'|'+(i+1)))}:ctx);
    else if(ctx.type==='overall')mountOverviewTrend();
    else if(ctx.type==='cell')mountFocusedOverviewChart({type:'person',employee:ctx.employee,items:Array.from({length:monthDays()},(_,i)=>state.analysis.get(ctx.employee.id+'|'+(i+1)))});
    else mountFocusedOverviewChart(ctx);
  });
}
