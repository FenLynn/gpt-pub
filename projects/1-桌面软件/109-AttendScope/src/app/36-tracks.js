/* R28 timeline: six lanes, navigator-aligned plot, fixed behavior labels, and schedule boundaries. */
function r19PunchClusters(a,range,width,fixedLane=null){
  const span=Math.max(30,range.end-range.start),px=Math.max(240,width||800);
  const mergeMinutes=Math.max(.45,span/px*11),out=[];
  for(const direction of ['进','出']){
    const rows=a.punches.filter(p=>p.direction===direction).sort((x,y)=>minutes(x.time)-minutes(y.time));
    let group=[];
    const flush=()=>{
      if(!group.length)return;
      const values=group.map(p=>minutes(p.time));
      const lane=Number.isFinite(fixedLane)?fixedLane:(direction==='进'?0:1);
      out.push({
        value:[values.reduce((n,x)=>n+x,0)/values.length,lane],
        p:group[0],records:[...group],count:group.length,direction,
        start:Math.min(...values),end:Math.max(...values)
      });
      group=[];
    };
    for(const p of rows){
      const m=minutes(p.time);
      if(group.length&&m-minutes(group[group.length-1].time)>mergeMinutes)flush();
      group.push(p);
    }
    flush();
  }
  return out.sort((x,y)=>x.value[0]-y.value[0]);
}
function r23BehaviorSegments(a,key){
  if(key==='trip')return (a.trips||[]).map(p=>({from:minutes(p.start||RULES.amStart),to:minutes(p.end||RULES.pmEnd),title:'出差',sourceIds:[p.id]}));
  if(key==='leave')return (a.leaves||[]).map(p=>({from:minutes(p.start||RULES.amStart),to:minutes(p.end||RULES.pmEnd),title:'请假',sourceIds:[p.id]}));
  if(key==='outing')return (a.outings||[]).map(p=>({from:minutes(p.start||RULES.amStart),to:minutes(p.end||RULES.pmEnd),title:'外出',sourceIds:[p.id]}));
  if(key==='overtime')return (a.overtime||[]).map(p=>({from:minutes(p.start||'17:30'),to:minutes(p.end||'20:00'),title:'加班',sourceIds:[p.id]}));
  return [];
}
function r14TrackData(a,range=timelineRange(a),width=800){
  const tracks=[
    {key:'in',title:'进',color:ATTEND_EVENT_COLORS.in},
    {key:'out',title:'出',color:ATTEND_EVENT_COLORS.out},
    {key:'trip',title:'出差',color:ATTEND_BEHAVIOR_COLORS.trip},
    {key:'leave',title:'请假',color:ATTEND_BEHAVIOR_COLORS.leave},
    {key:'outing',title:'外出',color:ATTEND_BEHAVIOR_COLORS.outing},
    {key:'overtime',title:'加班',color:ATTEND_BEHAVIOR_COLORS.overtime}
  ];
  const bars=[];
  for(const key of ['trip','leave','outing','overtime']){
    const lane=tracks.findIndex(t=>t.key===key),track=tracks[lane];
    for(const seg of r23BehaviorSegments(a,key)){
      const from=Math.max(0,Math.min(1440,+seg.from)),to=Math.max(0,Math.min(1440,+seg.to));
      if(to>from)bars.push({value:[from,to,lane],color:track.color,title:seg.title||track.title,track:key,sourceIds:seg.sourceIds||null});
    }
  }
  const workWindows=!isWorkday(a.day)?[]:[
    [minutes(RULES.amStart),minutes(RULES.amEnd)],
    [minutes(RULES.pmStart),minutes(RULES.pmEnd)]
  ];
  return {tracks,bars,events:r19PunchClusters(a,range,width),workWindows};
}
function mountAttendanceTimeline(a){
  const el=document.getElementById('attendanceTimelineChart');if(!el||!window.echarts)return;
  const chart=initAttendChart(el);if(!chart)return;
  const SIDE=12,SLIDER_BOTTOM=30,SLIDER_HEIGHT=34;
  const initialRange=timelineRange(a);
  let currentRange={...initialRange};
  let model=r14TrackData(a,currentRange,chart.getWidth());
  const gridForRange=r=>{
    const usable=Math.max(160,chart.getWidth()-SIDE*2);
    const left=SIDE+usable*(r.start/1440);
    const right=SIDE+usable*((1440-r.end)/1440);
    return {left,right,top:10,bottom:106};
  };
  const syncPreview=()=>{
    const preview=document.getElementById('r15PunchPreview');if(!preview)return;
    preview.innerHTML=model.events.map(e=>{
      const minute=e.value[0],left=(minute/1440*100).toFixed(4),count=e.count||1;
      const width=Math.min(10,2+count*1.25),inside=minute>=currentRange.start&&minute<=currentRange.end;
      const cls=e.direction==='进'?'in':'out';
      return '<span class="r15-punch-stack '+(inside?'inside':'outside')+'" style="left:'+left+'%;width:'+width+'px" title="'+e.direction+' '+count+'"><i class="'+cls+'"></i></span>';
    }).join('');
  };
  const behaviorRowHeight=(api)=>Math.max(1,Math.abs(api.size([0,1])[1]));
  const behaviorLaneHeight=(api)=>behaviorRowHeight(api);
  const behaviorGradient={
    trip:['rgba(107,127,215,.12)','rgba(107,127,215,.42)'],
    leave:['rgba(138,111,209,.11)','rgba(138,111,209,.40)'],
    outing:['rgba(60,157,196,.11)','rgba(60,157,196,.40)'],
    overtime:['rgba(200,118,160,.11)','rgba(200,118,160,.40)']
  };
  const bandRender=(params,api)=>{
    const d=model.bars[params.dataIndex];if(!d)return null;
    const p=api.coord([api.value(0),api.value(2)]),q=api.coord([api.value(1),api.value(2)]);
    const x=Math.min(p[0],q[0]),w=Math.max(1,Math.abs(q[0]-p[0])),h=Math.max(1,behaviorLaneHeight(api)+.5);
    const colors=behaviorGradient[d.track]||['rgba(120,140,160,.12)','rgba(120,140,160,.38)'];
    return {type:'rect',shape:{x,y:p[1]-h/2,width:w,height:h,r:0},
      style:{fill:new echarts.graphic.LinearGradient(0,0,1,0,[
        {offset:0,color:colors[0]},{offset:1,color:colors[1]}
      ]),stroke:'transparent',lineWidth:0}};
  };
  const eventRender=(params,api)=>{
    const d=model.events[params.dataIndex];if(!d)return null;
    const x=api.coord([api.value(0),api.value(1)])[0];
    const yIn=api.coord([api.value(0),0])[1],yOut=api.coord([api.value(0),1])[1];
    const baseline=(yIn+yOut)/2,toward=state.prefs.arrowsTowardLine!==false;
    const count=d.count||1,thickness=Math.min(8.5,2.35+Math.log2(Math.max(1,count))*1.9);
    const len=Math.min(34,27+Math.log2(Math.max(1,count))*2.5);
    const isIn=d.direction==='进',sign=isIn?-1:1;
    const y0=baseline+sign*(toward?len:3),y1=baseline+sign*(toward?3:len);
    const color=isIn?ATTEND_EVENT_COLORS.in:ATTEND_EVENT_COLORS.out,half=Math.max(4,thickness*.68);
    return {type:'group',children:[
      {type:'line',shape:{x1:x,y1:y0,x2:x,y2:y1},style:{stroke:color,lineWidth:thickness,lineCap:'round',opacity:.98}},
      {type:'polygon',shape:{points:[[x-half,y1+sign*(toward?6:-6)],[x+half,y1+sign*(toward?6:-6)],[x,y1]]},style:{fill:color,opacity:.99}}
    ]};
  };
  const railRender=(params,api)=>{
    const lane=api.value(2),track=model.tracks[lane];if(!track||lane<2)return null;
    const p=api.coord([currentRange.start,lane]),q=api.coord([currentRange.end,lane]),h=Math.max(1,behaviorLaneHeight(api)+.5);
    return {type:'rect',shape:{x:p[0],y:p[1]-h/2,width:Math.max(1,q[0]-p[0]),height:h,r:0},
      style:{fill:'rgba(235,239,242,.58)',stroke:'rgba(220,226,231,.38)',lineWidth:.35}};
  };
  const railLabelRender=(params,api)=>{
    const lane=api.value(2),track=model.tracks[lane];if(!track||lane<2)return null;
    const y=api.coord([currentRange.end,lane])[1],active=state.filter===track.key;
    return {type:'text',style:{
      x:chart.getWidth()-SIDE-6,y,text:track.title,fill:active?track.color:'#617586',
      font:(active?'760 ':'700 ')+'17px "Segoe UI Variable", sans-serif',
      align:'right',verticalAlign:'middle',textShadowColor:'rgba(255,255,255,.95)',textShadowBlur:3
    }};
  };
  const scheduleRender=(params,api)=>{
    const from=api.value(0),to=api.value(1);
    const x0=api.coord([from,0])[0],x1=api.coord([to,0])[0];
    const y0=api.coord([from,0])[1],y1=api.coord([from,1])[1],rowH=behaviorRowHeight(api);
    const top=Math.min(y0,y1)-rowH/2,bottom=Math.max(y0,y1)+rowH/2;
    return {type:'rect',shape:{x:Math.min(x0,x1),y:top,width:Math.abs(x1-x0),height:Math.max(1,bottom-top),r:0},
      style:{fill:'rgba(132,155,173,.105)',stroke:'rgba(122,145,164,.13)',lineWidth:.45}};
  };
  const workBoundaryRender=(params,api)=>{
    const x=api.coord([api.value(0),2])[0];
    const y2=api.coord([api.value(0),2])[1],y5=api.coord([api.value(0),5])[1],rowH=behaviorRowHeight(api);
    return {type:'line',shape:{x1:x,y1:Math.min(y2,y5)-rowH/2,x2:x,y2:Math.max(y2,y5)+rowH/2},
      style:{stroke:'rgba(118,137,151,.34)',lineWidth:.8,lineDash:[3,4]}};
  };
  const baselineRender=(params,api)=>{
    const x0=api.coord([currentRange.start,0])[0],x1=api.coord([currentRange.end,0])[0];
    const y0=api.coord([currentRange.start,0])[1],y1=api.coord([currentRange.start,1])[1],y=(y0+y1)/2;
    return {type:'line',shape:{x1:x0,y1:y,x2:x1,y2:y},style:{stroke:'#aab8c3',lineWidth:1.15,opacity:.88}};
  };
  const workBoundaries=()=>model.workWindows.flatMap(w=>[w[0],w[1]]).map(x=>[x]);
  const option={
    animation:state.prefs.motion!==false,animationDuration:180,animationEasing:'cubicOut',
    grid:gridForRange(currentRange),
    tooltip:{trigger:'item',confine:true,backgroundColor:'#fff',borderColor:'#dce8f1',textStyle:{fontSize:11,color:'#385870'},
      formatter:p=>{
        const d=p.data||{};
        if(d.records){
          const head=d.count>1?minuteText(d.start)+'–'+minuteText(d.end)+' · '+d.count+' 条':d.records[0].time+' · '+d.direction;
          return '<b>'+head+'</b>';
        }
        return '<b>'+(d.title||'区间')+'</b><div>'+minuteText(d.value?.[0]||0)+'–'+minuteText(d.value?.[1]||0)+'</div>';
      }},
    xAxis:{type:'value',min:0,max:1440,interval:240,axisLine:{show:false},axisTick:{show:false},
      axisLabel:{fontSize:10,color:'#748a9c',margin:13,formatter:minuteText},
      splitLine:{show:true,lineStyle:{type:'dashed',color:'#e8eef3'}}},
    yAxis:{type:'category',inverse:true,data:model.tracks.map(t=>t.key),axisLine:{show:false},axisTick:{show:false},axisLabel:{show:false},
      splitLine:{show:false},splitArea:{show:false}},
    dataZoom:[
      {id:'inside',type:'inside',xAxisIndex:0,startValue:currentRange.start,endValue:currentRange.end,minValueSpan:15,filterMode:'none',zoomOnMouseWheel:true,moveOnMouseMove:true},
      {id:'slider',type:'slider',xAxisIndex:0,startValue:currentRange.start,endValue:currentRange.end,left:SIDE,right:SIDE,bottom:SLIDER_BOTTOM,height:SLIDER_HEIGHT,
        minValueSpan:15,filterMode:'none',showDetail:false,realtime:true,brushSelect:false,showDataShadow:false,
        backgroundColor:'#edf0f2',fillerColor:'#ffffff',borderColor:'#d9dfe4',
        handleSize:'100%',handleStyle:{color:'#8999a5',borderColor:'#718693',borderWidth:1},
        moveHandleStyle:{color:'#8999a5',opacity:.58}}
    ],
    series:[
      {id:'schedule',type:'custom',coordinateSystem:'cartesian2d',silent:true,animation:false,clip:true,
        data:model.workWindows.map(x=>[x[0],x[1]]),renderItem:scheduleRender,z:0},
      {id:'behavior-rails',type:'custom',coordinateSystem:'cartesian2d',silent:true,animation:false,clip:true,
        data:[2,3,4,5].map(i=>[0,1440,i]),renderItem:railRender,z:2},
      {id:'work-boundaries',type:'custom',coordinateSystem:'cartesian2d',silent:true,animation:false,clip:true,
        data:workBoundaries(),renderItem:workBoundaryRender,z:3},
      {id:'bands',type:'custom',coordinateSystem:'cartesian2d',animation:false,clip:true,data:model.bars,renderItem:bandRender,z:4},
      {id:'event-baseline',type:'custom',coordinateSystem:'cartesian2d',silent:true,animation:false,clip:true,
        data:[[0,1440]],renderItem:baselineRender,z:5},
      {id:'behavior-labels',type:'custom',coordinateSystem:'cartesian2d',silent:true,animation:false,clip:false,
        data:[2,3,4,5].map(i=>[0,1440,i]),renderItem:railLabelRender,z:9},
      {id:'punches',type:'custom',coordinateSystem:'cartesian2d',animation:false,clip:true,data:model.events,renderItem:eventRender,z:7}
    ]
  };
  chart.setOption(option);
  syncPreview();
  chart.on('click',p=>{
    const d=p.data||{};
    if(p.seriesId==='punches'&&d.records?.length){focusRawEvidence('attendance',d.records.map(r=>r.recordId));return}
    if(p.seriesId==='bands'&&d.track&&d.sourceIds?.length)focusRawEvidence(d.track,d.sourceIds);
  });
  chart.on('datazoom',e=>{
    const q=e.batch?.[0]||e;let start=q.startValue,end=q.endValue;
    if(start==null||end==null){if(q.start==null||q.end==null)return;start=q.start*14.4;end=q.end*14.4}
    start=Math.max(0,Math.min(1440,+start));end=Math.max(start+15,Math.min(1440,+end));
    currentRange={key:initialRange.key,start,end};
    state.timelineRange=currentRange;
    model=r14TrackData(a,currentRange,chart.getWidth());
    chart.setOption({
      grid:gridForRange(currentRange),
      series:[
        {id:'schedule',data:model.workWindows.map(x=>[x[0],x[1]])},
        {id:'work-boundaries',data:workBoundaries()},
        {id:'bands',data:model.bars},
        {id:'punches',data:model.events}
      ]
    });
    syncPreview();
  });
}
