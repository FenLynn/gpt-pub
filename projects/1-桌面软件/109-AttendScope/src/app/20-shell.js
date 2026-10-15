function render(){
  if(!state.inspectorTab) state.inspectorTab='overview';
  document.getElementById('app').innerHTML=layoutHtml();
  bind();
  renderCalendar();
  renderMatrix();
  renderInspector();
  renderDetail();
}

function layoutHtml(){
  return `
  <header class="topbar">
    <div class="brand">
      <div class="logo" aria-hidden="true"><span></span></div>
      <div class="brand-copy">
        <div class="brand-title">AttendScope</div>
        <div class="brand-sub">P109 · Offline</div>
      </div>
    </div>
    <div class="month-switch">
      <button class="icon-btn" disabled aria-label="上个月">‹</button>
      <div><strong>2026 年 10 月</strong><small>50 人 · 月度考勤</small></div>
      <button class="icon-btn" disabled aria-label="下个月">›</button>
    </div>
    <div class="top-actions">
      <span class="save-state ${state.saved?'saved':'dirty'}"><i></i>${state.saved?'已保存':'未保存'}</span>
      <button class="text-btn" id="connectDir">项目目录</button>
      <button class="text-btn" id="exportTable">导出</button>
      <button class="text-btn" id="printReport">PDF</button>
      <button class="text-btn" id="saveBtn">保存</button>
      <button class="primary-btn" id="freezeBtn">冻结</button>
    </div>
  </header>

  <div class="layout">
    <aside class="sidebar">
      <section class="side-section calendar-section">
        <div class="side-heading">
          <div><strong>十月</strong><span>2026</span></div>
          <button class="quiet-link" id="clearSelection">总览</button>
        </div>
        <div class="calendar-grid" id="calendar"></div>
        <div class="calendar-key">
          <span><i class="work"></i>工作</span>
          <span><i class="rest"></i>休息</span>
          <span><i class="adjust"></i>调休</span>
          <span><i class="holiday"></i>节假</span>
        </div>
      </section>

      <section class="side-section month-meta">
        <div class="side-label">本月设置</div>
        <div class="meta-row"><span>工作时间</span><b>08:30–17:30</b></div>
        <div class="meta-row"><span>午间</span><b>12:00–14:00</b></div>
        <div class="meta-row"><span>人员</span><b>50</b></div>
        <div class="meta-row"><span>请假 / 出差</span><b>${state.leaves.length} / ${state.trips.length}</b></div>
        <div class="meta-row"><span>项目目录</span><b class="${state.projectDir?'ok':'muted'}">${state.projectDir?'已连接':'未连接'}</b></div>
      </section>

      <section class="side-section side-legend">
        <div class="side-label">状态</div>
        <button class="legend-filter ${state.filter==='all'?'active':''}" data-filter="all"><i class="neutral"></i><span>全部</span></button>
        <button class="legend-filter ${state.filter==='problem'?'active':''}" data-filter="problem"><i class="problem"></i><span>明确问题</span></button>
        <button class="legend-filter ${state.filter==='suspect'?'active':''}" data-filter="suspect"><i class="suspect"></i><span>疑似异常</span></button>
        <button class="legend-filter ${state.filter==='excused'?'active':''}" data-filter="excused"><i class="excused"></i><span>请假 / 出差</span></button>
      </section>
    </aside>

    <main class="workspace">
      <div class="workspace-grid">
        <section class="matrix-zone">
          <div class="section-head">
            <div>
              <h2>月度状态</h2>
              <p>日期横向，人员纵向。颜色只表示状态，点击方块查看当天证据。</p>
            </div>
            <div class="matrix-actions">
              <span id="filterNote"></span>
              <button class="icon-btn" id="matrixShrink" title="紧凑">−</button>
              <button class="icon-btn" id="matrixGrow" title="放大">＋</button>
            </div>
          </div>
          <div class="matrix-wrap"><div class="matrix" id="matrix"></div></div>
        </section>

        <aside class="inspector">
          <div class="inspector-head">
            <div id="inspectorEyebrow">2026 年 10 月</div>
            <h3 id="inspectorTitle">全月概览</h3>
          </div>
          <nav class="inspector-tabs" aria-label="右侧信息">
            <button data-inspector-tab="overview">概览</button>
            <button data-inspector-tab="issues">异常</button>
            <button data-inspector-tab="stats">统计</button>
            <button data-inspector-tab="data">数据</button>
          </nav>
          <div class="inspector-body" id="inspectorBody"></div>
        </aside>
      </div>

      <section class="detail">
        <div class="detail-head">
          <div>
            <div class="detail-kicker" id="detailSub">选择日期或状态方块</div>
            <div class="detail-title" id="detailTitle">时间轴</div>
          </div>
          <div class="timeline-tools" id="detailTools"></div>
        </div>
        <div class="detail-body" id="detailBody"></div>
      </section>
    </main>
  </div>

  <input class="hidden" id="attendanceInput" type="file" accept=".xlsx,.csv">
  <input class="hidden" id="leaveInput" type="file" accept=".xlsx,.csv">
  <input class="hidden" id="tripInput" type="file" accept=".xlsx,.csv">
  `;
}

function bind(){
  document.getElementById('attendanceInput').onchange=e=>handleFile(e,importAttendance);
  document.getElementById('leaveInput').onchange=e=>handleFile(e,importLeaves);
  document.getElementById('tripInput').onchange=e=>handleFile(e,importTrips);
  document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;render()});
  document.querySelectorAll('[data-inspector-tab]').forEach(b=>b.onclick=()=>{state.inspectorTab=b.dataset.inspectorTab;renderInspector()});
  document.getElementById('clearSelection').onclick=()=>{state.selection={type:'overall'};render()};
  document.getElementById('matrixShrink').onclick=()=>{state.compact=true;renderMatrix()};
  document.getElementById('matrixGrow').onclick=()=>{state.compact=false;renderMatrix()};
  document.getElementById('connectDir').onclick=connectProjectDir;
  document.getElementById('exportTable').onclick=exportTraditionalTable;
  document.getElementById('printReport').onclick=()=>window.print();
  document.getElementById('saveBtn').onclick=saveWorking;
  document.getElementById('freezeBtn').onclick=freezeSnapshot;
}

async function handleFile(e,fn){
  const file=e.target.files?.[0];
  if(!file)return;
  try{await fn(file)}catch(err){toast(err.message,true)}finally{e.target.value=''}
}

function renderCalendar(){
  const el=document.getElementById('calendar'),heads=['一','二','三','四','五','六','日'];
  el.innerHTML=heads.map(x=>`<div class="cal-head">${x}</div>`).join('');
  const first=(new Date(YEAR,MONTH-1,1).getDay()+6)%7;
  for(let i=0;i<first;i++)el.insertAdjacentHTML('beforeend','<div></div>');
  for(let d=1;d<=31;d++){
    const type=dayType(d),sel=state.selection.day===d?' selected':'';
    el.insertAdjacentHTML('beforeend',`<button class="cal-day ${type}${sel}" data-day="${d}" title="${dayTypeText(type)}">${d}</button>`);
  }
  el.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>selectDate(+b.dataset.day));
}

function matrixVisible(a){
  if(state.filter==='all')return true;
  if(state.filter==='problem')return a.severity==='problem';
  if(state.filter==='suspect')return a.severity==='suspect';
  if(state.filter==='unresolved')return a.severity==='problem'||a.severity==='suspect';
  if(state.filter==='excused')return !!a.marker;
  if(state.filter==='overtime')return a.status==='非工作日出勤';
  return true;
}

function renderMatrix(){
  const el=document.getElementById('matrix');
  if(!el)return;
  const cell=state.compact?20:24,row=state.compact?28:32,nameW=82;
  el.style.setProperty('--cell',cell+'px');
  el.style.setProperty('--row',row+'px');
  el.style.setProperty('--name',nameW+'px');
  el.style.gridTemplateColumns=`${nameW}px repeat(31,${cell}px)`;

  let html='<div class="m-corner">人员</div>';
  for(let d=1;d<=31;d++){
    const type=dayType(d),selected=state.selection.type==='date'&&state.selection.day===d?' selected':'';
    html+=`<button class="m-date ${type}${selected}" data-date="${d}" title="${isoDate(d)} · ${dayTypeText(type)}"><b>${d}</b><span>${weekdayLabel(d)}</span></button>`;
  }

  for(const e of EMPLOYEES){
    html+=`<button class="m-name ${state.selection.type==='person'&&state.selection.employeeId===e.id?'selected':''}" data-emp="${e.id}" title="${e.name} · ${e.department}"><span>${e.name}</span><small>${e.department}</small></button>`;
    for(let d=1;d<=31;d++){
      const a=state.analysis.get(`${e.id}|${d}`),visible=matrixVisible(a),selected=state.selection.type==='cell'&&state.selection.employeeId===e.id&&state.selection.day===d;
      const cls=a.severity==='problem'?'s-problem':a.severity==='suspect'?'s-suspect':a.severity==='rest'?'s-rest':a.severity==='excused'?'s-excused':a.status==='非工作日出勤'?'s-overtime':'s-normal';
      html+=`<div class="m-cell"><button class="${cls} ${selected?'selected':''}" style="opacity:${visible?1:.12}" data-cell="${e.id}|${d}" title="${e.name} · ${isoDate(d)}\n${a.status}\n首进 ${a.firstIn||'—'} · 末出 ${a.lastOut||'—'}">${a.marker?`<i class="corner-mark ${a.marker}"></i>`:''}</button></div>`;
    }
  }
  el.innerHTML=html;
  el.querySelectorAll('[data-emp]').forEach(b=>b.onclick=()=>selectPerson(b.dataset.emp));
  el.querySelectorAll('[data-date]').forEach(b=>b.onclick=()=>selectDate(+b.dataset.date));
  el.querySelectorAll('[data-cell]').forEach(b=>b.onclick=()=>{const [id,d]=b.dataset.cell.split('|');selectCell(id,+d)});
  const note=document.getElementById('filterNote');
  if(note)note.textContent=state.filter==='all'?'':({problem:'只看明确问题',suspect:'只看疑似',excused:'只看请假/出差',unresolved:'只看待核实',overtime:'只看非工作日出勤'}[state.filter]||'已筛选');
}

function inspectorContext(){
  const s=state.selection;
  if(s.type==='person'){
    const e=EMPLOYEES.find(x=>x.id===s.employeeId);
    return {title:e.name,eyebrow:`${e.department} · 2026 年 10 月`,items:Array.from({length:31},(_,i)=>state.analysis.get(`${e.id}|${i+1}`))};
  }
  if(s.type==='date'){
    return {title:`10 月 ${s.day} 日`,eyebrow:`周${weekdayLabel(s.day)} · ${dayTypeText(dayType(s.day))}`,items:EMPLOYEES.map(e=>state.analysis.get(`${e.id}|${s.day}`))};
  }
  if(s.type==='cell'){
    const e=EMPLOYEES.find(x=>x.id===s.employeeId),a=state.analysis.get(`${e.id}|${s.day}`);
    return {title:e.name,eyebrow:`${isoDate(s.day)} · ${a.status}`,items:[a]};
  }
  return {title:'全月概览',eyebrow:'2026 年 10 月',items:workAnalyses()};
}

function renderInspector(){
  const body=document.getElementById('inspectorBody');
  if(!body)return;
  const ctx=inspectorContext();
  document.getElementById('inspectorTitle').textContent=ctx.title;
  document.getElementById('inspectorEyebrow').textContent=ctx.eyebrow;
  document.querySelectorAll('[data-inspector-tab]').forEach(b=>b.classList.toggle('active',b.dataset.inspectorTab===state.inspectorTab));
  if(state.inspectorTab==='issues') body.innerHTML=inspectorIssues(ctx.items);
  else if(state.inspectorTab==='stats') body.innerHTML=inspectorStats(ctx.items);
  else if(state.inspectorTab==='data') body.innerHTML=inspectorData();
  else body.innerHTML=inspectorOverview(ctx.items);
  bindInspector();
}

function inspectorOverview(items){
  const st=statsFor(items),pres=items.filter(x=>x.presence>0),excused=items.filter(x=>x.marker).length,overtime=items.filter(x=>x.status==='非工作日出勤').length;
  return `<div class="metric-list">
    ${metricLine('正常',st.normal,'normal')}
    ${metricLine('明确问题',st.problems,'problem')}
    ${metricLine('疑似异常',st.suspects,'suspect')}
    ${metricLine('请假 / 出差',excused,'excused')}
    ${overtime?metricLine('非工作日出勤',overtime,'overtime'):''}
  </div>
  <div class="inspector-separator"></div>
  <div class="quiet-stat"><span>平均确认在岗</span><strong>${fmtMinutes(avg(pres.map(x=>x.presence)))}</strong></div>
  <div class="quiet-stat"><span>当前范围</span><strong>${items.length} 个单元</strong></div>`;
}

function metricLine(label,value,tone){
  return `<button class="metric-line" data-metric-filter="${tone}"><span><i class="${tone}"></i>${label}</span><strong>${value}</strong></button>`;
}

function inspectorIssues(items){
  const issues=items.filter(x=>x.severity==='problem'||x.severity==='suspect').sort((a,b)=>a.severity===b.severity?0:(a.severity==='problem'?-1:1)).slice(0,24);
  if(!issues.length)return '<div class="inspector-empty"><span>✓</span><strong>当前范围没有待核实异常</strong></div>';
  return `<div class="issue-list">${issues.map(a=>`<button class="issue-row" data-issue-cell="${a.employee.id}|${a.day}">
    <i class="${a.severity}"></i>
    <span><b>${a.employee.name}</b><small>${pad(a.day)} 日 · ${a.status}</small></span>
    <em>›</em>
  </button>`).join('')}</div>`;
}

function inspectorStats(items){
  const byStatus=[
    {label:'正常',value:items.filter(x=>x.severity==='normal').length,tone:'normal'},
    {label:'疑似',value:items.filter(x=>x.severity==='suspect').length,tone:'suspect'},
    {label:'问题',value:items.filter(x=>x.severity==='problem').length,tone:'problem'},
    {label:'请假/出差',value:items.filter(x=>x.marker).length,tone:'excused'}
  ];
  const max=Math.max(1,...byStatus.map(x=>x.value));
  const durations=items.filter(x=>x.presence>0).map(x=>x.presence);
  return `<div class="inspector-chart-title">状态分布</div>
  <div class="micro-bars">${byStatus.map(x=>`<div class="micro-row"><span>${x.label}</span><i><b class="${x.tone}" style="width:${x.value/max*100}%"></b></i><strong>${x.value}</strong></div>`).join('')}</div>
  <div class="inspector-separator"></div>
  <div class="inspector-chart-title">时长</div>
  <div class="quiet-stat"><span>平均</span><strong>${fmtMinutes(avg(durations))}</strong></div>
  <div class="quiet-stat"><span>最长</span><strong>${fmtMinutes(durations.length?Math.max(...durations):0)}</strong></div>
  <div class="quiet-stat"><span>有打卡单元</span><strong>${durations.length}</strong></div>`;
}

function inspectorData(){
  return `<div class="data-actions">
    ${dataAction('考勤记录','XLSX / CSV','attendanceInput','sampleAttendance')}
    ${dataAction('请假','独立 XLSX / CSV','leaveInput','sampleLeave')}
    ${dataAction('出差','独立 XLSX / CSV','tripInput','sampleTrip')}
  </div>
  <div class="inspector-separator"></div>
  <button class="wide-quiet-btn" id="resetDemo">恢复 50 人模拟数据</button>
  <div class="data-footnote">原始文件只读保存，人工处理不会覆盖 raw。</div>`;
}

function dataAction(title,sub,inputId,sampleId){
  return `<div class="data-row"><div><strong>${title}</strong><small>${sub}</small></div><div><button class="mini-action" data-open="${inputId}">导入</button><button class="mini-action" id="${sampleId}">样例</button></div></div>`;
}

function bindInspector(){
  document.querySelectorAll('[data-inspector-tab]').forEach(b=>b.onclick=()=>{state.inspectorTab=b.dataset.inspectorTab;renderInspector()});
  document.querySelectorAll('[data-issue-cell]').forEach(b=>b.onclick=()=>{const [id,d]=b.dataset.issueCell.split('|');selectCell(id,+d)});
  document.querySelectorAll('[data-metric-filter]').forEach(b=>b.onclick=()=>{const x=b.dataset.metricFilter;state.filter=x==='normal'?'all':x;render()});
  document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.open).click());
  const a=document.getElementById('sampleAttendance'),l=document.getElementById('sampleLeave'),t=document.getElementById('sampleTrip'),r=document.getElementById('resetDemo');
  if(a)a.onclick=downloadAttendance;if(l)l.onclick=downloadLeaves;if(t)t.onclick=downloadTrips;
  if(r)r.onclick=()=>{Object.assign(state,generateMock());state.selection={type:'overall'};state.filter='all';state.revisions=[];state.saved=false;reanalyze();render();toast('已恢复模拟数据')};
}

function selectPerson(id){state.selection={type:'person',employeeId:id};render()}
function selectDate(d){state.selection={type:'date',day:d};render()}
function selectCell(id,d){state.selection={type:'cell',employeeId:id,day:d};state.zoom=1;render();scrollDetail()}
function scrollDetail(){setTimeout(()=>document.querySelector('.detail')?.scrollIntoView({behavior:'smooth',block:'start'}),40)}
