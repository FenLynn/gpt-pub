function render(){
  if(typeof r14Prefs==='function')r14Prefs();
  if(!state.analysisTab) state.analysisTab='overview';
  if(typeof disposeAttendCharts==='function')disposeAttendCharts();
  document.getElementById('app').innerHTML=layoutHtml();
  document.documentElement.style.setProperty('--ui-scale',String(state.prefs?.fontScale||1));
  document.documentElement.classList.toggle('reduce-animations',state.prefs?.motion===false);
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
    <div class="month-actions">
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
      <button class="text-btn" id="connectDir">目录</button>
      <button class="text-btn" id="saveBtn">保存</button>
      <button class="primary-btn" id="freezeBtn">冻结</button>
    </div>
    <div class="top-actions">
      <button class="text-btn" id="exportTable">导出表格</button>
      <button class="text-btn" id="printReport">PDF</button>
      <span class="action-divider"></span>
      <button class="settings-toggle" id="settingsBtn" title="设置" aria-label="设置">⚙</button>
    </div>
  </header>

  <div class="layout">
    <aside class="sidebar">
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
        <div class="meta-row"><span>工作</span><b>08:30–12:00</b></div>
        <div class="meta-row"><span>下午</span><b>14:00–17:30</b></div>
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
            <option value="overtime">加班</option>
            <option value="leave">请假</option>
            <option value="trip">出差</option>
            <option value="outing">外出</option>
          </select>
        </div>
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

  ${r14SettingsMarkup()}
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

  const filter=document.getElementById('statusFilter');
  const filterButton=document.getElementById('statusFilterButton');
  const filterMenu=document.getElementById('statusFilterMenu');
  filter.value=state.filter;
  const syncFilterButton=()=>{filterButton.innerHTML=statusFilterLabel(state.filter)};
  filter.onchange=()=>{
    state.filter=filter.value;updateMatrixFilter();syncFilterButton();
    filterMenu.classList.remove('open');filterButton.setAttribute('aria-expanded','false');
  };
  filterButton.onclick=e=>{
    e.stopPropagation();filterMenu.classList.toggle('open');
    filterButton.setAttribute('aria-expanded',String(filterMenu.classList.contains('open')));
  };
  filterMenu.querySelectorAll('[data-filter-value]').forEach(button=>button.onclick=e=>{
    e.stopPropagation();filter.value=button.dataset.filterValue;filter.dispatchEvent(new Event('change'));
  });
  bindSettings();

  document.getElementById('clearSelection').onclick=()=>{state.selection={type:'overall'};state.chartTab='overview';render()};
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
  document.getElementById('resetDemo').onclick=()=>{
    if(YEAR!==2026||MONTH!==10){toast('演示数据仅用于 2026 年 10 月',true);return}
    Object.assign(state,generateMock()); state.selection={type:'overall'}; state.filter='main'; state.chartTab='overview';
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
    el.insertAdjacentHTML('beforeend',`<button class="cal-day ${type}${sel}" data-day="${d}" title="${dayTypeText(type)}"><span>${d}</span></button>`);
  }
  el.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>selectDate(+b.dataset.day));
}

function matrixVisible(a){
 const judgment=attendanceJudgment(a);
 return state.filter==='main'?['normal','anomaly','absent'].includes(judgment):
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
  // Matrix dimensions are shared CSS variables, including responsive sizing.
  el.style.gridTemplateColumns='var(--matrix-name) repeat(31,var(--matrix-cell))';

  let html='<button class="m-corner" id="matrixAll" title="清除选择，查看全员月度数据">全部</button>';
  for(let d=1;d<=31;d++){
    const invalid=d>monthDays();
    const type=dayType(d),sel=(state.selection.type==='date'||state.selection.type==='cell')&&state.selection.day===d?' selected':'';
    html+=`<button class="m-date ${type}${sel}" data-date="${d}" ${invalid?'disabled':''} title="${invalid?'无此日期':isoDate(d)+' · '+dayTypeText(type)}"><b>${invalid?'':pad(d)}</b></button>`;
  }

  for(const e of EMPLOYEES){
    const rowSelected=(state.selection.type==='person'||state.selection.type==='cell')&&state.selection.employeeId===e.id;
    const letters=Array.from(e.name).slice(0,4).map(ch=>`<span>${escapeNameChar(ch)}</span>`).join('');
    html+=`<button class="m-name ${rowSelected?'selected':''} ${Number(e.id.slice(1))%2?'':'row-alt'}" data-emp="${e.id}" title="${e.name} · ${e.department}"><span class="m-name-num">${String(EMPLOYEES.indexOf(e)+1).padStart(2,'0')}</span><span class="name-letters">${letters}</span></button>`;
    for(let d=1;d<=31;d++){
      if(d>monthDays()){html+='<div class="m-cell inactive"></div>';continue}
      const a=state.analysis.get(`${e.id}|${d}`),visible=matrixVisible(a);
      const selected=state.selection.type==='cell'&&state.selection.employeeId===e.id&&state.selection.day===d;
      const colSelected=(state.selection.type==='date'||state.selection.type==='cell')&&state.selection.day===d;
      const category=matrixCategory(a),cls='s-'+category,behaviors=attendanceBehaviors(a);
      html+=`<div class="m-cell ${rowSelected?'row-focus':''} ${colSelected?'col-focus':''} ${selected?'cell-focus':''} ${Number(e.id.slice(1))%2?'':'row-alt'} day-${dayType(d)}" data-emp="${e.id}" data-day="${d}">
        <button class="${cls} ${visible||selected?'':'filtered-out'} ${selected?'selected':''}" style="--status-color:${categoryColor(category)}" data-cell="${e.id}|${d}" title="${e.name} · ${isoDate(d)}\n判断：${a.status} · 行为：${behaviors.join(' / ')||'无'}\n首进 ${a.firstIn||'—'} · 末出 ${a.lastOut||'—'}">${behaviors.length?`<i class="corner-mark behavior-${behaviors[0]}"></i>`:''}</button>
      </div>`;
    }
  }
  const selectedRow=(state.selection.type==='person'||state.selection.type==='cell')
    ?EMPLOYEES.findIndex(e=>e.id===state.selection.employeeId):-1;
  const selectedCol=(state.selection.type==='date'||state.selection.type==='cell')
    ?state.selection.day-1:-1;
  html+='<div class="matrix-selection-frame focus-row '+(selectedRow<0?'inactive':'')+
    ' '+(state.selection.type==='cell'?'soft':'')+'" style="--focus-row:'+Math.max(0,selectedRow)+'"></div>';
  html+='<div class="matrix-selection-frame focus-col '+(selectedCol<0?'inactive':'')+
    ' '+(state.selection.type==='cell'?'soft':'')+'" style="--focus-col:'+Math.max(0,selectedCol)+'"></div>';
  html+='<div class="matrix-preview-frame focus-row inactive"></div><div class="matrix-preview-frame focus-col inactive"></div>';
  el.innerHTML=html;
  el.classList.toggle('behavior-view',['trip','leave','outing','overtime'].includes(state.filter));
  document.getElementById('matrixAll').onclick=()=>{state.selection={type:'overall'};state.chartTab='overview';render()};
  el.querySelectorAll('.m-name[data-emp]').forEach(b=>b.onclick=()=>selectPerson(b.dataset.emp));
  el.querySelectorAll('[data-date]').forEach(b=>b.onclick=()=>selectDate(+b.dataset.date,true));
  el.querySelectorAll('[data-cell]').forEach(b=>b.onclick=()=>{const [id,d]=b.dataset.cell.split('|');selectCell(id,+d)});
  const hoverRow=el.querySelector('.matrix-preview-frame.focus-row');
  const hoverCol=el.querySelector('.matrix-preview-frame.focus-col');
  const clearHover=()=>{hoverRow?.classList.add('inactive');hoverCol?.classList.add('inactive')};
  el.onpointerover=e=>{
    const n=e.target.closest('[data-cell],.m-name[data-emp],.m-date[data-date]');if(!n){clearHover();return}
    const id=n.dataset.cell?.split('|')[0]||n.dataset.emp||'';
    const d=Number(n.dataset.date||n.dataset.cell?.split('|')[1]||0);
    const ix=EMPLOYEES.findIndex(emp=>emp.id===id);
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
function selectDate(d,allPeople=false){
 if(d<1||d>monthDays())return;
 const sel=state.selection;
 if(!allPeople&&(sel.type==='person'||sel.type==='cell')){
  state.selection={type:'cell',employeeId:sel.employeeId,day:d};
  state.chartDay=d;state.chartTab='timeline';state.timelineRange=null;
 }else{
  state.selection={type:'date',day:d};state.chartTab='overview';state.chartDay=d;
 }
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


const STATUS_FILTER_ITEMS=[
 ['main','常规','multi'],['normal','正常','normal'],['anomaly','异常','anomaly'],['absent','缺勤','absent'],
 ['trip','出差','trip'],['leave','请假','leave'],['outing','外出','outing'],['overtime','加班','overtime']
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
