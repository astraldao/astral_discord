import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleRecurrence,scheduleRecurrenceOverlapCount,MAX_RECURRENCE_COUNT,scheduleRecurrenceChoices} from '../src/schedule-recurrence.js';
import {scheduleEvent} from '../src/schedule-store.js';
const event=(extra={})=>({id:'source',revision:3,title:'いつもの卓',date:'2026-10-20',start:null,end:null,place:'会議室',description:'持ち物',...extra});
test('daily copies start after the original, cross year boundaries and do not mutate the source',()=>{
  const original=event({date:'2026-12-30'}),before=structuredClone(original),plan=scheduleRecurrence(original,{frequency:'daily',count:3});
  assert.deepEqual(plan.dates,['2026-12-31','2027-01-01','2027-01-02']);assert.equal(plan.label,'毎日');assert.equal(plan.count,3);
  assert.deepEqual(original,before);assert.ok(plan.inputs.every(input=>!Object.hasOwn(input,'id')&&!Object.hasOwn(input,'revision')));
  assert.deepEqual(plan.inputs[0],{title:'いつもの卓',date:'2026-12-31',time:'',place:'会議室',description:'持ち物'});
  plan.inputs[0].title='別の予定';assert.equal(original.title,'いつもの卓');assert.equal(plan.inputs[1].title,'いつもの卓');
});
test('weekly and biweekly copies preserve weekdays over leap days and accept the maximum finite count',()=>{
  assert.deepEqual(scheduleRecurrence(event({date:'2024-02-22'}),{frequency:'weekly',count:3}).dates,['2024-02-29','2024-03-07','2024-03-14']);
  assert.deepEqual(scheduleRecurrence(event({date:'2024-02-22'}),{frequency:'biweekly',count:3}).dates,['2024-03-07','2024-03-21','2024-04-04']);
  const plan=scheduleRecurrence(event(),{frequency:'weekly',count:MAX_RECURRENCE_COUNT});assert.equal(plan.inputs.length,26);assert.equal(plan.dates.at(-1),'2027-04-20');
});
test('monthly copies skip missing days and count created dates instead of skipped months',()=>{
  const plan=scheduleRecurrence(event({date:'2026-01-31'}),{frequency:'monthly',count:7});
  assert.deepEqual(plan.dates,['2026-03-31','2026-05-31','2026-07-31','2026-08-31','2026-10-31','2026-12-31','2027-01-31']);
  assert.equal(plan.inputs.length,7);assert.equal(new Set(plan.dates).size,7);
});
test('monthly day 29 skips non-leap February without drifting later dates',()=>{
  assert.deepEqual(scheduleRecurrence(event({date:'2023-12-29'}),{frequency:'monthly',count:3}).dates,['2024-01-29','2024-02-29','2024-03-29']);
  assert.deepEqual(scheduleRecurrence(event({date:'2024-12-29'}),{frequency:'monthly',count:3}).dates,['2025-01-29','2025-03-29','2025-04-29']);
});
test('all-day ranges keep their inclusive duration when moved across months or leap days',()=>{
  const source=event({date:'2024-02-27',endDate:'2024-03-01'});
  assert.deepEqual(scheduleRecurrence(source,{frequency:'weekly',count:2}).inputs.map(input=>input.date),['2024-03-05〜2024-03-08','2024-03-12〜2024-03-15']);
  const monthly=scheduleRecurrence(event({date:'2026-01-30',endDate:'2026-02-02'}),{frequency:'monthly',count:2});
  assert.deepEqual(monthly.inputs.map(input=>input.date),['2026-03-30〜2026-04-02','2026-04-30〜2026-05-03']);
  for(const input of monthly.inputs){const saved=scheduleEvent(input);assert.equal(Date.parse(saved.endDate)-Date.parse(saved.date),3*86400000);assert.equal(saved.start,null);assert.equal(saved.end,null);}
  assert.equal(scheduleRecurrence(event({date:'2026-01-01',endDate:'2026-01-31'}),{frequency:'daily',count:1}).inputs[0].date,'2026-01-02〜2026-02-01');
});
test('timed and overnight copies round-trip through normal event validation',()=>{
  for(const source of [event({start:14*60+5,end:null}),event({start:23*60+30,end:25*60+15}),event({start:0,end:45})]){
    const plan=scheduleRecurrence(source,{frequency:'weekly',count:2});
    for(const input of plan.inputs){const saved=scheduleEvent(input);assert.equal(saved.start,source.start);assert.equal(saved.end,source.end);assert.equal(saved.place,source.place);assert.equal(saved.description,source.description);}
  }
});
test('the source date can be normalized without altering finite generation',()=>{
  const plan=scheduleRecurrence(event({date:'2026/10/20'}),{frequency:'daily',count:1});assert.deepEqual(plan.dates,['2026-10-21']);
});
test('unknown frequencies and non-integer or excessive counts are rejected',()=>{
  for(const frequency of ['yearly','Weekly','__proto__',null,undefined,{},1])assert.throws(()=>scheduleRecurrence(event(),{frequency,count:2}),/繰り返し/);
  for(const count of [0,-1,27,1.1,'2',NaN,Infinity,null,undefined])assert.throws(()=>scheduleRecurrence(event(),{frequency:'weekly',count}),/追加回数/);
  assert.equal(MAX_RECURRENCE_COUNT,26);assert.deepEqual(Object.keys(scheduleRecurrenceChoices),['daily','weekly','biweekly','monthly']);
});
test('invalid original dates, times, and all-day ranges never produce a partial plan',()=>{
  for(const change of [{date:'2026-02-30'},{date:'1999-12-31'},{date:'2100-01-01'},{endDate:null},{endDate:'2026-10-19'},{endDate:'2026-11-20'},{endDate:'2026-10-21',start:30,end:45},{start:null,end:45},{start:0,end:1440},{start:1440,end:null},{start:-1,end:null},{start:10,end:10},{start:10,end:'20'},{title:''}])assert.throws(()=>scheduleRecurrence(event(change),{frequency:'weekly',count:2}));
  for(const source of [null,undefined,[],false])assert.throws(()=>scheduleRecurrence(source,{frequency:'weekly',count:2}),/元の予定/);
});
test('the supported century bounds both start and end of every generated copy',()=>{
  assert.deepEqual(scheduleRecurrence(event({date:'2099-12-30'}),{frequency:'daily',count:1}).dates,['2099-12-31']);
  for(const [source,frequency,count] of [[event({date:'2099-12-30'}),'daily',2],[event({date:'2099-12-25'}),'weekly',1],[event({date:'2099-12-01'}),'monthly',1],[event({date:'2099-11-30',endDate:'2099-12-02'}),'monthly',1]])assert.throws(()=>scheduleRecurrence(source,{frequency,count}),/2000年〜2099年/);
});

const overlapInput=(date,time='')=>({title:'追加する予定',date,time,place:'',description:''});
const stored=(date,time='')=>scheduleEvent(overlapInput(date,time));
test('overlap warnings include overnight intervals on either side of a date or year boundary',()=>{
  assert.equal(scheduleRecurrenceOverlapCount([stored('2026-10-30','23:00-02:00')],[overlapInput('2026-10-31','00:30-01:00')]),1);
  assert.equal(scheduleRecurrenceOverlapCount([stored('2026-10-31','00:30-01:00')],[overlapInput('2026-10-30','23:00-02:00')]),1);
  assert.equal(scheduleRecurrenceOverlapCount([stored('2026-12-31','23:30-01:00')],[overlapInput('2027-01-01','00:00-00:45')]),1);
  assert.equal(scheduleRecurrenceOverlapCount([stored('2026-10-30','23:00-00:00')],[overlapInput('2026-10-31')]),0);
});
test('intervals that only share a start/end boundary are consecutive rather than overlapping',()=>{
  assert.equal(scheduleRecurrenceOverlapCount([stored('2026-10-20','10:00-11:00')],[overlapInput('2026-10-20','11:00-12:00'),overlapInput('2026-10-20','09:00-10:00')]),0);
  assert.equal(scheduleRecurrenceOverlapCount([stored('2026-10-20〜2026-10-22')],[overlapInput('2026-10-23'),overlapInput('2026-10-19')]),0);
  assert.equal(scheduleRecurrenceOverlapCount([stored('2026-10-20','23:00-01:00')],[overlapInput('2026-10-21','01:00-02:00')]),0);
});
test('multi-day all-day intervals include their final date and count one candidate once',()=>{
  const existing=[stored('2026-10-30〜2026-11-02'),stored('2026-11-01'),stored('2026-11-02','08:00-09:00')];
  const inputs=[overlapInput('2026-11-01'),overlapInput('2026-11-02','23:59'),overlapInput('2026-11-03','00:00'),overlapInput('2026-10-29〜2026-11-01')];
  assert.equal(scheduleRecurrenceOverlapCount(existing,inputs),3);assert.equal(scheduleRecurrenceOverlapCount(existing,[]),0);assert.equal(scheduleRecurrenceOverlapCount([],inputs),0);
});
test('an unspecified end is a point that overlaps equal points or a containing half-open interval',()=>{
  const point=stored('2026-10-20','10:00');
  assert.equal(scheduleRecurrenceOverlapCount([point],[overlapInput('2026-10-20','10:00'),overlapInput('2026-10-20','10:01'),overlapInput('2026-10-20','09:00-10:00'),overlapInput('2026-10-20','10:00-11:00')]),2);
  assert.equal(scheduleRecurrenceOverlapCount([stored('2026-10-20','09:00-10:00')],[overlapInput('2026-10-20','10:00')]),0);
  assert.equal(scheduleRecurrenceOverlapCount([stored('2026-10-20','10:00-11:00')],[overlapInput('2026-10-20','10:00'),overlapInput('2026-10-20','11:00')]),1);
  assert.equal(scheduleRecurrenceOverlapCount([stored('2026-10-20')],[overlapInput('2026-10-20','00:00'),overlapInput('2026-10-20','23:59'),overlapInput('2026-10-21','00:00')]),2);
});
test('overlap checks reject invalid temporal inputs and leave both input collections unchanged',()=>{
  const existing=[stored('2026-10-20','23:00-01:00')],inputs=[overlapInput('2026-10-21','00:30-02:00')],before=structuredClone({existing,inputs});
  assert.equal(scheduleRecurrenceOverlapCount(existing,inputs),1);assert.deepEqual({existing,inputs},before);
  assert.throws(()=>scheduleRecurrenceOverlapCount([event({start:1440,end:null})],inputs));
  assert.throws(()=>scheduleRecurrenceOverlapCount(existing,[overlapInput('2026-02-30')]));
  assert.throws(()=>scheduleRecurrenceOverlapCount(null,inputs));assert.throws(()=>scheduleRecurrenceOverlapCount(existing,Array(27).fill(inputs[0])));
});
