function dayTypeText(t){return {work:'工作日',adjust:'调休工作日',rest:'休息日',holiday:'节假日'}[t]}
function avg(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:0}
function pct(t){return Math.max(0,Math.min(100,((minutes(t)-360)/(16*60))*100))}

function analysisOverviewHtml(ctx){
  const items=ctx.items, st=statsFor(items), pres=items.filter(x=>x.presence>0);
  if(ctx.type==='cell'){
    const a=ctx.analysis;
    return `<div class="overview-status">
      <div class="status-title"><span class="status-dot ${a.severity}"></span><strong>${a.status}</strong></div>
      <p>${a.issues.length?a.issues.join(' · '):'没有发现需要处理的问题'}</p>
    </div>
    <div class="overview-rows">
      ${overviewRow('首次进入',a.firstIn||'—')}
      ${overviewRow('最后离开',a.lastOut||'—')}
      ${overviewRow('确认在岗',fmtMinutes(a.presence))}
      ${overviewRow('原始打卡',a.punches.length+' 条')}
      ${overviewRow('业务覆盖',a.marker==='leave'?'请假':a.marker==='trip'?'出差':'—')}
    </div>
    <div class="overview-actions">
      <button class="soft-action" data-revise="resolved">标记已核实</button>
      <button class="soft-action" data-revise="note">添加说明</button>
      <button class="soft-action danger" data-revise="clear">清除人工痕迹</button>
    </div>`;
  }

  const issues=items.filter(x=>x.severity==='problem'||x.severity==='suspect').slice(0,8);
  return `<div class="overview-rows">
    ${overviewRow('当前范围',items.length+' 个单元')}
    ${overviewRow('正常',st.normal)}
    ${overviewRow('明确问题',st.problems)}
    ${overviewRow('疑似异常',st.suspects)}
    ${overviewRow('请假 / 出差',items.filter(x=>x.marker).length)}
    ${overviewRow('平均确认在岗',fmtMinutes(avg(pres.map(x=>x.presence))))}
  </div>
  <div class="analysis-subhead"><span>需要关注</span><small>${issues.length?'点击直接定位':'当前没有异常'}</small></div>
  ${issues.length?`<div class="compact-issue-list">${issues.map(a=>`<button data-analysis-cell="${a.employee.id}|${a.day}"><i class="${a.severity}"></i><span><b>${a.employee.name}</b><small>${pad(a.day)} 日 · ${a.status}</small></span><em>›</em></button>`).join('')}</div>`:'<div class="analysis-empty">没有需要处理的异常</div>'}`;
}

function overviewRow(label,value){
  return `<div class="overview-row"><span>${label}</span><strong>${value}</strong></div>`;
}

function analysisTimelineHtml(ctx){
  if(ctx.type==='overall'){
    return '<div class="analysis-empty timeline-empty"><span class="empty-rail"></span><strong>先选择一天或一个状态方块</strong><small>时间轴只在存在明确上下文时出现</small></div>';
  }
  if(ctx.type==='person'){
    return '<div class="analysis-empty timeline-empty"><span class="empty-rail"></span><strong>已选择 '+ctx.employee.name+'</strong><small>再点击矩阵中的某一天查看当天时间轴</small></div>';
  }
  if(ctx.type==='date') return dateTimelinePanel(ctx.day,ctx.items);
  return singleTimelinePanel(ctx.analysis);
}

function timelineAxis(){
  let s='<div class="rail-axis"><span class="rail-axis-spacer"></span><div class="rail-axis-scale">';
  for(let h=6;h<=22;h+=2)s+=`<span style="left:${(h-6)/16*100}%">${pad(h)}</span>`;
  return s+'</div></div>';
}

function workBands(){
  return `<span class="rail-work am" style="left:${pct('08:30')}%;width:${pct('12:00')-pct('08:30')}%"></span><span class="rail-work pm" style="left:${pct('14:00')}%;width:${pct('17:30')-pct('14:00')}%"></span>`;
}

function timelineRangeFor(a){
  const key=`${a.employee.id}|${a.day}`;
  if(!state.timelineRange||state.timelineRange.key!==key) state.timelineRange={key,start:480,end:1080};
  return state.timelineRange;
}

function clampTimelineRange(start,end,key){
  const minSpan=30;
  let s=Math.max(0,Math.min(1440-minSpan,start));
  let e=Math.max(s+minSpan,Math.min(1440,end));
  if(e>1440){e=1440;s=Math.max(0,e-Math.max(minSpan,end-start))}
  return {key,start:Math.round(s),end:Math.round(e)};
}

function localPctMinute(m,r){return (m-r.start)/(r.end-r.start)*100}
function globalPctMinute(m){return m/1440*100}
function timeLabelFromMinute(m){const x=Math.max(0,Math.min(1440,Math.round(m)));return `${pad(Math.floor(x/60)%24)}:${pad(x%60)}`}

function localTimelineTicks(r){
  const span=r.end-r.start;
  const step=span<=120?15:span<=300?30:span<=720?60:120;
  const first=Math.ceil(r.start/step)*step;
  let html='';
  for(let m=first;m<=r.end;m+=step){
    const left=localPctMinute(m,r);
    html+=`<span class="local-tick" style="left:${left}%"><i></i><b>${timeLabelFromMinute(m)}</b></span>`;
  }
  return html;
}

function localWorkBands(r){
  const bands=[[510,720],[840,1050]];
  return bands.map(([s,e])=>{
    const a=Math.max(s,r.start),b=Math.min(e,r.end);
    if(b<=a)return '';
    return `<span class="local-work-band" style="left:${localPctMinute(a,r)}%;width:${localPctMinute(b,r)-localPctMinute(a,r)}%"></span>`;
  }).join('');
}

function clusterTimelineEvents(events,r){
  const visible=events.map(p=>({p,m:minutes(p.time)})).filter(x=>x.m>=r.start&&x.m<=r.end).sort((x,y)=>x.m-y.m);
  if(!visible.length)return [];
  const threshold=Math.max(.75,(r.end-r.start)/70);
  const out=[]; let cur=[visible[0]];
  for(let i=1;i<visible.length;i++){
    if(visible[i].m-visible[i-1].m<=threshold)cur.push(visible[i]);
    else{out.push(cur);cur=[visible[i]]}
  }
  out.push(cur);
  return out.map(group=>({
    records:group.map(x=>x.p),
    start:group[0].m,
    end:group[group.length-1].m,
    minute:group.reduce((s,x)=>s+x.m,0)/group.length
  }));
}

function eventArrow(cluster,kind,r,edgeId){
  const count=cluster.records.length;
  const left=localPctMinute(cluster.minute,r);
  const edge=cluster.records.some(p=>p.recordId===edgeId);
  const title=count===1
    ? `${cluster.records[0].time} ${cluster.records[0].direction}`
    : `${timeLabelFromMinute(cluster.start)}–${timeLabelFromMinute(cluster.end)} · ${count} 条`;
  const attrs=count===1
    ? `data-record="${cluster.records[0].recordId}"`
    : `data-cluster-start="${cluster.start}" data-cluster-end="${cluster.end}"`;
  return `<button class="event-arrow ${kind} ${edge?(kind==='in'?'edge-first':'edge-last'):''} ${count>1?'clustered':''}" style="left:${left}%" ${attrs} title="${title}">
    <span class="arrow-shaft"></span><span class="arrow-head"></span>
    ${count>1?`<b class="cluster-count">×${count}</b>`:''}
    <time>${count===1?cluster.records[0].time.slice(0,5):timeLabelFromMinute(cluster.minute)}</time>
  </button>`;
}

function navigatorTicks(){
  return [0,360,720,1080,1440].map(m=>`<span class="navigator-tick" style="left:${globalPctMinute(m)}%">${m===1440?'24':pad(Math.floor(m/60))}</span>`).join('');
}

function navigatorEventMarks(a){
  return a.punches.map(p=>`<i class="navigator-event ${p.direction==='进'?'in':'out'}" style="left:${globalPctMinute(minutes(p.time))}%"></i>`).join('');
}

function singleTimelinePanel(a){
  const r=timelineRangeFor(a);
  const ins=a.punches.filter(p=>p.direction==='进').sort((x,y)=>x.time.localeCompare(y.time));
  const outs=a.punches.filter(p=>p.direction==='出').sort((x,y)=>x.time.localeCompare(y.time));
  const firstIn=ins[0]?.recordId||'';
  const lastOut=outs[outs.length-1]?.recordId||'';
  const inClusters=clusterTimelineEvents(ins,r);
  const outClusters=clusterTimelineEvents(outs,r);
  const left=globalPctMinute(r.start),width=globalPctMinute(r.end-r.start);

  return `<div class="dual-timeline">
    <div class="timeline-window-head">
      <div>
        <span>局部时间轴</span>
        <strong id="timelineWindowLabel">${timeLabelFromMinute(r.start)}–${timeLabelFromMinute(r.end)}</strong>
      </div>
      <small>拖动下方窗口移动 · 拉左右手柄缩放</small>
    </div>

    <div class="local-timeline">
      <div class="local-plot">
        ${localWorkBands(r)}
        <div class="time-arrow-axis"><span></span></div>
        <span class="lane-caption in">进</span>
        <span class="lane-caption out">出</span>
        ${localTimelineTicks(r)}
        ${inClusters.map(g=>eventArrow(g,'in',r,firstIn)).join('')}
        ${outClusters.map(g=>eventArrow(g,'out',r,lastOut)).join('')}
      </div>
    </div>

    <div class="timeline-key">
      <span><i class="key-in"></i>进入</span>
      <span><i class="key-out"></i>离开</span>
      <span><i class="key-first"></i>最早进入</span>
      <span><i class="key-last"></i>最晚离开</span>
      <span><b>×N</b>当前尺度自动合并</span>
    </div>

    <div class="navigator-head"><span>全天</span><small>00:00–24:00</small></div>
    <div class="timeline-navigator" data-dual-nav data-range-key="${r.key}">
      <div class="navigator-axis"></div>
      ${navigatorTicks()}
      ${navigatorEventMarks(a)}
      <div class="navigator-window" data-nav-window style="left:${left}%;width:${width}%">
        <button class="navigator-handle left" data-nav-handle="left" aria-label="调整开始时间"></button>
        <span class="navigator-grip"></span>
        <button class="navigator-handle right" data-nav-handle="right" aria-label="调整结束时间"></button>
      </div>
    </div>

    <div class="timeline-evidence" id="timelineEvidence">
      <span>点击箭头</span><strong>查看准确时间与原始记录</strong>
    </div>
  </div>`;
}

function focusTimelineCluster(start,end){
  const r=state.timelineRange;if(!r)return;
  const current=r.end-r.start,center=(start+end)/2;
  const nextSpan=Math.max(30,current/3);
  state.timelineRange=clampTimelineRange(center-nextSpan/2,center+nextSpan/2,r.key);
  renderAnalysisPanel();
}

function bindDualTimeline(){
  document.querySelectorAll('[data-cluster-start]').forEach(b=>b.onclick=()=>focusTimelineCluster(+b.dataset.clusterStart,+b.dataset.clusterEnd));
  const nav=document.querySelector('[data-dual-nav]'); if(!nav)return;
  const r=state.timelineRange;if(!r)return;
  let mode='',startX=0,base=null,draft=null,moved=false;

  function minuteAt(clientX){
    const box=nav.getBoundingClientRect();
    return Math.max(0,Math.min(1440,(clientX-box.left)/Math.max(1,box.width)*1440));
  }
  function updateWindow(range){
    const win=nav.querySelector('[data-nav-window]');if(!win)return;
    win.style.left=globalPctMinute(range.start)+'%';
    win.style.width=globalPctMinute(range.end-range.start)+'%';
    const label=document.getElementById('timelineWindowLabel');
    if(label)label.textContent=`${timeLabelFromMinute(range.start)}–${timeLabelFromMinute(range.end)}`;
  }

  nav.onpointerdown=e=>{
    const handle=e.target.closest('[data-nav-handle]'),win=e.target.closest('[data-nav-window]');
    if(!handle&&!win){
      const span=r.end-r.start,center=minuteAt(e.clientX);
      state.timelineRange=clampTimelineRange(center-span/2,center+span/2,r.key);
      renderAnalysisPanel();
      return;
    }
    mode=handle?handle.dataset.navHandle:'move';
    startX=e.clientX;base={...r};draft={...r};moved=false;
    nav.setPointerCapture?.(e.pointerId);e.preventDefault();
  };
  nav.onpointermove=e=>{
    if(!mode)return;
    const box=nav.getBoundingClientRect(),delta=(e.clientX-startX)/Math.max(1,box.width)*1440;
    if(Math.abs(e.clientX-startX)>2)moved=true;
    if(mode==='move') draft=clampTimelineRange(base.start+delta,base.end+delta,r.key);
    else if(mode==='left') draft=clampTimelineRange(Math.min(base.end-30,base.start+delta),base.end,r.key);
    else draft=clampTimelineRange(base.start,Math.max(base.start+30,base.end+delta),r.key);
    updateWindow(draft);
  };
  nav.onpointerup=nav.onpointercancel=e=>{
    if(!mode)return;
    state.timelineRange=draft||r;mode='';
    try{nav.releasePointerCapture?.(e.pointerId)}catch(_){}
    renderAnalysisPanel();
  };
}

function dateTimelinePanel(day,items){
  return `<div class="timeline-topline"><span>${pad(day)} 日 · ${items.length} 人</span><small>点击任意一行进入个人当天</small></div>
  <div class="multi-rail-wrap">
    ${timelineAxis()}
    <div class="multi-rail-list">
      ${items.map((a,i)=>dateRailRow(a,i)).join('')}
    </div>
  </div>`;
}

function dateRailRow(a,i){
  const pairBars=a.pairs.map(([x,y])=>`<span class="mini-presence" style="left:${pct(x.time)}%;width:${Math.max(.35,pct(y.time)-pct(x.time))}%"></span>`).join('');
  const marks=a.punches.map(p=>`<span class="mini-mark ${p.direction==='进'?'in':'out'}" style="left:${pct(p.time)}%"></span>`).join('');
  return `<button class="multi-rail-row" data-analysis-cell="${a.employee.id}|${a.day}" style="--delay:${Math.min(i*8,180)}ms">
    <span class="multi-name">${a.employee.name}</span>
    <span class="multi-track">${workBands()}${pairBars}${marks}</span>
    <span class="multi-state ${a.severity}">${a.status}</span>
  </button>`;
}

function analysisStatsHtml(ctx){
  if(ctx.type==='overall'){
    const byDay=Array.from({length:31},(_,i)=>{
      const d=i+1, arr=EMPLOYEES.map(e=>state.analysis.get(`${e.id}|${d}`));
      return {day:d,value:arr.filter(x=>x.severity==='problem'||x.severity==='suspect').length,work:isWorkday(d)};
    });
    const byEmp=EMPLOYEES.map(e=>({name:e.name,value:Array.from({length:31},(_,i)=>state.analysis.get(`${e.id}|${i+1}`)).filter(x=>x.severity==='problem'||x.severity==='suspect').length})).sort((a,b)=>b.value-a.value).slice(0,8);
    return `<div class="chart-block"><div class="chart-head"><strong>每日异常</strong><small>工作日</small></div>${verticalBars(byDay.filter(x=>x.work),50,'day')}</div>
    <div class="chart-block"><div class="chart-head"><strong>问题人员</strong><small>TOP 8</small></div>${horizontalBars(byEmp)}</div>`;
  }

  if(ctx.type==='person'){
    const days=Array.from({length:31},(_,i)=>state.analysis.get(`${ctx.employee.id}|${i+1}`));
    const vals=days.map(a=>({day:a.day,value:Math.round(a.presence/60*10)/10,severity:a.severity,work:isWorkday(a.day)}));
    return `<div class="chart-block"><div class="chart-head"><strong>每日确认在岗</strong><small>小时</small></div>${verticalBars(vals.filter(x=>x.work),10,'day')}</div>
    <div class="chart-block"><div class="chart-head"><strong>状态分布</strong><small>本月</small></div>${statusBars(days)}</div>`;
  }

  if(ctx.type==='date') return `<div class="chart-block"><div class="chart-head"><strong>当天状态</strong><small>${ctx.items.length} 人</small></div>${statusBars(ctx.items)}</div>
    <div class="chart-block"><div class="chart-head"><strong>到岗时间</strong><small>首次进入</small></div>${arrivalDistribution(ctx.items)}</div>`;

  const a=ctx.analysis, month=Array.from({length:31},(_,i)=>state.analysis.get(`${ctx.employee.id}|${i+1}`)).filter(x=>isWorkday(x.day)&&x.presence>0);
  const monthAvg=avg(month.map(x=>x.presence));
  const pctOfAvg=monthAvg?Math.round(a.presence/monthAvg*100):0;
  return `<div class="compare-stat"><span>当天确认在岗</span><strong>${fmtMinutes(a.presence)}</strong><i><b style="width:${Math.min(100,pctOfAvg)}%"></b></i><small>个人本月平均 ${fmtMinutes(monthAvg)} · 当天约 ${pctOfAvg}%</small></div>
    <div class="chart-block"><div class="chart-head"><strong>本月状态</strong><small>${ctx.employee.name}</small></div>${statusBars(month)}</div>`;
}

function verticalBars(items,max,kind){
  if(!items.length)return '<div class="analysis-empty">无数据</div>';
  return `<div class="vbars">${items.map(x=>{const attr=state.selection.type==='person'?`data-analysis-cell="${state.selection.employeeId}|${x.day}"`:`data-analysis-day="${x.day}"`;return `<button ${attr} class="vbar ${x.severity||''}" title="${pad(x.day)} 日 · ${x.value}"><i style="height:${Math.max(3,Math.min(100,x.value/max*100))}%"></i><span>${x.day}</span></button>`}).join('')}</div>`;
}

function horizontalBars(items){
  const max=Math.max(1,...items.map(x=>x.value));
  return `<div class="hbars">${items.map(x=>`<div class="hbar"><span>${x.name}</span><i><b style="width:${x.value/max*100}%"></b></i><strong>${x.value}</strong></div>`).join('')}</div>`;
}

function statusBars(items){
  const rows=[
    ['正常',items.filter(x=>x.severity==='normal').length,'normal'],
    ['疑似',items.filter(x=>x.severity==='suspect').length,'suspect'],
    ['问题',items.filter(x=>x.severity==='problem').length,'problem'],
    ['请假/出差',items.filter(x=>x.marker).length,'excused']
  ], max=Math.max(1,...rows.map(x=>x[1]));
  return `<div class="status-bars">${rows.map(x=>`<div><span>${x[0]}</span><i><b class="${x[2]}" style="width:${x[1]/max*100}%"></b></i><strong>${x[1]}</strong></div>`).join('')}</div>`;
}

function arrivalDistribution(items){
  const bins=[['≤08:30',0],['08:31–08:45',0],['08:46–09:00',0],['>09:00',0],['无',0]];
  items.forEach(a=>{if(!a.firstIn)bins[4][1]++;else{const m=minutes(a.firstIn);if(m<=510)bins[0][1]++;else if(m<=525)bins[1][1]++;else if(m<=540)bins[2][1]++;else bins[3][1]++}});
  const max=Math.max(1,...bins.map(x=>x[1]));
  return `<div class="status-bars">${bins.map(x=>`<div><span>${x[0]}</span><i><b style="width:${x[1]/max*100}%"></b></i><strong>${x[1]}</strong></div>`).join('')}</div>`;
}

function analysisRecordsHtml(ctx){
  let records=[];
  if(ctx.type==='cell') records=ctx.analysis.punches;
  else if(ctx.type==='date') records=state.records.filter(r=>r.datetime.slice(0,10)===isoDate(ctx.day)).sort((a,b)=>a.datetime.localeCompare(b.datetime));
  else if(ctx.type==='person') records=state.records.filter(r=>r.employeeId===ctx.employee.id).sort((a,b)=>b.datetime.localeCompare(a.datetime));
  else return `<div class="overview-rows">${overviewRow('原始打卡',state.records.length.toLocaleString()+' 条')}${overviewRow('请假',state.leaves.length+' 条')}${overviewRow('出差',state.trips.length+' 条')}${overviewRow('人工修订',state.revisions.length+' 条')}</div><div class="analysis-empty"><strong>原始文件保持只读</strong><small>从顶部“导入”管理考勤、请假和出差文件</small></div>`;

  if(!records.length)return '<div class="analysis-empty">当前范围没有原始打卡记录</div>';
  return `<div class="records-list">${records.slice(0,120).map(p=>`<button data-record="${p.recordId}"><time>${p.datetime.slice(5,16)}</time><b class="${p.direction==='进'?'in':'out'}">${p.direction}</b><span>${p.name}</span><small>${p.source} · 行 ${p.row||'—'}</small></button>`).join('')}</div>
  <div class="record-evidence" id="timelineEvidence"><span>点击记录</span><strong>查看来源详情</strong></div>`;
}

function applyTimelineZoom(delta,anchorRatio=.5){
  const view=document.querySelector('[data-timeline-viewport]'),inner=document.querySelector('[data-timeline-inner]'); if(!view||!inner)return;
  const oldWidth=inner.scrollWidth,oldLeft=view.scrollLeft,target=Math.max(1,Math.min(2.4,state.zoom+delta)); if(target===state.zoom)return;
  state.zoom=target; inner.style.width=`${100*target}%`; const anchor=oldLeft+view.clientWidth*anchorRatio;
  requestAnimationFrame(()=>{const ratio=oldWidth?anchor/oldWidth:.5;view.scrollTo({left:Math.max(0,ratio*inner.scrollWidth-view.clientWidth*anchorRatio),behavior:'smooth'});const z=document.getElementById('zoomReset');if(z)z.textContent=`${Math.round(target*100)}%`});
}

function resetTimelineZoom(){
  const view=document.querySelector('[data-timeline-viewport]'),inner=document.querySelector('[data-timeline-inner]');
  state.zoom=1;if(inner)inner.style.width='100%';if(view)view.scrollTo({left:0,behavior:'smooth'});const z=document.getElementById('zoomReset');if(z)z.textContent='100%';
}

function bindTimelineGestures(){
  document.querySelectorAll('[data-timeline-viewport]').forEach(view=>{
    view.ondblclick=e=>{if(!e.target.closest('button'))resetTimelineZoom()};
    view.onwheel=e=>{if(!(e.ctrlKey||e.metaKey))return;e.preventDefault();const r=view.getBoundingClientRect(),ratio=Math.max(0,Math.min(1,(e.clientX-r.left)/Math.max(1,r.width)));applyTimelineZoom(e.deltaY<0?.2:-.2,ratio)};
    let startX=0,startLeft=0,dragging=false;
    view.onpointerdown=e=>{if(e.target.closest('button')||state.zoom<=1)return;dragging=true;startX=e.clientX;startLeft=view.scrollLeft;view.classList.add('is-dragging');view.setPointerCapture?.(e.pointerId)};
    view.onpointermove=e=>{if(dragging)view.scrollLeft=startLeft-(e.clientX-startX)};
    view.onpointerup=view.onpointercancel=e=>{dragging=false;view.classList.remove('is-dragging');try{view.releasePointerCapture?.(e.pointerId)}catch(_){}};
  });
}

function showRecord(id){
  const p=state.records.find(x=>x.recordId===id); if(!p)return;
  document.querySelectorAll('[data-record]').forEach(x=>x.classList.toggle('selected',x.dataset.record===id));
  const box=document.getElementById('timelineEvidence'); if(!box)return;
  box.classList.remove('record-enter');
  box.innerHTML=`<div class="evidence-main"><span class="evidence-direction ${p.direction==='进'?'in':'out'}">${p.direction}</span><strong>${p.time}</strong><small>${p.name}</small></div>
    <div class="evidence-source"><span>${p.source}</span><small>${p.sheet||'—'} · 行 ${p.row||'—'} · ${p.recordId}</small></div>`;
  requestAnimationFrame(()=>box.classList.add('record-enter'));
}

function reviseCurrent(action){
  if(state.selection.type!=='cell')return;
  const key=`${state.selection.employeeId}|${state.selection.day}`;
  if(action==='clear'){
    state.revisions=state.revisions.filter(r=>r.key!==key);
    toast('已清除该日人工痕迹，原始记录未改变');
  }else{
    state.revisions.push({id:`R${++state.revisionSeq}`,key,action,time:new Date().toISOString(),note:action==='resolved'?'人工核实':'人工说明'});
    toast(action==='resolved'?'已标记人工核实':'已添加人工说明');
  }
  state.saved=false; render();
}
