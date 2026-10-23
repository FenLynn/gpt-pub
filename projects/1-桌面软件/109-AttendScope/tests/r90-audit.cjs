'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,out,root})=>{
 const context=await browser.newContext({viewport:{width:1600,height:900}}),page=await context.newPage(),errors=[],remote=[],report={checks:[],geometry:[]};
 const check=(ok,label)=>{assert(ok,label);report.checks.push(label)};
 let accept=true;page.on('dialog',d=>accept?d.accept():d.dismiss());page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url())});
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  for(const size of [{width:1280,height:720},{width:1366,height:768},{width:1920,height:1080}]){
   await page.setViewportSize(size);
   for(const mode of ['all','group','person','stats','data']){
    await page.evaluate(mode=>navigateWorkspace(mode),mode);
    const g=await page.evaluate(()=>{
     const box=n=>n.getBoundingClientRect().toJSON(),footer=document.querySelector('.p109-sidebar-footer'),content=document.querySelector('.p109-sidebar-content');
     const buttons=['importBtn','exportMenuButton','projectMenuButton','p109Help','saveBtn'].map(id=>box(document.getElementById(id)));
     const result={mode:state.workspaceMode,footer:box(footer),scroll:content.scrollHeight,client:content.clientHeight,buttons,overflow:document.documentElement.scrollWidth>innerWidth+1};
     if(['all','group','person'].includes(state.workspaceMode)){
      const calendar=box(document.querySelector('.side-calendar')),filters=box(document.querySelector('.side-refinements')),people=box(document.querySelector('.side-inline'));
      result.order=calendar.bottom<=filters.top+1&&filters.bottom<=people.top+1;
     }
     if(state.workspaceMode==='stats')result.fields=[...document.querySelectorAll('.stats-side-field,.r69-side-stat-filters label')].map(n=>{const s=box(n.querySelector('select')),r=box(n);return s.left>r.left+30&&s.right<=r.right+1&&Math.abs(s.top+s.height/2-r.top-r.height/2)<1.5});
     return result;
    });report.geometry.push({...size,...g});
    check(!g.overflow&&g.footer.bottom<=size.height&&g.footer.bottom>=size.height-16,'footer remains at bottom and no horizontal overflow '+mode+'/'+size.width);
    check(g.buttons.every((b,i,all)=>!i||b.left>=all[i-1].right-1),'Import Export Project Help Save order '+mode+'/'+size.width);
    if(g.order!=null)check(g.order&&g.scroll<=g.client+1,'calendar filters people in natural order without redundant scroll '+mode+'/'+size.width);
    if(g.fields)check(g.fields.every(Boolean),'statistics labels and selects share rows '+size.width);
   }
  }
  await page.setViewportSize({width:1366,height:500});await page.evaluate(()=>navigateWorkspace('data'));
  await page.locator('.p109-sidebar-content').evaluate(n=>n.scrollTop=n.scrollHeight);
  check(await page.locator('#settingsBtn').isVisible(),'settings remains visible while navigation scrolls');await page.locator('#settingsBtn').click();
  check(await page.locator('#settingsClose').isVisible(),'bottom settings opens real dialog');await page.locator('#settingsClose').click();
  check(await page.evaluate(()=>document.activeElement.id==='settingsBtn'),'settings restores keyboard focus');
  await page.setViewportSize({width:1600,height:900});await page.evaluate(()=>navigateWorkspace('stats'));await page.screenshot({path:path.join(out,'r90-statistics.png')});
  await page.evaluate(()=>p109OpenCalendar());
  const headings=await page.locator('.r69-nav-category').evaluateAll(nodes=>nodes.map(n=>({size:parseFloat(getComputedStyle(n).fontSize),weight:+getComputedStyle(n).fontWeight})));
  check(headings.every(n=>n.size>=14&&n.weight>=700),'both navigation group headings are prominent');
  check(await page.locator('[data-data-section="calendar"]').evaluate(n=>{const s=getComputedStyle(n);return s.borderTopWidth==='1px'&&s.borderLeftWidth==='1px'&&getComputedStyle(n,'::before').display==='none'}),'selection uses full frame without crescent');
  const before=await page.evaluate(()=>JSON.stringify(state.calendarOverrides));await page.locator('[data-calendar-date="2026-10-08"]').click();await page.locator('[data-calendar-date="2026-10-09"]').click();
  check(await page.evaluate(()=>p109CalendarUI.chosen.size===2)&&await page.evaluate(()=>JSON.stringify(state.calendarOverrides))===before,'multiple selection does not modify calendar');
  await page.locator('[data-calendar-set="rest"]').click();
  check(await page.evaluate(()=>dayType(8)==='rest'&&dayType(9)==='rest'&&!state.saved&&state.monthStores.get('2026-10').calendarOverrides['2026-10-09']==='rest'),'batch rest applies and enters month save state');
  await page.locator('[data-calendar-set="work"]').click();check(await page.evaluate(()=>dayType(8)==='work'&&dayType(9)==='work'),'batch work restores selected days');
  await page.locator('#p109CalendarAll').click();check(await page.locator('[data-calendar-date][aria-pressed="true"]').count()===31,'select all month days');await page.locator('#p109CalendarClear').click();
  check(await page.locator('[data-calendar-set="rest"]').isDisabled(),'clear selection disables empty batch');
  accept=false;await page.locator('#p109CalendarMonth').fill('2026-11');await page.locator('#p109CalendarMonth').dispatchEvent('change');
  check(await page.evaluate(()=>monthKey()==='2026-10')&&await page.locator('#p109CalendarMonth').inputValue()==='2026-10','cancel new month preserves month and selector');
  accept=true;await page.locator('#p109CalendarMonth').fill('2026-11');await page.locator('#p109CalendarMonth').dispatchEvent('change');await page.waitForFunction(()=>monthKey()==='2026-11');
  check(await page.locator('[data-calendar-date]').count()===30,'month picker creates and opens month with correct day count');
  await page.locator('[data-calendar-date="2026-11-02"]').click();await page.locator('[data-calendar-set="rest"]').click();
  await page.locator('#p109CalendarMonth').fill('2026-10');await page.locator('#p109CalendarMonth').dispatchEvent('change');
  check(await page.evaluate(()=>monthKey()==='2026-10'&&dayType(8)==='work'&&state.monthStores.get('2026-11').calendarOverrides['2026-11-02']==='rest'),'month switching retains separate calendar edits');
  await page.screenshot({path:path.join(out,'r90-calendar.png')});
  await page.evaluate(()=>{
   YEAR=2026;MONTH=10;EMPLOYEES=[{id:'r90-person',name:'核查人员'}];state.groups={'r90-person':'核查组'};state.groupCatalog=['核查组'];
   Object.assign(RULES,P109_DEFAULT_RULES);Object.assign(state,{isDemo:false,records:[['08:50','进'],['11:30','出'],['13:45','进'],['17:00','出']].map(([time,direction],i)=>({recordId:'r90-'+i,employeeId:'r90-person',name:'核查人员',datetime:'2026-10-08 '+time,time,direction})),leaves:[],trips:[],outings:[],overtimeEntries:[],manualTempOutings:[],manualOvertime:[],manualStatuses:{},attendanceReview:{},tempOutingReview:{},overtimeReview:{},calendarOverrides:{},selection:{type:'cell',employeeId:'r90-person',day:8},workspaceMode:'person',chartDay:8,chartTab:'timeline',timelineRange:null});reanalyze();render();
  });await page.waitForSelector('[data-attendance-id]');await page.waitForSelector('[data-interval-add]');
  await page.mouse.move(5,5);
  check(await page.locator('[data-attendance-id]').first().evaluate(n=>{const label=n.firstElementChild.getBoundingClientRect(),r=n.getBoundingClientRect(),b=n.querySelector('button').getBoundingClientRect();return r.width-label.width<17&&(b.left>=r.right-1||b.right<=r.left+1)}),'tag fits label and review button sits outside');
  const tag=page.locator('[data-attendance-id]').first();await tag.hover();check(await tag.locator('button').isVisible(),'outside review button is visible on label hover');await tag.locator('button').click();
  await page.waitForSelector('[data-attendance-id].is-excluded');const excluded=page.locator('[data-attendance-id].is-excluded').first();await excluded.focus();await excluded.locator('button').click();await page.waitForFunction(()=>!Object.values(state.attendanceReview).some(v=>v===false));
  check(true,'outside x and keyboard restore change real review state');
  await page.mouse.move(5,5);
  const opacity=()=>page.locator('[data-interval-add]').evaluateAll(nodes=>nodes.map(n=>({kind:n.dataset.intervalAdd,visible:+getComputedStyle(n).opacity>0.9})));
  check((await opacity()).every(n=>!n.visible),'both plus controls hidden outside timeline');
  for(const kind of ['outing','overtime']){
   const box=await page.locator('[data-interval-add="'+kind+'"]').boundingBox();await page.mouse.move(box.x-100,box.y+box.height/2);
   check((await opacity()).every(n=>n.visible===(n.kind===kind)),'only hovered row reveals its plus '+kind);
  }
  const outing=await page.locator('[data-interval-add="outing"]').boundingBox();await page.mouse.move(outing.x,outing.y-80);check((await opacity()).every(n=>!n.visible),'other behavior rows reveal neither plus');
  await page.locator('[data-interval-add="outing"]').focus();check((await opacity()).find(n=>n.kind==='outing').visible,'keyboard focus reveals plus');
  await page.screenshot({path:path.join(out,'r90-person-controls.png')});
  check(errors.length===0&&remote.length===0,'no script errors or runtime network requests');report.errors=errors;report.remote=remote;
  fs.writeFileSync(path.join(out,'r90-audit.json'),JSON.stringify(report,null,2));console.log('P109_R90_AUDIT_PASS '+JSON.stringify({checks:report.checks.length,geometry:report.geometry.length}));
 }catch(error){fs.writeFileSync(path.join(out,'r90-failure.json'),JSON.stringify({error:error.stack,report,errors},null,2));await page.screenshot({path:path.join(out,'r90-failure.png')});throw error}finally{await context.close()}
};
