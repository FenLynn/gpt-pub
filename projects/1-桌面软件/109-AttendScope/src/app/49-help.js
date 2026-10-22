/* R81 · offline guidance, program location and synchronous close protection. */
'use strict';
function p109UnsavedMonths(){
 const result=[];
 if(!state.saved&&!state.isDemo)result.push(monthKey());
 for(const [key,month] of state.monthStores)if(key!==monthKey()&&!month.saved&&!month.isDemo)result.push(key);
 return result;
}
function p109BeforeUnload(event){
 if(!p109UnsavedMonths().length&&!state.storageBusy&&!state.importCommitting&&!p109ProjectBusy)return;
 event.preventDefault();event.returnValue='';
}
window.addEventListener('beforeunload',p109BeforeUnload);
function p109ProgramLocation(){
 if(location.protocol!=='file:')return '网页运行 · 浏览器未提供本机程序路径';
 const url=new URL('.',location.href),path=decodeURIComponent(url.pathname);
 return url.hostname?'\\\\'+url.hostname+path.replaceAll('/','\\'):/^\/[A-Za-z]:\//.test(path)?path.slice(1).replaceAll('/','\\'):path;
}
function p109ProgramFooter(){
 const path=p109ProgramLocation(),dirty=p109UnsavedMonths();
 return '<footer class="r81-program-footer"><span class="r81-location-label">程序目录</span><span id="p109ProgramPath" title="'+escapeNameChar(path)+'">'+escapeNameChar(path)+'</span>'+
  (location.protocol==='file:'?'<button id="r81CopyProgram" type="button">复制路径</button>':'')+
  '<span class="r81-data-separate">项目数据目录见顶部</span>'+(dirty.length?'<button id="r81SaveReminder" type="button" title="未保存月份：'+dirty.join('、')+'">未保存：'+dirty.slice(0,2).join('、')+(dirty.length>2?' 等 '+dirty.length+' 月':'')+' · 保存当前月</button>':'')+'</footer>';
}
const p109DirectoryNotes=new WeakMap();
function p109ActiveRecent(){return typeof p109RecentState==='undefined'?null:p109RecentState.items.find(x=>x.handle===state.projectDir)}
function p109ProjectDirectoryNote(){return state.projectDir?(p109DirectoryNotes.get(state.projectDir)||p109ActiveRecent()?.directoryPath||''):''}
function p109ProjectLocationHtml(){
 const connected=!!state.projectDir,note=p109ProjectDirectoryNote(),label=connected?(note||state.projectDir.name):(state.isDemo?'Demo · 演示数据':'尚未连接项目');
 return '<div class="r81-project-location"><strong>项目数据目录</strong><button id="r81ProjectBrowse" type="button" title="'+escapeNameChar(label)+' · 点击浏览项目文件">'+escapeNameChar(label)+'</button>'+
  (connected?'<span class="r81-path-origin">'+(note?'手动记录':'浏览器仅提供目录名')+'</span><button id="r81CopyProject" class="r81-copy" type="button">复制路径</button>'+
   (note?'<button id="r81EditProjectPath" type="button" aria-label="编辑手动记录的项目目录路径">编辑路径</button>':''):'')+'</div>';
}
async function p109CopyDirectory(path){
 try{
  if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(path);
  else{
   const input=document.createElement('textarea');input.value=path;input.setAttribute('readonly','');input.style.cssText='position:fixed;opacity:0';document.body.appendChild(input);input.select();
   let ok;try{ok=document.execCommand('copy')}finally{input.remove()}
   if(!ok)throw Error('浏览器未允许复制');
  }
  toast('已复制目录路径');return true;
 }catch(_){p109ShowCopyFallback(path);return false}
}
function p109ShowCopyFallback(path){
 document.getElementById('r81CopyOverlay')?.remove();const node=document.createElement('section');node.id='r81CopyOverlay';node.className='p109-recent-overlay r81-path-overlay';
 node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.setAttribute('aria-label','复制目录路径');
 node.innerHTML='<div class="r81-path-panel"><h2>复制目录路径</h2><p>浏览器未允许自动复制，请按 Ctrl+C 复制下方内容。</p><textarea readonly aria-label="目录路径"></textarea><footer><button id="r81CopyClose">完成</button></footer></div>';
 document.body.appendChild(node);node.querySelector('textarea').value=path;node.querySelector('textarea').select();node.querySelector('#r81CopyClose').onclick=()=>node.remove();
 node.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();node.remove()}else p109TrapDialogFocus(e,node)});
}
function p109ValidateDirectoryNote(text,name){
 const value=text.trim().replace(/^"(.*)"$/,'$1').replace(/[\\/]+$/,'');
 if(!value)return '';
 if(!/^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+|\/)/.test(value)||/[\0\r\n<>"|?*]/.test(value)||/(^|[\\/])\.\.?([\\/]|$)/.test(value)||/^C:\\fakepath\\/i.test(value))throw Error('请粘贴文件夹的完整绝对路径，不要包含文件名。');
 if(value.split(/[\\/]/).filter(Boolean).at(-1)?.normalize('NFKC').toLocaleLowerCase()!==name.normalize('NFKC').toLocaleLowerCase())throw Error('路径最后一级应为当前项目文件夹“'+name+'”，不要包含文件名。');
 return value;
}
function p109ShowProjectPath(copyAfter=false){
 if(!state.projectDir)return;document.getElementById('r81PathOverlay')?.remove();const handle=state.projectDir,node=document.createElement('section');
 node.id='r81PathOverlay';node.className='p109-recent-overlay r81-path-overlay';node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.setAttribute('aria-labelledby','r81PathTitle');
 node.innerHTML='<form class="r81-path-panel"><h2 id="r81PathTitle">记录项目目录路径</h2><p>浏览器只提供文件夹名称。请在系统文件管理器中复制此文件夹的地址，粘贴到这里，方便以后复制。</p><label for="r81PathInput">'+escapeNameChar(handle.name)+' · 完整文件夹路径</label><input id="r81PathInput" autocomplete="off" spellcheck="false"><p class="r81-path-note">仅在本机浏览器记录，不会移动文件或改变连接；完整路径无法由页面核实。</p><p id="r81PathError" role="alert"></p><footer><button type="button" id="r81PathCancel">取消</button><button type="submit">'+(copyAfter?'记录并复制':'保存路径')+'</button></footer></form>';
 document.body.appendChild(node);const input=node.querySelector('input');input.value=p109ProjectDirectoryNote();input.focus();
 node.querySelector('#r81PathCancel').onclick=()=>node.remove();
 node.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();node.remove()}else p109TrapDialogFocus(e,node)});
 node.querySelector('form').onsubmit=async e=>{
  e.preventDefault();if(state.projectDir!==handle){node.remove();return}
  const status=node.querySelector('#r81PathError');
  try{
   const path=p109ValidateDirectoryNote(input.value,handle.name);if(copyAfter&&!path)throw Error('请先填写完整文件夹路径。');
   const item=p109ActiveRecent();let persisted=!!item;
   if(item){const updated={...item,directoryPath:path};try{await p109RecentWrite(updated,p109RecentState.lastId)}catch(_){persisted=false}p109RecentState.items=p109RecentState.items.map(x=>x.id===item.id?updated:x)}
   p109DirectoryNotes.set(handle,path);
   if(!node.isConnected||state.projectDir!==handle)return;
   node.remove();render();if(copyAfter)await p109CopyDirectory(path);
   if(!persisted)toast('路径仅在本次页面中记录；浏览器未允许持久保存，下次需要重新填写。',true);
  }catch(err){status.textContent=err.message}
 };
}
const P109_HELP_TOPICS=[
 ['attendance','考勤记录','从打卡证据开始',
  '<p>导入 XLSX 或 CSV，至少指定姓名和打卡日期时间。日期与时间可来自一列，也可分别映射。请先确认顶部月份与文件日期一致。</p><p>“进出”可选无，此时标为未标注、待核，不推断进出，也不组成在岗或自动加班会话。有进出列时，非空且无法识别的值须在识别规则中修正。</p><p>全员/分组用于定位异常；点击人员查看月度分析，点击日期查看单日证据。红色是明确问题，黄色是待核。人工改判改变最终判定，不修改原始文件。</p>'],
 ['leave','请假','按日期或时间段记录',
  '<p>指定姓名、开始日期；结束日期可选无，视为同日。请假起止时刻可选无，使用当前班次边界。类型和备注可选无。</p><p>提供了日期或时刻的列，其内容仍必须有效。跨日请假使用开始、结束日期。请假记录会与打卡共同参与当天分析，原件可在数据管理中查看。</p>'],
 ['trip','出差','多份文件连续合并',
  '<p>指定姓名、开始日期；结束日期可省略为同日，类型、地点、备注均可选无。一次可以选择多份文件，每份单独预览并确认。</p><p>默认追加合并：导入“出差2”保留“出差1”，重合记录保留全部来源。不同业务内容仍分别保留。更多选项中的替换仅影响本月此类工作数据，需要再次确认。</p>'],
 ['outing','外出','区分外出与缺卡',
  '<p>指定姓名、开始日期、开始时间和结束时间；结束日期可省略为同日。类型、地点、备注可以不选。</p><p>外出时段与打卡证据共同展示。请核对时段及跨日日期，不用虚构进出打卡来代替外出登记。</p>'],
 ['overtime','加班','登记和自动候选分别核查',
  '<p>登记加班须有姓名、日期与起止时刻；类型和备注可选无。自动加班来自有效打卡证据，严格超过配置门槛后计入完整区间。</p><p>登记时段与已纳入自动候选按区间合并，避免重复计算。可人工排除或纳入候选，保留证据和修订记录。自动候选用于核查，不代替审批和工资结算。</p>'],
 ['roster','人员与组别','分批选择，连续加入',
  '<p>数据管理 → 人员与分组：勾选人员，选择目标组别，点击批量加入。跨搜索保留选择；完成一批后清空选择，保留目标组别和列表位置，继续处理下一批。</p><p>长期固定名单用左右箭头管理。“保存下月默认名册”将已选固定人员及组别用于后续月份。姓名是唯一身份，同名员工会合并，导入前应确认命名一致。</p>'],
 ['storage','存储结构','找到原件、工作和冻结',
  '<p>程序目录保存 index.html 与 src；项目目录保存下面的数据。更新程序不需要把项目数据搬到程序目录。</p><pre>项目目录/\n  project.json              项目及月份索引\n  config/                   人员、班次、日历、下月默认配置\n  data/YYYY/MM/\n    raw/类型/导入ID/原文件    每次导入的原件\n    imports.json            导入清单\n    working/                可继续编辑的月度工作\n    snapshots/F…/           不可变冻结\n    branches/B…/            从冻结派生的独立修订\n    output/                 表格、截图等导出</pre><p>数据管理 → 原始记录可预览、下载真实原件；“合并数据”查看业务记录与来源。存储与文件可按实际目录浏览。raw 不改写，冻结不覆盖；derived/output 可重新生成。</p>'],
 ['save','保存与恢复','离开前保存，定期完整备份',
  '<p>“保存”保存当前月份的 working；未连接目录时下载月度 JSON。“冻结”保存不可变快照；修改历史冻结应创建独立修订。三者与完整项目备份用途不同。</p><p>存在未保存的工作月份，关闭或刷新页面时浏览器会提示是否离开。选择留在页面，再点保存；提示文字由浏览器决定。浏览器强退或系统断电不能保证出现提示，关闭时也不能可靠地异步保存文件。</p><p>项目 → 恢复月度工作/冻结 JSON 只恢复相应状态；恢复整个项目 ZIP 用于完整数据目录，目标必须为空。项目 → 完整备份包含原件、配置、工作及快照。</p>']
];
function p109CloseHelp(){document.getElementById('p109HelpOverlay')?.remove();document.getElementById('p109Help')?.focus({preventScroll:true})}
function p109ShowHelp(section='start',topic='attendance'){
 document.getElementById('p109HelpOverlay')?.remove();
 const node=document.createElement('section');node.id='p109HelpOverlay';node.className='p109-recent-overlay r81-help-overlay';
 node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.setAttribute('aria-labelledby','r81HelpTitle');
 node.innerHTML='<div class="r81-help-panel"><header><div><h2 id="r81HelpTitle">使用帮助</h2><p>从第一次导入，到每个月继续工作</p></div><button id="r81HelpClose" aria-label="关闭帮助">×</button></header>'+
  '<nav class="r81-help-tabs" aria-label="帮助分类"><button data-help-section="start" aria-pressed="'+(section==='start')+'">快速入门</button><button data-help-section="topics" aria-pressed="'+(section==='topics')+'">专题指南</button></nav>'+
  '<div class="r81-help-layout">'+(section==='topics'?'<nav class="r81-help-topics" aria-label="专题">'+P109_HELP_TOPICS.map(([id,label])=>'<button data-help-topic="'+id+'" aria-current="'+(id===topic?'page':'false')+'">'+label+'</button>').join('')+'</nav>':'')+
  '<article id="r81HelpArticle" tabindex="0">'+(section==='topics'?p109HelpTopicHtml(topic):p109HelpStartHtml())+'</article></div></div>';
 document.body.appendChild(node);node.querySelector('#r81HelpClose').onclick=p109CloseHelp;
 node.querySelectorAll('[data-help-section]').forEach(b=>b.onclick=()=>{p109ShowHelp(b.dataset.helpSection,topic);document.querySelector('[data-help-section="'+b.dataset.helpSection+'"]').focus()});
 node.querySelectorAll('[data-help-topic]').forEach(b=>b.onclick=()=>{p109ShowHelp('topics',b.dataset.helpTopic);document.querySelector('[data-help-topic="'+b.dataset.helpTopic+'"]').focus()});
 node.querySelector('[data-help-open-work]')?.addEventListener('click',()=>{p109CloseHelp();p109ShowModeChooser()});
 node.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();p109CloseHelp()}else p109TrapDialogFocus(e,node)});
 node.querySelector('#r81HelpClose').focus();
}
function p109HelpTopicHtml(topic){const item=P109_HELP_TOPICS.find(x=>x[0]===topic)||P109_HELP_TOPICS[0];return '<p class="r81-help-eyebrow">'+item[1]+'</p><h3>'+item[2]+'</h3>'+item[3]}
function p109HelpStartHtml(){
 return '<p class="r81-help-eyebrow">第一次正常使用</p><h3>先连接项目，再导入当月数据</h3><ol class="r81-help-steps">'+
  '<li><strong>选择 Work，建立独立数据目录</strong><p>首次进入选择 Work → 新建空白项目，选择一个独立的空文件夹。已有项目则连接含 project.json 的目录。Demo 只用于体验。</p></li>'+
  '<li><strong>确认月份与班次</strong><p>顶部选择要处理的年月；数据管理 → 班次与规则，核对上下班时刻、容差和日历。</p></li>'+
  '<li><strong>导入文件并核对预览</strong><p>顶部导入 → 考勤、请假、出差等。可下载空白模板。核对姓名和日期时间列，其余可选字段可选无；确认有效行及所属月份后导入。</p></li>'+
  '<li><strong>检查分析，整理人员组别</strong><p>全员/分组查异常，个人分析看单日证据，统计分析做范围对比。数据管理可查看原件、批量分组和修正规则。</p></li>'+
  '<li><strong>保存工作，核对后冻结</strong><p>点击保存；同月多份文件默认合并。完成核查后冻结，并通过项目菜单定期完整备份。重开时有默认工作项目就恢复，没有则再次选择 Demo / Work。</p></li></ol>'+
  '<button class="r81-help-action" data-help-open-work>选择 Demo / Work 或连接项目</button>';
}
document.addEventListener('click',e=>{
 if(e.target.closest?.('#p109Help'))p109ShowHelp();
 if(e.target.closest?.('#r81SaveReminder'))saveWorking();
 if(e.target.closest?.('#r81CopyProgram'))p109CopyDirectory(p109ProgramLocation());
 if(e.target.closest?.('#r81CopyProject')){const path=p109ProjectDirectoryNote();path?p109CopyDirectory(path):p109ShowProjectPath(true)}
 if(e.target.closest?.('#r81EditProjectPath'))p109ShowProjectPath();
 if(e.target.closest?.('#r81ProjectBrowse'))state.projectDir?p109OpenProjectPath([]):p109ShowModeChooser();
});
