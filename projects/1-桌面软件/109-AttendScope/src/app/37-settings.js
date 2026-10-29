/* P109 R14 settings workspace: sections and persistable presentation. */
const R14_SETTING_SECTIONS=[
 ['appearance','外观','字体、界面密度与动效'],
 ['matrix','矩阵','选中效果与工作日区分'],
 ['timeline','时间轴','轨道、事件与缩放'],
 ['table','原始表格','可见列与宽度'],
 ['rules','考勤规则','上下班时间与容差'],
 ['data','数据与模拟','数据隔离及生成说明'],
 ['advanced','高级','离线行为与版本信息']
];
const R14_TABLE_FIELDS={
 attendance:[['name','姓名'],['datetime','打卡时间'],['direction','进出'],['source','来源文件'],['sheet','工作表'],['row','行号'],['recordId','记录 ID']],
 trip:[['name','姓名'],['startDate','起始日期'],['endDate','结束日期'],['type','类型'],['place','地点'],['note','备注'],['source','来源文件'],['row','行号']],
 leave:[['name','姓名'],['date','日期'],['start','开始'],['end','结束'],['type','假别'],['note','备注'],['source','来源文件'],['row','行号']],
 outing:[['name','姓名'],['startDate','开始日期'],['endDate','结束日期'],['start','开始时间'],['end','结束时间'],['type','事项'],['note','备注'],['source','来源文件']],
 overtime:[['name','姓名'],['date','日期'],['start','开始时间'],['end','结束时间'],['type','事项'],['note','备注'],['source','来源文件']]
};
function r14Prefs(){
  const p=state.prefs||{};
  if(!p.tableColumns)p.tableColumns={};
  if(!p.timelineTracks)p.timelineTracks={rules:true,actual:true,leave:true,trip:true,outing:true,overtime:true,events:true};
  if(!p.matrix)p.matrix={ids:true,crosshair:true,glow:1,restContrast:1,showManualCheck:true};
  if(p.matrix.showManualCheck==null)p.matrix.showManualCheck=true;
  return p;
}
function settingSelect(id,label,options){
 return '<label class="r14-setting-row"><span>'+label+'</span><select id="'+id+'">'+options.map(([v,t])=>'<option value="'+v+'">'+t+'</option>').join('')+'</select></label>';
}
function settingCheck(id,label,desc=''){
 return '<label class="r14-setting-row"><span>'+label+(desc?'<small>'+desc+'</small>':'')+'</span><input type="checkbox" id="'+id+'"></label>';
}
function settingRange(id,label,min,max,step){
 return '<label class="r14-setting-row"><span>'+label+'</span><input type="range" id="'+id+'" min="'+min+'" max="'+max+'" step="'+step+'"><output id="'+id+'Val"></output></label>';
}
function sectionCard(title,description,items){
 return '<div class="r14-settings-card"><div class="r14-section-intro"><h4>'+title+'</h4><p>'+description+'</p></div>'+items+'</div>';
}
function settingsContent(section){
 switch(section){
 case 'appearance':return sectionCard('界面外观','遵循 MATQ / DavBridge 风格，减少装饰性注释，增强可读性。',
   '<label class="r14-setting-row"><span>软件名称<small>顶部标题及导出文件使用此名称</small></span><input id="settingAppTitle" type="text" maxlength="28" placeholder="考勤"></label>'+ 
    settingSelect('settingFont','全局字号',[['1','标准 · 100%'],['1.08','舒适 · 108%'],['1.16','放大 · 116%']])+
   settingCheck('settingMotion','平滑过渡动画','减少突兀闪烁，关闭后适用低性能设备')+
   settingCheck('settingBarLabels','在柱状图顶部显示数值','开启后在每根柱顶显示对应统计值；关闭后可悬停查看')+
   '<div class="r14-appearance-preview"><span>界面排版预览</span><strong>出勤情况 · 2026 年 10 月</strong><p>清晰的中文、统一的数字和克制的色彩</p><div><i class="green"></i><i class="yellow"></i><i class="red"></i><em>正常 · 异常 · 缺勤</em></div></div>');
 case 'matrix':return sectionCard('矩阵显示','紫色代表确定选择，蓝色代表鼠标预览。状态颜色不随选择改变。',
   settingCheck('settingIds','显示人员编号')+
   settingCheck('settingCrosshair','显示十字参考框','点击单格时两方向淡化，悬停时显示蓝色预选')+
   settingCheck('settingManualCheck','显示人工确认 √','人工修改过红黄绿判断后，在方块右上角显示确认标记')+
   settingRange('settingGlow','紫色发光强度',.5,1.8,.1)+
   settingRange('settingRestContrast','休息日底色强度',.6,1.8,.1));
 case 'timeline':return sectionCard('时间轴轨道','法定工作时间作为淡灰背景直接铺在时间轴内，不再单独占一条轨道；六条轨道始终保留；开关只控制记录绘制，不删除轨道。',
   settingCheck('settingArrows','箭头朝向时间线')+
   Object.entries({rules:'法定时段背景',events:'中轴打卡事件',trip:'出差区间',leave:'请假区间',outing:'外出区间',overtime:'加班区间'}).map(([id,t])=>
     settingCheck('settingTrack_'+id,t)).join(''));
 case 'table':return sectionCard('原始数据列管理','按类别保存显示和列宽；留空宽度则自动铺满，不改变任何原始数据。',
   settingSelect('settingTableKind','数据类别',[
    ['attendance','考勤'],['trip','出差'],['leave','请假'],['outing','外出'],['overtime','加班']])+
   '<div id="settingsColumns" class="r14-column-editor"></div>');
 case 'rules':return sectionCard('班次与判据','应用后重新计算当前月的考勤分析，原始打卡记录保持不变。',
   [['amStart','上午上班'],['amEnd','上午下班'],['pmStart','下午上班'],['pmEnd','下午下班']].map(([k,label])=>
    '<label class="r14-setting-row"><span>'+label+'</span><input type="time" id="r14Rule_'+k+'"></label>').join('')+
   [['graceAmStart','上午上班冗余（分钟）'],['graceAmEnd','上午下班冗余（分钟）'],
     ['gracePmStart','下午上班冗余（分钟）'],['gracePmEnd','下午下班冗余（分钟）']].map(([key,label])=>
    '<label class="r14-setting-row"><span>'+label+'</span><input id="r14Rule_'+key+'" type="number" min="0" max="120" step="1"></label>').join('')+
   '<label class="r14-setting-row"><span>重复打卡判定（秒）</span><input id="r14Dup" type="number" min="0" max="1800" step="10"></label>'+
   '<label class="r14-setting-row"><span>班后不计时长（分钟）<small>从下班时刻起扣除，例如默认到 12:00 / 17:30 才开始累计</small></span><input id="r93OvertimeAfter" type="number" min="0" max="240" step="1"></label>'+
   '<label class="r14-setting-row"><span>班前起算门槛（分钟）<small>提前达到此值后计完整提前时长，不扣除此门槛</small></span><input id="r93OvertimeBefore" type="number" min="0" max="240" step="1"></label>'+
   '<label class="r14-setting-row"><span>最低加班时长（分钟）<small>连续有效时段达到此值才纳入；跨午夜先合计后分日</small></span><input id="r14OvertimeMin" type="number" min="1" max="240" step="1"></label>'+
   settingCheck('r106MidnightInference','凌晨缺进卡时，从 00:00 推算加班')+
   '<label class="r14-setting-row"><span>凌晨补算截止时间<small>仅处理当天第一张为出卡，且无有效跨夜进卡的情况；默认 06:00</small></span><input id="r106MidnightCutoff" type="time" max="12:00" step="60"></label>'+
   '<label class="r14-setting-row"><span>连续在岗待核时长（小时）<small>超过后保留候选，点击加班色块右侧 ✓ 确认才计入；默认 16 小时</small></span><input id="r106MaxVisit" type="number" min="1" max="36" step="0.5"></label>'+
   '<label class="r14-setting-row"><span>临时外出短时限额（分钟）</span><input id="r87TempLimit" type="number" min="0" max="240" step="1"></label>'+
   '<label class="r14-setting-row"><span>临时外出冗余（分钟）<small>短时限额额外放宽；报备起止各允许此误差；错位时长比较也使用此值</small></span><input id="r87TempGrace" type="number" min="0" max="60" step="1"></label>'+
   '<p class="r14-setting-note">默认临时外出 10 + 2 分钟内为绿。班次开始由请假覆盖时，假后晚返只计临时外出：12分钟以内绿，超过红，不叠加迟到。班末短时往返及同一窗口跨班末的重复出卡不判早退；超时离岗仍保留早退。原始卡保留，临时外出只计算班内部分，红绿可人工调整，× 排除。</p>'+
   '<p class="r14-setting-note">默认班后扣20分钟、班前门槛5分钟、最低5分钟。12:10下班计10分钟，17:36计6分钟，08:24上班计6分钟，08:26不计。连续在岗跨午休也计入，默认12:00–13:30共90分钟。独立完整区间分别判断最低时长，不拼凑多段短时；登记和补录保持明确时段，仅扣重。出差/请假覆盖的缺岗先扣除；所有加班先排除班内，班外并集去重。历史冻结保留旧口径，应用本页可将独立修订切换到新口径，原冻结不变。</p>');
 case 'data':return sectionCard('数据与模拟','全部数据在本地浏览器解析与计算，不上传服务端。',
   '<div class="r14-readonly"><strong>当前工作空间</strong><span>'+monthKey()+'</span></div>'+
   '<div class="r14-readonly"><strong>原始考勤</strong><span>'+state.records.length+' 条</span></div>'+
   '<div class="r14-readonly"><strong>原始请假 / 出差</strong><span>'+state.leaves.length+' / '+state.trips.length+' 条</span></div>'+
   '<p class="r14-setting-note">复杂演示打卡包含同向重复、连续短间隔进出和晚间返岗。演示数据仅属于 2026 年 10 月。</p>');
 default:return sectionCard('本地运行','所有核心脚本和绘图库均本地提供，当前为实验预览版本。',
   '<div class="r14-readonly"><strong>应用</strong><span>'+escapeNameChar(attendTitle())+' · P109</span></div>'+
   '<div class="r14-readonly"><strong>版本</strong><button type="button" class="r101-version" data-p109-access-version>'+P109_APP_REVISION+' · v'+P109_APP_VERSION+'</button></div>'+
   '<div class="r14-readonly"><strong>存储</strong><span>当前月份 working / snapshots</span></div>');
 }
}
function r14SettingsMarkup(){
 return '<div class="settings-overlay hidden" id="settingsOverlay"><section class="settings-modal r14-settings" role="dialog" aria-modal="true" aria-labelledby="settingsHeading">'+
 '<header class="r14-settings-top"><div><strong id="settingsHeading">偏好设置</strong><span>'+escapeNameChar(attendTitle())+' / 工作空间</span></div>'+
 '<button id="settingsClose" title="关闭设置" aria-label="关闭设置">×</button></header>'+
 '<div class="r14-settings-body"><nav class="r14-settings-nav">'+R14_SETTING_SECTIONS.map(([id,name])=>
  '<button type="button" data-settings-section="'+id+'" class="'+(id==='appearance'?'active':'')+'">'+name+'</button>').join('')+'</nav>'+
 '<section id="settingsContent" class="r14-settings-content"></section></div>'+
 '<footer class="r14-settings-foot"><span>修改仅影响本地工作空间</span><button id="settingsCancel">取消</button><button id="settingsApply">应用并保存设置</button></footer>'+
 '</section></div>';
}
let r14SettingsDraft=null;
function bindSettings(){
 const overlay=document.getElementById('settingsOverlay'),content=document.getElementById('settingsContent');
 if(!overlay||!content)return;
 let section='appearance';
 function writeCurrentSection(){
  content.innerHTML=settingsContent(section);
  const d=r14SettingsDraft,p=d.prefs;
  const set=(id,value)=>{const e=document.getElementById(id);if(e){if(e.type==='checkbox')e.checked=!!value;else e.value=String(value)}};
  if(section==='appearance'){set('settingAppTitle',p.appTitle||'考勤');set('settingFont',p.fontScale||1);set('settingMotion',p.motion!==false);
   set('settingBarLabels',p.showBarValues===true)}
  if(section==='matrix'){
   const m=p.matrix||{};set('settingIds',m.ids!==false);set('settingCrosshair',m.crosshair!==false);set('settingManualCheck',m.showManualCheck!==false);
   set('settingGlow',m.glow||1);set('settingRestContrast',m.restContrast||1);
   for(const k of ['Glow','RestContrast']){const input=document.getElementById('setting'+k);const output=document.getElementById('setting'+k+'Val');
    input.oninput=()=>{output.textContent=Number(input.value).toFixed(1)+'×'};
    input.dispatchEvent(new Event('input'))}
  }
  if(section==='timeline'){
   set('settingArrows',p.arrowsTowardLine!==false);
   for(const k of Object.keys(p.timelineTracks||{}))set('settingTrack_'+k,p.timelineTracks[k]);
  }
  if(section==='advanced')p109BindAccessVersion(content.querySelector('[data-p109-access-version]'));
  if(section==='rules'){
   if(d.rules.overtimeRuleVersion===1)d.rules=p109NormalizeOvertimeRules({...d.rules,overtimeRuleVersion:null});
   for(const k of ['amStart','amEnd','pmStart','pmEnd'])set('r14Rule_'+k,d.rules[k]);
   for(const k of ['graceAmStart','graceAmEnd','gracePmStart','gracePmEnd'])
    set('r14Rule_'+k,d.rules[k]??(k.endsWith('Start')?(d.rules.grace??5):0));
   set('r14Dup',d.rules.dupSeconds);set('r14OvertimeMin',d.rules.overtimeMinMinutes??5);
   set('r93OvertimeAfter',d.rules.overtimeAfterMinutes??20);set('r93OvertimeBefore',d.rules.overtimeBeforeMinutes??5);
   set('r106MidnightInference',d.rules.midnightInference!==false);set('r106MidnightCutoff',minuteText(d.rules.midnightCutoffMinutes??360));set('r106MaxVisit',d.rules.maxVisitHours??16);
   set('r87TempLimit',d.rules.tempOutingMinutes??10);set('r87TempGrace',d.rules.tempOutingGraceMinutes??2);
  }
  if(section==='table'){
   set('settingTableKind',d.tableKind||'attendance');
   document.getElementById('settingTableKind').onchange=e=>{captureDraft();d.tableKind=e.target.value;writeColumns()};
   writeColumns();
  }
 }
 function writeColumns(){
  const d=r14SettingsDraft,kind=d.tableKind||'attendance',target=document.getElementById('settingsColumns');
  target.innerHTML='<div class="r14-column-head"><span>字段</span><span>可见</span><span>列宽 / px</span></div>'+
   R14_TABLE_FIELDS[kind].map(([field,label])=>{
    const v=d.prefs.tableColumns[kind]?.[field]||{};
    return '<div class="r14-column-row" data-config-column="'+field+'"><span>'+label+'</span><input type="checkbox" '+(v.visible===false?'':'checked')+' aria-label="'+label+' 可见">'+
    '<input type="number" min="48" max="500" step="10" value="'+(v.width||'')+'" placeholder="自适应" aria-label="'+label+' 列宽"></div>';
   }).join('');
 }
 function captureDraft(){
  if(!r14SettingsDraft)return;
  const d=r14SettingsDraft,p=d.prefs;
  const get=id=>document.getElementById(id),v=id=>get(id)?.value,ch=id=>get(id)?.checked;
  if(section==='appearance'){p.appTitle=String(v('settingAppTitle')||'考勤').trim().slice(0,28)||'考勤';p.fontScale=Number(v('settingFont')||p.fontScale||1);p.motion=!!ch('settingMotion');
   p.showBarValues=!!ch('settingBarLabels')}
  if(section==='matrix'){p.matrix={ids:!!ch('settingIds'),crosshair:!!ch('settingCrosshair'),showManualCheck:!!ch('settingManualCheck'),glow:Number(v('settingGlow')||1),restContrast:Number(v('settingRestContrast')||1)}}
  if(section==='timeline'){
   p.arrowsTowardLine=!!ch('settingArrows');
   for(const k of ['rules','events','trip','leave','outing','overtime'])p.timelineTracks[k]=!!ch('settingTrack_'+k);
  }
  if(section==='rules'){for(const k of ['amStart','amEnd','pmStart','pmEnd'])d.rules[k]=v('r14Rule_'+k)||d.rules[k];
   for(const k of ['graceAmStart','graceAmEnd','gracePmStart','gracePmEnd'])
    d.rules[k]=Number(v('r14Rule_'+k));
   d.rules.grace=d.rules.graceAmStart;d.rules.dupSeconds=Number(v('r14Dup'));
   d.rules.overtimeMinMinutes=Number(v('r14OvertimeMin'));
   d.rules.businessRuleVersion=2;d.rules.overtimeRuleVersion=2;d.rules.overtimeAfterMinutes=Number(v('r93OvertimeAfter'));d.rules.overtimeBeforeMinutes=Number(v('r93OvertimeBefore'));
   d.rules.punchRuleVersion=2;d.rules.leaveReturnRuleVersion=2;d.rules.statisticsRuleVersion=2;d.rules.midnightInference=!!ch('r106MidnightInference');d.rules.midnightCutoffMinutes=minutes(v('r106MidnightCutoff'));d.rules.maxVisitHours=Number(v('r106MaxVisit'));
   d.rules.tempOutingMinutes=Number(v('r87TempLimit'));d.rules.tempOutingGraceMinutes=Number(v('r87TempGrace'))}
  if(section==='table'){
   const kind=d.tableKind||'attendance';p.tableColumns[kind]??={};
   document.querySelectorAll('[data-config-column]').forEach(row=>{
    const [visible,width]=row.querySelectorAll('input');
    p.tableColumns[kind][row.dataset.configColumn]={visible:row.dataset.configColumn==='name'||visible.checked,width:width.value?Number(width.value):null};
   });
  }
 }
 function choose(id){
  captureDraft();section=id;
  document.querySelectorAll('[data-settings-section]').forEach(b=>b.classList.toggle('active',b.dataset.settingsSection===id));
  writeCurrentSection();
 }
 const close=()=>{overlay.classList.add('hidden');r14SettingsDraft=null;window.p109AccessSettingsClosed?.();document.getElementById('settingsBtn')?.focus()};
 document.getElementById('settingsBtn').onclick=()=>{
  const p=r14Prefs();r14SettingsDraft={prefs:JSON.parse(JSON.stringify(p)),rules:{...RULES},tableKind:state.rawDataTab||'attendance'};
  section='appearance';overlay.classList.remove('hidden');
  document.querySelectorAll('[data-settings-section]').forEach(b=>b.classList.toggle('active',b.dataset.settingsSection==='appearance'));
  writeCurrentSection();
 };
 document.querySelectorAll('[data-settings-section]').forEach(b=>b.onclick=()=>choose(b.dataset.settingsSection));
 document.getElementById('settingsClose').onclick=close;
 document.getElementById('settingsCancel').onclick=close;
 overlay.onclick=e=>{if(e.target!==overlay)return;if(overlay.classList.contains('r101-access-recovery')){e.preventDefault();e.stopPropagation();return}close()};
 document.getElementById('settingsApply').onclick=()=>{
  captureDraft();
  const d=r14SettingsDraft;
  if(!d)return;
  const time=['amStart','amEnd','pmStart','pmEnd'].map(k=>d.rules[k]);
  if(time.some(t=>!/^\d\d:\d\d$/.test(t))||!(minutes(time[0])<minutes(time[1])&&minutes(time[1])<minutes(time[2])&&minutes(time[2])<minutes(time[3]))||
    !['graceAmStart','graceAmEnd','gracePmStart','gracePmEnd'].every(k=>
      Number.isInteger(d.rules[k])&&d.rules[k]>=0&&d.rules[k]<=120)||
    !Number.isFinite(d.rules.dupSeconds)||d.rules.dupSeconds<0||d.rules.dupSeconds>1800||
    !p109ValidOvertimeRules(d.rules)||
    !Number.isInteger(d.rules.tempOutingMinutes)||d.rules.tempOutingMinutes<0||d.rules.tempOutingMinutes>240||
    !Number.isInteger(d.rules.tempOutingGraceMinutes)||d.rules.tempOutingGraceMinutes<0||d.rules.tempOutingGraceMinutes>60){
    toast('请检查工作时段、宽限与重复判定参数',true);return;
  }
  Object.assign(RULES,d.rules);state.prefs=d.prefs;state.saved=false;rememberMonth();reanalyze();close();render();document.getElementById('settingsBtn')?.focus();
  toast('设置已应用，保存工作空间后持久保留');
 };
}
