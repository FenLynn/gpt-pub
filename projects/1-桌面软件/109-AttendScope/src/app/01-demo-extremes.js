/* Deterministic synthetic evidence. Never add these records to a Work project. */
'use strict';
const P109_EXTREME_NAMES=['隔夜连续','登记隔夜','加班临界','外出临界','午间连刷','早退秒差','午间分段','缺卡未知','午夜临界','密集宽幅'];
for(let i=0;i<P109_EXTREME_NAMES.length;i++){
 const person=EMPLOYEES[40+i];person.name='极测'+pad(i+1)+'·'+P109_EXTREME_NAMES[i];person.department='极端测试';person.demoExtreme=true;
 state.groups[person.id]='极端测试组';
}
state.groupCatalog.push('极端测试组');
function p109ExtremeDemo(data){
 const people=EMPLOYEES.filter(e=>e.demoExtreme),ids=new Set(people.map(e=>e.id));
 for(const key of ['leaves','trips','outings','overtimeEntries'])data[key]=data[key].filter(r=>!ids.has(r.employeeId));
 const base=[['08:20:00','进'],['11:40:30','出'],['13:25:00','进'],['17:10:00','出']],cases=[];
 const set=(id,day,events,label)=>{cases.push({id,day,events,label})};
 const mid=enter=>[base[0],['10:00:00','出'],[enter,'进'],...base.slice(1)];
 set('E041',8,[...base,['21:00:00','进']],'隔夜连续：21:00–次日02:15');
 set('E041',9,[['02:15:00','出'],...base],'隔夜连续：凌晨出卡');
 set('E042',12,[...base,['21:30:00','进']],'登记隔夜与推算扣重');
 set('E042',13,[['02:10:00','出'],...base],'登记隔夜与推算扣重');
 data.overtimeEntries.push(overtimeEntry('E042',12,'22:00','02:00','极端测试','登记隔夜，与实际会话扣重'));
 for(const [day,time,label] of [[8,'17:30:00','加班恰好20分钟'],[9,'17:29:59','加班不足20分钟差1秒'],[12,'17:30:01','加班超过门槛1秒']])set('E043',day,[...base.slice(0,3),[time,'出']],label);
 for(const [day,time,label] of [[8,'10:12:00','临时外出恰好12分钟'],[9,'10:12:01','临时外出超过12分钟1秒'],[12,'10:11:59','临时外出不足12分钟1秒']])set('E044',day,mid(time),label);
 set('E044',13,mid('10:20:00'),'20分钟临时外出由报备完整覆盖');
 data.outings.push(outing('E044',13,13,'09:55','10:25','极端测试报备','完整覆盖20分钟外出，以报备为准'));
 set('E045',8,[base[0],['11:39:00','出'],['11:39:05','进'],['11:39:12','出'],['11:39:30','进'],['11:39:42','出'],['11:39:59','进'],['11:40:30','出'],...base.slice(2)],'11:39反复进出，11:40:30正常下班');
 set('E045',9,[base[0],['11:39:00','出'],['11:39:10','出'],['11:39:20','进'],['11:40:30','出'],...base.slice(2)],'午间重复出卡与正常终卡');
 for(const [day,time] of [[8,'11:39:42'],[9,'11:39:42'],[12,'11:28:00'],[13,'11:28:01']])set('E046',day,[base[0],[time,'出'],['13:20:44','进'],base[3]],'临近班末离岗，秒级阈值');
 data.trips.push(trip('E046',9,9,'极端测试出差','测试地点','全天出差覆盖，不重复计18秒临时外出'));
 set('E046',14,[base[0],['11:20:00','出'],['13:20:44','进'],base[3]],'上午缺岗20分钟由报备完整覆盖');
 data.outings.push(outing('E046',14,14,'11:20','11:40','极端测试报备','覆盖缺岗，不判上午早退'));
 for(const day of [8,9])set('E047',day,[base[0],['11:20:00','出'],['13:50:00','进'],base[3]],'跨午休前后各20分钟，独立判色');
 data.outings.push(outing('E047',9,9,'11:18','11:40','极端测试报备','只覆盖上午20分钟'));
 set('E047',12,[base[0],['11:20:00','出'],['13:50:00','进'],base[3]],'出差完整覆盖跨午休两段，不重复判异常');
 data.trips.push(trip('E047',12,12,'极端测试出差','测试地点','跨午休两段均以出差报备为准'));
 set('E048',8,[...base,['23:00:00','进']],'夜间进入但无离开，不捏造加班');
 set('E048',12,[base[0],['10:00:00','出'],['10:10:00','未标注'],['10:20:00','进'],...base.slice(1)],'未知方向打断临时外出配对');
 for(const [day,time] of [[8,'23:50:00'],[19,'23:50:01']]){
  set('E049',day,[...base,[time,'进']],'跨午夜20分钟秒级门槛');set('E049',day+1,[['00:10:00','出'],...base],'跨午夜会话下半段');
 }
 set('E050',8,[base[0],...Array.from({length:120},(_,i)=>[attendanceClock(540+i/6),i%2?'进':'出']),...base.slice(1)],'120次交替打卡，60次10秒外出');
 set('E050',9,[['06:30:00','进'],...base.slice(1,3),['23:20:00','出']],'默认范围向两侧扩展');
 for(const e of people)for(let day=1;day<=monthDays();day++){
  const special=cases.find(c=>c.id===e.id&&c.day===day);if(!special&&!isWorkday(day))continue;
  const label=special?.label||'极端组普通对照日';
  for(const [i,[time,direction]] of (special?.events||base).entries())data.records.push({...rec(e,day,time,direction,label,i+1),source:'极端案例_模拟考勤.xlsx',sheet:'极端测试组'});
 }
 return data;
}
