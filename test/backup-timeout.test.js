import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPersistentVoice} from '../src/persistent-voice.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function wave(bytes=3840){const b=Buffer.alloc(44+bytes);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(192000,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(bytes,40);return b;}
const frame=(data,body=Buffer.alloc(0))=>Buffer.concat([Buffer.from(JSON.stringify({...data,bytes:body.length})+'\n'),body]);
function clock(){let now=0,id=0;const jobs=new Map();return {
  schedule(fn,ms){jobs.set(++id,{at:now+ms,fn});return id;},cancel:id=>jobs.delete(id),get count(){return jobs.size;},get now(){return now;},
  advance(ms){const until=now+ms;for(;;){const next=[...jobs].filter(([,j])=>j.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;const [key,job]=next;jobs.delete(key);now=job.at;job.fn();}now=until;},
};}
async function fixture(t,modern=false,metadata={}){
  const timer=clock(),child=new EventEmitter(),writes=[];child.stdin=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin.write=raw=>writes.push(JSON.parse(raw));child.kills=0;child.kill=()=>child.kills++;
  const worker=createPersistentVoice({launch:()=>child,schedule:timer.schedule,cancel:timer.cancel,now:()=>timer.now,threadPlan:{configuredThreads:3,threads:1}});t.after(()=>worker.close());if(modern)child.stdout.emit('data',frame({type:'warmup',part:0},wave()));child.stdout.emit('data',frame(modern?{type:'ready',protocol:modern===true?2:3,...(typeof modern==='string'?{engine:modern}:{}),threads:1,warmupParts:1,...metadata}:{type:'ready'}));await worker.ready;
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

const featureProgress=(part,start,end,frames=60)=>({type:'progress',stage:'synthesis',part,frameStart:start,frameEnd:end,frames});
test('feature streams preserve all frames, serialize posts and reset frame counters for the next request',async t=>{
  const f=await fixture(t,'features'),chunks=[];
  const first=f.worker.stream('一番',undefined,wav=>chunks.push(wav)),second=f.worker.stream('二番',undefined,wav=>chunks.push(wav));await tick();assert.equal(f.writes.length,1);
  f.emit({type:'progress',stage:'query'});f.emit(featureProgress(0,0,12));f.emit({part:0},wave(12*2048));f.emit(featureProgress(1,12,60));f.emit({part:1},wave(48*2048));f.emit({end:true});await first;await tick();assert.equal(f.writes.length,2);
  f.emit({type:'progress',stage:'query'});f.emit(featureProgress(0,0,12,12));f.emit({part:0},wave(12*2048));f.emit({end:true});await second;
  assert.deepEqual(chunks.map(w=>w.length-44),[12*2048,48*2048,12*2048]);assert.equal(f.timer.count,0);assert.equal(f.child.kills,0);assert.equal(f.worker.diagnostics.engine,'features');
});
test('feature ranges reject gaps, overlaps, changed totals and oversized dimensions before any audio is accepted',async t=>{
  for(const invalid of [featureProgress(1,13,60),featureProgress(1,11,60),featureProgress(1,12,60,61),featureProgress(1,12,205,205),featureProgress(1,12,60,3751),featureProgress(1,12,60.5,61)]){
    const f=await fixture(t,'features'),job=f.worker.stream('本文',undefined,()=>{});await tick();const rejected=assert.rejects(job,e=>e.code==='SYNTHESIS_PROTOCOL');
    f.emit({type:'progress',stage:'query'});f.emit(featureProgress(0,0,12));f.emit({part:0},wave(12*2048));f.emit(invalid);await rejected;assert.equal(f.child.kills,1);assert.equal(f.timer.count,0);
  }
});
test('feature audio must match its announced range and completion cannot silently discard remaining frames',async t=>{
  for(const invalid of ['no-range','wrong-length','no-audio','early-end']){
    const f=await fixture(t,'features'),job=f.worker.stream('本文',undefined,()=>{});await tick();const rejected=assert.rejects(job,e=>e.code==='SYNTHESIS_PROTOCOL');
    f.emit({type:'progress',stage:'query'});if(invalid!=='no-range')f.emit(featureProgress(0,0,12));
    if(invalid==='no-audio')f.emit({end:true});
    else {f.emit({part:0},wave(invalid==='wrong-length'?11*2048:12*2048));if(invalid==='early-end')f.emit({end:true});}
    await rejected;assert.equal(f.child.kills,1);
  }
});
test('feature progress and partial transfers retain frame diagnostics without renewing the WAV deadline',async t=>{
  for(const partial of [false,true]){
    const f=await fixture(t,'features'),job=f.worker.stream('本文',undefined,()=>{});await tick();const rejected=assert.rejects(job,e=>{assert.equal(e.code,'SYNTHESIS_TIMEOUT');assert.equal(e.info.engine,'features');assert.equal(e.info.protocol,3);assert.equal(e.info.framesDone,12);assert.equal(e.info.framesTotal,60);assert.equal(e.info.frameStart,12);assert.equal(e.info.frameEnd,60);assert.equal(e.info.idleMs,15000);assert.equal(e.info.stage,partial?'transfer':'synthesis');return true;});
    f.emit({type:'progress',stage:'query'});f.emit(featureProgress(0,0,12));f.emit({part:0},wave(12*2048));f.timer.advance(14000);f.emit(featureProgress(1,12,60));
    if(partial){const raw=frame({id:f.writes[0].id,part:1},wave(48*2048));f.child.stdout.emit('data',raw.subarray(0,raw.length-1));}f.timer.advance(1000);await rejected;assert.equal(f.timer.count,0);
  }
});
test('punctuation-only feature requests complete without audio and do not poison the next request',async t=>{
  const f=await fixture(t,'features'),empty=f.worker.stream('。',undefined,()=>assert.fail());await tick();f.emit({type:'progress',stage:'query'});f.emit({end:true});await empty;
  const next=f.worker.stream('次',undefined,()=>{});await tick();f.emit(featureProgress(0,0,12,12));f.emit({part:0},wave(12*2048));f.emit({end:true});await next;assert.equal(f.child.kills,0);
});
test('public packed fallback accepts bounded mora chunks with the same warmup and streaming contract',async t=>{
  const f=await fixture(t,'packed'),chunks=[],job=f.worker.stream('本文',undefined,wav=>chunks.push(wav));await tick();f.emit({type:'progress',stage:'query'});
  for(const [part,moras] of [[0,2],[1,12]]){f.emit({type:'progress',stage:'synthesis',part,moras});f.emit({part},wave());}f.emit({end:true});await job;assert.equal(chunks.length,2);assert.equal(f.worker.diagnostics.engine,'packed');assert.equal(f.timer.count,0);
});
test('unknown feature engine cannot announce readiness even with a valid warmup',async()=>{
  const child=new EventEmitter();child.stdin=new EventEmitter();child.stdin.write=()=>{};child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
  const worker=createPersistentVoice({launch:()=>child}),rejected=assert.rejects(worker.ready,e=>e.code==='SYNTHESIS_PROTOCOL');child.stdout.emit('data',frame({type:'warmup',part:0},wave()));child.stdout.emit('data',frame({type:'ready',protocol:3,engine:'PRIVATE_ENGINE',threads:1,warmupParts:1}));await rejected;worker.close();
});

test('native CPU counters stay separate from elapsed time and reset for every queued post',async t=>{
  const f=await fixture(t,'features',{warmupCpuMs:200}),first=f.worker.stream('一番',undefined,()=>{});await tick();
  f.emit({type:'progress',stage:'query'});f.emit(featureProgress(0,0,12,12));f.timer.advance(4000);f.emit({part:0,synthesisCpuMs:50},wave(12*2048));f.timer.advance(8000);f.emit({end:true,synthesisCpuMs:70});await first;
  assert.equal(f.worker.diagnostics.warmupCpuMs,200);assert.equal(f.worker.diagnostics.firstAudioCpuMs,50);assert.equal(f.worker.diagnostics.synthesisCpuMs,70);
  const second=f.worker.stream('二番',undefined,()=>{});await tick();assert.equal(f.worker.diagnostics.synthesisCpuMs,undefined);assert.equal(f.worker.diagnostics.firstAudioCpuMs,undefined);
  f.emit(featureProgress(0,0,12,12));f.emit({part:0,synthesisCpuMs:10},wave(12*2048));f.emit({end:true,synthesisCpuMs:12});await second;
  assert.equal(f.worker.diagnostics.synthesisCpuMs,12);assert.equal(f.worker.diagnostics.firstAudioCpuMs,10);assert.equal(f.timer.count,0);
});
test('CPU metadata is optional and missing final metadata cannot present a partial CPU total as complete',async t=>{
  const f=await fixture(t,'features'),job=f.worker.stream('本文',undefined,()=>{});await tick();f.emit(featureProgress(0,0,12,12));f.emit({part:0,synthesisCpuMs:50},wave(12*2048));f.emit({end:true});await job;
  assert.equal(f.worker.diagnostics.synthesisCpuMs,undefined);assert.equal(f.worker.diagnostics.firstAudioCpuMs,50);
});
test('invalid or regressing native CPU counters are rejected without changing WAV deadlines',async t=>{
  for(const value of [-1,3600001,1.5,9]){
    const f=await fixture(t,'features'),job=f.worker.stream('本文',undefined,()=>{});await tick();const rejected=assert.rejects(job,e=>e.code==='SYNTHESIS_PROTOCOL');
    f.emit(featureProgress(0,0,12,12));f.emit({part:0,synthesisCpuMs:10},wave(12*2048));f.emit({end:true,synthesisCpuMs:value});await rejected;assert.equal(f.timer.count,0);
  }
  for(const value of [-1,3600001,1.5])await assert.rejects(fixture(t,'features',{warmupCpuMs:value}),e=>e.code==='SYNTHESIS_PROTOCOL');
});
