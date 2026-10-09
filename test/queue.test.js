import test from 'node:test';
import assert from 'node:assert/strict';
import {SerialQueue, canEnter} from '../src/queue.js';
test('VC notifications are serialized and recover after failure', async () => {
  const queue = new SerialQueue(), events = [];
  let release;
  const gate = new Promise(resolve => {release = resolve;});
  const first = queue.add(async () => {events.push('start');await gate;events.push('end');throw new Error('failed');});
  const failure = assert.rejects(first,/failed/);
  const second = queue.add(() => {events.push('next');});
  await Promise.resolve(); assert.deepEqual(events,['start']);assert.equal(queue.size,2);
  release();await failure;await second;await queue.tail;
  assert.deepEqual(events,['start','end','next']);assert.equal(queue.size,0);
});
const user = {}, bot = {};
test('waiting cancellation immediately frees capacity and updates positions without running cancelled tasks',async()=>{
  const queue=new SerialQueue(), cancelled=new AbortController(),positions=[],events=[];
  let release;
  const first=queue.add(()=>new Promise(resolve=>{release=resolve;}));
  await Promise.resolve();
  const second=queue.add(()=>events.push('cancelled'),{signal:cancelled.signal});
  const failure=assert.rejects(second,/cancelled/);
  const third=queue.add(()=>events.push('third'),{onPosition:ahead=>positions.push(ahead)});
  assert.equal(queue.size,3);
  cancelled.abort(new Error('cancelled'));
  assert.equal(queue.size,2);
  assert.equal(positions.at(-1),1);
  await failure;
  const fourth=queue.add(()=>events.push('fourth'));
  release();await first;await third;await fourth;
  assert.deepEqual(events,['third','fourth']);
  assert.equal(queue.size,0);
});
test('already aborted jobs never enter the queue',async()=>{
  const queue=new SerialQueue(),signal=AbortSignal.abort(new Error('cancelled'));
  await assert.rejects(queue.add(()=>assert.fail('must not run'),{signal}),/cancelled/);
  assert.equal(queue.size,0);
});
const channel = (overrides={}) => ({id:'target',type:2,parentId:'category',userLimit:0,
  members:{filter:()=>({size:1})}, permissionsFor:()=>({has:()=>true}),...overrides});
const allowed = c => canEnter(c,user,bot,'lobby','category');
test('rejects private categories, lobby, stages, missing permissions', () => {
  assert.equal(allowed(channel()),true);
  for (const c of [null,channel({id:'lobby'}),channel({type:13}),channel({parentId:'secret'}),
    channel({permissionsFor:m=>({has:()=>m===bot})}),channel({permissionsFor:m=>({has:()=>m===user})})]) assert.equal(allowed(c),false);
});
test('rejects full VCs even when bot could bypass limit', () => {
  assert.equal(allowed(channel({userLimit:1})),false);
  assert.equal(allowed(channel({userLimit:2})),true);
});
test('listed VCs allow denied member Connect but still require ViewChannel and bot permissions', () => {
  const c=channel({permissionsFor:m=>({has:bits=>m===bot || !bits.includes(1048576n)})});
  assert.equal(canEnter(c,user,bot,'lobby',['target']),true);
  assert.equal(canEnter(c,user,bot,'lobby',[]),false);
  assert.equal(canEnter({...c,permissionsFor:m=>({has:bits=>m===bot || !bits.includes(1024n)})},user,bot,'lobby',['target']),false);
  assert.equal(canEnter({...c,permissionsFor:m=>({has:bits=>m===user || !bits.includes(1048576n)})},user,bot,'lobby',['target']),false);
  assert.equal(canEnter({...c,userLimit:1},user,bot,'lobby',['target']),false);
});
