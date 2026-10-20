import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleWeek,shiftScheduleWeek,scheduleUpcoming,scheduleRange} from '../src/schedule-range.js';
import {scheduleEvent} from '../src/schedule-store.js';
import {selectedScheduleEvents} from '../src/schedule-query.js';

const event=(id,date,time='',extra={})=>({id,revision:0,...scheduleEvent({title:id,date,time,place:'',description:'',...extra})});
const ids=(calendar,options)=>selectedScheduleEvents(calendar,options).map(e=>e.id);

test('weekly ranges run Sunday through Saturday for every day in a known week',()=>{
  for(const date of ['2026-10-11','2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17'])assert.deepEqual(scheduleWeek(date),{rangeStart:'2026-10-11',rangeEnd:'2026-10-17'});
  assert.deepEqual(scheduleWeek('2026/10/18'),{rangeStart:'2026-10-18',rangeEnd:'2026-10-24'});
});
test('weekly navigation crosses month, year and leap-day boundaries without drifting',()=>{
  assert.deepEqual(shiftScheduleWeek('2026-12-31',1),{rangeStart:'2027-01-03',rangeEnd:'2027-01-09'});
  assert.deepEqual(shiftScheduleWeek('2027-01-03',-1),{rangeStart:'2026-12-27',rangeEnd:'2027-01-02'});
  assert.deepEqual(scheduleWeek('2028-02-29'),{rangeStart:'2028-02-27',rangeEnd:'2028-03-04'});
  assert.deepEqual(shiftScheduleWeek('2028-02-29',1),{rangeStart:'2028-03-05',rangeEnd:'2028-03-11'});
  assert.deepEqual(shiftScheduleWeek('2028-03-05',-1),scheduleWeek('2028-02-29'));
});
test('weekly arithmetic remains seven calendar days around daylight-saving dates',()=>{
  assert.deepEqual(shiftScheduleWeek('2026-03-08',1),{rangeStart:'2026-03-15',rangeEnd:'2026-03-21'});
  assert.deepEqual(shiftScheduleWeek('2026-11-01',-1),{rangeStart:'2026-10-25',rangeEnd:'2026-10-31'});
});
test('opening and closing weeks clip to supported dates and navigation stays on an edge week',()=>{
  const first={rangeStart:'2000-01-01',rangeEnd:'2000-01-01'},last={rangeStart:'2099-12-27',rangeEnd:'2099-12-31'};
  assert.deepEqual(scheduleWeek('2000-01-01'),first);assert.deepEqual(shiftScheduleWeek('2000-01-01',-1),first);
  assert.deepEqual(shiftScheduleWeek('2000-01-01',1),{rangeStart:'2000-01-02',rangeEnd:'2000-01-08'});
  assert.deepEqual(shiftScheduleWeek('2000-01-02',-1),first);
  assert.deepEqual(scheduleWeek('2099-12-31'),last);assert.deepEqual(shiftScheduleWeek('2099-12-27',1),last);
  assert.deepEqual(shiftScheduleWeek('2099-12-31',-1),{rangeStart:'2099-12-20',rangeEnd:'2099-12-26'});
});
test('upcoming ranges contain today and the following twenty-nine dates',()=>{
  assert.deepEqual(scheduleUpcoming('2026-10-14'),{rangeStart:'2026-10-14',rangeEnd:'2026-11-12'});
  assert.deepEqual(scheduleUpcoming('2028-02-01'),{rangeStart:'2028-02-01',rangeEnd:'2028-03-01'});
  assert.deepEqual(scheduleUpcoming('2026-12-20'),{rangeStart:'2026-12-20',rangeEnd:'2027-01-18'});
  assert.deepEqual(scheduleUpcoming('2099-12-15'),{rangeStart:'2099-12-15',rangeEnd:'2099-12-31'});
  assert.deepEqual(scheduleUpcoming('2099-12-31'),{rangeStart:'2099-12-31',rangeEnd:'2099-12-31'});
});
test('helpers refuse nonexistent or out-of-bounds dates and invalid week directions',()=>{
  for(const fn of [scheduleWeek,scheduleUpcoming])for(const date of ['1999-12-31','2100-01-01','2026-02-29','2026-04-31','2026-00-01','2026-10-00','2026-10-14T00:00:00Z',undefined,null])assert.throws(()=>fn(date));
  for(const amount of [0,2,-2,0.5,Infinity,'1',undefined])assert.throws(()=>shiftScheduleWeek('2026-10-14',amount));
  assert.throws(()=>shiftScheduleWeek('2026-02-29',1));
});
test('an explicit range requires valid ordered boundaries and normalizes accepted date separators',()=>{
  assert.deepEqual(scheduleRange('2026/10/14','2026/10/14'),{rangeStart:'2026-10-14',rangeEnd:'2026-10-14'});
  for(const range of [['2026-10-15','2026-10-14'],['2026-02-29','2026-03-01'],['2026-10-14',undefined],[undefined,'2026-10-14']])assert.throws(()=>scheduleRange(...range));
});
test('range selection includes intersecting all-day periods exactly once',()=>{
  const calendar={events:[event('carry-in','2026/10/09〜2026/10/12'),event('inside','2026/10/14'),event('carry-out','2026/10/17〜2026/10/20'),event('enclosing','2026/10/01〜2026/10/31'),event('before','2026/10/10'),event('after','2026/10/18')]};
  assert.deepEqual(ids(calendar,scheduleWeek('2026-10-14')),['enclosing','carry-in','inside','carry-out']);
  assert.equal(new Set(ids(calendar,scheduleWeek('2026-10-14'))).size,4);
});
test('range boundaries include midnight-start events but exclude midnight-end carry-ins',()=>{
  const calendar={events:[event('midnight-end','2026/10/10','23:00-00:00'),event('overnight','2026/10/10','23:00-00:01'),event('midnight-start','2026/10/11','00:00-01:00'),event('point-before','2026/10/10','23:59'),event('point-inside','2026/10/11','00:00'),event('after','2026/10/12','00:00')]};
  assert.deepEqual(ids(calendar,{rangeStart:'2026-10-11',rangeEnd:'2026-10-11'}),['overnight','midnight-start','point-inside']);
});
test('overnight carry-ins cross month and year boundaries for range views',()=>{
  const calendar={events:[event('month-carry','2026/10/31','23:30-00:30'),event('year-carry','2026/12/31','23:00-01:00'),event('final','2099/12/31','23:00-01:00')]};
  assert.deepEqual(ids(calendar,{rangeStart:'2026-11-01',rangeEnd:'2026-11-01'}),['month-carry']);
  assert.deepEqual(ids(calendar,{rangeStart:'2027-01-01',rangeEnd:'2027-01-01'}),['year-carry']);
  assert.deepEqual(ids(calendar,scheduleUpcoming('2099-12-31')),['final']);
});
test('upcoming selection excludes yesterday-only and day-thirty events',()=>{
  const calendar={events:[event('past','2026/10/13'),event('ongoing','2026/10/10〜2026/10/14'),event('today','2026/10/14'),event('last','2026/11/12'),event('too-late','2026/11/13')]};
  assert.deepEqual(ids(calendar,scheduleUpcoming('2026-10-14')),['ongoing','today','last']);
});
test('range scope overrides stale month and day filters while empty query preserves the range',()=>{
  const calendar={events:[event('wanted','2026/10/14'),event('outside','2026/12/01')]};
  assert.deepEqual(ids(calendar,{month:'2099-01',date:'2099-01-01',query:' ',...scheduleWeek('2026-10-14')}),['wanted']);
});
test('nonempty searches keep whole-calendar AND matching and ignore current range state',()=>{
  const calendar={events:[event('outside-match','2026/12/01','',{title:'冬 セッション',place:'VC'}),event('inside-incomplete','2026/10/14','',{title:'セッション',place:'会議室'})]};
  assert.deepEqual(ids(calendar,{query:'セッション ＶＣ',...scheduleWeek('2026-10-14')}),['outside-match']);
  assert.deepEqual(ids(calendar,{query:'セッション ＶＣ',rangeStart:'invalid',rangeEnd:'invalid'}),['outside-match']);
  assert.deepEqual(ids(calendar,{query:'秘密'}),[]);
});
test('legacy month and day filters retain their previous overnight semantics',()=>{
  const calendar={events:[event('overnight','2026/10/31','23:00-01:00'),event('period','2026/10/30〜2026/11/02'),event('november','2026/11/01')]};
  assert.deepEqual(ids(calendar,{month:'2026-11'}),['period','november']);
  assert.deepEqual(ids(calendar,{date:'2026-11-01'}),['period','november']);
  assert.deepEqual(ids(calendar,{month:'2026-10',date:'2026-10-31'}),['period','overnight']);
});
test('range selection is deterministic, sorted and does not mutate calendar events',()=>{
  const calendar={events:[event('late','2026/10/14','20:00'),event('same-b','2026/10/14','10:00',{title:'同時刻'}),event('all-day','2026/10/14'),event('same-a','2026/10/14','10:00',{title:'同時刻'}),event('early','2026/10/13','23:30-00:30')]},before=structuredClone(calendar);
  assert.deepEqual(ids(calendar,scheduleWeek('2026-10-14')),['early','all-day','same-a','same-b','late']);
  assert.deepEqual(ids({events:[...calendar.events].reverse()},scheduleWeek('2026-10-14')),ids(calendar,scheduleWeek('2026-10-14')));
  assert.deepEqual(calendar,before);
});
test('malformed range selection rejects rather than silently broadening to the entire calendar',()=>{
  const calendar={events:[event('private','2026/10/14')]};
  for(const range of [{rangeStart:'2026-10-14'},{rangeEnd:'2026-10-14'},{rangeStart:'2026-10-15',rangeEnd:'2026-10-14'},{rangeStart:null,rangeEnd:null}])assert.throws(()=>selectedScheduleEvents(calendar,range));
});
