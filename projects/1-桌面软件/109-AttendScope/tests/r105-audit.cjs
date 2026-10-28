'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,out,root})=>{
 const checks=[],errors=[],check=(value,label)=>{assert(value,label);checks.push(label)},context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  const result=await page.evaluate(async()=>{
   state.isDemo=false;state.fixedPeople=EMPLOYEES.slice(0,3).map(e=>e.id);state.ignoredPeople=[EMPLOYEES[2].id];
   state.prefs={...state.prefs,fontScale:1.17,motion:false,appTitle:'年度接续测试'};
   p109FixedCalendar={schemaVersion:1,kind:'P109-Fixed-Calendar',updatedAt:Date.now(),months:{'2027-01':p109CalendarMonthValues(2027,1,{},false)}};
   state.projectIdentity={projectInstanceId:'parent-r105',createdAt:'2026-01-01T00:00:00.000Z',lineage:null};
   const sealed=await p109SealConfiguration(),validated=await p109ValidateConfiguration(sealed);window.r105Bundle=validated;
   const files=p109SuccessorFiles(validated,{name:'考勤-2027',year:2027,month:1,inheritPrefs:true,inheritCalendar:true}),
    read=name=>JSON.parse(new TextDecoder().decode(files.find(f=>f.name===name).data)),project=read('project.json'),working=read('data/2027/01/working/state.json'),profile=read('config/project-profile.json'),calendar=read('config/fixed-calendar.json'),built=await p109ZipBuild(files),opened=await p109ZipRead(new File([built.zip],'r105.zip',{type:'application/zip'}));
   const warningKey='p109-size-warning-v1:'+state.projectIdentity.projectInstanceId;localStorage.removeItem(warningKey);p109SizeWarningLast={key:'',at:0};
   const warnings=[];for(let i=0;i<3;i++){p109SizeWarningLast.at=0;warnings.push(p109MaybeWarnProjectSize(101*1024*1024))}
   p109SizeWarningLast.at=0;warnings.push(p109MaybeWarnProjectSize(205*1024*1024));
   return {sealed,validated,project,working,profile,calendar,opened:opened.map(x=>x.name),warnings,warningRecord:JSON.parse(localStorage.getItem(warningKey)),menu:!!document.getElementById('p109ConfigExport')&&!!document.getElementById('p109ProjectRollover')};
  });
  check(result.sealed.integrity.sha256.length===64&&result.validated.kind==='P109-Project-Configuration','configuration bundle is versioned and SHA-256 sealed');
  check(result.working.records.length===0&&result.working.imports.length===0&&result.project.months.length===1&&result.project.current.year===2027,'successor contains one empty starting month and no history');
  check(result.working.prefs.fontScale===1.17&&result.working.prefs.motion===false,'all persisted UI preferences inherit by default');
  check(result.profile.pinRoster&&result.profile.pinRules&&result.profile.pinImport&&result.profile.ignoredPeople.length===1,'roster, ignored people, rules and import templates are pinned');
  check(result.calendar.months['2027-01']&&result.project.lineage.parentProjectInstanceId==='parent-r105','fixed calendar and project lineage are preserved');
  check(result.opened.includes('p109-backup-manifest.json')&&result.opened.includes('config/source-configuration.json'),'successor ZIP is self-verifying and retains source configuration');
  check(JSON.stringify(result.warnings)===JSON.stringify([true,true,false,true])&&result.warningRecord.bands['1']===2&&result.warningRecord.bands['2']===1,'size reminder appears twice per 100 MB band and never blocks');
  check(result.menu,'configuration and rollover actions are visible in project menu');
  await page.evaluate(()=>p109ConfigurationForm(window.r105Bundle));
  const geometry=await page.locator('#p109TransferOverlay .p109-update-panel').evaluate(node=>{const r=node.getBoundingClientRect();return {width:r.width,height:r.height,right:r.right,bottom:r.bottom,viewport:[innerWidth,innerHeight],checks:document.querySelectorAll('.p109-config-check input:checked').length}});
  check(geometry.width>900&&geometry.height<geometry.viewport[1]&&geometry.right<=geometry.viewport[0]&&geometry.bottom<=geometry.viewport[1]&&geometry.checks===2,'configuration preview is wide, bounded and defaults to all preferences and calendar');
  await page.locator('#p109TransferClose').click();
  check(!errors.length,'R105 has no browser script errors: '+errors.join(' | '));
  fs.writeFileSync(path.join(out,'r105-audit.json'),JSON.stringify({checks,geometry,errors},null,2));
  console.log('P109_R105_AUDIT_PASS '+JSON.stringify({checks:checks.length,errors:errors.length}));
 }finally{await context.close()}
};
