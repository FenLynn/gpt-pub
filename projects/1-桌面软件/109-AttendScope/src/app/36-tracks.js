/* R24 timeline: exactly six lanes, with the time baseline between In and Out. */
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
  const SIDE=12,SLIDER_BOTTOM=32,SLIDER_HEIGHT=34;
  const range=timelineRange(a);
  let model=r14TrackData(a,range,chart.getWidth());
  const behaviorLaneHeight=(api)=>Math.max(11,Math.min(15,Math.abs(api.size([0,1])[1])*.46));
  const bandRender=(params,api)=>{
    const d=model.bars[params.dataIndex];if(!d)return null;
    const p=api.coord([api.value(0),api.value(2)]),q=api.coord([api.value(1),api.value(2)]);
    const x=Math.min(p[0],q[0]),w=Math.max(1,Math.abs(q[0]-p[0])),h=behaviorLaneHeight(api);
    const children=[{type:'rect',shape:{x,y:p[1]-h/2,width:w,height:h,r:h/2},
      style:{fill:d.color,opacity:.94,stroke:'rgba(255,255,255,.94)',lineWidth:.8}}];
    if(w>54)children.push({type:'text',style:{
      x:x+w-7,y:p[1],text:d.title,fill:'#344d61',font:'650 9px "Segoe UI Variable", sans-serif',
      align:'right',verticalAlign:'middle'
    }});
    return {type:'group',children};
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
    const p=api.coord([0,lane]),q=api.coord([1440,lane]),h=behaviorLaneHeight(api),active=state.filter===track.key;
    return {type:'rect',shape:{x:p[0],y:p[1]-h/2,width:Math.max(1,q[0]-p[0]),height:h,r:h/2},
      style:{fill:track.color,opacity:active?.13:.055,stroke:track.color,lineWidth:active?.9:.5}};
  };
  const railLabelRender=(params,api)=>{
    const lane=api.value(2),track=model.tracks[lane];if(!track||lane<2)return null;
    const q=api.coord([1440,lane]),active=state.filter===track.key;
    return {type:'group',children:[
      {type:'rect',shape:{x:q[0]-40,y:q[1]-8,width:38,height:16,r:5},
        style:{fill:'rgba(255,255,255,.9)',stroke:'rgba(211,220,227,.72)',lineWidth:.55}},
      {type:'circle',shape:{cx:q[0]-32,cy:q[1],r:2.35},style:{fill:track.color,opacity:active?1:.8}},
      {type:'text',style:{x:q[0]-26,y:q[1],text:track.title,fill:active?'#3f586a':'#667b8b',
        font:(active?'700 ':'600 ')+'8.5px "Segoe UI Variable", sans-serif',align:'left',verticalAlign:'middle'}}
    ]};
  };
  const scheduleRender=(params,api)=>{
    const x0=api.coord([api.value(0),0])[0],x1=api.coord([api.value(1),0])[0],cs=params.coordSys;
    return {type:'rect',shape:{x:Math.min(x0,x1),y:cs.y+4,width:Math.abs(x1-x0),height:Math.max(12,cs.height-8),r:6},
      style:{fill:'rgba(132,155,173,.13)',stroke:'rgba(122,145,164,.20)',lineWidth:.75}};
  };
  const baselineRender=(params,api)=>{
    const x0=api.coord([0,0])[0],x1=api.coord([1440,0])[0];
    const y0=api.coord([0,0])[1],y1=api.coord([0,1])[1],y=(y0+y1)/2;
    return {type:'line',shape:{x1:x0,y1:y,x2:x1,y2:y},style:{stroke:'#aab8c3',lineWidth:1.15,opacity:.88}};
  };
  const option={
    animation:state.prefs.motion!==false,animationDuration:180,animationEasing:'cubicOut',
    grid:{left:SIDE,right:SIDE,top:10,bottom:106},
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
      {id:'inside',type:'inside',xAxisIndex:0,startValue:range.start,endValue:range.end,minValueSpan:15,filterMode:'none',zoomOnMouseWheel:true,moveOnMouseMove:true},
      {id:'slider',type:'slider',xAxisIndex:0,startValue:range.start,endValue:range.end,left:SIDE,right:SIDE,bottom:SLIDER_BOTTOM,height:SLIDER_HEIGHT,
        minValueSpan:15,filterMode:'none',showDetail:false,realtime:true,brushSelect:false,showDataShadow:false,
        backgroundColor:'#e9edf0',fillerColor:'#ffffff',borderColor:'#d6dee4',
        handleSize:'62%',handleStyle:{color:'#8a9aa6',borderColor:'#708592',borderWidth:1},
        moveHandleStyle:{color:'#8a9aa6',opacity:.62}}
    ],
    series:[
      {id:'schedule',type:'custom',coordinateSystem:'cartesian2d',silent:true,animation:false,clip:true,
        data:model.workWindows.map(x=>[x[0],x[1]]),renderItem:scheduleRender,z:1},
      {id:'behavior-rails',type:'custom',coordinateSystem:'cartesian2d',silent:true,animation:false,clip:true,
        data:[2,3,4,5].map(i=>[0,1440,i]),renderItem:railRender,z:2},
      {id:'bands',type:'custom',coordinateSystem:'cartesian2d',animation:false,clip:true,data:model.bars,renderItem:bandRender,z:4},
      {id:'event-baseline',type:'custom',coordinateSystem:'cartesian2d',silent:true,animation:false,clip:true,
        data:[[0,1440]],renderItem:baselineRender,z:5},
      {id:'behavior-labels',type:'custom',coordinateSystem:'cartesian2d',silent:true,animation:false,clip:false,
        data:[2,3,4,5].map(i=>[0,1440,i]),renderItem:railLabelRender,z:6},
      {id:'punches',type:'custom',coordinateSystem:'cartesian2d',animation:false,clip:true,data:model.events,renderItem:eventRender,z:7}
    ]
  };
  chart.setOption(option);
  chart.on('click',p=>{
    const d=p.data||{};
    if(p.seriesId==='punches'&&d.records?.length){focusRawEvidence('attendance',d.records.map(r=>r.recordId));return}
    if(p.seriesId==='bands'&&d.track&&d.sourceIds?.length)focusRawEvidence(d.track,d.sourceIds);
  });
  chart.on('datazoom',e=>{
    const q=e.batch?.[0]||e;let start=q.startValue,end=q.endValue;
    if(start==null||end==null){if(q.start==null||q.end==null)return;start=q.start*14.4;end=q.end*14.4}
    start=Math.max(0,Math.min(1440,+start));end=Math.max(start+15,Math.min(1440,+end));
    state.timelineRange={key:range.key,start,end};
    model=r14TrackData(a,state.timelineRange,chart.getWidth());
    chart.setOption({
      series:[
        {id:'schedule',data:model.workWindows.map(x=>[x[0],x[1]])},
        {id:'bands',data:model.bars},
        {id:'punches',data:model.events}
      ]
    });
  });
}
