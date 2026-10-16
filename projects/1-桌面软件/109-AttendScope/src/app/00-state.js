'use strict';
const XLSX=window.AttendScopeXLSX;
const YEAR=2026, MONTH=10;
const DEMO_NAMES=["陈思远","林嘉禾","周亦宁","王若溪","李知夏","赵书言","沈清越","吴念安","郑予安","许慕白","苏晚晴","何景川","唐诗雨","陆明哲","韩子墨","顾一诺","宋雨桐","徐嘉宁","叶星辰","程安然","梁沐阳","杨可心","邓嘉祺","谢云舟","蒋书瑶","郭亦凡","夏知意","冯沐辰","傅清歌","曹锦程","姜乐言","董予希","段芷晴","钟书航","秦若楠","方之恒","黎星遥","彭思齐","余可欣","袁清禾","施景行","高雨薇","江知远","邵思涵","罗映雪","齐航","林安","欧阳晨曦","司马知远","白若曦"];
const EMPLOYEES=Array.from({length:50},(_,i)=>({id:'E'+String(i+1).padStart(3,'0'),name:DEMO_NAMES[i],department:['综合','研发','生产','质检','保障'][i%5]}));
const RULES={amStart:'08:30',amEnd:'12:00',pmStart:'14:00',pmEnd:'17:30',grace:5,dupSeconds:120};
const state={records:[],leaves:[],trips:[],analysis:new Map(),selection:{type:'overall'},filter:'all',zoom:1,compact:true,projectDir:null,imports:[],revisionSeq:0,revisions:[],saved:true};
const scenarioNames={normal:'正常',late:'迟到',early:'早退',absent:'缺勤',multiin:'多进一出',multiout:'一进多出',missingout:'缺少出',missingin:'缺少进',longout:'长时间外出',duplicate:'疑似重复打卡',overtime:'非工作日出勤'};
function pad(n){return String(n).padStart(2,'0')} function isoDate(d){return `${YEAR}-${pad(MONTH)}-${pad(d)}`}
function minutes(t){const [h,m,s='0']=String(t).split(':');return +h*60 + +m + (+s)/60}
function fmtMinutes(m){if(m==null||!Number.isFinite(m))return '—';const h=Math.floor(m/60),mi=Math.round(m%60);return `${h}h ${pad(mi)}m`}
function weekdayLabel(d){return ['日','一','二','三','四','五','六'][new Date(YEAR,MONTH-1,d).getDay()]}
function dayType(d){const ds=isoDate(d); if(d>=1&&d<=7)return 'holiday'; if(ds==='2026-10-10')return 'adjust'; const wd=new Date(YEAR,MONTH-1,d).getDay(); return wd===0||wd===6?'rest':'work'}
function isWorkday(d){const t=dayType(d);return t==='work'||t==='adjust'}
function seeded(n){let x=(n*9301+49297)%233280;return x/233280}
function jitter(base,delta,seed){const m=minutes(base)+Math.floor((seeded(seed)*2-1)*delta);return `${pad(Math.floor(m/60))}:${pad(Math.floor(m%60))}:${pad(Math.floor(seeded(seed+17)*60))}`}
function rec(emp,d,time,dir,scenario,idx){return {recordId:`demo:${emp.id}:${pad(d)}:${idx}`,employeeId:emp.id,name:emp.name,datetime:`${isoDate(d)} ${time}`,time,direction:dir,source:'模拟考勤_2026年10月.xlsx',sheet:'考勤',row:1000+d*100+Number(emp.id.slice(1))*10+idx,scenario}}
function generateMock(){
  const records=[];
  for(const emp of EMPLOYEES){const ei=Number(emp.id.slice(1));for(let d=1;d<=31;d++){
    const typ=dayType(d); const key=(ei*37+d*19)%100; let sc='normal';
    if(!isWorkday(d)){if((ei+d)%17===0)sc='overtime';else continue}
    else if(key<4)sc='absent'; else if(key<9)sc='late'; else if(key<13)sc='early'; else if(key<17)sc='multiin'; else if(key<21)sc='multiout'; else if(key<24)sc='missingout'; else if(key<27)sc='missingin'; else if(key<31)sc='longout'; else if(key<36)sc='duplicate';
    const seed=ei*100+d;
    if(sc==='absent')continue;
    if(sc==='overtime'){records.push(rec(emp,d,jitter('09:10',25,seed),'进',sc,1),rec(emp,d,jitter('16:40',45,seed+1),'出',sc,2));continue}
    let i1=jitter('08:18',10,seed),o1=jitter('12:04',8,seed+1),i2=jitter('13:52',8,seed+2),o2=jitter('17:42',12,seed+3);
    if(sc==='late')i1=jitter('08:52',12,seed); if(sc==='early')o2=jitter('16:54',18,seed+3); if(sc==='longout'){o1=jitter('11:25',8,seed+1);i2=jitter('15:05',12,seed+2)}
    const base=[rec(emp,d,i1,'进',sc,1),rec(emp,d,o1,'出',sc,2),rec(emp,d,i2,'进',sc,3),rec(emp,d,o2,'出',sc,4)];
    if(sc==='multiin')base.splice(1,0,rec(emp,d,jitter('10:15',20,seed+9),'进',sc,5));
    if(sc==='multiout')base.splice(3,0,rec(emp,d,jitter('15:30',25,seed+11),'出',sc,6));
    if(sc==='missingout')base.splice(1,1);
    if(sc==='missingin')base.splice(2,1);
    if(sc==='duplicate')base.splice(1,0,rec(emp,d,plusSeconds(i1,35),'进',sc,7));
    records.push(...base);
  }}
  const leaves=[
    leave('E003',8,'08:30','12:00','事假','上午请假'),leave('E007',9,'14:00','17:30','病假','下午请假'),leave('E012',12,'08:30','17:30','年假','全天年假'),leave('E019',16,'08:30','10:30','事假','早间请假'),leave('E024',20,'15:00','17:30','病假','下午部分请假'),leave('E031',22,'08:30','17:30','年假','全天年假'),leave('E038',27,'08:30','12:00','调休假','上午请假'),leave('E046',30,'14:00','17:30','事假','下午请假')
  ];
  const trips=[
    trip('E005',8,9,'客户现场','武汉','两日出差'),trip('E014',13,13,'外出会议','上海','全天会议'),trip('E021',19,21,'项目出差','成都','三日项目'),trip('E029',23,23,'现场支持','宜昌','全天支持'),trip('E041',26,27,'供应商拜访','深圳','两日拜访'),trip('E049',30,30,'培训','杭州','全天培训')
  ];
  return {records,leaves,trips};
}
function plusSeconds(t,s){let [h,m,ss]=t.split(':').map(Number);let x=h*3600+m*60+ss+s;return `${pad(Math.floor(x/3600)%24)}:${pad(Math.floor(x%3600/60))}:${pad(x%60)}`}
function leave(id,d,start,end,type,note){const e=EMPLOYEES.find(x=>x.id===id);return {id:`L-${id}-${d}`,employeeId:id,name:e.name,date:isoDate(d),start,end,type,note}}
function trip(id,ds,de,type,place,note){const e=EMPLOYEES.find(x=>x.id===id);return {id:`T-${id}-${ds}`,employeeId:id,name:e.name,startDate:isoDate(ds),endDate:isoDate(de),type,place,note}}
