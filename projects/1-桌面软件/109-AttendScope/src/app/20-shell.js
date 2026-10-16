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
    <div class="month-anchor top-month">
        <button id="monthMenuButton" class="month-button" aria-expanded="false" aria-label="切换或新建月份">
          <span>${periodText()}</span><i class="chevron"></i>
        </button>
        <div class="month-popover" id="monthPopover">
          <div class="month-popover-head"><button id="yearPrev" aria-label="上一年">‹</button><b id="browseYear">${YEAR}</b><button id="yearNext" aria-label="下一年">›</button></div>
          <div class="month-choices" id="monthChoices">${monthChoicesHtml(YEAR)}</div>
          <p>点选月份；尚无数据的月份可直接新建。</p>
        </div>
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
        <div class="calendar-caption"><span>月历</span><button class="quiet-link" id="clearSelection">总览</button></div>
        <div class="calendar-grid" id="calendar"></div>
        <div class="calendar-key">
          <span><i class="work"></i>工作</span>
          <span><i class="rest"></i>休息</span>
          <span><i class="adjust"></i>调休</span>
          <span><i class="holiday"></i>节假</span>
        </div>
      </section>

      <section class="side-section month-meta">
        <div class="side-label">当前月信息</div>
        <div class="meta-row"><span>工作</span><b>08:30–12:00</b></div>
        <div class="meta-row"><span>下午</span><b>14:00–17:30</b></div>
        <div class="meta-row"><span>人员</span><b>${EMPLOYEES.length} 人</b></div>
        <div class="meta-row"><span>请假</span><b>${state.leaves.length} 人次</b></div>
        <div class="meta-row"><span>出差</span><b>${state.trips.length} 人次</b></div>
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
          <div class="matrix-wrap" id="matrixScroll"><div class="matrix" id="matrix"></div></div>
        </section>

        <section class="analysis-panel">
          <div class="analysis-head">
            <h2 id="analysisTitle">月度总览</h2>
          </div>

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
  let browseYear=YEAR;
  const bindMonthChoices=()=>{
    document.getElementById('browseYear').textContent=browseYear;
    document.getElementById('monthChoices').innerHTML=monthChoicesHtml(browseYear);
    document.querySelectorAll('.month-choice').forEach(button=>button.onclick=()=>{
      const month=Number(button.dataset.month);
      if(chooseMonth(browseYear,month)){
        monthPopover.classList.remove('open');
        monthButton.setAttribute('aria-expanded','false');
      }
    });
  };
  document.getElementById('yearPrev').onclick=()=>{browseYear--;bindMonthChoices()};
  document.getElementById('yearNext').onclick=()=>{browseYear++;bindMonthChoices()};
  bindMonthChoices();
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
    if(YEAR!==2026||MONTH!==10){toast('演示数据仅用于 2026 年 10 月',true);return}
    Object.assign(state,generateMock()); state.selection={type:'overall'}; state.filter='all'; state.chartTab='overview';
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
  for(let d=1;d<=monthDays();d++){
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
  // Matrix dimensions are shared CSS variables, including responsive sizing.
  el.style.gridTemplateColumns='var(--matrix-name) repeat(31,var(--matrix-cell))';

  let html='<div class="m-corner">姓名</div>';
  for(let d=1;d<=31;d++){
    const invalid=d>monthDays();
    const type=dayType(d),sel=(state.selection.type==='date'||state.selection.type==='cell')&&state.selection.day===d?' selected':'';
    html+=`<button class="m-date ${type}${sel}" data-date="${d}" ${invalid?'disabled':''} title="${invalid?'无此日期':isoDate(d)+' · '+dayTypeText(type)}"><b>${invalid?'':pad(d)}</b></button>`;
  }

  for(const e of EMPLOYEES){
    const rowSelected=(state.selection.type==='person'||state.selection.type==='cell')&&state.selection.employeeId===e.id;
    const letters=Array.from(e.name).slice(0,4).map(ch=>`<span>${escapeNameChar(ch)}</span>`).join('');
    html+=`<button class="m-name ${rowSelected?'selected':''} ${Number(e.id.slice(1))%2?'':'row-alt'}" data-emp="${e.id}" title="${e.name} · ${e.department}"><span class="name-letters">${letters}</span></button>`;
    for(let d=1;d<=31;d++){
      if(d>monthDays()){html+='<div class="m-cell inactive"></div>';continue}
      const a=state.analysis.get(`${e.id}|${d}`),visible=matrixVisible(a);
      const selected=state.selection.type==='cell'&&state.selection.employeeId===e.id&&state.selection.day===d;
      const colSelected=(state.selection.type==='date'||state.selection.type==='cell')&&state.selection.day===d;
      const cls=a.status==='非工作日出勤'?'s-overtime':a.severity==='problem'?'s-problem':a.severity==='suspect'?'s-suspect':a.severity==='rest'?'s-rest':'s-normal';
      html+=`<div class="m-cell ${rowSelected?'row-focus':''} ${colSelected?'col-focus':''} ${selected?'cell-focus':''} ${Number(e.id.slice(1))%2?'':'row-alt'} day-${dayType(d)}" data-emp="${e.id}" data-day="${d}">
        <button class="${cls} ${selected?'selected':''}" style="opacity:${visible?1:.10}" data-cell="${e.id}|${d}" title="${e.name} · ${isoDate(d)}\n${a.status}\n首进 ${a.firstIn||'—'} · 末出 ${a.lastOut||'—'}">${a.marker?`<i class="corner-mark ${a.marker}"></i>`:''}</button>
      </div>`;
    }
  }
  el.innerHTML=html;
  el.querySelectorAll('.m-name[data-emp]').forEach(b=>b.onclick=()=>selectPerson(b.dataset.emp));
  el.querySelectorAll('[data-date]').forEach(b=>b.onclick=()=>selectDate(+b.dataset.date));
  el.querySelectorAll('[data-cell]').forEach(b=>b.onclick=()=>{const [id,d]=b.dataset.cell.split('|');selectCell(id,+d)});
  el.onpointerover=e=>{
    const n=e.target.closest('[data-cell],[data-emp],[data-date]');if(!n)return;
    const emp=n.dataset.emp||n.dataset.cell?.split('|')[0];
    const day=n.dataset.day||n.dataset.date||n.dataset.cell?.split('|')[1];
    el.querySelectorAll('.hover-row,.hover-col').forEach(x=>x.classList.remove('hover-row','hover-col'));
    if(emp)el.querySelectorAll('[data-emp="'+emp+'"]').forEach(x=>x.classList.add('hover-row'));
    if(day)el.querySelectorAll('[data-day="'+day+'"],.m-date[data-date="'+day+'"]').forEach(x=>x.classList.add('hover-col'));
  };
  el.onpointerleave=()=>el.querySelectorAll('.hover-row,.hover-col').forEach(x=>x.classList.remove('hover-row','hover-col'));
}

function analysisContext(){
  const sel=state.selection,period=monthKey();
  if(sel.type==='person'||sel.type==='cell'){
    const e=EMPLOYEES.find(x=>x.id===sel.employeeId);
    if(!e)return {type:'overall',title:period+' 全月总览',items:workAnalyses()};
    const items=Array.from({length:monthDays()},(_,i)=>state.analysis.get(e.id+'|'+(i+1)));
    if(sel.type==='person')return {type:'person',title:period+' '+groupOf(e)+' '+e.name,employee:e,items};
    const a=state.analysis.get(e.id+'|'+sel.day);
    return {type:'cell',title:isoDate(sel.day)+' '+groupOf(e)+' '+e.name,employee:e,day:sel.day,analysis:a,items:[a]};
  }
  if(sel.type==='date')return {type:'date',title:isoDate(sel.day),day:sel.day,items:EMPLOYEES.map(e=>state.analysis.get(e.id+'|'+sel.day))};
  return {type:'overall',title:period+' 全月总览',items:workAnalyses()};
}

function renderAnalysisPanel(){
  const body=document.getElementById('analysisBody'); if(!body)return;
  if(typeof disposeAnalysisCharts==='function')disposeAnalysisCharts();
  const ctx=analysisContext();
  document.getElementById('analysisTitle').innerHTML=(ctx.employee
    ?'<span class="head-date">'+(ctx.type==='cell'?isoDate(ctx.day):monthKey())+'</span><button class="head-group" data-edit-group="'+ctx.employee.id+'" title="点击编辑组别">'+escapeNameChar(groupOf(ctx.employee))+' ✎</button><strong>'+escapeNameChar(ctx.employee.name)+'</strong>'
    :'<span class="head-date">'+escapeNameChar(ctx.title)+'</span>');
  if(typeof disposeRawTable==='function')disposeRawTable();
  body.innerHTML=attendWorkbenchHtml(ctx);
  bindAnalysisPanel(ctx);
  document.querySelectorAll('[data-edit-group]').forEach(b=>b.onclick=()=>setPersonGroup(b.dataset.editGroup));
  mountAnalysisVisuals(ctx);
  mountRawTable(ctx);
}

function analysisSelectionBadge(ctx){
  if(ctx.type==='cell'){
    const tone=ctx.analysis.severity==='problem'?'problem':ctx.analysis.severity==='suspect'?'suspect':'normal';
    return `<span class="selection-chip ${tone}"><i></i>${ctx.analysis.status}</span>`;
  }
  return '';
}

function bindAnalysisPanel(ctx){
  document.querySelectorAll('[data-analysis-cell]').forEach(b=>b.onclick=()=>{const [id,d]=b.dataset.analysisCell.split('|');if(id&&d)selectCell(id,+d)});document.querySelectorAll('[data-analysis-day]').forEach(b=>b.onclick=()=>selectDate(+b.dataset.analysisDay));
  document.querySelectorAll('[data-record]').forEach(b=>b.onclick=()=>showRecord(b.dataset.record));
  document.querySelectorAll('[data-show-records]').forEach(b=>b.onclick=()=>{state.rawDataTab='attendance';renderRawTable(ctx)});
  document.querySelectorAll('[data-dayrecord]').forEach(b=>b.onclick=()=>showRecord(b.dataset.dayrecord));
  document.querySelectorAll('[data-revise]').forEach(b=>b.onclick=()=>reviseCurrent(b.dataset.revise));
}

function selectPerson(id){state.selection={type:'person',employeeId:id};state.chartTab='overview';state.chartDay=nearestRecordedDay(id);state.rawPage=1;render()}
function selectDate(d){
  if(d<1||d>monthDays())return;
  const sel=state.selection;
  if((sel.type==='person'||sel.type==='cell')&&state.chartTab==='timeline'){
    state.selection={type:'cell',employeeId:sel.employeeId,day:d};
    state.chartDay=d;state.timelineRange=null;
  }else{state.selection={type:'date',day:d};state.chartTab='overview'}
  state.rawPage=1;render();
}
function selectCell(id,d){
  if(d<1||d>monthDays())return;
  state.selection={type:'cell',employeeId:id,day:d};
  state.chartTab='timeline';state.chartDay=d;state.timelineRange=null;state.rawPage=1;render();
}
function monthChoicesHtml(year){
  return Array.from({length:12},(_,i)=>{
    const month=i+1,active=year===YEAR&&month===MONTH,exists=monthExists(year,month);
    return '<button class="month-choice '+(active?'active':exists?'has-data':'new-month')+'" data-month="'+month+'" title="'+(exists?'进入已有工作空间':'新建空白月度工作空间')+'">'+pad(month)+(exists?'':' +')+'</button>';
  }).join('');
}

function escapeNameChar(ch){return String(ch).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
