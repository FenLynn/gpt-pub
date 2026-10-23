'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
module.exports=async({browser,out,root})=>{
 root=path.resolve(root);const report={revision:'R86',checks:[]},errors=[],check=(v,label)=>{assert(v,label);report.checks.push(label)};
 const server=http.createServer((req,res)=>{const u=decodeURIComponent(new URL(req.url,'http://localhost').pathname),p=path.resolve(root,'.'+(u==='/'?'/index.html':u));
  if(!p.startsWith(root+path.sep)){res.writeHead(403);return res.end()}try{res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(p)]||'application/octet-stream');res.end(fs.readFileSync(p))}catch(_){res.writeHead(404);res.end()}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const context=await browser.newContext({viewport:{width:1366,height:900}}),page=await context.newPage();let cancel=true;
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>cancel?d.dismiss():d.accept());
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.evaluate(()=>p109RecentReady);await page.locator('#r80Work').click();await page.locator('#r85NewPortable').click();
  check(await page.locator('#r80WorkTitle').isVisible()&&await page.evaluate(()=>!state.projectDir&&!state.isDemo),'canceling portable initialization preserves the Work entry and empty session');
  cancel=false;await page.locator('#r85NewPortable').click();await page.waitForFunction(()=>!!state.projectDir&&!p109ProjectBusy);
  check(await page.locator('#p109ModeOverlay').count()===0,'successful portable initialization closes the entry');
  await page.evaluate(async()=>{
   const main=workingPayload(),originalTitle=state.prefs.appTitle;await freezeSnapshot();const snap=(await p109Entries(await existingDir(await monthDirectory(),'snapshots')))[0].name;await p109ForkSnapshot(monthKey(),snap);
   window.__branch=state.activeBranch;state.prefs.appTitle='十月修订保留';state.manualStatuses['review-marker|8']='normal';state.saved=false;rememberMonth();switchMonth(2026,11,true);
   const old={schemaVersion:1,projectId:'P109-AttendScope',context:'rescue',project:projectPayload(),months:[...state.monthStores],profile:null};delete old.project.monthBranches;window.__oldRescue=JSON.stringify(old);
   window.__portable=await p109PortableFromSession();window.__mainTitle=originalTitle;
  });
  check(await page.evaluate(async()=>{
   const loaded=await p109ReadProject(__portable,await readJSON(__portable,'project.json')),oct=loaded.months.get('2026-10');
   return loaded.current==='2026-11'&&loaded.months.size===2&&oct.activeBranch.id===__branch.id&&oct.prefs.appTitle==='十月修订保留'&&oct.manualStatuses['review-marker|8']==='normal';
  }),'complete project loading preserves a background month revision without changing the selected month');
  check(await page.evaluate(async()=>{
   const main=await readJSON(await existingDir(await existingDir(await existingDir(await existingDir(__portable,'data'),'2026'),'10'),'working'),'state.json');
   return main.prefs.appTitle===__mainTitle&&!main.manualStatuses['review-marker|8'];
  }),'background revision persistence leaves the main working state unchanged');
  check(await page.evaluate(async()=>{
   const rows=await p109PortableCollect(__portable),{zip}=await p109ZipBuild(rows);return p109OpenPortableFile(new File([zip],'month-revisions.zip'));
  }),'the actual complete ZIP can reopen the two-month revision project');
  await page.evaluate(()=>switchMonth(2026,10));
  check(await page.evaluate(()=>state.activeBranch.id===__branch.id&&state.prefs.appTitle==='十月修订保留'),'switching to the background month after ZIP restoration returns to its saved revision');
  check(await page.evaluate(()=>p109OpenPortableFile(new File([__oldRescue],'R85-rescue.json'))),'an older R85 rescue JSON with no per-month index remains readable');
  check(await page.evaluate(()=>state.monthStores.size===2&&state.monthStores.get('2026-10').activeBranch.id===__branch.id&&state.monthStores.get('2026-10').manualStatuses['review-marker|8']==='normal'),'older rescue restoration retains every loaded month and its background revision');
  await page.evaluate(()=>switchMonth(2026,10));await page.evaluate(()=>p109ReturnToMain());
  check(await page.evaluate(()=>state.activeBranch?.id===__branch.id),'a rescue workspace lacking the original main state refuses to silently fabricate a main state');
  await page.evaluate(()=>p109ShowUpdate(new File(['not a zip'],'invalid.zip')));
  check((await page.locator('.p109-update-web-note').textContent()).includes('不会更新网站'),'the same hosted program explicitly distinguishes local ZIP updates from site deployments');
  await page.screenshot({path:path.join(out,'r86-web-upgrade-boundary.png')});await page.keyboard.press('Escape');
  check(!errors.length,'review edge cases have no browser script errors');
  fs.writeFileSync(path.join(out,'r86-audit.json'),JSON.stringify(report,null,2));console.log('P109_R86_AUDIT_PASS '+JSON.stringify(report));
 }finally{await context.close();await new Promise(r=>server.close(r))}
};
