/* R82 local tutorial reader. UI state is separate from attendance/project data. */
'use strict';
const p109GuideState={section:'start',lesson:'overview',topic:'attendance',search:'',positions:new Map(),returnFocus:null};
function p109GuidePages(section=p109GuideState.section){return section==='topics'?P109_GUIDE_TOPICS:P109_GUIDE_START}
function p109GuideCurrent(){return p109GuidePages().find(p=>p.id===(p109GuideState.section==='topics'?p109GuideState.topic:p109GuideState.lesson))||p109GuidePages()[0]}
function p109GuideKey(){return p109GuideState.section+'|'+p109GuideCurrent().id}
function p109GuideDates(){
 const day=Array.from({length:monthDays()},(_,i)=>i+1).find(d=>['work','adjust'].includes(dayType(d)))||1;
 return {MONTH:monthKey(),DATE:isoDate(day),NEXTDATE:isoDate(Math.min(monthDays(),day+1))};
}
function p109GuideFormat(text){const dates=p109GuideDates();return text.replace(/\{\{(MONTH|DATE|NEXTDATE)\}\}/g,(_,key)=>dates[key])}
function p109GuidePlain(html){return html.replace(/<[^>]*>/g,' ').replace(/&(?:amp|lt|gt|quot|#39);/g,' ').replace(/\s+/g,' ').trim()}
function p109GuideRemember(){const article=document.getElementById('r81HelpArticle');if(article&&!p109GuideState.search.trim())p109GuideState.positions.set(p109GuideKey(),article.scrollTop)}
function p109CloseHelp(){
 p109GuideRemember();document.getElementById('p109HelpOverlay')?.remove();
 const target=p109GuideState.returnFocus?.isConnected?p109GuideState.returnFocus:document.getElementById('p109Help');target?.focus({preventScroll:true});
}
function p109GuidePageHtml(page,section=p109GuideState.section){
 return '<div class="r82-guide-reading"><p class="r81-help-eyebrow">'+(section==='start'?'快速入门':'专题指南')+'</p><h3>'+page.title+'</h3><p class="r82-guide-lead">'+page.summary+'</p>'+page.sections.map(([title,html],i)=>
  '<section class="r82-guide-section" id="guide-'+section+'-'+page.id+'-'+i+'"><h4>'+title+'</h4>'+p109GuideFormat(html)+'</section>').join('')+'</div>';
}
function p109GuideResults(query){
 const words=query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).map(word=>['跨日','跨夜','跨天','多日'].includes(word)?['跨日','跨夜','跨天','多日']: [word]);
 return [['start',P109_GUIDE_START],['topics',P109_GUIDE_TOPICS]].flatMap(([section,pages])=>pages.map(page=>({section,page,text:p109GuidePlain(page.title+' '+page.summary+' '+page.sections.flat().join(' '))})))
  .filter(item=>words.every(alternatives=>alternatives.some(word=>item.text.normalize('NFKC').toLocaleLowerCase().includes(word))));
}
function p109GuideRender(){
 const node=document.getElementById('p109HelpOverlay');if(!node)return;
 const pages=p109GuidePages(),current=p109GuideCurrent(),article=node.querySelector('#r81HelpArticle'),navigation=node.querySelector('#r82GuidePages'),toc=node.querySelector('#r82GuideToc'),footer=node.querySelector('#r82GuidePagination');
 const oldScroll=navigation.scrollTop,query=p109GuideState.search.trim();
 node.querySelectorAll('[data-help-section]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.helpSection===p109GuideState.section)));
 navigation.innerHTML='<span class="r82-guide-nav-caption">'+(p109GuideState.section==='start'?'按顺序学习 · ':'按问题查阅 · ')+pages.length+' 章</span>'+pages.map((page,i)=>
  '<button '+(p109GuideState.section==='topics'?'data-help-topic':'data-help-lesson')+'="'+page.id+'" aria-current="'+(current.id===page.id?'page':'false')+'"><span>'+String(i+1).padStart(2,'0')+'</span>'+page.title+'</button>').join('');
 navigation.scrollTop=oldScroll;
 if(query){
  const results=p109GuideResults(query);
  article.innerHTML='<div class="r82-guide-reading"><h3>搜索教程</h3><p class="r82-guide-lead" role="status">找到 '+results.length+' 篇与“'+p109GuideEsc(query)+'”相关的教程</p>'+
   (results.length?'<div class="r82-guide-results">'+results.map(({section,page,text})=>'<button data-guide-link="'+section+'|'+page.id+'"><span>'+(section==='start'?'快速入门':'专题指南')+'</span><strong>'+page.title+'</strong><p>'+p109GuideEsc(text.slice(0,150))+'…</p></button>').join('')+'</div>':'<p>试试“月份”“跨日”“原件”“固定名单”或“恢复”。多个关键词请用空格隔开。</p>')+'</div>';
  toc.innerHTML='';footer.innerHTML='<span>全文搜索覆盖全部 '+(P109_GUIDE_START.length+P109_GUIDE_TOPICS.length)+' 篇教程</span><button data-guide-clear>返回阅读</button>';article.scrollTop=0;
 }else{
  article.innerHTML=p109GuidePageHtml(current);
  toc.innerHTML='<span class="r82-guide-nav-caption">本章目录</span>'+current.sections.map(([title],i)=>'<button data-guide-anchor="guide-'+p109GuideState.section+'-'+current.id+'-'+i+'">'+title+'</button>').join('');
  const index=pages.indexOf(current);
  footer.innerHTML='<button data-guide-step="-1" '+(!index?'disabled':'')+'>‹ 上一章</button><span>第 '+(index+1)+' / '+pages.length+' 章</span><button data-guide-step="1" '+(index===pages.length-1?'disabled':'')+'>下一章 ›</button>';
  article.scrollTop=p109GuideState.positions.get(p109GuideKey())||0;
 }
}
function p109GuideSelect(section,id){
 p109GuideRemember();p109GuideState.section=section==='topics'?'topics':'start';
 const page=p109GuidePages().find(p=>p.id===id)||p109GuidePages()[0];p109GuideState[p109GuideState.section==='topics'?'topic':'lesson']=page.id;
 p109GuideState.search='';const input=document.getElementById('r82GuideSearch');if(input)input.value='';p109GuideRender();
}
function p109ShowHelp(section,topic){
 const old=document.getElementById('p109HelpOverlay');if(old){if(section)p109GuideSelect(section,topic||(section==='topics'?p109GuideState.topic:p109GuideState.lesson));return}
 p109GuideState.returnFocus=document.activeElement;p109GuideState.search='';
 if(section){p109GuideState.section=section==='topics'?'topics':'start';if(topic)p109GuideState[p109GuideState.section==='topics'?'topic':'lesson']=topic}
 const node=document.createElement('section');node.id='p109HelpOverlay';node.className='p109-recent-overlay r81-help-overlay';
 node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.setAttribute('aria-labelledby','r81HelpTitle');
 node.innerHTML='<div class="r81-help-panel r82-guide-panel"><header><div><h2 id="r81HelpTitle">使用教程</h2><p>'+P109_GUIDE_START.length+' 章快速入门 · '+P109_GUIDE_TOPICS.length+' 个专题 · 步骤、样例、结果核对与排错</p></div><div class="r82-guide-header-actions"><button id="r82GuideExport">下载离线文字教程</button><button id="r81HelpClose" aria-label="关闭帮助">×</button></div></header>'+
  '<div class="r82-guide-toolbar"><nav class="r81-help-tabs" aria-label="帮助分类"><button data-help-section="start">快速入门</button><button data-help-section="topics">专题指南</button></nav><label class="r82-guide-search"><span>搜索</span><input id="r82GuideSearch" placeholder="月份、跨日、原件、恢复…" autocomplete="off" aria-label="全文搜索使用教程"><button data-guide-clear aria-label="清除教程搜索">×</button></label></div>'+
  '<div class="r81-help-layout"><nav id="r82GuidePages" class="r82-guide-pages" aria-label="教程章节"></nav><article id="r81HelpArticle" tabindex="0"></article><nav id="r82GuideToc" class="r82-guide-toc" aria-label="本章目录"></nav></div><footer id="r82GuidePagination" class="r82-guide-pagination"></footer></div>';
 document.body.appendChild(node);p109GuideRender();node.querySelector('#r81HelpClose').onclick=p109CloseHelp;
 node.querySelector('#r82GuideSearch').oninput=e=>{if(!p109GuideState.search)p109GuideRemember();p109GuideState.search=e.target.value;p109GuideRender()};
 node.querySelector('#r82GuideExport').onclick=p109GuideExportManual;
 node.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();p109CloseHelp()}else p109TrapDialogFocus(e,node)});
 node.addEventListener('click',e=>{
  const link=e.target.closest('[data-guide-link]');if(link){const [category,id]=link.dataset.guideLink.split('|');p109GuideSelect(category,id);return}
  const tab=e.target.closest('[data-help-section]');if(tab){p109GuideSelect(tab.dataset.helpSection,p109GuideState[tab.dataset.helpSection==='topics'?'topic':'lesson']);return}
  const page=e.target.closest('[data-help-topic],[data-help-lesson]');if(page){p109GuideSelect(page.hasAttribute('data-help-topic')?'topics':'start',page.dataset.helpTopic||page.dataset.helpLesson);return}
  const clear=e.target.closest('[data-guide-clear]');if(clear){p109GuideState.search='';node.querySelector('#r82GuideSearch').value='';p109GuideRender();return}
  const anchor=e.target.closest('[data-guide-anchor]');if(anchor){const article=node.querySelector('#r81HelpArticle'),target=document.getElementById(anchor.dataset.guideAnchor);if(target)article.scrollTop+=target.getBoundingClientRect().top-article.getBoundingClientRect().top-16;return}
  const step=e.target.closest('[data-guide-step]');if(step){const pages=p109GuidePages(),index=pages.indexOf(p109GuideCurrent())+Number(step.dataset.guideStep);if(pages[index]){p109GuideSelect(p109GuideState.section,pages[index].id);node.querySelector('#r81HelpArticle').focus({preventScroll:true})}return}
  const download=e.target.closest('[data-guide-download]');if(download){p109GuideDownloadSample(download.dataset.guideDownload);return}
  if(e.target.closest('[data-help-open-work]')){p109CloseHelp();if(!document.getElementById('p109ModeOverlay'))p109ShowModeChooser()}
 });
 node.querySelector('#r81HelpClose').focus();
}
function p109GuideSampleRows(kind){
 const {DATE,NEXTDATE}=p109GuideDates();
 if(kind==='attendance')return ['教程甲','教程乙'].flatMap((name,index)=>[[index?'09:05:00':'08:25:00','进'],['11:45:00','出'],['13:25:00','进'],['17:15:00','出']].map(([time,direction])=>({姓名:name,打卡时间:DATE+' '+time,进出:direction})));
 if(kind==='leave')return [{姓名:'教程乙',开始日期:DATE,开始时间:'08:30',结束日期:NEXTDATE,结束时间:'11:40',类型:'事假',备注:'虚构教程数据'}];
 if(kind==='trip')return [{姓名:'教程甲',开始日期:DATE,结束日期:NEXTDATE,类型:'出差',地点:'示例地点',备注:'虚构教程数据'}];
 if(kind==='outing')return [{姓名:'教程乙',开始日期:DATE,结束日期:DATE,开始时间:'14:00',结束时间:'15:00',类型:'外出',地点:'示例地点',备注:'虚构教程数据'}];
 if(kind==='overtime')return [{姓名:'教程甲',开始日期:DATE,开始时间:'22:00',结束日期:NEXTDATE,结束时间:'02:00',类型:'登记加班',备注:'虚构教程数据'}];
 return [];
}
function p109GuideDownloadSample(kind){
 const label={attendance:'考勤',leave:'请假',trip:'出差',outing:'外出',overtime:'登记加班'}[kind];if(!label)return;
 p109ExportRows(p109GuideSampleRows(kind),'教程-'+label+'-'+monthKey()+'.csv');
}
function p109GuideManualHtml(){
 const groups=[['start','快速入门',P109_GUIDE_START],['topics','专题指南',P109_GUIDE_TOPICS]];
 const toc=groups.map(([section,title,pages])=>'<h2>'+title+'</h2><ol>'+pages.map(page=>'<li><a href="#manual-'+section+'-'+page.id+'">'+page.title+'</a></li>').join('')+'</ol>').join('');
 const body=groups.map(([section,title,pages])=>'<h2>'+title+'</h2>'+pages.map(page=>'<article id="manual-'+section+'-'+page.id+'">'+p109GuidePageHtml(page,section).replace(/<figure>[\s\S]*?<\/figure>/g,'').replace(/<button[^>]*data-guide-link="([^"|]+)\|([^"]+)"[^>]*>([\s\S]*?)<\/button>/g,'<a href="#manual-$1-$2">$3</a>').replace(/<button[^>]*>([\s\S]*?)<\/button>/g,'<span>［$1：在程序帮助中操作］</span>')+'</article>').join('')).join('');
 return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AttendScope 使用教程</title><style>body{max-width:980px;margin:40px auto;padding:0 25px;color:#29465b;font:16px/1.9 system-ui,"Microsoft YaHei",sans-serif}h1,h2,h3,h4{line-height:1.5}h2{border-bottom:1px solid #cbdbe6;padding-top:24px}h3{font-size:25px}h4{font-size:19px;margin:25px 0 8px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #d7e1e9;padding:9px;text-align:left}pre{white-space:pre-wrap;background:#f1f6fa;padding:18px}.r82-guide-note{background:#f0f6fb;padding:15px;border-left:4px solid #6e9dbc}article{padding-top:20px}a{color:#246fa2}li{margin:8px 0}@media print{body{max-width:none;margin:0;font-size:12px}article{break-before:page}a{color:inherit}}</style><h1>AttendScope 详细使用教程</h1><p>'+P109_APP_VERSION+' / '+P109_APP_REVISION+' · 离线文字版 · 示例月份 '+monthKey()+'</p><p>所有练习人员均为虚构。图片及练习 CSV 下载按钮请在程序帮助中使用。本文件没有脚本、外部依赖或业务数据。</p><nav>'+toc+'</nav>'+body+'</html>';
}
function p109GuideExportManual(){downloadBlob(new Blob([p109GuideManualHtml()],{type:'text/html;charset=utf-8'}),'AttendScope-'+P109_APP_REVISION+'-详细教程.html')}
