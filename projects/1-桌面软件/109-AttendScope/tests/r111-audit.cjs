'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,root,out})=>{
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),checks=[],errors=[];
 const check=(ok,name)=>{assert(ok,name);checks.push(name)};page.on('pageerror',e=>errors.push(e.stack||e.message));page.on('dialog',d=>d.accept());
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  const cases=await page.evaluate(async()=>{
   p109BlankWork();YEAR=2026;MONTH=10;const employee={id:personIdentity('报备实际核查'),name:'报备实际核查'},date='2026-10-08';EMPLOYEES=[employee];
   const near=(a,b)=>Math.abs(a-b)<1e-7,cases={},events=[['08:30','进'],['10:00','出'],['10:20','进'],['11:40','出'],['13:30','进'],['17:10','出']],
    business=(id,start,end,labelParts=[])=>({id,employeeId:employee.id,name:employee.name,date,start,end,startDate:date,endDate:date,labelParts}),
    seed=(reports=[])=>{
     Object.assign(RULES,P109_DEFAULT_RULES);Object.assign(state,{records:events.map(([time,direction],i)=>({recordId:'r111:'+i,employeeId:employee.id,name:employee.name,datetime:date+' '+time,time,direction})),
      leaves:[],trips:[],outings:reports.map(([start,end],i)=>business('report:'+i,start,end)),overtimeEntries:[],manualOvertime:[],manualTempOutings:[],manualStatuses:{},attendanceReview:{},overtimeReview:{},tempOutingReview:{},monthStores:new Map(),calendarOverrides:{[date]:'work'},snapshotContext:false,activeBranch:null,
      revisions:[],revisionSeq:0,imports:[],saved:false,isDemo:false,prefs:{fontScale:1,motion:false},workspaceMode:'person',selection:{type:'cell',employeeId:employee.id,day:8},chartDay:8,chartTab:'timeline',timelineRange:null});reanalyze();
    },a=()=>state.analysis.get(employee.id+'|8'),v=(family,metric,days=[8])=>asStatValue(asStatLedger(),family,metric,EMPLOYEES,days);
   seed([['09:55','10:25']]);const original=JSON.stringify(state.records),reportOriginal=JSON.stringify(state.outings);
   cases.report30Actual20=near(v('outing','hours')*60,30)&&near(v('tempOuting','hours')*60,20)&&v('outing','count')===1&&v('tempOuting','count')===1;
   cases.greenCoverage=activeTemporaryOutings(a())[0].status==='green';
   cases.separateNames=asStatFamily('outing')[1]==='报备外出'&&asStatFamily('tempOuting')[1]==='实际临时外出';
   cases.inspectorReport=timelineBehaviorSummaryRow(a(),'outing').includes('0h 30m')&&timelineBehaviorSummaryRow(a(),'outing').includes('报备外出');
   cases.summaryActual=near(p109TempSummary([a()]).minutes,20)&&near(behaviorMinutes(a(),'outing'),30)&&near(behaviorMinutes(a(),'tempOuting'),20);
   const csv=traditionalRows().find(r=>r.日期===date);cases.exportBoth=csv.报备外出记录数===1&&near(csv.报备外出分钟,30)&&near(csv.临时外出班内分钟,20);
   p109SetTempDecision(a().temporaryOutings[0].id,'exclude');
   cases.excludeOnlyActual=v('tempOuting','count')===0&&near(v('tempOuting','hours'),0)&&v('outing','count')===1&&near(v('outing','hours')*60,30);
   cases.excludedFilter=attendanceBehaviors(a()).includes('outing')&&!attendanceBehaviors(a()).includes('tempOuting');
   cases.rawNeverModified=JSON.stringify(state.records)===original&&JSON.stringify(state.outings)===reportOriginal;
   p109SetTempDecision(a().temporaryOutings[0].id,null);cases.restoreActual=near(v('tempOuting','hours')*60,20);
   seed();cases.noReportActual=v('outing','count')===0&&v('outing','hours')===0&&v('tempOuting','count')===1&&v('tempOuting','redCount')===1;
   cases.actualFilterOnly=!attendanceBehaviors(a()).includes('outing')&&attendanceBehaviors(a()).includes('tempOuting');
   setManualStatusForCurrent('normal');cases.normalKeepsRed=v('tempOuting','redCount')===1;
   seed([['09:55','10:25']]);state.records=state.records.filter(r=>!['10:00','10:20'].includes(r.time));reanalyze();
   cases.reportOnly=v('outing','count')===1&&near(v('outing','hours')*60,30)&&v('tempOuting','count')===0;
   seed([['09:55','10:25'],['10:05','10:35']]);cases.reportUnion=near(v('outing','hours')*60,40)&&v('outing','count')===2&&near(v('tempOuting','hours')*60,20);
   state.outings.push({...state.outings[0]});reanalyze();cases.duplicateSourceIgnored=near(v('outing','hours')*60,40)&&v('outing','count')===2;
   seed([['11:30','13:40']]);cases.reportKeepsDeclaredLunch=near(v('outing','hours')*60,130)&&near(behaviorMinutes(a(),'outing'),130);
   state.outings=[{...business('multi','10:00','10:30'),endDate:'2026-10-09'}];reanalyze();
   cases.multiDayReport=near(v('outing','hours',[8,9])*60,60)&&v('outing','count',[8,9])===1;
   seed();state.manualTempOutings=[{id:'manual:r111',employeeId:employee.id,date,start:'10:10',end:'10:30'}];reanalyze();
   cases.actualUnion=near(v('tempOuting','hours')*60,30)&&near(p109TempSummary([a()]).minutes,30)&&v('outing','hours')===0;
   seed([['09:55','10:25']]);state.overtimeEntries=[business('ot1','19:00','19:30'),business('ot2','19:20','19:40')];reanalyze();cases.overtimeStillUnion=near(v('overtime','hours')*60,40);
   const legacyRules={...P109_DEFAULT_RULES};delete legacyRules.outingStatisticsRuleVersion;
   const payload={schemaVersion:12,year:2026,month:10,records:state.records,outings:state.outings,rules:legacyRules,calendarOverrides:state.calendarOverrides},live=normalizeSavedMonth(payload),frozen=normalizeSavedMonth(payload,true);
   cases.workingMigrates=live.rules.outingStatisticsRuleVersion===2&&!live.saved;
   cases.frozenKeepsOld=frozen.rules.outingStatisticsRuleVersion===1&&frozen.rules.statisticsRuleVersion===2;
   Object.assign(RULES,frozen.rules);reanalyze();cases.oldActualFamily=near(v('outing','hours')*60,20)&&asStatFamily('outing')[1].includes('历史');
   RULES.statisticsRuleVersion=1;reanalyze();cases.oldReportFamily=near(v('outing','hours')*60,30)&&asStatFamily('outing')[1].includes('历史');
   cases.invalidVersionRejected=!p109ValidOvertimeRules({...P109_DEFAULT_RULES,outingStatisticsRuleVersion:3});
   seed([['09:55','10:25']]);p109SetTempDecision(a().temporaryOutings[0].id,'exclude');state.projectDir=p109MemoryRoot('报备实际核查');
   const memory=await p109PortableFromSession(),built=await p109ZipBuild(await p109PortableCollect(memory));state.saved=true;
   await p109OpenPortableFile(new File([built.zip],'r111.zip',{type:'application/zip'}));
   cases.zipKeepsSeparate=RULES.outingStatisticsRuleVersion===2&&near(v('outing','hours')*60,30)&&v('tempOuting','count')===0;
   cases.zipRawUnchanged=JSON.stringify(state.records)===original&&JSON.stringify(state.outings)===reportOriginal;
   cases.schemaGuard=P109_DATA_SCHEMA>=13&&workingPayload().schemaVersion===P109_DATA_SCHEMA;
   seed([['09:55','10:25']]);state.trips=[business('trip','08:30','17:10',['项目验收出差','上海','现场对接'])];
   state.leaves=[business('leave60','14:00','15:00',['事假','家庭事务及现场交接安排说明']),business('leave5','15:01','15:06',['五分钟请假','短区间文字'])];
   state.outings[0].labelParts=['公务外出','设备送检及返回园区'];
   state.overtimeEntries=[business('ot5','17:40','17:45',['五分钟','设备点检']),business('ot15','17:46','18:01',['十五分钟','设备恢复']),business('ot30','18:02','18:32',['半小时','数据复核']),
    business('ot60','18:33','19:33',['一小时','现场问题处理']),business('ot180','19:34','22:34',['三小时','版本发布及现场问题处理，长文字用于检查省略与完整悬浮展示']),
    business('ot1','22:35','22:36',['一分钟','复检']),business('ot10s','22:36:10','22:36:20',['十秒钟','very-short-boundary'])];
   window.p111AuditEmployee=employee;window.p111AuditBusiness=business;reanalyze();render();return cases;
  });for(const [name,ok] of Object.entries(cases))check(ok,name);
  await page.waitForSelector('#attendanceTimelineChart svg');
  const inspect=()=>page.evaluate(()=>{
   const chart=echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart')),a=state.analysis.get(p111AuditEmployee.id+'|8'),bars=r14TrackData(a,state.timelineRange,chart.getWidth()).bars,
    height=Math.abs(chart.convertToPixel({yAxisIndex:0},0)-chart.convertToPixel({yAxisIndex:0},1)),labels=[...p111BandLabelLayout(bars,p=>chart.convertToPixel({xAxisIndex:0,yAxisIndex:0},p),14,chart.getWidth()-88,height).entries()],
    collisions=[];
   for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
    const x=labels[i][1].box,y=labels[j][1].box;if(x.lane===y.lane&&x.left<y.right&&y.left<x.right&&x.top<y.bottom&&y.top<x.bottom)collisions.push([i,j]);
   }
   const rendered=chart.getZr().storage.getDisplayList().filter(node=>node.type==='tspan'&&node.style?.font?.includes('13px'));
   const detachedBefore=labels.filter(([index,label])=>{const from=chart.convertToPixel({xAxisIndex:0,yAxisIndex:0},[bars[index].value[0],bars[index].value[2]])[0];return from<=chart.getWidth()-88&&label.box.right<=from&&from-label.box.right>7});
   return {width:innerWidth,chartWidth:chart.getWidth(),labels,collisions,detachedBefore,rendered:rendered.map(node=>({text:node.style.text,fill:node.style.fill,font:node.style.font,opacity:node.style.opacity})),tooltipFont:chart.getOption().tooltip[0].textStyle.fontSize};
  });
  const geometry=[];
  for(const width of [1280,1366,1440,1920]){
   await page.setViewportSize({width,height:900});await page.waitForTimeout(220);const g=await inspect();geometry.push(g);
   check(g.labels.length>=4,'readable labels survive at '+width);
   check(g.collisions.length===0,'no text collisions at '+width);
   check(g.detachedBefore.length===0,'short before-labels stay beside their own blocks at '+width);
   check(g.labels.every(([,r])=>r.box.left>=14&&r.box.right<=g.chartWidth-88+.01),'labels stay clear of track names at '+width);
   check(g.rendered.some(n=>n.fill==='#18394c')&&g.tooltipFont===15,'dark 13px labels and 15px tooltip at '+width);
   await page.screenshot({path:path.join(out,'r111-durations-'+width+'.png')});
  }
  await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(220);
  for(const prefix of ['项目验收','事假','公务外出','三小时','十秒钟']){
   await page.evaluate(prefix=>{
    const chart=echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart')),series=chart.getOption().series,at=series.findIndex(s=>s.id==='bands'),index=series[at].data.findIndex(d=>d.label?.startsWith(prefix));
    chart.dispatchAction({type:'showTip',seriesIndex:at,dataIndex:index});
   },prefix);await page.waitForTimeout(120);
   check(await page.evaluate(prefix=>[...document.querySelectorAll('#attendanceTimelineChart div')].some(el=>el.innerText.includes(prefix)&&el.style.position==='absolute'&&el.getBoundingClientRect().width>0&&getComputedStyle(el).fontSize==='15px'),prefix),'full readable tooltip: '+prefix);
  }
  await page.screenshot({path:path.join(out,'r111-tooltip.png')});
  await page.evaluate(()=>{const target=document.querySelector('.insight-behavior-row.outing');r73ShowTooltip(target)});
  check(await page.locator('#r73FloatingTip').evaluate(el=>getComputedStyle(el).fontSize==='15px'),'inspector help tooltip is 15px');
  await page.evaluate(()=>{r73HideTooltip();state.overtimeEntries=[p111AuditBusiness('long-tooltip','19:00','21:00',['超长完整说明',...Array.from({length:11},(_,i)=>'字段'+i+'：'+'现场交接及设备检查。'.repeat(30))])];reanalyze();render()});
  await page.waitForTimeout(150);await page.evaluate(()=>{const chart=echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart')),series=chart.getOption().series,at=series.findIndex(s=>s.id==='bands');chart.dispatchAction({type:'showTip',seriesIndex:at,dataIndex:series[at].data.findIndex(d=>d.label?.startsWith('超长完整说明'))})});
  await page.waitForTimeout(150);const longTips=await page.evaluate(()=>[...document.querySelectorAll('#attendanceTimelineChart div')].filter(el=>el.style.position==='absolute'&&el.innerText.includes('超长完整说明')).map(el=>({text:el.innerText.length,scroll:el.scrollHeight,client:el.clientHeight,height:el.getBoundingClientRect().height,bottom:el.getBoundingClientRect().bottom,overflow:getComputedStyle(el).overflowY,style:el.style.cssText})));
  fs.writeFileSync(path.join(out,'r111-long-tooltip-geometry.json'),JSON.stringify(longTips,null,2));
  check(longTips.some(el=>el.scroll>el.client&&el.height<=480&&el.bottom<=900&&el.overflow==='auto'),'very long tooltip remains within viewport and can scroll');
  await page.screenshot({path:path.join(out,'r111-long-tooltip.png')});
  await page.evaluate(()=>{r73HideTooltip();state.overtimeEntries=[p111AuditBusiness('overlap1','18:00','20:00',['重叠甲','现场问题处理']),p111AuditBusiness('overlap2','19:00','21:00',['重叠乙','设备联调'])];state.timelineRange=null;reanalyze();render()});
  await page.waitForTimeout(200);const overlap=await inspect();check(!overlap.collisions.length,'overlapping overtime labels use separate positions');
  check(overlap.labels.filter(([i])=>i>=0).length>=5,'overlapping labels remain available');await page.screenshot({path:path.join(out,'r111-overlap.png')});
  await page.evaluate(()=>{const chart=echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart'));chart.dispatchAction({type:'dataZoom',startValue:19*60,endValue:20*60})});
  await page.waitForTimeout(200);const zoom=await inspect();check(!zoom.collisions.length&&zoom.labels.every(([,r])=>r.box.left>=14&&r.box.right<=zoom.chartWidth-88+.01),'zoom recalculates and clips labels');
  await page.screenshot({path:path.join(out,'r111-zoom.png')});check(!errors.length,'no browser errors: '+errors.join(' | '));
  fs.writeFileSync(path.join(out,'r111-audit.json'),JSON.stringify({checks,cases,geometry,overlap,zoom,errors},null,2));console.log('P109_R111_AUDIT_PASS '+JSON.stringify({checks:checks.length}));
 }finally{await context.close()}
};
