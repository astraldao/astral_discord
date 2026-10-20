import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ScheduleStore,planScheduleImport,scheduleEvent} from '../src/schedule-store.js';
const event=(extra={})=>({title:'卓',date:'2026-10-21',time:'20:00-23:00',place:'VC',description:'説明',...extra});
test('import plans ignore exact existing and in-file duplicates while preserving changes to any meaningful field',async()=>{
  const store=new ScheduleStore(),id=await store.create('予定表');await store.putEvent(id,null,event());const c=store.calendar(id),before=structuredClone(c);
  const values=[event(),event({date:'2026/10/22'}),event({date:'2026-10-22'}),event({title:'別名'}),event({time:'20:00'}),event({place:'VC2'}),event({description:'別の説明'})];
  const plan=planScheduleImport(c,values);assert.equal(plan.eventCount,7);assert.equal(plan.existingDuplicates,1);assert.equal(plan.fileDuplicates,1);assert.equal(plan.duplicates,2);assert.equal(plan.events.length,5);assert.deepEqual(c,before);
  values[1].title='変更';plan.events[0].title='別の変更';assert.deepEqual(store.calendar(id),before);
});
test('single-day and range identities stay distinct and normalized event titles compare consistently',async()=>{
  const store=new ScheduleStore(),id=await store.create('予定表');await store.putEvent(id,null,event({title:'ＴＲＰＧ',time:''}));
  const plan=planScheduleImport(store.calendar(id),[event({title:'TRPG',time:''}),event({title:'TRPG',time:'',date:'2026-10-21〜2026-10-22'})]);
  assert.equal(plan.duplicates,1);assert.equal(plan.events.length,1);assert.equal(plan.events[0].endDate,'2026-10-22');
});
test('imports up to 200 events atomically with one revision and one save and rejects replay without changes',async()=>{
  const store=new ScheduleStore(),id=await store.create('予定表');let saves=0;const save=store.save.bind(store);store.save=(...args)=>{saves++;return save(...args);};
  const values=Array.from({length:200},(_,n)=>event({title:`卓${n}`})),result=await store.importEvents(id,values,0);assert.equal(result.added,200);assert.equal(new Set(result.ids).size,200);assert.equal(saves,1);assert.equal(store.calendar(id).revision,1);
  const before=store.calendar(id);await assert.rejects(store.importEvents(id,values,1),/登録済み/);assert.deepEqual(store.calendar(id),before);assert.equal(saves,1);
});
test('imports deduplicate before applying quota and cannot partially save malformed or oversized batches',async()=>{
  const store=new ScheduleStore(),id=await store.create('予定表');
  await store.importEvents(id,Array.from({length:199},(_,n)=>event({title:`卓${n}`})),0);
  const result=await store.importEvents(id,[event({title:'卓0'}),event({title:'新規'}),event({title:'新規'})],1);assert.equal(result.added,1);assert.equal(result.duplicates,2);
  const before=store.calendar(id);
  for(const values of [[],Array.from({length:201},()=>event()),[event(),event({date:'bad'})],[event({title:'超過'})]])await assert.rejects(async()=>store.importEvents(id,values,2));
  assert.deepEqual(store.calendar(id),before);
});
test('import captures input before queueing and only one concurrent confirmation can change a revision',async()=>{
  const store=new ScheduleStore(),id=await store.create('予定表');let release;store.tail=new Promise(r=>release=r);
  const values=[event({title:'最初'})],first=store.importEvents(id,values,0),second=store.importEvents(id,values,0);values[0].title='後から';release();
  const results=await Promise.allSettled([first,second]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(store.calendar(id).events[0].title,'最初');assert.equal(store.calendar(id).events.length,1);
});
test('import checks the global quota without changing another calendar or a valid prefix',async()=>{
  const store=new ScheduleStore(),ids=[];for(let n=0;n<6;n++)ids.push(await store.create(`予定${n}`));
  await store.update(d=>{for(let n=0;n<5;n++)d.calendars[n].events=Array.from({length:200},(_,i)=>({id:`c${n}e${i}`,revision:0,...scheduleEvent(event())}));});
  const before=structuredClone(store.data);await assert.rejects(store.importEvents(ids[5],[event()],0),/上限/);assert.deepEqual(store.data,before);
});
test('late import authorization refusal preserves disk and memory, cleans the stage file, and permits a later valid save',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'astral-import-'));
  try{
    const path=join(dir,'calendar.json'),store=new ScheduleStore(path),id=await store.create('予定表'),before=await readFile(path,'utf8'),save=store.save.bind(store);let allowed=true;
    store.save=(data,check)=>{allowed=false;return save(data,check);};const check=async()=>{if(!allowed)throw new Error('revoked');};
    await assert.rejects(store.importEvents(id,[event()],0,check),/revoked/);assert.equal(await readFile(path,'utf8'),before);assert.equal(store.calendar(id).events.length,0);assert.deepEqual(await readdir(dir),['calendar.json']);
    allowed=true;store.save=save;await store.importEvents(id,[event()],0,check);assert.equal((await new ScheduleStore(path).load()).calendar(id).events.length,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
