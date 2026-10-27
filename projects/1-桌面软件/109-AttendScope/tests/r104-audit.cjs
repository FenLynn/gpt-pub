'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,out,root})=>{
 const checks=[],errors=[],check=(value,label)=>{assert(value,label);checks.push(label)},context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 const open=async(content,name='外出范围.csv')=>{await page.evaluate(async({content,name})=>{
  localStorage.removeItem(R96_IMPORT_SETTINGS_KEY);state.importProfile={rules:R62_DEFAULT_DIRECTIONS.map(row=>({...row}))};
  await r62OpenImport(new File([content],name,{type:'text/csv'}),'outing');
 },{content,name});await page.waitForSelector('#r62Commit')};
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  const boundary=await page.evaluate(()=>{
   const employee={id:'r104',name:'下班跨界'},date='2026-10-08',run=events=>{
    EMPLOYEES=[employee];Object.assign(state,{leaves:[],trips:[],outings:[],overtimeEntries:[],manualTempOutings:[],manualOvertime:[],tempOutingReview:{},attendanceReview:{},overtimeReview:{}});
    state.records=events.map(([time,direction],index)=>({employeeId:employee.id,name:employee.name,datetime:date+' '+time,time,direction,recordId:'r104:'+index}));
    reanalyze();const a=state.analysis.get(employee.id+'|8');return {flags:a.attendanceFlags.map(x=>x.label+'@'+x.time),temporary:a.temporaryOutings.map(x=>({from:x.from,to:x.to,status:x.status}))};
   };
   return {
    short:run([['08:20','进'],['11:40','出'],['13:25','进'],['17:04','出'],['17:15','进'],['17:16','出']]),
    long:run([['08:20','进'],['11:40','出'],['13:25','进'],['17:04','出'],['17:17','进'],['17:18','出']])
   };
  });
  check(!boundary.short.flags.some(x=>x.includes('早退')),'short absence crossing afternoon end is not early departure');
  check(boundary.long.flags.includes('早退@17:04:00'),'absence beyond the configured temporary-outing boundary remains early departure');
  const rangeHelpers=await page.evaluate(()=>({
   date:r104DateRange('2026-09-06-2026-09-06'),time:r104TimeRange('09:30-10:40'),
   chinese:r104DateRange('2026年9月6日 至 2026年9月7日'),bad:r104DateRange('2026-09-07-2026-09-06')
  }));
  check(rangeHelpers.date?.start==='2026-09-06'&&rangeHelpers.date.end==='2026-09-06','hyphenated date range is split without confusing date separators');
  check(rangeHelpers.time?.start==='09:30:00'&&rangeHelpers.time.end==='10:40:00','minute-only time range receives explicit seconds');
  check(rangeHelpers.chinese?.end==='2026-09-07'&&!rangeHelpers.bad,'localized separators work and reversed dates are rejected');
  const csv='姓名,起止日期,起止时间,类型,地点,备注,任务编号\n测试标签,2026-10-06-2026-10-06,09:30-10:40,公务外出,园区北门,设备验收,T-104';
  await open(csv);
  const inferred=await page.evaluate(()=>({mode:r62ImportDraft.outingMode,map:r62ImportDraft.mapping,rows:r62ImportDraft.validated.rows,labels:r62ImportDraft.labelColumns}));
  check(inferred.mode==='range'&&inferred.map.dateRange===1&&inferred.map.timeRange===2&&inferred.rows.length===1,'two-column outing range format is inferred and validates');
  check(JSON.stringify(inferred.rows[0].__labelParts)===JSON.stringify(['公务外出','园区北门','设备验收']),'business label defaults to type, place and note in source order');
  await page.locator('#r104LabelAdd').selectOption('6');
  await page.locator('[data-label-pos="3"][data-label-move="up"]').click();
  await page.locator('[data-label-pos="2"][data-label-move="up"]').click();
  await page.locator('[data-label-pos="1"][data-label-move="up"]').click();
  const ordered=await page.evaluate(()=>({columns:r62ImportDraft.labelColumns,parts:r62ImportDraft.validated.rows[0].__labelParts,
   parsed:p109ParseBusinessRow('outing',r62ImportDraft.validated.rows[0],0,p109ImportPeriod('2026-10'))}));
  check(JSON.stringify(ordered.parts)===JSON.stringify(['T-104','公务外出','园区北门','设备验收'])&&ordered.parsed.labelParts[0]==='T-104','label columns can be added and freely reordered');
  const segment=await page.evaluate(parsed=>r23BehaviorSegments({outings:[{...parsed,id:'r104-label'}],temporaryOutings:[]},'outing')[0],ordered.parsed);
  check(segment.label==='T-104 · 公务外出 · 园区北门 · 设备验收','timeline segment joins configured fields with middle dots');
  await page.evaluate(parsed=>{
   const employee={id:'r104-label-person',name:parsed.name},date='2026-10-06';EMPLOYEES=[employee];
   Object.assign(state,{records:[['08:20','进'],['11:40','出'],['13:25','进'],['17:10','出']].map(([time,direction],index)=>({recordId:'r104-label:'+index,employeeId:employee.id,name:employee.name,datetime:date+' '+time,time,direction})),
    leaves:[],trips:[],outings:[{...parsed,id:'r104-label',employeeId:employee.id,startDate:date,endDate:date}],overtimeEntries:[],manualTempOutings:[],manualOvertime:[],
    workspaceMode:'person',selection:{type:'cell',employeeId:employee.id,day:6},chartDay:6,chartTab:'timeline',timelineRange:null});reanalyze();render();
  },ordered.parsed);
  await page.waitForFunction(()=>{const chart=echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart'));return chart?.getZr().storage.getDisplayList().some(item=>item.style?.text?.startsWith('T-104'))});
  check(true,'configured label is rendered by the actual timeline canvas');
  await page.locator('#r96KeepImport').click();await page.locator('#r62Cancel').click();
  await page.evaluate(async content=>r62OpenImport(new File([content],'外出范围-再次.csv',{type:'text/csv'}),'outing'),csv);await page.waitForSelector('#r62Commit');
  check(await page.evaluate(()=>r62ImportDraft.outingMode==='range'&&JSON.stringify(r62ImportDraft.labelColumns)===JSON.stringify([6,3,4,5])),'outing range and label order are restored on the next file');
  await page.locator('#r62Cancel').click();
  await open('姓名,开始日期,开始时间,结束日期,结束时间,备注\n传统外出,2026-10-07,10:00,2026-10-07,10:30,传统字段','传统外出.csv');
  await page.locator('#r104OutingMode').selectOption('traditional');
  check(await page.evaluate(()=>r62ImportDraft.validated.rows.length===1&&r62ImportDraft.validated.rows[0].开始时间==='10:00'),'traditional outing format remains selectable and valid');
  check(!errors.length,'R104 has no browser script errors: '+errors.join(' | '));
  fs.writeFileSync(path.join(out,'r104-audit.json'),JSON.stringify({checks,boundary,rangeHelpers,errors},null,2));
  console.log('P109_R104_AUDIT_PASS '+JSON.stringify({checks:checks.length,errors:errors.length}));
 }finally{await context.close()}
};
