'use strict';
function p109Clone(value){
 if(typeof globalThis.structuredClone==='function')return globalThis.structuredClone(value);
 const seen=new Map();
 const copy=v=>{
  if(typeof v==='function'||typeof v==='symbol')throw new DOMException('无法复制该数据类型','DataCloneError');
  if(v===null||typeof v!=='object')return v;
  if(seen.has(v))return seen.get(v);
  let result;
  if(v instanceof Date)result=new Date(v.getTime());
  else if(v instanceof RegExp)result=new RegExp(v.source,v.flags);
  else if(v instanceof ArrayBuffer)result=v.slice(0);
  else if(ArrayBuffer.isView(v)){
   const buffer=copy(v.buffer);result=v instanceof DataView?new DataView(buffer,v.byteOffset,v.byteLength):new v.constructor(buffer,v.byteOffset,v.length);
  }else if(typeof File!=='undefined'&&v instanceof File)result=new File([v],v.name,{type:v.type,lastModified:v.lastModified});
  else if(v instanceof Blob)result=v.slice(0,v.size,v.type);
  else if(v instanceof Map){result=new Map();seen.set(v,result);for(const [k,item] of v)result.set(copy(k),copy(item));return result}
  else if(v instanceof Set){result=new Set();seen.set(v,result);for(const item of v)result.add(copy(item));return result}
  else{
   if(!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)
    throw new DOMException('无法复制该数据类型','DataCloneError');
   result=Array.isArray(v)?new Array(v.length):{};seen.set(v,result);
   for(const key of Object.keys(v))Object.defineProperty(result,key,{value:copy(v[key]),enumerable:true,writable:true,configurable:true});
   return result;
  }
  seen.set(v,result);return result;
 };
 return copy(value);
}
if(!Array.prototype.at)Object.defineProperty(Array.prototype,'at',{configurable:true,writable:true,value:function(index){
 let i=Math.trunc(Number(index)||0);if(i<0)i+=this.length;return i<0||i>=this.length?undefined:this[i];
}});
if(!Object.hasOwn)Object.defineProperty(Object,'hasOwn',{configurable:true,writable:true,value:(object,key)=>Object.prototype.hasOwnProperty.call(object,key)});
function p109UniqueId(){
 if(globalThis.crypto&&typeof crypto.randomUUID==='function')return crypto.randomUUID();
 return 'p109-'+p109DownloadStamp()+'-'+Math.random().toString(36).slice(2,12);
}
function p109DownloadStamp(){
 const now=Date.now();p109DownloadStamp.last=Math.max(now,(p109DownloadStamp.last||0)+1);
 const d=new Date(p109DownloadStamp.last),pad=n=>String(n).padStart(2,'0');
 return d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'-'+pad(d.getHours())+pad(d.getMinutes())+pad(d.getSeconds())+'-'+String(d.getMilliseconds()).padStart(3,'0');
}
function p109Sha256Fallback(bytes){
 const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
 const input=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),n=input.byteLength,
  padded=new Uint8Array(Math.ceil((n+9)/64)*64),view=new DataView(padded.buffer),w=new Int32Array(64),
  h=new Int32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]),
  rotate=(x,r)=>(x>>>r)|(x<<(32-r));
 padded.set(input);padded[n]=128;view.setUint32(padded.length-8,Math.floor(n/0x20000000));view.setUint32(padded.length-4,(n*8)>>>0);
 for(let offset=0;offset<padded.length;offset+=64){
  for(let i=0;i<16;i++)w[i]=view.getInt32(offset+i*4);
  for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(rotate(x,7)^rotate(x,18)^(x>>>3))+w[i-7]+(rotate(y,17)^rotate(y,19)^(y>>>10)))|0}
  let [a,b,c,d,e,f,g,hh]=h;
  for(let i=0;i<64;i++){
   const t1=(hh+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+k[i]+w[i])|0,
    t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))|0;
   hh=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
  }
  [a,b,c,d,e,f,g,hh].forEach((value,i)=>h[i]=(h[i]+value)|0);
 }
 return [...h].map(value=>(value>>>0).toString(16).padStart(8,'0')).join('');
}
async function p109Digest(bytes){
 if(globalThis.crypto&&crypto.subtle){try{
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));return [...hash].map(x=>x.toString(16).padStart(2,'0')).join('');
 }catch(_){}}
 return p109Sha256Fallback(bytes);
}
