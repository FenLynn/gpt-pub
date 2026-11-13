(function memoryArtwork(){
 "use strict";
 const animalData=[
  ["🐱","小猫","#f5bd88","#ffecdd","#f5989d","cat"],
  ["🐶","小狗","#e7c49d","#fff0d6","#aa805f","dog"],
  ["🐰","兔兔","#f4f0f1","#ffe2ed","#f2a2be","bunny"],
  ["🐻","小熊","#caa47c","#f5e6d2","#ae7a56","bear"],
  ["🐼","熊猫","#fffafa","#e6efff","#3d404d","panda"],
  ["🦊","狐狸","#efab67","#fff0d9","#f28567","fox"],
  ["🐸","青蛙","#97dba6","#e1f9df","#72bc89","frog"],
  ["🐥","小鸡","#f8d96e","#fff5cb","#e6a04e","chick"],
  ["🐷","小猪","#f2b8c9","#ffe7f1","#ec93ad","pig"],
  ["🐨","考拉","#b8c8d4","#e7f2f9","#879eae","koala"],
  ["🐧","企鹅","#414f65","#e5f2ff","#e6ad60","penguin"],
  ["🐹","仓鼠","#ebc38e","#fff0df","#f5ad81","hamster"]
 ];
 const catalog=new Map(animalData.map(([icon,name,coat,sky,accent,kind])=>[icon,{icon,name,coat,sky,accent,kind}]));
 const ears={
  cat:'<path d="M31 53 32 28Q34 16 44 26L53 39M89 53 88 28Q86 16 76 26L67 39" fill="{coat}" stroke="#72564e" stroke-width="2.8" stroke-linejoin="round"/><path d="M37 36 40 30 46 40M83 36 80 30 74 40" fill="{accent}" stroke="none"/>',
  dog:'<ellipse cx="30" cy="51" rx="14" ry="23" fill="#9e755b" transform="rotate(23 30 51)"/><ellipse cx="90" cy="51" rx="14" ry="23" fill="#9e755b" transform="rotate(-23 90 51)"/>',
  bunny:'<ellipse cx="43" cy="25" rx="11" ry="29" fill="{coat}" stroke="#ac9a9a" stroke-width="2" transform="rotate(-9 43 25)"/><ellipse cx="77" cy="25" rx="11" ry="29" fill="{coat}" stroke="#ac9a9a" stroke-width="2" transform="rotate(9 77 25)"/><ellipse cx="43" cy="24" rx="5" ry="22" fill="{accent}" transform="rotate(-9 43 24)"/><ellipse cx="77" cy="24" rx="5" ry="22" fill="{accent}" transform="rotate(9 77 24)"/>',
  bear:'<circle cx="36" cy="39" r="14" fill="{coat}" stroke="#83634b" stroke-width="2"/><circle cx="84" cy="39" r="14" fill="{coat}" stroke="#83634b" stroke-width="2"/><circle cx="36" cy="39" r="7" fill="{accent}" opacity=".65"/><circle cx="84" cy="39" r="7" fill="{accent}" opacity=".65"/>',
  panda:'<circle cx="34" cy="39" r="16" fill="#41454d"/><circle cx="86" cy="39" r="16" fill="#41454d"/>',
  fox:'<path d="M26 53 35 21Q38 15 49 33L55 42M94 53 85 21Q82 15 71 33L65 42" fill="{coat}" stroke="#a8714b" stroke-width="2.5" stroke-linejoin="round"/><path d="M35 37 39 30 45 41M85 37 81 30 75 41" fill="{accent}"/>',
  frog:'<circle cx="42" cy="39" r="15" fill="{coat}" stroke="#65ad78" stroke-width="2.3"/><circle cx="78" cy="39" r="15" fill="{coat}" stroke="#65ad78" stroke-width="2.3"/><circle cx="42" cy="38" r="8" fill="#fff"/><circle cx="78" cy="38" r="8" fill="#fff"/><circle cx="43" cy="39" r="4.6" fill="#293b40"/><circle cx="79" cy="39" r="4.6" fill="#293b40"/>',
  chick:'<path d="M49 38Q42 21 50 23L61 33Q61 15 69 24L72 42" fill="{coat}" stroke="#d7a74c" stroke-width="2.5" stroke-linejoin="round"/>',
  pig:'<path d="M28 53Q21 28 36 32L48 42M92 53Q99 28 84 32L72 42" fill="{coat}" stroke="#d790a7" stroke-width="2" stroke-linejoin="round"/><ellipse cx="35" cy="39" rx="6" ry="8" fill="{accent}"/><ellipse cx="85" cy="39" rx="6" ry="8" fill="{accent}"/>',
  koala:'<circle cx="28" cy="56" r="21" fill="{coat}" stroke="#8ba1ae" stroke-width="2.5"/><circle cx="92" cy="56" r="21" fill="{coat}" stroke="#8ba1ae" stroke-width="2.5"/><circle cx="28" cy="56" r="13" fill="#ecf0f4"/><circle cx="92" cy="56" r="13" fill="#ecf0f4"/>',
  penguin:'<ellipse cx="25" cy="79" rx="13" ry="25" fill="{coat}" transform="rotate(-26 25 79)"/><ellipse cx="95" cy="79" rx="13" ry="25" fill="{coat}" transform="rotate(26 95 79)"/>',
  hamster:'<circle cx="34" cy="43" r="12" fill="{coat}" stroke="#ca9f6a" stroke-width="2"/><circle cx="86" cy="43" r="12" fill="{coat}" stroke="#ca9f6a" stroke-width="2"/><circle cx="34" cy="43" r="6" fill="{accent}"/><circle cx="86" cy="43" r="6" fill="{accent}"/>'
 };
 const muzzle={
  cat:'<path d="M41 79h-9m9 4h-8m45-4h9m-9 4h8" stroke="#a37362" stroke-width="1.5" stroke-linecap="round"/>',
  dog:'<ellipse cx="60" cy="78" rx="18" ry="13" fill="#fff6e6"/><ellipse cx="60" cy="74" rx="5" ry="3.4" fill="#584239"/>',
  bunny:'<ellipse cx="52" cy="80" rx="11" ry="9" fill="#fff"/><ellipse cx="68" cy="80" rx="11" ry="9" fill="#fff"/><rect x="55" y="84" width="10" height="9" rx="3" fill="#fff" stroke="#e4b9bb" stroke-width="1"/><path d="M60 85v7" stroke="#e4b9bb"/>',
  bear:'<ellipse cx="60" cy="78" rx="16" ry="13" fill="#f8e3bf"/><ellipse cx="60" cy="73" rx="5" ry="4" fill="#695146"/>',
  panda:'<ellipse cx="45" cy="64" rx="10" ry="14" fill="#42464e" transform="rotate(-13 45 64)"/><ellipse cx="75" cy="64" rx="10" ry="14" fill="#42464e" transform="rotate(13 75 64)"/><ellipse cx="60" cy="79" rx="13" ry="10" fill="#fff"/>',
  fox:'<path d="M32 76Q48 71 60 81Q72 71 88 76Q80 98 60 94Q40 98 32 76" fill="#fff8e8"/>',
  frog:'<path d="M49 78Q60 87 71 78" fill="none" stroke="#42845a" stroke-width="2.5" stroke-linecap="round"/>',
  chick:'<path d="M53 74 60 82 67 74Q60 70 53 74" fill="#f29947" stroke="#b97835" stroke-width="1.2"/>',
  pig:'<ellipse cx="60" cy="79" rx="17" ry="13" fill="#eaa1b7"/><ellipse cx="54" cy="80" rx="3" ry="4" fill="#ba708a"/><ellipse cx="66" cy="80" rx="3" ry="4" fill="#ba708a"/>',
  koala:'<ellipse cx="60" cy="75" rx="11" ry="16" fill="#4c5565"/><ellipse cx="57" cy="71" rx="3" ry="5" fill="#8d9ba8" opacity=".65"/>',
  penguin:'<ellipse cx="60" cy="73" rx="25" ry="27" fill="#fffdfa"/><path d="M53 76 60 84 67 76Q60 72 53 76" fill="#f5b85c"/>',
  hamster:'<ellipse cx="41" cy="79" rx="18" ry="13" fill="#fff7e7"/><ellipse cx="79" cy="79" rx="18" ry="13" fill="#fff7e7"/><ellipse cx="60" cy="76" rx="5" ry="3.5" fill="#ad786a"/>'
 };
 function named(icon){return catalog.get(icon)?.name||String(icon);}
 function colors(icon){const c=catalog.get(icon);return c?{tint:c.sky,accent:c.accent}:null;}
 function face(icon){
  const c=catalog.get(icon);if(!c)return null;
  const ear=(ears[c.kind]||"").replaceAll("{coat}",c.coat).replaceAll("{accent}",c.accent);
  const extras=muzzle[c.kind]||"";
  const eyes=c.kind==="frog"
   ?'<circle cx="45" cy="62" r="2.5" fill="#486956"/><circle cx="75" cy="62" r="2.5" fill="#486956"/>'
   :'<ellipse cx="47" cy="65" rx="3.5" ry="4.5" fill="#343d4a"/><ellipse cx="73" cy="65" rx="3.5" ry="4.5" fill="#343d4a"/><circle cx="48" cy="63.5" r="1.2" fill="#fff"/><circle cx="74" cy="63.5" r="1.2" fill="#fff"/>';
  const mouth=c.kind==="frog"||c.kind==="chick"||c.kind==="penguin"||c.kind==="pig"
   ?"":'<path d="M55 85Q60 91 65 85" fill="none" stroke="#715951" stroke-width="2" stroke-linecap="round"/>';
  return `<span class="memory-portrait" aria-hidden="true"><svg class="memory-mascot-svg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg"><circle cx="60" cy="60" r="54" fill="${c.sky}"/><circle cx="24" cy="32" r="4" fill="#fff" opacity=".8"/><path d="M94 24v13m-6-6h13" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/><ellipse cx="60" cy="102" rx="30" ry="13" fill="${c.coat}" stroke="#816a6180" stroke-width="2"/><ellipse cx="34" cy="104" rx="10" ry="6" fill="${c.coat}"/><ellipse cx="86" cy="104" rx="10" ry="6" fill="${c.coat}"/>${ear}<circle cx="60" cy="67" r="32" fill="${c.coat}" stroke="#74605278" stroke-width="2.5"/>${extras}${eyes}<ellipse cx="38" cy="77" rx="7" ry="4.2" fill="#ef91a6" opacity=".78"/><ellipse cx="82" cy="77" rx="7" ry="4.2" fill="#ef91a6" opacity=".78"/>${mouth}<path d="M53 96Q60 103 67 96" fill="none" stroke="${c.accent}" stroke-width="3" stroke-linecap="round"/></svg><span class="memory-character-name">${c.name}</span></span>`;
 }
 const back=`<span class="memory-back-emblem" aria-hidden="true"><svg class="memory-paw-svg" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg"><path d="M31 56Q47 39 62 56Q73 68 60 74Q53 76 48 72Q43 76 35 74Q23 71 31 56Z" fill="#fffdf7"/><ellipse cx="21" cy="46" rx="7" ry="10" transform="rotate(-24 21 46)" fill="#fffdf7"/><ellipse cx="38" cy="31" rx="7" ry="10" transform="rotate(-8 38 31)" fill="#fffdf7"/><ellipse cx="58" cy="31" rx="7" ry="10" transform="rotate(8 58 31)" fill="#fffdf7"/><ellipse cx="75" cy="46" rx="7" ry="10" transform="rotate(24 75 46)" fill="#fffdf7"/><path d="M47 58q-7-8-11 0 0 7 11 13 11-6 11-13-4-8-11 0" fill="#f9adbe" opacity=".95"/></svg><span class="memory-back-stars">✦ · ✧ · ✦</span></span>`;
 window.GameMemoryArt={icons:animalData.map(x=>x[0]),named,colors,face,back};
})();
