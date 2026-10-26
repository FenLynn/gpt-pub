(function(root){
 'use strict';
 function check(environment){
  var target=environment||root,missing=[];
  try{new Function('var value={item:1}; return value?.item ?? 0;')()}
  catch(_){missing.push('现代 JavaScript 语法')}
  var names=['Promise','Map','Set','Uint8Array','FileReader','Blob','URL','DOMParser','TextEncoder','TextDecoder'];
  for(var i=0;i<names.length;i++)if(typeof target[names[i]]==='undefined')missing.push(names[i]);
  return {supported:missing.length===0,missing:missing};
 }
 function show(result){
  var panel=root.document&&root.document.getElementById('p109LegacyBrowser');
  if(!panel||result.supported)return;
  panel.style.display='flex';panel.removeAttribute('hidden');
  var detail=panel.getElementsByTagName('p')[0];
  if(detail)detail.innerText='当前浏览器内核缺少：'+result.missing.join('、')+'。请切换 360 极速模式或使用可运行本程序的 Chrome / Edge。';
 }
 root.p109LegacyBrowserCheck=check;
 var result=check();root.P109_LEGACY_UNSUPPORTED=!result.supported;
 if(root.document){if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',function(){show(result)});else show(result)}
})(window);
