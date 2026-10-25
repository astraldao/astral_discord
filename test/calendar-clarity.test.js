import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarImage} from '../src/calendar-image.js';
import {ScheduleStore} from '../src/schedule-store.js';
import {scheduleScreen} from '../src/schedule-ui.js';

const event=(id,date,extra={})=>({id,title:id,date,start:null,end:null,...extra});
const body=m=>m.embeds.map(e=>e.toJSON().description).join('\n');
const controls=m=>m.components.flatMap(r=>r.toJSON().components);
const input=(title,date='2026/10/14',time='')=>({title,date,time,place:'',description:''});
async function fixture(){
  const store=new ScheduleStore(),id=await store.create('予定表');
  const s={id:'session',scope:'viewer',calendarId:id,view:'list',month:'2026-10',today:'2026-10-14',display:'list',page:0,turn:0};
  return {store,id,s,add:(title,date,time)=>store.putEvent(id,null,input(title,date,time)),screen:()=>scheduleScreen(s,store)};
}

test('crowded and all-day cards keep their metadata and a real time change alters the rendered PNG',()=>{
  const events=[event('終日の予定','2026-10-14'),event('時刻付き','2026-10-14',{start:1200}),event('遅い予定','2026-10-14',{start:1320}),event('別の週','2026-10-23'),event('翌月','2026-11-01')];
  const before=structuredClone(events),image=calendarImage('2026-10',events),changed=calendarImage('2026-10',events.map(e=>e.id==='時刻付き'?{...e,start:1260}:e));
  assert.equal(image.geometry.weeks[2].rich,false);assert.equal(image.geometry.weeks[2].timed,true);assert.equal(image.geometry.weeks[3].timed,true);assert.equal(image.geometry.weeks[5].timed,true);assert.equal(image.geometry.weeks[0].timed,false);
  for(const span of [...image.layout.spans,...image.layout.contextSpans]){const week=image.geometry.weeks[span.row];assert.ok(week.bandHeight>=46);assert.ok(week.bandTop+span.lane*week.laneGap+week.bandHeight<week.height);}
  assert.notDeepEqual(image.buffer,changed.buffer);assert.deepEqual(events,before);assert.equal(image.layout.count,4);assert.equal(image.layout.rangeEnd,'2026-11-07');
});

test('title excerpts stay within 228px without dropping plans or changing honest overflow counts',()=>{
  for(const month of ['2026-08','2026-10','2028-02']){
    const events=Array.from({length:200},(_,n)=>event(`長い予定名${n}`.repeat(8),`${month}-${String(n%28+1).padStart(2,'0')}`,{start:n%1440})),before=structuredClone(events),image=calendarImage(month,events);
    assert.equal(image.geometry.titleKeyCount,3);assert.ok(image.geometry.shortenedCount>3);assert.ok(image.geometry.keyHeight<=228);assert.equal(image.layout.count,200);assert.equal(image.layout.cells.reduce((n,c)=>n+c.hidden,0),200-image.layout.spans.length);assert.ok(image.height<1800);assert.ok(image.buffer.length<150000);assert.deepEqual(events,before);
  }
  const two=calendarImage('2026-10',[event('長'.repeat(80),'2026-10-14'),event('名'.repeat(80),'2026-10-15')]);assert.equal(two.geometry.titleKeyCount,2);assert.equal(two.geometry.keyHeight,172);
});

test('a daily text list groups repeated dates while preserving full names, times and pagination',async()=>{
  const f=await fixture(),ids=[];for(let n=0;n<10;n++)ids.push(await f.add(`長い共通の接頭辞を持つセッション${n}`,undefined,`${String(10+n).padStart(2,'0')}:00`));
  const before=structuredClone(f.store.data);f.s.date='2026-10-14';
  let m=f.screen();assert.equal((body(m).match(/10\/14/g)??[]).length,1);assert.ok(body(m).includes('**10:00** · 長い共通の接頭辞を持つセッション0'));assert.match(body(m),/1\/2ページ/);
  const first=controls(m).find(c=>c.custom_id?.endsWith(':event')).options.map(o=>o.value);assert.equal(first.length,8);f.s.page=1;m=f.screen();const last=controls(m).find(c=>c.custom_id?.endsWith(':event')).options.map(o=>o.value);assert.equal(last.length,2);assert.deepEqual([...first,...last],ids);
  assert.ok(body(m).includes('セッション9'));assert.ok(body(m).includes('**19:00**'));assert.equal(m.files,undefined);assert.deepEqual(f.store.data,before);
});

test('different multi-day ranges retain separate headings and overnight times retain the next-day marker',async()=>{
  const f=await fixture();await f.add('短い期間','2026/10/14〜2026/10/15');await f.add('長い期間','2026/10/14〜2026/10/16');await f.add('深夜','2026/10/14','23:00-01:00');
  const m=f.screen(),text=body(m);assert.match(text,/10\/15/);assert.match(text,/10\/16/);assert.match(text,/23:00〜翌日 01:00/);assert.equal((text.match(/\*\*終日\*\*/g)??[]).length,2);assert.ok(!text.includes('期間前から続く予定'));
  Object.assign(f.s,{period:'week',rangeStart:'2026-10-15',rangeEnd:'2026-10-21'});const week=body(f.screen());assert.equal((week.match(/期間前から続く予定/g)??[]).length,3);assert.match(week,/2026年/);
});

test('grouped lists keep literal names safe and never borrow context or another calendar',async()=>{
  const f=await fixture(),name='**共通** <@123456789012345678>';await f.add(name);await f.add('翌月だけの予定','2026/11/01');const other=await f.store.create('他人の予定');await f.store.putEvent(other,null,input('秘密'));
  const m=f.screen(),text=body(m);assert.ok(text.includes('\\*\\*共通\\*\\*'));assert.ok(!text.includes('<@'));assert.ok(!text.includes('翌月だけの予定'));assert.ok(!text.includes('秘密'));assert.deepEqual(m.allowedMentions.parse,[]);assert.ok(m.components.length<=5);assert.ok(m.embeds.every(e=>e.toJSON().description.length<=4096));
});
