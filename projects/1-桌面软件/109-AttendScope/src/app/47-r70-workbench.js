/* R70: presentation-only refinements on top of the proven inventory and chart renderers. */
'use strict';
const r70BaseProjectMarkup=r68ProjectMarkup;
r68ProjectMarkup=function(report,tree){
 const holder=document.createElement('div');holder.innerHTML=r70BaseProjectMarkup(report,tree);
 const summary=holder.querySelector('.r68-overview-cards');
 if(summary){
  if(!state.projectDir){
   summary.classList.add('r70-project-intro');
   summary.innerHTML='<div><h3>连接本地目录，开始管理考勤数据</h3><p>未连接时无法确认磁盘库存与健康状态。可选择已有项目目录，或初始化空白工作区。</p></div>'+
    '<button id="r70Begin" type="button" class="r68-btn primary">连接 / 初始化</button>';
  }else{
   const facts=[...summary.children].map(el=>({
    title:el.querySelector('span')?.textContent||'',value:el.querySelector('strong')?.textContent||''
   }));
   summary.classList.add('r70-project-facts');
   summary.innerHTML=facts.map(row=>'<span><em>'+r68Esc(row.title)+'</em><strong>'+r68Esc(row.value)+'</strong></span>').join('');
  }
 }
 return holder.innerHTML;
};
const r70BasePaint=r69PaintProjectSection;
r69PaintProjectSection=function(report,tree){
 r70BasePaint(report,tree);
 /* Empty-project overview: avoid repeating three variations of "no data". Each
  * destination remains individually accessible from Data Management navigation. */
 if(!state.projectDir&&state.dataSection==='overview'){
  const pane=document.getElementById('r69ProjectPane');
  pane?.querySelector('#r68MonthsCard')?.remove();
  pane?.querySelector('#r68HealthCard')?.remove();
 }
 document.getElementById('r70Begin')?.addEventListener('click',()=>openProjectControl());
};
function r70FlattenDataRail(){
 const root=document.getElementById('r68DataRail');
 if(!root||root.querySelector('.r70-rail-heading'))return;
 const cards=root.querySelectorAll(':scope > .r68-rail-card');
 if(!cards.length)return;
 const head=document.createElement('div');head.className='r70-rail-heading';
 head.innerHTML='<h3>项目目录</h3><span>'+(state.projectDir?'本地已连接':'未连接')+'</span>'+
  '<button type="button" class="r68-inline r70-rail-link">查看项目概况 →</button>';
 head.querySelector('button').onclick=()=>r69NavigateData('overview');
 cards[0].replaceWith(head);
 if(cards[1])cards[1].classList.add('r70-rail-tree');
}
const r70BaseFillRail=r68FillDataRail;
r68FillDataRail=async function(){
 await r70BaseFillRail();
 r70FlattenDataRail();
};
const r70BaseScope=r68ScopeRender;
r68ScopeRender=function(){
 r70BaseScope();
 const pane=document.getElementById('scopeInsights');
 if(!pane)return;
 const list=pane.querySelector('.r68-scope-kpis');
 if(list){
  list.classList.add('r70-metric-list');
  ['正常人日','异常人日','缺勤人日','异常及缺勤率'].forEach((label,i)=>{
   const small=list.children[i]?.querySelector('small');if(small)small.textContent=label;
  });
 }
 const node=document.getElementById('scopeDailyChart');
 const chart=node&&typeof echarts!=='undefined'?echarts.getInstanceByDom(node):null;
 if(chart)chart.setOption({xAxis:{axisLabel:{fontSize:12,color:'#687f91'}},
  yAxis:{axisLabel:{fontSize:12,color:'#687f91'}}},false);
};
renderScopeSummary=r68ScopeRender;
render();
