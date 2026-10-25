'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,root,out})=>{
 const context=await browser.newContext({viewport:{width:1600,height:900}}),page=await context.newPage(),errors=[],remote=[],report={checks:[],geometry:[]};
 const check=(ok,label)=>{assert(ok,label);report.checks.push(label)};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url())});page.on('dialog',d=>d.accept());
 const attendance='文件导出说明\n姓名,打卡时间,通行标志,说明\n测试甲,2026-10-08 08:30:00,门禁3,上午\n测试甲,2026-10-08 17:10:00,门禁4-出口,下午';
 const files={
  attendance,
  leave:'姓名,开始日期,开始时间,结束日期,结束时间,开始日期时间,结束日期时间,类型,备注\n测试甲,2026-10-08,09:00,2026-10-09,10:00,2026-10-08 09:00:00,2026-10-09 10:00:00,事假,说明',
  trip:'姓名,开始日期,结束日期,地点,类型,备注\n测试甲,2026-10-08,2026-10-09,示例地点,出差,说明',
  outing:'姓名,开始日期时间,结束日期时间,地点,类型,备注\n测试甲,2026-10-08 10:00:00,2026-10-08 10:30:00,示例地点,外出,说明',
  overtime:'姓名,开始日期,开始时间,结束日期,结束时间,类型,备注\n测试甲,2026-10-08,18:00,2026-10-09,02:00,加班,说明'
 };
 const upload=async(kind,content=files[kind],name=kind+'.csv')=>{
  await page.evaluate(async({kind,content,name})=>r62OpenImport(new File([content],name,{type:'text/csv'}),kind),{kind,content,name});await page.waitForSelector('#r62Commit');
 };
 const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem(R96_IMPORT_SETTINGS_KEY)).templates);
 const commit=async()=>{await page.locator('#r62Commit').click();await page.waitForFunction(()=>!r62ImportDraft&&!state.importCommitting)};
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  const before=await page.evaluate(()=>JSON.stringify({records:state.records,imports:state.imports}));
  await upload('attendance');await page.locator('#r79Advanced').evaluate(el=>el.open=true);
  await page.locator('#r62Skip').fill('1');await page.locator('#r62Skip').press('Tab');
  await page.locator('[data-map="direction"]').selectOption('2');await page.locator('#r79Advanced').evaluate(el=>el.open=true);await page.locator('#r62Encoding').selectOption('utf-8');
  check(await page.locator('#r65SaveTemplate,.r62-rule,[data-rule]').count()===0,'legacy wide form and opt-in checkbox are absent from the narrow panel');
  await page.locator('#r96EditDirections').click();
  check(await page.locator('#r96DirectionOverlay').isVisible()&&await page.locator('.r62-overlay').evaluate(el=>el.inert),'rule editor opens over an inert import dialog');
  await page.locator('[data-rule="0"][data-part="text"]').fill('discarded');await page.keyboard.press('Escape');
  check(await page.locator('#r96DirectionOverlay').count()===0&&await page.evaluate(()=>r62ImportDraft.rules[0].text==='进'&&!document.querySelector('.r62-overlay').inert),'Escape discards unfinished rule changes without closing import');
  await page.locator('#r96EditDirections').click();
  await page.locator('#r62AddRule').click();await page.locator('[data-rule="2"][data-part="text"]').fill('进');
  await page.locator('#r96DirectionOverlay button[type="submit"]').click();
  check((await page.locator('#r96RuleError').innerText()).includes('重复')&&await page.evaluate(()=>r62ImportDraft.rules.length===2),'duplicate rule is rejected without modifying active rules');
  await page.locator('[data-rule="2"][data-part="text"]').fill('门禁3');
  await page.locator('#r62AddRule').click();await page.locator('#r96DirectionOverlay button[type="submit"]').click();
  check((await page.locator('#r96RuleError').innerText()).includes('不能为空'),'blank rule cannot be applied');
  await page.locator('[data-rule="3"][data-part="text"]').fill('门禁4');await page.locator('[data-rule="3"][data-part="direction"]').selectOption({label:'出'});await page.locator('[data-rule="3"][data-part="match"]').selectOption('contains');
  await page.locator('#r96DirectionOverlay [data-rule-close]').first().focus();await page.keyboard.press('Shift+Tab');
  check(await page.locator('#r96DirectionOverlay button[type="submit"]').evaluate(el=>el===document.activeElement),'rule dialog traps reverse keyboard focus');await page.keyboard.press('Tab');
  check(await page.locator('#r96DirectionOverlay [data-rule-close]').first().evaluate(el=>el===document.activeElement),'rule dialog traps forward keyboard focus');
  await page.screenshot({path:path.join(out,'r96-direction-editor.png')});
  await page.locator('#r96DirectionOverlay button[type="submit"]').click();
  check(await page.evaluate(()=>r62ImportDraft.validated.rows.length===2&&r62ImportDraft.validated.rows[0]['进出']==='进'&&r62ImportDraft.validated.rows[1]['进出']==='出'),'applied exact and contains rules update the actual import preview');
  check(await page.locator('.r96-rule-keywords button').count()===4&&(await page.locator('.r96-rule-keywords').innerText()).includes('03')&&await page.locator('.r95-import-fields [data-rule]').count()===0,'parent displays only numbered keyword buttons');
  for(const size of [{width:1280,height:720},{width:1366,height:768},{width:1600,height:900},{width:1920,height:1080}]){
   await page.setViewportSize(size);await page.locator('#r79Advanced').evaluate(el=>el.open=true);
   const g=await page.evaluate(()=>{
    const left=document.querySelector('.r95-import-fields').getBoundingClientRect(),dialog=document.querySelector('.r62-dialog').getBoundingClientRect(),save=document.querySelector('#r96KeepImport').getBoundingClientRect(),head=document.querySelector('.r62-dialog>header').getBoundingClientRect();
    return {fit:dialog.left>=0&&dialog.right<=innerWidth&&dialog.bottom<=innerHeight+1,controlsFit:[...document.querySelectorAll('.r95-import-fields input,.r95-import-fields select,.r96-rule-keywords button')].every(el=>{const r=el.getBoundingClientRect();return r.left>=left.left-1&&r.right<=left.right+1}),keepVisible:save.right<=head.right&&save.top>=head.top&&save.bottom<=head.bottom,leftWidth:left.width};
   });report.geometry.push({...size,...g});check(g.fit&&g.controlsFit&&g.keepVisible&&g.leftWidth<=320,'no import rule or setting overflow '+size.width);
   await page.locator('[data-direction-edit="2"]').click();
   const editor=await page.evaluate(()=>{const p=document.querySelector('.r96-direction-dialog').getBoundingClientRect(),body=document.querySelector('.r96-direction-body');return p.width>=innerWidth*.8&&p.bottom<=innerHeight&&body.scrollWidth<=body.clientWidth+1&&[...document.querySelectorAll('.r96-rule-row :is(input,select,button)')].every(el=>{const r=el.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right})});
   check(editor,'batch rule editor fits '+size.width);await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:1600,height:900});await page.screenshot({path:path.join(out,'r96-import-summary.png')});
  const automatic=await saved();
  check(automatic.attendance.rules.length===4&&automatic.attendance.skip===1&&automatic.attendance.encoding==='utf-8'&&automatic.attendance.mapping.direction===2,'rule and field edits are retained automatically without a save checkbox');
  await page.locator('#r96KeepImport').click();
  check(await page.evaluate(()=>document.querySelector('#r96KeepImport').textContent==='保留导入设置'),'top-right explicit retain action remains clear');
  await page.locator('#r62Cancel').click();
  check(await page.evaluate(before=>JSON.stringify({records:state.records,imports:state.imports})===before,before),'editing and retaining settings do not import or change business records');
  await upload('attendance',attendance.replace('文件导出说明','新的导出说明'),'新的文件名.csv');
  check(await page.evaluate(()=>r62ImportDraft.skip===1&&r62ImportDraft.encoding==='utf-8'&&r62ImportDraft.rules.length===4&&r62ImportDraft.validated.rows.length===2),'last settings restore without matching the old filename');await page.locator('#r62Cancel').click();
  await upload('attendance');await page.locator('#r79Advanced').evaluate(el=>el.open=true);
  await page.evaluate(()=>{window.__r96ReadGrid=XLSX.readGrid;window.__r96Grid=r62ImportDraft.grid;XLSX.readGrid=()=>new Promise(resolve=>window.__r96ReleaseRead=resolve)});
  await page.locator('#r62Encoding').selectOption('gb18030');
  check(await page.locator('#r62Commit').isDisabled()&&await page.locator('#r96KeepImport').isDisabled(),'pending decoding cannot commit or retain unparsed settings');
  await page.locator('#r62Cancel').click();await page.evaluate(()=>{XLSX.readGrid=window.__r96ReadGrid;window.__r96ReleaseRead(window.__r96Grid)});await page.waitForFunction(()=>!r63ReadingImport);
  check(await page.locator('.r62-overlay').count()===0&&await page.evaluate(()=>!r62ImportDraft),'cancelled asynchronous decoding cannot reopen the import dialog');
  await upload('attendance');await page.locator('#r79Advanced').evaluate(el=>el.open=true);await page.evaluate(()=>{XLSX.readGrid=async()=>{throw Error('decode failed')}});await page.locator('#r62Encoding').selectOption('gb18030');await page.waitForFunction(()=>!r63ReadingImport);
  check(await page.evaluate(()=>r62ImportDraft.encoding==='utf-8'&&r62ImportDraft.validated.rows.length===2&&r62ImportDraft.error==='decode failed'),'failed decoding restores the previous encoding and usable preview');await page.evaluate(()=>{XLSX.readGrid=window.__r96ReadGrid});await page.locator('#r62Cancel').click();
  await page.reload();await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();await upload('attendance');
  check(await page.evaluate(()=>r62ImportDraft.rules.length===4&&r62ImportDraft.skip===1&&r62ImportDraft.validated.rows.length===2),'browser reload preserves independent import preferences');await page.locator('#r62Cancel').click();
  await upload('attendance',attendance.split('\n').slice(1).join('\n'),'没有说明行.csv');
  check(await page.evaluate(()=>r62ImportDraft.skip===0&&r62ImportDraft.validated.rows.length===2),'saved headers relocate when an export removes its leading title without losing the first record');await page.locator('#r62Cancel').click();
  await upload('attendance','说明\n通行标志,说明,打卡时间,姓名\n门禁3,新备注,2026-10-08 08:30:00,测试甲\n门禁4-出口,新备注,2026-10-08 17:10:00,测试甲','重新排序.csv');
  check(await page.evaluate(()=>r62ImportDraft.mappingChanged&&r62ImportDraft.mapping.name===3&&r62ImportDraft.mapping.datetime===2&&r62ImportDraft.mapping.direction===0&&r62ImportDraft.validated.rows.length===2),'reordered columns remap by saved labels instead of stale positions');await page.locator('#r62Cancel').click();
  check(await page.evaluate(()=>{
   const saved={labels:['姓名','打卡时间','备注'],mapping:{name:0,datetime:1,direction:-1}},grid=labels=>({rows:[{cells:labels}]});
   return r96RestoreMapping(saved,grid(saved.labels),'attendance',true,0).mapping.direction===-1&&
    r96RestoreMapping(saved,grid(['姓名','打卡时间','进出']),'attendance',true,0).mapping.direction===2;
  }),'direction None stays on the same structure while a newly supplied direction column is inferred');
  await upload('leave');await page.locator('[data-endpoint="start"]').selectOption('split');await page.locator('[data-map="type"]').selectOption('-1');await page.locator('[data-map="note"]').selectOption('-1');await page.locator('#r96KeepImport').click();await page.locator('#r62Cancel').click();
  await upload('leave');check(await page.evaluate(()=>r62ImportDraft.startMode==='split'&&r62ImportDraft.endMode==='combined'&&r62ImportDraft.mapping.type===-1&&r62ImportDraft.rules.length===0&&r62ImportDraft.skip===0),'leave independently retains mixed endpoints and optional None fields');await page.locator('#r62Cancel').click();
  for(const kind of ['trip','outing','overtime']){
   await upload(kind);await page.locator('[data-map="type"]').selectOption('-1');await page.locator('#r96KeepImport').click();await page.locator('#r62Cancel').click();
   await upload(kind);check(await page.evaluate(()=>r62ImportDraft.mapping.type===-1&&r62ImportDraft.skip===0&&r62ImportDraft.rules.length===0&&r62ImportDraft.validated.rows.length===1),'independent remembered config '+kind);await page.locator('#r62Cancel').click();
  }
  const all=await saved();check(Object.keys(all).length===5&&all.attendance.rules.length===4&&!all.leave.rules&&!all.trip.rules&&!all.outing.rules&&!all.overtime.rules,'five modules never overwrite or inherit attendance direction rules');
  check(await page.evaluate(()=>{const text=localStorage.getItem(R96_IMPORT_SETTINGS_KEY);return !text.includes('测试甲')&&!text.includes('2026-10-08')&&!text.includes('文件导出说明')&&!text.includes('targetMonth')&&!text.includes('新的文件名.csv')}),'retained settings exclude names, records, filenames and the target month');
  check(await page.evaluate(()=>p109NewPortable()),'empty portable project remains available with remembered settings');
  await page.locator('#importBtn').click();
  await page.evaluate(content=>{const transfer=new DataTransfer();transfer.items.add(new File([content],'拖入考勤.csv',{type:'text/csv'}));document.querySelector('[data-drop-kind="attendance"]').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}))},attendance);
  await page.waitForFunction(()=>r62ImportDraft?.file.name==='拖入考勤.csv'&&!r63ReadingImport);
  check(await page.evaluate(()=>r62ImportDraft.kind==='attendance'&&r62ImportDraft.validated.rows.length===2&&r62ImportDraft.rules.length===4),'dropping on a module menu opens its remembered settings');
  await page.evaluate(content=>{const transfer=new DataTransfer();transfer.items.add(new File([content],'替换预览.csv',{type:'text/csv'}));document.querySelector('.r62-overlay').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}))},attendance);
  await page.waitForFunction(()=>r62ImportDraft?.file.name==='替换预览.csv'&&!r63ReadingImport);
  check(await page.evaluate(()=>r62ImportDraft.rules.length===4&&r62ImportDraft.validated.rows.length===2&&state.records.length===0),'dropping another same-kind file replaces only the preview');
  await page.evaluate(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['bad'],'不支持.zip'));document.querySelector('.r62-overlay').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}))});
  check(await page.evaluate(()=>r62ImportDraft.file.name==='替换预览.csv'&&state.records.length===0),'unsupported dropped files preserve the draft and live records');await commit();
  check(await page.evaluate(()=>state.records.length===2&&state.importProfile.templates.attendance.rules.length===4&&state.importProfile.rules.length===4),'successful import carries its config into project working state automatically');
  for(const kind of ['leave','trip','outing','overtime']){await upload(kind);await commit();check(await page.evaluate(kind=>!!state.importProfile.templates[kind]&&state.importProfile.rules.length===4,kind),'committing '+kind+' preserves other module settings and direction rules')}
  await upload('attendance');await page.locator('#r79Advanced').evaluate(el=>el.open=true);await page.locator('#r80ImportMode').selectOption('replace');await page.locator('#r62Cancel').click();await upload('attendance');
  check(await page.evaluate(()=>r62ImportDraft.importMode==='replace'),'explicit import mode is remembered');await page.locator('#r79Advanced').evaluate(el=>el.open=true);await page.locator('#r80ImportMode').selectOption('merge');await page.locator('#r62Cancel').click();
  await page.evaluate(()=>{window.__r96SetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key===R96_IMPORT_SETTINGS_KEY)throw new DOMException('blocked','QuotaExceededError');return window.__r96SetItem.call(this,key,value)}});
  await upload('trip');await page.locator('[data-map="place"]').selectOption('-1');await page.locator('#r96KeepImport').click();await page.locator('#r62Cancel').click();await upload('trip');
  check(await page.evaluate(()=>r62ImportDraft.mapping.place===-1&&r62ImportDraft.validated.rows.length===1),'blocked browser storage falls back to session memory without blocking import');await commit();
  check(await page.evaluate(()=>state.importProfile.templates.trip.mapping.place===-1),'storage fallback config still enters saved-project payload');
  await page.evaluate(()=>{Storage.prototype.setItem=window.__r96SetItem});
  const rawBefore=await page.evaluate(()=>JSON.stringify({records:state.records,imports:state.imports}));await upload('attendance');await page.locator('[data-direction-edit="0"]').click();
  await page.locator('#r62AddRule').click();await page.locator('[data-rule="4"][data-part="text"]').fill('<script>sample</script>');await page.locator('#r96DirectionOverlay button[type="submit"]').click();
  check(await page.locator('.r96-rule-keywords script').count()===0&&(await page.locator('.r96-rule-keywords').innerText()).includes('<script>sample</script>'),'keyword markup is displayed as inert text');await page.locator('#r62Cancel').click();
  check(await page.evaluate(before=>JSON.stringify({records:state.records,imports:state.imports})===before,rawBefore),'all remaining rule editing leaves raw evidence intact');
  check(!errors.length&&!remote.length,'no runtime exceptions or remote requests');report.errors=errors;report.remote=remote;
  fs.writeFileSync(path.join(out,'r96-audit.json'),JSON.stringify(report,null,2));console.log('P109_R96_AUDIT_PASS '+JSON.stringify({checks:report.checks.length,geometry:report.geometry.length}));
 }catch(e){fs.writeFileSync(path.join(out,'r96-failure.json'),JSON.stringify({error:e.stack,report,errors},null,2));await page.screenshot({path:path.join(out,'r96-failure.png')});throw e}finally{await context.close()}
};
