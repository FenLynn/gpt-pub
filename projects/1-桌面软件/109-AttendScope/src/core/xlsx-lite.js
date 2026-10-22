(function(global){
  'use strict';
  const TD = new TextDecoder('utf-8');
  const TE = new TextEncoder();
  function u16(v,o){return v[o]|(v[o+1]<<8)}
  function u32(v,o){return (v[o]|(v[o+1]<<8)|(v[o+2]<<16)|(v[o+3]<<24))>>>0}
  function xmlText(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
  async function inflateRaw(bytes){
    if(typeof DecompressionStream==='undefined') throw new Error('当前浏览器不支持 XLSX 解压，请使用最新版 Chrome/Edge，或先转为 CSV。');
    const ds = new DecompressionStream('deflate-raw');
    const ab = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(ab);
  }
  async function unzip(arrayBuffer){
    const v=new Uint8Array(arrayBuffer); let eocd=-1;
    for(let i=v.length-22;i>=Math.max(0,v.length-66000);i--){if(u32(v,i)===0x06054b50){eocd=i;break}}
    if(eocd<0) throw new Error('不是有效的 XLSX/ZIP 文件。');
    const total=u16(v,eocd+10), cdOffset=u32(v,eocd+16); let p=cdOffset; const out={};
    for(let n=0;n<total;n++){
      if(u32(v,p)!==0x02014b50) throw new Error('XLSX 中央目录损坏。');
      const method=u16(v,p+10), csize=u32(v,p+20), fn=u16(v,p+28), ex=u16(v,p+30), co=u16(v,p+32), lo=u32(v,p+42);
      const name=TD.decode(v.slice(p+46,p+46+fn));
      if(u32(v,lo)!==0x04034b50) throw new Error('XLSX 本地文件头损坏。');
      const lfn=u16(v,lo+26), lex=u16(v,lo+28), start=lo+30+lfn+lex; const comp=v.slice(start,start+csize);
      let data;
      if(method===0) data=comp; else if(method===8) data=await inflateRaw(comp); else throw new Error('XLSX 使用了暂不支持的压缩方法：'+method);
      out[name]=data; p+=46+fn+ex+co;
    }
    return out;
  }
  function xmlElements(parent,name){return [...parent.getElementsByTagNameNS('*',name)]}
  function parseXml(bytes){
    const doc=new DOMParser().parseFromString(TD.decode(bytes),'application/xml');
    if(xmlElements(doc,'parsererror').length)throw new Error('XLSX XML 内容损坏，无法读取');
    return doc;
  }
  function colIndex(ref){let n=0; const m=String(ref||'').match(/^[A-Z]+/i); if(!m)return 0; for(const ch of m[0].toUpperCase())n=n*26+(ch.charCodeAt(0)-64); return n-1}
  async function readXlsx(file){
    const zip=await unzip(await file.arrayBuffer());
    const wb=zip['xl/workbook.xml']; if(!wb) throw new Error('缺少 workbook.xml。');
    let shared=[];
    if(zip['xl/sharedStrings.xml']){
      const d=parseXml(zip['xl/sharedStrings.xml']); shared=xmlElements(d,'si').map(si=>xmlElements(si,'t').map(t=>t.textContent||'').join(''));
    }
    const wbDoc=parseXml(wb), first=xmlElements(wbDoc,'sheet')[0]; if(!first) return {sheet:'Sheet1',rows:[]};
    const rid=first.getAttribute('r:id')||first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
    const relDoc=parseXml(zip['xl/_rels/workbook.xml.rels']); let target='worksheets/sheet1.xml';
    for(const rel of xmlElements(relDoc,'Relationship')) if(rel.getAttribute('Id')===rid) target=rel.getAttribute('Target')||target;
    while(target.startsWith('/')) target=target.slice(1); if(target.startsWith('xl/')) target=target.slice(3); if(target.startsWith('./')) target=target.slice(2); const sheetPath='xl/'+target;
    const sd=zip[sheetPath]; if(!sd) throw new Error('找不到工作表：'+sheetPath);
    const doc=parseXml(sd); const rows=[];
    for(const r of xmlElements(doc,'row')){
      const arr=[];
      for(const c of xmlElements(r,'c')){
        const idx=colIndex(c.getAttribute('r')); const t=c.getAttribute('t'); let val='';
        if(t==='inlineStr'){val=xmlElements(c,'t').map(x=>x.textContent||'').join('')}
        else {const ve=xmlElements(c,'v')[0]; const raw=ve?ve.textContent:''; if(t==='s') val=shared[Number(raw)]??''; else if(t==='b') val=raw==='1'; else if(raw!==''&&!Number.isNaN(Number(raw))) val=Number(raw); else val=raw}
        arr[idx]=val;
      }
      arr.__rowNumber=Number(r.getAttribute('r'))||rows.length+1;
      rows.push(arr);
    }
    if(!rows.length)return {sheet:first.getAttribute('name')||'Sheet1',rows:[]};
    const headers=rows[0].map(x=>String(x??'').trim());
    const objects=rows.slice(1).filter(r=>r.some(v=>v!==undefined&&v!=='')).map(r=>{const obj=Object.fromEntries(headers.map((h,i)=>[h,r[i]??'']));obj.__rowNumber=r.__rowNumber;return obj;});
    return {sheet:first.getAttribute('name')||'Sheet1',headers,rows:objects,rawRows:rows.map(r=>({cells:Array.from(r),rowNumber:r.__rowNumber}))};
  }
  function parseCsvText(text){
    const rows=[]; let row=[], cur='', q=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i], code=text.charCodeAt(i);
      if(q){
        if(ch==='"'&&text[i+1]==='"'){cur+='"';i++}
        else if(ch==='"') q=false;
        else cur+=ch;
      }else{
        if(ch==='"') q=true;
        else if(ch===','){row.push(cur);cur=''}
        else if(code===10){row.push(cur);rows.push(row);row=[];cur=''}
        else if(code!==13) cur+=ch;
      }
    }
    row.push(cur); if(row.some(x=>x!==''))rows.push(row); if(!rows.length)return [];
    const headers=rows[0].map(x=>String(x).trim());
    return rows.slice(1).map((r,i)=>r.some(v=>String(v??'')!=='')?{...Object.fromEntries(headers.map((h,j)=>[h,r[j]??''])),__rowNumber:i+2}:null).filter(Boolean);
  }
  function parseDelimited(text){
    const first=String(text||'').replace(/^\uFEFF/,'');
    const head=first.split(/\r?\n/).slice(0,4).join('\n');
    const options=[',',';','\t'];
    const count=d=>{let quoted=false,n=0;for(const c of head){if(c==='"')quoted=!quoted;else if(c===d&&!quoted)n++}return n};
    const delim=options.sort((a,b)=>count(b)-count(a))[0];
    let row=[],field='',quoted=false;const rows=[];
    for(let i=0;i<first.length;i++){
      const c=first[i];
      if(c==='"'){if(quoted&&first[i+1]==='"'){field+='"';i++}else quoted=!quoted}
      else if(!quoted&&c===delim){row.push(field);field=''}
      else if(!quoted&&(c==='\n'||c==='\r')){if(c==='\r'&&first[i+1]==='\n')i++;
        row.push(field);if(row.some(x=>x.trim()!==''))rows.push(row);
        row=[];field='';
      }else field+=c;
    }
    row.push(field);if(row.some(x=>x.trim()!==''))rows.push(row);
    return rows.map((cells,i)=>({cells,rowNumber:i+1}));
  }
  async function readGrid(file,encoding='auto'){
    const name=file.name.toLowerCase();
    if(name.endsWith('.xlsx')){
      const table=await readXlsx(file);
      return {sheet:table.sheet,rows:table.rawRows||[],encoding:'xlsx'};
    }
    if(!name.endsWith('.csv'))throw new Error('请选择 .xlsx 或 .csv 文件');
    const bytes=await file.arrayBuffer();let text='';
    try{text=new TextDecoder(encoding==='auto'?'utf-8':encoding,{fatal:true}).decode(bytes)}
    catch(e){if(encoding!=='auto')throw new Error('无法按指定编码解析 CSV：'+encoding);
      text=new TextDecoder('gb18030').decode(bytes);}
    return {sheet:'CSV',encoding,rows:parseDelimited(text)};
  }
  async function readTable(file){
    const name=file.name.toLowerCase(); if(name.endsWith('.csv')) {const g=await readGrid(file);const h=g.rows[0]?.cells.map(v=>String(v).trim())||[];return {sheet:'CSV',headers:h,rawRows:g.rows,rows:g.rows.slice(1).map(r=>({...Object.fromEntries(h.map((k,i)=>[k,r.cells[i]??''])),__rowNumber:r.rowNumber}))};}
    if(name.endsWith('.xlsx')) return readXlsx(file); throw new Error('目前支持 .xlsx 和 .csv。');
  }
  const crcTable=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);t[n]=c>>>0}return t})();
  function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0}
  function push16(a,n){a.push(n&255,(n>>>8)&255)} function push32(a,n){a.push(n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255)}
  function zipStore(files){const out=[], central=[]; let offset=0, centralLength=0; const now=new Date(), dosTime=((now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1))&0xffff, dosDate=(((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate())&0xffff;
    for(const f of files){const name=TE.encode(f.name), data=typeof f.data==='string'?TE.encode(f.data):f.data, crc=crc32(data), local=[]; push32(local,0x04034b50);push16(local,20);push16(local,0x0800);push16(local,0);push16(local,dosTime);push16(local,dosDate);push32(local,crc);push32(local,data.length);push32(local,data.length);push16(local,name.length);push16(local,0);local.push(...name); out.push(Uint8Array.from(local),data);
      const cen=[];push32(cen,0x02014b50);push16(cen,20);push16(cen,20);push16(cen,0x0800);push16(cen,0);push16(cen,dosTime);push16(cen,dosDate);push32(cen,crc);push32(cen,data.length);push32(cen,data.length);push16(cen,name.length);push16(cen,0);push16(cen,0);push16(cen,0);push16(cen,0);push32(cen,0);push32(cen,offset);cen.push(...name);central.push(Uint8Array.from(cen));centralLength+=cen.length;offset+=local.length+data.length}
    const cdOffset=offset;const e=[];push32(e,0x06054b50);push16(e,0);push16(e,0);push16(e,files.length);push16(e,files.length);push32(e,centralLength);push32(e,cdOffset);push16(e,0);return new Blob([...out,...central,Uint8Array.from(e)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})}
  function colName(n){let s='';n++;while(n){const r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26)}return s}
  function writeXlsx(rows,sheetName='Sheet1'){
    if(!rows.length)rows=[{}]; const headers=Object.keys(rows[0]);
    const all=[headers,...rows.map(r=>headers.map(h=>r[h]??''))]; let sheet='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
    all.forEach((r,ri)=>{sheet+=`<row r="${ri+1}">`;r.forEach((val,ci)=>{const ref=colName(ci)+(ri+1); if(typeof val==='number'&&Number.isFinite(val)) sheet+=`<c r="${ref}"><v>${val}</v></c>`; else sheet+=`<c r="${ref}" t="inlineStr"><is><t>${xmlText(val)}</t></is></c>`});sheet+='</row>'}); sheet+='</sheetData></worksheet>';
    const files=[
      {name:'[Content_Types].xml',data:'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'},
      {name:'_rels/.rels',data:'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
      {name:'xl/workbook.xml',data:`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlText(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`},
      {name:'xl/_rels/workbook.xml.rels',data:'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'},
      {name:'xl/worksheets/sheet1.xml',data:sheet}
    ]; return zipStore(files);
  }
  global.AttendScopeXLSX={readTable,readGrid,writeXlsx,parseCsvText,parseDelimited,writeArchive:zipStore};
})(window);
