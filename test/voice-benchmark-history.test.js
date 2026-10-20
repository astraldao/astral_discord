import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageFlags} from 'discord.js';
import {benchmarkHistoryEntry,benchmarkReport,compareBenchmarks} from '../src/voice-benchmark-history.js';
import {createVoiceBenchmark} from '../src/voice-benchmark.js';
import {createBenchmarkController,benchmarkHistoryScreen} from '../src/voice-benchmark-ui.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const capacity={arch:'x64',logicalCores:2,cpuLimitCores:1,cpuQuotaKnown:true,effectiveCores:1,memoryLimitBytes:536870912,memoryUsedBytes:200000000,memoryQuotaKnown:true};
const sample=(id,extra={})=>benchmarkHistoryEntry({measuredAt:1700000000000+id,ok:true,warmupMs:1000,firstAudioMs:100,synthesisMs:600,audioMs:1000,parts:2,maxGapMs:200,encodingMs:300,realTimeFactor:.6,info:{engine:'features',threads:1,configuredThreads:2,protocol:3},after:capacity,...extra},{id,botVersion:'4.0.0'});
const controls=message=>message.components.flatMap(r=>r.toJSON().components);
const control=(message,action)=>controls(message).find(c=>c.custom_id?.split(':')[3]===action).custom_id;
function wave(){const b=Buffer.alloc(44+19200);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(192000,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(19200,40);return b;}
test('history and exported reports allow only bounded measurement data, not worker or interaction fields',()=>{
  const raw={...sample(1),owner:'PRIVATE_ACCOUNT',channelId:'PRIVATE_CHANNEL',text:'PRIVATE_TEXT',audio:Buffer.from('PRIVATE_AUDIO'),env:{TOKEN:'PRIVATE_TOKEN'},error:new Error('PRIVATE_ERROR'),path:'/PRIVATE_PATH',failure:{code:'SYNTHESIS_TIMEOUT',message:'PRIVATE_ERROR',info:{parts:2,text:'PRIVATE_TEXT'}},info:{engine:'features',threads:1,text:'PRIVATE_TEXT',path:'/PRIVATE_PATH'},after:{...capacity,hostname:'PRIVATE_HOST',token:'PRIVATE_TOKEN'},encoding:{backend:'worker-opusscript',packets:1,audioMs:100,warmupMs:10,processMs:2,path:'/PRIVATE_PATH'}};
  const history=benchmarkHistoryEntry(raw),report=benchmarkReport(history,sample(2));assert.equal(history.failure.code,'SYNTHESIS_TIMEOUT');assert.equal(history.failure.info.parts,2);assert.equal(history.info.threads,1);assert.equal(history.encoding.backend,'worker-opusscript');assert.equal(history.after.memoryUsedBytes,200000000);assert.ok(!JSON.stringify(report).includes('PRIVATE'));assert.ok(Buffer.byteLength(JSON.stringify(report))<32768);
  raw.info.threads=4;assert.equal(history.info.threads,1);history.info.threads=2;assert.equal(report.measurement.info.threads,1);
});
test('history treats invalid or absent values as missing and accepts only fixed categorical values',()=>{
  const value=benchmarkHistoryEntry({id:'owner',version:'PRIVATE',measuredAt:NaN,firstAudioMs:-1,parts:257,realTimeFactor:Infinity,info:{engine:'PRIVATE',protocol:99},after:{arch:'PRIVATE',cpuLimitCores:Infinity,memoryUsedBytes:-1},encoding:{backend:'PRIVATE',audioMs:1001}});
  assert.equal(value.id,null);assert.equal(value.version,'unknown');assert.equal(value.measuredAt,null);assert.equal(value.firstAudioMs,null);assert.equal(value.parts,null);assert.equal(value.realTimeFactor,null);assert.deepEqual(value.info,{});assert.equal(value.encoding.backend,undefined);assert.equal(value.encoding.audioMs,null);assert.ok(!JSON.stringify(value).includes('PRIVATE'));assert.throws(()=>benchmarkReport(value));
});
test('comparison reports signed measurements, missing values and changed or unconfirmed conditions without a verdict',()=>{
  const previous=sample(1),current=sample(2,{firstAudioMs:70,encodingMs:null,realTimeFactor:.5});let comparison=compareBenchmarks(current,previous);
  assert.equal(comparison.metrics.firstAudioMs,-30);assert.equal(comparison.metrics.realTimeFactor,-.1);assert.equal(comparison.metrics.encodingMs,null);assert.deepEqual(comparison.different,[]);assert.deepEqual(comparison.unknown,[]);
  current.info.threads=2;current.info.engine='packed';current.version='4.0.1';current.after.cpuLimitCores=null;comparison=compareBenchmarks(current,previous);for(const key of ['threads','engine','version','cpuLimitCores'])assert.ok(comparison.different.includes(key));
  current.info.protocol=undefined;current.after.cpuQuotaKnown=false;comparison=compareBenchmarks(current,previous);assert.ok(comparison.unknown.includes('protocol'));assert.ok(comparison.unknown.includes('cpuLimitCores'));
  assert.equal(compareBenchmarks({...current,ok:false},previous),null);assert.equal(compareBenchmarks({...current,cancelled:true},previous),null);
});
test('two known unlimited CPU quotas compare as the same allocation while missing quotas remain unknown',()=>{
  const a=sample(2),b=sample(1);a.after.cpuLimitCores=null;b.after.cpuLimitCores=null;assert.ok(!compareBenchmarks(a,b).unknown.includes('cpuLimitCores'));a.after.cpuQuotaKnown=false;assert.ok(compareBenchmarks(a,b).unknown.includes('cpuLimitCores'));
});
test('reports include a baseline only for two completed measurements and retain a stable format',()=>{
  const complete=benchmarkReport(sample(2),sample(1));assert.equal(complete.format,'astral-voice-benchmark-v1');assert.equal(complete.comparison.currentId,2);assert.equal(complete.comparison.previousId,1);
  const failed=benchmarkReport(sample(3,{ok:false}),sample(2));assert.equal(failed.baseline,undefined);assert.equal(failed.comparison,undefined);
});
test('the benchmark retains only the five latest finished measurements, including failures, with independent safe copies',async()=>{
  let time=0,runs=0;const probe=createVoiceBenchmark({version:'4.0.0',now:()=>time,date:()=>1700000000000+time,capacity:async()=>({...capacity,token:'PRIVATE_TOKEN'}),worker:()=>({ready:Promise.resolve(),diagnostics:{engine:'features',threads:1,protocol:3,text:'PRIVATE_TEXT'},async stream(_,__,chunk){time+=100;runs++;if(runs===3)throw new Error('PRIVATE_ERROR');chunk(wave());},close(){}}),encode:async()=>({packets:1,audioMs:100,backend:'worker-opusscript',warmupMs:1,processMs:1,path:'/PRIVATE_PATH'})});
  for(let n=0;n<7;n++){await probe.run('PRIVATE_OWNER');time+=30000;}
  const history=probe.history();assert.deepEqual(history.map(r=>r.id),[7,6,5,4,3]);assert.equal(history.at(-1).ok,false);assert.equal(history[0].version,'4.0.0');assert.ok(!JSON.stringify(history).includes('PRIVATE'));history[0].info.threads=4;assert.equal(probe.history()[0].info.threads,1);assert.equal(probe.snapshot().result.ok,true);probe.close();
});
test('an active measurement does not appear in history before it finishes or duplicate after cancellation',async()=>{
  const ready=deferred();let reject;const waiting=new Promise((_,r)=>reject=r),probe=createVoiceBenchmark({version:'4.0.0',capacity:async()=>capacity,worker:()=>({ready:ready.promise.then(()=>waiting),close(){reject(new Error('stopped'));ready.resolve();}})}),task=probe.run('owner');await tick();assert.equal(probe.history().length,0);probe.cancel('owner','confirmed-user');await task;assert.equal(probe.history().length,1);assert.equal(probe.history()[0].cancelled,true);assert.equal(probe.history()[0].cancelReason,'user');probe.close();assert.equal(probe.history().length,1);
});
async function fixture({entries=[sample(3,{firstAudioMs:987654}),sample(2,{ok:false}),sample(1)],access}={}){
  let allowed=true,runs=0,current=entries,state={phase:'idle',result:entries[0]};const requests=[];
  const probe={history:()=>structuredClone(current),snapshot:()=>structuredClone(state),run(){runs++;throw new Error('must explicitly test starting elsewhere');}};
  const message={id:'private',flags:{has:value=>value===MessageFlags.Ephemeral}};
  const interaction=(customId='open',extra={})=>({customId,user:{id:'admin'},channelId:'channel',message,async deferUpdate(){this.deferred=true;},async deferReply(){this.deferred=true;},async editReply(value){this.result=value;requests.push(value);},async reply(value){this.result=value;requests.push(value);},...extra});
  const c=createBenchmarkController({probe,access:async i=>{assert.ok(i.deferred||i.replied);await access?.(i);if(!allowed)throw new Error('権限がありません。');}}),opened=interaction();await c.open(opened);const s=[...c.sessions.sessions.values()][0];
  const handle=async(id,extra)=>{const i=interaction(id,extra);await c.handle(i);return i;};
  const click=(action,extra)=>handle(`perf:${s.id}:${s.turn}:${action}`,extra);
  return {c,s,probe,opened,interaction,handle,click,requests,get runs(){return runs;},setAllowed:value=>allowed=value,setEntries:value=>current=value,setState:value=>state=value};
}
test('history is a separate view with a bounded selection, restart notice and comparison against the preceding complete result',async()=>{
  const f=await fixture(),history=await f.click('history');assert.equal(f.runs,0);const body=history.result.embeds[0].toJSON().description;
  assert.match(body,/選択した履歴 #3/);assert.match(body,/直前の完了測定 #1/);assert.match(body,/Bot再起動で消えます/);assert.match(body,/改善やホスト混雑は断定しません/);
  const select=controls(history.result).find(c=>c.type===3);assert.equal(select.options.length,3);assert.equal(select.options[0].default,true);
  const selected=await f.handle(select.custom_id,{values:['1']});assert.match(selected.result.embeds[0].toJSON().description,/選択した履歴 #1/);assert.match(selected.result.embeds[0].toJSON().description,/比較は完了した測定/);
  const latest=await f.handle(control(selected.result,'latest'));assert.ok(JSON.stringify(latest.result).includes('測定が完了'));assert.ok(!JSON.stringify(latest.result).includes('選択した履歴'));assert.equal(f.runs,0);
});
test('the selected report is private, contains only selected and baseline measurements and replaces prior attachments',async()=>{
  const f=await fixture(),history=await f.click('history'),report=await f.handle(control(history.result,'report'));
  assert.equal(report.deferred,true);assert.deepEqual(report.result.attachments,[]);assert.equal(report.result.files.length,1);assert.equal(report.result.files[0].name,'astral-voice-measurement-3.json');
  const json=JSON.parse(report.result.files[0].attachment.toString('utf8'));assert.equal(json.measurement.id,3);assert.equal(json.baseline.id,1);assert.equal(json.measurement.firstAudioMs,987654);assert.equal(f.runs,0);
  const selected=await f.handle(control(report.result,'select-history'),{values:['2']});assert.deepEqual(selected.result.attachments,[]);assert.equal(selected.result.files,undefined);assert.match(selected.result.embeds[0].toJSON().description,/選択した履歴 #2/);
});
for(const change of ['owner','channel','expiry','generation','permission'])test(`a ${change} change cannot retrieve a report or select a private history entry`,async()=>{
  const f=await fixture(),history=await f.click('history'),id=control(history.result,'report');const extra={};
  if(change==='owner')extra.user={id:'other'};if(change==='channel')extra.channelId='other';if(change==='expiry')f.s.expires=0;if(change==='generation')f.s.turn++;if(change==='permission')f.setAllowed(false);
  const result=await f.handle(id,extra);assert.equal(result.result?.files,undefined);assert.ok(!JSON.stringify(result.result).includes('987654'));
});
test('access loss after report generation prevents the JSON from being sent',async()=>{
  const gate=deferred();let checks=0;const f=await fixture({access:async i=>{if(i.customId.endsWith(':report')&&++checks===2)await gate.promise;}});await f.click('history');const task=f.click('report');await tick();assert.equal(checks,2);f.setAllowed(false);gate.resolve();const report=await task;assert.equal(report.result?.files,undefined);assert.ok(!JSON.stringify(report.result).includes('987654'));
});
test('navigation during the final report check cannot overwrite the new view or attach a stale report',async()=>{
  const gate=deferred();let checks=0;const f=await fixture({access:async i=>{if(i.customId.endsWith(':report')&&++checks===2)await gate.promise;}});await f.click('history');const task=f.click('report');await tick();const latest=await f.click('latest'),requestCount=f.requests.length;assert.ok(JSON.stringify(latest.result).includes('測定が完了'));gate.resolve();const report=await task;assert.equal(report.result,undefined);assert.equal(f.requests.length,requestCount);
});
test('history eviction during final authorization blocks a report without silently substituting another measurement',async()=>{
  const gate=deferred();let checks=0;const f=await fixture({access:async i=>{if(i.customId.endsWith(':report')&&++checks===2)await gate.promise;}});await f.click('history');const task=f.click('report');await tick();f.setEntries([sample(8),sample(7),sample(6),sample(5),sample(4)]);gate.resolve();const report=await task;assert.equal(report.result?.files,undefined);assert.match(JSON.stringify(report.result),/最新の履歴/);
});
test('forged selection, lost entries and a small attachment budget never substitute or send a report',async()=>{
  const f=await fixture(),history=await f.click('history');await f.handle(control(history.result,'select-history'),{values:['unknown']});assert.equal(f.s.historyId,3);let report=await f.click('report',{attachmentSizeLimit:1});assert.equal(report.result.files,undefined);assert.match(JSON.stringify(report.result),/添付できません/);
  f.setEntries([sample(8)]);report=await f.click('report');assert.equal(report.result.files,undefined);assert.match(JSON.stringify(report.result),/保持期間/);const updated=await f.click('history');assert.match(JSON.stringify(updated.result),/選択した履歴 #8/);
});
test('empty and maximum history cards fit Discord limits and never start a measurement on navigation',async()=>{
  const f=await fixture({entries:[]}),empty=await f.click('history');assert.match(JSON.stringify(empty.result),/測定履歴はまだありません/);assert.equal(controls(empty.result).find(c=>c.custom_id.endsWith(':report')).disabled,true);assert.equal(f.runs,0);
  const entries=Array.from({length:5},(_,i)=>sample(5-i));const screen=benchmarkHistoryScreen({id:'session',turn:123,historyId:5},entries);assert.ok(screen.embeds[0].toJSON().description.length<4096);assert.ok(screen.components.length<=5);for(const row of screen.components)assert.ok(row.toJSON().components.length<=5);
});

test('memory comparisons distinguish confirmed limits from reference or missing quota observations',()=>{
  for(const flag of [false,undefined])for(const side of ['current','previous']){
    const current=sample(2),previous=sample(1);const changed=side==='current'?current:previous;changed.after.memoryQuotaKnown=flag;changed.after.memoryLimitBytes=1073741824;
    const comparison=compareBenchmarks(current,previous);assert.ok(comparison.unknown.includes('memoryLimitBytes'));assert.ok(!comparison.different.includes('memoryLimitBytes'));
    if(flag===false)assert.ok(comparison.different.includes('memoryQuotaKnown'));else assert.ok(comparison.unknown.includes('memoryQuotaKnown'));
  }
  const current=sample(2),previous=sample(1);current.after.memoryLimitBytes=null;let comparison=compareBenchmarks(current,previous);assert.ok(comparison.different.includes('memoryLimitBytes'));assert.ok(!comparison.unknown.includes('memoryLimitBytes'));
  previous.after.memoryLimitBytes=null;comparison=compareBenchmarks(current,previous);assert.ok(!comparison.different.includes('memoryLimitBytes'));assert.ok(!comparison.unknown.includes('memoryLimitBytes'));
});
test('an external access failure never exposes its message in a private card or a later JSON report',async()=>{
  let fail=false;const f=await fixture({access:async()=>{if(fail)throw Object.assign(new Error('PRIVATE_TEXT /PRIVATE_PATH TOKEN=PRIVATE_TOKEN'),{code:50013});}});await f.click('history');fail=true;
  const denied=await f.click('report');assert.equal(denied.result.files,undefined);assert.match(JSON.stringify(denied.result),/管理者権限とチャンネルの閲覧権限/);assert.ok(!JSON.stringify(denied.result).includes('PRIVATE'));
  fail=false;const report=await f.click('report');assert.ok(!report.result.files[0].attachment.toString('utf8').includes('PRIVATE'));assert.ok(!JSON.stringify(f.requests).includes('PRIVATE'));
});
test('arbitrary probe and native failures use a fixed operation guide instead of exposing their messages',async()=>{
  for(const operation of ['run','history','snapshot']){
    const f=await fixture();const original=f.probe[operation];f.probe[operation]=()=>{throw Object.assign(new Error('PRIVATE_TEXT /PRIVATE_PATH TOKEN=PRIVATE_TOKEN'),{code:12345});};
    const result=await f.click(operation==='run'?'start':operation==='history'?'history':'latest');assert.match(JSON.stringify(result.result),/操作を完了できませんでした/);assert.equal(result.result.files,undefined);assert.ok(!JSON.stringify(result.result).includes('PRIVATE'));
    f.probe[operation]=original;await f.click('history');const report=await f.click('report');assert.ok(!report.result.files[0].attachment.toString('utf8').includes('PRIVATE'));
  }
});
test('the actual benchmark cooldown remains actionable while arbitrary preflight errors are replaced',async()=>{
  let time=0,workers=0;const probe=createVoiceBenchmark({now:()=>time,capacity:async()=>capacity,worker:()=>{workers++;return {ready:Promise.resolve(),async stream(_,__,chunk){time+=100;chunk(wave());},close(){}};},encode:async()=>({packets:1,audioMs:100})});await probe.run('first');
  const f=await fixture();f.probe.run=probe.run;const result=await f.click('start');assert.match(JSON.stringify(result.result),/あと30秒/);assert.equal(workers,1);assert.equal(f.s.busy,false);probe.close();
  const blocked=createVoiceBenchmark({canStart:()=>{throw new Error('PRIVATE_TEXT /PRIVATE_PATH TOKEN=PRIVATE_TOKEN');}});f.probe.run=blocked.run;const denied=await f.click('start');assert.match(JSON.stringify(denied.result),/終了後に測定/);assert.ok(!JSON.stringify(denied.result).includes('PRIVATE'));blocked.close();
});
