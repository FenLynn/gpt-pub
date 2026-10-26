'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,out,root})=>{
 root=path.resolve(root);const checks=[],errors=[],check=(value,label)=>{assert(value,label);checks.push(label)};
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  const made=await page.evaluate(async()=>{p109BlankWork();await p109NewPortable();return await p109SaveLocalCache()});
  check(made&&await page.evaluate(()=>!!state.projectDir?.__p109Portable&&p109AutoOpenAllowed()),'portable project is cached and initially eligible for automatic reopening');
  await page.evaluate(()=>p109ShowRecentProjects());await page.locator('#p109RecentDetachCurrent').click();
  await page.waitForFunction(()=>document.querySelector('#p109RecentStatus')?.textContent.includes('当前页面继续使用'));
  const detached=await page.evaluate(()=>({same:!!state.projectDir?.__p109Portable,allowed:p109AutoOpenAllowed(),message:document.querySelector('#p109RecentStatus')?.textContent||''}));
  check(detached.same&&!detached.allowed&&detached.message.includes('当前页面继续使用'),'removing the current project keeps the live session and disables the next automatic load');
  await page.evaluate(()=>document.getElementById('p109RecentOverlay')?.remove());
  check(await page.evaluate(()=>p109SaveLocalCache().then(()=>!p109AutoOpenAllowed()&&!!state.projectDir)),'saving a detached portable session does not silently restore automatic loading');
  await page.reload();await page.evaluate(()=>p109RecentReady);
  check(await page.evaluate(()=>!!document.getElementById('p109ModeOverlay')&&!state.projectDir),'a new page returns to the Demo or Work chooser instead of restoring a removed project');
  await page.locator('#r80Work').click();await page.waitForSelector('#r102RestoreCache');await page.locator('#r102RestoreCache').click();
  await page.waitForFunction(()=>!!state.projectDir?.cacheSavedAt);
  check(await page.evaluate(()=>!!state.projectDir?.__p109Portable&&p109AutoOpenAllowed()),'the retained browser cache can be restored explicitly from Work');
  check(!errors.length,'R102 project lifecycle has no script errors: '+errors.join(' | '));
 }finally{await context.close()}
 const raw=await browser.__p109RawNewContext({viewport:{width:1440,height:900}}),locked=await raw.newPage(),lockErrors=[];
 locked.on('pageerror',error=>lockErrors.push(error.message));
 try{
  await locked.goto(pathToFileURL(path.join(root,'index.html')).href);await locked.evaluate(()=>p109RecentReady);await locked.locator('#r80Demo').click();
  await locked.locator('[data-workspace="person"]').click();await locked.waitForSelector('#p109AccessWait:not([hidden])');
  const visual=await locked.evaluate(()=>{const wait=document.getElementById('p109AccessWait'),style=getComputedStyle(wait),ring=getComputedStyle(wait.querySelector('i'));return {background:style.backgroundColor,filter:style.backdropFilter||style.webkitBackdropFilter||'none',duration:ring.animationDuration,source:p109AccessScheduleWaitMotion.toString()}});
  check((visual.background==='rgba(0, 0, 0, 0)'||visual.background==='transparent')&&visual.filter==='none'&&visual.duration==='2s'&&visual.source.includes('Math.random'),'locked page stays crisp while the two-second spinner uses sparse randomized pauses');
  for(let i=0;i<5;i++)await locked.locator('#settingsBtn').click();await locked.waitForSelector('#settingsOverlay.r101-access-recovery:not(.hidden)');
  check(await locked.locator('#p109AccessWait:not([hidden])').count()===1,'recovery settings floats above the continuing spinner');
  await locked.screenshot({path:path.join(out,'r102-locked-settings.png')});
  await locked.evaluate(()=>document.getElementById('settingsOverlay').click());await locked.keyboard.press('Escape');
  check(await locked.locator('#settingsOverlay:not(.hidden)').count()===1,'settings recovery does not close from its background or Escape');
  await locked.locator('#settingsClose').click();check(await locked.locator('#settingsOverlay:not(.hidden)').count()===0,'the settings recovery closes from its upper-right control');
  for(let i=0;i<5;i++)await locked.locator('#settingsBtn').click();await locked.waitForSelector('#settingsOverlay.r101-access-recovery:not(.hidden)');
  for(let i=0;i<5;i++)await locked.locator('[data-p109-access-version]').click();await locked.waitForSelector('#p109AccessKey');
  await locked.screenshot({path:path.join(out,'r102-access-dialog.png')});
  await locked.evaluate(()=>document.getElementById('p109AccessOverlay').click());
  check(await locked.locator('#p109AccessOverlay').count()===1,'version dialog ignores background dismissal');
  await locked.locator('#p109AccessKey').fill('bairiyishanjinhuangheruhailiu');await locked.locator('#p109AccessUnlock').click();
  check(await locked.evaluate(()=>p109AccessAuthorized()&&!!document.getElementById('p109AccessOverlay')&&document.getElementById('p109AccessWait').hidden),'unlocking stops the spinner but keeps the result dialog until explicit close');
  await locked.locator('#p109AccessClose').click();check(await locked.locator('#settingsOverlay:not(.hidden)').count()===1,'closing version status returns to the floating settings window');
  await locked.locator('#settingsClose').click();check(await locked.locator('#settingsOverlay:not(.hidden)').count()===0,'settings closes only after its upper-right close action');
  check(!lockErrors.length,'R102 access presentation has no script errors: '+lockErrors.join(' | '));
 }finally{await raw.close()}
 fs.writeFileSync(path.join(out,'r102-audit.json'),JSON.stringify({checks,errors},null,2));console.log('P109_R102_AUDIT_PASS '+JSON.stringify({checks:checks.length,errors:errors.length}));
};
