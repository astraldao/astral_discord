import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageFlags} from 'discord.js';
import {systemCapacity,capacitySummary} from '../src/system-capacity.js';
import {createVoiceBenchmark,measureEncoding,benchmarkText} from '../src/voice-benchmark.js';
import {createBenchmarkController,benchmarkScreen} from '../src/voice-benchmark-ui.js';
import {backupFault,backupFailure,backupInfo,backupFailureSummary} from '../src/backup-fault.js';
import {createAdminController} from '../src/admin.js';
const tick=()=>new Promise(r=>setImmediate(r));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function wave(){const b=Buffer.alloc(44+19200);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(192000,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(19200,40);return b;}
const readFiles=files=>async path=>{if(!(path in files))throw new Error('missing');return files[path];};
test('capacity reports fractional cgroup v2 CPU, memory and throttling without host paths',async()=>{
  const c=await systemCapacity({read:readFiles({'/sys/fs/cgroup/cpu.max':'25000 100000','/sys/fs/cgroup/cpu.stat':'usage_usec 5000\nnr_periods 40\nnr_throttled 12\nthrottled_usec 6000','/sys/fs/cgroup/memory.current':'104857600','/sys/fs/cgroup/memory.max':'536870912'}),parallel:()=>32,total:()=>8*1024**3});
  assert.equal(c.cpuLimitCores,.25);assert.equal(c.effectiveCores,.25);assert.equal(c.memoryLimitBytes,536870912);assert.equal(c.cpuThrottledUsec,6000);assert.match(capacitySummary(c),/0.25コア/);assert.ok(!JSON.stringify(c).includes('/sys/'));assert.match(capacitySummary({...c,cpuLimitCores:.001}),/0.001コア/);
});
test('v1 co-mounted CPU controllers and unlimited/absent quotas are distinguished',async()=>{
  const v1=await systemCapacity({read:readFiles({'/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_quota_us':'50000','/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_period_us':'100000','/sys/fs/cgroup/cpu,cpuacct/cpu.stat':'nr_periods 4\nnr_throttled 2\nthrottled_time 5000000','/sys/fs/cgroup/memory/memory.limit_in_bytes':'99999999999999'}),parallel:()=>8,total:()=>1024});assert.equal(v1.cpuLimitCores,.5);assert.equal(v1.cpuThrottledUsec,5000);assert.equal(v1.memoryLimitBytes,1024);
  const missing=await systemCapacity({read:readFiles({}),parallel:()=>8,total:()=>1024});assert.equal(missing.cpuLimitCores,null);assert.equal(missing.cpuQuotaKnown,false);assert.match(capacitySummary(missing),/未確認/);
  const unlimited=await systemCapacity({read:readFiles({'/sys/fs/cgroup/cpu.max':'max 100000'}),parallel:()=>8,total:()=>1024});assert.equal(unlimited.cpuQuotaKnown,true);assert.match(capacitySummary(unlimited),/未設定/);
});
test('benchmark measures the fixed text, real-time factor, encoder and container throttling',async()=>{
  let time=0,closed=0,active=0,samples=0;const probe=createVoiceBenchmark({now:()=>time,date:()=>100000,activity:()=>{active++;return ()=>active--;},capacity:async()=>++samples===1?{memoryUsedBytes:1,cpuPeriods:10,cpuThrottledPeriods:2,cpuThrottledUsec:30000}:{memoryUsedBytes:2,cpuPeriods:20,cpuThrottledPeriods:7,cpuThrottledUsec:70000},worker:()=>({ready:Promise.resolve().then(()=>{time=200;}),diagnostics:{threads:1,protocol:2},async stream(text,signal,chunk){assert.equal(text,benchmarkText);assert.ok(Array.from(text).length<=50);time=320;chunk(wave());time=700;chunk(wave());time=1200;},close(){closed++;}}),encode:async()=>{time+=20;return {packets:5,audioMs:100};}});
  const r=await probe.run('owner');assert.equal(r.ok,true);assert.equal(r.warmupMs,200);assert.equal(r.firstAudioMs,120);assert.equal(r.synthesisMs,1000);assert.equal(r.audioMs,200);assert.equal(r.maxGapMs,380);assert.equal(r.realTimeFactor,5);assert.equal(r.encodingMs,20);assert.equal(r.throttledMs,40);assert.equal(r.throttledPercent,50);assert.equal(active,0);assert.equal(closed,1);assert.equal(probe.busy,false);await assert.rejects(probe.run('owner'),/あと30秒/);probe.close();
});
test('active work is rejected before starting a worker, concurrent runs are reserved once and owner cancellation is checked',async()=>{
  let starts=0;const blocked=createVoiceBenchmark({canStart:()=>{throw new Error('busy');},worker:()=>starts++});await assert.rejects(blocked.run('a'),/busy/);assert.equal(starts,0);assert.equal(blocked.busy,false);
  const ready=deferred(),probe=createVoiceBenchmark({capacity:async()=>({}),worker:()=>{starts++;return {ready:ready.promise,close:()=>ready.reject(new Error('stopped'))};}}),first=probe.run('a');await tick();assert.equal(probe.busy,true);await assert.rejects(probe.run('b'),/実行中/);assert.throws(()=>probe.cancel('b'));probe.cancel('a');const result=await first;assert.equal(result.cancelled,true);assert.equal(result.failure,undefined);assert.equal(probe.busy,false);assert.equal(starts,1);probe.close();await assert.rejects(probe.run('a'),/停止/);
});
test('failure details retain the actual timed-out part and discard text, native errors and environment values',async()=>{
  const fault=backupFault(null,'SYNTHESIS_TIMEOUT',{stage:'synthesis',parts:2,activePart:2,moras:6,elapsedMs:17000,idleMs:15000,threads:1,protocol:2,text:'PRIVATE',token:'SECRET',path:'/private/file'});
  const probe=createVoiceBenchmark({capacity:async()=>({}),worker:()=>({ready:Promise.resolve(),diagnostics:{protocol:2,threads:1},stream:async()=>{throw fault;},close(){}})}),r=await probe.run('a');assert.equal(r.ok,false);assert.equal(r.failure.info.stage,'synthesis');assert.equal(r.failure.info.parts,2);assert.match(backupFailureSummary(r.failure),/3片目/);assert.ok(!JSON.stringify(r).match(/PRIVATE|SECRET|\/private/));probe.close();
  assert.deepEqual(backupInfo({stage:'SECRET',threads:99,parts:-1,elapsedMs:NaN,token:'SECRET'}),{});assert.equal(backupFailure(new Error('SECRET')).message.includes('SECRET'),false);
});
test('encoder failure is distinct from synthesis and the real encoder generates packets without any VC',async()=>{
  const encoded=await measureEncoding(wave(),new AbortController().signal);assert.ok(encoded.packets>=5);assert.equal(encoded.audioMs,100);const midway=new AbortController(),encoding=measureEncoding(wave(),midway.signal);queueMicrotask(()=>midway.abort());await assert.rejects(encoding);const abort=new AbortController();abort.abort();await assert.rejects(measureEncoding(wave(),abort.signal));
  let closed=0;const probe=createVoiceBenchmark({capacity:async()=>({}),worker:()=>({ready:Promise.resolve(),async stream(_,__,chunk){chunk(wave());},close(){closed++;}}),encode:async()=>{throw new Error('PRIVATE_NATIVE_ERROR');}}),r=await probe.run('a');assert.equal(r.failure.code,'ENCODING');assert.equal(closed,1);assert.ok(!JSON.stringify(r).includes('PRIVATE_NATIVE_ERROR'));probe.close();
});
function interaction(id='open',extra={}){return {customId:id,user:{id:'admin'},channelId:'channel',message:{flags:{has:flag=>flag===MessageFlags.Ephemeral}},async deferUpdate(){this.deferred=true;},async deferReply(){this.deferred=true;},async editReply(m){this.result=m;},async reply(m){this.result=m;},...extra};}
function uiFixture(){const done=deferred();let state={phase:'idle'},runs=0,allowed=true;const probe={snapshot:()=>state,run(owner){runs++;state={phase:'warming',owner,elapsedMs:0};return done.promise;},cancel(owner){if(state.owner!==owner)throw new Error('owner');state={phase:'idle',result:{cancelled:true,measuredAt:1,parts:0}};done.resolve(state.result);}};return {probe,done,get runs(){return runs;},setAllowed:v=>allowed=v,setResult:r=>{state={phase:'idle',result:r};done.resolve(r);},c:createBenchmarkController({probe,access:async i=>{assert.ok(i.deferred||i.replied);if(!allowed)throw new Error('権限がありません');}})};}
test('measurement UI is read-only on open and validates owner, channel, generation and expiry before starting',async()=>{
  const f=uiFixture();await f.c.open(interaction());const s=[...f.c.sessions.sessions.values()][0],click=(a,extra)=>interaction(`perf:${s.id}:${s.turn}:${a}`,extra);assert.equal(f.runs,0);
  for(const extra of [{user:{id:'other'}},{channelId:'other'}])await f.c.handle(click('start',extra));assert.equal(f.runs,0);
  f.setAllowed(false);await f.c.handle(click('start'));f.setAllowed(true);assert.equal(f.runs,0);const stale=click('start');await f.c.handle(click('status'));await f.c.handle(stale);assert.equal(f.runs,0);s.expires=0;await f.c.handle(click('start'));assert.equal(f.runs,0);
});
test('measurement UI allows status and cancellation while start is running and never starts twice',async()=>{
  const f=uiFixture();await f.c.open(interaction());const s=[...f.c.sessions.sessions.values()][0],click=a=>interaction(`perf:${s.id}:${s.turn}:${a}`),start=click('start'),task=f.c.handle(start);await tick();assert.equal(s.busy,true);assert.equal(f.runs,1);
  await f.c.handle(click('start'));assert.equal(f.runs,1);await f.c.handle(click('status'));await f.c.handle(click('cancel'));await task;assert.equal(s.busy,false);assert.ok(JSON.stringify(start.result).includes('中断'));
});
test('permission loss during a measurement prevents the final result from being rendered',async()=>{
  const f=uiFixture();await f.c.open(interaction());const s=[...f.c.sessions.sessions.values()][0],i=interaction(`perf:${s.id}:${s.turn}:start`),task=f.c.handle(i);await tick();f.setAllowed(false);f.setResult({ok:true,measuredAt:1,parts:99,firstAudioMs:123456789});await task;assert.ok(!JSON.stringify(i.result).includes('123456789'));assert.ok(JSON.stringify(i.result).includes('権限'));
});
test('result cards stay within Discord limits and show scope and numeric stage details',()=>{
  const result={ok:false,measuredAt:1,parts:256,warmupMs:90000,synthesisMs:60000,audioMs:40000,info:{threads:4,protocol:2},failure:backupFailure(backupFault(null,'SYNTHESIS_TIMEOUT',{stage:'synthesis',parts:255,activePart:255,elapsedMs:60000,idleMs:15000,threads:4}))};
  const p=benchmarkScreen({id:'s',turn:0},{phase:'idle',result});assert.ok(p.embeds[0].toJSON().description.length<4096);assert.match(p.embeds[0].toJSON().description,/256片目/);p.components.forEach(row=>assert.ok(row.toJSON().components.length<=5));assert.ok(JSON.stringify(p).includes('VCで聞こえるまでの時間は含みません'));
});
test('admin diagnostic measurement entry opens only from an authorized diagnostics session',async()=>{
  let opened=0;const c=createAdminController({settings:{get:()=>({})},guild:{},access:async()=>true,openPerformance:async()=>opened++}),s=c.sessions.create('admin');s.originChannelId='channel';
  const click=()=>interaction(`admin:${s.id}:measure-voice`,{isChatInputCommand:()=>false,isModalSubmit:()=>false});await c.handle(click());assert.equal(opened,0);s.view='diagnostics';await c.handle(click());assert.equal(opened,1);await c.handle({...click(),user:{id:'other'}});assert.equal(opened,1);
});

test('a measurement completing after navigation does not overwrite the new screen',async()=>{
  const f=uiFixture(),message={id:'private-message',flags:{has:()=>true}};await f.c.open(interaction('open',{message}));const s=[...f.c.sessions.sessions.values()][0],i=interaction(`perf:${s.id}:${s.turn}:start`,{message}),task=f.c.handle(i);await tick();
  f.c.leave(interaction('admin:open',{message}));i.result=null;f.setResult({ok:true,measuredAt:1,parts:1,firstAudioMs:100});await task;assert.equal(i.result,null);assert.equal(s.busy,false);
});

test('a failed progress reply never cancels the warmup and the completed result remains available',async()=>{
  const ready=deferred();let closes=0;
  const probe=createVoiceBenchmark({capacity:async()=>({}),worker:()=>({ready:ready.promise,diagnostics:{stage:'warmup',warmupParts:0},async stream(_,__,chunk){chunk(wave());},close(){closes++;ready.reject(new Error('closed'));}}),encode:async()=>({packets:5,audioMs:100})});
  const notices=[],c=createBenchmarkController({probe,access:async()=>{},onDiagnostic:value=>notices.push(value)});await c.open(interaction());const s=[...c.sessions.sessions.values()][0];let replies=0;
  const i=interaction(`perf:${s.id}:${s.turn}:start`,{async editReply(value){if(++replies===1)throw Object.assign(new Error('PRIVATE_DISPLAY_ERROR'),{code:10062});this.result=value;}}),task=c.handle(i);
  try{await tick();assert.equal(probe.busy,true,'a failed display must leave synthesis running');assert.equal(probe.snapshot().phase,'warming');assert.equal(closes,0);}finally{ready.resolve();await task;}
  const result=probe.snapshot().result;assert.equal(result.ok,true);assert.notEqual(result.cancelled,true);assert.equal(closes,1);assert.ok(JSON.stringify(i.result).includes('測定が完了'));assert.ok(!JSON.stringify(notices).includes('PRIVATE_DISPLAY_ERROR'));probe.close();
});

test('permanently unavailable replies preserve the result for a freshly authorized screen',async()=>{
  const ready=deferred(),notices=[];const probe=createVoiceBenchmark({capacity:async()=>({}),worker:()=>({ready:ready.promise,async stream(_,__,chunk){chunk(wave());},close(){ready.reject(new Error('closed'));}}),encode:async()=>({packets:5,audioMs:100})});
  const c=createBenchmarkController({probe,access:async()=>{},onDiagnostic:info=>notices.push(info)});await c.open(interaction());const s=[...c.sessions.sessions.values()][0];
  const task=c.handle(interaction(`perf:${s.id}:${s.turn}:start`,{async editReply(){throw Object.assign(new Error('SECRET_TOKEN_AND_PATH'),{code:10015});}}));await tick();assert.equal(probe.busy,true);ready.resolve();await task;
  assert.equal(s.busy,false);assert.equal(probe.snapshot().result.ok,true);assert.equal(probe.snapshot().result.cancelled,undefined);const reopen=interaction();await c.open(reopen);assert.ok(JSON.stringify(reopen.result).includes('測定が完了'));assert.deepEqual(notices,[{stage:'progress',code:10015},{stage:'error',code:10015}]);probe.close();
});

test('a transient progress permission lookup failure leaves the authorized fixed-text measurement running',async()=>{
  const f=uiFixture();let checks=0;const c=createBenchmarkController({probe:f.probe,access:async i=>{if(i.customId.endsWith(':start')&&++checks===2)throw new Error('Permission lookup unavailable');}});await c.open(interaction());const s=[...c.sessions.sessions.values()][0],i=interaction(`perf:${s.id}:${s.turn}:start`),task=c.handle(i);await tick();
  try{assert.equal(f.probe.snapshot().phase,'warming');assert.equal(s.busy,true);}finally{f.setResult({ok:true,measuredAt:1,parts:1});await task;}assert.ok(JSON.stringify(i.result).includes('測定が完了'));
});

test('explicit cancellation and shutdown retain their distinct causes and bounded warmup information',async()=>{
  for(const reason of ['user','shutdown']){
    const ready=deferred();let time=0;const probe=createVoiceBenchmark({now:()=>time,capacity:async()=>({}),worker:()=>({ready:ready.promise,diagnostics:{stage:'warmup',warmupParts:2,elapsedMs:1234,text:'PRIVATE'},close(){ready.reject(new Error('closed'));}})}),task=probe.run('owner');await tick();time=1234;
    if(reason==='user')probe.cancel('owner');else probe.close();const r=await task;assert.equal(r.cancelled,true);assert.equal(r.cancelReason,reason);assert.equal(r.elapsedMs,1234);assert.deepEqual(r.info,{stage:'warmup',warmupParts:2,elapsedMs:1234});assert.equal(r.failure,undefined);
    const view=benchmarkScreen({id:'s',turn:0},{phase:'idle',result:r});assert.ok(JSON.stringify(view).includes(reason==='user'?'操作により':'Bot停止により'));assert.match(view.embeds[0].toJSON().description,/最長の分割待ち \*\*未計測/);probe.close();
  }
});

test('a warmup timeout is a failure rather than a cancellation',async()=>{
  const failure=backupFault(null,'SYNTHESIS_WARMUP_TIMEOUT',{stage:'warmup',warmupParts:1,elapsedMs:90000}),probe=createVoiceBenchmark({capacity:async()=>({}),worker:()=>({ready:Promise.reject(failure),diagnostics:{stage:'warmup'},close(){}})}),r=await probe.run('owner');assert.equal(r.cancelled,false);assert.equal(r.cancelReason,undefined);assert.equal(r.failure.code,'SYNTHESIS_WARMUP_TIMEOUT');assert.equal(r.failure.info.warmupParts,1);probe.close();
});

test('navigation during the final permission fetch prevents an old measurement reply from overwriting the new screen',async()=>{
  const f=uiFixture(),gate=deferred();let finalCheck=false;const c=createBenchmarkController({probe:f.probe,access:async()=>{if(finalCheck)await gate.promise;}}),message={id:'private-message',flags:{has:()=>true}};await c.open(interaction('open',{message}));const s=[...c.sessions.sessions.values()][0],i=interaction(`perf:${s.id}:${s.turn}:start`,{message}),task=c.handle(i);await tick();finalCheck=true;f.setResult({ok:true,measuredAt:1,parts:1});await tick();c.leave(interaction('admin:open',{message}));i.result=null;gate.resolve();await task;assert.equal(i.result,null);assert.equal(s.busy,false);
});

test('diagnostics distinguish configured and effective threads and cold initialization from steady encoding',()=>{
  const view=benchmarkScreen({id:'s',turn:0},{phase:'idle',result:{ok:true,measuredAt:1,parts:7,audioMs:3552,synthesisMs:21000,realTimeFactor:5.91,encodingMs:10002,info:{threads:1,configuredThreads:3,protocol:2},encoding:{backend:'worker-opusscript',warmupMs:10000,processMs:2}}});
  const body=view.embeds[0].toJSON().description;assert.match(body,/合成スレッド 1（設定上限 3/);assert.match(body,/初期化 \*\*10,000ms/);assert.match(body,/変換 \*\*2ms/);assert.ok(body.includes('同じVC接続中'));assert.ok(body.length<4096);
});
