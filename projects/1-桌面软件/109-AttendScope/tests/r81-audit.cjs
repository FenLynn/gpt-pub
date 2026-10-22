/* Pure HTML acceptance. Real browser OPFS/IDB, real beforeunload dialogs;
 * clipboard capture is isolated so the user's system clipboard is untouched. */
'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,out,root})=>{
 const report={revision:'R81',checks:[],externalPickerVerified:false,systemClipboardModified:false},errors=[];
 const check=(ok,label)=>{assert(ok,label);report.checks.push(label)};
 const server=http.createServer((req,res)=>{
  const target=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!target.startsWith(path.resolve(root)+path.sep)){res.writeHead(403);res.end();return}
  try{res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(target)]||'application/octet-stream');res.end(fs.readFileSync(target))}catch(_){res.writeHead(404);res.end()}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 const storage=async(target=page)=>{await target.evaluate(()=>r69NavigateData('storage'));await target.waitForSelector('.r82-storage-locations')};
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await context.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__r81Copied=text}}})});
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.evaluate(()=>p109RecentReady);
  check(await page.locator('#r80Demo').isVisible(),'no default Work project starts with a mode choice');
  await page.locator('#r80Demo').click();await page.reload();await page.evaluate(()=>p109RecentReady);
  check(await page.locator('#r80Demo').isVisible(),'Demo preference never bypasses the choice without a default Work project');
  await page.locator('#r80Work').click();await page.locator('#r80MemoryWork').click();
  await page.reload();await page.evaluate(()=>p109RecentReady);
  check(await page.locator('#r80Work').isVisible(),'temporary Work preference never bypasses the choice without a default project');
  await page.locator('#r80Work').click();
  await page.evaluate(async()=>{
   const root=await navigator.storage.getDirectory();window.__r81Root=await root.getDirectoryHandle('R81 中文项目 '+crypto.randomUUID(),{create:true});
   window.showDirectoryPicker=async()=>__r81Root;
  });await page.locator('#r80NewProject').click();await page.waitForFunction(()=>state.projectDir&&state.saved&&!p109ProjectBusy);
  const name=await page.evaluate(()=>state.projectDir.name),note='Q:\\测试数据\\'+name;
  check(await page.locator('.r81-project-location,#p109ProgramPath').count()===0,'paths do not occupy the main project overview');
  await storage();
  check((await page.locator('.r81-project-location').textContent()).includes('浏览器仅提供目录名'),'unknown absolute paths are labelled honestly');
  check((await page.locator('#p109ProgramPath').textContent()).includes('浏览器未提供本机程序路径'),'hosted preview does not invent a local program path');
  await page.locator('#r81CopyProject').click();await page.locator('#r81PathInput').fill(note+'\\project.json');await page.locator('#r81PathOverlay [type=submit]').click();
  check((await page.locator('#r81PathError').textContent()).includes('不要包含文件名'),'a project file path cannot be recorded as a directory');
  await page.locator('#r81PathInput').fill('"'+note+'\\"');await page.locator('#r81PathOverlay [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#r81PathOverlay'));
  check(await page.evaluate(note=>__r81Copied===note&&p109ProjectDirectoryNote()===note,note),'record-and-copy keeps only the complete directory path');
  check((await page.locator('.r81-project-location').textContent()).includes('手动记录'),'manually recorded paths are visibly distinguished from verified browser facts');
  await page.locator('#r81ProjectBrowse').click();await page.waitForSelector('.r80-directory-list');
  check((await page.locator('#r80FileBody').textContent()).includes('project.json'),'project path still opens the actual authorized page file browser');
  await page.keyboard.press('Escape');
  await page.reload();await page.evaluate(()=>p109RecentReady);
  check(await page.evaluate(note=>state.projectDir&&p109ProjectDirectoryNote()===note&&!document.querySelector('#p109ModeOverlay'),note),'default Work and the local directory note survive reload');
  await page.locator('#p109ModeSwitch').click();await page.locator('#r80Demo').click();await page.reload();await page.evaluate(()=>p109RecentReady);
  check(await page.evaluate(()=>state.projectDir&&!state.isDemo),'a default Work project is resumed even after a previous Demo session');
  await storage();
  await page.locator('#p109Help').click();
  check(await page.locator('.r81-help-steps li').count()===5,'quick start provides the actual five-step working flow');
  await page.screenshot({path:path.join(out,'r81-help-start.png')});
  await page.locator('[data-help-section="topics"]').click();
  const required={attendance:['姓名','日期时间','未标注'],leave:['结束日期','班次边界'],trip:['追加合并','来源'],outing:['开始时间','结束时间'],overtime:['登记','区间合并'],roster:['跨搜索','目标组别'],storage:['project.json','working/','snapshots/'],save:['是否离开','保存','完整备份']};
  for(const topic of Object.keys(required)){
   await page.locator('[data-help-topic="'+topic+'"]').click();
   const text=await page.locator('#r81HelpArticle').textContent();
   check(required[topic].every(word=>text.includes(word)),'topic guide explains required fields and actual behavior: '+topic);
  }
  await page.locator('[data-help-topic="storage"]').click();await page.screenshot({path:path.join(out,'r81-help-storage.png')});
  await page.keyboard.press('Escape');
  check(await page.locator('#p109HelpOverlay').count()===0&&await page.locator('#p109Help').evaluate(el=>el===document.activeElement),'Escape closes only help and returns focus to its button');
  await page.evaluate(()=>{state.saved=false;render()});
  check(await page.locator('#r81SaveReminder').isVisible(),'unsaved work is visible before closing');
  let blocked=0;page.removeAllListeners('dialog');page.on('dialog',async d=>{if(d.type()==='beforeunload'){blocked++;await d.dismiss()}else await d.accept()});
  await page.reload({timeout:5000}).catch(e=>{if(!/ERR_ABORTED|interrupted|Timeout/.test(e.message))throw e});
  check(blocked===1&&!page.isClosed()&&await page.evaluate(()=>!state.saved),'a real browser beforeunload dialog can cancel leaving unsaved work');
  await page.locator('#r81SaveReminder').click();await page.waitForFunction(()=>state.saved&&!state.storageBusy);
  await page.reload();await page.evaluate(()=>p109RecentReady);
  check(blocked===1&&await page.evaluate(()=>state.saved),'saved work reloads without a false unsaved warning');
  await storage();
  await page.evaluate(()=>{switchMonth(2026,11,true);switchMonth(2026,10);render()});
  check(await page.evaluate(()=>state.saved&&p109UnsavedMonths().includes('2026-11')),'a dirty background month is detected even when the current month is saved');
  await page.reload({timeout:5000}).catch(e=>{if(!/ERR_ABORTED|interrupted|Timeout/.test(e.message))throw e});
  check(blocked===2,'dirty background months also block browser navigation');
  await page.evaluate(async()=>{switchMonth(2026,11);await saveWorking();switchMonth(2026,10)});
  await page.locator('#r81CopyProject').click();check(await page.evaluate(note=>__r81Copied===note,note),'a remembered directory note can be copied directly');
  await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw new DOMException('Denied','NotAllowedError')}});await page.locator('#r81CopyProject').click();
  check(await page.locator('#r81CopyOverlay textarea').inputValue()===note,'denied clipboard access offers the exact directory text for manual copy');
  await page.keyboard.press('Shift+Tab');check(await page.locator('#r81CopyClose').evaluate(el=>el===document.activeElement),'manual-copy dialog keeps keyboard focus inside');
  await page.keyboard.press('Escape');await page.screenshot({path:path.join(out,'r81-work-paths.png')});
  await page.evaluate(()=>{window.__r81RecentWrite=p109RecentWrite;p109RecentWrite=async()=>{throw Error('Test storage failure')};navigator.clipboard.writeText=async text=>{__r81Copied=text}});
  await page.locator('#r81EditProjectPath').click();await page.locator('#r81PathInput').fill(note);await page.locator('#r81PathOverlay [type=submit]').click();
  check(await page.locator('#r81PathOverlay').count()===0&&await page.evaluate(note=>p109ProjectDirectoryNote()===note,note),'unavailable history storage still allows a clearly temporary directory note');
  await page.evaluate(async()=>{p109RecentWrite=__r81RecentWrite;await p109RecentWrite(null,null,p109RecentState.lastId)});
  await page.reload();await page.evaluate(()=>p109RecentReady);
  check(await page.locator('#r80Demo').isVisible()&&await page.evaluate(async name=>{const home=await navigator.storage.getDirectory(),project=await home.getDirectoryHandle(name);return !!await project.getFileHandle('project.json')},name),'removing the default returns to the chooser without deleting project data');
  const filePage=await context.newPage();filePage.on('pageerror',e=>errors.push(e.message));
  try{
   await filePage.goto(pathToFileURL(path.join(root,'index.html')).href);await filePage.evaluate(()=>p109RecentReady);await filePage.locator('#r80Demo').click();
   await storage(filePage);
   const expected=await filePage.evaluate(()=>p109ProgramLocation());await filePage.locator('#r81CopyProgram').click();
   check(await filePage.evaluate(expected=>__r81Copied===expected&&!/index\.html/i.test(__r81Copied),expected),'file HTML copies the decoded program folder, without the entry filename');
   check(expected.includes(path.basename(root)),'program directory is derived from the actual local HTML location');
   await filePage.screenshot({path:path.join(out,'r81-local-program-path.png')});
  }finally{await filePage.close()}
  check(errors.length===0,'no browser script errors');
  fs.writeFileSync(path.join(out,'r81-audit.json'),JSON.stringify(report,null,2));console.log('P109_R81_AUDIT_PASS',JSON.stringify(report));
 }finally{await context.close();await new Promise(resolve=>server.close(resolve))}
};
