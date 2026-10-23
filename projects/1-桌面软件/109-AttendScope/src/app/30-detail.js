function dayTypeText(t){return {work:'工作日',adjust:'调休工作日',rest:'休息日',holiday:'节假日'}[t]}
/* Retained evidence helpers only; retired duplicate HTML/SVG timelines. */
function escapeNameText(x){return String(x).replace(/[&<>\"']/g,v=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[v]))}

function showRecord(id){
  const p=state.records.find(x=>x.recordId===id); if(!p)return;
  if(typeof focusRawEvidence==='function')focusRawEvidence('attendance',id);
  document.querySelectorAll('[data-record]').forEach(x=>x.classList.toggle('selected',x.dataset.record===id));
  const box=document.getElementById('timelineEvidence'); if(!box)return;
  box.classList.remove('record-enter');
  box.innerHTML=`<div class="evidence-main"><span class="evidence-direction ${p.direction==='进'?'in':p.direction==='出'?'out':'unknown'}">${escapeNameText(p.direction)}</span><strong>${escapeNameText(p.time)}</strong><small>${escapeNameText(p.name)}</small></div>
    <div class="evidence-source"><span>${escapeNameText(p.source)}</span><small>${escapeNameText(p.sheet||'—')} · 行 ${escapeNameText(p.row||'—')} · ${escapeNameText(p.recordId)}</small>
    ${(p.sources||[p]).filter(x=>x.importId).map(x=>'<button type="button" class="r80-file-link" data-p109-source="'+escapeNameText(x.importId)+'">浏览原件 · '+escapeNameText(x.source)+' · 行 '+escapeNameText(x.row||'—')+'</button>').join('')}</div>`;
  requestAnimationFrame(()=>box.classList.add('record-enter'));
}

function reviseCurrent(action){
  if(state.selection.type!=='cell')return;
  const key=`${state.selection.employeeId}|${state.selection.day}`;
  if(action==='clear'){
    state.revisions=state.revisions.filter(r=>r.key!==key);
    toast('已清除该日人工痕迹，原始记录未改变');
  }else{
    state.revisions.push({id:`R${++state.revisionSeq}`,key,action,time:new Date().toISOString(),note:action==='resolved'?'人工核实':'人工说明'});
    toast(action==='resolved'?'已标记人工核实':'已添加人工说明');
  }
  state.saved=false; render();
}
