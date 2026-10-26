'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),zlib=require('zlib'),{pathToFileURL}=require('url');
const crcTable=(()=>{const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0}return table})();
const crc32=bytes=>{let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0};
const u16=(out,n)=>out.push(n&255,n>>>8&255),u32=(out,n)=>out.push(n&255,n>>>8&255,n>>>16&255,n>>>24&255);
function storedFiles(bytes){
 const files=[];let at=0,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),read16=i=>view.getUint16(i,true),read32=i=>view.getUint32(i,true);
 while(at+30<=bytes.length&&read32(at)===0x04034b50){const size=read32(at+22),nameLength=read16(at+26),extra=read16(at+28),start=at+30+nameLength+extra,name=new TextDecoder().decode(bytes.subarray(at+30,at+30+nameLength));files.push({name,data:bytes.slice(start,start+size)});at=start+size}
 return files;
}
function deflatedZip(files,prefix=''){
 const chunks=[],central=[];let offset=0,centralLength=0;
 for(const file of files){const name=Buffer.from(prefix+file.name),raw=Buffer.from(file.data),packed=zlib.deflateRawSync(raw),crc=crc32(raw),local=[];
  u32(local,0x04034b50);u16(local,20);u16(local,0x0800);u16(local,8);u16(local,0);u16(local,0);u32(local,crc);u32(local,packed.length);u32(local,raw.length);u16(local,name.length);u16(local,0);local.push(...name);chunks.push(Buffer.from(local),packed);
  const row=[];u32(row,0x02014b50);u16(row,20);u16(row,20);u16(row,0x0800);u16(row,8);u16(row,0);u16(row,0);u32(row,crc);u32(row,packed.length);u32(row,raw.length);u16(row,name.length);u16(row,0);u16(row,0);u16(row,0);u16(row,0);u32(row,0);u32(row,offset);row.push(...name);central.push(Buffer.from(row));centralLength+=row.length;offset+=local.length+packed.length}
 const end=[];u32(end,0x06054b50);u16(end,0);u16(end,0);u16(end,files.length);u16(end,files.length);u32(end,centralLength);u32(end,offset);u16(end,0);return Buffer.concat([...chunks,...central,Buffer.from(end)]);
}
module.exports=async({browser,out,root})=>{
 root=path.resolve(root);const checks=[],errors=[],check=(value,label)=>{assert(value,label);checks.push(label)},context=await browser.newContext({viewport:{width:1366,height:768}}),page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  const stored=Uint8Array.from(await page.evaluate(async()=>{p109BlankWork();const root=await p109PortableFromSession(),files=await p109PortableCollect(root),built=await p109ZipBuild(files);return Array.from(new Uint8Array(await built.zip.arrayBuffer()))})),files=storedFiles(stored),compressed=deflatedZip(files,'外部压缩项目/');
  const zip=await page.evaluate(async bytes=>{const file=new File([Uint8Array.from(bytes)],'外部压缩项目.zip',{type:'application/zip'}),items=await p109ZipRead(file),opened=await p109OpenPortableFile(file);return {opened,names:items.map(x=>x.name),project:state.projectDir?.name}},Array.from(compressed));
  check(zip.opened&&zip.names.includes('project.json')&&zip.names.includes('p109-backup-manifest.json'),'Deflate ZIP and one enclosing folder reopen as a verified project');
  const boundaries=await page.evaluate(()=>{
   const employee=EMPLOYEES[0]||{id:'boundary',name:'边界测试'},date='2026-10-08',original={employees:EMPLOYEES,records:state.records,leaves:state.leaves,trips:state.trips,outings:state.outings,overtime:state.overtimeEntries};
   EMPLOYEES=[employee];state.leaves=[];state.trips=[];state.outings=[];state.overtimeEntries=[];
   const run=events=>{state.records=events.map(([time,direction],index)=>({employeeId:employee.id,name:employee.name,datetime:date+' '+time,time,direction,recordId:'r101:'+index}));reanalyze();return state.analysis.get(employee.id+'|8').attendanceFlags.map(flag=>flag.label)};
   try{return {morningShort:run([['08:20','进'],['11:38','出'],['11:42','进'],['11:43','出'],['13:25','进'],['17:10','出']]),morningLong:run([['08:20','进'],['11:38','出'],['12:00','进'],['12:01','出'],['13:25','进'],['17:10','出']]),afternoonShort:run([['08:20','进'],['11:40','出'],['13:25','进'],['17:08','出'],['17:12','进'],['17:13','出']]),afternoonLong:run([['08:20','进'],['11:40','出'],['13:25','进'],['17:08','出'],['17:30','进'],['17:31','出']])}}finally{EMPLOYEES=original.employees;Object.assign(state,{records:original.records,leaves:original.leaves,trips:original.trips,outings:original.outings,overtimeEntries:original.overtime});reanalyze()}
  });
  check(!boundaries.morningShort.includes('上午早退')&&boundaries.morningLong.includes('上午早退'),'morning boundary accepts only a short temporary outing');
  check(!boundaries.afternoonShort.includes('早退')&&boundaries.afternoonLong.includes('早退'),'afternoon boundary applies the same temporary-outing rule');
  const rescue=await page.evaluate(()=>{const original=URL.createObjectURL;URL.createObjectURL=undefined;try{p109RescueDownload();const area=document.querySelector('#p109RescueText');return {shown:!!area,valid:JSON.parse(area?.value||'null')?.context==='rescue'}}finally{URL.createObjectURL=original;p109CloseTransfer()}});
  check(rescue.shown&&rescue.valid,'rescue JSON remains manually selectable when download and directory writing are unavailable');
  const legacy=await page.evaluate(()=>({missing:p109LegacyBrowserCheck({}).supported,real:p109LegacyBrowserCheck().supported,source:null}));legacy.source=fs.readFileSync(path.join(root,'src/core/boot.js'),'utf8');
  const executableBoot=legacy.source.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g,'');
  check(!legacy.missing&&legacy.real&&!/(?:\bconst\b|\blet\b|=>|\?\.|\?\?)/.test(executableBoot),'legacy bootstrap is ES5 and detects missing startup capabilities');
  check(!errors.length,'R101 functional page has no script errors: '+errors.join(' | '));
 }finally{await context.close()}
 const raw=await browser.__p109RawNewContext({viewport:{width:1366,height:768}}),locked=await raw.newPage(),lockErrors=[];locked.on('pageerror',error=>lockErrors.push(error.message));
 try{
  await locked.goto(pathToFileURL(path.join(root,'index.html')).href);await locked.evaluate(()=>p109RecentReady);await locked.locator('#r80Demo').click();
  await locked.locator('[data-workspace="person"]').click();check(await locked.locator('#p109AccessWait:not([hidden])').count()===1,'unactivated interaction enters the quiet waiting state');
  for(let i=0;i<4;i++)await locked.locator('#settingsBtn').click();check(await locked.locator('#settingsOverlay:not(.hidden)').count()===0,'four setting taps do not reveal the access page');
  await locked.locator('#settingsBtn').click();await locked.waitForSelector('#settingsOverlay:not(.hidden) [data-p109-access-version]');
  for(let i=0;i<5;i++)await locked.locator('[data-p109-access-version]').click();await locked.waitForSelector('#p109AccessKey');
  await locked.locator('#p109AccessKey').fill('invalid');await locked.locator('#p109AccessUnlock').click();check((await locked.locator('#p109AccessError').textContent())==='输入无效','wrong key cannot unlock');
  await locked.evaluate(()=>{document.getElementById('p109AccessOverlay')?.remove();p109AccessWrite({v:1,verified:true,activatedAt:Date.now(),refreshedAt:Date.now(),expiresAt:Date.now()+60000});p109AccessPaintVersion()});
  check(await locked.locator('[data-p109-access-version].is-active').count()===1,'valid record paints the version green');
  await locked.evaluate(()=>{p109AccessWrite({v:1,verified:true,activatedAt:Date.now()-8*86400000,refreshedAt:Date.now()-8*86400000,expiresAt:Date.now()-1});p109AccessPaintVersion()});
  for(let i=0;i<5;i++)await locked.locator('[data-p109-access-version]').click();await locked.locator('#p109AccessRenew').click();check(await locked.evaluate(()=>p109AccessAuthorized()),'expired verified key requires and accepts a manual seven-day refresh');
  check(!lockErrors.length,'access flow has no script errors: '+lockErrors.join(' | '));
 }finally{await raw.close()}
 fs.writeFileSync(path.join(out,'r101-audit.json'),JSON.stringify({checks,errors},null,2));console.log('P109_R101_AUDIT_PASS '+JSON.stringify({checks:checks.length,errors:errors.length}));
};
