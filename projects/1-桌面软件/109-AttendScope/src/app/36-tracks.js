/* R18 audio-track timeline: maximum horizontal space, adaptive punch clustering and linked evidence. */
function r18PunchClusters(a,range,width,lane){
  const span=Math.max(30,range.end-range.start),px=Math.max(200,width||800);
  const mergeMinutes=Math.max(.5,span/px*12);
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
function r14TrackData(a,range=timelineRange(a),width=800){
 const prefs=typeof r14Prefs==='function'?r14Prefs().timelineTracks:{};
 const tracks=[],bars=[];
 const add=(key,title,color,segments)=>{
  if(prefs[key]===false)return;
  if(!segments.length&&!['rules','actual','events'].includes(key))return;
  const lane=tracks.length;tracks.push({key,title,color});
  for(const seg of segments){
   const from=Math.max(0,Math.min(1440,+seg.from)),to=Math.max(0,Math.min(1440,+seg.to));
   if(to>from)bars.push({value:[from,to,lane],color,title:seg.title||title,track:key,sourceId:seg.sourceId||null});
  }
 };
 const required=isWorkday(a.day)?[
  {from:minutes(RULES.amStart),to:minutes(RULES.amEnd),title:'法定上午'},
  {from:minutes(RULES.pmStart),to:minutes(RULES.pmEnd),title:'法定下午'}]:[];
 add('rules','法定工作','#9eb1c2',required);
 const eventLane=tracks.length;tracks.push({key:'events',title:'打卡事件',color:'#72869c'});
 const actualColor=categoryColor(attendanceJudgment(a));
 add('actual','实际在岗',actualColor,a.pairs.map(([p,q])=>({from:minutes(p.time),to:minutes(q.time),title:JUDGMENT_LABELS[attendanceJudgment(a)]+'在岗',sourceId:p.recordId})));
 add('trip','出差',ATTEND_BEHAVIOR_COLORS.trip,a.trips.map(p=>({from:minutes(p.start||RULES.amStart),to:minutes(p.end||RULES.pmEnd),title:'出差',sourceId:p.id})));
 add('leave','请假',ATTEND_BEHAVIOR_COLORS.leave,a.leaves.map(p=>({from:minutes(p.start||RULES.amStart),to:minutes(p.end||RULES.pmEnd),title:'请假',sourceId:p.id})));
 add('outing','外出',ATTEND_BEHAVIOR_COLORS.outing,(a.outings||[]).map(p=>({from:minutes(p.start||RULES.amStart),to:minutes(p.end||RULES.pmEnd),title:'外出',sourceId:p.id})));
 add('overtime','加班',ATTEND_BEHAVIOR_COLORS.overtime,(a.overtime||[]).map(p=>({from:minutes(p.start||'17:30'),to:minutes(p.end||'20:00'),title:'加班',sourceId:p.id})));
 const events=r18PunchClusters(a,range,width,eventLane);
 return {tracks,bars,events,eventLane};
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
   const rowH=Math.abs(api.size([0,1])[1]),h=Math.max(5,Math.min(8,rowH*.28));
   const children=[{type:'rect',shape:{x,y:p[1]-h/2,width:w,height:h,r:2.5},
     style:{fill:d.color,opacity:.92,stroke:'rgba(255,255,255,.78)',lineWidth:.5}}];
   if(w>45)children.push({type:'text',style:{
     x:x+w-4,y:p[1],text:d.title,fill:'#425467',font:'600 9px "Segoe UI Variable", sans-serif',
     align:'right',verticalAlign:'middle'
   }});
   return {type:'group',children};
 };
 const eventRender=(params,api)=>{
   const d=model.events[params.dataIndex];if(!d)return null;
   const p=api.coord([api.value(0),api.value(1)]),sign=d.direction==='进'?-1:1,toward=state.prefs.arrowsTowardLine!==false;
   const count=d.count||1,thickness=Math.min(9,2.5+Math.log2(Math.max(1,count))*2.1);
   const len=Math.min(22,14+Math.log2(Math.max(1,count))*2.5);
   const y0=p[1]+sign*(toward?len:4),y1=p[1]+sign*(toward?3:len);
   const color=d.direction==='进'?ATTEND_EVENT_COLORS.in:ATTEND_EVENT_COLORS.out,half=Math.max(4,thickness*.8);
   return {type:'group',children:[
    {type:'line',shape:{x1:p[0],y1:y0,x2:p[0],y2:y1},style:{stroke:color,lineWidth:thickness,lineCap:'round',opacity:.94}},
    {type:'polygon',shape:{points:[[p[0]-half,y1+sign*(toward?6:-6)],[p[0]+half,y1+sign*(toward?6:-6)],[p[0],y1]]},style:{fill:color,opacity:.96}},
    {type:'circle',shape:{cx:p[0],cy:p[1],r:Math.min(5,2.2+count*.5)},style:{stroke:color,fill:'#fff',lineWidth:Math.min(2.4,1.2+count*.25)}}
   ]};
 };
 const option={
  animation:false,grid:{left:8,right:10,top:8,bottom:62},
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
   axisLabel:{fontSize:10,color:'#8296a8',formatter:minuteText},splitLine:{show:true,lineStyle:{type:'dashed',color:'#e9eef3'}}},
  yAxis:{type:'category',inverse:true,data:model.tracks.map(t=>t.key),axisLine:{show:false},axisTick:{show:false},axisLabel:{show:false},
   splitLine:{show:true,lineStyle:{color:'#edf2f6'}},splitArea:{show:true,areaStyle:{color:['#fbfcfd','#fff']}}},
  dataZoom:[
   {id:'inside',type:'inside',xAxisIndex:0,startValue:range.start,endValue:range.end,minValueSpan:15,filterMode:'none',zoomOnMouseWheel:true,moveOnMouseMove:true},
   {id:'slider',type:'slider',xAxisIndex:0,startValue:range.start,endValue:range.end,left:8,right:10,bottom:13,height:30,
    minValueSpan:15,filterMode:'none',showDetail:false,realtime:true,brushSelect:false,showDataShadow:false,
    backgroundColor:'#aeb7c1',fillerColor:'rgba(239,242,246,.94)',borderColor:'#aab5c0',
    handleSize:'88%',handleStyle:{color:'#647487',borderColor:'#647487'},moveHandleStyle:{color:'#738397',opacity:.68}}
  ],
  series:[
   {id:'bands',type:'custom',coordinateSystem:'cartesian2d',animation:false,clip:true,data:model.bars,renderItem:bandRender,z:4},
   {id:'event-baseline',type:'custom',coordinateSystem:'cartesian2d',silent:true,animation:false,clip:true,
    data:[[0,1440,model.eventLane]],renderItem:(params,api)=>{
      const p=api.coord([0,api.value(2)]),q=api.coord([1440,api.value(2)]);
      return {type:'line',shape:{x1:p[0],y1:p[1],x2:q[0],y2:q[1]},style:{stroke:'#8998a7',lineWidth:1.2,opacity:.72}};
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
   if(p.seriesId==='bands'&&d.track&&['trip','leave','outing','overtime'].includes(d.track)&&d.sourceId){
     focusRawEvidence(d.track,d.sourceId);
   }
 });
 chart.on('datazoom',e=>{
   const q=e.batch?.[0]||e;let start=q.startValue,end=q.endValue;
   if(start==null||end==null){if(q.start==null||q.end==null)return;start=q.start*14.4;end=q.end*14.4}
   start=Math.max(0,Math.min(1440,+start));end=Math.max(start+15,Math.min(1440,+end));
   state.timelineRange={key:range.key,start,end};
   model=r14TrackData(a,state.timelineRange,chart.getWidth());
   chart.setOption({series:[
    {id:'bands',data:model.bars},
    {id:'event-baseline',data:[[0,1440,model.eventLane]]},
    {id:'punches',data:model.events}
   ]});
 });
}
