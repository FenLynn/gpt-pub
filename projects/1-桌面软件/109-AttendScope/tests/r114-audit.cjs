'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,root,out})=>{
 const context=await browser.__p109RawNewContext({viewport:{width:1366,height:768}}),page=await context.newPage(),checks={},errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const check=(ok,name)=>{checks[name]=!!ok;assert(ok,'R114: '+name)},tap=async(count=5)=>{
  const r=await page.locator('#settingsBtn').boundingBox();assert(r,'settings has a viewport location');for(let i=0;i<count;i++)await page.mouse.click(r.x+r.width/2,r.y+r.height/2);
 },fingerprint=()=>page.evaluate(()=>p109SessionFingerprint());
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);
  await tap(4);check(!await page.locator('#p109AccessOverlay').count(),'welcomeFourClicksStayHidden');await tap(1);await page.waitForSelector('#p109AccessKey');
  check(await page.locator('#p109ModeOverlay').isVisible(),'welcomeNotRemoved');await page.locator('#p109AccessClose').click();
  await page.locator('#r80Work').click();await page.waitForSelector('#r80ConnectProject');await tap();await page.waitForSelector('#p109AccessKey');
  check(await page.locator('#r80WorkTitle').isVisible(),'workHomeRemainsBehindRecovery');await page.locator('#p109AccessClose').click();
  await page.evaluate(()=>window.showDirectoryPicker=async()=>p109MemoryRoot('空目录复现'));
  await page.locator('#r80ConnectProject').click();await page.waitForSelector('#p109ProjectClose');const before=await fingerprint();
  check(await page.evaluate(()=>{const b=document.getElementById('settingsBtn').getBoundingClientRect();return !!document.elementFromPoint(b.x+b.width/2,b.y+b.height/2).closest('.p109-project-overlay')}),'initializationReallyCoversSettings');
  await tap(4);check(!await page.locator('#p109AccessOverlay').count(),'coveredFourClicksStayHidden');
  check(await page.locator('.p109-project-overlay').isVisible()&&await fingerprint()===before,'fourClicksDoNotCloseOrChangeProject');
  await tap(1);await page.waitForSelector('#p109AccessKey');
  check(await page.evaluate(()=>{const r=document.querySelector('.r101-access-card').getBoundingClientRect();return !!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2).closest('#p109AccessOverlay')}),'recoveryIsActuallyOnTop');
  await page.screenshot({path:path.join(out,'r114-covered-project.png')});
  await page.mouse.click(15,15);await page.keyboard.press('Escape');check(await page.locator('#p109AccessOverlay').count()===1&&await page.locator('.p109-project-overlay').count()===1,'backgroundAndEscapePreserveBothDialogs');
  await page.locator('#p109AccessKey').fill('wrong');await page.locator('#p109AccessUnlock').click();await page.waitForFunction(()=>document.querySelector('#p109AccessError')?.textContent==='输入无效');
  check(!await page.evaluate(()=>p109AccessAuthorized()),'wrongKeyCannotUnlock');
  await page.locator('#p109AccessKey').fill('bairiyishanjinhuangheruhailiu');await page.locator('#p109AccessUnlock').click();await page.waitForSelector('#p109AccessRenew');
  check(await page.evaluate(()=>p109AccessAuthorized())&&await fingerprint()===before,'unlockPreservesOriginalProjectSession');
  await page.locator('#p109AccessClose').click();check(await page.locator('.p109-project-overlay').isVisible(),'unlockReturnsToSameProjectDialog');
  await tap();await page.waitForSelector('#p109AccessRenew');check(await page.locator('.p109-project-overlay').isVisible(),'authorizedCoveredSettingsAlsoWork');
  await page.locator('#p109AccessClose').click();await page.locator('#p109ProjectClose').click();check(!await page.locator('.p109-project-overlay').count(),'originalProjectCanCloseAfterUnlock');
  await page.evaluate(async()=>{await p109NewPortable();await saveWorking()});const saved=await page.evaluate(async()=>({fingerprint:p109SessionFingerprint(),token:(await p109CacheRead()).token,hash:(await p109CacheRead()).sha256}));
  await page.evaluate(()=>p109ShowStorageFallback('目录没有写权限'));await page.waitForSelector('#p109FallbackReason');
  await page.evaluate(()=>p109AccessWrite({v:1,verified:true,activatedAt:Date.now()-8*86400000,expiresAt:Date.now()-1}));
  await tap();await page.waitForSelector('#p109AccessRenew');await page.locator('#p109AccessRenew').click();
  check(await page.evaluate(()=>p109AccessAuthorized()),'expiredFallbackCanRenew');await page.locator('#p109AccessClose').click();
  check(await page.locator('#p109FallbackReason').isVisible(),'fallbackDialogPreserved');await page.locator('#p109TransferClose').click();
  check(await page.evaluate(async saved=>{const r=await p109CacheRead();return p109SessionFingerprint()===saved.fingerprint&&r.token===saved.token&&r.sha256===saved.hash},saved),'recoveryDoesNotWriteCacheOrBusinessState');
  await page.evaluate(()=>{
   window.__r114Write=p109CacheWrite;p109CacheWrite=async(...args)=>{await new Promise(resolve=>window.__r114ResumeWrite=resolve);return __r114Write(...args)};
   window.__r114Saving=p109SaveLocalCache();
  });await page.waitForFunction(()=>typeof __r114ResumeWrite==='function');
  await page.evaluate(()=>{p109AccessWrite({v:1,verified:true,expiresAt:Date.now()-1});p109ShowStorageFallback('正在保存')});
  await tap();await page.waitForSelector('#p109AccessRenew');await page.locator('#p109AccessRenew').click();
  check(await page.evaluate(()=>state.storageBusy&&p109AccessAuthorized()),'inFlightSaveContinuesDuringRecovery');
  await page.locator('#p109AccessClose').click();await page.locator('#p109TransferClose').click();
  check(await page.evaluate(async()=>{__r114ResumeWrite();try{return await __r114Saving&&!state.storageBusy&&state.saved}finally{p109CacheWrite=__r114Write}}),'inFlightSaveFinishesAndVerifiesAfterRecovery');
  for(const width of [1280,1440,1920]){
   await page.setViewportSize({width,height:900});await page.evaluate(()=>p109ShowRecentProjects());await page.waitForSelector('#p109RecentOverlay');await tap();await page.waitForSelector('#p109AccessRenew');
   check(await page.locator('#p109RecentOverlay').isVisible(),'responsiveCoveredHitArea'+width);await page.locator('#p109AccessClose').click();await page.locator('#p109RecentClose').click();
  }
  await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>p109ShowStorageFallback('区域边界核查'));
  const r=await page.locator('#settingsBtn').boundingBox();for(let i=0;i<5;i++)await page.mouse.click(r.x+r.width+2,r.y+r.height/2);
  check(!await page.locator('#p109AccessOverlay').count(),'outsideSettingsDoesNotTrigger');
  await tap(4);await page.waitForTimeout(6100);await tap(1);check(!await page.locator('#p109AccessOverlay').count(),'sixSecondCounterResets');await tap(4);await page.waitForSelector('#p109AccessRenew');
  await page.keyboard.press('Tab');check(await page.evaluate(()=>!!document.activeElement.closest('#p109AccessOverlay')),'keyboardFocusStaysInVersionDialog');
  await page.screenshot({path:path.join(out,'r114-renew-dialog.png')});await page.locator('#p109AccessClose').click();await page.locator('#p109TransferClose').click();
  await page.locator('#settingsBtn').click();await page.waitForSelector('#settingsOverlay:not(.hidden)');check(await page.locator('#settingsContent').isVisible(),'ordinaryAuthorizedSettingsStillOpen');
  await page.locator('[data-settings-section="advanced"]').click();for(let i=0;i<5;i++)await page.locator('[data-p109-access-version]').click();await page.waitForSelector('#p109AccessRenew');
  check(await page.locator('#settingsOverlay:not(.hidden)').count()===1,'originalVersionEntryRetained');await page.locator('#p109AccessRevoke').click();await page.waitForSelector('#p109AccessKey');
  check(!await page.evaluate(()=>p109AccessAuthorized()),'revokeStillLocks');await page.locator('#p109AccessClose').click();await tap();await page.waitForSelector('#p109AccessKey');
  check(await page.locator('#settingsOverlay:not(.hidden)').count()===1,'revokedSettingsCanRecoverWithoutClosing');
  check(!errors.length,'noRuntimeErrors');fs.writeFileSync(path.join(out,'r114-audit.json'),JSON.stringify({checks,errors},null,2));
  console.log('P109_R114_AUDIT_PASS '+JSON.stringify({checks:Object.keys(checks).length}));
 }finally{await context.close()}
};
