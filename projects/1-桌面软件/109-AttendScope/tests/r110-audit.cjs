'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,root,out})=>{
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[],checks=[];
 const check=(value,name)=>{assert(value,name);checks.push(name)};page.on('pageerror',e=>errors.push(e.stack||e.message));page.on('dialog',d=>d.accept('标签项目'));
 const open=async(kind,text,name=kind+'.csv')=>{await page.evaluate(async({kind,text,name})=>r62OpenImport(new File([text],name,{type:'text/csv'}),kind),{kind,text,name});await page.waitForSelector('#r62Commit:not([disabled])')};
 const commit=async()=>{await page.locator('#r62Commit').click();await page.waitForFunction(()=>!r62ImportDraft&&!state.importCommitting)};
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  check(await page.evaluate(()=>['leave','trip','outing','overtime'].every(kind=>{const row=(state[P110_LABEL_ROWS[kind]]||[])[0];return row&&p110TrackLabel(row,kind).length>0})),'Demo has meaningful labels for all four business tracks');
  await page.evaluate(async()=>{p109BlankWork();await p109NewPortable();YEAR=2026;MONTH=10;rememberMonth()});
  const csv='姓名,开始日期,开始时间,结束日期,结束时间,类型,备注,任务编号,审批人\n标签甲,2026-10-08,19:00,2026-10-08,20:00,项目加班,版本发布,OT-110,张主管';
  await open('overtime',csv);
  check(await page.locator('#r104LabelAdd').count()===1,'overtime import exposes the same editable display fields');
  await page.locator('#r104LabelAdd').selectOption('7');
  await page.locator('[data-label-pos="2"][data-label-move="up"]').click();await page.locator('[data-label-pos="1"][data-label-move="up"]').click();
  await page.locator('[data-label-title="7"]').fill('任务');await page.locator('[data-label-title="7"]').dispatchEvent('change');
  await commit();
  check(await page.evaluate(()=>p110TrackLabel(state.overtimeEntries[0],'overtime')==='任务：OT-110 · 项目加班 · 版本发布'),'import choice order and custom display title apply immediately');
  check(await page.evaluate(()=>state.overtimeEntries[0].labelData.some(f=>f.name==='审批人'&&f.value==='张主管')),'unselected source columns remain available for post-import display changes');
  const before=await page.evaluate(()=>({raw:JSON.stringify(state.records),business:JSON.stringify(state.overtimeEntries.map(({labelData,labelParts,...r})=>r)),hours:asStatValue(asStatLedger(),'overtime','hours',EMPLOYEES,[8]),fileHash:state.imports[0].sha256}));
  await page.evaluate(()=>{state.workspaceMode='data';state.dataSection='templates';render()});await page.locator('[data-p110-labels]').click();await page.locator('[data-p110-kind="overtime"]').click();
  check(await page.locator('#p110LabelDialog').count()===1,'data management has a post-import month label editor');
  await page.locator('#p110AddField').click();
  const approver=await page.evaluate(()=>state.overtimeEntries[0].labelData.find(f=>f.name==='审批人').key);
  await page.locator('[data-p110-field="3"]').selectOption(approver);await page.locator('[data-p110-title="3"]').fill('审核');
  check((await page.locator('.p110-label-preview strong').innerText()).includes('审核：张主管'),'post-import preview uses previously unselected source column');
  await page.locator('[data-p110-up="3"]').click();await page.locator('#p110ApplyLabels').click();
  check(await page.evaluate(()=>p110TrackLabel(state.overtimeEntries[0],'overtime')==='任务：OT-110 · 项目加班 · 审核：张主管 · 版本发布'),'post-import order and aliases update the existing block');
  check(await page.evaluate(before=>before.raw===JSON.stringify(state.records)&&before.business===JSON.stringify(state.overtimeEntries.map(({labelData,labelParts,...r})=>r))&&before.hours===asStatValue(asStatLedger(),'overtime','hours',EMPLOYEES,[8])&&before.fileHash===state.imports[0].sha256,before),'display changes do not mutate raw punches, business times, overtime totals or source hash');
  await page.evaluate(()=>p110OpenLabels('overtime'));await page.locator('#p110ClearFields').click();await page.locator('[data-p110-close]').first().click();
  check(await page.evaluate(()=>p110TrackLabel(state.overtimeEntries[0],'overtime').startsWith('任务：OT-110')),'cancel discards draft display changes');
  const october=await page.evaluate(()=>JSON.stringify(state.prefs.trackLabels));
  await page.evaluate(()=>switchMonth(2026,11,true));
  check(await page.evaluate(previous=>JSON.stringify(state.prefs.trackLabels)===previous,october),'new month inherits all display settings without explicit project pinning');
  const reordered='审批人,任务编号,备注,结束时间,开始时间,姓名,结束日期,开始日期,类型\n李主管,OT-111,十一月发布,21:00,19:00,标签甲,2026-11-09,2026-11-09,项目加班';
  await open('overtime',reordered);
  check(await page.evaluate(()=>JSON.stringify(r62ImportDraft.labelColumns)===JSON.stringify([1,8,0,2])&&r62ImportDraft.labelTitles[1]==='任务'&&!r62ImportDraft.labelMissing.length),'next-month reordered columns resolve by name and preserve label order and aliases');
  await commit();check(await page.evaluate(()=>p110TrackLabel(state.overtimeEntries[0],'overtime')==='任务：OT-111 · 项目加班 · 审核：李主管 · 十一月发布'),'reordered next-month import uses correct values');
  await page.evaluate(()=>p110OpenLabels('overtime'));await page.locator('[data-p110-title="0"]').fill('单号');await page.locator('#p110ApplyLabels').click();
  await page.evaluate(()=>switchMonth(2026,10));
  check(await page.evaluate(previous=>JSON.stringify(state.prefs.trackLabels)===previous&&p110TrackLabel(state.overtimeEntries[0],'overtime').startsWith('任务：'),october),'editing November does not change existing October settings');
  await page.evaluate(()=>switchMonth(2026,11));
  const missing='姓名,开始日期,开始时间,结束日期,结束时间,类型,备注,新编号\n标签乙,2026-11-10,19:00,2026-11-10,20:00,项目加班,缺列核查,NEW-112';
  await open('overtime',missing);check(await page.evaluate(()=>r62ImportDraft.labelMissing.length===2&&!r62ImportDraft.labelColumns.includes(7)),'renamed and missing source columns are flagged instead of reusing old numeric positions');
  check(await page.evaluate(()=>p110DraftProfile(r62ImportDraft).fields.map(f=>f.name).join('|')==='任务编号|类型|审批人|备注'),'missing columns retain their original order for future months');await page.locator('#r62Cancel').click();
  await page.evaluate(()=>p110OpenLabels('overtime'));await page.locator('#p110ClearFields').click();await page.locator('#p110ApplyLabels').click();
  check(await page.evaluate(()=>p110TrackLabel(state.overtimeEntries[0],'overtime')===''),'explicit empty profile disables text after import');
  await open('overtime',reordered);check(await page.evaluate(()=>r62ImportDraft.labelColumns.length===0&&!r62ImportDraft.labelMissing.length),'disabled text remains disabled on subsequent imports');await page.locator('#r62Cancel').click();
  await page.evaluate(()=>switchMonth(2026,10));
  for(const kind of ['leave','trip','outing']){
   const text=kind==='trip'?'姓名,开始日期,结束日期,类型,地点,备注,编号\n标签甲,2026-10-09,2026-10-09,验收出差,上海,演示备注,TR-110':'姓名,开始日期,开始时间,结束日期,结束时间,类型,备注,编号\n标签甲,2026-10-09,10:00,2026-10-09,11:00,'+(kind==='leave'?'事假':'公务外出')+',演示备注,ID-110';
   await open(kind,text);await commit();
   check(await page.evaluate(kind=>{const row=state[P110_LABEL_ROWS[kind]][0];return row.labelData.some(f=>f.name==='编号')&&p110TrackLabel(row,kind).includes('演示备注')},kind),'import and editable label data available: '+kind);
  }
  check(await page.evaluate(()=>{const a=state.analysis.get(EMPLOYEES[0].id+'|8');return r14TrackData(a).bars.some(b=>b.track==='overtime'&&b.label.includes('任务：OT-110'))}),'registered overtime track receives configured text');
  const legacy=await page.evaluate(async()=>{
   const row=state.overtimeEntries[0],meta=state.imports.find(m=>m.type==='overtime');delete row.labelData;delete meta.labelImportSettings;
   const status=await p110LoadOldColumns('overtime',()=>true);return {status,label:p110TrackLabel(row,'overtime'),raw:row.labelData?.some(f=>f.name==='审批人'),row,meta};
  });fs.writeFileSync(path.join(out,'r110-legacy-probe.json'),JSON.stringify(legacy,null,2));check(legacy.raw&&legacy.label.includes('审核：张主管'),'old records can read verified original cells without reimporting business data');
  check(await page.evaluate(()=>r14TrackData(state.analysis.get(EMPLOYEES[0].id+'|8')).bars.some(b=>b.track==='overtime'&&b.label.includes('审核：张主管'))),'reading old cells refreshes already analyzed overtime display');
  check(await page.evaluate(async()=>{
   const meta=state.imports.find(m=>m.type==='overtime'),original=p109SourceCache.get(meta.id),before=JSON.stringify(state.overtimeEntries);
   p109SourceCache.set(meta.id,new File(['changed'],meta.name));let rejected=false;
   try{await p110LoadOldColumns('overtime',()=>true)}catch(e){rejected=e.message.includes('哈希')}
   p109SourceCache.set(meta.id,original);return rejected&&before===JSON.stringify(state.overtimeEntries);
  }),'changed originals are rejected without partially updating display evidence');
  const helper=await page.evaluate(()=>{
   const cols=['姓名','内容','内容'],d={header:true,skip:0,grid:{rows:[{cells:cols}]}},first=p110Columns(d),other=p110Columns({header:true,skip:0,grid:{rows:[{cells:['内容','姓名','内容']}]}});
   const clean=p110CleanProfile({fields:[{key:'a',name:'A',title:'示例'},{key:'a',name:'B'}]});
   return first[1].key!==first[2].key&&first[1].key!==other[0].key&&clean.fields.length===1;
  });check(helper,'duplicate headers are distinct and changed schemas do not reuse ambiguous positions');
  check(await page.evaluate(()=>{
   const prefs=p109Clone(state.prefs);state.prefs.trackLabels.trip={fields:[{key:'field:type',name:'类型',title:'事项'}]};
   const d={kind:'trip',targetMonth:monthKey(),mapping:{type:1},header:true,skip:0,grid:{rows:[{cells:['姓名','类型']}]} };p110PrepareDraft(d);
   const result=d.labelColumns[0]===1&&p110DraftProfile(d).fields[0].key==='field:type'&&d.labelTitles[1]==='事项';state.prefs=prefs;return result;
  }),'canonical display fields selected after import also inherit into later import mappings');
  const stateBefore=await page.evaluate(()=>JSON.stringify(state.records));
  await page.evaluate(async()=>{const root=await p109PortableFromSession(),built=await p109ZipBuild(await p109PortableCollect(root));state.saved=true;await p109OpenPortableFile(new File([built.zip],'labels-roundtrip.zip',{type:'application/zip'}))});
  check(await page.evaluate(before=>JSON.stringify(state.records)===before&&p110TrackLabel(state.overtimeEntries[0],'overtime').includes('审核：张主管')&&state.prefs.trackLabels.overtime.fields.length===4,stateBefore),'ZIP roundtrip retains month profiles and original display cells');
  await page.evaluate(()=>switchMonth(2026,11));check(await page.evaluate(()=>state.prefs.trackLabels.overtime.fields.length===0),'ZIP roundtrip retains different November profile');
  check(await page.evaluate(()=>{
   const before=JSON.stringify(state.prefs);state.snapshotContext=true;state.activeBranch=null;p110OpenLabels('overtime');const result=!document.getElementById('p110LabelDialog')&&before===JSON.stringify(state.prefs);state.snapshotContext=false;return result;
  }),'frozen snapshots cannot be edited without an independent revision');
  await page.evaluate(()=>{switchMonth(2026,10);state.workspaceMode='person';state.selection={type:'cell',employeeId:EMPLOYEES[0].id,day:8};state.chartDay=8;state.chartTab='timeline';state.timelineRange=null;render()});
  await page.waitForFunction(()=>echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart'))?.getZr().storage.getDisplayList().some(node=>node.style?.text?.startsWith('任务')));
  check(true,'actual overtime timeline renders the configured label');await page.screenshot({path:path.join(out,'r110-overtime-label.png')});
  await page.evaluate(()=>{switchMonth(2026,10);p110OpenLabels('overtime')});
  const geometry=[];for(const width of [1280,1366,1600,1920]){await page.setViewportSize({width,height:900});geometry.push(await page.locator('.p110-label-panel').evaluate(el=>{const r=el.getBoundingClientRect();return {width:innerWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height}}))}
  check(geometry.every(g=>g.left>=0&&g.right<=g.width&&g.top>=0&&g.bottom<=900&&Math.abs(g.height-720)<2&&g.right-g.left>=g.width*.8),'label editor exceeds 80 percent viewport width and has fixed 80 percent height');
  await page.screenshot({path:path.join(out,'r110-month-label-editor.png')});await page.locator('[data-p110-close]').first().click();
  fs.writeFileSync(path.join(out,'r110-audit.json'),JSON.stringify({checks,geometry,errors},null,2));check(!errors.length,'no browser script errors: '+errors.join(' | '));console.log('P109_R110_AUDIT_PASS '+JSON.stringify({checks:checks.length}));
 }finally{await context.close()}
};
