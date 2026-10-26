'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,root,out})=>{
 const context=await browser.newContext({viewport:{width:1600,height:900}}),page=await context.newPage(),errors=[],remote=[],report={checks:[],geometry:[]};
 const check=(ok,label)=>{assert(ok,label);report.checks.push(label)};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url())});page.on('dialog',d=>d.accept());
 const csv='姓名,打卡时间,进出\n测试甲,2026-10-08 08:30:00,进\n测试甲,2026-10-08 17:10:00,出';
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  await page.evaluate(content=>r62OpenImport(new File([content],'固定高度.csv',{type:'text/csv'}),'attendance'),csv);await page.waitForSelector('#r62Commit');
  for(const size of [{width:1280,height:720},{width:1366,height:768},{width:1600,height:900},{width:1920,height:1080}]){
   await page.setViewportSize(size);
   const geometry=await page.evaluate(()=>{const dialog=document.querySelector('.r62-dialog'),body=document.querySelector('.r62-body'),header=dialog.querySelector(':scope>header'),footer=dialog.querySelector(':scope>footer'),r=dialog.getBoundingClientRect();return {height:r.height,target:innerHeight*.8,bodyOverflow:getComputedStyle(body).overflowY,headerVisible:header.getBoundingClientRect().top>=r.top-1,footerVisible:footer.getBoundingClientRect().bottom<=r.bottom+1}});
   report.geometry.push({...size,...geometry});check(Math.abs(geometry.height-geometry.target)<=1&&geometry.bodyOverflow==='auto'&&geometry.headerVisible&&geometry.footerVisible,'import dialog is fixed at 80 percent with an independently scrollable body '+size.width+'x'+size.height);
  }
  await page.setViewportSize({width:1280,height:720});await page.locator('#r79Advanced').evaluate(el=>el.open=true);
  const scroll=await page.evaluate(()=>{const body=document.querySelector('.r62-body'),marker=document.createElement('div');marker.style.height='900px';body.appendChild(marker);const before=body.scrollTop;body.scrollTop=body.scrollHeight;const result={scrollable:body.scrollHeight>body.clientHeight,scrolled:body.scrollTop>before};marker.remove();return result});
  check(scroll.scrollable&&scroll.scrolled,'content exceeding the fixed dialog height scrolls inside the body');
  await page.locator('#r96KeepImport').click();
  const feedback=await page.evaluate(()=>{const toast=document.querySelector('.toast'),overlay=document.querySelector('.r62-overlay');if(!toast)return null;const t=toast.getBoundingClientRect();return {text:toast.textContent,z:+getComputedStyle(toast).zIndex,overlayZ:+getComputedStyle(overlay).zIndex,visible:t.width>0&&t.height>0&&t.right<=innerWidth&&t.bottom<=innerHeight,insideViewport:t.left>=0&&t.top>=0}});
  check(feedback&&feedback.text.includes('已保留')&&feedback.z>feedback.overlayZ&&feedback.visible&&feedback.insideViewport,'retain-settings feedback is visible above the blurred import overlay');
  await page.screenshot({path:path.join(out,'r97-fixed-import-and-toast.png')});
  check(!errors.length&&!remote.length,'no browser errors or remote requests');report.errors=errors;report.remote=remote;
  fs.writeFileSync(path.join(out,'r97-audit.json'),JSON.stringify(report,null,2));console.log('P109_R97_AUDIT_PASS '+JSON.stringify({checks:report.checks.length,geometry:report.geometry.length}));
 }catch(e){fs.writeFileSync(path.join(out,'r97-failure.json'),JSON.stringify({error:e.stack,report,errors},null,2));await page.screenshot({path:path.join(out,'r97-failure.png')});throw e}finally{await context.close()}
};
