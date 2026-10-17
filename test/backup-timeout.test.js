import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPersistentVoice} from '../src/persistent-voice.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function wave(){const b=Buffer.alloc(44+3840);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(192000,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(3840,40);return b;}
const frame=(data,body=Buffer.alloc(0))=>Buffer.concat([Buffer.from(JSON.stringify({...data,bytes:body.length})+'\n'),body]);
function clock(){let now=0,id=0;const jobs=new Map();return {
  schedule(fn,ms){jobs.set(++id,{at:now+ms,fn});return id;},cancel:id=>jobs.delete(id),get count(){return jobs.size;},get now(){return now;},
  advance(ms){const until=now+ms;for(;;){const next=[...jobs].filter(([,j])=>j.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;const [key,job]=next;jobs.delete(key);now=job.at;job.fn();}now=until;},
};}
async function fixture(t,modern=false){
  const timer=clock(),child=new EventEmitter(),writes=[];child.stdin=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin.write=raw=>writes.push(JSON.parse(raw));child.kills=0;child.kill=()=>child.kills++;
  const worker=createPersistentVoice({launch:()=>child,schedule:timer.schedule,cancel:timer.cancel,now:()=>timer.now,threadPlan:{configuredThreads:3,threads:1}});t.after(()=>worker.close());if(modern)child.stdout.emit('data',frame({type:'warmup',part:0},wave()));child.stdout.emit('data',frame(modern?{type:'ready',protocol:2,threads:1,warmupParts:1}:{type:'ready'}));await worker.ready;
  return {worker,child,timer,writes,emit:(data,body)=>child.stdout.emit('data',frame({id:writes.at(-1).id,...data},body))};
}
test('stream progress can exceed the old total timeout, including a first WAV after 15 seconds',async t=>{
  const f=await fixture(t),chunks=[],job=f.worker.stream('本文',undefined,wav=>chunks.push(wav));await tick();
  f.timer.advance(20000);assert.equal(f.child.kills,0);f.emit({part:0},wave());
  f.timer.advance(12000);f.emit({part:1},wave());f.timer.advance(12000);f.emit({end:true});await job;
  assert.equal(chunks.length,2);assert.equal(f.child.kills,0);assert.equal(f.timer.count,0);
});
test('first audio, a stalled segment and the absolute synthesis limit have distinct deadlines',async t=>{
  for(const code of ['SYNTHESIS_START_TIMEOUT','SYNTHESIS_TIMEOUT','SYNTHESIS_LIMIT']){
    const f=await fixture(t),job=f.worker.stream('本文',undefined,()=>{});await tick();const rejected=assert.rejects(job,e=>e.code===code);
    if(code==='SYNTHESIS_START_TIMEOUT'){f.timer.advance(29999);assert.equal(f.child.kills,0);f.timer.advance(1);}
    else if(code==='SYNTHESIS_TIMEOUT'){f.emit({part:0},wave());f.timer.advance(14999);assert.equal(f.child.kills,0);f.timer.advance(1);}
    else {for(let n=0;n<4;n++){f.timer.advance(14000);f.emit({part:n},wave());}assert.equal(f.child.kills,0);f.timer.advance(4000);}
    await rejected;assert.equal(f.child.kills,1);assert.equal(f.timer.count,0);
  }
});
test('an incomplete WAV cannot keep a stalled synthesis alive',async t=>{
  const f=await fixture(t),job=f.worker.stream('本文',undefined,()=>assert.fail('partial audio must not play'));await tick();const rejected=assert.rejects(job,e=>e.code==='SYNTHESIS_START_TIMEOUT');
  const raw=frame({id:f.writes[0].id,part:0},wave());f.timer.advance(29000);f.child.stdout.emit('data',raw.subarray(0,raw.length-1));f.timer.advance(1000);await rejected;assert.equal(f.child.kills,1);
});
test('completion cancels both deadlines and a previous abort cannot kill the next queued request',async t=>{
  const f=await fixture(t),abort=new AbortController(),first=f.worker.stream('一番',abort.signal,()=>{}),second=f.worker.stream('二番',undefined,()=>{});await tick();assert.equal(f.writes.length,1);
  f.emit({end:true});await first;await tick();assert.equal(f.writes.length,2);abort.abort();assert.equal(f.child.kills,0);
  f.timer.advance(20000);f.emit({part:0},wave());f.emit({end:true});await second;f.timer.advance(120000);assert.equal(f.child.kills,0);assert.equal(f.timer.count,0);
});
test('stop kills a slow request promptly and cannot run the next queued message',async t=>{
  const f=await fixture(t),abort=new AbortController(),first=f.worker.stream('一番',abort.signal,()=>{}),second=f.worker.stream('二番',abort.signal,()=>{});await tick();
  const rejected=Promise.all([assert.rejects(first),assert.rejects(second)]);abort.abort();await rejected;
  assert.equal(f.child.kills,1);assert.equal(f.timer.count,0);assert.equal(f.writes.length,1);f.timer.advance(120000);assert.equal(f.child.kills,1);
});
test('a complete non-streaming WAV also cancels the idle and total timers',async t=>{
  const f=await fixture(t),job=f.worker.synthesize('本文');await tick();f.timer.advance(20000);f.emit({},wave());assert.deepEqual(await job,wave());assert.equal(f.timer.count,0);f.timer.advance(60000);assert.equal(f.child.kills,0);
});

test('a synchronous input-pipe failure cancels both timers without exposing the native error',async t=>{
  const f=await fixture(t);f.child.stdin.write=()=>{throw new Error('PRIVATE_NATIVE_PATH');};
  await assert.rejects(f.worker.stream('本文',undefined,()=>{}),e=>e.code==='SYNTHESIS_EXIT'&&!e.message.includes('PRIVATE_NATIVE_PATH'));assert.equal(f.timer.count,0);assert.equal(f.child.kills,1);
});

test('stage metadata identifies the timed-out native synthesis without extending any deadline',async t=>{
  const f=await fixture(t,true),job=f.worker.stream('本文',undefined,()=>{});await tick();const failure=assert.rejects(job,e=>{assert.equal(e.code,'SYNTHESIS_TIMEOUT');assert.deepEqual(e.info,{protocol:2,threads:1,configuredThreads:3,warmupParts:1,stage:'synthesis',parts:1,activePart:1,moras:3,elapsedMs:17000,idleMs:15000});return true;});
  f.emit({type:'progress',stage:'query'});f.emit({type:'progress',stage:'synthesis',part:0,moras:2});f.timer.advance(2000);f.emit({part:0},wave());f.timer.advance(14000);f.emit({type:'progress',stage:'synthesis',part:1,moras:3});f.timer.advance(1000);await failure;assert.equal(f.timer.count,0);
});
test('query and partial-transfer diagnostics cannot masquerade as completed audio progress',async t=>{
  for(const transfer of [false,true]){
    const f=await fixture(t,true),job=f.worker.stream('本文',undefined,()=>assert.fail());await tick();const failure=assert.rejects(job,e=>{assert.equal(e.code,'SYNTHESIS_START_TIMEOUT');assert.equal(e.info.stage,transfer?'transfer':'query');assert.equal(e.info.parts,0);return true;});
    f.timer.advance(29000);f.emit({type:'progress',stage:'query'});if(transfer){f.emit({type:'progress',stage:'synthesis',part:0,moras:2});const raw=frame({id:f.writes[0].id,part:0},wave());f.child.stdout.emit('data',raw.subarray(0,raw.length-1));}f.timer.advance(1000);await failure;
  }
});
test('invalid native progress order is rejected rather than altering counters or deadlines',async t=>{
  const f=await fixture(t,true),job=f.worker.stream('本文',undefined,()=>assert.fail());await tick();const failure=assert.rejects(job,e=>e.code==='SYNTHESIS_PROTOCOL');f.emit({type:'progress',stage:'synthesis',part:2,moras:3});await failure;assert.equal(f.child.kills,1);
});
test('modern readiness requires a complete validated warmup and a matching part count',async()=>{
  for(const invalid of ['no-wave','invalid-wave','wrong-count']){
    const child=new EventEmitter();child.stdin=new EventEmitter();child.stdin.write=()=>{};child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
    const worker=createPersistentVoice({launch:()=>child});const failure=assert.rejects(worker.ready,e=>e.code==='SYNTHESIS_PROTOCOL');
    if(invalid!=='no-wave')child.stdout.emit('data',frame({type:'warmup',part:0},invalid==='invalid-wave'?Buffer.from('invalid'):wave()));
    child.stdout.emit('data',frame({type:'ready',protocol:2,threads:1,warmupParts:invalid==='wrong-count'?2:1}));await failure;worker.close();
  }
});

test('warmup timeout identifies model preparation before accepting any channel message',async()=>{
  const timer=clock(),child=new EventEmitter();child.stdin=new EventEmitter();child.stdin.write=()=>assert.fail();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
  const worker=createPersistentVoice({launch:()=>child,schedule:timer.schedule,cancel:timer.cancel,now:()=>timer.now}),failure=assert.rejects(worker.ready,e=>{assert.equal(e.code,'SYNTHESIS_WARMUP_TIMEOUT');assert.deepEqual(e.info,{stage:'warmup',warmupParts:0,elapsedMs:90000});return true;});timer.advance(90000);await failure;worker.close();assert.equal(timer.count,0);
});
