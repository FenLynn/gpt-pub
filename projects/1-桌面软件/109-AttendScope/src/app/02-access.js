'use strict';
const P109_ACCESS_STORAGE='p109-access-v1',P109_ACCESS_DAYS=7,
 P109_ACCESS_DIGEST='73f79639280ce4fe1bdf46d8f87f6f3a68548ec1ddd53defd9fb042f7974e71d';
let p109AccessMemory=null,p109AccessBypass=false,p109AccessSettingsWindow=false,
 p109AccessGearTaps=0,p109AccessGearTimer=0;
function p109AccessRead(){
 try{const value=JSON.parse(localStorage.getItem(P109_ACCESS_STORAGE)||'null');if(value?.v===1&&value.verified===true){p109AccessMemory=value;return value}}catch(_){}
 return p109AccessMemory;
}
function p109AccessWrite(value){
 p109AccessMemory=value;
 try{localStorage.setItem(P109_ACCESS_STORAGE,JSON.stringify(value));return localStorage.getItem(P109_ACCESS_STORAGE)===JSON.stringify(value)}catch(_){return false}
}
function p109AccessRemove(){p109AccessMemory=null;try{localStorage.removeItem(P109_ACCESS_STORAGE)}catch(_){}p109AccessPaintVersion()}
function p109AccessRequired(){return location.protocol==='file:'}
function p109AccessAuthorized(now=Date.now()){if(!p109AccessRequired())return true;const value=p109AccessRead();return !!(value?.verified&&Number.isFinite(value.expiresAt)&&value.expiresAt>now)}
function p109AccessRefresh(){
 const now=Date.now(),previous=p109AccessRead(),value={v:1,verified:true,activatedAt:previous?.activatedAt||now,refreshedAt:now,expiresAt:now+P109_ACCESS_DAYS*86400000};
 p109AccessWrite(value);p109AccessHideWait();p109AccessPaintVersion();return value;
}
function p109AccessPaintVersion(){
 document.querySelectorAll('[data-p109-access-version]').forEach(node=>{
  const active=p109AccessAuthorized();node.classList.toggle('is-active',active);
  node.title=active?'已启用':'版本信息';
 });
}
function p109AccessHideWait(){document.getElementById('p109AccessWait')?.setAttribute('hidden','')}
function p109AccessShowWait(){
 let node=document.getElementById('p109AccessWait');if(!node){node=document.createElement('div');node.id='p109AccessWait';node.className='r101-lock-wait';node.innerHTML='<i aria-label="加载中"></i>';document.body.appendChild(node)}
 node.removeAttribute('hidden');
}
function p109AccessDate(value){return new Date(value).toLocaleString('zh-CN',{hour12:false})}
function p109AccessDialog(){
 document.getElementById('p109AccessOverlay')?.remove();const record=p109AccessRead(),active=p109AccessAuthorized(),node=document.createElement('section');
 node.id='p109AccessOverlay';node.className='r101-access-overlay';node.innerHTML='<div class="r101-access-card" role="dialog" aria-modal="true" aria-labelledby="p109AccessTitle"><header><h3 id="p109AccessTitle">版本状态</h3><button type="button" id="p109AccessClose" aria-label="关闭">×</button></header>'+
  (record?.verified?'<div class="r101-access-meta"><span>密钥</span><strong>******************************</strong><span>状态</span><strong>'+(active?'有效':'需要刷新')+'</strong><span>截止</span><strong>'+p109AccessDate(record.expiresAt)+'</strong></div><div class="r101-access-actions"><button type="button" id="p109AccessRevoke">撤销</button><button type="button" class="primary" id="p109AccessRenew">刷新 7 天</button></div>':
  '<label><span>密钥</span><input id="p109AccessKey" type="password" autocomplete="off" spellcheck="false"></label><div id="p109AccessError" role="status"></div><div class="r101-access-actions"><button type="button" class="primary" id="p109AccessUnlock">确认</button></div>')+'</div>';
 document.body.appendChild(node);const close=()=>{node.remove();p109AccessPaintVersion()};node.querySelector('#p109AccessClose').onclick=close;
 node.addEventListener('click',event=>{if(event.target===node)close()});
 node.querySelector('#p109AccessRenew')?.addEventListener('click',()=>{p109AccessRefresh();close()});
 node.querySelector('#p109AccessRevoke')?.addEventListener('click',()=>{p109AccessRemove();close()});
 const submit=async()=>{const input=node.querySelector('#p109AccessKey'),error=node.querySelector('#p109AccessError'),candidate=String(input.value||'').trim().toLocaleLowerCase(),bytes=new TextEncoder().encode(candidate);
  if(await p109Digest(bytes)!==P109_ACCESS_DIGEST){error.textContent='输入无效';input.select();return}
  p109AccessRefresh();input.value='';close();
 };
 node.querySelector('#p109AccessUnlock')?.addEventListener('click',submit);node.querySelector('#p109AccessKey')?.addEventListener('keydown',event=>{if(event.key==='Enter')submit()});
 (node.querySelector('#p109AccessKey')||node.querySelector('#p109AccessRenew'))?.focus();
}
function p109BindAccessVersion(node){
 if(!node)return;p109AccessPaintVersion();let taps=0,timer=0;
 node.onclick=()=>{taps++;node.classList.remove('is-tap');void node.offsetWidth;node.classList.add('is-tap');clearTimeout(timer);timer=setTimeout(()=>taps=0,6000);if(taps>=5){taps=0;clearTimeout(timer);p109AccessDialog()}};
}
function p109AccessOpenSettings(){
 p109AccessSettingsWindow=true;p109AccessBypass=true;p109AccessHideWait();
 setTimeout(()=>{document.getElementById('settingsBtn')?.click();setTimeout(()=>document.querySelector('[data-settings-section="advanced"]')?.click(),0);p109AccessBypass=false},0);
}
function p109AccessTapGear(target){
 if(!target.closest?.('#settingsBtn'))return false;
 p109AccessGearTaps++;const button=target.closest('#settingsBtn');button.classList.remove('is-tap');void button.offsetWidth;button.classList.add('is-tap');
 clearTimeout(p109AccessGearTimer);p109AccessGearTimer=setTimeout(()=>p109AccessGearTaps=0,6000);
 if(p109AccessGearTaps>=5){p109AccessGearTaps=0;clearTimeout(p109AccessGearTimer);p109AccessOpenSettings()}return true;
}
function p109AccessGuard(event){
 if(P109_LEGACY_UNSUPPORTED||p109AccessBypass||p109AccessAuthorized()||document.getElementById('p109ModeOverlay'))return;
 if(p109AccessSettingsWindow&&event.target.closest?.('#settingsOverlay,#p109AccessOverlay'))return;
 if(event.type==='click'&&p109AccessTapGear(event.target)){event.preventDefault();event.stopImmediatePropagation();return}
 event.preventDefault();event.stopImmediatePropagation();if(event.type==='click')p109AccessShowWait();
}
document.addEventListener('click',p109AccessGuard,true);document.addEventListener('keydown',p109AccessGuard,true);
setInterval(()=>{p109AccessPaintVersion();if(p109AccessAuthorized())p109AccessHideWait()},60000);
window.p109BindAccessVersion=p109BindAccessVersion;window.p109AccessRequired=p109AccessRequired;window.p109AccessAuthorized=p109AccessAuthorized;window.p109AccessRead=p109AccessRead;window.p109AccessWrite=p109AccessWrite;window.p109AccessRefresh=p109AccessRefresh;window.p109AccessRemove=p109AccessRemove;
