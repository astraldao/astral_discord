import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,getEventListeners} from 'node:events';
import {Readable,PassThrough} from 'node:stream';
import {Worker} from 'node:worker_threads';
import OpusScript from 'opusscript';
import {createSpeechEncoder} from '../src/opus-encoder.js';
import {voiceThreads} from '../src/voice-threads.js';
import {createPersistentVoice} from '../src/persistent-voice.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function clock(){let id=0;const jobs=new Map();return {schedule:(fn,ms)=>{jobs.set(++id,{fn,ms});return id;},cancel:id=>jobs.delete(id),fire(ms){const next=[...jobs].find(([,v])=>v.ms===ms);assert.ok(next);jobs.delete(next[0]);next[1].fn();},get size(){return jobs.size;}};}
function fake({signal,respond}={}){
  const child=new EventEmitter(),timer=clock(),sent=[];let terminated=0;
  child.terminate=()=>terminated++;child.postMessage=value=>{sent.push(value);respond?.(value,child);};
  const codec=createSpeechEncoder({signal,launch:()=>child,schedule:timer.schedule,cancel:timer.cancel});
  return {child,timer,sent,codec,get terminated(){return terminated;},ready(extra={}){child.emit('message',{type:'ready',warmupMs:1,...extra});}};
}
function pcm(frames){const b=Buffer.alloc(frames*4);for(let n=0;n<frames;n++){const value=Math.round(Math.sin(n*2*Math.PI*240/48000)*4000);b.writeInt16LE(value,n*4);b.writeInt16LE(value,n*4+2);}return b;}
async function collect(stream){const packets=[];for await(const p of stream)packets.push(p);return packets;}

test('inference uses configured threads only within both CPU affinity and cgroup quota',()=>{
  assert.deepEqual(voiceThreads('3',1,null),{configuredThreads:3,threads:1});assert.deepEqual(voiceThreads('3',16,1),{configuredThreads:3,threads:1});
  assert.equal(voiceThreads('4',16,.25).threads,1);assert.equal(voiceThreads('4',16,2.5).threads,2);assert.equal(voiceThreads('1',16,8).threads,1);assert.equal(voiceThreads('4',2,null).threads,2);
  for(const value of ['0','5','1\nTOKEN=SECRET',3])assert.throws(()=>voiceThreads(value,1,null));
});
test('the native child receives the CPU-limited thread count without changing the stored setting',async()=>{
  const child=new EventEmitter();child.stdin=new EventEmitter();child.stdin.write=()=>{};child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};let launchThreads;
  const plan=voiceThreads('3',1,null),voice=createPersistentVoice({threadPlan:plan,launch:(_,__,options)=>{launchThreads=options.env.VOICEVOX_BACKUP_THREADS;return child;}});
  child.stdout.emit('data',Buffer.from('{"type":"ready","bytes":0}\n'));await voice.ready;assert.equal(launchThreads,'1');assert.equal(plan.configuredThreads,3);voice.close();
});
test('a real worker preserves stereo frames across odd-sized chunks, pads the final frame and can encode another message',async()=>{
  const codec=createSpeechEncoder();try{
    await codec.ready;const data=pcm(960*3+10),chunks=[data.subarray(0,1004),data.subarray(1004,2008),data.subarray(2008)];
    const first=await collect(codec.stream(Readable.from(chunks))),second=await collect(codec.stream(Readable.from([pcm(960)])));
    assert.equal(first.length,4);assert.equal(second.length,1);const decoder=new OpusScript(48000,2,OpusScript.Application.AUDIO);
    try{const decoded=Buffer.concat(first.map(packet=>decoder.decode(packet)));assert.equal(decoded.length,4*3840);assert.ok(decoded.some(value=>value!==0));}finally{decoder.delete();}
  }finally{codec.close();}
});
test('stop while warmup is pending terminates the worker and releases startup timers and abort listeners',async()=>{
  const abort=new AbortController(),f=fake({signal:abort.signal}),rejected=assert.rejects(f.codec.ready,e=>e.code==='ENCODING');abort.abort();await rejected;assert.equal(f.terminated,1);assert.equal(f.timer.size,0);assert.equal(getEventListeners(abort.signal,'abort').length,0);f.codec.close();assert.equal(f.terminated,1);
});
test('warmup and in-flight requests time out even when the encoding worker does not respond',async()=>{
  const warm=fake(),rejected=assert.rejects(warm.codec.ready,e=>e.code==='ENCODING');warm.timer.fire(30000);await rejected;assert.equal(warm.timer.size,0);assert.equal(warm.terminated,1);
  const f=fake();f.ready();await f.codec.ready;const output=f.codec.stream(Readable.from([pcm(960)])),read=assert.rejects(collect(output),e=>e.code==='ENCODING');await tick();f.timer.fire(5000);await read;assert.equal(f.terminated,1);assert.equal(f.timer.size,0);
});
test('an aborted signal cannot launch an encoder and aborting an active stream destroys its input',async()=>{
  let starts=0;const before=new AbortController();before.abort();assert.throws(()=>createSpeechEncoder({signal:before.signal,launch:()=>starts++}));assert.equal(starts,0);
  const abort=new AbortController(),f=fake({signal:abort.signal}),source=new PassThrough();f.ready();await f.codec.ready;
  const read=assert.rejects(collect(f.codec.stream(source)),e=>e.code==='ENCODING');source.write(pcm(960));await tick();abort.abort();await read;assert.equal(source.destroyed,true);assert.equal(f.timer.size,0);assert.equal(f.terminated,1);
});
test('native failures and malformed worker responses never expose raw diagnostics',async()=>{
  for(const type of ['error','exit','bad-ready','bad-sequence','bad-packet']){
    const f=fake();let read;
    if(type==='bad-ready'){read=assert.rejects(f.codec.ready,e=>e.code==='ENCODING');f.child.emit('message',{type:'ready',warmupMs:-1});}
    else if(['error','exit'].includes(type)){read=assert.rejects(f.codec.ready,e=>e.code==='ENCODING'&&!e.message.includes('PRIVATE'));f.child.emit(type,new Error('PRIVATE_TOKEN_OR_PATH'));}
    else{f.ready();await f.codec.ready;read=assert.rejects(collect(f.codec.stream(Readable.from([pcm(960)]))),e=>e.code==='ENCODING');await tick();f.child.emit('message',type==='bad-sequence'?{sequence:999,packets:[]}:{sequence:f.sent.at(-1).sequence,packets:[Buffer.alloc(0)]});}
    await read;assert.equal(f.terminated,1);assert.equal(f.timer.size,0);
  }
});
test('PCM is sent to the worker in bounded chunks and the worker can be reused without reinitialization',async()=>{
  const f=fake({respond:(request,child)=>queueMicrotask(()=>child.emit('message',{sequence:request.sequence,packets:request.type==='chunk'?[Buffer.from([1,2,3])]:[]}))});
  f.ready();await f.codec.ready;for(let n=0;n<2;n++)await collect(f.codec.stream(Readable.from([Buffer.alloc(262144)])));
  const chunks=f.sent.filter(r=>r.type==='chunk');assert.equal(chunks.length,8);assert.ok(chunks.every(r=>r.data.length===65536));assert.equal(f.sent.filter(r=>r.type==='start').length,2);assert.equal(f.terminated,0);assert.equal(f.timer.size,0);f.codec.close();
});
test('invalid PCM and concurrent streams fail without retaining an active worker',async()=>{
  const f=fake();f.ready();await f.codec.ready;const source=new PassThrough(),output=f.codec.stream(source),read=assert.rejects(collect(output),e=>e.code==='ENCODING');assert.throws(()=>f.codec.stream(Readable.from([pcm(960)])));f.codec.close();await read;assert.equal(source.destroyed,true);
  for(const data of [Buffer.alloc(3),Buffer.alloc(8*1024*1024+4)]){
    const g=fake({respond:(request,child)=>queueMicrotask(()=>child.emit('message',{sequence:request.sequence,packets:[]}))});g.ready();await g.codec.ready;await assert.rejects(collect(g.codec.stream(Readable.from([data]))),e=>e.code==='ENCODING');assert.equal(g.terminated,1);
  }
});

test('Opus CPU totals use only worker thread counters, sum microseconds before rounding and reset per stream',async()=>{
  let incomplete=false;
  const f=fake({respond:(request,child)=>queueMicrotask(()=>child.emit('message',{sequence:request.sequence,packets:request.type==='chunk'?[Buffer.from([1,2,3])]:[],...(!incomplete||request.type!=='chunk'?{cpuUs:600}:{})}))});
  f.ready({warmupCpuMs:30});try{
    await f.codec.ready;await collect(f.codec.stream(Readable.from([pcm(960)])));assert.deepEqual(f.codec.diagnostics,{warmupCpuMs:30,processCpuMs:2});
    await collect(f.codec.stream(Readable.from([pcm(960)])));assert.equal(f.codec.diagnostics.processCpuMs,2);
    incomplete=true;await collect(f.codec.stream(Readable.from([pcm(960)])));assert.deepEqual(f.codec.diagnostics,{warmupCpuMs:30});
  }finally{f.codec.close();}
});
test('malformed Opus CPU counters cannot cross the worker boundary as diagnostics',async()=>{
  for(const value of [-1,3600001,1.5]){
    const f=fake(),read=assert.rejects(f.codec.ready,e=>e.code==='ENCODING');f.ready({warmupCpuMs:value});await read;assert.equal(f.terminated,1);
  }
  for(const value of [-1,3600000001,1.5]){
    const f=fake({respond:(request,child)=>queueMicrotask(()=>child.emit('message',{sequence:request.sequence,packets:[],cpuUs:value}))});f.ready();await f.codec.ready;await assert.rejects(collect(f.codec.stream(Readable.from([pcm(960)]))),e=>e.code==='ENCODING');assert.equal(f.terminated,1);
  }
});

test('an unavailable thread CPU counter never prevents real Opus audio from being encoded',async()=>{
  const codec=createSpeechEncoder({launch:()=>new Worker(new URL('./fixtures/opus-worker-no-cpu.js',import.meta.url),{env:{},stdout:true,stderr:true})});
  try{await codec.ready;const packets=await collect(codec.stream(Readable.from([pcm(960)])));assert.equal(packets.length,1);assert.deepEqual(codec.diagnostics,{});}finally{codec.close();}
});
