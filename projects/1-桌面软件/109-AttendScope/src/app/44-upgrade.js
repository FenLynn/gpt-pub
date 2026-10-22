/* R67: offline code-only upgrade. Never rewrite data, config, snapshots or original imports. */
'use strict';
function p109Semver(version){
 const match=String(version||'').match(/^(\d+)\.(\d+)\.(\d+)/);
 return match?match.slice(1).map(Number):null;
}
function p109CompareVersion(a,b){
 const x=p109Semver(a),y=p109Semver(b);if(!x||!y)return null;
 for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]-y[i];
 return 0;
}
async function p109UpgradePick(){
 if(!state.projectDir||p109ProjectBusy){p109Status('请先连接并初始化本地项目目录',true);return}
 let programRoot=state.projectDir;
 try{
  if(!await p109File(programRoot,'index.html')||!await p109Child(programRoot,'src')){
   p109Status('请选择包含 index.html 的程序文件夹；项目数据目录独立保留');
   programRoot=await showDirectoryPicker({id:'p109-program-update',mode:'readwrite'});
  }
 }catch(e){if(e.name!=='AbortError')p109Status('程序目录选择失败：'+e.message,true);return}
 const chooser=document.createElement('input');chooser.type='file';chooser.accept='.zip,application/zip';
 chooser.onchange=async()=>{
  const file=chooser.files?.[0];if(file)await p109ApplyCodeUpdate(file,{programRoot});
 };
 chooser.click();
}
async function p109ApplyCodeUpdate(file,options={}){
 if(!state.projectDir||p109ProjectBusy||p109ConnectionBusy||state.storageBusy||state.importCommitting||r62ImportDraft)return false;
 p109ProjectBusy=true;
 try{
  const programRoot=options.programRoot||state.projectDir;
  await p109RequireWriteAccess(state.projectDir,true);await p109RequireWriteAccess(programRoot,true);
  if(file.size>45*1024*1024)throw Error('更新 ZIP 超过 45 MB 上限');
  const items=await p109ZipRead(file);
  const manifestFile=items.find(x=>x.name==='p109-release-manifest.json');
  if(!manifestFile)throw Error('这不是包含完整性清单的 P109 程序更新包');
  const manifest=JSON.parse(new TextDecoder().decode(manifestFile.data));
  if(manifest.projectId!=='P109-AttendScope'||manifest.schemaVersion!==1||
    !Array.isArray(manifest.files)||!Array.isArray(manifest.supportedDataSchemas))
   throw Error('程序包标识或版本信息无效');
  const compare=p109CompareVersion(manifest.appVersion,P109_APP_VERSION);
  if(compare===null||compare<0)throw Error('禁止使用更旧或无法识别版本的程序包覆盖代码');
  const root=state.projectDir,meta=await p109Json(root,'project.json');
  if(meta.value?.projectId!=='P109-AttendScope')throw Error('目录不是已初始化的考勤项目');
  if(!manifest.supportedDataSchemas.includes(Number(meta.value.schemaVersion)))
   throw Error('更新版本不支持项目当前数据结构；必须先进行数据迁移');
  const home=await p109File(programRoot,'index.html'),src=await p109Child(programRoot,'src'),app=src&&await p109Child(src,'app'),versionFile=app&&await p109File(app,'00-state.js');
  if(!home||!src||!versionFile||!await p109File(app,'43-project-control.js')||
    !(await (await versionFile.getFile()).text()).includes('P109_APP_VERSION'))
   throw Error('请选择已有的 P109 程序目录，不能选择数据目录或其他软件目录');
  const upgrades=items.filter(x=>x!==manifestFile);
  if(upgrades.length!==manifest.files.length||upgrades.length>120)
   throw Error('程序文件数量与清单不一致');
  const refs=new Map(manifest.files.map(x=>[x.path,x]));
  if(refs.size!==upgrades.length)throw Error('程序清单路径重复');
  for(const f of upgrades){
   if(!(f.name==='index.html'||f.name==='README.md'||/^src\/[a-zA-Z0-9_.\-\/]+$/.test(f.name)))
    throw Error('更新包包含禁止修改的数据路径：'+f.name);
   const m=refs.get(f.name);
   if(!m||m.bytes!==f.data.byteLength||m.sha256!==(await p109Hash(f.data)))
    throw Error('更新包哈希校验失败：'+f.name);
  }
  if(!upgrades.some(x=>x.name==='index.html')||
   !upgrades.some(x=>x.name==='src/app/43-project-control.js'))
   throw Error('程序包缺少关键文件，不是完整软件');
  if(!state.saved&&!window.confirm('当前月份尚有未保存内容；更新前请先保存。仍然备份磁盘状态并继续？'))return false;
  if(!window.confirm('准备安装 '+manifest.appVersion+'。将先在 backups/ 保存完整项目备份，然后仅替换 index.html、src/ 程序文件。请确认安装包来自可信来源。继续？'))return false;
  // Archive is written on disk BEFORE any application file is replaced.
  const files=[],limits={count:0,bytes:0};
  await p109ArchiveWalk(root,'',files,limits);
  const sameDirectory=programRoot===root||!!(await programRoot.isSameEntry?.(root));
  if(!sameDirectory){
   for(const name of ['index.html','README.md','p109-release-manifest.json']){
    const h=await p109File(programRoot,name);if(!h)continue;
    const data=new Uint8Array(await (await h.getFile()).arrayBuffer());
    limits.count++;limits.bytes+=data.byteLength;
    if(limits.count>5000||limits.bytes>160*1024*1024)throw Error('升级前备份超过文件数量或大小上限');
    files.push({name:'program/'+name,data});
   }
   await p109ArchiveWalk(src,'program/src/',files,limits);
  }
  const {zip}=await p109ZipBuild(files);
  const archive=new Uint8Array(await zip.arrayBuffer()),backupHash=await p109Hash(archive),
   backupFolder=await dir(root,'backups'),
   backupName='pre-upgrade-'+new Date().toISOString().replace(/[:.]/g,'-')+'.zip';
  if(await p109File(backupFolder,backupName))throw Error('备份文件已存在，禁止覆盖');
  await writeFile(backupFolder,backupName,archive);
  const persisted=await p109File(backupFolder,backupName);
  if(backupHash!==await p109Hash(new Uint8Array(await (await persisted.getFile()).arrayBuffer())))
   throw Error('升级前项目备份写盘校验失败，未更新任何程序文件');
  const prior=[],completed=[];
  for(const f of upgrades){
   const parts=f.name.split('/'),name=parts.pop();let folder=programRoot;
   for(const dirName of parts)folder=await dir(folder,dirName);
   const existing=await p109File(folder,name);
   prior.push({folder,name,exists:!!existing,
    data:existing?new Uint8Array(await (await existing.getFile()).arrayBuffer()):null});
  }
  try{
   for(let i=0;i<upgrades.length;i++){
    const f=upgrades[i],dest=prior[i];
    await writeFile(dest.folder,dest.name,f.data);
    completed.push(dest);
    const actual=await p109File(dest.folder,dest.name);
    if((await p109Hash(new Uint8Array(await (await actual.getFile()).arrayBuffer())))!==refs.get(f.name).sha256)
     throw Error('更新后校验失败：'+f.name);
   }
  }catch(e){
   let rollbackErrors=0;
   for(const dest of [...completed].reverse()){
    try{
     if(dest.exists)await writeFile(dest.folder,dest.name,dest.data);
     else if(typeof dest.folder.removeEntry==='function')await dest.folder.removeEntry(dest.name);
    }catch(_){rollbackErrors++}
   }
   throw Error('更新失败：'+e.message+'；已尝试恢复旧程序文件'+
    (rollbackErrors?'，'+rollbackErrors+' 个文件需根据备份人工恢复':''));
  }
  p109Status('程序更新已写入，完整备份保留于 backups/'+backupName+'；请重新打开 index.html');
  return true;
 }catch(e){p109Status('更新中止：'+e.message,true);return false}
 finally{p109ProjectBusy=false}
}
