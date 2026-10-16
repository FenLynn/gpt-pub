function render(){
  if(!state.analysisTab) state.analysisTab='overview';
  if(typeof disposeAttendCharts==='function')disposeAttendCharts();
  document.getElementById('app').innerHTML=layoutHtml();
  bind();
  renderCalendar();
  renderMatrix();
  renderAnalysisPanel();
}

function layoutHtml(){
  return `
  <header class="topbar">
    <div class="brand">
      <div class="logo" aria-hidden="true"><span></span></div>
      <strong class="brand-title">AttendScope</strong>
      <span class="brand-mode">离线考勤</span>
    </div>
    <div class="top-actions">
      <span class="save-state ${state.saved?'saved':'dirty'}"><i></i>${state.saved?'已保存':'未保存'}</span>
      <div class="import-anchor">
        <button class="text-btn" id="importBtn">导入</button>
        <div class="import-popover" id="importPopover">
          ${importMenuRow('考勤记录','attendanceInput','sampleAttendance')}
          ${importMenuRow('请假','leaveInput','sampleLeave')}
          ${importMenuRow('出差','tripInput','sampleTrip')}
          <div class="import-divider"></div>
          <button class="import-reset" id="resetDemo">恢复模拟数据</button>
        </div>
      </div>
      <button class="text-btn" id="connectDir">项目目录</button>
      <button class="text-btn" id="exportTable">导出表格</button>
      <button class="text-btn" id="printReport">PDF</button>
      <span class="action-divider"></span>
      <button class="text-btn" id="saveBtn">保存</button>
      <button class="primary-btn" id="freezeBtn">冻结</button>
    </div>
  </header>

  <div class="layout">
    <aside class="sidebar">
      <section class="side-section calendar-section">
        <div class="month-navigation">
          <span class="side-label">当前月份</span>
          <div class="month-anchor">
            <button id="monthMenuButton" class="month-button" aria-expanded="false" aria-label="选择考勤月份">
              <span>2026 年 10 月</span><i class="chevron"></i>
            </button>
            <div class="month-popover" id="monthPopover">
              <div class="month-popover-head">2026 年 · 选择月份</div>
              <div class="month-choices">
                ${Array.from({length:12},(_,i)=>`<button class="month-choice ${i===9?'active':''}" data-month="${i+1}" ${i!==9?'disabled title="尚未导入该月份数据"':''}>${pad(i+1)}</button>`).join('')}
              </div>
              <p>当前演示项目仅有 2026 年 10 月的数据。</p>
            </div>
          </div>
        </div>
        <div class="calendar-caption"><span>月历 · 工作安排</span><button class="quiet-link" id="clearSelection">总览</button></div>
        <div class="calendar-grid" id="calendar"></div>
        <div class="calendar-key">
          <span><i class="work"></i>工作</span>
          <span><i class="rest"></i>休息</span>
          <span><i class="adjust"></i>调休</span>
          <span><i class="holiday"></i>节假</span>
        </div>
      </section>

      <section class="side-section month-meta">
        <div class="side-label">本月</div>
        <div class="meta-row"><span>工作</span><b>08:30–12:00</b></div>
        <div class="meta-row"><span>下午</span><b>14:00–17:30</b></div>
        <div class="meta-row"><span>人员</span><b>50</b></div>
        <div class="meta-row"><span>请假</span><b>${state.leaves.length}</b></div>
        <div class="meta-row"><span>出差</span><b>${state.trips.length}</b></div>
        <div class="meta-row"><span>原始记录</span><b>${state.records.length.toLocaleString()}</b></div>
        <div class="meta-row"><span>目录</span><b class="${state.projectDir?'ok':'muted'}">${state.projectDir?'已连接':'未连接'}</b></div>
      </section>

      <section class="side-section side-legend">
        <div class="side-label">状态筛选</div>
        <button class="legend-filter ${state.filter==='all'?'active':''}" data-filter="all"><i class="neutral"></i><span>全部状态</span></button>
        <button class="legend-filter ${state.filter==='problem'?'active':''}" data-filter="problem"><i class="problem"></i><span>明确异常</span></button>
        <button class="legend-filter ${state.filter==='suspect'?'active':''}" data-filter="suspect"><i class="suspect"></i><span>待核实</span></button>
        <button class="legend-filter ${state.filter==='overtime'?'active':''}" data-filter="overtime"><i class="overtime"></i><span>非工作日加班</span></button>
        <button class="legend-filter ${state.filter==='excused'?'active':''}" data-filter="excused"><i class="neutral"></i><span>请假 / 出差</span></button>
      </section>
    </aside>

    <main class="workspace">
      <div class="workbench">
        <section class="matrix-zone" aria-label="50人员工31天月度考勤状态矩阵">
          <div class="matrix-wrap"><div class="matrix" id="matrix"></div></div>
          <div class="matrix-footer">
            <span class="matrix-footnote">50 人 <i>·</i> 31 天 <span id="filterNote"></span></span>
            <div class="matrix-legend">
              <span><i class="normal"></i>正常</span>
              <span><i class="suspect"></i>待核实</span>
              <span><i class="problem"></i>异常</span>
              <span><i class="overtime"></i>加班</span>
            </div>
          </div>
        </section>

        <section class="analysis-panel">
          <div class="analysis-head">
            <div>
              <div class="analysis-eyebrow" id="analysisEyebrow">2026 年 10 月</div>
              <h2 id="analysisTitle">全月概览</h2>
            </div>
            <div class="selection-status" id="selectionStatus"></div>
          </div>

          <nav class="analysis-tabs">
            <button data-analysis-tab="overview">概览</button>
            <button data-analysis-tab="timeline">时间轴</button>
            <button data-analysis-tab="stats">统计</button>
            <button data-analysis-tab="records">记录</button>
          </nav>

          <div class="analysis-body" id="analysisBody"></div>
        </section>
      </div>
    </main>
  </div>

  <input class="hidden" id="attendanceInput" type="file" accept=".xlsx,.csv">
  <input class="hidden" id="leaveInput" type="file" accept=".xlsx,.csv">
  <input class="hidden" id="tripInput" type="file" accept=".xlsx,.csv">
  `;
}

function importMenuRow(title,input,sample){
  return `<div class="import-menu-row"><span>${title}</span><div><button data-open="${input}">导入</button><button id="${sample}">样例</button></div></div>`;
}

function bind(){
  document.getElementById('attendanceInput').onchange=e=>handleFile(e,importAttendance);
  document.getElementById('leaveInput').onchange=e=>handleFile(e,importLeaves);
  document.getElementById('tripInput').onchange=e=>handleFile(e,importTrips);

  document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;render()});
  document.querySelectorAll('[data-analysis-tab]').forEach(b=>b.onclick=()=>{state.analysisTab=b.dataset.analysisTab;renderAnalysisPanel()});

  document.getElementById('clearSelection').onclick=()=>{state.selection={type:'overall'};state.analysisTab='overview';render()};
  const importBtn=document.getElementById('importBtn'),popover=document.getElementById('importPopover');
  const monthButton=document.getElementById('monthMenuButton'),monthPopover=document.getElementById('monthPopover');
  importBtn.onclick=e=>{e.stopPropagation();monthPopover.classList.remove('open');popover.classList.toggle('open')};
  monthButton.onclick=e=>{
    e.stopPropagation();
    popover.classList.remove('open');
    monthPopover.classList.toggle('open');
    monthButton.setAttribute('aria-expanded',String(monthPopover.classList.contains('open')));
  };
  monthPopover.querySelectorAll('.month-choice:not(:disabled)').forEach(button=>button.onclick=()=>{
    monthPopover.classList.remove('open');
    monthButton.setAttribute('aria-expanded','false');
  });
  document.getElementById('app').onclick=e=>{
    if(!e.target.closest('.import-anchor'))popover.classList.remove('open');
    if(!e.target.closest('.month-anchor')){
      monthPopover.classList.remove('open');
      monthButton.setAttribute('aria-expanded','false');
    }
  };

  document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.open).click());
  document.getElementById('sampleAttendance').onclick=downloadAttendance;
  document.getElementById('sampleLeave').onclick=downloadLeaves;
  document.getElementById('sampleTrip').onclick=downloadTrips;
  document.getElementById('resetDemo').onclick=()=>{
    Object.assign(state,generateMock()); state.selection={type:'overall'}; state.filter='all'; state.analysisTab='overview';
    state.revisions=[]; state.saved=false; reanalyze(); render(); toast('已恢复模拟数据');
  };

  document.getElementById('connectDir').onclick=connectProjectDir;
  document.getElementById('exportTable').onclick=exportTraditionalTable;
  document.getElementById('printReport').onclick=()=>window.print();
  document.getElementById('saveBtn').onclick=saveWorking;
  document.getElementById('freezeBtn').onclick=freezeSnapshot;
}

async function handleFile(e,fn){
  const file=e.target.files?.[0]; if(!file)return;
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
  const el=document.getElementById('matrix'); if(!el)return;
  const cell=16,row=16,nameW=58;
  el.style.setProperty('--cell',cell+'px');
  el.style.setProperty('--row',row+'px');
  el.style.setProperty('--name',nameW+'px');
  el.style.gridTemplateColumns=`${nameW}px repeat(31,${cell}px)`;

  let html='<div class="m-corner">姓名</div>';
  for(let d=1;d<=31;d++){
    const type=dayType(d),sel=(state.selection.type==='date'||state.selection.type==='cell')&&state.selection.day===d?' selected':'';
    html+=`<button class="m-date ${type}${sel}" data-date="${d}" title="${isoDate(d)} · 周${weekdayLabel(d)} · ${dayTypeText(type)}"><b>${pad(d)}</b></button>`;
  }

  for(const e of EMPLOYEES){
    const rowSelected=(state.selection.type==='person'||state.selection.type==='cell')&&state.selection.employeeId===e.id;
    const letters=Array.from(e.name).slice(0,4).map(ch=>`<span>${escapeNameChar(ch)}</span>`).join('');
    html+=`<button class="m-name ${rowSelected?'selected':''}" data-emp="${e.id}" title="${e.name} · ${e.department}"><span class="name-letters">${letters}</span></button>`;
    for(let d=1;d<=31;d++){
      const a=state.analysis.get(`${e.id}|${d}`),visible=matrixVisible(a);
      const selected=state.selection.type==='cell'&&state.selection.employeeId===e.id&&state.selection.day===d;
      const colSelected=(state.selection.type==='date'||state.selection.type==='cell')&&state.selection.day===d;
      const cls=a.status==='非工作日出勤'?'s-overtime':a.severity==='problem'?'s-problem':a.severity==='suspect'?'s-suspect':a.severity==='rest'?'s-rest':'s-normal';
      html+=`<div class="m-cell ${rowSelected?'row-focus':''} ${colSelected?'col-focus':''}">
        <button class="${cls} ${selected?'selected':''}" style="opacity:${visible?1:.10}" data-cell="${e.id}|${d}" title="${e.name} · ${isoDate(d)}\n${a.status}\n首进 ${a.firstIn||'—'} · 末出 ${a.lastOut||'—'}">${a.marker?`<i class="corner-mark ${a.marker}"></i>`:''}</button>
      </div>`;
    }
  }
  el.innerHTML=html;
  el.querySelectorAll('[data-emp]').forEach(b=>b.onclick=()=>selectPerson(b.dataset.emp));
  el.querySelectorAll('[data-date]').forEach(b=>b.onclick=()=>selectDate(+b.dataset.date));
  el.querySelectorAll('[data-cell]').forEach(b=>b.onclick=()=>{const [id,d]=b.dataset.cell.split('|');selectCell(id,+d)});
  const note=document.getElementById('filterNote');
  if(note)note.textContent=state.filter==='all'?'':({problem:'明确问题',suspect:'疑似异常',excused:'请假 / 出差',unresolved:'待核实',overtime:'非工作日出勤'}[state.filter]||'已筛选');
}

function analysisContext(){
  const s=state.selection;
  if(s.type==='person'){
    const e=EMPLOYEES.find(x=>x.id===s.employeeId);
    return {type:'person',title:e.name,eyebrow:`${e.department} · 2026 年 10 月`,employee:e,items:Array.from({length:31},(_,i)=>state.analysis.get(`${e.id}|${i+1}`))};
  }
  if(s.type==='date'){
    return {type:'date',title:`10 月 ${s.day} 日`,eyebrow:`周${weekdayLabel(s.day)} · ${dayTypeText(dayType(s.day))}`,day:s.day,items:EMPLOYEES.map(e=>state.analysis.get(`${e.id}|${s.day}`))};
  }
  if(s.type==='cell'){
    const e=EMPLOYEES.find(x=>x.id===s.employeeId),a=state.analysis.get(`${e.id}|${s.day}`);
    return {type:'cell',title:e.name,eyebrow:`${isoDate(s.day)} · ${a.status}`,employee:e,day:s.day,analysis:a,items:[a]};
  }
  return {type:'overall',title:'全月概览',eyebrow:'2026 年 10 月',items:workAnalyses()};
}

function renderAnalysisPanel(){
  const body=document.getElementById('analysisBody'); if(!body)return;
  if(typeof disposeAnalysisCharts==='function')disposeAnalysisCharts();
  const ctx=analysisContext();
  document.getElementById('analysisTitle').textContent=ctx.title;
  document.getElementById('analysisEyebrow').textContent=ctx.eyebrow;
  document.getElementById('selectionStatus').innerHTML=analysisSelectionBadge(ctx);
  document.querySelectorAll('[data-analysis-tab]').forEach(b=>b.classList.toggle('active',b.dataset.analysisTab===state.analysisTab));

  if(state.analysisTab==='timeline') body.innerHTML=analysisTimelineHtml(ctx);
  else if(state.analysisTab==='stats') body.innerHTML=analysisStatsHtml(ctx);
  else if(state.analysisTab==='records') body.innerHTML=analysisRecordsHtml(ctx);
  else body.innerHTML=analysisOverviewHtml(ctx);

  bindAnalysisPanel(ctx);
  if(typeof mountAnalysisVisuals==='function')mountAnalysisVisuals(ctx);
}

function analysisSelectionBadge(ctx){
  if(ctx.type==='cell'){
    const tone=ctx.analysis.severity==='problem'?'problem':ctx.analysis.severity==='suspect'?'suspect':'normal';
    return `<span class="selection-chip ${tone}"><i></i>${ctx.analysis.status}</span>`;
  }
  return '';
}

function bindAnalysisPanel(ctx){
  document.querySelectorAll('[data-analysis-tab]').forEach(b=>b.onclick=()=>{state.analysisTab=b.dataset.analysisTab;renderAnalysisPanel()});
  document.querySelectorAll('[data-analysis-cell]').forEach(b=>b.onclick=()=>{const [id,d]=b.dataset.analysisCell.split('|');if(id&&d)selectCell(id,+d)});document.querySelectorAll('[data-analysis-day]').forEach(b=>b.onclick=()=>selectDate(+b.dataset.analysisDay));
  document.querySelectorAll('[data-record]').forEach(b=>b.onclick=()=>showRecord(b.dataset.record));
  document.querySelectorAll('[data-show-records]').forEach(b=>b.onclick=()=>{state.analysisTab='records';renderAnalysisPanel()});
  document.querySelectorAll('[data-dayrecord]').forEach(b=>b.onclick=()=>showRecord(b.dataset.dayrecord));
  document.querySelectorAll('[data-revise]').forEach(b=>b.onclick=()=>reviseCurrent(b.dataset.revise));
}

function selectPerson(id){state.selection={type:'person',employeeId:id};state.analysisTab='overview';render()}
function selectDate(d){state.selection={type:'date',day:d};state.analysisTab='timeline';render()}
function selectCell(id,d){state.selection={type:'cell',employeeId:id,day:d};state.analysisTab='timeline';state.zoom=1;state.timelineRange=null;render()}

function escapeNameChar(ch){return String(ch).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
