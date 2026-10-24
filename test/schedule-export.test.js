import test from 'node:test';
import assert from 'node:assert/strict';
import {ScheduleStore} from '../src/schedule-store.js';
import {scheduleQuery,selectedScheduleEvents} from '../src/schedule-query.js';
import {scheduleExport,foldCalendarLine} from '../src/schedule-export.js';

const input=(extra={})=>({title:'セッション',date:'2026/10/17',time:'20:00-23:00',place:'VC',description:'夜の部',...extra});
const unfold=buffer=>buffer.toString('utf8').replace(/\r\n /g,'');
async function calendar(inputs){const store=new ScheduleStore(),id=await store.create('予定表');for(const item of inputs)await store.putEvent(id,null,input(item));return store.calendar(id);}

test('calendar search combines normalized terms across fields and months inside one calendar',async()=>{
  const c=await calendar([{title:'ＴＲＰＧ',place:'ＶＣ１'},{title:'TRPG',date:'2027/01/01',place:'VC2'},{title:'別の卓',description:'TRPG VC1'}]);
  assert.equal(scheduleQuery('  ＴＲＰＧ　 VC１  '),'trpg vc1');
  assert.deepEqual(selectedScheduleEvents(c,{query:'trpg vc1',month:'2028-01',date:'2028-01-01'}).map(e=>e.id),[c.events[0].id,c.events[2].id]);
  assert.equal(selectedScheduleEvents(c,{query:'trpg'}).length,3);
  assert.equal(selectedScheduleEvents(c,{month:'2027-01'}).length,1);
  assert.equal(selectedScheduleEvents(c,{month:'2026-10',date:'2026-10-17'}).length,2);
  assert.equal(selectedScheduleEvents(c,{query:'not present'}).length,0);
  assert.throws(()=>scheduleQuery('x'.repeat(81)));assert.throws(()=>scheduleQuery('\u200b'));
});

test('iCalendar emits UTC for JST and overnight times, exclusive all-day end dates and no invented end time',async()=>{
  const c=await calendar([{time:'23:00-01:00'},{time:'',date:'2028/02/29'},{time:'00:15',date:'2000/01/01'},{time:'',date:'2099/12/31'}]);
  const raw=unfold(scheduleExport(c,c.events,{now:Date.parse('2026-10-19T00:00:00Z')}));
  assert.ok(raw.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(raw.endsWith('END:VCALENDAR\r\n'));
  assert.match(raw,/DTSTART:20261017T140000Z\r\nDTEND:20261017T160000Z/);
  assert.match(raw,/DTSTART;VALUE=DATE:20280229\r\nDTEND;VALUE=DATE:20280301/);
  assert.match(raw,/DTSTART;VALUE=DATE:20991231\r\nDTEND;VALUE=DATE:21000101/);
  const items=raw.split('BEGIN:VEVENT\r\n').slice(1);
  assert.match(items[2],/DTSTART:19991231T151500Z/);assert.ok(!items[2].split('END:VEVENT')[0].includes('DTEND'));
  assert.equal((raw.match(/DTSTAMP:20261019T000000Z/g)||[]).length,4);
  assert.equal((raw.match(/UID:/g)||[]).length,4);
});

test('iCalendar escapes content injection, folds UTF-8 by octets and round-trips every character',async()=>{
  const title='🌕日本語;予定,\\'.repeat(6),description='説明\r\nBEGIN:VALARM\r\nACTION:DISPLAY\nEND:VALARM;値,\\';
  const c=await calendar([{title,description}]);const buffer=scheduleExport(c,c.events),raw=unfold(buffer);
  assert.ok(!buffer.toString().includes('\ufffd'));
  assert.match(raw,/DESCRIPTION:説明\\nBEGIN:VALARM\\nACTION:DISPLAY\\nEND:VALARM\\;値\\,\\\\\r\n/);
  assert.equal(raw.split('\r\n').filter(line=>line==='BEGIN:VALARM').length,0);
  for(const line of buffer.toString().split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
  for(const line of ['😀'.repeat(100),'a'.repeat(74)+'界','界'.repeat(25),'\\;'.repeat(150)]){
    const folded=foldCalendarLine(line);assert.equal(folded.replace(/\r\n /g,''),line);
    for(const part of folded.split('\r\n'))assert.ok(Buffer.byteLength(part)<=75);
  }
});

test('export preserves event identity and revisions and includes only supplied selection without persistence',async()=>{
  const store=new ScheduleStore(),id=await store.create('予定表'),other=await store.create('秘密');
  const a=await store.putEvent(id,null,input()),b=await store.putEvent(id,null,input({date:'2027/01/01'}));
  await store.putEvent(other,null,input({title:'他の予定表の秘密'}));
  const before=structuredClone(store.data),c=store.calendar(id);
  const raw=unfold(scheduleExport(c,selectedScheduleEvents(c,{month:'2026-10'})));
  assert.match(raw,new RegExp(`UID:${id}\\.${a}@astral\\.local`));assert.ok(!raw.includes(b));assert.ok(!raw.includes('秘密'));
  assert.deepEqual(store.data,before);
  await store.putEvent(id,a,input({title:'修正'}),0);
  const changed=store.calendar(id),edited=unfold(scheduleExport(changed,changed.events));
  assert.ok(edited.includes(`UID:${id}.${a}@astral.local`));assert.match(edited,/SEQUENCE:1/);
});

test('maximum stored calendar exports within the attachment budget without losing events',async()=>{
  const c=await calendar(Array.from({length:200},(_,n)=>({title:'界'.repeat(80),place:'界'.repeat(100),description:'界'.repeat(500),date:`2026/10/${String(n%28+1).padStart(2,'0')}`})));
  const buffer=scheduleExport(c,c.events);assert.ok(buffer.length<1024*1024);
  assert.equal(unfold(buffer).split('BEGIN:VEVENT\r\n').length-1,200);
});

test('explicit date and month search overlaps periods and overnight tails, with all terms combined',async()=>{
  const c=await calendar([
    {title:'卓 継続',date:'2026/09/30〜2026/10/02',time:''},
    {title:'卓 深夜',date:'2026/10/02',time:'23:00-01:00'},
    {title:'卓 零時終了',date:'2026/10/02',time:'23:00-00:00'},
    {title:'別の予定',date:'2026/10/03'},
    {title:'卓 翌月',date:'2026/11/01'},
  ]);
  const titles=query=>selectedScheduleEvents(c,{query,month:'2099-01',date:'2099-01-01'}).map(e=>e.title);
  assert.deepEqual(titles('日付:2026/10/01 卓'),['卓 継続']);
  assert.deepEqual(titles('日付:2026/10/03 卓'),['卓 深夜']);
  assert.deepEqual(titles('月:2026/10 卓'),['卓 継続','卓 深夜','卓 零時終了']);
  assert.deepEqual(titles('月:2026/10 日付:2026-10-03 卓'),['卓 深夜']);
  assert.deepEqual(titles('月:2026/11 日付:2026-10-03'),[]);
  assert.deepEqual(titles('月：２０２６／１０ 日付：２０２６／１０／０３'),['卓 深夜','別の予定']);
  assert.deepEqual(titles('2026/10/03'),[]); // Bare dates remain literal title/place/description text.
});

test('date search validates leap days and supported years before filtering or exporting',async()=>{
  const c=await calendar([{date:'2028/02/29',time:''},{date:'2000/01/01',time:''},{date:'2099/12/31',time:''}]);
  for(const query of ['日付:2027/02/29','日付:2026/10/32','日付:1999/12/31','日付:2100/01/01','月:2026/13','月:','日付:']){
    assert.throws(()=>scheduleQuery(query));assert.throws(()=>selectedScheduleEvents(c,{query}));
  }
  for(const query of ['日付:2028/02/29','月:2028/02','日付:2000/01/01','月:2099/12'])assert.equal(selectedScheduleEvents(c,{query}).length,1);
  const exportText=unfold(scheduleExport(c,selectedScheduleEvents(c,{query:'月:2028/02'})));
  assert.equal((exportText.match(/BEGIN:VEVENT/g)??[]).length,1);assert.ok(exportText.includes('DTSTART;VALUE=DATE:20280229'));
});
