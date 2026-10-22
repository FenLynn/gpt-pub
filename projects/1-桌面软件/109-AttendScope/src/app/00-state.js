'use strict';
const P109_DATA_SCHEMA=2;
const P109_APP_VERSION='0.2.9-preview';
const P109_APP_REVISION='R83';
const P109_ENGINE_VERSION='R83';
const XLSX=window.AttendScopeXLSX;
let YEAR=2026, MONTH=10;
function attendTitle(){return String(state?.prefs?.appTitle||'考勤').trim().slice(0,28)||'考勤'}
function monthKey(){return `${YEAR}-${pad(MONTH)}`}
function monthDays(){return new Date(YEAR,MONTH,0).getDate()}
function periodText(){return `${YEAR} 年 ${MONTH} 月`}
function monthISO(){return monthKey()}
function groupOf(e){return e?(state.groups?.[e.id]||'未分组'):'未分组'}
const DEMO_NAMES=["陈思远","林嘉禾","周亦宁","王若溪","李知夏","赵书言","沈清越","吴念安","郑予安","许慕白","苏晚晴","何景川","唐诗雨","陆明哲","韩子墨","顾一诺","宋雨桐","徐嘉宁","叶星辰","程安然","梁沐阳","杨可心","邓嘉祺","谢云舟","蒋书瑶","郭亦凡","夏知意","冯沐辰","傅清歌","曹锦程","姜乐言","董予希","段芷晴","钟书航","秦若楠","方之恒","黎星遥","彭思齐","余可欣","袁清禾","施景行","高雨薇","江知远","邵思涵","罗映雪","齐航","林安","欧阳晨曦","司马知远","白若曦"];
let EMPLOYEES=Array.from({length:50},(_,i)=>({id:'E'+String(i+1).padStart(3,'0'),name:DEMO_NAMES[i],department:['综合','研发','生产','质检','保障'][i%5]}));
// One visually related family for registered and inferred overtime; never use red anomaly tint.
const OVERTIME_VISUALS=Object.freeze({
 registered:Object.freeze({top:'#bf6971',bottom:'#e5a3aa',hoverTop:'#a94451',hoverBottom:'#d8818c'}),
 auto:Object.freeze({top:'#d99196',bottom:'#efc1c2',hoverTop:'#c36e78',hoverBottom:'#e6a0a7'}),
 excluded:Object.freeze({top:'#ebc4c7',bottom:'#f5dddf'})
});
const RULES={amStart:'08:30',amEnd:'11:40',pmStart:'13:30',pmEnd:'17:10',
 grace:5,graceAmStart:5,graceAmEnd:0,gracePmStart:5,gracePmEnd:0,
 dupSeconds:120,overtimeMinMinutes:20};
const P109_DEFAULT_RULES=Object.freeze({...RULES});
const state={calendarOverrides:{},isDemo:true,records:[],leaves:[],trips:[],analysis:new Map(),selection:{type:'overall'},filter:'main',judgmentMode:'initial',manualStatuses:{},overtimeReview:{},zoom:1,compact:true,projectDir:null,imports:[],revisionSeq:0,revisions:[],saved:true,groups:Object.fromEntries(EMPLOYEES.map(e=>[e.id,e.department+'组'])),monthStores:new Map(),nameAliases:{},fixedPeople:[],groupCatalog:['综合组','研发组','生产组','质检组','保障组'],workspaceMode:'all',selectedGroup:null,scopeSearch:'',attentionOnly:false,chartTab:'overview',chartDay:null,rawDataTab:'attendance',rawPageSize:25,rawPage:1,rawPopout:false,outings:[],overtimeEntries:[],prefs:{fontScale:1,motion:true,arrowsTowardLine:true,appTitle:'考勤'}};
const scenarioNames={normal:'正常',late:'迟到',early:'早退',absent:'缺勤',multiin:'多进一出',multiout:'一进多出',missingout:'缺少出',missingin:'缺少进',longout:'长时间外出',duplicate:'疑似重复打卡',overtime:'非工作日出勤'};
function pad(n){return String(n).padStart(2,'0')} function isoDate(d){return `${YEAR}-${pad(MONTH)}-${pad(d)}`}
function minutes(t){const [h,m,s='0']=String(t).split(':');return +h*60 + +m + (+s)/60}
function fmtMinutes(m){if(m==null||!Number.isFinite(m))return '—';const total=Math.max(0,Math.round(m)),h=Math.floor(total/60),mi=total%60;return `${h}h ${pad(mi)}m`}
function weekdayLabel(d){return ['日','一','二','三','四','五','六'][new Date(YEAR,MONTH-1,d).getDay()]}
function dayType(d){if(d>monthDays()||d<1)return 'outside';const ds=isoDate(d),custom=state.calendarOverrides?.[ds];if(custom==='holiday'||custom==='rest')return custom;if(custom==='adjusted-work'||custom==='adjust'||custom==='work')return 'adjust'; if(YEAR===2026&&MONTH===10&&d>=1&&d<=7)return 'holiday'; if(ds==='2026-10-10')return 'adjust'; const wd=new Date(YEAR,MONTH-1,d).getDay(); return wd===0||wd===6?'rest':'work'}
function isWorkday(d){const t=dayType(d);return t==='work'||t==='adjust'}
function seeded(n){let x=(n*9301+49297)%233280;return x/233280}
function jitter(base,delta,seed){const m=minutes(base)+Math.floor((seeded(seed)*2-1)*delta);return `${pad(Math.floor(m/60))}:${pad(Math.floor(m%60))}:${pad(Math.floor(seeded(seed+17)*60))}`}
function rec(emp,d,time,dir,scenario,idx){return {recordId:`demo:${emp.id}:${pad(d)}:${idx}`,employeeId:emp.id,name:emp.name,datetime:`${isoDate(d)} ${time}`,time,direction:dir,source:'模拟考勤_2026年10月.xlsx',sheet:'考勤',row:1000+d*100+Number(emp.id.slice(1))*10+idx,scenario}}
function generateMock(){
  const records=[];
  for(const emp of EMPLOYEES){const ei=Number(emp.id.slice(1));for(let d=1;d<=monthDays();d++){
    const typ=dayType(d); const key=(ei*37+d*19)%100; let sc='normal';
    if(!isWorkday(d)){
      // Stable, reproducible 2D hash; avoids artificial diagonal overtime bands.
      if(seeded(ei*1013+d*2719+ei*ei*19+d*d*73+ei*d*137)<.07)sc='overtime';
      else continue
    }
    else if(key<4)sc='absent'; else if(key<9)sc='late'; else if(key<13)sc='early'; else if(key<17)sc='multiin'; else if(key<21)sc='multiout'; else if(key<24)sc='missingout'; else if(key<27)sc='missingin'; else if(key<31)sc='longout'; else if(key<36)sc='duplicate';
    const seed=ei*100+d;
    if(sc==='absent')continue;
    if(sc==='overtime'){records.push(rec(emp,d,jitter('09:10',25,seed),'进',sc,1),rec(emp,d,jitter('16:40',45,seed+1),'出',sc,2));continue}
    let i1=jitter('08:18',10,seed),o1=jitter('11:44',5,seed+1),i2=jitter('13:25',5,seed+2),o2=jitter('17:17',6,seed+3);
    if(sc==='late')i1=jitter('08:52',12,seed); if(sc==='early')o2=jitter('16:54',12,seed+3); if(sc==='longout'){o1=jitter('11:09',8,seed+1);i2=jitter('14:45',12,seed+2)}
    const base=[rec(emp,d,i1,'进',sc,1),rec(emp,d,o1,'出',sc,2),rec(emp,d,i2,'进',sc,3),rec(emp,d,o2,'出',sc,4)];
    if(sc==='multiin')base.splice(1,0,rec(emp,d,jitter('10:15',20,seed+9),'进',sc,5));
    if(sc==='multiout')base.splice(3,0,rec(emp,d,jitter('15:30',25,seed+11),'出',sc,6));
    if(sc==='missingout')base.splice(1,1);
    if(sc==='missingin')base.splice(2,1);
    if(sc==='duplicate')base.splice(1,0,rec(emp,d,plusSeconds(i1,35),'进',sc,7));
    // R55: deterministic, explicitly labeled DEMO-ONLY workday examples.
    // These exercise the full automatic-overtime calculation without changing
    // any imported punch or inventing overtime in real employee records.
    if(sc==='normal'&&((ei===1&&d===12)||(ei===7&&d===12)||(ei===18&&d===21)))
      base[3]=rec(emp,d,'19:05:00','出','auto-overtime-demo',4);
    // Deterministic stress cases: repeated in/out, burst swipes, and short departures.
    if((ei*13+d*17)%41===0){
      base.push(rec(emp,d,'09:14:06','进','rapid-swipes',8),
        rec(emp,d,'09:16:11','出','rapid-swipes',9),
        rec(emp,d,'09:17:24','进','rapid-swipes',10),
        rec(emp,d,'09:20:35','出','rapid-swipes',11),
        rec(emp,d,'09:22:41','进','rapid-swipes',12),
        rec(emp,d,'09:24:59','出','rapid-swipes',13));
    }
    if((ei*11+d*7)%67===0){
      base.push(rec(emp,d,'18:18:00','进','evening-reentry',14),
        rec(emp,d,'18:27:00','出','evening-reentry',15),
        rec(emp,d,'18:35:00','进','evening-reentry',16),
        rec(emp,d,'19:16:00','出','evening-reentry',17));
    }
    records.push(...base);
  }}
  const leaves=[
    leave('E003',8,'08:30','12:00','事假','上午请假'),leave('E007',9,'14:00','17:30','病假','下午请假'),leave('E011',14,'09:30','12:00','事假','研发评审后请假'),leave('E011',23,'09:20','10:30','事假','全轨道演示请假'),leave('E011',24,'09:20','10:30','事假','全轨道演示请假'),
    leave('E012',12,'08:30','17:30','年假','全天年假'),leave('E019',16,'08:30','10:30','事假','早间请假'),leave('E024',20,'15:00','17:30','病假','下午部分请假'),
    leave('E031',22,'08:30','17:30','年假','全天年假'),leave('E038',27,'08:30','12:00','调休假','上午请假'),leave('E046',30,'14:00','17:30','事假','下午请假'),
    leave('E002',21,'10:00','12:00','事假','短时请假'),leave('E018',28,'08:30','14:30','病假','跨午间请假'),leave('E035',15,'14:00','17:30','年假','下午年假')
  ];
  const trips=[
    trip('E005',8,9,'客户现场','武汉','两日出差'),trip('E011',19,20,'项目联调','成都','研发联调出差'),trip('E011',23,23,'演示出差','市内','全轨道演示出差'),trip('E011',24,24,'演示出差','市内','全轨道演示出差'),trip('E014',13,13,'外出会议','上海','全天会议'),
    trip('E021',19,21,'项目出差','成都','三日项目'),trip('E029',23,23,'现场支持','宜昌','全天支持'),trip('E041',26,27,'供应商拜访','深圳','两日拜访'),
    trip('E049',30,30,'培训','杭州','全天培训'),trip('E008',27,28,'客户验收','长沙','两日验收'),trip('E033',12,13,'技术交流','南京','两日交流')
  ];
  const outings=[
    outing('E011',16,16,'10:10','11:45','外出办事','园区服务中心'),outing('E011',23,23,'14:20','16:10','客户沟通','市内客户现场'),outing('E011',24,24,'14:10','16:00','演示外出','全轨道演示外出'),
    outing('E004',12,12,'09:35','11:10','材料送检','检测中心'),outing('E009',15,15,'15:05','16:40','商务外出','合作单位'),
    outing('E017',20,20,'10:00','12:00','现场协调','生产现场'),outing('E026',22,22,'13:40','16:20','设备验收','供应商工厂'),
    outing('E032',29,29,'09:10','11:50','银行业务','政务中心'),outing('E044',14,14,'14:15','17:00','会议外出','集团总部'),
    outing('E050',28,28,'08:50','10:20','样品递送','客户现场')
  ];
  const overtimeEntries=[
    overtimeEntry('E011',23,'18:05','20:20','项目加班','全轨道演示加班'),overtimeEntry('E011',24,'18:05','21:10','项目加班','版本联调'),overtimeEntry('E011',10,'17:45','20:20','周末加班','发布准备'),
    overtimeEntry('E006',17,'18:00','20:30','研发加班','算法验证'),overtimeEntry('E015',25,'09:00','15:30','周末加班','生产支持'),
    overtimeEntry('E023',21,'18:10','22:00','项目加班','现场问题处理'),overtimeEntry('E034',30,'18:00','20:15','月末加班','数据收尾'),
    overtimeEntry('E042',18,'09:20','17:10','周末加班','设备维护'),overtimeEntry('E047',29,'18:15','21:45','研发加班','测试收口')
  ];
  // Add a denser cross-section so one screen can exercise all business rails and filters.
  for(let i=1;i<=50;i+=6){const id='E'+String(i).padStart(3,'0'),d=8+(i*3)%19;leaves.push(leave(id,d,'14:00','17:30','事假','演示批量请假'))}
  for(let i=2;i<=50;i+=8){const id='E'+String(i).padStart(3,'0'),d=9+(i*5)%17;trips.push(trip(id,d,Math.min(30,d+1),'项目出差','外地','演示批量出差'))}
  for(let i=4;i<=50;i+=7){const id='E'+String(i).padStart(3,'0'),d=11+(i*4)%17;outings.push(outing(id,d,d,'09:40','11:20','外出办事','演示批量外出'))}
  for(let i=5;i<=50;i+=7){const id='E'+String(i).padStart(3,'0'),d=12+(i*5)%18;overtimeEntries.push(overtimeEntry(id,d,'18:05','20:40','项目加班','演示批量加班'))}
  return {records,leaves,trips,outings,overtimeEntries};
}
function plusSeconds(t,s){let [h,m,ss]=t.split(':').map(Number);let x=h*3600+m*60+ss+s;return `${pad(Math.floor(x/3600)%24)}:${pad(Math.floor(x%3600/60))}:${pad(x%60)}`}
function leave(id,d,start,end,type,note){const e=EMPLOYEES.find(x=>x.id===id);return {id:`L-${id}-${d}`,employeeId:id,name:e.name,date:isoDate(d),start,end,type,note}}
function trip(id,ds,de,type,place,note){const e=EMPLOYEES.find(x=>x.id===id);return {id:`T-${id}-${ds}`,employeeId:id,name:e.name,startDate:isoDate(ds),endDate:isoDate(de),type,place,note,source:'模拟出差_2026年10月.xlsx',row:5000+ds+Number(id.slice(1))*10}}
function outing(id,ds,de,start,end,type,note){const e=EMPLOYEES.find(x=>x.id===id);return {id:`O-${id}-${ds}-${start}`,employeeId:id,name:e.name,startDate:isoDate(ds),endDate:isoDate(de),start,end,type,note,source:'模拟外出_2026年10月.xlsx',row:6000+ds+Number(id.slice(1))*10}}
function overtimeEntry(id,d,start,end,type,note){const e=EMPLOYEES.find(x=>x.id===id);return {id:`OT-${id}-${d}-${start}`,employeeId:id,name:e.name,date:isoDate(d),start,end,type,note,source:'模拟加班_2026年10月.xlsx',row:7000+d+Number(id.slice(1))*10}}
