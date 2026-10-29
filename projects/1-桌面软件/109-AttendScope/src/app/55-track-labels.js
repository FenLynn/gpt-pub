/* Month-scoped display fields. Source cells are copied as evidence, never edited. */
'use strict';
const P110_LABEL_KINDS={leave:'请假',trip:'出差',outing:'外出报备',overtime:'登记加班'};
const P110_LABEL_ROWS={leave:'leaves',trip:'trips',outing:'outings',overtime:'overtimeEntries'};
const p110Text=value=>String(value??'').normalize('NFKC').trim().slice(0,240);
function p110CleanData(rows){return Array.isArray(rows)?rows.slice(0,512).filter(r=>r&&typeof r.key==='string').map(r=>({key:r.key.slice(0,500),name:p110Text(r.name),value:p110Text(r.value)})):[]}
function p110CleanProfile(profile){
 if(!profile||!Array.isArray(profile.fields))return null;
 const seen=new Set();return {fields:profile.fields.slice(0,12).filter(f=>f&&typeof f.key==='string'&&!seen.has(f.key)&&seen.add(f.key)).map(f=>({key:f.key.slice(0,500),name:p110Text(f.name),title:p110Text(f.title).slice(0,40)}))};
}
function p110Columns(d){
 if(d.p110ColumnCache?.grid===d.grid&&d.p110ColumnCache.header===d.header&&d.p110ColumnCache.skip===d.skip)return d.p110ColumnCache.columns;
 const width=Math.min(512,Math.max(0,...d.grid.rows.slice(0,80).map(r=>r.cells.length))),headers=d.header?d.grid.rows[d.skip]?.cells||[]:[],seen=new Map();
 const columns=Array.from({length:width},(_,i)=>{
  const name=p110Text(headers[i]),occurrence=(seen.get(name)||0)+1;seen.set(name,occurrence);
  const duplicate=d.header&&name&&headers.filter(value=>p110Text(value)===name).length>1;
  let schema=2166136261;for(const ch of JSON.stringify(headers.map(p110Text)))schema=Math.imul(schema^ch.charCodeAt(0),16777619)>>>0;
  return {index:i,key:d.header&&name?'head:'+JSON.stringify([name,occurrence])+(duplicate?':schema:'+schema.toString(36):''):'column:'+width+':'+i,
   name:name||'列 '+r62ColumnLabel(i),display:(name||'列 '+r62ColumnLabel(i))+(occurrence>1&&name?'（第'+occurrence+'列）':'')};
 });
 d.p110ColumnCache={grid:d.grid,header:d.header,skip:d.skip,columns};return columns;
}
function p110MonthProfile(kind,key=monthKey()){
 const prefs=key===monthKey()?state.prefs:state.monthStores.get(key)?.prefs||state.prefs;
 return p110CleanProfile(prefs?.trackLabels?.[kind]);
}
function p110PrepareDraft(d,saved=null){
 if(!P110_LABEL_KINDS[d.kind])return;
 const columns=p110Columns(d),profile=p110MonthProfile(d.kind,d.targetMonth||monthKey());
 d.labelNotice=!d.header?'无表头文件按列位显示，请逐次核对。':columns.some(c=>c.display!==c.name)?'存在同名或空表头，请核对选中的具体列。':'';
 d.labelTitles={};d.labelKeys={};d.labelMissing=[];
 if(profile){
  d.labelColumns=[];for(const [position,field] of profile.fields.entries()){const canonical=/^field:(type|place|note)$/.exec(field.key),matches=canonical?columns.filter(c=>c.index===d.mapping[canonical[1]]):columns.filter(c=>c.key===field.key);
   if(matches.length===1){const i=matches[0].index;if(!d.labelColumns.includes(i))d.labelColumns.push(i);d.labelTitles[i]=field.title;if(canonical)d.labelKeys[i]=field.key}else d.labelMissing.push({...field,position});
  }
 }else{
  for(const index of d.labelColumns||[]){const column=columns.find(c=>c.index===index),prior=(saved?.labels||[]).flatMap((name,i)=>p110Text(name)===column?.name?[i]:[]);
   if(prior.length===1)d.labelTitles[index]=p110Text(saved?.labelTitles?.[prior[0]]).slice(0,40);
  }
 }
}
function p110DraftProfile(d){
 const columns=p110Columns(d),fields=(d.labelColumns||[]).flatMap(index=>{const c=columns.find(c=>c.index===index);return c?[{key:d.labelKeys?.[index]||c.key,name:c.name,title:p110Text(d.labelTitles?.[index]).slice(0,40)}]:[]});
 for(const field of [...(d.labelMissing||[])].sort((a,b)=>(a.position??12)-(b.position??12)))fields.splice(Math.min(field.position??fields.length,fields.length),0,field);
 return {fields};
}
function p110ApplyDraft(d){
 if(!P110_LABEL_KINDS[d.kind]||d.targetMonth!==monthKey()||state.snapshotContext&&!state.activeBranch)return;
 state.prefs={...state.prefs,trackLabels:{...(state.prefs?.trackLabels||{}),[d.kind]:p110CleanProfile(p110DraftProfile(d))}};
 state.saved=false;rememberMonth();
}
function p110DraftData(d,cells){return p110Columns(d).map(c=>({key:c.key,name:c.name,value:p110Text(cells[c.index])}))}
function p110RecordData(record){
 const canonical=[['type','类型'],['place','地点'],['note','备注']].map(([key,name])=>({key:'field:'+key,name,value:p110Text(record?.[key])}));
 return [...p110CleanData(record?.labelData),...canonical];
}
function p110ProfileText(record,profile){
 const data=p110RecordData(record);return profile.fields.flatMap(field=>{
  const values=[...new Set(data.filter(r=>r.key===field.key).map(r=>r.value).filter(Boolean))];
  return values.length?[(field.title?field.title+'：':'')+values.join(' / ')]:[];
 }).join(' · ');
}
function p110TrackLabel(record,kind){
 const profile=p110MonthProfile(kind);if(profile)return p110ProfileText(record,profile);
 if(Array.isArray(record?.labelParts))return [...new Set(record.labelParts.map(p110Text).filter(Boolean))].join(' · ');
 return ['type','place','note'].map(key=>p110Text(record?.[key])).filter(Boolean).join(' · ');
}
function p110ImportLabelsHtml(d,cols,label){
 if(!P110_LABEL_KINDS[d.kind])return '';
 const selected=d.labelColumns||[];return '<section class="r104-label-config"><div class="r104-label-head"><strong>时间块文字</strong><select id="r104LabelAdd" aria-label="添加轨道标签列" '+(selected.length>=12?'disabled':'')+'><option value="">添加字段…</option>'+cols.filter(i=>!selected.includes(i)).map(i=>'<option value="'+i+'">'+label(i)+'</option>').join('')+'</select></div><div class="r104-label-list">'+
  selected.map((i,pos)=>'<div><span title="'+label(i)+'">'+label(i)+'</span><input data-label-title="'+i+'" aria-label="'+label(i)+'显示名" placeholder="显示名（可选）" maxlength="40" value="'+r62Esc(d.labelTitles?.[i]||'')+'"><button type="button" data-label-move="up" data-label-pos="'+pos+'" '+(!pos?'disabled':'')+' aria-label="上移">↑</button><button type="button" data-label-move="down" data-label-pos="'+pos+'" '+(pos===selected.length-1?'disabled':'')+' aria-label="下移">↓</button><button type="button" data-label-remove="'+pos+'" aria-label="移除">×</button></div>').join('')+
  (d.labelMissing||[]).map((f,i)=>'<div class="p110-missing"><span>未匹配：'+r62Esc(f.name)+'</span><button type="button" data-label-missing="'+i+'" aria-label="移除未匹配字段">×</button></div>').join('')+
  (!selected.length&&!d.labelMissing?.length?'<p>不显示文字标签</p>':'')+'</div><small>按月保存，新增月份继承；显示名留空只显示内容。'+r62Esc(d.labelNotice||'')+'</small></section>';
}
function p110AvailableFields(kind){
 const options=new Map();for(const row of state[P110_LABEL_ROWS[kind]]||[])for(const field of p110RecordData(row))if(!options.has(field.key))options.set(field.key,{key:field.key,name:field.name});
 const t=state.importProfile?.templates?.[kind];if(t?.labels?.length)for(const field of p110Columns({grid:{rows:[{cells:t.labels}]},header:true,skip:0}))if(!options.has(field.key))options.set(field.key,{key:field.key,name:field.display});
 for(const [key,name] of [['type','类型'],['place','地点'],['note','备注']])options.set('field:'+key,{key:'field:'+key,name:'已识别'+name});
 return [...options.values()];
}
let p110LabelDialog=null;
function p110InitialProfile(kind){
 const explicit=p110MonthProfile(kind);if(explicit)return explicit;
 const template=state.importProfile?.templates?.[kind];
 if(template?.labels?.length&&Array.isArray(template.labelColumns)){
  const columns=p110Columns({header:true,skip:0,grid:{rows:[{cells:template.labels}]}});
  return {fields:template.labelColumns.flatMap(i=>{const c=columns.find(c=>c.index===i);return c?[{key:c.key,name:c.name,title:p110Text(template.labelTitles?.[i])}]:[]})};
 }
 return {fields:['type','place','note'].map(name=>({key:'field:'+name,name:({type:'类型',place:'地点',note:'备注'})[name],title:''}))};
}
function p110OpenLabels(kind='leave'){
 if(p110LabelDialog||state.importCommitting||state.storageBusy)return;
 if(!P110_LABEL_KINDS[kind])kind='leave';
 if(state.snapshotContext&&!state.activeBranch){toast('冻结只读，请先派生独立修订再修改显示设置',true);return}
 const origin=document.activeElement,key=monthKey(),identity=state.projectDir,initial={};
 for(const k of Object.keys(P110_LABEL_KINDS))initial[k]=p110InitialProfile(k);
 const draft=p109Clone(initial),node=document.createElement('section');node.id='p110LabelDialog';node.className='p109-recent-overlay';node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');
 node.setAttribute('aria-labelledby','p110LabelTitle');p110LabelDialog=node;document.body.appendChild(node);
 const changed=new Set();let busy=false;const active=()=>node.isConnected&&key===monthKey()&&identity===state.projectDir,close=()=>{if(busy)return;node.remove();p110LabelDialog=null;origin?.isConnected&&origin.focus({preventScroll:true})};
 const paint=()=>{
  const fields=p110AvailableFields(kind),selected=draft[kind].fields,preview=(state[P110_LABEL_ROWS[kind]]||[]).slice(0,6).map(r=>p110ProfileText(r,draft[kind])).find(Boolean);
  node.innerHTML='<div class="p110-label-panel"><header><div><h2 id="p110LabelTitle">时间块文字 · '+r62Esc(key)+'</h2><p>仅调整当月显示；新增月份自动继承，不追改已有月份。</p></div><button type="button" data-p110-close aria-label="关闭时间块文字">×</button></header><nav>'+Object.entries(P110_LABEL_KINDS).map(([k,title])=>'<button type="button" data-p110-kind="'+k+'" aria-pressed="'+(kind===k)+'">'+title+'</button>').join('')+'</nav><div class="p110-label-body"><div class="p110-label-columns"><span>来源列</span><span>自定义显示名（可选）</span><span>顺序</span></div><div class="p110-label-rows">'+selected.map((f,i)=>{
   const missing=!fields.some(c=>c.key===f.key);return '<div><select data-p110-field="'+i+'" aria-label="第'+(i+1)+'项来源列">'+(missing?'<option value="'+r62Esc(f.key)+'">未匹配：'+r62Esc(f.name)+'</option>':'')+fields.map(c=>'<option value="'+r62Esc(c.key)+'" '+(c.key===f.key?'selected':'')+'>'+r62Esc(c.name)+'</option>').join('')+'</select><input data-p110-title="'+i+'" aria-label="第'+(i+1)+'项显示名" maxlength="40" placeholder="留空仅显示内容" value="'+r62Esc(f.title)+'"><span><button type="button" data-p110-up="'+i+'" '+(!i?'disabled':'')+' aria-label="上移">↑</button><button type="button" data-p110-down="'+i+'" '+(i===selected.length-1?'disabled':'')+' aria-label="下移">↓</button><button type="button" data-p110-remove="'+i+'" aria-label="移除">×</button></span></div>';
  }).join('')+'</div><button type="button" id="p110AddField" '+(selected.length>=12?'disabled':'')+'>＋ 添加显示列</button><button type="button" id="p110ClearFields">不显示文字</button><div class="p110-label-preview"><span>预览</span><strong>'+r62Esc(preview||(!selected.length?'不显示文字':'暂无匹配内容'))+'</strong></div><p>按列名匹配；列改名或缺失时需要重新选择，不沿用旧列号。不同文件同名列共用选择；名称不同可分别添加，空值跳过。</p><p id="p110LabelStatus" role="status"></p><button type="button" id="p110LoadOriginals">读取旧记录原件中的其他列</button></div><footer><button type="button" data-p110-close>取消</button><button type="button" class="primary-btn" id="p110ApplyLabels">应用到当月</button></footer></div>';
  node.querySelectorAll('[data-p110-close]').forEach(b=>b.onclick=close);
  node.querySelectorAll('[data-p110-kind]').forEach(b=>b.onclick=()=>{kind=b.dataset.p110Kind;paint()});
  node.querySelectorAll('[data-p110-field]').forEach(el=>el.onchange=()=>{const i=+el.dataset.p110Field,value=fields.find(f=>f.key===el.value);if(selected.some((f,j)=>j!==i&&f.key===value?.key)){toast('该列已经选中',true);paint();return}selected[i]={...selected[i],key:value.key,name:value.name};changed.add(kind);paint()});
  node.querySelectorAll('[data-p110-title]').forEach(el=>el.oninput=()=>{selected[+el.dataset.p110Title].title=p110Text(el.value).slice(0,40);changed.add(kind);const row=(state[P110_LABEL_ROWS[kind]]||[]).find(r=>p110ProfileText(r,draft[kind]));node.querySelector('.p110-label-preview strong').textContent=row?p110ProfileText(row,draft[kind]):'暂无匹配内容'});
  for(const [attr,delta] of [['up',-1],['down',1]])node.querySelectorAll('[data-p110-'+attr+']').forEach(b=>b.onclick=()=>{const i=+b.getAttribute('data-p110-'+attr),j=i+delta;[selected[i],selected[j]]=[selected[j],selected[i]];changed.add(kind);paint()});
  node.querySelectorAll('[data-p110-remove]').forEach(b=>b.onclick=()=>{selected.splice(+b.dataset.p110Remove,1);changed.add(kind);paint()});
  node.querySelector('#p110AddField').onclick=()=>{const next=fields.find(f=>!selected.some(v=>v.key===f.key));if(next){selected.push({...next,title:''});changed.add(kind);paint()}else toast('已选完可用列；可先导入文件或读取旧原件',true)};
  node.querySelector('#p110ClearFields').onclick=()=>{draft[kind]={fields:[]};changed.add(kind);paint()};
  node.querySelector('#p110ApplyLabels').onclick=()=>{
   if(!active()){toast('月份或项目已切换，请重新打开设置',true);close();return}
   changed.add(kind);const profiles=p109Clone(state.prefs?.trackLabels||{});for(const k of changed)profiles[k]=p110CleanProfile(draft[k]);
   state.prefs={...state.prefs,trackLabels:profiles};state.saved=false;rememberMonth();close();render();toast('已应用当月时间块文字；请保存项目，新月份将继承');
  };
  node.querySelector('#p110LoadOriginals').onclick=async()=>{
   busy=true;node.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);
   try{const status=await p110LoadOldColumns(kind,active);if(active()){busy=false;paint();node.querySelector('#p110LabelStatus').textContent=status}}catch(e){if(active()){busy=false;paint();node.querySelector('#p110LabelStatus').textContent='读取未完成：'+e.message}}finally{busy=false;if(!active())close()}
  };
 };paint();node.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}else p109TrapDialogFocus(e,node)});node.querySelector('[data-p110-kind]')?.focus();
}
async function p110LoadOldColumns(kind,active){
 const rows=state[P110_LABEL_ROWS[kind]]||[],changes=[],messages=[];
 for(const meta of (state.imports||[]).filter(m=>m.type===kind)){
  if(!active())throw Error('月份或项目已切换');
  let file=p109SourceCache.get(meta.id);
  if(!file&&state.projectDir){try{let handle=state.projectDir;const parts=p109SourcePath(meta);for(const name of parts.slice(0,-1))handle=await handle.getDirectoryHandle(name);file=await(await handle.getFileHandle(parts.at(-1))).getFile()}catch(error){messages.push(meta.name+'原件无法读取：'+error.message);continue}}
  if(!file){messages.push(meta.name+'原件不可用');continue}
  if(meta.sha256&&await p109Digest(await file.arrayBuffer())!==meta.sha256)throw Error(meta.name+'原件哈希不符，未应用显示资料');
  const settings=meta.labelImportSettings,grid=await P109_TABLES.readGrid(file,settings?.encoding||'auto','__all__');
  for(const row of rows){for(const ref of row.sources||[row]){
   if(ref.importId!==meta.id)continue;
   const source=grid.rows.find(r=>r.rowNumber===ref.row&&(!ref.sheet||(r.sheet||grid.sheet)===ref.sheet));if(!source)continue;
   const sheetRows=grid.rows.filter(r=>(r.sheet||grid.sheet)===(source.sheet||grid.sheet)),headers=sheetRows.slice(0,101).filter(r=>r.cells.some(v=>R62_ALIASES.name.includes(p110Text(v).toLowerCase())));
   if(!settings&&headers.length!==1){messages.push(meta.name+'无法唯一识别历史表头，请重新导入核对');continue}
   const d={grid:{rows:sheetRows},header:settings?.header??true,skip:settings?.skip??sheetRows.indexOf(headers[0])},map=r62InferColumns({...d.grid,kind},d.header,d.skip);
   if(map.name<0||normalizedPerson(source.cells[map.name])!==normalizedPerson(ref.sourceName||row.sourceName||row.name)){messages.push(meta.name+'姓名列无法核对，未载入该行');continue}
   changes.push([row,p110DraftData(d,source.cells)]);
  }
  }
 }
 if(!active())throw Error('月份或项目已切换');
 for(const [row,data] of changes)row.labelData=[...(row.labelData||[]),...data].filter((v,i,all)=>all.findIndex(x=>x.key===v.key&&x.value===v.value)===i);
 if(changes.length){state.saved=false;rememberMonth();reanalyze()}
 return '已读取 '+changes.length+' 条显示资料。'+messages.join('；');
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-p110-labels]');if(button)p110OpenLabels(button.dataset.p110Labels||'leave')});
