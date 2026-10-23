/* R29 timeline: restore proven R27 geometry; only pin labels and refine lane guides. */
function r19PunchClusters(a,range,width,fixedLane=null){
  const span=Math.max(30,range.end-range.start),px=Math.max(240,width||800);
  const mergeMinutes=Math.max(.45,span/Math.max(160,px-24)*11),maxGroupSpan=Math.max(.8,mergeMinutes*1.6),out=[];
  for(const direction of ['进','出','未标注']){
    const rows=a.punches.filter(p=>(direction==='未标注'?!['进','出'].includes(p.direction):p.direction===direction)&&Number.isFinite(minutes(p.time))&&minutes(p.time)>=range.start&&minutes(p.time)<=range.end).sort((x,y)=>minutes(x.time)-minutes(y.time));
    let group=[];
    const flush=()=>{
      if(!group.length)return;
      const values=group.map(p=>minutes(p.time));
      const lane=Number.isFinite(fixedLane)?fixedLane:(direction==='进'?0:direction==='出'?1:.5);
      out.push({
        value:[values.reduce((n,x)=>n+x,0)/values.length,lane],
        p:group[0],records:[...group],count:group.length,direction,
        start:Math.min(...values),end:Math.max(...values)
      });
      group=[];
    };
    for(const p of rows){
      const m=minutes(p.time);
      if(group.length&&(m-minutes(group[group.length-1].time)>mergeMinutes||m-minutes(group[0].time)>maxGroupSpan))flush();
      group.push(p);
    }
    flush();
  }
  return out.sort((x,y)=>x.value[0]-y.value[0]);
}
function r23BehaviorSegments(a,key){
  if(key==='trip')return (a.trips||[]).map(p=>({from:minutes(p.start||RULES.amStart),to:minutes(p.end||RULES.pmEnd),title:'出差',sourceIds:[p.id]}));
  if(key==='leave')return (a.leaves||[]).map(p=>({from:minutes(p.start||RULES.amStart),to:minutes(p.end||RULES.pmEnd),title:'请假',sourceIds:[p.id]}));
  if(key==='outing')return [
   ...(a.outings||[]).map(p=>({from:minutes(p.start||RULES.amStart),to:minutes(p.end||RULES.pmEnd),title:'Excel 外出报备',origin:'registered',sourceIds:[p.id]})),
   ...(a.temporaryOutings||[]).flatMap(p=>p.parts.map(([from,to])=>({from,to,
    title:(p.origin==='manual'?'补录':'自动')+'临时外出 · '+({green:'绿色',red:'红色',exclude:'已排除'}[p.status]),
    origin:'temporary',manual:p.origin==='manual',status:p.status,reason:p.reason,minutes:p.minutes,note:p.note,
    manualDecision:p.manualDecision,segmentId:p.id,sourceIds:p.sourceIds})))
  ];
  if(key==='overtime')return [
   ...(a.overtime||[]).map(p=>({from:minutes(p.start||RULES.pmEnd),to:minutes(p.end||'20:00'),
    title:'登记加班',origin:'registered',sourceIds:[p.id]})),
   ...(a.autoOvertime?.segments||[]).map(p=>({from:p.from,to:p.to,
    title:(p.origin==='manual'?'补录加班':'自动加班')+(p.accepted!==false?' · 已勾选':' · 已取消'),
    origin:p.origin||'auto',accepted:p.accepted!==false,segmentId:p.id,sourceIds:null}))
  ];
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
    for(const seg of (state.prefs?.timelineTracks?.[key]===false?[]:r23BehaviorSegments(a,key))){
      const from=Math.max(0,Math.min(1440,+seg.from)),to=Math.max(0,Math.min(1440,+seg.to));
      if(to>from)bars.push({value:[from,to,lane],color:track.color,title:seg.title||track.title,track:key,
        sourceIds:seg.sourceIds||null,origin:seg.origin||'registered',
        accepted:seg.accepted!==false,segmentId:seg.segmentId||null});
      if(to>from)Object.assign(bars[bars.length-1],{status:seg.status,reason:seg.reason,minutes:seg.minutes,note:seg.note,manual:seg.manual,manualDecision:seg.manualDecision});
    }
  }
  const workWindows=!isWorkday(a.day)||state.prefs?.timelineTracks?.rules===false?[]:[
    [minutes(RULES.amStart),minutes(RULES.amEnd)],
    [minutes(RULES.pmStart),minutes(RULES.pmEnd)]
  ];
  return {tracks,bars,events:state.prefs?.timelineTracks?.events===false?[]:r19PunchClusters(a,range,width),workWindows};
}
function mountAttendanceTimeline(a){
  const el=document.getElementById('attendanceTimelineChart');if(!el||!window.echarts)return;
  const chart=initAttendChart(el);if(!chart)return;
  const SIDE=12,SLIDER_BOTTOM=30,SLIDER_HEIGHT=34;
  const labelFont='700 14px "Segoe UI Variable", sans-serif',labelRight=SIDE+8;
  const range=timelineRange(a);
  let model=r14TrackData(a,range,chart.getWidth());
  const behaviorRowHeight=(api)=>Math.max(1,Math.abs(api.size([0,1])[1]));
  const behaviorLaneHeight=(api)=>behaviorRowHeight(api);
  const behaviorGradient={
    trip:['rgba(107,127,215,.18)','rgba(107,127,215,.56)'],
    leave:['rgba(138,111,209,.16)','rgba(138,111,209,.54)'],
    outing:['rgba(60,157,196,.16)','rgba(60,157,196,.54)'],
    overtime:['rgba(191,105,113,.39)','rgba(229,163,170,.78)']
  };
  const bandRender=(params,api)=>{
    const d=model.bars[params.dataIndex];if(!d)return null;
    const p=api.coord([api.value(0),api.value(2)]),q=api.coord([api.value(1),api.value(2)]);
    const x=Math.min(p[0],q[0]),w=Math.max(1,Math.abs(q[0]-p[0])),h=Math.max(1,behaviorLaneHeight(api)+.5);
    if(d.origin==='temporary'){
      const palette=d.status==='red'?['rgba(214,76,88,.36)','#bc4e5a']:
       d.status==='exclude'?['rgba(145,157,166,.12)','#9ba8b0']:['rgba(52,169,111,.34)','#2d9568'];
      return {type:'rect',shape:{x,y:p[1]-h*.44,width:w,height:h*.61,r:2},
       style:{fill:palette[0],stroke:palette[1],lineWidth:1,lineDash:d.status==='exclude'?[3,3]:undefined}};
    }
    if(d.track==='overtime'){
      const kind=d.origin==='auto'?'auto':'registered';
      const palette=d.accepted===false?OVERTIME_VISUALS.excluded:OVERTIME_VISUALS[kind];
      return {type:'rect',
        shape:{x,y:p[1]-h/2,width:w,height:h,r:0},
        style:{fill:new echarts.graphic.LinearGradient(0,0,1,0,[
          {offset:0,color:palette.top},{offset:1,color:palette.bottom}
        ]),stroke:'rgba(163,84,99,.18)',lineWidth:.45}
      };
    }
    const colors=behaviorGradient[d.track]||['rgba(120,140,160,.18)','rgba(120,140,160,.5)'];
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
    if(!['进','出'].includes(d.direction))return {type:'circle',shape:{cx:x,cy:baseline,r:4.5},style:{fill:'#8595a4',stroke:'#fff',lineWidth:1.5}};
    const count=d.count||1,thickness=Math.min(8.5,2.35+Math.log2(Math.max(1,count))*1.9);
    const laneHeight=behaviorRowHeight(api);
    // Baseline is between the two punch rows. Each arrow should span its
    // complete half of the two-row band, rather than stopping at 34px.
    const len=Math.max(10,laneHeight-4);
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
    const p=api.coord([0,lane]),q=api.coord([1440,lane]),h=Math.max(1,behaviorLaneHeight(api)+.5);
    return {type:'rect',shape:{x:p[0],y:p[1]-h/2,width:Math.max(1,q[0]-p[0]),height:h,r:0},
      style:{fill:'rgba(247,249,250,.84)',stroke:'rgba(201,212,220,.72)',lineWidth:.62}};
  };
  const railLabelRender=(params,api)=>{
    const lane=api.value(2),track=model.tracks[lane];if(!track||lane<2)return null;
    const q=api.coord([1440,lane]);
    return {type:'text',style:{
      x:chart.getWidth()-labelRight,y:q[1],text:track.title,fill:track.color,
      font:labelFont,
      align:'right',verticalAlign:'middle',
      textShadowColor:'rgba(255,255,255,.96)',textShadowBlur:2
    }};
  };
  const scheduleRender=(params,api)=>{
    const from=api.value(0),to=api.value(1),x0=api.coord([from,0])[0],x1=api.coord([to,0])[0];
    const y0=api.coord([from,0])[1],y1=api.coord([from,1])[1],rowH=behaviorRowHeight(api);
    const top=Math.min(y0,y1)-rowH/2,bottom=Math.max(y0,y1)+rowH/2;
    return {type:'rect',shape:{x:Math.min(x0,x1),y:top,width:Math.abs(x1-x0),height:Math.max(1,bottom-top),r:0},
      style:{fill:'rgba(132,155,173,.085)',stroke:'rgba(122,145,164,.105)',lineWidth:.45}};
  };
  const workBoundaryRender=(params,api)=>{
    const x=api.coord([api.value(0),2])[0];
    const y2=api.coord([api.value(0),2])[1],y5=api.coord([api.value(0),5])[1],rowH=behaviorRowHeight(api);
    return {type:'line',shape:{x1:x,y1:Math.min(y2,y5)-rowH/2,x2:x,y2:Math.max(y2,y5)+rowH/2},
      style:{stroke:'rgba(122,140,153,.36)',lineWidth:.8,lineDash:[3,4]}};
  };
  const workBoundaries=()=>model.workWindows.flatMap(w=>[w[0],w[1]]).map(x=>[x]);
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
        if(d.origin==='temporary')return '<b>'+safeTableText(d.title)+'</b><div>'+p109IntervalClock(d.value[0])+'–'+p109IntervalClock(d.value[1])+
          ' · 班内合计 '+p109IntervalDuration(d.minutes)+'</div><div>'+safeTableText(d.manualDecision?'人工改判；自动依据：'+d.reason:d.reason)+
          '</div>'+(d.note?'<div>'+safeTableText(d.note)+'</div>':'');
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
        data:[2,3,4,5].map(i=>[0,1440,i]),renderItem:railLabelRender,z:6},
      {id:'punches',type:'custom',coordinateSystem:'cartesian2d',animation:false,clip:true,data:model.events,renderItem:eventRender,z:7}
    ]
  };
  chart.setOption(option);
  // R74: draw decision tags beside, rather than on top of, punch arrows.
  const syncAttendanceFlags=()=>{
    const layer=document.getElementById('attendanceFlagsLayer');
    if(!layer||!layer.isConnected)return;
    layer.replaceChildren();
    const visible=state.timelineRange||range,width=chart.getWidth(),height=chart.getHeight();
    const placed=[];
    for(const flag of a.attendanceFlags||[]){
      const at=minutes(flag.time);
      if(at<visible.start||at>visible.end)continue;
      const pos=chart.convertToPixel({xAxisIndex:0,yAxisIndex:0},[at,flag.kind==='late'?0:1]);
      if(!pos||!Number.isFinite(pos[0])||!Number.isFinite(pos[1]))continue;
      const tag=document.createElement('span');
      tag.className='r72-attendance-tag r74-attendance-tag '+flag.kind+(flag.accepted===false?' is-excluded':'');
      tag.dataset.attendanceId=flag.id;
      tag.tabIndex=0;
      const label=document.createElement('span');label.textContent=flag.label;tag.appendChild(label);
      const control=document.createElement('button');control.type='button';control.innerHTML=p109IntervalIcon(flag.accepted===false?'check':'close');
      control.setAttribute('aria-label',(flag.accepted===false?'恢复纳入':'排除统计')+' '+flag.label+' '+flag.time);
      control.onclick=event=>{event.stopPropagation();p109SetAttendanceDecision(flag.id,flag.accepted===false)};tag.appendChild(control);
      tag.dataset.r73Tip=flag.label+' · '+flag.time+'（对应实际打卡；'+(flag.accepted===false?'已排除，可恢复':'已纳入，可单独排除')+'）';
      tag.setAttribute('aria-label',flag.label+' · '+flag.time);
      layer.appendChild(tag);
      const w=tag.offsetWidth||58,h=tag.offsetHeight||23;
      const baseY=Math.max(12,Math.min(height-125-h,pos[1]+(flag.kind==='early'?-13:-31)));
      const preferred=pos[0]+15+w<=width-12?pos[0]+15:pos[0]-w-15;
      const candidates=[
        {x:preferred,y:baseY},
        {x:pos[0]-w-15,y:baseY},
        {x:pos[0]+15,y:baseY},
        {x:preferred,y:baseY-27},
        {x:preferred,y:baseY+27}
      ];
      const good=candidates.find(c=>c.x>=9&&c.x+w<=width-9&&c.y>=9&&
       c.y+h<=height-109&&!placed.some(r=>c.x<r.x+r.w+5&&c.x+w+5>r.x&&
         c.y<r.y+r.h+4&&c.y+h+4>r.y));
      const chosen=good||{x:Math.max(10,Math.min(width-w-10,preferred)),y:baseY};
      tag.style.left=chosen.x+'px';
      tag.style.top=chosen.y+'px';
      if(chosen.x+w+25>width-5)tag.classList.add('control-left');
      tag.dataset.anchorX=String(pos[0]);
      placed.push({x:chosen.x,y:chosen.y,w,h});
    }
    if(typeof r73WireTooltips==='function')r73WireTooltips();
  };
  // Locate the rendered slider track; the HTML marks must share its actual SVG bounds.
  const syncNavigator=()=>{
    const preview=document.getElementById('r15PunchPreview');
    if(!preview||!preview.isConnected)return;
    const svg=el.querySelector('svg');
    const candidates=svg?[...svg.querySelectorAll('path,rect')].filter(n=>{
      const fill=(n.getAttribute('fill')||'').toLowerCase();
      return fill==='#edf0f2'||fill==='rgb(237,240,242)';
    }).map(n=>n.getBoundingClientRect()).filter(r=>r.width>el.clientWidth*.4&&r.height>=25&&r.height<=45):[];
    if(!candidates.length){preview.dataset.geometryReady='false';return}
    const r=candidates.sort((a,b)=>b.width-a.width)[0],parent=preview.parentElement.getBoundingClientRect();
    preview.style.setProperty('--p109-nav-left',(r.left-parent.left)+'px');
    preview.style.setProperty('--p109-nav-top',(r.top-parent.top)+'px');
    preview.style.setProperty('--p109-nav-width',r.width+'px');
    preview.style.setProperty('--p109-nav-height',r.height+'px');
    preview.dataset.geometryReady='true';
  };
  const syncNavSelection=()=>{
    const r=state.timelineRange||range;
    document.getElementById('r15PunchPreview')?.querySelectorAll('[data-nav-minute]').forEach(node=>{
      const minute=Number(node.dataset.navMinute),inside=minute>=r.start&&minute<=r.end;
      node.classList.toggle('inside',inside);node.classList.toggle('outside',!inside);
    });
  };
  syncNavSelection();
  const placeReview=(box,left,right,center,bandTop,bandBottom)=>{
    // Leave the two-character track labels clear, including edge fallbacks.
    const edge=chart.getWidth()-SIDE-52,w=box.offsetWidth,h=box.offsetHeight,gap=6;
    const beside=right+gap+w<=edge;
    box.dataset.placement=beside?'right':'above';
    box.dataset.bandLeft=String(left);box.dataset.bandRight=String(right);box.dataset.bandTop=String(bandTop);box.dataset.bandBottom=String(bandBottom);
    box.style.left=(beside?right+gap:Math.max(SIDE,Math.min(right,edge-w)))+'px';
    box.style.top=Math.max(0,beside?center-h/2:bandTop-h-gap)+'px';
    box.dataset.anchorY=String(beside?center:bandTop-h/2-gap);
    box.onpointerenter=()=>box.classList.add('is-hovered');
    box.onpointerleave=()=>box.classList.remove('is-hovered');
  };
  const syncOvertimeControls=()=>{
    const overlay=document.getElementById('overtimeReviewLayer');
    if(!overlay||!overlay.isConnected)return;
    overlay.replaceChildren();
    // Registration can mask part of one continuous punch-backed session.
    // All residual bars share a review ID: provide ONE decision control at
    // the rightmost residual fragment, not duplicate ×/✓ for each fragment.
    const groups=new Map();
    const visible=state.timelineRange||range;
    for(const seg of model.bars.filter(d=>d.track==='overtime'&&['auto','manual'].includes(d.origin)&&d.value[1]>visible.start&&d.value[0]<visible.end)){
      const prior=groups.get(seg.segmentId);
      if(!prior||seg.value[1]>prior.value[1])groups.set(seg.segmentId,seg);
    }
    for(const seg of groups.values()){
      const from=seg.value[0],to=seg.value[1];
      const x1=chart.convertToPixel({xAxisIndex:0,yAxisIndex:0},[from,5]);
      const x2=chart.convertToPixel({xAxisIndex:0,yAxisIndex:0},[to,5]);
      if(!x1||!x2||!Number.isFinite(x1[0])||!Number.isFinite(x2[0]))continue;
      const left=Math.max(x1[0],0),right=Math.min(x2[0],chart.getWidth());
      if(right<=left||right<0||left>=chart.getWidth())continue;
      const box=document.createElement('div');
      box.className='overtime-review-actions'+(seg.accepted?'':' is-excluded')+
        (state.overtimeHoverId===seg.segmentId?' is-hovered':'');
      box.dataset.autoOvertimeId=seg.segmentId;
      box.dataset.origin=seg.origin;box.dataset.anchorY=String(x1[1]);
      const actions=seg.origin==='manual'?[[false,'close','删除']]:[[false,'close','排除'],[true,'check','纳入']];
      for(const [accepted,icon,word] of actions){
       const btn=document.createElement('button');
       btn.type='button';btn.className='overtime-review-btn'+(seg.accepted===accepted?' chosen':'');
       btn.innerHTML=p109IntervalIcon(icon);
       const label=seg.origin==='manual'?'补录加班':'自动加班';
       btn.title=word+label+'：'+minuteText(from)+'–'+minuteText(to)+(seg.origin==='manual'?'（直接删除这次补录）':'（仅调整统计纳入，不代表审批）');
       btn.setAttribute('aria-label',word+' '+minuteText(from)+'–'+minuteText(to)+' '+label);
       btn.setAttribute('aria-pressed',String(seg.accepted===accepted));
       btn.onclick=e=>{e.stopPropagation();setAutoOvertimeDecision(seg.segmentId,accepted)};
       box.appendChild(btn);
      }
      box.onpointerenter=()=>box.classList.add('is-hovered');
      box.onpointerleave=()=>box.classList.remove('is-hovered');
      overlay.appendChild(box);
      const prior=chart.convertToPixel({xAxisIndex:0,yAxisIndex:0},[to,4]),height=Math.abs(x1[1]-prior[1])+.5;
      placeReview(box,Math.max(left,SIDE),Math.min(right,chart.getWidth()-SIDE),x1[1],x1[1]-height/2,x1[1]+height/2);
    }
  };
  let hoverAddKind='',temporaryHoverId='';
  const syncTemporaryControls=()=>{
    const overlay=document.getElementById('temporaryReviewLayer');if(!overlay?.isConnected)return;
    overlay.replaceChildren();const groups=new Map(),visible=state.timelineRange||range;
    for(const row of model.bars.filter(d=>d.origin==='temporary'&&d.value[1]>visible.start&&d.value[0]<visible.end)){
      const prior=groups.get(row.segmentId);if(!prior||row.value[1]>prior.value[1])groups.set(row.segmentId,row);
    }
    for(const row of groups.values()){
      const [from,to,lane]=row.value,x=chart.convertToPixel({xAxisIndex:0,yAxisIndex:0},[to,lane]),
       left=chart.convertToPixel({xAxisIndex:0,yAxisIndex:0},[from,lane]);
      if(!x||!left||x[0]<=SIDE||left[0]>=chart.getWidth()-SIDE)continue;
      const box=document.createElement('div');box.className='p109-temp-actions'+(temporaryHoverId===row.segmentId?' is-hovered':'');box.dataset.tempId=row.segmentId;
      const adjacent=chart.convertToPixel({xAxisIndex:0,yAxisIndex:0},[to,lane-1]),height=Math.abs(x[1]-adjacent[1])+.5,
       center=x[1]-height*.135;
      box.dataset.anchorY=String(center);
      for(const [status,icon,title] of [['red','circle','标为红色'],['green','circle','标为绿色'],['exclude','close',row.manual?'删除补录':'排除统计']]){
        const button=document.createElement('button');button.type='button';button.className=status;
        button.innerHTML=p109IntervalIcon(icon);button.title=title+' '+minuteText(from)+'–'+minuteText(to)+' 临时外出';
        button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',String(row.status===status));
        button.onclick=e=>{e.stopPropagation();p109SetTempDecision(row.segmentId,status)};box.appendChild(button);
      }
      overlay.appendChild(box);
      placeReview(box,Math.max(left[0],SIDE),Math.min(x[0],chart.getWidth()-SIDE),center,x[1]-height*.44,x[1]+height*.17);
      box.onpointerenter=()=>{temporaryHoverId=row.segmentId;box.classList.add('is-hovered')};
      box.onpointerleave=()=>{temporaryHoverId='';box.classList.remove('is-hovered')};
    }
    for(const [kind,lane,label] of [['outing',4,'补录临时外出'],['overtime',5,'补录加班']]){
      const pos=chart.convertToPixel({xAxisIndex:0,yAxisIndex:0},[1440,lane]);if(!pos)continue;
      const button=document.createElement('button');button.type='button';button.className='p109-interval-add';
      const canvas=document.createElement('canvas'),measure=canvas.getContext('2d');measure.font=labelFont;
      const textWidth=measure.measureText(model.tracks[lane].title).width;
      button.dataset.intervalAdd=kind;button.dataset.anchorY=String(pos[1]);button.style.top=(pos[1]-12)+'px';
      button.classList.toggle('is-row-hovered',kind===hoverAddKind);
      button.style.right=(labelRight+textWidth+8)+'px';button.innerHTML=p109IntervalIcon('plus');
      button.title=label;button.setAttribute('aria-label',label);
      button.onclick=()=>p109OpenIntervalEditor(kind,a.employee.id,a.date);overlay.appendChild(button);
    }
  };
  const panel=el.closest('.music-track-panel');
  const showRowAdd=kind=>{hoverAddKind=kind;panel?.querySelectorAll('[data-interval-add]').forEach(n=>n.classList.toggle('is-row-hovered',n.dataset.intervalAdd===kind))};
  if(panel){
    panel.onpointermove=event=>{
      if(chart.isDisposed()||!el.isConnected)return;
      const bounds=el.getBoundingClientRect(),y=event.clientY-bounds.top,x=event.clientX-bounds.left;
      temporaryHoverId='';state.overtimeHoverId='';
      panel.querySelectorAll('.p109-temp-actions,.overtime-review-actions').forEach(box=>{
        const r=box.getBoundingClientRect(),inBand=x>=Number(box.dataset.bandLeft)&&x<=Number(box.dataset.bandRight)&&y>=Number(box.dataset.bandTop)&&y<=Number(box.dataset.bandBottom),
         inMenu=(box.classList.contains('is-hovered')||box.matches(':hover,:focus-within'))&&event.clientX>=r.left-8&&event.clientX<=r.right+2&&event.clientY>=r.top-2&&event.clientY<=r.bottom+8;
        const hovered=inBand||inMenu;box.classList.toggle('is-hovered',hovered);
        if(hovered){if(box.dataset.tempId)temporaryHoverId=box.dataset.tempId;else state.overtimeHoverId=box.dataset.autoOvertimeId}
      });
      let kind='';for(const [name,lane] of [['outing',4],['overtime',5]]){
        const point=chart.convertToPixel({xAxisIndex:0,yAxisIndex:0},[0,lane]),prior=chart.convertToPixel({xAxisIndex:0,yAxisIndex:0},[0,lane-1]);
        if(point&&prior&&y>=point[1]-Math.abs(point[1]-prior[1])/2&&y<point[1]+Math.abs(point[1]-prior[1])/2)kind=name;
      }
      if(kind!==hoverAddKind)showRowAdd(kind);
    };
    panel.onpointerleave=()=>{showRowAdd('');temporaryHoverId='';state.overtimeHoverId='';panel.querySelectorAll('.p109-temp-actions,.overtime-review-actions').forEach(n=>n.classList.remove('is-hovered'))};
  }
  const syncAll=()=>{
    if(!el.isConnected||chart.isDisposed()||echarts.getInstanceByDom(el)!==chart)return;
    syncNavigator();syncOvertimeControls();syncAttendanceFlags();syncTemporaryControls();
  };
  chart.on('finished',syncAll);
  requestAnimationFrame(syncAll);
  chart.on('click',p=>{
    const d=p.data||{};
    if(p.seriesId==='punches'&&d.records?.length){focusRawEvidence('attendance',d.records.map(r=>r.recordId));return}
    if(p.seriesId==='bands'&&['auto','manual','temporary'].includes(d.origin)&&d.segmentId){
      // Clicking the band itself selects the current review state; the
      // explicit ✓ and × controls handle decisions.
      syncOvertimeControls();syncTemporaryControls();return;
    }
    if(p.seriesId==='bands'&&d.track&&d.sourceIds?.length)focusRawEvidence(d.track,d.sourceIds);
  });
  chart.on('datazoom',e=>{
    const q=e.batch?.[0]||e;let start=q.startValue,end=q.endValue;
    if(start==null||end==null){if(q.start==null||q.end==null)return;start=q.start*14.4;end=q.end*14.4}
    start=Math.max(0,Math.min(1440,+start));end=Math.max(start+15,Math.min(1440,+end));
    state.timelineRange={key:range.key,start,end};
    model=r14TrackData(a,state.timelineRange,chart.getWidth());
    syncNavSelection();
    chart.setOption({
      series:[
        {id:'schedule',data:model.workWindows.map(x=>[x[0],x[1]])},
        {id:'work-boundaries',data:workBoundaries()},
        {id:'bands',data:model.bars},
        {id:'punches',data:model.events}
      ]
    });
  });
}
