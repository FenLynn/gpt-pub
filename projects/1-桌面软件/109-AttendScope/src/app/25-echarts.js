/* AttendScope ECharts integration — Apache ECharts 6.1.0, vendored locally. */
const AS_CHART_COLORS={
  ink:'#526577',
  text:'#4b6074',
  muted:'#91a0ad',
  grid:'rgba(185,201,213,.26)',
  in:'#5f88d7',
  out:'#8a79d2',
  first:'#2f6fc9',
  last:'#6d59c7',
  normal:'#7fbd92',
  suspect:'#e4bb62',
  problem:'#d77773',
  excused:'#83add1',
  accent:'#3c8fca',
  area:'rgba(80,151,198,.10)'
};

let __attendCharts=[];

function registerAttendTheme(){
  if(!window.echarts||window.__attendThemeRegistered)return;
  echarts.registerTheme('attendScope',{
    color:['#5f88d7','#8a79d2','#7ba8c7','#9aa9c8','#6e9ab5','#9d8bd6'],
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
      textStyle:{color:'#42566a',fontSize:10}
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
  if(!state.timelineRange||state.timelineRange.key!==key)state.timelineRange={key,start:480,end:1080};
  return state.timelineRange;
}

function clusterForChart(events,range,width){
  const visible=events
    .map(p=>({p,m:minutes(p.time)}))
    .filter(x=>x.m>=range.start&&x.m<=range.end)
    .sort((a,b)=>a.m-b.m);
  if(!visible.length)return [];
  const plot=Math.max(260,width-74);
  const threshold=Math.max(.45,(range.end-range.start)/(plot/19));
  const groups=[];let current=[visible[0]];
  for(let i=1;i<visible.length;i++){
    if(visible[i].m-visible[i-1].m<=threshold)current.push(visible[i]);
    else{groups.push(current);current=[visible[i]]}
  }
  groups.push(current);
  return groups.map(g=>({
    minute:g.reduce((s,x)=>s+x.m,0)/g.length,
    start:g[0].m,
    end:g[g.length-1].m,
    records:g.map(x=>x.p)
  }));
}

function timelineClusterData(a,range,width){
  const ins=a.punches.filter(p=>p.direction==='进').sort((x,y)=>x.time.localeCompare(y.time));
  const outs=a.punches.filter(p=>p.direction==='出').sort((x,y)=>x.time.localeCompare(y.time));
  const firstIn=ins[0]?.recordId||'';
  const lastOut=outs[outs.length-1]?.recordId||'';
  const inGroups=clusterForChart(ins,range,width).map(g=>({
    value:[g.minute,1,g.records.length],
    kind:'in',edge:g.records.some(p=>p.recordId===firstIn)?'first':'',
    records:g.records,start:g.start,end:g.end
  }));
  const outGroups=clusterForChart(outs,range,width).map(g=>({
    value:[g.minute,-1,g.records.length],
    kind:'out',edge:g.records.some(p=>p.recordId===lastOut)?'last':'',
    records:g.records,start:g.start,end:g.end
  }));
  return [...inGroups,...outGroups];
}

function timelineEventColor(item){
  if(item.edge==='first')return AS_CHART_COLORS.first;
  if(item.edge==='last')return AS_CHART_COLORS.last;
  return item.kind==='in'?AS_CHART_COLORS.in:AS_CHART_COLORS.out;
}

function timelineEventRender(data){
  return function(params,api){
    const item=data[params.dataIndex];
    if(!item)return null;
    const p=api.coord([api.value(0),api.value(1)]);
    const axis=api.coord([api.value(0),0]);
    const color=timelineEventColor(item);
    const isIn=item.kind==='in';
    const edge=item.edge;
    const stemEnd=axis[1]+(isIn?-7:7);
    const arrowTip=axis[1]+(isIn?-1:1);
    const count=item.records.length;
    const children=[
      {
        type:'line',
        shape:{x1:p[0],y1:p[1],x2:p[0],y2:stemEnd},
        style:{stroke:color,lineWidth:edge?2.15:1.65,lineCap:'round',opacity:.93}
      },
      {
        type:'circle',
        shape:{cx:p[0],cy:arrowTip,r:2.1},
        style:{fill:color,opacity:.95}
      },
      {
        type:'polygon',
        shape:{points:isIn?[[p[0]-3.6,stemEnd-1],[p[0]+3.6,stemEnd-1],[p[0],arrowTip]]:[[p[0]-3.6,stemEnd+1],[p[0]+3.6,stemEnd+1],[p[0],arrowTip]]},
        style:{fill:color,opacity:.98}
      }
    ];
    if(edge){
      children.push({
        type:'circle',
        shape:{cx:p[0],cy:arrowTip,r:7.5},
        style:{fill:color,opacity:.07}
      });
    }
    if(count>1){
      children.push({
        type:'text',
        style:{
          x:p[0]+7,
          y:p[1]+(isIn?-1:1),
          text:'×'+count,
          fill:'#596a7c',
          backgroundColor:'rgba(241,246,250,.98)',
          borderColor:'rgba(194,207,219,.72)',
          borderWidth:1,
          font:'650 9px Segoe UI, Microsoft YaHei',
          padding:[3,5],
          borderRadius:8,
          align:'left',
          verticalAlign:'middle'
        }
      });
    }
    return {type:'group',children};
  };
}
function densityData(a){
  const bins=[];
  for(let m=0;m<=1440;m+=30)bins.push([m,0]);
  for(const p of a.punches){
    const m=minutes(p.time),idx=Math.max(0,Math.min(bins.length-1,Math.round(m/30)));
    bins[idx][1]++;
  }
  return bins;
}

function timelineTooltipFormatter(params){
  const item=params.data;
  if(!item||!item.records)return '';
  const color=timelineEventColor(item);
  const head=item.records.length>1
    ? `${minuteText(item.start)}–${minuteText(item.end)} · ${item.records.length} 条`
    : `${item.records[0].time} · ${item.records[0].direction}`;
  const tag=item.edge==='first'?'最早进入':item.edge==='last'?'最晚离开':'';
  const rows=item.records.slice(0,5).map(p=>`<div style="margin-top:4px;color:#cbd6df">${p.time} &nbsp; ${p.direction}</div>`).join('');
  return `<div style="min-width:132px"><div style="display:flex;align-items:center;gap:7px"><i style="width:7px;height:7px;border-radius:50%;background:${color}"></i><b style="font-size:11px;color:#31475b">${head}</b></div>${tag?`<div style="margin-top:5px;color:#6f7fd0">${tag}</div>`:''}${item.records.length>1?rows:''}</div>`;
}

function mountAttendanceTimeline(a){
  const el=document.getElementById('attendanceTimelineChart');
  if(!el||!window.echarts)return;
  const chart=initAttendChart(el);
  if(!chart)return;
  const range=timelineRange(a);
  let clusterData=timelineClusterData(a,range,chart.getWidth());

  function eventSeries(){
    return {
      id:'attendance-events',
      name:'打卡',
      type:'custom',
      coordinateSystem:'cartesian2d',
      renderItem:timelineEventRender(clusterData),
      dimensions:['minute','lane','count'],
      encode:{x:0,y:1,tooltip:[0,2]},
      data:clusterData,
      clip:true,
      z:8,
      emphasis:{focus:'self'}
    };
  }

  const option={
    animation:true,
    animationThreshold:500,
    grid:{left:46,right:22,top:18,bottom:102,containLabel:false},
    tooltip:{
      trigger:'item',
      confine:true,
      transitionDuration:.15,
      formatter:timelineTooltipFormatter,
      extraCssText:'border-radius:11px;box-shadow:0 10px 28px rgba(52,76,96,.10);backdrop-filter:blur(10px);'
    },
    xAxis:{
      type:'value',min:0,max:1440,
      axisLine:{show:false},
      axisTick:{show:false},
      axisLabel:{
        color:'#93a2af',fontSize:8.5,margin:10,
        formatter:v=>minuteText(v),
        hideOverlap:true
      },
      splitNumber:8,
      splitLine:{show:true,lineStyle:{color:'rgba(185,201,213,.20)',width:1,type:'dashed'}}
    },
    yAxis:[
      {
        type:'value',min:-1.35,max:1.35,interval:1,
        axisLine:{show:false},axisTick:{show:false},
        axisLabel:{
          color:'#718394',fontSize:10,fontWeight:650,
          formatter:v=>v===1?'进':v===-1?'出':''
        },
        splitLine:{show:false}
      },
      {type:'value',show:false,min:0}
    ],
    dataZoom:[
      {
        id:'inside',type:'inside',xAxisIndex:0,
        startValue:range.start,endValue:range.end,
        filterMode:'none',minValueSpan:30,
        zoomOnMouseWheel:true,moveOnMouseMove:true,moveOnMouseWheel:false,
        preventDefaultMouseMove:true
      },
      {
        id:'slider',type:'slider',xAxisIndex:0,
        startValue:range.start,endValue:range.end,
        filterMode:'none',minValueSpan:30,
        left:46,right:22,bottom:14,height:42,
        showDetail:true,realtime:true,brushSelect:false,
        backgroundColor:'rgba(245,249,252,.92)',
        borderColor:'rgba(205,218,228,.72)',
        borderRadius:10,
        fillerColor:'rgba(95,136,215,.10)',
        dataBackground:{
          lineStyle:{color:'#c3d0da',width:1,opacity:.72},
          areaStyle:{color:'rgba(150,170,190,.08)'}
        },
        selectedDataBackground:{
          lineStyle:{color:'#7897d7',width:1},
          areaStyle:{color:'rgba(95,136,215,.10)'}
        },
        handleIcon:'path://M-2,-10 C-2,-12 2,-12 2,-10 L2,10 C2,12 -2,12 -2,10 Z',
        handleSize:'72%',
        handleStyle:{
          color:'#ffffff',borderColor:'#7897d7',borderWidth:1.2,
          shadowBlur:4,shadowColor:'rgba(63,89,122,.10)'
        },
        moveHandleSize:4,
        moveHandleStyle:{color:'#7897d7',opacity:.36},
        textStyle:{color:'#8091a0',fontSize:8},
        labelFormatter:v=>minuteText(v)
      }
    ],
    series:[
      {
        id:'work-bands',type:'line',data:[],silent:true,symbol:'none',
        lineStyle:{opacity:0},
        markArea:{
          silent:true,itemStyle:{color:'rgba(126,166,193,.075)'},
          data:[
            [{xAxis:510},{xAxis:720}],
            [{xAxis:840},{xAxis:1050}]
          ]
        },
        z:0
      },
      {
        id:'density',type:'line',yAxisIndex:1,
        data:densityData(a),showSymbol:false,silent:true,
        lineStyle:{opacity:0},areaStyle:{opacity:0},
        encode:{x:0,y:1},
        z:-2
      },
      {
        id:'axis-arrow',type:'custom',silent:true,data:[[0,0]],
        renderItem:(params,api)=>{
          const cs=params.coordSys;
          const y=api.coord([0,0])[1];
          const x1=cs.x+2,x2=cs.x+cs.width-7;
          return {type:'group',children:[
            {type:'line',shape:{x1,y1:y,x2,y2:y},style:{stroke:'#53677a',lineWidth:1.05,opacity:.78,lineCap:'round'}},
            {type:'polygon',shape:{points:[[x2,y-3],[x2+6,y],[x2,y+3]]},style:{fill:'#53677a',opacity:.78}}
          ]};
        },
        z:3
      },
      eventSeries()
    ]
  };

  chart.setOption(option);

  let raf=0;
  function syncRange(evt){
    const p=evt?.batch?.[0]||evt||{};
    let start=p.startValue,end=p.endValue;
    if(start==null||end==null){
      if(p.start!=null&&p.end!=null){start=p.start/100*1440;end=p.end/100*1440}
      else return;
    }
    start=Math.max(0,Math.min(1440,Math.round(start)));
    end=Math.max(start+30,Math.min(1440,Math.round(end)));
    state.timelineRange={key:range.key,start,end};
    const label=document.getElementById('timelineWindowLabel');
    if(label)label.textContent=`${minuteText(start)}–${minuteText(end)}`;
    cancelAnimationFrame(raf);
    raf=requestAnimationFrame(()=>{
      clusterData=timelineClusterData(a,state.timelineRange,chart.getWidth());
      chart.setOption({series:[eventSeries()]});
    });
  }

  chart.on('datazoom',syncRange);
  chart.on('click',params=>{
    if(params.seriesId!=='attendance-events')return;
    const item=params.data;
    if(!item?.records?.length)return;
    if(item.records.length===1){
      showRecord(item.records[0].recordId);
      return;
    }
    const current=state.timelineRange||range;
    const span=Math.max(30,(current.end-current.start)/3);
    const center=(item.start+item.end)/2;
    const start=Math.max(0,Math.min(1440-span,center-span/2));
    const end=start+span;
    chart.dispatchAction({type:'dataZoom',dataZoomId:'slider',startValue:start,endValue:end});
  });
}

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
    const data=Array.from({length:31},(_,i)=>{
      const d=i+1,arr=EMPLOYEES.map(e=>state.analysis.get(`${e.id}|${d}`));
      return [String(d),arr.filter(x=>x.severity==='problem'||x.severity==='suspect').length,isWorkday(d)];
    }).filter(x=>x[2]);
    main.setOption({
      grid:{left:34,right:12,top:14,bottom:26},
      tooltip:chartTooltipAxis(),
      xAxis:{type:'category',data:data.map(x=>x[0]),boundaryGap:false,...chartAxisCommon(),axisLabel:{color:AS_CHART_COLORS.muted,fontSize:8,interval:1}},
      yAxis:{type:'value',minInterval:1,...chartAxisCommon()},
      series:[{
        type:'line',data:data.map(x=>x[1]),smooth:.34,showSymbol:false,
        lineStyle:{color:AS_CHART_COLORS.accent,width:2},
        areaStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'rgba(60,143,202,.20)'},{offset:1,color:'rgba(60,143,202,.015)'}])},
        emphasis:{focus:'series'}
      }]
    });
    main.on('click',p=>{const d=+p.name;if(d)selectDate(d)});
  }
  if(sub){
    const rows=EMPLOYEES.map(e=>({
      name:e.name,value:Array.from({length:31},(_,i)=>state.analysis.get(`${e.id}|${i+1}`)).filter(x=>x.severity==='problem'||x.severity==='suspect').length,id:e.id
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
  const days=Array.from({length:31},(_,i)=>state.analysis.get(`${ctx.employee.id}|${i+1}`));
  if(main){
    const work=days.filter(a=>isWorkday(a.day));
    main.setOption({
      grid:{left:36,right:14,top:14,bottom:28},
      tooltip:{...chartTooltipAxis(),formatter:p=>{const q=p[0],a=work[q.dataIndex];return `${pad(a.day)} 日<br>确认在岗 <b>${(a.presence/60).toFixed(1)} h</b><br>${a.status}`}},
      xAxis:{type:'category',data:work.map(a=>String(a.day)),boundaryGap:false,...chartAxisCommon(),axisLabel:{color:AS_CHART_COLORS.muted,fontSize:8,interval:1}},
      yAxis:{type:'value',min:0,max:10,...chartAxisCommon(),axisLabel:{color:AS_CHART_COLORS.muted,fontSize:8,formatter:v=>v+'h'}},
      series:[{
        type:'line',data:work.map(a=>+(a.presence/60).toFixed(2)),smooth:.28,showSymbol:false,
        lineStyle:{color:'#5899c3',width:2},areaStyle:{color:'rgba(88,153,195,.07)'}
      }]
    });
    main.on('click',p=>{const a=work[p.dataIndex];if(a)selectCell(ctx.employee.id,a.day)});
  }
  if(sub)mountStatusBarChart(sub,days);
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
  const days=Array.from({length:31},(_,i)=>state.analysis.get(`${ctx.employee.id}|${i+1}`)).filter(a=>isWorkday(a.day));
  if(main){
    main.setOption({
      grid:{left:36,right:14,top:14,bottom:28},
      tooltip:{...chartTooltipAxis(),formatter:p=>{const a=days[p[0].dataIndex];return `${pad(a.day)} 日<br>${a.status}<br>在岗 ${(a.presence/60).toFixed(1)} h`}},
      xAxis:{type:'category',data:days.map(a=>String(a.day)),boundaryGap:false,...chartAxisCommon(),axisLabel:{color:AS_CHART_COLORS.muted,fontSize:8,interval:1}},
      yAxis:{type:'value',min:0,max:10,...chartAxisCommon(),axisLabel:{color:AS_CHART_COLORS.muted,fontSize:8,formatter:v=>v+'h'}},
      series:[
        {type:'line',data:days.map(a=>+(a.presence/60).toFixed(2)),smooth:.28,showSymbol:false,lineStyle:{color:'#5a9bc5',width:2},areaStyle:{color:'rgba(90,155,197,.06)'}},
        {type:'scatter',symbolSize:10,data:days.map((a,i)=>a.day===ctx.day?[i,+(a.presence/60).toFixed(2)]:null).filter(Boolean),itemStyle:{color:'#2c7fd1',borderColor:'#fff',borderWidth:2}}
      ]
    });
    main.on('click',p=>{if(p.seriesType==='scatter'){selectCell(ctx.employee.id,ctx.day);return}const a=days[p.dataIndex];if(a)selectCell(ctx.employee.id,a.day)});
  }
  if(sub)mountStatusBarChart(sub,days);
}

function mountStatusBarChart(chart,items){
  const rows=[
    ['正常',items.filter(x=>x.severity==='normal').length,AS_CHART_COLORS.normal],
    ['疑似',items.filter(x=>x.severity==='suspect').length,AS_CHART_COLORS.suspect],
    ['问题',items.filter(x=>x.severity==='problem').length,AS_CHART_COLORS.problem],
    ['请假/出差',items.filter(x=>x.marker).length,AS_CHART_COLORS.excused]
  ].filter(x=>x[1]>0).reverse();
  chart.setOption({
    grid:{left:66,right:22,top:8,bottom:12},
    tooltip:{trigger:'item',confine:true},
    xAxis:{type:'value',show:false},
    yAxis:{type:'category',data:rows.map(x=>x[0]),axisLine:{show:false},axisTick:{show:false},axisLabel:{color:AS_CHART_COLORS.text,fontSize:9}},
    series:[{
      type:'bar',barWidth:8,
      data:rows.map(x=>({value:x[1],itemStyle:{color:x[2],borderRadius:[0,5,5,0]}})),
      showBackground:true,backgroundStyle:{color:'rgba(211,223,231,.40)',borderRadius:5},
      label:{show:true,position:'right',color:AS_CHART_COLORS.text,fontSize:9}
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
    grid:{left:62,right:18,top:12,bottom:32},
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
      axisLabel:{color:AS_CHART_COLORS.muted,fontSize:8,formatter:v=>minuteText(v),hideOverlap:true},
      splitNumber:8,
      splitLine:{show:true,lineStyle:{color:'rgba(190,205,216,.25)'}}
    },
    yAxis:{
      type:'category',inverse:true,
      data:ctx.items.map(a=>a.employee.name),
      axisLine:{show:false},axisTick:{show:false},
      axisLabel:{color:'#607487',fontSize:8,width:48,overflow:'truncate',margin:8},
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
    if(d?.employeeId&&d?.day)selectCell(d.employeeId,d.day);
  });
}

function mountStatsCharts(ctx){
  if(!window.echarts)return;
  if(ctx.type==='overall')mountOverallStats(ctx);
  else if(ctx.type==='person')mountPersonStats(ctx);
  else if(ctx.type==='date')mountDateStats(ctx);
  else mountCellStats(ctx);
}

function mountAnalysisVisuals(ctx){
  if(!window.echarts)return;
  requestAnimationFrame(()=>{
    if(state.analysisTab==='timeline'&&ctx.type==='cell')mountAttendanceTimeline(ctx.analysis);
    if(state.analysisTab==='timeline'&&ctx.type==='date')mountDayTimeline(ctx);
    if(state.analysisTab==='stats')mountStatsCharts(ctx);
  });
}
