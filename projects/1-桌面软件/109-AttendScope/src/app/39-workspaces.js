/* P109 R37: four workspaces share the existing analyses, model and evidence table.
   No separate data copy or duplicate timeline implementation. */
const WORKSPACE_ITEMS=[
 ['all','全员分析','users'],
 ['group','分组分析','layers'],
 ['person','个人分析','person'],
 ['data','数据管理','database']
];
function workspaceGroups(){
 return [...new Set(EMPLOYEES.map(e=>groupOf(e)))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
}
function workspaceNavHtml(){
 return WORKSPACE_ITEMS.map(([id,label])=>
  '<button type="button" data-workspace="'+id+'" class="'+(state.workspaceMode===id?'active':'')+'" aria-current="'+(state.workspaceMode===id?'page':'false')+'">'+label+'</button>'
 ).join('');
}
function workspaceToolbarHtml(){
 const mode=state.workspaceMode||'all',g=workspaceGroups();
 if(mode==='group'){
  if(!g.includes(state.selectedGroup))state.selectedGroup=g[0]||'未分组';
  return '<div class="workspace-toolbar"><div><strong>分组分析</strong><span>按组查看月度矩阵与异常人员</span></div><label>组别 <select id="workspaceGroup">'+
    g.map(x=>'<option value="'+escapeNameChar(x)+'" '+(x===state.selectedGroup?'selected':'')+'>'+escapeNameChar(x)+'</option>').join('')+'</select></label></div>'+
    '<section id="scopeSummary" class="scope-summary"></section>';
 }
 if(mode==='all')return '<div class="workspace-toolbar"><div><strong>全员分析</strong><span>通过矩阵发现异常，点击员工或日期下钻</span></div><span class="workspace-hint">'+EMPLOYEES.length+' 位人员</span></div>'+
    '<section id="scopeSummary" class="scope-summary"></section>';
 if(mode==='person'){
  const e=(state.selection.type==='person'||state.selection.type==='cell')?state.selection.employeeId:null;
  return '<div class="workspace-toolbar"><div><strong>个人分析</strong><span>保留原有六轨时间轴与原始打卡证据</span></div><label>员工 <select id="workspacePerson">'+
    EMPLOYEES.map(x=>'<option value="'+escapeNameChar(x.id)+'" '+(x.id===e?'selected':'')+'>'+escapeNameChar(x.name)+' · '+escapeNameChar(groupOf(x))+'</option>').join('')+'</select></label></div>';
 }
 if(mode==='data')return '<div class="workspace-toolbar"><div><strong>数据管理</strong><span>导入、人员名册、原始证据及保存状态</span></div><span class="workspace-hint">当前月 '+monthKey()+'</span></div>';
 return '';
}
function bindWorkspaceNavigation(){
 document.querySelectorAll('[data-workspace]').forEach(b=>b.onclick=()=>navigateWorkspace(b.dataset.workspace));
 const g=document.getElementById('workspaceGroup');
 if(g)g.onchange=()=>{state.selectedGroup=g.value;state.selection={type:'overall'};render()};
 const p=document.getElementById('workspacePerson');
 if(p)p.onchange=()=>selectPerson(p.value);
}
function navigateWorkspace(mode){
 if(!WORKSPACE_ITEMS.some(x=>x[0]===mode))return;
 state.workspaceMode=mode;
 if(mode==='all'||mode==='group'||mode==='data'){
  state.selection={type:'overall'};state.chartTab='overview';
 }
 if(mode==='group'&&!workspaceGroups().includes(state.selectedGroup))state.selectedGroup=workspaceGroups()[0]||'未分组';
 if(mode==='person'&&!['person','cell'].includes(state.selection.type)){
  const e=EMPLOYEES[0];
  if(e){state.selection={type:'person',employeeId:e.id};state.chartDay=nearestRecordedDay(e.id)}
  state.chartTab='timeline';state.timelineRange=null;
 }
 render();
}
function scopeAnalysisItems(){
 const people=state.workspaceMode==='group'?EMPLOYEES.filter(e=>groupOf(e)===state.selectedGroup):EMPLOYEES;
 const ids=new Set(people.map(e=>e.id));
 let all=workAnalyses().filter(a=>ids.has(a.employee.id));
 if(state.selection.type==='date')all=all.filter(a=>a.day===state.selection.day);
 return {people,items:all};
}
function renderScopeSummary(){
 const el=document.getElementById('scopeSummary');if(!el)return;
 const {people,items}=scopeAnalysisItems();
 const counts={normal:0,anomaly:0,absent:0};
 for(const a of items){const status=attendanceJudgment(a);if(status in counts)counts[status]++}
 const stats=[
 ['人员',people.length+' 人',''],
 ['正常',counts.normal+' 人日','normal'],
 ['异常',counts.anomaly+' 人日','anomaly'],
 ['缺勤',counts.absent+' 人日','absent']
 ];
 const groupInfo=workspaceGroups().map(group=>{
  const rows=workAnalyses().filter(a=>groupOf(a.employee)===group),issues=rows.filter(a=>['anomaly','absent'].includes(attendanceJudgment(a))).length;
  return {group,people:EMPLOYEES.filter(e=>groupOf(e)===group).length,issues};
 });
 const groupList=state.workspaceMode==='all'?'<div class="scope-group-list"><div class="scope-subheading">组别概览 <small>选择后进入分组分析</small></div><div class="scope-group-links">'+
   groupInfo.map(x=>'<button data-open-group="'+escapeNameChar(x.group)+'"><strong>'+escapeNameChar(x.group)+'</strong><span>'+x.people+' 人 · '+x.issues+' 异常/缺勤人日</span></button>').join('')+'</div></div>':'';
 const attention=items.filter(a=>['anomaly','absent'].includes(attendanceJudgment(a))).slice(0,8);
 el.innerHTML='<div class="scope-stat-row">'+stats.map(([name,value,cls])=>'<div class="scope-stat '+cls+'"><span>'+name+'</span><strong>'+value+'</strong></div>').join('')+'</div>'+
  groupList+'<div class="scope-subheading">月度考勤矩阵 <small>红色缺勤 · 黄色异常 · 绿色正常，点击姓名或单元格查看个人</small></div>'+
  (attention.length?'<div class="scope-attention"><strong>待关注</strong>'+attention.map(a=>
    '<button data-scope-person="'+escapeNameChar(a.employee.id)+'" data-scope-day="'+a.day+'">'+escapeNameChar(a.employee.name)+' · '+pad(a.day)+' 日</button>').join('')+'</div>':'');
 el.querySelectorAll('[data-open-group]').forEach(b=>b.onclick=()=>{
  state.workspaceMode='group';state.selectedGroup=b.dataset.openGroup;state.selection={type:'overall'};render();
 });
 el.querySelectorAll('[data-scope-person]').forEach(b=>b.onclick=()=>selectCell(b.dataset.scopePerson,+b.dataset.scopeDay));
 const details=document.getElementById('scopeDetails');
 if(details){
  const personnel=people.map(e=>{
    const records=workAnalyses().filter(a=>a.employee.id===e.id);
    return {e,normal:records.filter(a=>attendanceJudgment(a)==='normal').length,
      anomaly:records.filter(a=>attendanceJudgment(a)==='anomaly').length,
      absent:records.filter(a=>attendanceJudgment(a)==='absent').length};
  }).sort((a,b)=>(b.anomaly+b.absent)-(a.anomaly+a.absent));
  details.innerHTML='<div class="scope-subheading">组内人员 <small>优先显示需要关注的员工，点击进入个人时间轴</small></div>'+
    '<div class="scope-member-list">'+personnel.map(x=>
      '<button data-member-id="'+escapeNameChar(x.e.id)+'"><strong>'+escapeNameChar(x.e.name)+'</strong>'+
      '<span>正常 '+x.normal+'</span><span class="warn">异常 '+x.anomaly+'</span>'+
      '<span class="danger">缺勤 '+x.absent+'</span><b aria-hidden="true">›</b></button>').join('')+'</div>';
  details.querySelectorAll('[data-member-id]').forEach(b=>b.onclick=()=>selectPerson(b.dataset.memberId));
 }
 const title=document.getElementById('analysisTitle');if(title)title.textContent=state.workspaceMode==='group'?state.selectedGroup+' · 考勤分析':'全员考勤分析';
}
function dataPanelHtml(section){
 if(section==='roster'){
  return '<div class="data-note">员工 ID 是记录关联的唯一键。组别可编辑；对于同名人员，请在正式导入前确认身份。</div>'+
  '<div class="data-roster-table"><div class="data-roster-head"><span>人员 ID</span><span>姓名</span><span>部门</span><span>组别</span><span>操作</span></div>'+
  EMPLOYEES.map(e=>'<div class="data-roster-row"><span>'+escapeNameChar(e.id)+'</span><strong>'+escapeNameChar(e.name)+'</strong>'+
   '<span>'+escapeNameChar(e.department)+'</span><span>'+escapeNameChar(groupOf(e))+'</span>'+
   '<button data-edit-roster-group="'+escapeNameChar(e.id)+'">修改组别</button></div>').join('')+'</div>';
 }
 if(section==='rules'){
  return '<div class="data-note">以下为当前月份使用的规则；修改时将重新计算系统判定，不修改原始打卡。</div>'+
    '<div class="data-rules-grid">'+[
      ['上午时段',RULES.amStart+'–'+RULES.amEnd],
      ['下午时段',RULES.pmStart+'–'+RULES.pmEnd],
      ['迟到宽限',RULES.grace+' 分钟'],
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
    '<span>'+escapeNameChar(x.type||'')+' · '+Number(x.count||0)+' 条</span><small>'+escapeNameChar(x.importedAt||'')+'</small></div>').join('')+
    :'<p>当前月份尚无真实文件导入。演示数据不作为真实导入记录。</p>')+'</div>';
 }
 return '<section class="inspector-bottom" id="rawPane"><div class="raw-toolbar"><strong>原始记录</strong><div class="raw-tabs">'+
   [['attendance','考勤'],['trip','出差'],['leave','请假'],['outing','外出'],['overtime','加班']].map(([id,name])=>'<button data-raw-tab="'+id+'">'+name+'</button>').join('')+
  '</div><span class="raw-count" id="rawRowCount"></span><button class="raw-float-btn" id="rawFloat" title="弹出原始表格">⛶</button></div>'+
  '<div id="rawDataTable" class="raw-table" aria-label="原始表格"></div></section>';
}
function dataWorkspaceHtml(){
 const section=state.dataSection||'records';
 return '<div class="data-management">'+
  '<div class="data-summary">'+
    '<section><span>员工</span><strong>'+EMPLOYEES.length+'</strong></section>'+
    '<section><span>打卡记录</span><strong>'+state.records.length+'</strong></section>'+
    '<section><span>请假 / 出差</span><strong>'+state.leaves.length+' / '+state.trips.length+'</strong></section>'+
    '<section><span>工作目录</span><strong>'+(state.projectDir?'已连接':'未连接')+'</strong></section>'+
  '</div>'+
  '<div class="data-import-actions"><button data-open="attendanceInput">导入考勤</button><button data-open="leaveInput">导入请假</button>'+
  '<button data-open="tripInput">导入出差</button><button id="dataSave">保存工作状态</button><button id="dataFreeze">冻结快照</button></div>'+
  '<div class="data-section-tabs" role="tablist">'+[
    ['records','原始记录'],['roster','员工名册'],['rules','工作规则'],['imports','导入与快照']
   ].map(([id,label])=>'<button type="button" data-data-section="'+id+'" class="'+(id===section?'active':'')+'" role="tab" aria-selected="'+(id===section)+'">'+label+'</button>').join('')+
  '</div><div class="data-section-panel">'+dataPanelHtml(section)+'</div></div>';
}
function renderDataWorkspace(){
 const body=document.getElementById('analysisBody');if(!body)return;
 const heading=document.getElementById('analysisTitle');if(heading)heading.textContent='数据管理 · '+monthKey();
 const tools=document.getElementById('analysisHeadTools');if(tools)tools.textContent='';
 if(typeof disposeRawTable==='function')disposeRawTable();
 body.innerHTML=dataWorkspaceHtml();
 body.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.open).click());
 document.getElementById('dataSave').onclick=saveWorking;
 document.getElementById('dataFreeze').onclick=freezeSnapshot;
 body.querySelectorAll('[data-data-section]').forEach(b=>b.onclick=()=>{
   state.dataSection=b.dataset.dataSection;renderDataWorkspace();
 });
 body.querySelectorAll('[data-edit-roster-group]').forEach(b=>b.onclick=()=>setPersonGroup(b.dataset.editRosterGroup));
 const edit=body.querySelector('#dataEditRules');if(edit)edit.onclick=()=>document.getElementById('settingsBtn').click();
 if((state.dataSection||'records')==='records')mountRawTable({type:'overall',items:workAnalyses()});
}
