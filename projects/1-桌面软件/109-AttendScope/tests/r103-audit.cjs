'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,out,root})=>{
 const checks=[],errors=[],check=(value,label)=>{assert(value,label);checks.push(label)},context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  const cases=await page.evaluate(()=>{
   const employee={id:'r103',name:'返岗边界'},date='2026-10-08',run=events=>{
    EMPLOYEES=[employee];state.leaves=[];state.trips=[];state.outings=[];state.overtimeEntries=[];state.manualTempOutings=[];
    state.records=events.map(([time,direction],index)=>({employeeId:employee.id,name:employee.name,datetime:date+' '+time,time,direction,recordId:'r103:'+index}));
    reanalyze();const a=state.analysis.get(employee.id+'|8');return {flags:a.attendanceFlags.map(x=>x.label+'@'+x.time),issues:a.issues,punches:a.punches.length,pairs:a.pairs.map(x=>x.map(y=>y.time)),temporary:a.temporaryOutings.map(x=>({from:x.from,to:x.to,status:x.status}))};
   };
   return {
    morningReturn:run([['08:20','进'],['09:30','出'],['09:50','进'],['11:40','出'],['13:25','进'],['17:10','出']]),
    afternoonReturn:run([['08:20','进'],['11:40','出'],['13:25','进'],['14:00','出'],['14:25','进'],['17:10','出']]),
    extraIn:run([['08:20','进'],['09:30','出'],['09:50','进'],['09:51','进'],['11:40','出'],['13:25','进'],['17:10','出']]),
    realMorningEarly:run([['08:20','进'],['09:30','出'],['13:25','进'],['17:10','出']]),
    realAfternoonEarly:run([['08:20','进'],['11:40','出'],['13:25','进'],['14:00','出']]),
    shortBoundary:run([['08:20','进'],['11:38','出'],['11:42','进'],['11:43','出'],['13:25','进'],['17:10','出']]),
    longBoundary:run([['08:20','进'],['11:38','出'],['12:00','进'],['12:01','出'],['13:25','进'],['17:10','出']])
   };
  });
  check(!cases.morningReturn.flags.some(x=>x.includes('早退'))&&cases.morningReturn.temporary.some(x=>x.status==='red'&&Math.abs(x.to-x.from-20)<1e-8),'09:30 long internal outing returns before morning end and remains a red outing only');
  check(!cases.afternoonReturn.flags.some(x=>x.includes('早退'))&&cases.afternoonReturn.temporary.some(x=>x.status==='red'&&Math.abs(x.to-x.from-25)<1e-8),'14:00 long internal outing returns before afternoon end and remains a red outing only');
  check(!cases.extraIn.flags.some(x=>x.includes('早退'))&&cases.extraIn.issues.some(x=>x.includes('重复进'))&&cases.extraIn.punches===7,'an extra in punch remains visible and suspect without fabricating early departure');
  check(cases.realMorningEarly.flags.includes('上午早退@09:30:00'),'a departure that lasts through the morning boundary still counts as morning early departure');
  check(cases.realAfternoonEarly.flags.includes('早退@14:00:00'),'a final afternoon departure with no return still counts as early departure');
  check(!cases.shortBoundary.flags.some(x=>x.includes('早退')),'short out-in crossing the shift boundary keeps R101 tolerance');
  check(cases.longBoundary.flags.includes('上午早退@11:38:00'),'long absence crossing the shift boundary remains early departure');
  check(!errors.length,'R103 return-to-work cases have no script errors: '+errors.join(' | '));
  fs.writeFileSync(path.join(out,'r103-audit.json'),JSON.stringify({checks,cases,errors},null,2));
  console.log('P109_R103_AUDIT_PASS '+JSON.stringify({checks:checks.length,errors:errors.length}));
 }finally{await context.close()}
};
