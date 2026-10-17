/* R23 timeline: strong schedule windows, long punch arrows, fixed behavior rails and aligned overview. */
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
 const prefs=typeof r14Prefs==='function'?r14Prefs().timelineTracks:{};
 const tracks=[],bars=[];
 const add=(key,title,color,segments,{always=false}={})=>{
  const source=prefs[key]===false?[]:segments;
  if(!always&&!source.length&&key!=='actual')return;
  const lane=tracks.length;tracks.push({key,title,color});
  for(const seg of source){
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
 })),{always:true});
 for(const [key,title] of [['trip','出差'],['leave','请假'],['outing','外出'],['overtime','加班']]){
   add(key,title,ATTEND_BEHAVIOR_COLORS[key],r23BehaviorSegments(a,key),{always:true});
 }
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
   const p=api.coord([api.value(0),api.value(2)]),q=api.coord([api.value(1),api.value(2)]);
   const x=Math.min(p[0],q[0]),w=Math.max(1,Math.abs(q[0]-p[0]));
   const rowH=Math.max(22,Math.abs(api.size([0,1])[1]));
   const h=d.track==='actual'?Math.max(14,Math.min(17,rowH*.52)):Math.max(7,Math.min(10,rowH*.31));
   const children=[{type:'rect',shape:{x,y:p[1]-h/2,width:w,height:h,r:h/2},
     style:{fill:d.color,opacity:d.track==='actual'?.95:.9,stroke:'rgba(255,255,255,.96)',lineWidth:.7,
       shadowBlur:d.track==='actual'?2:0,shadowColor:'rgba(52,74,91,.10)'}}];
   if(w>58)children.push({type:'text',style:{
     x:x+w-7,y:p[1],text:d.title,fill:'#385064',font:'600 9px "Segoe UI Variable", sans-serif',
     align:'right',verticalAlign:'middle'
   }});
   return {type:'group',children};
 };
 const eventRender=(params,api)=>{
   const d=model.events[params.dataIndex];if(!d)return null;
   const p=api.coord([api.value(0),api.value(1)]),sign=d.direction==='进'?-1:1,toward=state.prefs.arrowsTowardLine!==false;
   const count=d.count||1,thickness=Math.min(9,2.4+Math.log2(Math.max(1,count))*2);
   const len=Math.min(34,27+Math.log2(Math.max(1,count))*2.6);
   const y0=p[1]+sign*(toward?len:4),y1=p[1]+sign*(toward?3:len);
   const color=d.direction==='进'?ATTEND_EVENT_COLORS.in:ATTEND_EVENT_COLORS.out,half=Math.max(4.2,thickness*.72);
   return {type:'group',children:[
    {type:'line',shape:{x1:p[0],y1:y0,x2:p[0],y2:y1},style:{stroke:color,lineWidth:thickness,lineCap:'round',opacity:.96}},
    {type:'polygon',shape:{points:[[p[0]-half,y1+sign*(toward?6:-6)],[p[0]+half,y1+sign*(toward?6:-6)],[p[0],y1]]},style:{fill:color,opacity:.98}}
   ]};
 };
 const railRender=(params,api)=>{
   const lane=api.value(2),track=model.tracks[lane];if(!track)return null;
   const key=track.key;if(!['trip','leave','outing','overtime'].includes(key))return null;
   const p=api.coord([0,lane]),q=api.coord([1440,lane]);
   const active=state.filter===key,rowH=Math.max(22,Math.abs(api.size([0,1])[1])),h=Math.max(8,Math.min(11,rowH*.34));
   return {type:'rect',shape:{x:p[0],y:p[1]-h/2,width:Math.max(1,q[0]-p[0]),height:h,r:h/2},
     style:{fill:track.color,opacity:active?.15:.062,stroke:track.color,lineWidth:active?.9:.5}};
 };
 const railLabelRender=(params,api)=>{
   const lane=api.value(2),track=model.tracks[lane];if(!track)return null;
   const key=track.key;if(!['trip','leave','outing','overtime'].includes(key))return null;
   const q=api.coord([1440,lane]),active=state.filter===key;
   return {type:'group',children:[
     {type:'rect',shape:{x:q[0]-39,y:q[1]-8,width:37,height:16,r:5},
       style:{fill:'rgba(255,255,255,.86)',stroke:'rgba(210,220,228,.66)',lineWidth:.55}},
     {type:'circle',shape:{cx:q[0]-31,cy:q[1],r:2.3},style:{fill:track.color,opacity:active?1:.78}},
     {type:'text',style:{x:q[0]-25,y:q[1],text:track.title,fill:active?'#425b6d':'#667b8b',
       font:(active?'700 ':'600 ')+'8.5px "Segoe UI Variable", sans-serif',align:'left',verticalAlign:'middle'}}
   ]};
 };
 const scheduleRender=(params,api)=>{
   const from=api.value(0),to=api.value(1);
   const x0=api.coord([from,0])[0],x1=api.coord([to,0])[0],cs=params.coordSys;
   return {type:'rect',shape:{x:Math.min(x0,x1),y:cs.y+4,width:Math.abs(x1-x0),height:Math.max(12,cs.height-8),r:6},
     style:{fill:'rgba(132,155,173,.14)',stroke:'rgba(122,145,164,.22)',lineWidth:.75}};
 };
 const option={
  animation:state.prefs.motion!==false,animationDuration:180,animationEasing:'cubicOut',
  grid:{left:10,right:10,top:10,bottom:112},
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
   splitLine:{show:true,lineStyle:{color:'#eef2f5'}},splitArea:{show:false}},
  dataZoom:[
   {id:'inside',type:'inside',xAxisIndex:0,startValue:range.start,endValue:range.end,minValueSpan:15,filterMode:'none',zoomOnMouseWheel:true,moveOnMouseMove:true},
   {id:'slider',type:'slider',xAxisIndex:0,startValue:range.start,endValue:range.end,left:10,right:10,bottom:28,height:38,
    minValueSpan:15,filterMode:'none',showDetail:false,realtime:true,brushSelect:false,showDataShadow:false,
    backgroundColor:'#edf2f5',fillerColor:'rgba(138,184,216,.78)',borderColor:'#ccdbe5',
    handleSize:'84%',handleStyle:{color:'#6f8da1',borderColor:'#5f7f94',borderWidth:1},
    moveHandleStyle:{color:'#6f8da1',opacity:.68}}
  ],
  series:[
   {id:'schedule',type:'custom',coordinateSystem:'cartesian2d',silent:true,animation:false,clip:true,
    data:model.workWindows.map(x=>[x[0],x[1]]),renderItem:scheduleRender,z:1},
   {id:'behavior-rails',type:'custom',coordinateSystem:'cartesian2d',silent:true,animation:false,clip:true,
    data:model.tracks.map((_,i)=>[0,1440,i]),renderItem:railRender,z:2},
   {id:'behavior-labels',type:'custom',coordinateSystem:'cartesian2d',silent:true,animation:false,clip:false,
    data:model.tracks.map((_,i)=>[0,1440,i]),renderItem:railLabelRender,z:6},
   {id:'bands',type:'custom',coordinateSystem:'cartesian2d',animation:false,clip:true,data:model.bars,renderItem:bandRender,z:4},
   {id:'event-baseline',type:'custom',coordinateSystem:'cartesian2d',silent:true,animation:false,clip:true,
    data:model.eventLane>=0?[[0,1440,model.eventLane]]:[],renderItem:(params,api)=>{
      const p=api.coord([0,api.value(2)]),q=api.coord([1440,api.value(2)]);
      return {type:'line',shape:{x1:p[0],y1:p[1],x2:q[0],y2:q[1]},style:{stroke:'#a8b7c3',lineWidth:1.1,opacity:.82}};
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
    yAxis:{data:model.tracks.map(t=>t.key)},
    series:[
     {id:'schedule',data:model.workWindows.map(x=>[x[0],x[1]])},
     {id:'behavior-rails',data:model.tracks.map((_,i)=>[0,1440,i])},
     {id:'behavior-labels',data:model.tracks.map((_,i)=>[0,1440,i])},
     {id:'bands',data:model.bars},
     {id:'event-baseline',data:model.eventLane>=0?[[0,1440,model.eventLane]]:[]},
     {id:'punches',data:model.events}
    ]
   });
 });
}
