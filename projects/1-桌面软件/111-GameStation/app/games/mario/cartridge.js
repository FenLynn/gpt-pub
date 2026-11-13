(function(){
"use strict";
const screen=document.getElementById("nesScreen");
const context=screen.getContext("2d",{alpha:false});
const pixels=context.createImageData(256,240);
const rgba=new Uint32Array(pixels.data.buffer);
const fileInput=document.getElementById("nesFile");
const panel=document.getElementById("nesPanel");
const picker=document.getElementById("nesPicker");
const status=document.getElementById("nesStatus");
const sound=document.getElementById("nesSound");
const start=document.getElementById("nesStart");
const select=document.getElementById("nesSelect");
const {NES,Controller}=window.P111NES;
const {BUTTON_A:A,BUTTON_B:B,BUTTON_SELECT:SELECT,BUTTON_START:START,BUTTON_UP:UP,BUTTON_DOWN:DOWN,BUTTON_LEFT:LEFT,BUTTON_RIGHT:RIGHT}=Controller;
const buttons={ArrowUp:UP,ArrowDown:DOWN,ArrowLeft:LEFT,ArrowRight:RIGHT,KeyW:UP,KeyS:DOWN,KeyA:LEFT,KeyD:RIGHT,Space:A,KeyX:A,KeyZ:B,ShiftLeft:B,ShiftRight:B,KeyR:START,KeyQ:SELECT};
const held=new Map();
let enabled=false,running=false,rom=null,machine=null,frameId=null,last=0,elapsed=0,request=0;
let audio=null,samples=[],audioAt=0,audioSources=new Set();
const interval=1000*1001/60000;
function report(message){status.textContent=message;GameBridge.report(message);}
function frame(buffer){
 for(let i=0;i<rgba.length;i++)rgba[i]=0xff000000|buffer[i];
 context.putImageData(pixels,0,0);
}
function renderSound(){
 if(!audio||audio.state!=="running"||!samples.length){samples.length=0;return;}
 const buffer=audio.createBuffer(2,samples.length/2,audio.sampleRate);
 const left=buffer.getChannelData(0),right=buffer.getChannelData(1);
 for(let i=0;i<left.length;i++){left[i]=samples[i*2];right[i]=samples[i*2+1];}
 samples.length=0;
 const source=audio.createBufferSource();source.buffer=buffer;source.connect(audio.destination);
 audioSources.add(source);source.onended=()=>{audioSources.delete(source);source.disconnect();};
 audioAt=Math.max(audioAt,audio.currentTime+.018);source.start(audioAt);audioAt+=buffer.duration;
}
function build(bytes){
 const nes=new NES({onFrame:frame,emulateSound:true,sampleRate:audio?.sampleRate||48000,
  onAudioSample(left,right){if(audio?.state==="running")samples.push(left,right);}});
 nes.setFramerate(60000/1001);
 nes.loadROM(bytes);
 return nes;
}
function release(){
 if(machine)for(const button of new Set(held.values()))machine.buttonUp(1,button);
 held.clear();
}
function pause(){
 running=false;release();
 if(frameId!==null)cancelAnimationFrame(frameId);
 frameId=null;last=0;elapsed=0;samples.length=0;audioAt=0;
 for(const source of audioSources)source.stop();
 audioSources.clear();
}
function tick(now){
 if(!running)return;
 if(last)elapsed+=Math.min(now-last,interval*4);
 last=now;
 try{
  while(elapsed>=interval){machine.frame();elapsed-=interval;renderSound();}
 }catch{
  pause();report("卡带运行中断，请重新载入");return;
 }
 frameId=requestAnimationFrame(tick);
}
function resume(){
 if(!enabled||!machine||running)return;
 running=true;elapsed=interval;frameId=requestAnimationFrame(tick);
 screen.focus({preventScroll:true});
}
function reset(){
 pause();
 if(!rom)return;
 machine=build(rom);machine.frame();
 report("按 R 或「主机开始」进入游戏");
}
function show(value){
 pause();request++;enabled=value;panel.hidden=!value;
 if(!value)return;
 picker.hidden=!!machine;
 if(!machine)report("选择本机 NES 卡带");
}
function press(key,button){
 if(held.has(key))return;
 if(![...held.values()].includes(button))machine.buttonDown(1,button);
 held.set(key,button);
}
function lift(key){
 const button=held.get(key);held.delete(key);
 if(button!==undefined&&![...held.values()].includes(button))machine?.buttonUp(1,button);
}
function keydown(event){
 const button=buttons[event.code];
 if(!running||button===undefined||event.altKey||event.ctrlKey||event.metaKey||event.target===fileInput)return;
 if(event.code==="Space"&&event.target instanceof HTMLButtonElement)return;
 event.preventDefault();press(event.code,button);
}
function keyup(event){lift(event.code);}
function tap(button){
 if(!running||!machine)return;
 const key=`button-${button}`;
 press(key,button);setTimeout(()=>lift(key),120);
 screen.focus({preventScroll:true});
}
function validRom(bytes){
 if(bytes.length<16||bytes[0]!==0x4e||bytes[1]!==0x45||bytes[2]!==0x53||bytes[3]!==0x1a||!bytes[4])return false;
 const trainer=bytes[6]&4?512:0;
 return bytes.length>=16+trainer+bytes[4]*16384+bytes[5]*8192;
}
fileInput.addEventListener("change",async()=>{
 const file=fileInput.files[0];fileInput.value="";
 if(!file)return;
 const attempt=++request;
 if(file.size>4*1024*1024){report("卡带超过 4 MB，无法载入");return;}
 try{
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(attempt!==request||!enabled)return;
  if(!validRom(bytes))throw new Error("文件不是完整的 iNES 卡带");
  const nes2=(bytes[7]&12)===8;
  if(nes2?(bytes[12]&3)===1:(bytes[9]&1))throw new Error("当前支持 NTSC 卡带，请选择 NTSC 版本");
  const next=build(bytes);next.frame();
  pause();rom=bytes;machine=next;picker.hidden=true;
  start.disabled=false;select.disabled=false;sound.disabled=false;
  report("卡带已载入 · 按 R 或「主机开始」");
  GameBridge.send("ACTIVITY");
  resume();
 }catch(error){if(attempt===request&&enabled)report(error.message||"无法载入该卡带");}
});
sound.addEventListener("click",async()=>{
 try{
  audio??=new AudioContext({sampleRate:48000});
  if(audio.state==="running"){await audio.suspend();sound.textContent="开启声音";}
  else{audioAt=0;await audio.resume();sound.textContent="关闭声音";}
 }catch{report("当前浏览器无法播放卡带声音");}
});
start.addEventListener("click",()=>tap(Controller.BUTTON_START));
select.addEventListener("click",()=>tap(Controller.BUTTON_SELECT));
window.addEventListener("keydown",keydown);
window.addEventListener("keyup",keyup);
window.addEventListener("blur",release);
window.P111MarioCartridge={show,reset,pause,resume,dispose(){
 pause();request++;enabled=false;rom=null;machine=null;
 window.removeEventListener("keydown",keydown);window.removeEventListener("keyup",keyup);window.removeEventListener("blur",release);
 audio?.close().catch(()=>{});
}};
})();
