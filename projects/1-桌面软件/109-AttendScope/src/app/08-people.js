'use strict';
function p109Ignored(id){return (state.ignoredPeople||[]).includes(id)}
function p109ActivePeople(){return EMPLOYEES.filter(e=>!p109Ignored(e.id))}
function p109StatPeople(){return state.workspaceMode==='person'||state.statsIncludeIgnored?EMPLOYEES:p109ActivePeople()}
function p109IgnoredRoster(){
 const people=new Map();
 for(const row of state.projectProfile?.ignoredEmployees||[])people.set(row.id,row);
 for(const store of state.monthStores.values())for(const row of store.employees||[])people.set(row.id,row);
 for(const row of EMPLOYEES)people.set(row.id,row);
 return (state.ignoredPeople||[]).map(id=>people.get(id)).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
}
function p109SetIgnored(ids,ignored){
 if(state.storageBusy||state.importCommitting||p109ProjectBusy||p109ConnectionBusy){toast('请先完成文件操作',true);return false}
 const people=new Map([...p109IgnoredRoster(),...EMPLOYEES].map(e=>[e.id,e]));
 const next=new Set(state.ignoredPeople||[]),eligible=ids.filter(id=>people.has(id));
 if(!eligible.length)return false;
 for(const id of eligible)if(ignored)next.add(id);else next.delete(id);
 state.ignoredPeople=[...next];state.statsIncludeIgnored=false;
 if(!state.snapshotContext&&!state.activeBranch){
 state.projectProfile={...(state.projectProfile||{}),schemaVersion:1,ignoredPeople:[...next],
  ignoredEmployees:[...next].map(id=>people.get(id)).filter(Boolean).map(e=>({...e}))};
 for(const store of state.monthStores.values())if(!store.snapshotContext&&!store.activeBranch){store.ignoredPeople=[...next];store.saved=false}
 }
 r68UI.chosen.clear();r68UI.fixedChosen.clear();
 r72MarkDirty(ignored?'ignore-people':'restore-people',{employees:eligible});
 toast(ignored?'已加入忽略名单；首页和统计默认排除，原始记录保留':'已恢复到全员；首页和统计重新纳入');return true;
}
