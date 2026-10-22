/* P109 R37: four workspaces share the existing analyses, model and evidence table.
   No separate data copy or duplicate timeline implementation. */
const WORKSPACE_ITEMS=[
 ['all','全员分析','users'],
 ['group','分组分析','layers'],
 ['person','个人分析','person'],
 ['stats','统计分析','chart'],
 ['data','数据管理','database']
];
function workspaceGroups(){
 return [...new Set([...(state.groupCatalog||[]),...EMPLOYEES.map(e=>groupOf(e))])].sort((a,b)=>a.localeCompare(b,'zh-CN'));
}
function workspaceNavHtml(){
 return WORKSPACE_ITEMS.map(([id,label])=>
  '<button type="button" data-workspace="'+id+'" class="'+(state.workspaceMode===id?'active':'')+'" aria-current="'+(state.workspaceMode===id?'page':'false')+'">'+label+'</button>'
 ).join('');
}

/* Modern pages reuse one data model and route page-scoped controls into the sidebar. */
function scopeVisibleEmployees(){
 const query=String(state.scopeSearch||'').trim().toLocaleLowerCase();
 let people=state.workspaceMode==='group'?EMPLOYEES.filter(e=>groupOf(e)===state.selectedGroup):EMPLOYEES;
 if(query)people=people.filter(e=>(e.name+' '+e.id+' '+e.department+' '+groupOf(e)).toLocaleLowerCase().includes(query));
 if(state.attentionOnly)people=people.filter(e=>[...state.analysis.values()].some(a=>a.employee.id===e.id&&isWorkday(a.day)&&['anomaly','absent'].includes(attendanceJudgment(a))));
 return people;
}
function sidebarFilterHtml(){
 const options=[['main','常规'],['normal','正常'],['anomaly','异常'],['absent','缺勤'],['lateEarly','迟到早退'],['overtime','加班'],['leave','请假'],['trip','出差'],['outing','外出']];
 return '<section class="side-filter state-select-wrap"><label class="side-label" for="statusFilter">状态筛选</label>'+
  '<div class="status-filter-control"><button type="button" id="statusFilterButton" class="status-filter-button" aria-expanded="false">'+statusFilterLabel(state.filter)+'</button>'+
  '<div id="statusFilterMenu" class="status-filter-menu" role="listbox">'+statusFilterMenuHtml()+'</div>'+
  '<select id="statusFilter" class="status-filter-native" aria-label="状态筛选">'+
  options.map(([v,l])=>'<option value="'+v+'">'+l+'</option>').join('')+'</select></div>'+
  '<div class="side-label">判定视图</div><div class="judgment-mode-switch" id="judgmentModeSwitch" aria-label="判断显示模式">'+
  '<button type="button" data-judgment-mode="initial" class="'+(state.judgmentMode!=='manual'?'active':'')+'">初始</button>'+
  '<button type="button" data-judgment-mode="manual" class="'+(state.judgmentMode==='manual'?'active':'')+'" '+(hasManualStatuses()?'':'disabled')+'>人工</button></div></section>';
}

/* Shared month-strip palette: work/rest/holiday use exactly the calendar dayType;
   status and manual override are sourced from the common analyzed facts. */
function personMonthStripHtml(){
 const id=state.selection.employeeId||EMPLOYEES[0]?.id;
 if(!id)return '';
 const inDayDetail=state.selection.type==='cell';
 const selected=inDayDetail?(state.chartDay||state.selection.day||1):null;
 const days=Array.from({length:monthDays()},(_,i)=>{
  const day=i+1,info=state.analysis.get(id+'|'+day),type=dayType(day);
  const rawManual=info?manualStatusFor(info):null;
  const final=rawManual||attendanceJudgmentSystem(info);
  const tone=final==='normal'?'normal':final==='anomaly'?'anomaly':final==='absent'?'absent':'rest';
  const autoSegments=info?.autoOvertime?.segments||[];
  const included=autoSegments.filter(seg=>seg.accepted!==false).length;
  const hasAuto=autoSegments.length>0||(info?.overtime?.length||0)>0,hasLateEarly=attendanceHasLateEarly(info);
  const flagText=hasLateEarly?info.attendanceFlags.map(f=>f.label+' '+f.time).join('、'):'';
  const adjusted=rawManual&&rawManual!==attendanceJudgmentSystem(info);
  const title=isoDate(day)+' · '+dayTypeText(type)+' · '+({normal:'正常',anomaly:'异常',absent:'缺勤',rest:'休息'}[final]||final)+
   (flagText?' · 系统检测：'+flagText:'')+(adjusted?' · 人工已调整判定（系统检测证据保留）':'')+
   (autoSegments.length?' · 自动加班候选 '+autoSegments.length+' 段（纳入 '+included+' 段、排除 '+(autoSegments.length-included)+' 段）':'')+
   (info?.overtime?.length?' · 登记加班 '+info.overtime.length+' 项':'');
  return '<button type="button" class="person-day '+type+' '+(selected===day?'selected':'')+
    (hasAuto?' has-auto-overtime':'')+(hasLateEarly?' has-late-early':'')+
    '" data-person-day="'+day+'" title="'+escapeNameChar(title)+'" aria-current="'+(selected===day?'date':'false')+'">'+
    '<span class="person-day-number">'+pad(day)+'</span>'+
    (rawManual?'<span class="person-day-check" aria-label="人工修正">✓</span>':'')+
    '<span class="person-day-status '+tone+'"></span></button>';
 }).join('');
 const switcher=inDayDetail?('<div class="person-day-nav" aria-label="日期切换">'+
  '<button id="personalDayPrev" type="button" aria-label="上一天" '+(selected<=1?'disabled':'')+'>‹</button>'+
  '<select id="timelineDayPicker" aria-label="时间轴日期">'+
   Array.from({length:monthDays()},(_,i)=>'<option value="'+(i+1)+'" '+(selected===i+1?'selected':'')+'>'+pad(i+1)+' 日</option>').join('')+
  '</select><button id="personalDayNext" type="button" aria-label="下一天" '+(selected>=monthDays()?'disabled':'')+'>›</button></div>') : '';
 return '<div class="person-strip" aria-label="个人整月考勤">'+
  '<div class="person-days" style="--r40-days:'+monthDays()+'">'+days+'</div>'+switcher+'</div>';
}
function workspaceSidebarHtml(){
 const mode=state.workspaceMode||'all',groups=workspaceGroups();
 if(mode==='stats')return '<div class="side-controls stats-side-controls" id="statsSidebarControls">'+
  statisticsSidebarControlsHtml()+
  '</div><div class="side-bottom"><section class="side-calendar calendar-section">'+
  '<div class="calendar-caption"><span>月历</span><button class="quiet-link" id="clearSelection">全部</button></div>'+
  '<div id="calendar" class="calendar-grid"></div>'+
  '<div class="calendar-key"><span><i class="work"></i>工作日</span>'+
  '<span><i class="rest"></i>休息日</span><span><i class="adjust"></i>调休上班</span></div></section>'+
  '<div class="side-hidden-filters">'+sidebarFilterHtml()+'</div></div>';
 const group=mode==='group'?state.selectedGroup:mode==='person'?groupOf(EMPLOYEES.find(e=>e.id===state.selection.employeeId)||EMPLOYEES[0]):'';
 const candidates=mode==='group'?EMPLOYEES.filter(e=>groupOf(e)===state.selectedGroup):
   mode==='person'?EMPLOYEES.filter(e=>groupOf(e)===group):EMPLOYEES;
 const groupControl=mode==='data'||mode==='project'?'':'<div class="side-inline"><label for="'+
  (mode==='all'?'workspaceScopeGroup':mode==='group'?'workspaceGroup':'workspacePersonGroup')+'">组别</label>'+
  '<select class="side-select" id="'+(mode==='all'?'workspaceScopeGroup':mode==='group'?'workspaceGroup':'workspacePersonGroup')+'">'+
  (mode==='all'||mode==='group'?'<option value="">全部</option>':'')+
  groups.map(g=>'<option value="'+escapeNameChar(g)+'" '+(g===group?'selected':'')+'>'+escapeNameChar(g)+'</option>').join('')+'</select></div>';
 const personControl=mode==='data'||mode==='project'?'':'<div class="side-inline"><label for="workspacePerson">人员</label>'+
  '<select class="side-select" id="workspacePerson">'+(mode==='person'?'':'<option value="">全部</option>')+
  candidates.map(e=>'<option value="'+escapeNameChar(e.id)+'" '+(e.id===state.selection.employeeId?'selected':'')+'>'+
    escapeNameChar(e.name)+'</option>').join('')+'</select></div>';
 // Statistical metrics live in one top-level workspace, not three sidebar clones.
 const sub=mode==='data'?'<div class="side-subnav r69-data-nav">'+
  '<div class="r69-nav-category">项目状态</div>'+
  [['overview','项目概况'],['months','月份库存'],['health','健康检测'],['storage','存储与文件']].map(([id,name])=>
   '<button type="button" data-data-section="'+id+'" class="'+((state.dataSection||'records')===id?'active':'')+'">'+name+'</button>').join('')+
  '<div class="r69-nav-category">数据维护</div>'+
  [['roster','名册与分组'],['rules','工作规则'],['templates','导入模板'],['records','原始记录'],['imports','导入历史'],['freezes','冻结与修订']].map(([id,name])=>
   '<button type="button" data-data-section="'+id+'" class="'+((state.dataSection||'records')===id?'active':'')+'">'+name+'</button>').join('')+
  '</div>':'';
 return '<div class="side-controls">'+groupControl+personControl+sub+'</div>'+
   '<div class="side-bottom"><section class="side-calendar calendar-section">'+
  '<div class="calendar-caption"><span>月历</span><button class="quiet-link" id="clearSelection">全部</button></div>'+
  '<div id="calendar" class="calendar-grid"></div><div class="calendar-key"><span><i class="work"></i>工作日</span>'+
  '<span><i class="rest"></i>休息日</span><span><i class="adjust"></i>调休上班</span></div></section>'+
  (mode==='data'||mode==='project'?'<div class="side-hidden-filters">'+sidebarFilterHtml()+'</div>':
   '<div class="side-refinements">'+sidebarFilterHtml()+'</div>')+'</div>';
}
function workspaceToolbarHtml(){
 const mode=state.workspaceMode||'all';
 if(mode==='all'||mode==='group')return '<div class="workspace-toolbar"><div><strong>'+(mode==='all'?'全员考勤':'分组考勤')+'</strong>'+
  '<span>'+periodText()+' · '+(mode==='group'?escapeNameChar(state.selectedGroup||'未分组'):'全部员工')+'</span></div>'+
  '</div><section id="scopeSummary" class="scope-summary"></section>';
 if(mode==='person')return '<div class="workspace-toolbar person-toolbar">'+
  (state.selection.type==='cell'?'<button type="button" id="personOverviewButton" class="person-overview-button" title="返回该人员的月度全览" aria-label="返回个人全览">‹ 个人全览</button>':'<strong>个人分析</strong>')+
  personMonthStripHtml()+'</div>';
 if(mode==='data')return '';

 return '';
}
function bindWorkspaceNavigation(){
 document.querySelectorAll('[data-workspace]').forEach(b=>b.onclick=()=>navigateWorkspace(b.dataset.workspace));
 document.querySelectorAll('[data-as-view]').forEach(b=>b.onclick=()=>{
   const next=b.dataset.asView;
   if(state.analyticsPage===next)return;
   state.analyticsPage=next;
   render();
 });
 document.querySelectorAll('[data-person-day]').forEach(b=>b.onclick=()=>changePersonalDay(b.dataset.personDay));
 const overviewButton=document.getElementById('personOverviewButton');
 if(overviewButton)overviewButton.onclick=returnPersonalOverview;
 const scope=document.getElementById('workspaceScopeGroup');
 if(scope)scope.onchange=()=>{if(scope.value){state.workspaceMode='group';state.selectedGroup=scope.value;state.scopeSearch='';state.attentionOnly=false;render()}};
 const g=document.getElementById('workspaceGroup');
 if(g)g.onchange=()=>{if(!g.value){navigateWorkspace('all');return}state.selectedGroup=g.value;state.selection={type:'overall'};render()};
 const person=document.getElementById('workspacePerson');
 if(person)person.onchange=()=>{
   if(!person.value){if(state.workspaceMode==='person')return;state.selection={type:'overall'};render();return}
   if(state.workspaceMode==='person')selectPerson(person.value);
   else selectMatrixRow(person.value);
 };
 const pg=document.getElementById('workspacePersonGroup');
 if(pg)pg.onchange=()=>{
   const member=EMPLOYEES.find(e=>groupOf(e)===pg.value);
   if(member)selectPerson(member.id);
 };
 const search=document.getElementById('workspaceSearch');
 if(search)search.oninput=()=>{state.scopeSearch=search.value;renderMatrix();renderScopeSummary()};
 const attention=document.getElementById('scopeAttentionToggle');
 if(attention)attention.onclick=()=>{state.attentionOnly=!state.attentionOnly;render()};
 document.querySelectorAll('[data-sidebar-chart]').forEach(b=>b.onclick=()=>{
  state.chartTab=b.dataset.sidebarChart;
  document.querySelectorAll('[data-sidebar-chart]').forEach(x=>x.classList.toggle('active',x.dataset.sidebarChart===state.chartTab));
  asNavTrack();asNavUpdateButtons();
  renderAnalysisPanel();
 });
 document.querySelectorAll('.side-controls [data-data-section]').forEach(b=>b.onclick=()=>{
  state.dataSection=b.dataset.dataSection;
  asNavTrack();asNavUpdateButtons();
  document.querySelectorAll('.side-controls [data-data-section]').forEach(x=>x.classList.toggle('active',x.dataset.dataSection===state.dataSection));
  renderDataWorkspace();
 });
}
function returnPersonalOverview(){
 if(state.workspaceMode!=='person')return;
 const employeeId=state.selection.employeeId||EMPLOYEES[0]?.id;
 if(!employeeId)return;
 state.selection={type:'person',employeeId};
 state.chartDay=null;state.chartTab='overview';state.timelineRange=null;state.rawPage=1;state.analyticsPage='main';
 render();
}
function navigateWorkspace(mode){
 if(!WORKSPACE_ITEMS.some(x=>x[0]===mode))return;
 state.workspaceMode=mode;state.scopeSearch='';state.attentionOnly=false;
 state.analyticsPage=mode==='stats'?'stats':'main';
 if(mode==='stats'){
  state.statsScope=state.statsScope||'all';
  if(typeof asStatPrefs==='function')asStatPrefs();
  render();return;
 }
 if(state.statsConfig)state.statsConfig.compare=asStatDefaultCompare(mode);
 if(mode==='all'||mode==='group'||mode==='data'){state.selection={type:'overall'};state.chartTab='overview'}
 if(mode==='group'&&!workspaceGroups().includes(state.selectedGroup))state.selectedGroup=workspaceGroups()[0]||'未分组';
 if(mode==='person'){
  // Primary navigation opens the whole month's overview; date/cell clicks drill down.
  const id=EMPLOYEES.find(e=>e.id===state.selection.employeeId)?.id||EMPLOYEES[0]?.id;
  state.selection=id?{type:'person',employeeId:id}:{type:'overall'};
  state.chartDay=null;state.chartTab='overview';state.timelineRange=null;state.rawPage=1;
 }
 render();
}
function scopeAnalysisItems(){
 const people=scopeVisibleEmployees(),ids=new Set(people.map(e=>e.id));
 let items=workAnalyses().filter(a=>ids.has(a.employee.id));
 // Selecting a matrix date highlights the column; monthly charts stay monthly.
 return {people,items};
}
function renderScopeSummary(){
 const target=document.getElementById('scopeSummary');if(!target)return;
 if(typeof disposeAttendCharts==='function')disposeAttendCharts();
 const {people,items}=scopeAnalysisItems();
 const hint=document.querySelector('.workspace-toolbar .workspace-hint');if(hint)hint.textContent=people.length+' 人';
 target.innerHTML=''; // The monthly grid is the main visual: all metrics live in the right pane.
 const insight=document.getElementById('scopeInsights');if(!insight)return;
 const work=items.filter(a=>isWorkday(a.day));
 const counts={normal:0,anomaly:0,absent:0};
 work.forEach(a=>{const stateKey=attendanceJudgment(a);if(stateKey in counts)counts[stateKey]++});
 const total=counts.normal+counts.anomaly+counts.absent;
 const issue=counts.anomaly+counts.absent;
 insight.innerHTML='<div class="scope-insight-title">统计概况</div>'+
  '<div class="scope-insight-numbers">'+
  '<div><span>人数</span><strong>'+people.length+'</strong></div>'+
  '<div><span>正常</span><strong class="normal">'+counts.normal+'</strong></div>'+
  '<div><span>异常</span><strong class="anomaly">'+counts.anomaly+'</strong></div>'+
  '<div><span>缺勤</span><strong class="absent">'+counts.absent+'</strong></div></div>'+
  '<div class="scope-insight-rate">异常及缺勤 '+(total?(issue/total*100).toFixed(1):'0.0')+'% <small>工作人日</small></div>'+
  '<div class="scope-insight-chart-title">每日异常趋势</div><div id="scopeDailyChart" class="scope-chart"></div>'+
  '<div class="scope-insight-chart-title">'+(state.workspaceMode==='group'?'组内人员':'组别比较')+'</div>'+
  '<div id="scopeCompareChart" class="scope-chart"></div>'+ 
  '<div class="scope-insight-chart-title">状态构成</div><div id="scopeStatusChart" class="scope-chart scope-chart-composition"></div>';
 mountScopeAnalytics(people,work);
}
/* R54: quiet Apple/Material-inspired indigo-blue on neutral surfaces.
 * Gradient is intentionally subtle; only the active mark gets strong contrast. */
function asSoftBarGradient(horizontal=true){
 const stops=horizontal?[
  {offset:0,color:'rgba(191,211,243,.82)'},
  {offset:.54,color:'rgba(143,180,235,.83)'},
  {offset:1,color:'rgba(107,153,221,.90)'}
 ]:[
  {offset:0,color:'rgba(108,155,224,.90)'},
  {offset:.54,color:'rgba(150,186,237,.84)'},
  {offset:1,color:'rgba(192,213,245,.78)'}
 ];
 return new echarts.graphic.LinearGradient(0,0,horizontal?1:0,horizontal?0:1,stops);
}
function mountScopeAnalytics(people,work){
 if(!window.echarts)return;
 const byDay=Array.from({length:monthDays()},(_,i)=>i+1).filter(d=>isWorkday(d));
 const daily=byDay.map(d=>work.filter(a=>a.day===d&&['anomaly','absent'].includes(attendanceJudgment(a))).length);
 const first=initAttendChart(document.getElementById('scopeDailyChart'));
 if(first){
  first.setOption({animation:false,grid:{left:29,right:10,top:12,bottom:26},
   tooltip:{trigger:'axis'},xAxis:{type:'category',data:byDay.map(d=>pad(d)),axisTick:{show:false},
      axisLabel:{color:'#788c9d',fontSize:11,interval:Math.max(0,Math.floor(byDay.length/9))}},
   yAxis:{type:'value',minInterval:1,splitLine:{lineStyle:{color:'#ecf0f3'}},axisLabel:{fontSize:11,color:'#8699a7'}},
   series:[{name:'异常/缺勤',type:'line',data:daily,symbolSize:5,smooth:false,
     lineStyle:{color:'#648d7e',width:2},itemStyle:{color:'#648d7e'},
     areaStyle:{color:'rgba(104,155,134,.075)'}}]});
  first.on('click',event=>{const day=byDay[event.dataIndex];if(day)selectDate(day,true)});
 }
 const all=state.workspaceMode!=='group';
 const categories=all?workspaceGroups():people.map(e=>e.name);
 const values=categories.map((name)=>{
  const ids=new Set(people.filter(e=>(all?groupOf(e):e.name)===name).map(e=>e.id));
  return work.filter(a=>ids.has(a.employee.id)&&['anomaly','absent'].includes(attendanceJudgment(a))).length;
 });
 const entries=categories.map((name,i)=>({name,value:values[i]})).sort((a,b)=>b.value-a.value).slice(0,8).reverse();
 const composition=initAttendChart(document.getElementById('scopeStatusChart'));
 if(composition){
  const items=[
   {name:'正常',value:work.filter(a=>attendanceJudgment(a)==='normal').length,itemStyle:{color:'#76c49c'}},
   {name:'异常',value:work.filter(a=>attendanceJudgment(a)==='anomaly').length,itemStyle:{color:'#dfbe72'}},
   {name:'缺勤',value:work.filter(a=>attendanceJudgment(a)==='absent').length,itemStyle:{color:'#db9395'}}
  ].filter(x=>x.value);
  composition.setOption({animation:false,tooltip:{trigger:'item',formatter:'{b}: {c} 人日 ({d}%)'},
   legend:{orient:'vertical',right:14,top:'middle',textStyle:{fontSize:12,color:'#647b8b'},itemWidth:10,itemHeight:10},
   series:[{type:'pie',radius:['48%','72%'],center:['34%','51%'],label:{show:false},itemStyle:{borderRadius:2,borderColor:'#fff',borderWidth:2},data:items}]});
 }
 const second=initAttendChart(document.getElementById('scopeCompareChart'));
 if(second){
  second.setOption({animation:false,grid:{left:65,right:15,top:8,bottom:16,containLabel:false},
   tooltip:{trigger:'item',formatter:p=>escapeNameChar(p.name)+' · '+p.value+' 人日'},
   xAxis:{type:'value',show:false},yAxis:{type:'category',data:entries.map(x=>x.name),
     axisLine:{show:false},axisTick:{show:false},axisLabel:{color:'#536e82',fontSize:11,overflow:'truncate',width:59}},
   series:[{type:'bar',data:entries.map(x=>x.value),barWidth:11,
     itemStyle:{color:asSoftBarGradient(true),opacity:.9,borderRadius:[0,6,6,0]},
     showBackground:true,backgroundStyle:{color:'rgba(107,149,130,.06)'}}]});
 }
}
function dataPanelHtml(section){
 if(section==='roster'){
  return '<div class="data-note">以姓名作为唯一身份；不同闸机记录按姓名归并，组别仍可编辑。</div>'+
  '<div class="data-roster-table"><div class="data-roster-head"><span>姓名</span><span>部门</span><span>组别</span><span>操作</span></div>'+
  EMPLOYEES.map(e=>'<div class="data-roster-row"><strong>'+escapeNameChar(e.name)+'</strong>'+
   '<span>'+escapeNameChar(e.department)+'</span><span>'+escapeNameChar(groupOf(e))+'</span>'+
   '<button data-edit-roster-group="'+escapeNameChar(e.id)+'">修改组别</button></div>').join('')+'</div>';
 }
 if(section==='rules'){
  return '<div class="data-note">以下为当前月份使用的规则；修改时将重新计算系统判定，不修改原始打卡。</div>'+
    '<div class="data-rules-grid">'+[
      ['上午时段',RULES.amStart+'–'+RULES.amEnd],
      ['下午时段',RULES.pmStart+'–'+RULES.pmEnd],
      ['上午上班冗余',RULES.graceAmStart+' 分钟'],
      ['上午下班冗余',RULES.graceAmEnd+' 分钟'],
      ['下午上班冗余',RULES.gracePmStart+' 分钟'],
      ['下午下班冗余',RULES.gracePmEnd+' 分钟'],
      ['重复打卡',RULES.dupSeconds+' 秒'],
      ['日历调整',Object.keys(state.calendarOverrides||{}).filter(k=>k.startsWith(monthKey()+'-')).length+' 天'],
      ['人工判定',Object.keys(state.manualStatuses||{}).length+' 个']
    ].map(([label,value])=>'<div><span>'+label+'</span><strong>'+escapeNameChar(value)+'</strong></div>').join('')+
    '</div><button class="data-rule-edit" id="dataEditRules">在设置中修改班次与规则</button>';
 }
 if(section==='imports'){
  const imports=state.imports||[];
  return '<div class="data-note">原始导入文件与本月工作状态分开保存。冻结快照用于保留当时的完整工作副本。</div>'+
   '<div class="data-import-history"><div class="scope-subheading">本月导入记录 <small>'+imports.length+' 份</small></div>'+
   (imports.length?imports.map(x=>'<div class="data-import-item"><strong>'+escapeNameChar(x.name||'未命名')+'</strong>'+
    '<span>'+escapeNameChar(x.type||'')+' · '+Number(x.count||0)+' 条</span><small>'+escapeNameChar(x.importedAt||'')+'</small></div>').join('')
    :'<p>当前月份尚无真实文件导入。演示数据不作为真实导入记录。</p>')+'</div>';
 }
 return '<section class="inspector-bottom" id="rawPane"><div class="raw-toolbar"><strong>原始记录</strong><div class="raw-tabs">'+
   [['attendance','考勤'],['trip','出差'],['leave','请假'],['outing','外出'],['overtime','加班']].map(([id,name])=>'<button data-raw-tab="'+id+'">'+name+'</button>').join('')+
  '</div><span class="raw-count" id="rawRowCount"></span><button class="raw-float-btn" id="rawFloat" title="弹出原始表格">⛶</button></div>'+
  '<div id="rawDataTable" class="raw-table" aria-label="原始表格"></div></section>';
}
function dataWorkspaceHtml(){
 const section=state.dataSection||'records';
 return '<div class="data-management"><div class="data-stat-inline">'+
  '<span>人员 <strong>'+EMPLOYEES.length+'</strong></span><span>打卡 <strong>'+state.records.length.toLocaleString()+'</strong></span>'+
  '<span>请假 <strong>'+state.leaves.length+'</strong></span><span>出差 <strong>'+state.trips.length+'</strong></span>'+
  '<span class="data-dir-state">'+(state.selection.type==='date'?'仅显示 '+isoDate(state.selection.day)+' · ':'')+(state.projectDir?'已连接本地目录':'本地目录未连接')+'</span></div>'+
  '<div class="data-section-panel">'+dataPanelHtml(section)+'</div></div>';
}
function renderDataWorkspace(){
 const body=document.getElementById('analysisBody');if(!body)return;
 const heading=document.getElementById('analysisTitle');if(heading)heading.textContent='数据管理 · '+monthKey();
 const tools=document.getElementById('analysisHeadTools');if(tools)tools.textContent='';
 if(typeof disposeRawTable==='function')disposeRawTable();
 body.innerHTML=dataWorkspaceHtml();
 body.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.open).click());
 body.querySelectorAll('[data-edit-roster-group]').forEach(b=>b.onclick=()=>setPersonGroup(b.dataset.editRosterGroup));
 const edit=body.querySelector('#dataEditRules');if(edit)edit.onclick=()=>document.getElementById('settingsBtn').click();
 if((state.dataSection||'records')==='records')mountRawTable(state.selection.type==='date'?{type:'date',day:state.selection.day,items:[]}: {type:'overall',items:workAnalyses()});
}
