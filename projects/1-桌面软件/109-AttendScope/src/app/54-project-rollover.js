/* R105 · Small, versioned configuration bundles and non-destructive project rollover. */
'use strict';
const P109_CONFIG_KIND='P109-Project-Configuration';
const P109_CONFIG_SCHEMA=1;
const P109_SIZE_STEP=100*1024*1024;
let p109SizeWarningLast={key:'',at:0};
const p109SizeWarningMemory={};
let p109RolloverUrls=[];

function p109CloseRolloverUrls(){for(const url of p109RolloverUrls)URL.revokeObjectURL(url);p109RolloverUrls=[]}
function p109SizeWarningKey(){return state.projectIdentity?.projectInstanceId||state.projectDir?.cacheId||state.projectDir?.name||'temporary'}
function p109MaybeWarnProjectSize(bytes){
 const size=Number(bytes)||0,band=Math.floor(size/P109_SIZE_STEP);if(band<1)return false;
 const project=p109SizeWarningKey(),key=project+'|'+band,now=Date.now();
 if(p109SizeWarningLast.key===key&&now-p109SizeWarningLast.at<10000)return false;
 p109SizeWarningLast={key,at:now};
 const storageKey='p109-size-warning-v1:'+project;let record=p109SizeWarningMemory[project]||{bands:{}};
 try{record=JSON.parse(localStorage.getItem(storageKey))||record}catch(_){}
 if(!record.bands||typeof record.bands!=='object')record={bands:{[record.band||0]:record.count||0}};
 const count=Number(record.bands[band]||0);if(count>=2)return false;
 record.bands[band]=count+1;
 p109SizeWarningMemory[project]=record;
 try{localStorage.setItem(storageKey,JSON.stringify(record))}catch(_){}
 const lower=band*100,upper=(band+1)*100;
 toast('项目约 '+r68HumanBytes(size)+'，已进入 '+lower+'–'+upper+' MB 档（本档第 '+record.bands[band]+'/2 次提醒）。仍可继续操作；建议封存后续建以降低浏览器内存压力。');
 return true;
}

function p109ConfigurationRoster(){
 const profile=state.projectProfile||{},people=new Map();
 for(const row of profile.employees||[])if(row?.id)people.set(row.id,row);
 for(const store of state.monthStores.values())for(const row of store.employees||[])if(row?.id)people.set(row.id,row);
 for(const row of EMPLOYEES)if(row?.id)people.set(row.id,row);
 const ids=[...new Set((profile.pinRoster?(profile.fixedPeople||profile.employees?.map(e=>e.id)):state.fixedPeople)||[])];
 const employees=ids.map(id=>people.get(id)).filter(Boolean).map(e=>({...e}));
 const groups=Object.fromEntries(employees.map(e=>[e.id,profile.groups?.[e.id]??state.groups?.[e.id]??'未分组']));
 return {employees,fixedPeople:employees.map(e=>e.id),groups,
  groupCatalog:[...new Set([...(profile.groupCatalog||state.groupCatalog||[]),...Object.values(groups)].filter(x=>x&&x!=='未分组'))],
  nameAliases:{...(profile.nameAliases||{}),...(state.nameAliases||{})},
  ignoredPeople:[...new Set(state.ignoredPeople||profile.ignoredPeople||[])],ignoredEmployees:p109Clone(p109IgnoredRoster())};
}
function p109ConfigurationPayload(){
 const roster=p109ConfigurationRoster();
 return {schemaVersion:P109_CONFIG_SCHEMA,kind:P109_CONFIG_KIND,exportedAt:new Date().toISOString(),appVersion:P109_APP_VERSION,
  minimumAppVersion:'0.2.39-preview',source:{projectInstanceId:state.projectIdentity?.projectInstanceId||null,
   projectName:attendTitle(),currentMonth:monthKey(),createdAt:state.projectIdentity?.createdAt||null},
  roster,rules:p109Clone(RULES),importProfile:p109Clone(r62ImportProfile()),prefs:p109Clone(state.prefs||{}),
  calendar:p109Clone(p109FixedCalendar)};
}
function p109ConfigurationCanonical(bundle){const clean=p109Clone(bundle);delete clean.integrity;return JSON.stringify(clean)}
async function p109SealConfiguration(bundle=p109ConfigurationPayload()){
 const clean=p109Clone(bundle);delete clean.integrity;
 clean.integrity={algorithm:'SHA-256',sha256:await p109Hash(new TextEncoder().encode(JSON.stringify(clean)))};return clean;
}
function p109ValidatePlainMap(value,label){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error(label+'格式无效');
 return Object.fromEntries(Object.entries(value).map(([k,v])=>[String(k),String(v??'')]));
}
async function p109ValidateConfiguration(source){
 if(!source||source.kind!==P109_CONFIG_KIND||source.schemaVersion!==P109_CONFIG_SCHEMA)throw Error('不是兼容的 P109 项目配置文件');
 if(source.minimumAppVersion){const compare=p109CompareVersion(P109_APP_VERSION,source.minimumAppVersion);if(compare===null||compare<0)throw Error('配置来自更新版本，请先升级程序')}
 if(source.integrity){
  if(source.integrity.algorithm!=='SHA-256'||!/^([0-9a-f]{64})$/i.test(source.integrity.sha256||''))throw Error('配置完整性信息无效');
  const actual=await p109Hash(new TextEncoder().encode(p109ConfigurationCanonical(source)));
  if(actual!==source.integrity.sha256)throw Error('配置内容校验失败，文件可能已被修改或损坏');
 }
 const roster=source.roster;if(!roster||!Array.isArray(roster.employees)||!Array.isArray(roster.fixedPeople)||!Array.isArray(roster.ignoredPeople)||!Array.isArray(roster.ignoredEmployees))throw Error('名册配置不完整');
 const ids=new Set();for(const e of roster.employees){
  if(!e||typeof e.id!=='string'||!e.id||typeof e.name!=='string'||!e.name||ids.has(e.id))throw Error('默认名册包含无效或重复标识');ids.add(e.id);
 }
 const known=new Set(ids);for(const e of roster.ignoredEmployees){
  if(!e||typeof e.id!=='string'||!e.id||typeof e.name!=='string'||!e.name)throw Error('忽略人员资料无效');known.add(e.id);
 }
 if(roster.fixedPeople.some(id=>!ids.has(id))||roster.ignoredPeople.some(id=>!known.has(id)))throw Error('固定或忽略名单引用了不存在的人员');
 if(!p109ValidOvertimeRules(source.rules))throw Error('考勤规则无效');
 if(!source.importProfile||typeof source.importProfile!=='object'||Array.isArray(source.importProfile)||!Array.isArray(source.importProfile.rules))throw Error('导入模板配置无效');
 const calendar=p109ValidateCalendarBook(source.calendar||{schemaVersion:1,kind:'P109-Fixed-Calendar',updatedAt:0,months:{}});
 return {...p109Clone(source),roster:{employees:p109Clone(roster.employees),fixedPeople:[...roster.fixedPeople],ignoredPeople:[...roster.ignoredPeople],ignoredEmployees:p109Clone(roster.ignoredEmployees),
   groups:p109ValidatePlainMap(roster.groups||{},'组别'),groupCatalog:[...new Set((roster.groupCatalog||[]).map(String))],nameAliases:p109ValidatePlainMap(roster.nameAliases||{},'姓名别名')},
  rules:p109NormalizeOvertimeRules(source.rules),prefs:p109Clone(source.prefs||{}),importProfile:p109Clone(source.importProfile),calendar};
}
function p109ConfigFileName(bundle){const name=String(bundle.source?.projectName||'考勤').replace(/[\\/:*?"<>|]/g,'-').slice(0,40)||'考勤';return 'P109-项目配置-'+name+'-'+p109DownloadStamp()+'.json'}
async function p109ExportConfiguration(){
 if(state.isDemo){toast('演示项目不作为正式配置来源，请先进入 Work',true);return false}
 try{const bundle=await p109SealConfiguration();downloadBlob(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}),p109ConfigFileName(bundle));toast('已导出项目配置；不包含历史月份和原始数据');return true}
 catch(e){toast('配置导出失败：'+e.message,true);return false}
}
function p109ConfigurationSummary(bundle){
 const months=Object.keys(bundle.calendar?.months||{});
 return '<div class="p109-config-summary">'+[['默认名册',bundle.roster.employees.length+' 人'],['忽略人员',bundle.roster.ignoredPeople.length+' 人'],['组别',bundle.roster.groupCatalog.length+' 个'],['导入模板',Object.keys(bundle.importProfile.templates||{}).length+' 类'],['固定日历',months.length+' 个月'],['界面偏好','全部']].map(([a,b])=>'<div><span>'+a+'</span><strong>'+b+'</strong></div>').join('')+'</div>';
}
function p109SuccessorFiles(bundle,options){
 const year=Number(options.year),month=Number(options.month),key=year+'-'+pad(month),createdAt=new Date().toISOString(),instanceId=p109UniqueId(),
  roster=bundle.roster,prefs=options.inheritPrefs?p109Clone(bundle.prefs):{fontScale:1,motion:true,arrowsTowardLine:true,appTitle:options.name};
 prefs.appTitle=String(options.name||prefs.appTitle||'考勤').trim().slice(0,28)||'考勤';
 const calendar=options.inheritCalendar?p109Clone(bundle.calendar):{schemaVersion:1,kind:'P109-Fixed-Calendar',updatedAt:Date.now(),months:{}},
  calendarOverrides={...(calendar.months[key]||p109CalendarMonthValues(year,month,{},false))},rules=p109Clone(bundle.rules),importProfile=p109Clone(bundle.importProfile),
  profile={schemaVersion:1,pinRoster:true,employees:p109Clone(roster.employees),fixedPeople:[...roster.fixedPeople],groups:{...roster.groups},groupCatalog:[...roster.groupCatalog],nameAliases:{...roster.nameAliases},
   ignoredPeople:[...roster.ignoredPeople],ignoredEmployees:p109Clone(roster.ignoredEmployees),pinRules:true,workRules:p109Clone(rules),pinImport:true,importProfile:p109Clone(importProfile),savedAt:createdAt},
  lineage={parentProjectInstanceId:bundle.source?.projectInstanceId||null,parentProjectName:bundle.source?.projectName||'',sourceMonth:bundle.source?.currentMonth||'',configurationExportedAt:bundle.exportedAt||'',continuedAt:createdAt},
  project={schemaVersion:P109_DATA_SCHEMA,projectId:'P109-AttendScope',projectInstanceId:instanceId,projectName:prefs.appTitle,createdAt,lineage,appVersion:P109_APP_VERSION,analysisEngineVersion:P109_ENGINE_VERSION,current:{year,month},months:[key],activeBranch:null,monthBranches:{},updatedAt:createdAt},
  working={schemaVersion:P109_DATA_SCHEMA,context:'working',year,month,savedAt:createdAt,ignoredPeople:[...roster.ignoredPeople],employees:p109Clone(roster.employees),isDemo:false,calendarOverrides,importProfile,
   records:[],leaves:[],trips:[],revisions:[],revisionSeq:0,imports:[],attendanceReview:{},tempOutingReview:{},manualTempOutings:[],manualOvertime:[],outings:[],overtimeEntries:[],manualStatuses:{},overtimeReview:{},judgmentMode:'initial',
   rules,prefs,groups:{...roster.groups},fixedPeople:[...roster.fixedPeople],nameAliases:{...roster.nameAliases},groupCatalog:[...roster.groupCatalog],appVersion:P109_APP_VERSION,analysisEngineVersion:P109_ENGINE_VERSION,snapshotContext:false,overtimeRuleContexts:{},branch:null},
  yearCalendar={schemaVersion:1,year,overrides:Object.fromEntries(Object.entries(calendar.months).filter(([k])=>k.startsWith(year+'-')).flatMap(([,days])=>Object.entries(days)))};
 return [{name:'project.json',data:new TextEncoder().encode(JSON.stringify(project,null,2))},
  {name:'config/project-profile.json',data:new TextEncoder().encode(JSON.stringify(profile,null,2))},
  {name:'config/employees.json',data:new TextEncoder().encode(JSON.stringify({schemaVersion:2,employees:roster.employees.map(e=>({...e,group:roster.groups[e.id]||'未分组'}))},null,2))},
  {name:'config/work_rules.json',data:new TextEncoder().encode(JSON.stringify({schemaVersion:1,...rules},null,2))},
  {name:'config/fixed-calendar.json',data:new TextEncoder().encode(JSON.stringify(calendar,null,2))},
  {name:'config/source-configuration.json',data:new TextEncoder().encode(JSON.stringify(bundle,null,2))},
  {name:'config/calendar/'+year+'.json',data:new TextEncoder().encode(JSON.stringify(yearCalendar,null,2))},
  {name:'data/'+year+'/'+pad(month)+'/working/state.json',data:new TextEncoder().encode(JSON.stringify(working,null,2))}];
}
async function p109BuildSuccessor(bundle,options){
 const files=p109SuccessorFiles(bundle,options),built=await p109ZipBuild(files),stem=String(options.name||'考勤').replace(/[\\/:*?"<>|]/g,'-').slice(0,40)||'考勤';
 return {zip:built.zip,name:stem+'_续用项目_'+options.year+'-'+pad(options.month)+'_'+p109DownloadStamp()+'.zip',bundle};
}
function p109ShowSuccessor(result,title='续用项目已生成'){
 const node=p109TransferDialog(title,'<p>新包只有一个空白起始月份，已继承默认名册、忽略人员、组别、规则、导入模板、全部界面偏好和所选日历；不含历史业务数据。</p><p><a id="p109SuccessorDownload">下载新项目 ZIP</a></p><p id="p109SuccessorStatus" role="status">下载后可立即打开，也可稍后从项目菜单打开。</p><div class="p109-transfer-actions"><button id="p109SuccessorOpen">立即打开新项目</button></div>');
 const url=URL.createObjectURL(result.zip);p109RolloverUrls.push(url);const link=node.querySelector('#p109SuccessorDownload');link.href=url;link.download=result.name;
 link.onclick=()=>node.querySelector('#p109SuccessorStatus').textContent='已发起下载；浏览器不能确认是否真正落盘，请检查下载目录。';
 node.querySelector('#p109SuccessorOpen').onclick=async()=>{if(!p109ConfirmProjectSwitch())return;const file=new File([result.zip],result.name,{type:'application/zip'});p109CloseTransfer();await p109OpenPortableFile(file)};
 link.click();return node;
}
function p109ConfigurationForm(bundle,{rollover=false}={}){
 const current=new Date(Date.UTC(YEAR,MONTH-1,1)),defaultYear=rollover?current.getUTCFullYear()+1:current.getUTCFullYear(),defaultMonth=rollover?1:current.getUTCMonth()+1,
  defaultName=(bundle.source?.projectName||'考勤')+(rollover?'-'+defaultYear:'-续用');
 const node=p109TransferDialog(rollover?'封存当前项目并创建续用项目':'从配置创建新项目',
  '<div class="p109-config-intro"><p>'+(rollover?'先下载当前项目的完整封存 ZIP，确认后再生成不含历史数据的新项目。当前项目不会被清空或覆盖。':'配置已通过格式与完整性检查。设置新项目名称和第一个工作月份。')+'</p>'+p109ConfigurationSummary(bundle)+'</div>'+ 
  '<div class="p109-config-form"><label><span>项目名称</span><input id="p109ConfigName" maxlength="28" value="'+r68Esc(defaultName)+'"></label><label><span>起始年份</span><input id="p109ConfigYear" type="number" min="2000" max="2100" value="'+defaultYear+'"></label><label><span>起始月份</span><select id="p109ConfigMonth">'+Array.from({length:12},(_,i)=>'<option value="'+(i+1)+'" '+(defaultMonth===i+1?'selected':'')+'>'+(i+1)+' 月</option>').join('')+'</select></label>'+ 
  '<label class="p109-config-check"><input id="p109ConfigPrefs" type="checkbox" checked><span>继承全部界面偏好</span></label><label class="p109-config-check"><input id="p109ConfigCalendar" type="checkbox" checked><span>继承已配置的固定日历</span></label></div>'+ 
  '<p id="p109ConfigStatus" role="status"></p><div class="p109-transfer-actions"><button id="p109ConfigCreate" class="primary-btn">'+(rollover?'生成封存包':'生成新项目 ZIP')+'</button></div>');
 const values=()=>({name:node.querySelector('#p109ConfigName').value.trim(),year:Number(node.querySelector('#p109ConfigYear').value),month:Number(node.querySelector('#p109ConfigMonth').value),inheritPrefs:node.querySelector('#p109ConfigPrefs').checked,inheritCalendar:node.querySelector('#p109ConfigCalendar').checked});
 node.querySelector('#p109ConfigCreate').onclick=async()=>{
  const options=values(),status=node.querySelector('#p109ConfigStatus'),button=node.querySelector('#p109ConfigCreate');
  if(!options.name||!Number.isInteger(options.year)||options.year<2000||options.year>2100||!Number.isInteger(options.month)||options.month<1||options.month>12){status.textContent='请填写有效项目名称和起始年月。';return}
  button.disabled=true;
  try{
   if(!rollover){const result=await p109BuildSuccessor(bundle,options);p109ShowSuccessor(result);return}
   status.textContent='正在生成当前项目的完整封存包…';p109ProjectBusy=true;
   const root=await p109PortableFromSession(),files=await p109PortableCollect(root),archive=await p109ZipBuild(files),archiveName=r63FileStem()+'_封存_'+p109DownloadStamp()+'.zip',archiveHash=await p109Hash(new Uint8Array(await archive.zip.arrayBuffer()));
   p109ProjectBusy=false;const url=URL.createObjectURL(archive.zip);p109RolloverUrls.push(url);
   node.querySelector('.p109-update-body').innerHTML='<div class="p109-config-intro"><h3>第一步 · 保存原项目</h3><p>原项目完整封存包已经生成。请下载并检查文件，再生成续用项目。</p><p><a id="p109ArchiveDownload">下载原项目封存 ZIP</a></p><p class="p109-config-hash">SHA-256 <code>'+archiveHash+'</code></p></div><p id="p109ArchiveStatus" role="status">浏览器不能确认文件是否真正落盘。</p><div class="p109-transfer-actions"><button id="p109ArchiveConfirm" class="primary-btn">我已确认封存包，生成续用项目</button></div>';
   const link=node.querySelector('#p109ArchiveDownload');link.href=url;link.download=archiveName;link.onclick=()=>node.querySelector('#p109ArchiveStatus').textContent='已发起下载；请检查下载目录中的文件和大小。';
   node.querySelector('#p109ArchiveConfirm').onclick=async()=>{const btn=node.querySelector('#p109ArchiveConfirm');btn.disabled=true;node.querySelector('#p109ArchiveStatus').textContent='正在生成续用项目…';try{const result=await p109BuildSuccessor(bundle,options);p109ShowSuccessor(result,'封存完成 · 续用项目已生成')}catch(e){btn.disabled=false;node.querySelector('#p109ArchiveStatus').textContent='续用项目生成失败：'+e.message}};
   link.click();
  }catch(e){p109ProjectBusy=false;button.disabled=false;status.textContent=(rollover?'封存':'创建')+'失败：'+e.message}
 };
 return node;
}
async function p109PickConfiguration(){
 if(p109ProjectBusy||state.storageBusy||state.importCommitting||p109ConnectionBusy||r62ImportDraft)return;
 const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.onchange=async()=>{const file=input.files?.[0];if(!file)return;try{const bundle=await p109ValidateConfiguration(JSON.parse(await file.text()));p109ConfigurationForm(bundle)}catch(e){toast('配置未导入：'+e.message,true)}};input.click();
}
async function p109StartRollover(){
 if(!state.projectDir||state.isDemo){toast('请先打开需要封存的正式项目',true);return}
 if(p109ProjectBusy||state.storageBusy||state.importCommitting||p109ConnectionBusy||r62ImportDraft)return;
 try{p109ConfigurationForm(await p109SealConfiguration(),{rollover:true})}catch(e){toast('无法准备接续配置：'+e.message,true)}
}
document.addEventListener('click',event=>{
 if(event.target.closest?.('#p109ConfigExport'))p109ExportConfiguration();
 if(event.target.closest?.('#p109ConfigImport,#r105ConfigProject'))p109PickConfiguration();
 if(event.target.closest?.('#p109ProjectRollover'))p109StartRollover();
});
