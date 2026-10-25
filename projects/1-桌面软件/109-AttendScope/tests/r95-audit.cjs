'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,root,out})=>{
 const context=await browser.newContext({viewport:{width:1600,height:900},acceptDownloads:true}),page=await context.newPage(),errors=[],remote=[],report={checks:[],geometry:[]};
 const check=(ok,label)=>{assert(ok,label);report.checks.push(label)};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url())});page.on('dialog',d=>d.accept());
 const upload=async(kind,content,name='测试范围.csv')=>{await page.evaluate(async({kind,content,name})=>r62OpenImport(new File([content],name,{type:'text/csv'}),kind),{kind,content,name});await page.waitForSelector('#r62Commit')};
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  const cases=await page.evaluate(()=>{
   const result={},period=p109ImportPeriod('2026-10'),parse=(kind,r)=>p109ParseImportTable(kind,{rows:[{姓名:'测试范围',...r}]},period),
    range={开始日期:'2026-10-23',开始时间:'18:00:00',结束日期:'2026-10-25',结束时间:'08:30:00'},duration=rows=>rows.reduce((n,r)=>n+minutes(r.end)-minutes(r.start),0);
   for(const kind of ['leave','outing','overtime']){
    const a=parse(kind,range),b=parse(kind,{开始日期时间:'2026-10-23 18:00:00',结束日期时间:'2026-10-25T08:30:00'});
    result[kind+'Continuous']=a.rows.length===3&&!a.failed.length&&duration(a.rows)===2310&&a.rows[1].start==='00:00:00'&&a.rows[1].end==='24:00:00';
    result[kind+'CombinedEquivalent']=JSON.stringify(a)===JSON.stringify(b);
    const mixed=parse(kind,{开始日期时间:'2026/10/23 18:00',结束日期:'2026年10月25日',结束时间:'08:30'});
    result[kind+'MixedEquivalent']=JSON.stringify(a)===JSON.stringify(mixed);
    const next=parse(kind,{开始日期:'2026-09-30',开始时间:'22:00',结束日期:'2026-10-02',结束时间:'02:00'});
    result[kind+'MonthClipped']=next.rows.length===2&&duration(next.rows)===1560&&next.rows.every(r=>r.date.startsWith('2026-10'));
    result[kind+'MidnightExclusive']=parse(kind,{开始日期:'2026-10-23',开始时间:'22:00',结束日期:'2026-10-24',结束时间:'00:00'}).rows.length===1;
    result[kind+'ExplicitReversalRejected']=parse(kind,{...range,结束日期:'2026-10-23',结束时间:'17:00'}).failed.length===1;
    result[kind+'EqualRejected']=parse(kind,{...range,结束日期:'2026-10-23',结束时间:'18:00'}).failed.length===1;
    result[kind+'InvalidDateRejected']=parse(kind,{...range,结束日期:'2026-02-30'}).failed.length===1;
    result[kind+'InvalidTimeRejected']=parse(kind,{...range,结束时间:'08:60'}).failed.length===1;
    result[kind+'OutsideMonthRejected']=parse(kind,{...range,开始日期:'2026-09-23',结束日期:'2026-09-25'}).failed.length===1;
    result[kind+'LongRangeRejected']=parse(kind,{...range,结束日期:'2028-10-25'}).failed.length===1;
    result[kind+'SecondsPreserved']=parse(kind,{...range,开始时间:'18:00:01',结束时间:'08:30:02'}).rows[0].start==='18:00:01';
    const serial=(Date.UTC(2026,9,23)-Date.UTC(1899,11,30))/86400000;
    const numeric=parse(kind,{开始日期:serial,开始时间:0.75,结束日期:serial+2,结束时间:8.5/24});
    result[kind+'ExcelSerialEquivalent']=JSON.stringify(a)===JSON.stringify(numeric);
    result[kind+'EndOfDay']=parse(kind,{开始日期:'2026-10-23',开始时间:'18:00',结束时间:'24:00'}).rows[0]?.end==='24:00:00';
   }
   for(const format of ['2026-10-23','2026/10/23','2026.10.23','2026年10月23日','20261023','23/10/2026','10/23/2026'])result['date:'+format]=r62Date(format)==='2026-10-23';
   result.ambiguousRejected=r62Date('03/04/2026')===''&&r62Date('2026-10-230')==='';
   result.badClockRejected=!r62Time('08:60')&&!r62Time('25:00')&&!r62Time('junk 08:30')&&!r62Time('2026-10-23 18:00Z');
   result.csvNumericMidnight=r62Time('0')==='00:00:00'&&r62Time('1',true)==='24:00:00'&&r62DateTime('46318')==='2026-10-23 00:00:00';
   result.meridians=r62Time('下午 6:00')==='18:00:00'&&r62Time('6:00 PM')==='18:00:00';
   result.legacyLeaveDefaults=parse('leave',{日期:'2026-10-23'}).rows[0]?.start===RULES.amStart+':00';
   result.legacyNightOvertime=parse('overtime',{日期:'2026-10-23',开始时间:'22:00',结束时间:'02:00'}).rows.length===2;
   result.legacyLeaveSingleDay=parse('leave',{日期:'2026-10-23',开始时间:'08:30',结束时间:'11:40'}).rows.length===1;
   const trip=parse('trip',{开始日期:'2026/10/23',结束日期:'2026年10月25日'}).rows[0];result.tripWholeDays=trip.startDate==='2026-10-23'&&trip.endDate==='2026-10-25'&&!trip.start;
   const old=state.importProfile;state.importProfile={templates:{leave:{header:true,skip:0,labels:['姓名','日期','开始时间','结束时间'],mapping:{name:0,date:1,start:2,end:3,type:-1,note:-1}}},rules:R62_DEFAULT_DIRECTIONS};
   window.__r95OldProfile=old;
   return result;
  });
  for(const [label,ok] of Object.entries(cases))check(ok,label);
  await upload('leave','姓名,开始日期时间,结束日期时间\n测试跨月,2026-09-30 22:00:00,2026-10-02 02:00:00');
  check(await page.evaluate(()=>r62ImportDraft.validated.rows.length===1&&!document.querySelector('#r79UseFileMonth')&&document.querySelector('#r62Validation').textContent.includes('2 个日段')),'intersecting cross-month range does not suggest switching away from valid target month');await page.locator('#r62Cancel').click();
  const epoch=await page.evaluate(async()=>{
   const serial=(Date.UTC(2026,9,23)-Date.UTC(1899,11,30))/86400000-1462;
   const items=[
    {name:'xl/workbook.xml',data:'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="1"/><sheets><sheet name="请假" sheetId="1" r:id="rId1"/></sheets></workbook>'},
    {name:'xl/_rels/workbook.xml.rels',data:'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'},
    {name:'xl/worksheets/sheet1.xml',data:'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">'+['姓名','开始日期','开始时间','结束日期','结束时间'].map((v,i)=>'<c r="'+String.fromCharCode(65+i)+'1" t="inlineStr"><is><t>'+v+'</t></is></c>').join('')+'</row><row r="2"><c r="A2" t="inlineStr"><is><t>测试日期基准</t></is></c><c r="B2"><v>'+serial+'</v></c><c r="C2"><v>0.75</v></c><c r="D2"><v>'+(serial+2)+'</v></c><c r="E2"><v>'+8.5/24+'</v></c></row></sheetData></worksheet>'}
   ];
   const file=new File([XLSX.writeArchive(items)],'1904日期系统.xlsx');await r62OpenImport(file,'leave');
   const preview=r62ImportDraft.validated,grid=r62ImportDraft.grid,normalized=p109ParseImportTable('leave',{rows:preview.rows});
   const direct=p109ParseImportTable('leave',await XLSX.readTable(file));
   return {flag:grid.date1904,first:normalized.rows[0].rangeStart,last:normalized.rows.at(-1).rangeEnd,identical:JSON.stringify(normalized)===JSON.stringify(direct)};
  });
  check(epoch.flag&&epoch.first==='2026-10-23 18:00:00'&&epoch.last==='2026-10-25 08:30:00'&&epoch.identical,'1904 Excel workbook dates agree in preview and direct parser');
  await page.locator('#r62Cancel').click();
  const english=await page.evaluate(async()=>{
   const serial=(Date.UTC(2026,9,23)-Date.UTC(1899,11,30))/86400000;
   await r62OpenImport(new File([XLSX.writeXlsx([{Name:'测试英文',StartDate:serial,StartTime:.75,EndDate:serial+2,EndTime:8.5/24}])],'english.xlsx'),'leave');
   const d=r62ImportDraft,parsed=p109ParseImportTable('leave',{rows:d.validated.rows});return d.startMode==='split'&&d.endMode==='split'&&parsed.rows[0]?.rangeStart==='2026-10-23 18:00:00'&&parsed.rows.at(-1)?.rangeEnd==='2026-10-25 08:30:00';
  });check(english,'English split date/time headers never confuse midnight date serials with combined endpoints');await page.locator('#r62Cancel').click();
  await upload('leave','姓名,日期,开始时间,结束时间\n测试甲,2026-10-23,08:30,11:40');
  check(await page.evaluate(()=>r62ImportDraft.mapping.startDate===1&&r62ImportDraft.validated.rows.length===1),'old saved single-date mapping migrates without changing source');
  await page.locator('#r62Cancel').click();await page.evaluate(()=>{state.importProfile=window.__r95OldProfile});
  const source='姓名,开始日期,开始时间,结束日期,结束时间,类型,备注\n测试甲,2026/10/23,18:00:00,2026年10月25日,08:30:00,年假,多日连续\n测试乙,2026-10-26,08:30,2026-10-27,17:10,事假,两日假';
  await upload('leave',source);
  check(await page.evaluate(()=>r62ImportDraft.startMode==='split'&&r62ImportDraft.endMode==='split'&&r62ImportDraft.validated.rows.length===2),'split headers inferred for both endpoints');
  check((await page.locator('#r95ParsedPreview').innerText()).includes('2026-10-25 08:30:00'),'normalized result shows readable full range');
  check((await page.locator('#r62Validation').innerText()).includes('5 个日段'),'source row count distinguished from daily slices');
  for(const size of [{width:1280,height:720},{width:1366,height:768},{width:1600,height:900},{width:1920,height:1080}]){
   await page.setViewportSize(size);
   const geometry=await page.evaluate(()=>{
    const dialog=document.querySelector('.r62-dialog').getBoundingClientRect(),head=document.querySelector('.r62-dialog>header').getBoundingClientRect(),month=document.querySelector('#r79ImportMonth').getBoundingClientRect(),body=document.querySelector('.r62-body');
    const rows=[...document.querySelectorAll('.r95-import-fields .r62-field')].map(el=>{const a=el.querySelector('span').getBoundingClientRect(),b=el.querySelector('select').getBoundingClientRect();return {titleRight:a.right,selectLeft:b.left,centerDifference:Math.abs((a.top+a.bottom-b.top-b.bottom)/2)}});
    return {fit:dialog.top>=0&&dialog.bottom<=innerHeight&&dialog.width>=innerWidth*.8,header:month.top>=head.top&&month.bottom<=head.bottom,oneFieldPerRow:rows.every(r=>r.selectLeft>=r.titleRight&&r.centerDifference<=2)&&new Set(rows.map(r=>Math.round(r.selectLeft))).size===1,noBodyScroll:body.scrollHeight<=body.clientHeight+1};
   });report.geometry.push({...size,...geometry});check(geometry.fit&&geometry.header&&geometry.oneFieldPerRow&&geometry.noBodyScroll,'dense aligned import geometry '+size.width);
  }
  await page.setViewportSize({width:1600,height:900});await page.screenshot({path:path.join(out,'r95-import-split.png')});
  await page.locator('[data-preview="raw"]').click();check(await page.locator('#r95RawPreview').isVisible()&&!await page.locator('#r95ParsedPreview').isVisible(),'raw table remains available on demand');
  await page.locator('[data-preview="parsed"]').click();await page.locator('#r62Cancel').click();
  await upload('outing','姓名,开始时间,结束日期,结束时间,地点\n测试甲,2026-10-23 18:00:00,2026-10-25,08:30,地点甲');
  check(await page.evaluate(()=>r62ImportDraft.startMode==='combined'&&r62ImportDraft.endMode==='split'&&r62ImportDraft.validated.rows.length===1),'mixed column layout inferred automatically');
  check(await page.locator('[data-map="startDatetime"]').evaluate(el=>el.previousElementSibling.getBoundingClientRect().height<24),'combined endpoint label stays on one line in the narrow column');
  await page.screenshot({path:path.join(out,'r95-import-mixed.png')});await page.locator('#r62Cancel').click();
  await upload('overtime','姓名,开始时间,结束时间\n测试甲,2026-10-23 18:00:00,2026-10-24 02:00:00');
  check(await page.evaluate(()=>r62ImportDraft.startMode==='combined'&&r62ImportDraft.endMode==='combined'&&r62ImportDraft.validated.rows.length===1),'combined time headers inferred automatically');
  await page.locator('#r79Advanced').evaluate(el=>el.open=true);await page.locator('#r96KeepImport').click();await page.locator('#r62Cancel').click();
  check(await page.evaluate(()=>p109NewPortable()),'real empty portable project initialized');
  await upload('leave',source);await page.locator('#r62Commit').click();await page.waitForFunction(()=>!r62ImportDraft&&!state.importCommitting);
  check(await page.evaluate(()=>state.leaves.length===5&&new Set(state.leaves.map(r=>r.id)).size===5&&state.leaves.every(r=>r.row===2||r.row===3)),'real import commits unique daily identities and original row provenance');
  check(await page.evaluate(()=>{const a=state.analysis.get(personIdentity('测试乙')+'|26');return a.leaves.length===1&&a.initialStatus!=='absent'&&p109PriorityAbsences(personIdentity('测试乙'),'2026-10-27').length===1}),'multi-day leave participates in per-day priority and analysis');
  const first=await page.evaluate(()=>JSON.stringify(state.leaves));
  await upload('leave','姓名,开始日期时间,结束日期时间\n测试丙,2026-10-28 09:00:00,2026-10-29 10:00:00');await page.locator('#r62Commit').click();await page.waitForFunction(()=>!r62ImportDraft&&!state.importCommitting);
  check(await page.evaluate(before=>state.leaves.length===7&&JSON.stringify(state.leaves.slice(0,5))===before,first),'second file merges without changing previous leave rows');
  const night='姓名,开始日期时间,结束日期时间\n测试甲,2026-10-23 18:00:00,2026-10-24 02:00:00';
  await upload('overtime',night);await page.locator('#r79Advanced').evaluate(el=>el.open=true);await page.locator('#r96KeepImport').click();await page.locator('#r62Commit').click();await page.waitForFunction(()=>!r62ImportDraft&&!state.importCommitting);
  check(await page.evaluate(()=>{const id=personIdentity('测试甲');return state.overtimeEntries.length===2&&behaviorMinutes(state.analysis.get(id+'|23'),'overtime')===360&&behaviorMinutes(state.analysis.get(id+'|24'),'overtime')===120}),'cross-midnight registered overtime counts six plus two hours despite leave coverage');
  await upload('overtime',night);check(await page.evaluate(()=>r62ImportDraft.startMode==='combined'&&r62ImportDraft.endMode==='combined'&&r62ImportDraft.validated.rows.length===1&&state.overtimeEntries.length===2),'saved combined endpoint mapping reopens correctly without another commit');await page.locator('#r62Cancel').click();
  await upload('outing','姓名,开始日期时间,结束日期时间,地点\n测试甲,2026-10-23 23:00:00,2026-10-25 02:00:00,示例地点');await page.locator('#r62Commit').click();await page.waitForFunction(()=>!r62ImportDraft&&!state.importCommitting);
  check(await page.evaluate(()=>{const r=state.outings;return r.length===3&&r[0].start==='23:00:00'&&r[1].start==='00:00:00'&&r[1].end==='24:00:00'&&r[2].end==='02:00:00'&&outingFor(personIdentity('测试甲'),'2026-10-24').length===1}),'real multi-day outing retains continuous middle day and is available in daily analysis');
  check(await page.evaluate(async()=>{const meta=state.imports.find(i=>i.type==='leave');let folder=state.projectDir;for(const name of p109SourcePath(meta).slice(0,-1))folder=await folder.getDirectoryHandle(name);return (await (await folder.getFileHandle(meta.name)).getFile()).size>0}),'source file stays readable after range normalization');
  const downloads=[];for(const fn of ['downloadLeaves','downloadOutings','downloadOvertimeEntries']){
   const capture=page.waitForEvent('download');await page.evaluate(fn=>window[fn](),fn);const downloaded=await capture;const target=path.join(out,'r95-'+downloaded.suggestedFilename());await downloaded.saveAs(target);downloads.push({fn,target});
   const kind={downloadLeaves:'leave',downloadOutings:'outing',downloadOvertimeEntries:'overtime'}[fn];
   check(await page.evaluate(async({bytes,kind})=>{
    const file=new File([Uint8Array.from(bytes)],'roundtrip.xlsx'),grid=await XLSX.readGrid(file),parsed=p109ParseImportTable(kind,await XLSX.readTable(file)),source={leave:state.leaves,outing:state.outings,overtime:state.overtimeEntries}[kind];
    const signature=r=>JSON.stringify([r.name,r.date||r.startDate,minutes(r.start),minutes(r.end),r.type,r.note||'']);
    return grid.rows[0].cells.includes('开始日期')&&grid.rows[0].cells.includes('结束日期')&&!parsed.failed.length&&parsed.rows.length===source.length&&parsed.rows.every((r,i)=>signature(r)===signature(source[i]));
   },{bytes:[...fs.readFileSync(target)],kind}),'export with explicit dates reimports identical daily coverage '+fn);
  }
  const serialized=await page.evaluate(()=>{rememberMonth();return JSON.stringify(workingPayload())});
  check(serialized.includes('rangeStart')&&serialized.includes('24:00:00'),'saved month retains source span and exact midnight endpoints');
  check(!errors.length&&!remote.length,'no runtime errors or network requests');report.errors=errors;report.remote=remote;report.cases=cases;
  fs.writeFileSync(path.join(out,'r95-audit.json'),JSON.stringify(report,null,2));console.log('P109_R95_AUDIT_PASS '+JSON.stringify({checks:report.checks.length,geometry:report.geometry.length}));
 }catch(e){fs.writeFileSync(path.join(out,'r95-failure.json'),JSON.stringify({error:e.stack,report,errors},null,2));await page.screenshot({path:path.join(out,'r95-failure.png')});throw e}finally{await context.close()}
};
