import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {inflateSync} from 'node:zlib';
import {ScheduleStore,scheduleEvent,scheduleEventDates,scheduleInputDate,scheduleEventEndDate} from '../src/schedule-store.js';
import {selectedScheduleEvents} from '../src/schedule-query.js';
import {scheduleExport} from '../src/schedule-export.js';
import {calendarLayout,calendarImage,calendarAlt} from '../src/calendar-image.js';
const input=(extra={})=>({title:'連休',date:'2026/10/14',time:'',place:'サーバー',description:'予定の説明',...extra});
const period=(extra={})=>input({date:'2026/10/14〜2026/10/18',...extra});
async function tempStore(fn){const dir=await mkdtemp(join(tmpdir(),'astral-period-'));try{const path=join(dir,'schedules.json'),store=new ScheduleStore(path),id=await store.create('予定表');return await fn({store,id,path,dir});}finally{await rm(dir,{recursive:true,force:true});}}

test('period input normalizes explicit dates and inclusive ranges without changing legacy single-day values',()=>{
  assert.deepEqual(scheduleEventDates('2026/10/14'),{date:'2026-10-14'});
  for(const separator of ['〜','～','~'])assert.deepEqual(scheduleEventDates(`2026/10/14 ${separator} 2026/10/18`),{date:'2026-10-14',endDate:'2026-10-18'});
  assert.deepEqual(scheduleEventDates('2026/10/14〜2026/10/14'),{date:'2026-10-14'});
  assert.deepEqual(scheduleEventDates('2026/10/01','2026/10/31'),{date:'2026-10-01',endDate:'2026-10-31'});
  assert.deepEqual(scheduleEventDates('2028/02/29〜2028/03/01'),{date:'2028-02-29',endDate:'2028-03-01'});
  const e=scheduleEvent(period());assert.equal(scheduleInputDate(e),'2026-10-14〜2026-10-18');assert.equal(scheduleEventEndDate(e),'2026-10-18');
  assert.equal(scheduleInputDate(scheduleEvent(input())),'2026-10-14');assert.equal(scheduleEventEndDate(scheduleEvent(input())),'2026-10-14');
});
test('period input refuses reversed, oversized, incomplete, conflicting and nonexistent ranges',()=>{
  for(const date of ['2026/10/14〜2026/10/13','2026/10/01〜2026/11/01','2026/02/29〜2026/03/01','2026/10/14〜','〜2026/10/14','2026/10/14〜2026/10/15〜2026/10/16','2099/12/31〜2100/01/01'])assert.throws(()=>scheduleEventDates(date));
  assert.throws(()=>scheduleEventDates('2026/10/14〜2026/10/18','2026/10/19'));
  assert.throws(()=>scheduleEventDates('2026/10/14',null));
});
test('multi-day schedules require all-day times while single-day and overnight events keep their semantics',()=>{
  assert.equal(scheduleEvent(period()).start,null);
  for(const time of ['09:00','09:00-10:00','23:00-01:00'])assert.throws(()=>scheduleEvent(period({time})),/終日/);
  assert.deepEqual(scheduleEvent(input({date:'2026/10/14〜2026/10/14',time:'23:00-01:00'})),{title:'連休',date:'2026-10-14',start:1380,end:1500,place:'サーバー',description:'予定の説明'});
});
test('version-one calendars persist ranges alongside old single-day events and keep private file permissions',()=>tempStore(async({store,id,path,dir})=>{
  await store.putEvent(id,null,input());await store.putEvent(id,null,period());const loaded=await new ScheduleStore(path).load(),events=loaded.calendar(id).events;
  assert.equal(events.length,2);assert.equal(Object.hasOwn(events[0],'endDate'),false);assert.equal(events[1].endDate,'2026-10-18');
  assert.equal(JSON.parse(await readFile(path,'utf8')).version,1);assert.equal((await stat(path)).mode&0o777,0o600);assert.deepEqual(await readdir(dir),['schedules.json']);
}));
test('loading persisted ranges rejects invalid dates, timing, types and noncanonical boundaries',()=>tempStore(async({store,id,path})=>{
  await store.putEvent(id,null,period());const good=JSON.parse(await readFile(path,'utf8'));
  for(const change of [{endDate:null},{endDate:20261018},{endDate:'2026/10/18'},{endDate:'2026-10-14'},{endDate:'2026-10-13'},{endDate:'2026-11-14'},{endDate:'2026-02-30'},{start:600,end:660}]){const bad=structuredClone(good);Object.assign(bad.calendars[0].events[0],change);await writeFile(path,JSON.stringify(bad));await assert.rejects(new ScheduleStore(path).load());}
}));
test('editing a range into a single day removes endDate without changing event identity',()=>tempStore(async({store,id,path})=>{
  const eventId=await store.putEvent(id,null,period());await store.putEvent(id,eventId,input({date:'2026/11/01',time:'20:00-23:00'}),0);
  const saved=store.calendar(id).events[0];assert.equal(saved.id,eventId);assert.equal(saved.revision,1);assert.equal(saved.date,'2026-11-01');assert.equal(Object.hasOwn(saved,'endDate'),false);
  assert.equal(Object.hasOwn((await new ScheduleStore(path).load()).calendar(id).events[0],'endDate'),false);
}));
test('month and date selections include intersecting ranges once and search still stays in the selected calendar',async()=>{
  const store=new ScheduleStore(),id=await store.create('公開'),privateId=await store.create('秘密');
  await store.putEvent(id,null,period({date:'2026/09/29〜2026/10/03'}));await store.putEvent(id,null,period({date:'2026/10/30〜2026/11/02',title:'後半'}));await store.putEvent(id,null,input({date:'2026/10/14',title:'単日'}));await store.putEvent(privateId,null,input({title:'秘密'}));
  const c=store.calendar(id);assert.equal(selectedScheduleEvents(c,{month:'2026-10'}).length,3);assert.equal(selectedScheduleEvents(c,{month:'2026-09'}).length,1);assert.equal(selectedScheduleEvents(c,{month:'2026-11'}).length,1);assert.equal(selectedScheduleEvents(c,{month:'2026-12'}).length,0);
  assert.equal(selectedScheduleEvents(c,{month:'2026-10',date:'2026-10-01'}).length,1);assert.equal(selectedScheduleEvents(c,{date:'2026-10-04'}).length,0);assert.equal(selectedScheduleEvents(c,{date:'2026-11-02'}).length,1);
  assert.equal(selectedScheduleEvents(c,{query:'連休 サーバー',month:'2099-01'}).length,1);assert.equal(selectedScheduleEvents(c,{query:'秘密'}).length,0);
});
test('ICS exports one range event with an exclusive last-day boundary across years',async()=>{
  const store=new ScheduleStore(),id=await store.create('予定表');await store.putEvent(id,null,period({date:'2026/12/30〜2027/01/02'}));await store.putEvent(id,null,period({date:'2099/12/30〜2099/12/31'}));
  const c=store.calendar(id),raw=scheduleExport(c,c.events).toString().replace(/\r\n /g,'');assert.match(raw,/DTSTART;VALUE=DATE:20261230\r\nDTEND;VALUE=DATE:20270103/);assert.match(raw,/DTSTART;VALUE=DATE:20991230\r\nDTEND;VALUE=DATE:21000101/);assert.equal((raw.match(/BEGIN:VEVENT/g)||[]).length,2);assert.equal((raw.match(/UID:/g)||[]).length,2);assert.ok(!raw.includes('RRULE'));assert.ok(!raw.includes('VALARM'));
});
test('calendar grids count range events once while every covered day has correct items and selected-day metadata',()=>{
  const e={id:'holiday',...scheduleEvent(period({date:'2026/09/29〜2026/10/03'}))},single={id:'single',...scheduleEvent(input({date:'2026/10/02'}))};
  const g=calendarLayout('2026-10',[e,single],'2026-10-02','2026-10-03');assert.equal(g.count,2);assert.equal(g.cells[0].items.length,1);assert.equal(g.cells[1].items.length,2);assert.equal(g.cells[2].items.length,1);assert.equal(g.cells[3].items.length,0);assert.equal(g.cells[2].selected,true);
  assert.equal(g.spans.find(s=>s.event.id==='holiday').col,4);assert.equal(g.spans.find(s=>s.event.id==='holiday').endCol,6);assert.equal(g.spans.find(s=>s.event.id==='holiday').continuesBefore,true);assert.match(calendarAlt(g),/2026-09-29〜2026-10-03/);
});
test('weekly range bands preserve lanes across each covered day without obscuring other visible bands',()=>{
  const events=[{id:'period',...scheduleEvent(period({date:'2026/10/02〜2026/10/06'}))},{id:'one',...scheduleEvent(input({date:'2026/10/03',title:'同日の予定'}))}];
  const g=calendarLayout('2026-10',events),spans=g.spans.filter(s=>s.event.id==='period');assert.equal(spans.length,2);assert.deepEqual(spans.map(s=>[s.row,s.col,s.endCol]),[[0,5,6],[1,0,2]]);assert.equal(spans[0].continuesAfter,true);assert.equal(spans[1].continuesBefore,true);
  for(const c of g.cells){const cover=g.spans.filter(s=>s.row===c.row&&s.col<=c.col&&s.endCol>=c.col);assert.equal(new Set(cover.map(s=>s.lane)).size,cover.length);assert.equal(c.hidden+cover.length,c.items.length);}
});
test('dense full-month ranges have honest overflow counts and bounded PNG output',()=>{
  const events=Array.from({length:200},(_,n)=>({id:`range-${n}`,title:`連休${n}`,date:'2026-10-01',endDate:'2026-10-31',start:null,end:null})),result=calendarImage('2026-10',events,{selectedDate:'2026-10-14'});
  assert.equal(result.layout.count,200);assert.ok(result.layout.cells.every(c=>c.items.length===200&&c.hidden===197));assert.equal(result.width,840);assert.ok(result.buffer.length<150000);assert.ok(calendarAlt(result.layout).length<=1024);
  const reversed=calendarImage('2026-10',[...events].reverse(),{selectedDate:'2026-10-14'});assert.deepEqual(result.buffer,reversed.buffer);
});
test('a continuous period band is drawn across the gap between adjacent day cells',()=>{
  const {buffer,width}=calendarImage('2026-10',[{id:'range',...scheduleEvent(period({date:'2026/10/04〜2026/10/06'}))}]);
  let position=8,palette,parts=[];while(position<buffer.length){const length=buffer.readUInt32BE(position),kind=buffer.toString('ascii',position+4,position+8);if(kind==='PLTE')palette=buffer.subarray(position+8,position+8+length);if(kind==='IDAT')parts.push(buffer.subarray(position+8,position+8+length));position+=length+12;}
  const raw=inflateSync(Buffer.concat(parts)),y=118+142+40+20,row=raw.subarray(y*(width+1),(y+1)*(width+1)),indices=new Uint8Array(width);assert.equal(row[0],1);for(let x=0;x<width;x++)indices[x]=(row[x+1]+(x?indices[x-1]:0))&255;const at=x=>Array.from(palette.subarray(indices[x]*3,indices[x]*3+3));assert.deepEqual(at(128),at(129));assert.deepEqual(at(129),at(130));assert.notDeepEqual(at(129),[255,255,255]);
});
test('bulk events commit once, return distinct identities, preserve ranges and increment only the calendar revision',async()=>{
  const store=new ScheduleStore(),id=await store.create('予定表');let saves=0;const save=store.save.bind(store);store.save=async data=>{saves++;return save(data);};
  const ids=await store.putEvents(id,[input(),period({title:'複数日'}),input({date:'2026/10/21'})],0),c=store.calendar(id);assert.equal(saves,1);assert.equal(c.revision,1);assert.equal(ids.length,3);assert.equal(new Set(ids).size,3);assert.deepEqual(c.events.map(e=>e.id),ids);assert.ok(c.events.every(e=>e.revision===0));assert.equal(c.events[1].endDate,'2026-10-18');
  const one=await store.putEvents(id,[input({title:'1件'})],1);assert.equal(one.length,1);assert.equal(store.calendar(id).revision,2);
});
test('bulk creation refuses malformed batches and never writes a valid prefix',async()=>{
  const store=new ScheduleStore(),id=await store.create('予定表'),before=store.calendar(id);
  for(const values of [null,[],Array.from({length:27},()=>input()),[input(),input({date:'invalid'})],[input(),period({time:'20:00'})]])await assert.rejects(async()=>store.putEvents(id,values,0));
  assert.deepEqual(store.calendar(id),before);
});
test('stale or concurrently confirmed bulk requests cannot duplicate an entire set',async()=>{
  const store=new ScheduleStore(),id=await store.create('予定表'),values=[input(),input({date:'2026/10/21'})];
  const results=await Promise.allSettled([store.putEvents(id,values,0),store.putEvents(id,values,0)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(store.calendar(id).events.length,2);assert.equal(store.calendar(id).revision,1);
});
test('bulk creation enforces per-calendar and server-wide limits before committing any item',async()=>{
  const store=new ScheduleStore(),ids=[];for(let n=0;n<6;n++)ids.push(await store.create(`予定表${n}`));const e=scheduleEvent(input());
  await store.update(d=>{for(const [n,c] of d.calendars.entries()){c.events=Array.from({length:n<5?200:0},(_,i)=>({id:`c${n}-event-${i}`,revision:0,...e}));}});
  const before=structuredClone(store.data);await assert.rejects(store.putEvents(ids[5],[input()],0));await assert.rejects(store.putEvents(ids[0],[input()],0));assert.deepEqual(store.data,before);
  await store.update(d=>{d.calendars[0].events.length=199;d.calendars[1].events.length=198;});const partial=structuredClone(store.data);await assert.rejects(store.putEvents(ids[0],[input(),input()],0));assert.deepEqual(store.data,partial);assert.equal((await store.putEvents(ids[1],[input(),input()],0)).length,2);
});
test('queued authorization denial preserves disk and memory, and later legitimate bulk saves still work',()=>tempStore(async({store,id,path,dir})=>{
  const before=await readFile(path,'utf8');let release,allowed=true;store.tail=new Promise(resolve=>release=resolve);
  const pending=store.putEvents(id,[input(),period()],0,async()=>{if(!allowed)throw new Error('denied');});allowed=false;release();await assert.rejects(pending,/denied/);assert.equal(await readFile(path,'utf8'),before);assert.equal(store.calendar(id).events.length,0);assert.deepEqual(await readdir(dir),['schedules.json']);
  allowed=true;await store.putEvents(id,[input(),period()],0);assert.equal((await new ScheduleStore(path).load()).calendar(id).events.length,2);
}));
test('failed bulk persistence retains all original data and never returns committed identities',()=>tempStore(async({store,id,path})=>{
  await store.putEvent(id,null,input());const before=await readFile(path,'utf8'),memory=store.calendar(id),save=store.save.bind(store);store.save=async()=>{throw new Error('disk unavailable');};await assert.rejects(store.putEvents(id,[input(),period()],1),/disk/);assert.equal(await readFile(path,'utf8'),before);assert.deepEqual(store.calendar(id),memory);store.save=save;await store.putEvents(id,[input(),period()],1);assert.equal(store.calendar(id).events.length,3);
}));
test('permission loss after initial validation refuses the staged file before rename and cleans it without poisoning the queue',()=>tempStore(async({store,id,path,dir})=>{
  const previous=await readFile(path,'utf8'),before=store.calendar(id),save=store.save.bind(store);let allowed=true;
  store.save=(data,check)=>{allowed=false;return save(data,check);};
  const check=async()=>{if(!allowed)throw new Error('permission lost');};
  await assert.rejects(store.putEvents(id,[input(),period()],0,check),/permission lost/);
  assert.equal(await readFile(path,'utf8'),previous);assert.deepEqual(store.calendar(id),before);assert.deepEqual(await readdir(dir),['schedules.json']);
  allowed=true;store.save=save;await store.putEvents(id,[input(),period()],0,check);assert.equal((await new ScheduleStore(path).load()).calendar(id).events.length,2);
}));
