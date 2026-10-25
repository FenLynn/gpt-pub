/* R83 acceptance: freeze lives in Project, save is visually primary, and
 * overnight overtime keeps one auditable session across midnight/months. */
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,out,root})=>{
 const context=await browser.newContext({viewport:{width:1600,height:900}}),page=await context.newPage();
 const report={revision:'R83',checks:[],overnight:{}},errors=[],remote=[];
 const check=(ok,label)=>{assert(ok,label);report.checks.push(label)};
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url())});
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);
  await page.locator('#r80Demo').click();
  check(await page.locator('.month-actions>#freezeBtn').count()===0&&
    await page.locator('#projectMenu>#freezeBtn').count()===1,
   'freeze is removed from the permanent top bar and placed in Project');
  check(!(await page.locator('#freezeBtn').isVisible()),'project freeze stays hidden while the menu is closed');
  await page.locator('#projectMenuButton').click();
  check(await page.locator('#freezeBtn').isVisible()&&
    (await page.locator('#freezeBtn').textContent()).trim()==='冻结当前月',
   'Project exposes an explicit Freeze current month action');
  await page.screenshot({path:path.join(out,'r83-topbar-project-menu.png')});
  await page.keyboard.press('Escape');
  const saveStyle=await page.locator('#saveBtn').evaluate(el=>{
   const s=getComputedStyle(el),r=el.getBoundingClientRect();
   return {visible:!!r.width&&!!r.height,width:r.width,height:r.height,
    background:s.backgroundColor,color:s.color,fontWeight:Number(s.fontWeight)||0,
    title:el.title,primary:el.classList.contains('r83-save-primary')};
  });
  check(saveStyle.visible&&saveStyle.primary&&saveStyle.width>=40&&saveStyle.width<60&&saveStyle.height>=25&&saveStyle.height<=30&&
    saveStyle.background!=='rgba(0, 0, 0, 0)'&&saveStyle.color==='rgb(23, 107, 159)'&&
    saveStyle.fontWeight>=700&&saveStyle.title.includes('当前月'),
   'save remains compact with blue emphasis');

  const overnight=await page.evaluate(()=>{
   const original={records:state.records,leaves:state.leaves,trips:state.trips,
    outings:state.outings,overtimeEntries:state.overtimeEntries,analysis:state.analysis,
    overtimeReview:state.overtimeReview,monthStores:state.monthStores,year:YEAR,month:MONTH};
   const employee=EMPLOYEES[0],approx=(a,b)=>Math.abs(a-b)<1e-8;
   const punch=(date,time,direction,id)=>({employeeId:employee.id,name:employee.name,
    recordId:'r83-'+id,datetime:date+' '+time,time,direction});
   const result={};
   try{
    state.leaves=[];state.trips=[];state.outings=[];state.overtimeEntries=[];
    state.overtimeReview={};state.monthStores=new Map();YEAR=2026;MONTH=10;
    const period=p109ImportPeriod('2026-10'),base={姓名:employee.name,日期:'2026-10-08',开始时间:'22:00',结束时间:'02:00'};
    result.registeredParser=minutes(p109ParseBusinessRow('overtime',base,0,period).end)===120;
    for(const kind of ['leave','outing']){
     try{
      const row=kind==='outing'?{姓名:employee.name,开始日期:'2026-10-08',开始时间:'22:00',结束时间:'02:00'}:base;
      p109ParseBusinessRow(kind,row,0,period);result[kind+'RejectsCrossnight']=false;
     }catch(_){result[kind+'RejectsCrossnight']=true}
    }
    try{p109ParseBusinessRow('overtime',{...base,结束时间:'22:00'},0,period);result.equalClockRejected=false}
    catch(_){result.equalClockRejected=true}

    // Continuous punch evidence crosses midnight and retains one identity.
    state.records=[punch('2026-10-08','20:00:00','进','auto-in'),punch('2026-10-09','02:00:00','出','auto-out')];
    let first=analyzeDay(employee,8),second=analyzeDay(employee,9);
    result.autoSplit=approx(first.autoOvertime.minutes,240)&&approx(second.autoOvertime.minutes,120);
    result.oneSession=first.autoOvertime.segments.length===1&&second.autoOvertime.segments.length===1&&
      first.autoOvertime.segments[0].id===second.autoOvertime.segments[0].id;

    // Registered 23:00–01:00 is clipped to each date and de-duplicated against auto time.
    state.overtimeEntries=[{id:'r83-reg',employeeId:employee.id,date:'2026-10-08',start:'23:00',end:'01:00'}];
    first=analyzeDay(employee,8);second=analyzeDay(employee,9);
    state.analysis=new Map([[employee.id+'|8',first],[employee.id+'|9',second]]);
    let ledger=asStatLedger(),value=(metric,days)=>asStatValue(ledger,'overtime',metric,[employee],days);
    result.registeredSplit=approx(value('registeredHours',[8]),1)&&approx(value('registeredHours',[9]),1);
    result.overlapUnion=approx(value('candidateHours',[8]),3)&&approx(value('candidateHours',[9]),1)&&
      approx(value('hours',[8,9]),6)&&value('count',[8,9])===2;
    const sharedId=first.autoOvertime.segments[0].id;state.overtimeReview[sharedId]=false;
    result.oneReviewControlsBoth=!activeAutoOvertimeSegments(analyzeDay(employee,8)).length&&
      !activeAutoOvertimeSegments(analyzeDay(employee,9)).length;
    delete state.overtimeReview[sharedId];

    // Threshold is evaluated once for a physical session, then split by date.
    state.overtimeEntries=[];
    state.records=[punch('2026-10-08','23:58:00','进','threshold-in'),punch('2026-10-09','00:25:00','出','threshold-out')];
    result.thresholdAcrossMidnight=approx(analyzeDay(employee,8).autoOvertime.minutes,2)&&
      approx(analyzeDay(employee,9).autoOvertime.minutes,25);
    state.records=[punch('2026-10-08','23:58:00','进','short-in'),punch('2026-10-09','00:02:00','出','short-out')];
    result.shortSessionRejected=!analyzeDay(employee,8).autoOvertime.minutes&&!analyzeDay(employee,9).autoOvertime.minutes;

    // Unknown evidence breaks pairing; a missing exit followed by a next-day entry cannot create a night shift.
    state.records=[punch('2026-10-08','20:00:00','进','unknown-in'),
      punch('2026-10-08','23:00:00','未标注','unknown'),punch('2026-10-09','02:00:00','出','unknown-out')];
    result.unknownBreaksPairing=!analyzeDay(employee,8).autoOvertime.minutes&&!analyzeDay(employee,9).autoOvertime.minutes;
    state.records=[punch('2026-10-08','20:00:00','进','missing'),
      punch('2026-10-09','08:00:00','进','next-in'),punch('2026-10-09','12:00:00','出','next-out')];
    result.missingExitSafe=!analyzeDay(employee,8).autoOvertime.minutes;

    // Sessions over the explicit 36-hour evidence limit are not inferred.
    state.records=[punch('2026-10-08','20:00:00','进','long-in'),punch('2026-10-10','09:00:00','出','long-out')];
    result.longSessionRejected=!analyzeDay(employee,8).autoOvertime.minutes&&
      !analyzeDay(employee,9).autoOvertime.minutes&&!analyzeDay(employee,10).autoOvertime.minutes;

    // Both punch-backed and registered overtime carry through the month boundary.
    const octIn=punch('2026-10-31','20:00:00','进','month-in'),novOut=punch('2026-11-01','02:00:00','出','month-out'),
      monthReg={id:'r83-month-reg',employeeId:employee.id,date:'2026-10-31',start:'22:00',end:'02:00'};
    YEAR=2026;MONTH=10;state.records=[octIn];state.overtimeEntries=[];
    state.monthStores=new Map([['2026-11',{records:[novOut],overtimeEntries:[]}]]);
    const october=analyzeDay(employee,31);
    YEAR=2026;MONTH=11;state.records=[novOut];state.overtimeEntries=[];
    state.monthStores=new Map([['2026-10',{records:[octIn],overtimeEntries:[]}]]);
    const november=analyzeDay(employee,1);
    result.crossMonthAuto=approx(october.autoOvertime.minutes,240)&&approx(november.autoOvertime.minutes,120)&&
      october.autoOvertime.segments[0].id===november.autoOvertime.segments[0].id;
    YEAR=2026;MONTH=10;state.records=[];state.overtimeEntries=[monthReg];state.monthStores=new Map();
    const registeredOctober=analyzeDay(employee,31);
    YEAR=2026;MONTH=11;state.overtimeEntries=[];
    state.monthStores=new Map([['2026-10',{records:[],overtimeEntries:[monthReg]}]]);
    const registeredNovember=analyzeDay(employee,1);
    const registeredMinutes=a=>a.overtime.reduce((sum,row)=>sum+minutes(row.end)-minutes(row.start),0);
    result.crossMonthRegistered=approx(registeredMinutes(registeredOctober),120)&&
      approx(registeredMinutes(registeredNovember),120);
    return result;
   }finally{
    Object.assign(state,{records:original.records,leaves:original.leaves,trips:original.trips,
     outings:original.outings,overtimeEntries:original.overtimeEntries,analysis:original.analysis,
     overtimeReview:original.overtimeReview,monthStores:original.monthStores});
    YEAR=original.year;MONTH=original.month;
   }
  });
  report.overnight=overnight;
  for(const [name,passed] of Object.entries(overnight))check(passed,'overnight overtime: '+name);
  check(!errors.length&&!remote.length,'no script errors or remote requests');
  fs.writeFileSync(path.join(out,'r83-audit.json'),JSON.stringify(report,null,2));
  console.log('P109_R83_AUDIT_PASS '+JSON.stringify(report));
 }finally{await context.close()}
};
