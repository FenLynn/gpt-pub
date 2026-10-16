/* Multi-lane time evidence; one native ECharts overview scrollbar. */
function r14TrackData(a){
 const prefs=typeof r14Prefs==='function'?r14Prefs().timelineTracks:{};
 const tracks=[],bars=[],events=[];
 const add=(key,title,color,segments)=>{
  if(prefs[key]===false)return;
  if(!segments.length&&!['rules','actual','events'].includes(key))return;
  const lane=tracks.length;
  tracks.push({key,title,color});
  for(const s of segments){
   const from=Math.max(0,Math.min(1440,+s.from)),to=Math.max(0,Math.min(1440,+s.to));
   if(to>from)bars.push({value:[from,to,lane],color,title:s.title||title});
  }
  if(key==='events')for(const p of a.punches)events.push({value:[minutes(p.time),lane],p});
 };
 const required=isWorkday(a.day)?[
  {from:minutes(RULES.amStart),to:minutes(RULES.amEnd),title:'上午法定工作'},
  {from:minutes(RULES.pmStart),to:minutes(RULES.pmEnd),title:'下午法定工作'}]:[];
 add('rules','法定工作','#94b9d4',required);
 add('actual','实际在岗','#72c5a4',a.pairs.map(([p,q])=>({from:minutes(p.time),to:minutes(q.time),title:p.time+'–'+q.time})));
 const allTimes=a.punches.map(p=>minutes(p.time)).sort((x,y)=>x-y);
 add('span','首末打卡','#a9bad0',allTimes.length>1?
  [{from:allTimes[0],to:allTimes[allTimes.length-1],title:'首末打卡跨度'}]:[]);

 add('leave','请假','#e4aa79',a.leaves.map(p=>({from:minutes(p.start||RULES.amStart),to:minutes(p.end||RULES.pmEnd),title:p.type||'请假'})));
 add('trip','出差','#68bdb6',a.trips.map(p=>({from:minutes(p.start||'00:00'),to:minutes(p.end||'24:00'),title:p.type||'出差'})));
 const outing=(state.outings||[]).filter(p=>p.employeeId===a.employee.id&&a.date>=p.startDate&&a.date<=p.endDate);
 add('outing','外出','#d8ae6d',outing.map(p=>({from:minutes(p.start||'00:00'),to:minutes(p.end||'24:00'),title:p.type||'外出'})));
 add('events','打卡事件','#648ca7',[]);
 return {tracks,bars,events};
}
function mountAttendanceTimeline(a){
 const el=document.getElementById('attendanceTimelineChart');if(!el||!window.echarts)return;
 const chart=initAttendChart(el);if(!chart)return;
 const range=timelineRange(a),model=r14TrackData(a);
 const density=Array.from({length:73},(_,i)=>[i*20,0]);
 for(const p of a.punches){density[Math.min(72,Math.max(0,Math.round(minutes(p.time)/20)))][1]++}
 const rowSize=Math.min(23,Math.max(12,160/Math.max(2,model.tracks.length)));
 const shade=Math.max(2,...density.map(p=>p[1]))+1;
 const timelineOption={
  animation:false,grid:{left:76,right:12,top:10,bottom:70},
  tooltip:{trigger:'item',confine:true,formatter:p=>{
   const d=p.data||{};
   return d.p?'<b>'+d.p.time+'</b> · '+d.p.direction:
    '<b>'+(d.title||'区间')+'</b><div>'+minuteText(d.value?.[0]||0)+'–'+minuteText(d.value?.[1]||0)+'</div>';
  }},
  xAxis:{type:'value',min:0,max:1440,interval:240,axisLine:{show:false},axisTick:{show:false},
   axisLabel:{fontSize:10,color:'#8296a8',formatter:minuteText},
   splitLine:{show:true,lineStyle:{type:'dashed',color:'#e8eef3'}}},
  yAxis:[
   {type:'category',inverse:true,data:model.tracks.map(t=>t.title),
    axisLine:{show:false},axisTick:{show:false},axisLabel:{fontSize:11,color:'#647e92',fontWeight:650},
    splitLine:{show:true,lineStyle:{color:'#e9eff5'}},
    splitArea:{show:true,areaStyle:{color:['#f8fafc','#fff']}}},
   {type:'value',min:0,max:shade,show:false}
  ],
  dataZoom:[
   {id:'inside',type:'inside',xAxisIndex:0,startValue:range.start,endValue:range.end,
     minValueSpan:30,filterMode:'none',zoomOnMouseWheel:true,moveOnMouseMove:true},
   {id:'slider',type:'slider',xAxisIndex:0,startValue:range.start,endValue:range.end,
     left:76,right:12,bottom:13,height:29,minValueSpan:30,filterMode:'none',
     showDetail:false,realtime:true,brushSelect:false,showDataShadow:true,
     backgroundColor:'#b6bec8',fillerColor:'rgba(237,241,246,.93)',borderColor:'#b0bcca',
     dataBackground:{lineStyle:{color:'#6d7b89',width:1.4},areaStyle:{color:'rgba(98,110,125,.78)'}},
     selectedDataBackground:{lineStyle:{color:'#42566c',width:1.9},areaStyle:{color:'rgba(194,203,213,.63)'}},
     handleSize:'85%',handleStyle:{color:'#65788d',borderColor:'#65788d'},
     moveHandleStyle:{color:'#708196',opacity:.7}
   }
  ],
  series:[
   {id:'day-density',type:'line',yAxisIndex:1,xAxisIndex:0,data:density,silent:true,
    showSymbol:false,animation:false,step:'middle',
    lineStyle:{color:'#788797',opacity:.02},
    areaStyle:{color:'rgba(107,118,130,.02)'},z:-2},
   {id:'bands',type:'custom',coordinateSystem:'cartesian2d',animation:false,clip:true,
    data:model.bars,
    renderItem:(params,api)=>{
     const d=model.bars[params.dataIndex];if(!d)return null;
     const p=api.coord([api.value(0),api.value(2)]);
     const q=api.coord([api.value(1),api.value(2)]);
     return {type:'rect',
       shape:{x:Math.min(p[0],q[0]),y:p[1]-rowSize/2,width:Math.max(1,Math.abs(q[0]-p[0])),height:rowSize,r:5},
       style:{fill:d.color,opacity:.91}};
    },z:4},
   {id:'event-baseline',type:'custom',coordinateSystem:'cartesian2d',silent:true,animation:false,clip:true,
    data:model.tracks.some(t=>t.key==='events')?[[0,1440,model.tracks.findIndex(t=>t.key==='events')]]:[],
    renderItem:(params,api)=>{const from=api.coord([0,api.value(2)]),to=api.coord([1440,api.value(2)]);
      return {type:'line',shape:{x1:from[0],y1:from[1],x2:to[0],y2:to[1]},
        style:{stroke:'#72869c',lineWidth:1.6,opacity:.75}};
    },z:5},
   {id:'punches',type:'custom',coordinateSystem:'cartesian2d',animation:false,clip:true,
    data:model.events,
    renderItem:(params,api)=>{
     const d=model.events[params.dataIndex];if(!d)return null;
     const p=api.coord([api.value(0),api.value(1)]);
     const sign=d.p.direction==='进'?-1:1,toward=state.prefs.arrowsTowardLine!==false;
     const y0=p[1]+sign*(toward?20:5),y1=p[1]+sign*(toward?4:20);
     const color=sign<0?'#258ccd':'#d78851';
     return {type:'group',children:[
      {type:'line',shape:{x1:p[0],y1:y0,x2:p[0],y2:y1},style:{stroke:color,lineWidth:3.1,lineCap:'round'}},
      {type:'polygon',shape:{points:[[p[0]-5,y1+sign*(toward?7:-7)],[p[0]+5,y1+sign*(toward?7:-7)],[p[0],y1]]},style:{fill:color}},
      {type:'circle',shape:{cx:p[0],cy:p[1],r:2.5},style:{stroke:color,fill:'#fff',lineWidth:1.3}}
     ]};
    },z:7}
  ]
 };
 chart.setOption(timelineOption);
 chart.on('click',p=>{if(p.seriesId==='punches'&&p.data?.p)showRecord(p.data.p.recordId)});
 chart.on('datazoom',e=>{
   const q=e.batch?.[0]||e;
   let start=q.startValue,end=q.endValue;
   if(start==null||end==null){if(q.start==null||q.end==null)return;start=q.start*14.4;end=q.end*14.4}
   start=Math.max(0,Math.min(1440,Math.round(start)));
   end=Math.max(start+30,Math.min(1440,Math.round(end)));
   state.timelineRange={key:range.key,start,end};
   const label=document.getElementById('timelineWindowLabel');
   if(label)label.textContent=minuteText(start)+'–'+minuteText(end);
 });
}
