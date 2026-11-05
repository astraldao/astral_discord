import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ScheduleStore,currentScheduleMonth} from '../src/schedule-store.js';
import {createScheduleHub} from '../src/schedule-hub.js';
const A='100000000000000001',B='100000000000000002',G='200000000000000001',M1='300000000000000001',M2='300000000000000002',M3='300000000000000003',M4='300000000000000004';
async function posted(store,id,channel,month,message){const p=await store.reserve(id,channel,month,undefined,G);await store.complete(p,message);return p;}

test('shared posts behind the Japan-time month move forward while future, current and pending posts stay',async()=>{
  const store=new ScheduleStore(),id=await store.create('共有予定表');
  const past=await posted(store,id,A,'2026-09',M1),current=await posted(store,id,B,'2026-11',M2),future=await posted(store,id,A,'2026-12',M3),pending=await store.reserve(id,B,'2026-10',undefined,G);
  const revision=store.calendar(id).revision;
  assert.deepEqual(await store.followMonth('2026-11'),[past]);
  const month=p=>store.publication(p).month;
  assert.equal(month(past),'2026-11');assert.equal(month(current),'2026-11');assert.equal(month(future),'2026-12');assert.equal(month(pending),'2026-10');
  assert.equal(store.publication(past).messageId,M1);assert.equal(store.publication(past).status,'ready');assert.equal(store.calendar(id).revision,revision);
  assert.deepEqual(await store.followMonth('2026-12'),[current]);assert.equal(month(past),'2026-11');assert.equal(month(future),'2026-12');
  await assert.rejects(store.followMonth('2026/13'));
});

test('a post is left alone when its channel already shows the current month, and no-op checks never rewrite the file',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'follow-month-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'schedules.json'),store=await new ScheduleStore(path).load(),id=await store.create('同じチャンネル');
  const old=await posted(store,id,A,'2026-10',M1),now=await posted(store,id,A,'2026-11',M2),other=await posted(store,id,B,'2026-10',M4);
  let changes=0;store.changed=()=>changes++;
  assert.deepEqual(await store.followMonth('2026-11'),[other]);assert.equal(store.publication(old).month,'2026-10');assert.equal(store.publication(now).month,'2026-11');assert.equal(changes,1);
  const saved=await readFile(path,'utf8');
  assert.deepEqual(await store.followMonth('2026-11'),[]);assert.equal(changes,0+1);assert.equal(await readFile(path,'utf8'),saved);
  assert.equal(JSON.parse(saved).calendars[0].publications.find(p=>p.id===other).month,'2026-11');
  const loaded=await new ScheduleStore(path).load();assert.equal(loaded.publication(other).month,'2026-11');
});

test('the hub refreshes every registered server after moving months and stops once closed',async()=>{
  const core=new ScheduleStore(),hub=await createScheduleHub({primary:G,core,registered:()=>true}).load(),id=await core.create('メイン');
  const p=await posted(core,id,A,'2026-10',M1);await hub.refresh();
  let refreshed=0;hub.register(G,async()=>{refreshed++;return {updated:1,failed:0};});
  assert.deepEqual(await hub.followMonth('2026-11'),[p]);await hub.refresh();assert.ok(refreshed>=1);assert.equal(hub.view(G).publication(p).month,'2026-11');
  refreshed=0;assert.deepEqual(await hub.followMonth('2026-11'),[]);
  await hub.close();assert.deepEqual(await hub.followMonth('2027-01'),[]);assert.equal(core.publication(p).month,'2026-11');
});

test('the current schedule month uses Japan time across the month boundary',()=>{
  assert.equal(currentScheduleMonth(Date.parse('2026-10-31T14:59:59Z')),'2026-10');
  assert.equal(currentScheduleMonth(Date.parse('2026-10-31T15:00:00Z')),'2026-11');
  assert.equal(currentScheduleMonth(Date.parse('2026-12-31T15:00:00Z')),'2027-01');
});
