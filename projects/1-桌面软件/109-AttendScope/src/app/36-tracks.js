/* R19 compact audio timeline: scheduled windows are background bands, punches cluster by zoom. */
function r19PunchClusters(a,range,width,lane){
  const span=Math.max(30,range.end-range.start),px=Math.max(240,width||800);
  const mergeMinutes=Math.max(.45,span/px*11);
  const out=[];
  for(const direction of ['进','出']){
    const rows=a.punches.filter(p=>p.direction===direction).sort((x,y)=>minutes(x.time)-minutes(y.time));
    let group=[];
    const flush=()=>{
      if(!group.length)return;
      const values=group.map(p=>minutes(p.time));
      out.push({
        value:[values.reduce((n,x)=>n+x,0)/values.length,.5,lane],
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
function r19LaneY(coordSys,lane,count){
  const pitch=28,total=Math.max(0,(count-1)*pitch);
  return coordSys.y+(coordSys.height-total)/2+lane*pitch;
}
function r19BehaviorVisible(key){
  if(!behaviorFilterActive())return true;
  return !['trip','leave','outing','overtime'].includes(key)||state.filter===key;
}
function r14TrackData(a,range=timelineRange(a),width=800){
 const prefs=typeof r14Prefs==='function'?r14Prefs().timelineTracks:{};
 const tracks=[],bars=[];
 const add=(key,title,color,segments)=>{
  if(prefs[key]===false||!r19BehaviorVisible(key))return;
  if(!segments.length&&key!=='actual')return;
  const lane=tracks.length;tracks.push({key,title,color});
  for(const seg of segments){
   const from=Math.max(0,Math.min(1440,+seg.from)),to=Math.max(0,Math.min(1440,+seg.to));
   if(to>from)bars.push({
     value:[from,to,lane],color,title:seg.title||title,track:key,
     sourceIds:seg.sourceIds||null
   });
  }
 };
 const workWindows=(prefs.rules===false||!isWorkday(a.day))?[]:[
  [minutes(RULES.amStart),minutes(RULES.amEnd)],
  [minutes(RULES.pmStart),minutes(RULES.pmEnd)]
 ];
 const eventLane=prefs.events===false?-1:tracks.length;
 if(eventLane>=0)tracks.push({key:'events',title:'打卡事件',color:'#72869c'});
 const actualColor=categoryColor(attendanceJudgment(a));
 add('actual','实际在岗',actualColor,a.pairs.map(([p,q])=>({
   from:minutes(p.time),to:minutes(q.time),
   title:JUDGMENT_LABELS[attendanceJudgment(a)]+'在岗',
   sourceIds:[p.recordId,q.recordId]
 })));
 add('trip','出差',ATTEND_BEHAVIOR_COLORS.trip,a.trips.map(p=>({
   from:minutes(p.start||RULES.amStart),to:minutes(p.end||RULES.pmEnd),title:'出差',sourceIds:[p.id]
 })));
 add('leave','请假',ATTEND_BEHAVIOR_COLORS.leave,a.leaves.map(p=>({
   from:minutes(p.start||RULES.amStart),to:minutes(p.end||RULES.pmEnd),title:'请假',sourceIds:[p.id]
 })));
 add('outing','外出',ATTEND_BEHAVIOR_COLORS.outing,(a.outings||[]).map(p=>({
   from:minutes(p.start||RULES.amStart),to:minutes(p.end||RULES.pmEnd),title:'外出',sourceIds:[p.id]
 })));
 add('overtime','加班',ATTEND_BEHAVIOR_COLORS.overtime,(a.overtime||[]).map(p=>({
   from:minutes(p.start||'17:30'),to:minutes(p.end||'20:00'),title:'加班',sourceIds:[p.id]
 })));
 const events=eventLane>=0?r19PunchClusters(a,range,width,eventLane):[];
 return {tracks,bars,events,eventLane,workWindows};
}
function mountAttendanceTimeline(a){
 const el=document.getElementById('attendanceTimelineChart');if(!el||!window.echarts)return;
 const chart=initAttendChart(el);if(!chart)return;
 const range=timelineRange(a);
 let model=r14TrackData(a,range,chart.getWidth());
 const bandRender=(params,api)=>{
   const d=model.bars[params.dataIndex];if(!d)return null;
   const p=api.coord([api.value(0),.5]),q=api.coord([api.value(1),.5]);
   const x=Math.min(p[0],q[0]),w=Math.max(1,Math.abs(q[0]-p[0]));
   const y=r19LaneY(params.coordSys,api.value(2),model.tracks.length),h=6;
   const children=[{type:'rect',shape:{x,y:y-h/2,width:w,height:h,r:3},
     style:{fill:d.color,opacity:.94,stroke:'rgba(255,255,255,.82)',lineWidth:.55}}];
   if(w>34)children.push({type:'text',style:{
     x:x+w-4,y,text:d.title,fill:'#405466',font:'600 9px "Segoe UI Variable", sans-serif',
     align:'right',verticalAlign:'middle'
   }});
   return {type:'group',children};
 };
 const eventRender=(params,api)=>{
   const d=model.events[params.dataIndex];if(!d)return null;
   const x=api.coord([api.value(0),.5])[0],y=r19LaneY(params.coordSys,api.value(2),model.tracks.length);
   const sign=d.direction==='进'?-1:1,toward=state.prefs.arrowsTowardLine!==false;
   const count=d.count||1,thickness=Math.min(9,2.25+Math.log2(Math.max(1,count))*2.2);
   const len=Math.min(23,14+Math.log2(Math.max(1,count))*2.7);
   const y0=y+sign*(toward?len:3),y1=y+sign*(toward?1.5:len);
   const color=d.direction==='进'?ATTEND_EVENT_COLORS.in:ATTEND_EVENT_COLORS.out,half=Math.max(4,thickness*.8);
   return {type:'group',children:[
    {type:'line',shape:{x1:x,y1:y0,x2:x,y2:y1},style:{stroke:color,lineWidth:thickness,lineCap:'round',opacity:.95}},
    {type:'polygon',shape:{points:[[x-half,y1+sign*(toward?6:-6)],[x+half,y1+sign*(toward?6:-6)],[x,y1]]},style:{fill:color,opacity:.97}}
   ]};
 };
 const laneRailRender=(params,api)=>{
   const lane=api.value(2),y=r19LaneY(params.coordSys,lane,model.tracks.length);
   const x0=api.coord([0,.5])[0],x1=api.coord([1440,.5])[0];
   return {type:'line',shape:{x1:x0,y1:y,x2:x1,y2:y},style:{stroke:'#e4ebf0',lineWidth:1,opacity:.9}};
 };
 const scheduleRender=(params,api)=>{
   const from=api.value(0),to=api.value(1),x0=api.coord([from,.5])[0],x1=api.coord([to,.5])[0];
   const first=r19LaneY(params.coordSys,0,model.tracks.length),last=r19LaneY(params.coordSys,Math.max(0,model.tracks.length-1),model.tracks.length);
   return {type:'rect',shape:{x:Math.min(x0,x1),y:first-14,width:Math.abs(x1-x0),height:Math.max(28,last-first+28),r:3},
     style:{fill:'rgba(144,164,181,.075)',stroke:'rgba(144,164,181,.13)',lineWidth:.6}};
 };
 const option={
  animation:false,grid:{left:6,right:8,top:7,bottom:62},
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
   axisLabel:{fontSize:10,color:'#8296a8',formatter:minuteText},splitLine:{show:true,lineStyle:{type:'dashed',color:'#edf2f5'}}},
  yAxis:{type:'value',min:0,max:1,show:false},
  dataZoom:[
   {id:'inside',type:'inside',xAxisIndex:0,startValue:range.start,endValue:range.end,minValueSpan:15,filterMode:'none',zoomOnMouseWheel:true,moveOnMouseMove:true},
   {id:'slider',type:'slider',xAxisIndex:0,startValue:range.start,endValue:range.end,left:6,right:8,bottom:13,height:30,
    minValueSpan:15,filterMode:'none',showDetail:false,realtime:true,brushSelect:false,showDataShadow:false,
    backgroundColor:'#aeb7c1',fillerColor:'rgba(239,242,246,.94)',borderColor:'#aab5c0',
    handleSize:'88%',handleStyle:{color:'#647487',borderColor:'#647487'},moveHandleStyle:{color:'#738397',opacity:.68}}
  ],
  series:[
   {id:'schedule',type:'custom',coordinateSystem:'cartesian2d',silent:true,animation:false,clip:true,
    data:model.workWindows.map(x=>[x[0],x[1]]),renderItem:scheduleRender,z:1},
   {id:'lane-rails',type:'custom',coordinateSystem:'cartesian2d',silent:true,animation:false,clip:true,
    data:model.tracks.map((_,i)=>[0,1440,i]),renderItem:laneRailRender,z:2},
   {id:'bands',type:'custom',coordinateSystem:'cartesian2d',animation:false,clip:true,data:model.bars,renderItem:bandRender,z:4},
   {id:'event-baseline',type:'custom',coordinateSystem:'cartesian2d',silent:true,animation:false,clip:true,
    data:model.eventLane>=0?[[0,1440,model.eventLane]]:[],renderItem:(params,api)=>{
      const y=r19LaneY(params.coordSys,api.value(2),model.tracks.length);
      const x0=api.coord([0,.5])[0],x1=api.coord([1440,.5])[0];
      return {type:'line',shape:{x1:x0,y1:y,x2:x1,y2:y},style:{stroke:'#8897a6',lineWidth:1.25,opacity:.82}};
    },z:5},
   {id:'punches',type:'custom',coordinateSystem:'cartesian2d',animation:false,clip:true,data:model.events,renderItem:eventRender,z:7}
  ]
 };
 chart.setOption(option);
 chart.on('click',p=>{
   const d=p.data||{};
   if(p.seriesId==='punches'&&d.records?.length){
     focusRawEvidence('attendance',d.records.map(r=>r.recordId));return;
   }
   if(p.seriesId==='bands'&&d.track&&d.sourceIds?.length){
     const kind=d.track==='actual'?'attendance':d.track;
     focusRawEvidence(kind,d.sourceIds);
   }
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
     {id:'lane-rails',data:model.tracks.map((_,i)=>[0,1440,i])},
     {id:'bands',data:model.bars},
     {id:'event-baseline',data:model.eventLane>=0?[[0,1440,model.eventLane]]:[]},
     {id:'punches',data:model.events}
    ]
   });
 });
}
