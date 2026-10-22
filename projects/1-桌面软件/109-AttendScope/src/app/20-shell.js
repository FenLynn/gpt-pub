/* R50: local route history, independent from editable attendance data.
 * Only view context is stored; raw records and working/snapshot state are untouched. */
const asNavHistory={back:[],forward:[],current:null,restoring:false};
function asNavSnapshot(){
 return {year:YEAR,month:MONTH,workspaceMode:state.workspaceMode||'all',
  analyticsPage:state.analyticsPage||'main',selectedGroup:state.selectedGroup||null,
  selection:{...(state.selection||{type:'overall'})},chartDay:state.chartDay||null,
  chartTab:state.chartTab||'overview',dataSection:state.dataSection||'records',
  rawDataTab:state.rawDataTab||'attendance',insightTab:state.insightTab||'summary',
  statsScope:state.statsScope||'all',statsGroup:state.statsGroup||'',
  statsPersonId:state.statsPersonId||'',statsExpandedKey:state.statsExpandedKey||'',
  filter:state.filter||'main',statsConfig:state.statsConfig?{...state.statsConfig}:null};
}
function asNavTrack(){
 const next=asNavSnapshot(),history=asNavHistory;
 if(!history.restoring&&history.current&&JSON.stringify(next)!==JSON.stringify(history.current)){
  history.back.push(history.current);
  if(history.back.length>40)history.back.shift();
  history.forward.length=0;
 }
 history.current=next;
 asNavUpdateButtons();
}
function asNavUpdateButtons(){
 const back=document.getElementById('asNavBack'),forward=document.getElementById('asNavForward');
 if(back)back.disabled=!asNavHistory.back.length;
 if(forward)forward.disabled=!asNavHistory.forward.length;
}
// A changed chart/filter setting is a refinement of the current screen, not
// a new history entry; the next drilldown still returns to that exact screen.
function asNavRefreshCurrent(){if(!asNavHistory.restoring)asNavHistory.current=asNavSnapshot()}
function asNavGo(direction){
 const history=asNavHistory,source=direction==='back'?history.back:history.forward,
  other=direction==='back'?history.forward:history.back;
 if(!source.length)return;
 const target=source.pop(),previous=asNavSnapshot();
 history.restoring=true;
 try{
  if(target.year!==YEAR||target.month!==MONTH){
   if(!switchMonth(target.year,target.month,false,true)){
    source.push(target);return;
   }
  }
  other.push(previous);
  state.workspaceMode=target.workspaceMode;
  state.analyticsPage=target.analyticsPage;
  state.selectedGroup=target.selectedGroup;
  state.selection={...target.selection};
  state.chartDay=target.chartDay;
  state.chartTab=target.chartTab;
  state.dataSection=target.dataSection;
  state.rawDataTab=target.rawDataTab;
  state.insightTab=target.insightTab;
  state.statsScope=target.statsScope;
  state.statsGroup=target.statsGroup;
  state.statsPersonId=target.statsPersonId;
  state.statsExpandedKey=target.statsExpandedKey;
  state.filter=target.filter;
  state.statsConfig=target.statsConfig?{...target.statsConfig}:null;
  state.rawPage=1;state.timelineRange=null;
  render();
 }finally{history.restoring=false;history.current=asNavSnapshot()}
}
function render(){
  asNavTrack();
  if(typeof r14Prefs==='function')r14Prefs();
  if(!state.analysisTab) state.analysisTab='overview';
  if(typeof disposeAttendCharts==='function')disposeAttendCharts();
  document.title=attendTitle()+' · 离线考勤分析';
   document.getElementById('app').innerHTML=layoutHtml();
  document.documentElement.style.setProperty('--ui-scale',String(state.prefs?.fontScale||1));
  document.documentElement.classList.toggle('reduce-animations',state.prefs?.motion===false);
  bind();
  renderCalendar();
  if(state.workspaceMode!=='stats')renderMatrix();
  if(state.workspaceMode==='stats')renderStatisticsWorkspace();
  else renderAnalysisPanel();
}

function layoutHtml(){
  return `
  <header class="topbar">
    <div class="brand">
      <div class="logo" aria-hidden="true"><span></span></div>
      <strong class="brand-title">${escapeNameChar(attendTitle())}</strong>
      <span class="brand-mode">${state.projectDir?"离线考勤":state.isDemo?"演示 · 待初始化":"未连接目录"}</span>
    </div>
    <nav class="workspace-navigation" aria-label="分析工作区">${workspaceNavHtml()}</nav>
    <div class="top-global-actions">
    <div class="top-history" role="group" aria-label="页面浏览历史">
      <button id="asNavBack" type="button" title="返回上一个界面" aria-label="返回上一个界面" ${asNavHistory.back.length?'':'disabled'}><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false"><path d="m14.5 6.5-5.5 5.5 5.5 5.5"/></svg></button>
      <button id="asNavForward" type="button" title="前进到下一个界面" aria-label="前进到下一个界面" ${asNavHistory.forward.length?'':'disabled'}><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false"><path d="m9.5 6.5 5.5 5.5-5.5 5.5"/></svg></button>
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
    <div class="month-actions">
      <span class="save-state ${state.saved?'saved':'dirty'}"><b aria-hidden="true">${state.saved?'✓':'!'}</b>${state.saved?'已保存':'未保存'}</span>
      <div class="import-anchor">
        <button class="text-btn" id="importBtn">导入</button>
        <div class="import-popover" id="importPopover">
          ${importMenuRow('考勤记录','attendanceInput','sampleAttendance')}
          ${importMenuRow('请假','leaveInput','sampleLeave')}
          ${importMenuRow('出差','tripInput','sampleTrip')}
          ${importMenuRow('外出','outingInput','sampleOuting')}
          ${importMenuRow('登记加班','overtimeInput','sampleOvertime')}
          <div class="import-divider"></div>
          <button class="import-reset" id="resetDemo">恢复模拟数据</button>
        </div>
      </div>
      <button class="text-btn" id="connectDir">目录</button>
      <button class="text-btn" id="p109ProjectControl">${state.projectDir?"项目":"初始化"}</button>
      <button class="text-btn" id="saveBtn">保存</button>
      <button class="text-btn" id="restoreBtn">恢复</button>
      <input id="restoreInput" type="file" accept=".json,application/json" hidden>
      <button class="primary-btn" id="freezeBtn">冻结</button>
    </div>
    <div class="top-actions">
      <button class="text-btn" id="exportTable">导出表格</button><button class="text-btn" id="exportCsv">CSV</button>
      <button class="text-btn" id="captureView">截图</button>
      <div class="r63-pdf-anchor"><button class="text-btn" id="printReport" aria-expanded="false" aria-controls="r63PdfPicker">PDF ▾</button><div id="r63PdfPicker" class="r63-pdf-picker" hidden></div></div>
      <span class="action-divider"></span>
      <button class="settings-toggle" id="settingsBtn" title="设置" aria-label="设置">⚙</button>
    </div>
    </div>
  </header>

  <div class="layout workspace-mode-${state.workspaceMode||'all'} ${state.analyticsPage==='stats'?'stats-active':''}">
    <aside class="sidebar">
      ${state.workspaceMode==='classic'?`
      <section class="side-section calendar-section">
        <div class="calendar-caption"><span>月历</span><button class="quiet-link" id="clearSelection">全部</button></div>
        <div class="calendar-grid" id="calendar"></div>
        <div class="calendar-key">
          <span><i class="work"></i>工作日</span>
          <span><i class="rest"></i>休息日</span>
          <span><i class="adjust"></i>调休上班</span>
        </div>
      </section>

      <section class="side-section month-meta">
        <div class="side-label">当前月信息</div>
        <div class="meta-row"><span>工作</span><b>${RULES.amStart}–${RULES.amEnd}</b></div>
        <div class="meta-row"><span>下午</span><b>${RULES.pmStart}–${RULES.pmEnd}</b></div>
        <div class="meta-row"><span>人员</span><b>${EMPLOYEES.length} 人</b></div>
        <div class="meta-row"><span>请假</span><b>${state.leaves.length} 人次</b></div>
        <div class="meta-row"><span>出差</span><b>${state.trips.length} 人次</b></div>
        <div class="meta-row"><span>原始记录</span><b>${state.records.length.toLocaleString()}</b></div>
        <div class="meta-row"><span>目录</span><b class="${state.projectDir?'ok':'muted'}">${state.projectDir?'已连接':'未连接'}</b></div>
      </section>

      <section class="side-section state-select-wrap">
        <div class="side-label">状态筛选</div>
        <div class="status-filter-control">
          <button id="statusFilterButton" class="status-filter-button" type="button" aria-expanded="false" aria-haspopup="listbox">
            ${statusFilterLabel(state.filter)}
          </button>
          <div id="statusFilterMenu" class="status-filter-menu" role="listbox">
            ${statusFilterMenuHtml()}
          </div>
          <select id="statusFilter" class="status-filter-native" aria-label="状态筛选">
            <option value="main">常规</option>
            <option value="normal">正常</option>
            <option value="anomaly">异常</option>
            <option value="absent">缺勤</option>
            <option value="lateEarly">迟到早退</option>
            <option value="overtime">加班</option>
            <option value="leave">请假</option>
            <option value="trip">出差</option>
            <option value="outing">外出</option>
          </select>
        </div>
        <div class="judgment-mode-switch" id="judgmentModeSwitch" aria-label="判断显示模式">
          <button type="button" data-judgment-mode="initial" class="${state.judgmentMode!=='manual'?'active':''}">初始</button>
          <button type="button" data-judgment-mode="manual" class="${state.judgmentMode==='manual'?'active':''}" ${hasManualStatuses()?'':'disabled'}>人工</button>
        </div>
      </section>
`:workspaceSidebarHtml()}
    </aside>

    <main class="workspace">
      ${workspaceToolbarHtml()}
      <div class="workbench">
        <section class="matrix-zone" aria-label="月度员工考勤状态矩阵">
          <div class="matrix-wrap" id="matrixScroll"><div class="matrix" id="matrix"></div></div>
        </section>
        ${['all','group'].includes(state.workspaceMode)?'<aside id="scopeInsights" class="scope-insights" aria-label="统计分析"></aside>':''}

        <section class="analysis-panel">
          <div class="analysis-head">
            <h2 id="analysisTitle">月度总览</h2>
            <div class="analysis-head-tools" id="analysisHeadTools"></div>
          </div>

          <div class="analysis-body" id="analysisBody"></div>
        </section>
      </div>
      ${state.workspaceMode==='stats'?'<section id="statisticsWorkspace" class="stats-workspace"></section>':''}
      
    </main>
  </div>

  ${r14SettingsMarkup()}
  <input class="hidden" id="attendanceInput" type="file" accept=".xlsx,.csv">
  <input class="hidden" id="leaveInput" type="file" accept=".xlsx,.csv">
  <input class="hidden" id="tripInput" type="file" accept=".xlsx,.csv">
  <input class="hidden" id="outingInput" type="file" accept=".xlsx,.csv">
  <input class="hidden" id="overtimeInput" type="file" accept=".xlsx,.csv">
  `;
}

function importMenuRow(title,input,sample){
  return `<div class="import-menu-row"><span>${title}</span><div><button data-open="${input}">导入</button><button id="${sample}">样例</button></div></div>`;
}

function bind(){
  document.getElementById('attendanceInput').onchange=e=>handleFile(e,file=>r62OpenImport(file,'attendance'));
  document.getElementById('leaveInput').onchange=e=>handleFile(e,file=>r62OpenImport(file,'leave'));
  document.getElementById('tripInput').onchange=e=>handleFile(e,file=>r62OpenImport(file,'trip'));
  document.getElementById('outingInput').onchange=e=>handleFile(e,file=>r62OpenImport(file,'outing'));
  document.getElementById('overtimeInput').onchange=e=>handleFile(e,file=>r62OpenImport(file,'overtime'));

  const filter=document.getElementById('statusFilter');
  const filterButton=document.getElementById('statusFilterButton');
  const filterMenu=document.getElementById('statusFilterMenu');
  filter.value=state.filter;
  const syncFilterButton=()=>{filterButton.innerHTML=statusFilterLabel(state.filter)};
  filter.onchange=()=>{
    state.filter=filter.value;
    if(['trip','leave','outing','overtime'].includes(state.filter))state.rawDataTab=state.filter;
    else state.rawDataTab='attendance';
    state.chartTab='overview';
    updateMatrixFilter();syncFilterButton();
    filterMenu.classList.remove('open');filterButton.setAttribute('aria-expanded','false');
    if(state.analyticsPage==='stats')renderStatisticsWorkspace();
    else renderAnalysisPanel();
    asNavRefreshCurrent();
  };
  filterButton.onclick=e=>{
    e.stopPropagation();filterMenu.classList.toggle('open');
    filterButton.setAttribute('aria-expanded',String(filterMenu.classList.contains('open')));
  };
  filterMenu.querySelectorAll('[data-filter-value]').forEach(button=>button.onclick=e=>{
    e.stopPropagation();filter.value=button.dataset.filterValue;filter.dispatchEvent(new Event('change'));
  });
  document.querySelectorAll('[data-judgment-mode]').forEach(button=>button.onclick=()=>{
    const mode=button.dataset.judgmentMode;
    if(mode==='manual'&&!hasManualStatuses())return;
    state.judgmentMode=mode;state.saved=false;rememberMonth();render();
  });
  bindSettings();
  bindWorkspaceNavigation();
  document.getElementById('asNavBack').onclick=()=>asNavGo('back');
  document.getElementById('asNavForward').onclick=()=>asNavGo('forward');

  document.getElementById('clearSelection').onclick=()=>{
    if(state.workspaceMode==='person'){
      const employeeId=state.selection.employeeId||EMPLOYEES[0]?.id;
      state.selection=employeeId?{type:'person',employeeId}:{type:'overall'};
    }else state.selection={type:'overall'};
    if(state.workspaceMode==='classic')state.chartTab='overview';
    render();
  };
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
    if(!e.target.closest('.status-filter-control')){
      filterMenu.classList.remove('open');
      filterButton.setAttribute('aria-expanded','false');
    }
  };

  document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.open).click());
  document.getElementById('sampleAttendance').onclick=downloadAttendance;
  document.getElementById('sampleLeave').onclick=downloadLeaves;
  document.getElementById('sampleTrip').onclick=downloadTrips;
  document.getElementById('sampleOuting').onclick=downloadOutings;
  document.getElementById('sampleOvertime').onclick=downloadOvertimeEntries;
  document.getElementById('resetDemo').onclick=()=>{
    if(YEAR!==2026||MONTH!==10){toast('演示数据仅用于 2026 年 10 月',true);return}
    Object.assign(state,generateMock()); state.selection={type:'overall'}; state.filter='main'; state.chartTab='overview';
    state.revisions=[];state.manualStatuses={};state.overtimeReview={};state.judgmentMode='initial'; state.saved=false; reanalyze(); render(); toast('已恢复模拟数据');
  };

  document.getElementById('connectDir').onclick=connectProjectDir;
  document.getElementById('p109ProjectControl').onclick=()=>openProjectControl();
  document.getElementById('exportTable').onclick=exportTraditionalTable;
  document.getElementById('exportCsv').onclick=downloadCurrentCSV;
  document.getElementById('captureView').onclick=captureCurrentView;
  document.getElementById('printReport').onclick=r63TogglePdfPicker;
  document.getElementById('saveBtn').onclick=saveWorking;
  document.getElementById('restoreBtn').onclick=()=>document.getElementById('restoreInput').click();
  document.getElementById('restoreInput').onchange=async e=>{
   const f=e.target.files?.[0];if(!f)return;
   try{await restoreWorkingFile(f)}catch(err){toast('恢复失败：'+err.message,true)}
   finally{e.target.value=''}
  };
  document.getElementById('freezeBtn').onclick=freezeSnapshot;
  bindGlobalUiShortcuts();
}

function bindGlobalUiShortcuts(){
 if(window.__p109UiShortcutsBound)return;
 window.__p109UiShortcutsBound=true;
 document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  const project=document.querySelector('.p109-project-overlay');
  if(project){e.preventDefault();project.querySelector('#p109ProjectClose')?.click();project.remove();return}
  const importer=document.querySelector('.r62-overlay');
  if(importer){e.preventDefault();importer.querySelector('#r62Close')?.click();return}
  const pdf=document.getElementById('r63PdfPicker');
  if(pdf&&!pdf.hidden){e.preventDefault();pdf.hidden=true;document.getElementById('printReport')?.setAttribute('aria-expanded','false');return}
  const settings=document.querySelector('.settings-overlay:not(.hidden)');
  if(settings){e.preventDefault();document.getElementById('settingsClose')?.click();document.getElementById('settingsBtn')?.focus();return}
  const raw=document.querySelector('.raw-dialog-overlay');
  if(raw&&typeof closeRawPopout==='function'){e.preventDefault();closeRawPopout();return}
  const custom=document.querySelector('.r73-modal-backdrop');
  if(custom){
   const close=custom.querySelector('[data-modal-close],[aria-label*="关闭"],[aria-label*="取消"]');
   if(close){e.preventDefault();close.click();return}
  }
  const importMenu=document.getElementById('importPopover');
  const monthMenu=document.getElementById('monthPopover');
  const statusMenu=document.getElementById('statusFilterMenu');
  if(importMenu?.classList.contains('open')||monthMenu?.classList.contains('open')||statusMenu?.classList.contains('open')){
   e.preventDefault();importMenu?.classList.remove('open');monthMenu?.classList.remove('open');statusMenu?.classList.remove('open');
   document.getElementById('monthMenuButton')?.setAttribute('aria-expanded','false');
   document.getElementById('statusFilterButton')?.setAttribute('aria-expanded','false');
  }
 });
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
    const type=dayType(d),selectedDay=state.workspaceMode==='person'?(state.chartDay||state.selection.day):state.selection.day,sel=selectedDay===d?' selected':'';
    el.insertAdjacentHTML('beforeend',`<button class="cal-day ${type}${sel}" data-day="${d}" title="${dayTypeText(type)}"><span>${d}</span></button>`);
  }
  el.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>selectDate(+b.dataset.day));
}

function matrixVisible(a){
 const judgment=attendanceJudgment(a);
 return state.filter==='main'?['normal','anomaly','absent'].includes(judgment):
   state.filter==='lateEarly'?attendanceHasLateEarly(a):
   ['trip','leave','outing','overtime'].includes(state.filter)?
   attendanceBehaviors(a).includes(state.filter):judgment===state.filter;
}
function updateMatrixFilter(){
 document.getElementById('matrix')?.classList.toggle('behavior-view',['trip','leave','outing','overtime'].includes(state.filter));
 document.querySelectorAll('.m-cell button[data-cell]').forEach(button=>{
   const [id,d]=button.dataset.cell.split('|'),a=state.analysis.get(id+'|'+d);
   const selected=state.selection.type==='cell'&&state.selection.employeeId===id&&state.selection.day===+d;
   const category=matrixCategory(a);
   button.className='s-'+category+(selected?' selected':'')+(!matrixVisible(a)&&!selected?' filtered-out':'');
   button.style.setProperty('--status-color',categoryColor(category));
 });
}
function renderMatrix(){
  const el=document.getElementById('matrix'); if(!el)return;
  const visibleEmployees=state.workspaceMode==='classic'?EMPLOYEES:scopeVisibleEmployees();
  el.closest('.matrix-zone')?.style.setProperty('--scope-count',String(visibleEmployees.length));
  // Matrix dimensions are shared CSS variables, including responsive sizing.
  el.style.gridTemplateColumns='var(--matrix-name) repeat(31,var(--matrix-cell))';

  let html='<button class="m-corner" id="matrixAll" title="清除选择，查看全员月度数据">全部</button>';
  for(let d=1;d<=31;d++){
    const invalid=d>monthDays();
    const type=dayType(d),sel=(state.selection.type==='date'||state.selection.type==='cell')&&state.selection.day===d?' selected':'';
    html+=`<button class="m-date ${type}${sel}" data-date="${d}" ${invalid?'disabled':''} title="${invalid?'无此日期':isoDate(d)+' · '+dayTypeText(type)}"><b>${invalid?'':pad(d)}</b></button>`;
  }

  for(const e of visibleEmployees){
    const rowSelected=(state.selection.type==='person'||state.selection.type==='cell')&&state.selection.employeeId===e.id;
    const letters=Array.from(e.name).slice(0,4).map(ch=>`<span>${escapeNameChar(ch)}</span>`).join('');
    html+=`<button class="m-name ${rowSelected?'selected':''} ${Number(e.id.slice(1))%2?'':'row-alt'}" data-emp="${escapeNameChar(e.id)}" title="${escapeNameChar(e.name)} · ${escapeNameChar(e.department)}"><span class="m-name-num">${String(EMPLOYEES.indexOf(e)+1).padStart(2,'0')}</span><span class="name-letters">${state.workspaceMode==='classic'?letters:escapeNameChar(e.name)}</span></button>`;
    for(let d=1;d<=31;d++){
      if(d>monthDays()){html+='<div class="m-cell inactive"></div>';continue}
      const a=state.analysis.get(`${e.id}|${d}`),visible=matrixVisible(a);
      const selected=state.selection.type==='cell'&&state.selection.employeeId===e.id&&state.selection.day===d;
      const colSelected=(state.selection.type==='date'||state.selection.type==='cell')&&state.selection.day===d;
      const category=matrixCategory(a),cls='s-'+category,behaviors=attendanceBehaviors(a);
      html+=`<div class="m-cell ${rowSelected?'row-focus':''} ${colSelected?'col-focus':''} ${selected?'cell-focus':''} ${Number(e.id.slice(1))%2?'':'row-alt'} day-${dayType(d)}" data-emp="${e.id}" data-day="${d}">
        <button class="${cls} ${visible||selected?'':'filtered-out'} ${selected?'selected':''}" style="--status-color:${categoryColor(category)}" data-cell="${escapeNameChar(e.id)}|${d}" title="${escapeNameChar(e.name)} · ${isoDate(d)}\n初始：${attendanceJudgmentSystem(a)} · 当前：${attendanceJudgment(a)}\n行为：${behaviors.join(' / ')||'无'}\n首进 ${a.firstIn||'—'} · 末出 ${a.lastOut||'—'}">${state.judgmentMode==='manual'&&manualStatusFor(a)&&state.prefs?.matrix?.showManualCheck!==false?'<i class="manual-check">✓</i>':''}</button>
      </div>`;
    }
  }
  const selectedRow=(state.selection.type==='person'||state.selection.type==='cell')
    ?visibleEmployees.findIndex(e=>e.id===state.selection.employeeId):-1;
  const selectedCol=(state.selection.type==='date'||state.selection.type==='cell')
    ?state.selection.day-1:-1;
  html+='<div class="matrix-selection-frame focus-row '+(selectedRow<0?'inactive':'')+
    ' '+(state.selection.type==='cell'?'soft':'')+'" style="--focus-row:'+Math.max(0,selectedRow)+'"></div>';
  html+='<div class="matrix-selection-frame focus-col '+(selectedCol<0?'inactive':'')+
    ' '+(state.selection.type==='cell'?'soft':'')+'" style="--focus-col:'+Math.max(0,selectedCol)+'"></div>';
  html+='<div class="matrix-preview-frame focus-row inactive"></div><div class="matrix-preview-frame focus-col inactive"></div>';
  el.innerHTML=html;
  el.style.setProperty('--matrix-rows',String(visibleEmployees.length));
  el.classList.toggle('behavior-view',['trip','leave','outing','overtime'].includes(state.filter));
  el.classList.remove('focus-person','focus-date','focus-cell');
  if(state.selection.type==='person')el.classList.add('focus-person');
  if(state.selection.type==='date')el.classList.add('focus-date');
  if(state.selection.type==='cell')el.classList.add('focus-cell');
  document.getElementById('matrixAll').onclick=()=>{state.selection={type:'overall'};state.chartTab='overview';render()};
  el.querySelectorAll('.m-name[data-emp]').forEach(b=>b.onclick=()=>{if(state.workspaceMode==='classic')selectPerson(b.dataset.emp);else selectMatrixRow(b.dataset.emp)});
  el.querySelectorAll('[data-date]').forEach(b=>b.onclick=()=>selectDate(+b.dataset.date,true));
  el.querySelectorAll('[data-cell]').forEach(b=>b.onclick=()=>{const [id,d]=b.dataset.cell.split('|');selectCell(id,+d)});
  const hoverRow=el.querySelector('.matrix-preview-frame.focus-row');
  const hoverCol=el.querySelector('.matrix-preview-frame.focus-col');
  const clearHover=()=>{hoverRow?.classList.add('inactive');hoverCol?.classList.add('inactive')};
  el.onpointerover=e=>{
    const n=e.target.closest('[data-cell],.m-name[data-emp],.m-date[data-date]');if(!n){clearHover();return}
    const id=n.dataset.cell?.split('|')[0]||n.dataset.emp||'';
    const d=Number(n.dataset.date||n.dataset.cell?.split('|')[1]||0);
    const ix=visibleEmployees.findIndex(emp=>emp.id===id);
    const enabled=state.prefs?.matrix?.crosshair!==false;
    hoverRow.classList.toggle('inactive',!enabled||ix<0);
    hoverCol.classList.toggle('inactive',!enabled||d<1||d>monthDays());
    if(ix>=0)hoverRow.style.setProperty('--focus-row',ix);
    if(d>=1)hoverCol.style.setProperty('--focus-col',d-1);
  };
  el.onpointerleave=clearHover;
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
  if(state.workspaceMode==='all'||state.workspaceMode==='group'){renderScopeSummary();return}
  if(state.workspaceMode==='data'){renderDataWorkspace();return}
  
  const body=document.getElementById('analysisBody'); if(!body)return;
  if(typeof disposeAnalysisCharts==='function')disposeAnalysisCharts();
  const ctx=analysisContext();
  document.getElementById('analysisTitle').innerHTML=(ctx.employee
    ?'<span class="head-date">'+(ctx.type==='cell'?isoDate(ctx.day):monthKey())+'</span><button class="head-group" data-edit-group="'+ctx.employee.id+'" title="点击编辑组别">'+escapeNameChar(groupOf(ctx.employee))+' ✎</button><strong>'+escapeNameChar(ctx.employee.name)+'</strong>'
    :'<span class="head-date">'+escapeNameChar(ctx.title)+'</span>');
  const headTools=document.getElementById('analysisHeadTools');
  if(headTools)headTools.innerHTML=typeof timelineHeaderToolsHtml==='function'?timelineHeaderToolsHtml(ctx):'';
  if(typeof disposeRawTable==='function')disposeRawTable();
  body.innerHTML=attendWorkbenchHtml(ctx);
  bindAnalysisPanel(ctx);
  document.querySelectorAll('[data-edit-group]').forEach(b=>b.onclick=()=>setPersonGroup(b.dataset.editGroup));
  mountAnalysisVisuals(ctx);
  mountRawTable(ctx);
}

function analysisSelectionBadge(ctx){
  if(ctx.type==='cell'){
    const tone=attendanceJudgment(ctx.analysis);
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
  document.querySelectorAll('[data-manual-status]').forEach(b=>b.onclick=()=>setManualStatusForCurrent(b.dataset.manualStatus));
  document.querySelectorAll('[data-manual-clear]').forEach(b=>b.onclick=()=>setManualStatusForCurrent(null));
  document.querySelectorAll('[data-insight-tab]').forEach(b=>b.onclick=()=>{
    state.insightTab=b.dataset.insightTab;
    document.querySelectorAll('[data-insight-tab]').forEach(x=>{
      const active=x.dataset.insightTab===state.insightTab;
      x.classList.toggle('active',active);x.setAttribute('aria-selected',String(active));
    });
    document.querySelectorAll('[data-insight-pane]').forEach(x=>x.classList.toggle('active',x.dataset.insightPane===state.insightTab));
    asNavRefreshCurrent();
  });
}

function selectMatrixRow(id){
 if(!EMPLOYEES.some(e=>e.id===id))return;
 state.selection={type:'person',employeeId:id};
 state.chartDay=nearestRecordedDay(id);
 render();
}
function selectPerson(id){
 const scoped=state.workspaceMode!=='classic';
 if(scoped)state.workspaceMode='person';
 state.selection=scoped?{type:'cell',employeeId:id,day:1}:{type:'person',employeeId:id};
 state.chartTab=scoped?'timeline':'overview';
 state.chartDay=scoped?1:nearestRecordedDay(id);
 state.timelineRange=null;state.rawPage=1;render();
}
function changePersonalDay(day){
 const d=Number(day);
 if(!Number.isInteger(d)||d<1||d>monthDays())return;
 const employeeId=state.selection.employeeId||EMPLOYEES[0]?.id;
 if(!employeeId)return;
 state.workspaceMode='person';
 state.analyticsPage='main'; // Statistics date drilldown must reveal the six-track view.
 state.selection={type:'cell',employeeId,day:d};
 state.chartDay=d;state.chartTab='timeline';state.timelineRange=null;state.rawPage=1;
 render();
}
function selectDate(d,allPeople=false){
 if(d<1||d>monthDays())return;
 const sel=state.selection;
 if(!allPeople&&(sel.type==='person'||sel.type==='cell')&&(state.workspaceMode==='person'||state.workspaceMode==='classic')){
  if(state.workspaceMode==='person'){changePersonalDay(d);return}
  // Keep the legacy six-track browser regression workflow in classic mode.
  state.selection={type:'cell',employeeId:sel.employeeId,day:d};
  state.chartDay=d;state.chartTab='timeline';state.timelineRange=null;
 }else{
  state.selection={type:'date',day:d};state.chartTab='overview';state.chartDay=d;
 }
 state.rawPage=1;render();
}
function selectCell(id,d){
  if(d<1||d>monthDays())return;
  if(state.workspaceMode!=='classic')state.workspaceMode='person';
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


const STATUS_FILTER_ITEMS=[
 ['main','常规','multi'],['normal','正常','normal'],['anomaly','异常','anomaly'],['absent','缺勤','absent'],
 ['lateEarly','迟到早退','late-early'],['trip','出差','trip'],['leave','请假','leave'],['outing','外出','outing'],['overtime','加班','overtime']
];
function statusFilterSwatch(kind){
 if(kind==='multi')return '<span class="status-filter-dots"><i class="normal"></i><i class="anomaly"></i><i class="absent"></i></span>';
 return '<i class="status-filter-dot '+kind+'"></i>';
}
function statusFilterLabel(value){
 const item=STATUS_FILTER_ITEMS.find(x=>x[0]===value)||STATUS_FILTER_ITEMS[0];
 return '<span class="status-filter-current">'+statusFilterSwatch(item[2])+'<b>'+item[1]+'</b></span><i class="chevron"></i>';
}
function statusFilterMenuHtml(){
 return STATUS_FILTER_ITEMS.map(([value,label,kind])=>
  '<button type="button" role="option" data-filter-value="'+value+'">'+statusFilterSwatch(kind)+'<span>'+label+'</span></button>'
 ).join('');
}
