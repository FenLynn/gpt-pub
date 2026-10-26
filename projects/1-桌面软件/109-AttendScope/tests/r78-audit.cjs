/* R78 regression: project boundaries, exact snapshot restore and unambiguous actions.
 * File handles below use real temporary disk files. Native picker permissions are
 * deliberately reported separately from simulated NotAllowedError/AbortError paths. */
'use strict';
const fs=require('fs'),path=require('path'),os=require('os');
const {pathToFileURL}=require('url');
module.exports=async function({browser,out,root}){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'p109-lifecycle-r78-'));
 const roots=Object.fromEntries(['A','B','C','empty','broken','future'].map(key=>[key,path.join(tmp,key)]));
 const report={revision:'R78',nativePickerVerified:false,checks:[]},errors=[],remote=[];
 const check=(ok,label)=>{if(!ok)throw Error('R78: '+label);report.checks.push(label)};
 const put=(key,relative,body)=>{const f=path.join(roots[key],relative);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,typeof body==='string'?body:JSON.stringify(body,null,2))};
 const page=await browser.newPage({viewport:{width:1600,height:900},acceptDownloads:true});
 // Baseline audits explicitly select Demo; R80 separately tests the first-use entry.
 await page.addInitScript(()=>{if(!localStorage.getItem('p109-session-mode'))localStorage.setItem('p109-session-mode','demo')});
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url())});
 page.on('dialog',d=>d.accept());
 await page.exposeFunction('__r78fs',async({key,parts,op,create,data})=>{
  if(!roots[key]||!Array.isArray(parts)||parts.some(p=>!p||p==='.'||p==='..'||/[\\/]/.test(p)))throw Error('Unsafe fixture path');
  const at=path.resolve(roots[key],...parts);
  if(at!==roots[key]&&!at.startsWith(roots[key]+path.sep))throw Error('Outside fixture root');
  if(op==='list')return fs.existsSync(at)?fs.readdirSync(at,{withFileTypes:true}).map(x=>({name:x.name,kind:x.isDirectory()?'directory':'file'})):[];
  if(op==='dir'){if(create)fs.mkdirSync(at,{recursive:true});return fs.existsSync(at)&&fs.statSync(at).isDirectory()}
  if(op==='file'){if(create&&!fs.existsSync(at)){fs.mkdirSync(path.dirname(at),{recursive:true});fs.writeFileSync(at,'')}return fs.existsSync(at)}
  if(op==='read')return fs.existsSync(at)?fs.readFileSync(at).toString('base64'):null;
  if(op==='write'){fs.writeFileSync(at,Buffer.from(data,'base64'));return true}
  throw Error('Unknown fixture operation');
 });
 await page.addInitScript(()=>{
  window.__r78Key='A';window.__r78Deny='';window.__r78Abort=false;
  const call=async(key,parts,op,create=false,data)=>{
   if(window.__r78Deny==='read'||(window.__r78Deny==='write'&&(create||op==='write')))
    throw new DOMException('Permission denied','NotAllowedError');
   return window.__r78fs({key,parts,op,create,data});
  };
  const encode=async value=>{const bytes=new Uint8Array(await new Blob([value]).arrayBuffer());let s='';
   for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s)};
  class FileHandle{
   constructor(key,parts){this.key=key;this.parts=parts;this.kind='file';this.name=parts.at(-1)}
   async getFile(){const value=await call(this.key,this.parts,'read');if(value==null)throw new DOMException('Missing','NotFoundError');return new File([Uint8Array.from(atob(value),c=>c.charCodeAt(0))],this.name)}
   async createWritable(){const {key,parts}=this;return {async write(value){await call(key,parts,'write',false,await encode(value))},async close(){}}}
  }
  class DirHandle{
   constructor(key,parts=[]){this.key=key;this.parts=parts;this.kind='directory';this.name=parts.at(-1)||key}
   async getDirectoryHandle(name,options={}){const parts=[...this.parts,name];if(!await call(this.key,parts,'dir',!!options.create))throw new DOMException('Missing','NotFoundError');return new DirHandle(this.key,parts)}
   async getFileHandle(name,options={}){const parts=[...this.parts,name];if(!await call(this.key,parts,'file',!!options.create))throw new DOMException('Missing','NotFoundError');return new FileHandle(this.key,parts)}
   async *entries(){for(const item of await call(this.key,this.parts,'list'))yield [item.name,item.kind==='directory'?new DirHandle(this.key,[...this.parts,item.name]):new FileHandle(this.key,[...this.parts,item.name])]}
  }
  Object.defineProperty(window,'showDirectoryPicker',{configurable:true,value:async()=>{
   if(window.__r78Abort)throw new DOMException('Cancelled','AbortError');return new DirHandle(window.__r78Key);
  }});
 });
 const open=async()=>{await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();await page.waitForSelector('.m-name')};
 const connect=async key=>page.evaluate(async key=>{window.__r78Key=key;return connectProjectDir()},key);
 try{
  await open();
  check(await page.locator('#resetDemo').count()===0,'business import menu cannot overwrite the workspace with demo records');
  const fixtures=await page.evaluate(()=>{
   const make=(name,month)=>{const id=personIdentity(name),date='2026-'+pad(month)+'-08';return {...workingPayload(),year:2026,month,
    employees:[{id,name,department:''}],groups:{[id]:'审计组'},fixedPeople:[],groupCatalog:['审计组'],
    isDemo:false,calendarOverrides:{},manualStatuses:{},overtimeReview:{},revisions:[],imports:[],leaves:[],trips:[],outings:[],overtimeEntries:[],
    records:[['08:30:00','进'],['17:10:00','出']].map(([time,direction],i)=>({recordId:'audit:'+name+i,employeeId:id,name,date,datetime:date+' '+time,time,direction}))};};
   return {A:make('项目甲测试人员',10),B:make('项目乙测试人员',11),C:make('项目丙测试人员',10)};
  });
  for(const [key,working] of Object.entries(fixtures)){
   const month='2026-'+String(working.month).padStart(2,'0');
   put(key,'project.json',{schemaVersion:2,projectId:'P109-AttendScope',appVersion:'0.2.3-preview',current:{year:2026,month:working.month},months:[month]});
   put(key,'data/'+month.replace('-','/')+'/working/state.json',working);
   put(key,'config/employees.json',{schemaVersion:2,employees:working.employees});
   put(key,'config/work_rules.json',{schemaVersion:1,...working.rules});
  }
  put('broken','project.json','{invalid');
  put('future','project.json',{schemaVersion:99,projectId:'P109-AttendScope',current:{year:2026,month:10},months:[]});
  check(await connect('A'),'connect project A');
  const aState=await page.evaluate(()=>JSON.stringify({month:monthKey(),people:EMPLOYEES,records:state.records}));
  await page.evaluate(()=>{state.saved=false;window.confirm=()=>false});
  check(!await connect('B'),'cancel switching with unsaved data');
  check(await page.evaluate(()=>state.projectDir.name==='A'&&!state.saved),'cancel preserves original handle and dirty state');
  await page.evaluate(()=>{window.confirm=()=>true;state.saved=true;rememberMonth()});
  check(await connect('B'),'connect project B');
  check(await page.evaluate(()=>state.projectDir.name==='B'&&monthKey()==='2026-11'&&
    [...state.monthStores.keys()].join(',')==='2026-11'&&EMPLOYEES[0].name==='项目乙测试人员'&&
    !monthExists(2026,10)&&!asNavHistory.back.length),'new project contains only its own months, personnel and history');
  check(!fs.existsSync(path.join(roots.B,'data','2026','10')),'connection does not create old project month on new disk');
  const bState=await page.evaluate(()=>JSON.stringify({month:monthKey(),people:EMPLOYEES,records:state.records}));
  for(const key of ['broken','future']){
   check(!await connect(key),'reject '+key+' project');
   check(await page.evaluate(()=>state.projectDir.name==='B')&&await page.evaluate(()=>JSON.stringify({month:monthKey(),people:EMPLOYEES,records:state.records}))===bState,'failed '+key+' connection preserves current project');
  }
  await page.evaluate(()=>window.__r78Deny='read');check(!await connect('A'),'reject denied directory access');
  await page.evaluate(()=>{window.__r78Deny='';window.__r78Abort=true});check(!await connect('A'),'directory picker cancellation is harmless');
  await page.evaluate(()=>window.__r78Abort=false);check(await connect('A'),'reconnect project A');
  check(await page.evaluate(()=>JSON.stringify({month:monthKey(),people:EMPLOYEES,records:state.records}))===aState,'A B A retains original saved facts');
  check(await connect('C')&&await page.evaluate(()=>EMPLOYEES[0].name==='项目丙测试人员'&&[...state.monthStores.keys()].join(',')==='2026-10'),'same-month project switch replaces facts instead of merging');
  check(await connect('A'),'restore A after same-month project test');
  const beforeInit=await page.evaluate(()=>JSON.stringify({people:EMPLOYEES,records:state.records,dir:state.projectDir.name}));
  await page.evaluate(()=>{window.__r78Key='empty';window.__r78Deny='write'});
  check(!await page.evaluate(()=>p109InitializeProject()),'initialization write failure is reported');
  await page.evaluate(()=>window.__r78Deny='');
  check(await page.evaluate(()=>JSON.stringify({people:EMPLOYEES,records:state.records,dir:state.projectDir.name}))===beforeInit,'failed initialization preserves prior project session');
  check(await page.evaluate(()=>{state.storageBusy=true;try{return switchMonth(2026,11,true)===false&&monthKey()==='2026-10'}finally{state.storageBusy=false}}),'month switching is blocked during storage writes');
  const currentPath=path.join(roots.A,'data','2026','10','working','state.json');
  const currentBytes=fs.readFileSync(currentPath);
  await page.evaluate(()=>{state.saved=false;window.__r78Deny='write'});
  check(!await page.evaluate(()=>saveWorking()),'save failure reports false');
  check(fs.readFileSync(currentPath).equals(currentBytes)&&await page.evaluate(()=>!state.saved),'permission failure does not mark data saved or overwrite disk');
  await page.evaluate(()=>window.__r78Deny='');
  check(await page.evaluate(()=>saveWorking()),'save after permission restoration');
  const good=fs.readFileSync(currentPath),previousPath=path.join(path.dirname(currentPath),'state.previous.json');
  fs.writeFileSync(previousPath,good);fs.writeFileSync(currentPath,'{invalid');
  check(await connect('A'),'recover corrupted working from previous');
  check(await page.evaluate(()=>!state.saved&&state.records.length===2),'recovered state stays dirty for explicit save');
  check(await page.evaluate(()=>saveWorking())&&fs.readFileSync(previousPath).equals(good),'save recovery preserves last good backup');
  // Snapshot restore must reproduce its calendar and save in an isolated branch.
  await page.evaluate(()=>{state.calendarOverrides={};reanalyze()});
  check(await page.evaluate(()=>freezeSnapshot()),'freeze saved to disk and verified');
  const snapshotRoot=path.join(roots.A,'data','2026','10','snapshots');
  const snapshotId=fs.readdirSync(snapshotRoot)[0],snapshotPath=path.join(snapshotRoot,snapshotId,'snapshot.json');
  const frozenBytes=fs.readFileSync(snapshotPath),mainBytes=fs.readFileSync(currentPath);
  await page.evaluate(()=>{state.calendarOverrides['2026-10-08']='rest';state.saved=false;reanalyze()});
  check(await page.evaluate(async bytes=>restoreWorkingFile(new File([bytes],'冻结.json',{type:'application/json'})),frozenBytes.toString('utf8')),'restore snapshot JSON');
  check(await page.evaluate(()=>dayType(8)==='work'&&state.analysis.get(EMPLOYEES[0].id+'|8').status==='正常'&&!!state.activeBranch),'snapshot restores calendar exactly into independent revision');
  check(await page.evaluate(()=>saveWorking())&&fs.readFileSync(currentPath).equals(mainBytes)&&fs.readFileSync(snapshotPath).equals(frozenBytes),'editing restored snapshot leaves main working and snapshot byte identical');
  await page.evaluate(()=>p109ReturnToMain());
  check(await page.evaluate(()=>!state.activeBranch&&state.records.length===2),'return from restored JSON branch to main');
  await page.evaluate(()=>{state.calendarOverrides['2026-10-08']='rest';reanalyze()});
  await page.evaluate(({snapshotId})=>p109ForkSnapshot('2026-10',snapshotId),{snapshotId});
  check(await page.evaluate(()=>dayType(8)==='work'&&!!state.activeBranch),'disk snapshot fork restores its own calendar');
  await page.evaluate(()=>p109ReturnToMain());
  // Use actual controls and read actual generated files for all five templates.
  for(const [kind,id] of [['attendance','sampleAttendance'],['leave','sampleLeave'],['trip','sampleTrip'],['outing','sampleOuting'],['overtime','sampleOvertime']]){
   if(!await page.locator('#importPopover').evaluate(el=>el.classList.contains('open')))await page.locator('#importBtn').click();
   const pending=page.waitForEvent('download');await page.locator('#'+id).click();const download=await pending;
   const bytes=fs.readFileSync(await download.path());
   check(await page.evaluate(async({kind,bytes})=>{const grid=await P109_TABLES.readGrid(new File([new Uint8Array(bytes)],'模板.xlsx'));
    return JSON.stringify(grid.rows[0].cells)===JSON.stringify(P109_IMPORT_TEMPLATES[kind][1])&&grid.rows.slice(1).every(r=>r.cells.every(v=>v==null||v===''))}, {kind,bytes:[...bytes]}),'blank '+kind+' template has correct headers and no personnel');
  }
  await page.keyboard.press('Escape');
  await page.locator('[data-workspace="person"]').click();await page.locator('[data-person-day="8"]').click();
  await page.locator('#clearSelection').click();
  check(await page.evaluate(()=>state.selection.type==='person'&&state.chartDay===null&&state.chartTab==='overview'&&
   !document.getElementById('timelineDayPicker')&&!document.querySelector('.person-day.selected')),'personal clear returns to consistent monthly overview');
  await page.locator('[data-workspace="stats"]').click();
  check(await page.locator('#calendar').count()===0&&await page.locator('#asStatsExport').count()===0,'statistics has no ineffective calendar or duplicate export');
  await page.locator('#exportMenuButton').click();
  const pending=page.waitForEvent('download');await page.locator('#exportCsv').click();const csv=await pending;
  const csvBytes=fs.readFileSync(await csv.path()),csvText=csvBytes.toString('utf8');
  check(csvBytes.subarray(0,3).equals(Buffer.from([239,187,191]))&&csvText.includes('统计范围,对象,业务,指标,统计方式,数值,单位,员工数,应出勤人日'),'statistics CSV keeps complete shared field contract and BOM');
  check(await page.evaluate(()=>r62CsvCell('=1+1').startsWith("'")&&r62CsvCell('\t@x').startsWith("'")&&
   r62CsvCell(' -2').startsWith("'")&&r62CsvCell(-2)==='-2'&&r62CsvCell('a,"b\nc')==='"a,""b\nc"'),'CSV escapes text formulas, quotes, commas and newlines while preserving numeric values');
  await page.locator('#projectMenuButton').focus();await page.keyboard.press('ArrowDown');
  check(await page.evaluate(()=>document.activeElement.id==='connectDir'),'menu ArrowDown focuses first enabled action');
  await page.keyboard.press('End');await page.keyboard.press('Escape');
  check(await page.evaluate(()=>document.activeElement.id==='projectMenuButton'&&document.getElementById('projectMenu').hidden),'Escape closes menu and restores trigger focus');
  await page.locator('[data-workspace="data"]').click();
  for(const section of ['overview','months','health','storage','roster','rules','templates','records','imports','freezes']){
   await page.locator('[data-data-section="'+section+'"]').click();
   check(await page.locator('#calendar').count()===0,'date calendar absent from file inventory and configuration: '+section);
   if(section==='records'){
    await page.locator('[data-r80-record-view="rows"]').click();
    check(await page.locator('#calendar').count()===1,'combined rows keep an effective date filter');
    await page.locator('[data-r80-record-view="files"]').click();
   }
  }
  check(await page.locator('#r68FreezeNow').count()===0,'freeze has one global primary action');
  await page.locator('#exportMenuButton').click();await page.screenshot({path:path.join(out,'r78-export-menu.png')});
  check(!errors.length&&!remote.length,'no runtime errors or remote requests');
  report.runtimeErrors=errors;report.remoteRequests=remote;report.passed=true;
  fs.writeFileSync(path.join(out,'p109-r78-audit.json'),JSON.stringify(report,null,2));
  console.log('P109_R78_AUDIT_PASS '+JSON.stringify(report));
 }finally{
  await page.close();
  const resolved=path.resolve(tmp),prefix=path.join(os.tmpdir(),'p109-lifecycle-r78-');
  if(!resolved.startsWith(prefix))throw Error('Unsafe lifecycle cleanup path');
  fs.rmSync(resolved,{recursive:true,force:true});
 }
};
