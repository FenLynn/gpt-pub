'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,root,out})=>{
 root=path.resolve(root);fs.mkdirSync(out,{recursive:true});const checks=[],errors=[],check=(ok,label)=>{assert(ok,label);checks.push(label);console.log('R100 '+label)};
 const context=await browser.newContext({viewport:{width:1366,height:768},acceptDownloads:true});
 try{
  await context.addInitScript(()=>{Object.defineProperty(window,'DecompressionStream',{configurable:true,value:undefined});try{delete Blob.prototype.arrayBuffer;delete Blob.prototype.text}catch(_){}});
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});page.on('dialog',dialog=>dialog.accept());
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);
  const bytes=await page.evaluate(()=>{
   const book=window.XLSX.utils.book_new(),add=(name,rows)=>window.XLSX.utils.book_append_sheet(book,window.XLSX.utils.aoa_to_sheet(rows),name);
   add('一组',[['姓名','打卡时间','进出'],['多表甲','2026-10-08 08:20:00','进']]);
   add('二组',[['姓名','打卡时间','进出'],['多表乙','2026-10-08 08:21:00','进']]);
   add('说明',[['请勿导入'],['这是说明页']]);add('空表',[]);
   return Array.from(new Uint8Array(window.XLSX.write(book,{bookType:'xlsx',type:'array',compression:true})));
  });
  const file={name:'多工作表.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes)};
  await page.evaluate(()=>{p109WriteMode('work');p109BlankWork();document.getElementById('p109ModeOverlay')?.remove()});await page.locator('#attendanceInput').setInputFiles(file);await page.waitForFunction(()=>!!r62ImportDraft);
  check(await page.evaluate(()=>r62ImportDraft.grid.sheet==='一组'&&r62ImportDraft.grid.sheets.length===4&&r62ImportDraft.grid.sheets.find(x=>x.name==='空表').empty),'all worksheets are discovered and the first nonempty sheet is selected safely');
  check(await page.locator('#r100Sheet option').allTextContents().then(rows=>rows.some(x=>x.includes('合并全部非空表'))),'import UI offers an explicit merge-all-sheets choice');
  await page.evaluate(()=>{const select=document.querySelector('#r100Sheet');select.value='__all__';select.dispatchEvent(new Event('change',{bubbles:true}))});
  await page.waitForFunction(()=>r62ImportDraft?.grid.sheetChoice==='__all__');
  await page.locator('#r62Validate').click();await page.waitForFunction(()=>r62ImportDraft?.validated?.rows.length===2);
  check(await page.evaluate(()=>r62ImportDraft.validated.rows.map(x=>x.__sheet).join(',')==='一组,二组'&&r62ImportDraft.validated.failed.some(x=>String(x.reason).includes('表头'))),'matching sheets merge while a structurally different notes sheet is isolated');
  await page.locator('#r62Commit').click();await page.waitForFunction(()=>!r62ImportDraft&&!state.importCommitting&&state.records.length===2);
  check(await page.evaluate(()=>state.records.map(x=>x.sheet).sort().join(',')==='一组,二组'&&state.imports.length===1),'multi-sheet import stores one immutable source and preserves each row sheet');
  check(await page.evaluate(()=>new Set(state.records.map(x=>x.recordId)).size===2),'same row numbers from different sheets receive distinct record identities');
  check(await page.evaluate(()=>p109SaveLocalCache()),'portable project saves a verified local cache snapshot');
  await page.reload();await page.evaluate(()=>p109RecentReady);
  check(await page.evaluate(()=>state.projectDir?.__p109Portable&&state.records.length===2&&state.records.every(x=>['一组','二组'].includes(x.sheet))),'reopening the same index automatically restores the cached ZIP project without choosing a file');
  check(errors.length===0,'multi-sheet and cached reopen flow has no script or console errors');
  fs.writeFileSync(path.join(out,'r100-audit.json'),JSON.stringify({checks,errors},null,2));
  console.log('P109_R100_AUDIT_PASS '+JSON.stringify({checks:checks.length,errors:errors.length}));
 }finally{await context.close()}
};
