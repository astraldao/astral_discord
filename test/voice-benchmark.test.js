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
  await f.c.handle(click('start'));assert.equal(f.runs,1);await f.c.handle(click('status'));await f.c.handle(click('cancel'));await f.c.handle(click('confirm-cancel'));await task;assert.equal(s.busy,false);assert.ok(JSON.stringify(start.result).includes('中断'));
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
  assert.equal(s.busy,false);assert.equal(probe.snapshot().result.ok,true);assert.equal(probe.snapshot().result.cancelled,undefined);const reopen=interaction();await c.open(reopen);assert.ok(JSON.stringify(reopen.result).includes('測定が完了'));assert.deepEqual(notices.map(({stage,code})=>({stage,code})),[{stage:'progress',code:10015},{stage:'error',code:10015}]);probe.close();
});

test('a transient progress permission lookup failure leaves the authorized fixed-text measurement running',async()=>{
  const f=uiFixture();let checks=0;const c=createBenchmarkController({probe:f.probe,access:async i=>{if(i.customId.endsWith(':start')&&++checks===2)throw new Error('Permission lookup unavailable');}});await c.open(interaction());const s=[...c.sessions.sessions.values()][0],i=interaction(`perf:${s.id}:${s.turn}:start`),task=c.handle(i);await tick();
  try{assert.equal(f.probe.snapshot().phase,'warming');assert.equal(s.busy,true);}finally{f.setResult({ok:true,measuredAt:1,parts:1});await task;}assert.ok(JSON.stringify(i.result).includes('測定が完了'));
});

test('explicit cancellation and shutdown retain their distinct causes and bounded warmup information',async()=>{
  for(const reason of ['user','shutdown']){
    const ready=deferred();let time=0;const probe=createVoiceBenchmark({now:()=>time,capacity:async()=>({}),worker:()=>({ready:ready.promise,diagnostics:{stage:'warmup',warmupParts:2,elapsedMs:1234,text:'PRIVATE'},close(){ready.reject(new Error('closed'));}})}),task=probe.run('owner');await tick();time=1234;
    if(reason==='user')probe.cancel('owner','confirmed-user');else probe.close();const r=await task;assert.equal(r.cancelled,true);assert.equal(r.cancelReason,reason);assert.equal(r.elapsedMs,1234);assert.deepEqual(r.info,{stage:'warmup',warmupParts:2,elapsedMs:1234});assert.equal(r.failure,undefined);
    const view=benchmarkScreen({id:'s',turn:0},{phase:'idle',result:r});assert.ok(JSON.stringify(view).includes(reason==='user'?'確認操作で':'Bot停止により'));assert.match(view.embeds[0].toJSON().description,/最長の分割待ち \*\*未計測/);probe.close();
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

test('refresh stays in the same button position before and during measurement, apart from cancellation',()=>{
  const session={id:'s',turn:0};
  for(const state of [{phase:'idle'},{phase:'warming',owner:'s',elapsedMs:0},{phase:'idle',result:{ok:true,measuredAt:1,parts:1}}]){
    const screen=benchmarkScreen(session,state),rows=screen.components.map(r=>r.toJSON().components);assert.ok(rows[0][1].custom_id.endsWith(':status'));assert.ok(rows[1].every(b=>!b.custom_id.endsWith(':status')));assert.ok(rows[0].every(b=>!b.custom_id.endsWith(':cancel')));
  }
});
test('a cancellation button opens confirmation without stopping the active measurement',async()=>{
  const f=uiFixture();await f.c.open(interaction());const s=[...f.c.sessions.sessions.values()][0],start=f.c.handle(interaction(`perf:${s.id}:${s.turn}:start`));await tick();
  try{const prompt=interaction(`perf:${s.id}:${s.turn}:cancel`);await f.c.handle(prompt);assert.equal(f.probe.snapshot().phase,'warming');assert.ok(JSON.stringify(prompt.result).includes('中断を確定'));}finally{f.setResult({ok:true,measuredAt:1,parts:1});await start;}
});
test('an expired acknowledgement is logged once and never retried or allowed to change measurement state',async()=>{
  let attempts=0,checks=0,runs=0;const reports=[],c=createBenchmarkController({probe:{run:()=>runs++},access:async()=>checks++,onDiagnostic:info=>reports.push(info)}),fail=async()=>{attempts++;throw Object.assign(new Error('PRIVATE_TOKEN_AND_REQUEST'),{code:10062});};
  await c.handle(interaction('perf:missing:0:cancel',{deferUpdate:fail,reply:fail}));assert.equal(attempts,1);assert.equal(checks,0);assert.equal(runs,0);assert.equal(reports.length,1);assert.equal(reports[0].stage,'ack');assert.equal(reports[0].code,10062);assert.ok(!JSON.stringify(reports).includes('PRIVATE_TOKEN'));
});

test('a cancellation confirmation must be fresh and continuing cannot stop the measurement',async()=>{
  let time=100000;const f=uiFixture(),c=createBenchmarkController({probe:f.probe,access:async()=>{},now:()=>time});await c.open(interaction());const s=[...c.sessions.sessions.values()][0],click=a=>interaction(`perf:${s.id}:${s.turn}:${a}`),task=c.handle(click('start'));await tick();
  try{
    await c.handle(click('confirm-cancel'));assert.equal(f.probe.snapshot().phase,'warming');
    const prompt=click('cancel');await c.handle(prompt);const rows=prompt.result.components.map(r=>r.toJSON().components);assert.ok(rows[1][0].custom_id.endsWith(':continue'));assert.ok(rows[1][1].custom_id.endsWith(':confirm-cancel'));
    await c.handle(click('continue'));assert.equal(f.probe.snapshot().phase,'warming');await c.handle(click('confirm-cancel'));assert.equal(f.probe.snapshot().phase,'warming');
    await c.handle(click('cancel'));time+=30001;await c.handle(click('confirm-cancel'));assert.equal(f.probe.snapshot().phase,'warming');
  }finally{f.setResult({ok:true,measuredAt:1,parts:1});await task;}
});
test('owner, channel, generation and current permissions are checked again before cancellation is confirmed',async()=>{
  const f=uiFixture();await f.c.open(interaction());const s=[...f.c.sessions.sessions.values()][0],click=(a,extra={})=>interaction(`perf:${s.id}:${s.turn}:${a}`,extra),task=f.c.handle(click('start'));await tick();
  try{
    await f.c.handle(click('cancel'));const stale=click('confirm-cancel');await f.c.handle(click('status'));await f.c.handle(stale);
    await f.c.handle(click('confirm-cancel',{user:{id:'other'}}));await f.c.handle(click('confirm-cancel',{channelId:'other'}));f.setAllowed(false);await f.c.handle(click('confirm-cancel'));assert.equal(f.probe.snapshot().phase,'warming');
  }finally{f.setAllowed(true);f.setResult({ok:true,measuredAt:1,parts:1});await task;}
});
test('an unclassified cancellation is never attributed to the user and logs only fixed cause and numeric timing',async()=>{
  const ready=deferred(),audit=[];let time=0;const probe=createVoiceBenchmark({now:()=>time,capacity:async()=>({}),onDiagnostic:data=>audit.push(data),worker:()=>({ready:ready.promise,diagnostics:{stage:'warmup'},close(){ready.reject(new Error('PRIVATE_TOKEN_AND_PATH'));}})}),task=probe.run('SECRET_OWNER');await tick();time=123;probe.cancel('SECRET_OWNER');const r=await task;
  assert.equal(r.cancelReason,'system');assert.deepEqual(audit,[{stage:'cancel',cause:'system',phase:'warming',elapsedMs:123}]);assert.ok(!JSON.stringify(audit).match(/SECRET|PRIVATE/));const card=benchmarkScreen({id:'s',turn:0},{phase:'idle',result:r});assert.match(card.embeds[0].toJSON().description,/システム経由/);assert.match(card.embeds[0].toJSON().description,/合成経過/);probe.close();
});
test('acknowledgement timing separates age before delivery from callback duration and acknowledgement is not repeated',async()=>{
  let time=10000,attempts=0;const reports=[],c=createBenchmarkController({probe:{},now:()=>time,onDiagnostic:data=>reports.push(data)}),i=interaction('perf:x:0:status',{createdTimestamp:8000,async deferUpdate(){attempts++;time+=1200;this.deferred=true;}});
  assert.equal(await c.acknowledge(i),true);assert.equal(await c.acknowledge(i),true);assert.equal(attempts,1);assert.deepEqual(reports,[{stage:'ack-slow',uiRevision:2,ageMs:2000,ackMs:1200}]);
  const expired=interaction('perf:x:0:status',{createdTimestamp:time-3200,async deferUpdate(){time+=400;throw Object.assign(new Error('PRIVATE_REQUEST_URL'),{code:10062});}});assert.equal(await c.acknowledge(expired),false);assert.deepEqual(reports[1],{stage:'ack',uiRevision:2,code:10062,ageMs:3200,ackMs:400});
});
function progressFixture(){
  const f=uiFixture(),jobs=new Map();let serial=0,checks=0,allowed=true;const reports=[];
  const c=createBenchmarkController({probe:f.probe,onDiagnostic:info=>reports.push(info),access:async()=>{checks++;if(!allowed)throw new Error('権限がありません');},schedule(fn,ms){assert.equal(ms,5000);jobs.set(++serial,fn);return serial;},cancel:id=>jobs.delete(id)});
  return {...f,c,jobs,reports,get checks(){return checks;},setAccess:value=>allowed=value,async refresh(){for(const fn of [...jobs.values()])fn();await tick();await tick();}};
}
test('progress is refreshed on the acknowledged reply and stops after completion',async()=>{
  const f=progressFixture();await f.c.open(interaction());const s=[...f.c.sessions.sessions.values()][0];let acknowledgements=0,edits=0;const i=interaction(`perf:${s.id}:${s.turn}:start`,{async deferUpdate(){acknowledgements++;this.deferred=true;},async editReply(value){edits++;this.result=value;}}),task=f.c.handle(i);await tick();assert.equal(f.jobs.size,1);const before=edits;await f.refresh();assert.ok(edits>before);assert.equal(acknowledgements,1);f.setResult({ok:true,measuredAt:1,parts:1});await task;assert.equal(f.jobs.size,0);assert.equal(s.busy,false);
});
test('progress does not overwrite navigation or expose metrics after access is revoked',async()=>{
  const f=progressFixture(),message={id:'private',flags:{has:()=>true}};await f.c.open(interaction('open',{message}));const s=[...f.c.sessions.sessions.values()][0],i=interaction(`perf:${s.id}:${s.turn}:start`,{message}),task=f.c.handle(i);await tick();f.c.leave(interaction('admin:open',{message}));i.result=null;const checks=f.checks;await f.refresh();assert.equal(f.checks,checks);assert.equal(i.result,null);
  s.hidden=false;f.setAccess(false);await f.refresh();assert.equal(f.jobs.size,0);assert.equal(i.result,null);f.setResult({ok:true,measuredAt:1,parts:7,firstAudioMs:123456789});await task;assert.ok(!JSON.stringify(i.result).includes('123456789'));
});
test('a progress permission request completing late cannot overwrite the completed result',async()=>{
  const f=uiFixture(),gate=deferred(),jobs=new Map();let gateNext=false;const c=createBenchmarkController({probe:f.probe,access:async()=>{if(gateNext){gateNext=false;await gate.promise;}},schedule:fn=>{jobs.set(1,fn);return 1;},cancel:id=>jobs.delete(id)});await c.open(interaction());const s=[...c.sessions.sessions.values()][0];let edits=0;const i=interaction(`perf:${s.id}:${s.turn}:start`,{async editReply(value){edits++;this.result=value;}}),task=c.handle(i);await tick();gateNext=true;jobs.get(1)();await tick();f.setResult({ok:true,measuredAt:1,parts:7});await task;const finalEdits=edits;gate.resolve();await tick();await tick();assert.equal(edits,finalEdits);assert.equal(jobs.size,0);
});
test('an expired confirmation acknowledgement cannot cancel a running measurement',async()=>{
  const f=uiFixture();await f.c.open(interaction());const s=[...f.c.sessions.sessions.values()][0],click=a=>interaction(`perf:${s.id}:${s.turn}:${a}`),task=f.c.handle(click('start'));await tick();
  try{await f.c.handle(click('cancel'));let replies=0;await f.c.handle({...click('confirm-cancel'),async deferUpdate(){throw Object.assign(new Error('Expired'),{code:10062});},async reply(){replies++;}});assert.equal(f.probe.snapshot().phase,'warming');assert.equal(replies,0);}finally{f.setResult({ok:true,measuredAt:1,parts:1});await task;}
});

test('a 46-second preparation and repeated expired refreshes cannot cancel the actual benchmark job',async()=>{
  const ready=deferred();let time=0,streaming=false;const audit=[],probe=createVoiceBenchmark({now:()=>time,date:()=>100000,capacity:async()=>({}),onDiagnostic:event=>audit.push(event),worker:()=>({ready:ready.promise,get diagnostics(){return streaming?{protocol:2,threads:1}:{stage:'warmup'};},async stream(_,__,chunk){streaming=true;time+=2054;chunk(wave());time+=1200;chunk(wave());},close(){ready.reject(new Error('closed'));}}),encode:async()=>({packets:5,audioMs:100})}),reports=[],c=createBenchmarkController({probe,now:()=>time,access:async()=>{},onDiagnostic:event=>reports.push(event)});
  await c.open(interaction());const s=[...c.sessions.sessions.values()][0],start=interaction(`perf:${s.id}:${s.turn}:start`),task=c.handle(start);await tick();time=46173;
  for(let n=0;n<4;n++)await c.handle(interaction(`perf:${s.id}:${s.turn}:status`,{createdTimestamp:time-4000,async deferUpdate(){throw Object.assign(new Error('Expired'),{code:10062});},async reply(){assert.fail('do not retry');}}));
  assert.equal(probe.busy,true);assert.deepEqual(audit,[]);assert.equal(reports.filter(r=>r.stage==='ack'&&r.code===10062).length,4);ready.resolve();await task;assert.equal(probe.snapshot().result.ok,true);assert.notEqual(probe.snapshot().result.cancelled,true);assert.equal(probe.snapshot().result.warmupMs,46173);assert.ok(JSON.stringify(start.result).includes('測定が完了'));probe.close();
});

test('feature diagnostics show the chosen synthesis mode and bounded frame counts without arbitrary native fields',()=>{
  const info=backupInfo({engine:'features',protocol:3,threads:1,stage:'synthesis',framesDone:12,framesTotal:60,frameStart:12,frameEnd:60,text:'PRIVATE',feature:'PRIVATE'});
  assert.equal(info.protocol,3);assert.equal(info.framesTotal,60);assert.ok(!JSON.stringify(info).includes('PRIVATE'));assert.deepEqual(backupInfo({engine:'PRIVATE',framesTotal:3751,frameEnd:-1}),{});
  const failure=backupFailure(backupFault(null,'SYNTHESIS_TIMEOUT',info)),view=benchmarkScreen({id:'s',turn:0},{phase:'idle',result:{ok:false,measuredAt:1,parts:1,info,failure}}),body=view.embeds[0].toJSON().description;
  assert.match(body,/特徴量を共有して連続生成/);assert.match(body,/フレーム 12\/60/);assert.ok(body.length<4096);assert.ok(!body.includes('PRIVATE'));
});

test('diagnostics distinguish CPU execution from elapsed time without attributing the gap to host contention',()=>{
  const r={ok:true,measuredAt:1,parts:4,audioMs:3573,warmupMs:32029,firstAudioMs:2810,synthesisMs:13452,encodingMs:6884,info:{protocol:3,threads:1,warmupCpuMs:1000,firstAudioCpuMs:100,synthesisCpuMs:2000},encoding:{backend:'worker-opusscript',warmupMs:6194,processMs:266,warmupCpuMs:200,processCpuMs:50}};
  const body=benchmarkScreen({id:'s',turn:0},{phase:'idle',result:r}).embeds[0].toJSON().description;
  assert.match(body,/モデル準備 \*\*32,029ms/);assert.match(body,/CPU実行：準備 \*\*1,000ms/);assert.match(body,/Opus CPU：初期化 \*\*200ms/);assert.match(body,/差だけでホストの混雑は断定できません/);assert.ok(body.length<4096);
  assert.deepEqual(backupInfo({warmupCpuMs:-1,synthesisCpuMs:3600001,firstAudioCpuMs:'PRIVATE'}),{});
});
test('the real Opus measurement reports bounded CPU time separately from wall time',async()=>{
  const r=await measureEncoding(wave(),new AbortController().signal);assert.ok(Number.isInteger(r.warmupCpuMs)&&r.warmupCpuMs>=0);assert.ok(Number.isInteger(r.processCpuMs)&&r.processCpuMs>=0);assert.ok(r.warmupMs>=0&&r.processMs>=0);
});
