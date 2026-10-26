'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,root,out})=>{
 root=path.resolve(root);fs.mkdirSync(out,{recursive:true});const checks=[],errors=[],check=(ok,label)=>{assert(ok,label);checks.push(label)};
 const context=await browser.newContext({viewport:{width:1366,height:768},acceptDownloads:true});
 try{
  await context.addInitScript(()=>{
   Object.defineProperty(window,'DecompressionStream',{configurable:true,value:undefined});
   try{delete Blob.prototype.arrayBuffer;delete Blob.prototype.text}catch(_){}
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});page.on('dialog',dialog=>dialog.accept());
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);
  check(await page.evaluate(()=>window.XLSX?.version==='0.20.3'&&typeof P109_TABLES?.readGrid==='function'),'bundled SheetJS 0.20.3 loads offline before the application adapter');
  check(await page.evaluate(()=>typeof Blob.prototype.arrayBuffer==='function'&&typeof Blob.prototype.text==='function'),'legacy Blob reading fallbacks are installed');
  const samples=await page.evaluate(async()=>{
   const rows=[['姓名','打卡时间','进出'],['旧表甲','2026-10-08 08:25:00','进'],['旧表甲','2026-10-08 11:45:00','出'],['旧表甲','2026-10-08 13:25:00','进'],['旧表甲','2026-10-08 17:20:00','出']];
   const build=bookType=>{const workbook=window.XLSX.utils.book_new(),sheet=window.XLSX.utils.aoa_to_sheet(rows);window.XLSX.utils.book_append_sheet(workbook,sheet,'考勤');return window.XLSX.write(workbook,{bookType,type:'array',compression:true})};
   const xlsx=build('xlsx'),xls=build('xls'),gx=await P109_TABLES.readGrid(new File([xlsx],'压缩表.xlsx')),gl=await P109_TABLES.readGrid(new File([xls],'旧版表.xls'));
   return {xlsx:Array.from(new Uint8Array(xlsx)),xls:Array.from(new Uint8Array(xls)),xlsxRows:gx.rows,xlsRows:gl.rows,xlsxEncoding:gx.encoding,xlsEncoding:gl.encoding};
  });
  check(samples.xlsxRows.length===5&&samples.xlsxRows[1].cells[0]==='旧表甲'&&samples.xlsxEncoding==='xlsx','compressed XLSX imports without browser deflate-raw support');
  check(samples.xlsRows.length===5&&samples.xlsRows[4].cells[2]==='出'&&samples.xlsEncoding==='xls','legacy BIFF8 XLS imports with Chinese text and row numbers');
  check(await page.locator('#attendanceInput').getAttribute('accept')==='.xls,.xlsx,.csv','business picker explicitly accepts XLS, XLSX and CSV');
  await page.locator('#r80Work').click();await page.locator('#r85NewPortable').click();await page.waitForFunction(()=>state.projectDir?.__p109Portable&&!p109ProjectBusy);
  await page.locator('#attendanceInput').setInputFiles({name:'旧版考勤.xls',mimeType:'application/vnd.ms-excel',buffer:Buffer.from(samples.xls)});
  await page.waitForFunction(()=>!!r62ImportDraft);await page.locator('#r62Validate').click();
  await page.waitForFunction(()=>r62ImportDraft?.validated?.rows.length===4);
  check(await page.evaluate(()=>r62ImportDraft.grid.encoding==='xls'&&r62ImportDraft.validated.rows.every(row=>row['姓名']==='旧表甲')),'real import wizard validates an XLS file in portable mode');
  await page.locator('#r62Commit').click();await page.waitForFunction(()=>!r62ImportDraft&&!state.importCommitting&&state.records.length===4);
  check(await page.evaluate(()=>state.records.length===4&&state.imports[0].name==='旧版考勤.xls'&&p109SourceCache.get(state.imports[0].id)?.size>0),'XLS import commits records and preserves the original file bytes');
  await page.evaluate(()=>{state.dataSection='storage';navigateWorkspace('data')});
  check((await page.locator('.p109-environment').textContent()).includes('离线支持 XLS、XLSX，不依赖浏览器 deflate-raw'),'environment panel reports the bundled Excel path');
  check(errors.length===0,'legacy Excel flow has no script or console errors');
  fs.writeFileSync(path.join(out,'r99-audit.json'),JSON.stringify({checks,errors},null,2));
  console.log('P109_R99_AUDIT_PASS '+JSON.stringify({checks:checks.length,errors:errors.length}));
 }finally{await context.close()}
};
