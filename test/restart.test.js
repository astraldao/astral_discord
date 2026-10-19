import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createManualRestarter} from '../scripts/manual-restart.js';
import {createManualUpdater} from '../scripts/manual-update.js';
import {restartWorker,launchWorker} from '../scripts/supervisor.js';
import {runFile,writeState} from '../scripts/auto-update.js';
import {RuntimeEnvStore} from '../src/runtime-env.js';
import {createRestartController} from '../src/restart-ui.js';
import {createUpdateLifecycle} from '../src/update-lifecycle.js';
const tick=()=>new Promise(r=>setImmediate(r));
async function temp(t){const root=await mkdtemp(join(tmpdir(),'astral-restart-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'data'));return root;}
function restarter(options={}){let job;const presence=[],r=createManualRestarter({restart:async()=>({restored:false}),presence:v=>presence.push(v),schedule:fn=>{job=fn;return 1;},cancel:()=>job=null,...options});return {r,presence,async run(){job();for(let n=0;n<30&&r.busy;n++)await tick();assert.equal(r.busy,false);}};}
test('restart reserves once, waits for acknowledgement and reports busy/fallback outcomes',async()=>{
  let calls=0;const f=restarter({restart:async revision=>{assert.equal(revision,'{}');calls++;return {restored:false};}});
  assert.equal(f.r.request('status').phase,'idle');assert.equal(calls,0);f.r.request('start','{}');assert.throws(()=>f.r.request('start','{}'));assert.equal(calls,0);await f.run();assert.equal(calls,1);assert.equal(f.r.status().phase,'complete');assert.deepEqual(f.presence,[true,false]);
  for(const [code,phase] of [['UPDATE_BUSY','blocked'],['RESTART_CHANGED','blocked'],['bad','failed']]){const x=restarter({restart:async()=>{throw Object.assign(new Error(),{code});}});x.r.request('start','{}');await x.run();assert.equal(x.r.status().phase,phase);assert.deepEqual(x.presence,[true,false]);}
  const fallback=restarter({restart:async()=>({restored:true})});fallback.r.request('start','{}');await fallback.run();assert.equal(fallback.r.status().phase,'restored');
});
test('update and restart cannot overlap even if an update is awaiting its current-version read',async()=>{
  let release;const r=restarter(),u=createManualUpdater({blocked:()=>r.r.busy,current:()=>new Promise(resolve=>release=resolve),latest:async()=>({sha:'b'.repeat(40),version:'2.0.0'}),prepare:()=>assert.fail(),apply:()=>assert.fail()});
  const checking=u.request('check');await tick();assert.equal(u.busy,false);release({sha:'a'.repeat(40),version:'1.0.0'});await checking;
  const starting=u.request('start','b'.repeat(40));await tick();r.r.request('start','{}');release({sha:'a'.repeat(40),version:'1.0.0'});await assert.rejects(starting,/再起動/);u.close();r.r.close();
});
test('freeze validates the confirmed settings revision before stopping and returns only the running whitelist',async()=>{
  let frozen=false;const messages=[],handler=createUpdateLifecycle({busy:()=>false,accept:m=>m.runtimeRevision==='saved',snapshot:()=>({ASTRAL_BACKUP_TTS:'0',VOICEVOX_BACKUP_THREADS:'2'}),freeze:()=>frozen=true,drain:async()=>{},send:(m,done)=>{messages.push(m);done?.();},exit:()=>{}});
  await handler({type:'prepare-update',id:'1',runtimeRevision:'stale'});assert.equal(frozen,false);assert.equal(messages[0].type,'update-busy');await handler({type:'prepare-update',id:'2',runtimeRevision:'saved'});assert.equal(frozen,true);assert.deepEqual(messages[1].runtime,{ASTRAL_BACKUP_TTS:'0',VOICEVOX_BACKUP_THREADS:'2'});
});
async function workerFixture(t){
  const root=await temp(t);await writeFile(join(root,'package.json'),'{"type":"module"}');
  const lifecycle=new URL('../src/update-lifecycle.js',import.meta.url).href;
  await writeFile(join(root,'index.js'),`import {readFile,appendFile} from 'node:fs/promises';import {createUpdateLifecycle} from ${JSON.stringify(lifecycle)};let values={ASTRAL_BACKUP_TTS:'0',VOICEVOX_BACKUP_THREADS:'2'};try{values={...values,...JSON.parse(await readFile('data/runtime-env.json','utf8')).values};}catch{}await appendFile('data/launches.jsonl',JSON.stringify({values,restarting:process.env.ASTRAL_RESTARTING})+'\\n');if(values.ASTRAL_BACKUP_TTS==='1')process.exit(7);const lifecycle=createUpdateLifecycle({busy:()=>false,accept:m=>m.runtimeRevision===undefined||m.runtimeRevision===JSON.stringify(current),snapshot:()=>values,freeze:()=>{},drain:async()=>{},send:(m,done)=>process.send(m,done),exit:c=>process.exit(c)});let current={};try{current=JSON.parse(await readFile('data/runtime-env.json','utf8')).values;}catch{}process.on('message',async m=>{if(m.type==='prepare-update'){try{current=JSON.parse(await readFile('data/runtime-env.json','utf8')).values;}catch{current={};}}await lifecycle(m);});process.send({type:'worker-ready'});`);
  const old=launchWorker(root,root,{timeout:3000});await old.ready;t.after(()=>old.child.kill('SIGKILL'));const children=[];
  const launch=(r,s,o)=>{assert.equal(r,root);assert.equal(s,root);const child=launchWorker(r,s,{...o,timeout:3000});children.push(child);t.after(()=>child.child.kill('SIGKILL'));return child;};return {root,old,launch,children};
}
test('actual IPC restart drains and launches the same local source with pending settings and no release lookup',async t=>{
  const f=await workerFixture(t),store=await new RuntimeEnvStore(join(f.root,'data/runtime-env.json')).load();await store.save('VOICEVOX_BACKUP_THREADS','3',store.snapshot().revision);
  const result=await restartWorker(f.root,f.root,f.old,store.snapshot().revision,{launch:f.launch});assert.equal(result.restored,false);assert.equal((await f.old.exited).code,0);assert.equal(f.children.length,1);
  const launches=(await readFile(join(f.root,'data/launches.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(launches[1].values.VOICEVOX_BACKUP_THREADS,'3');assert.equal(launches[1].restarting,'1');
});
test('failed startup restores the previously running settings, leaves .env untouched and reconnects',async t=>{
  const f=await workerFixture(t),file=join(f.root,'data/runtime-env.json'),store=await new RuntimeEnvStore(file).load();await writeFile(join(f.root,'.env'),'PRIVATE_SENTINEL');await store.save('ASTRAL_BACKUP_TTS','1',store.snapshot().revision);
  const result=await restartWorker(f.root,f.root,f.old,store.snapshot().revision,{launch:f.launch});assert.equal(result.restored,true);assert.equal(f.children.length,2);assert.equal(JSON.parse(await readFile(file,'utf8')).values.ASTRAL_BACKUP_TTS,'0');assert.equal(await readFile(join(f.root,'.env'),'utf8'),'PRIVATE_SENTINEL');
});
test('changed settings and busy workers are rejected before any new process launches',async t=>{
  const root=await temp(t);await assert.rejects(restartWorker(root,root,{},'stale',{launch:()=>assert.fail(),stop:()=>assert.fail()}),e=>e.code==='RESTART_CHANGED');
  await assert.rejects(restartWorker(root,root,{},'{}',{launch:()=>assert.fail(),stop:async()=>false}),e=>e.code==='UPDATE_BUSY');
});
function interaction(id='open',extra={}){return {customId:id,user:{id:'owner'},channelId:'channel',message:{flags:{has:()=>true}},async deferUpdate(){this.deferred=true;},async deferReply(){this.deferred=true;},async editReply(m){this.result=m;},async reply(m){this.result=m;},...extra};}
test('restart UI checks permissions, owner, channel, expiry, confirmation, revision and busy preflight',async t=>{
  const root=await temp(t),store=await new RuntimeEnvStore(join(root,'data/runtime-env.json')).load();let allowed=true,busy=false,starts=0;const c=createRestartController({store,supported:true,access:async i=>{assert.ok(i.deferred||i.replied);if(!allowed)throw new Error('permission');},beforeStart:async()=>{if(busy)throw new Error('busy');},rpc:{request:async action=>{if(action==='restart-start')starts++;return {supported:true,phase:'idle'};}}});
  await c.open(interaction());const s=[...c.sessions.sessions.values()][0],click=(a,e)=>interaction(`restart:${s.id}:${s.turn}:${a}`,e);
  await c.handle(click('start'));assert.equal(starts,0);await c.handle(click('confirm'));
  for(const extra of [{user:{id:'other'}},{channelId:'other'}])await c.handle(click('start',extra));assert.equal(starts,0);
  allowed=false;await c.handle(click('start'));allowed=true;busy=true;await c.handle(click('start'));busy=false;assert.equal(starts,0);
  await store.save('VOICEVOX_BACKUP_THREADS','3',store.snapshot().revision);await c.handle(click('start'));assert.equal(starts,0);await c.handle(click('confirm'));const stale=click('start');await c.handle(click('cancel'));await c.handle(stale);assert.equal(starts,0);
  await c.handle(click('confirm'));await c.handle(click('start'));assert.equal(starts,1);s.expires=0;await c.handle(click('start'));assert.equal(starts,1);
});
test('unsupported supervisors show migration guidance and cannot invoke a local restart fallback',async t=>{
  const root=await temp(t),store=await new RuntimeEnvStore(join(root,'data/runtime-env.json')).load(),c=createRestartController({store,supported:false,access:async()=>{},rpc:{request:()=>assert.fail()}}),i=interaction();await c.open(i);assert.ok(JSON.stringify(i.result).includes('Quaxly'));const s=[...c.sessions.sessions.values()][0];await c.handle(interaction(`restart:${s.id}:0:start`));assert.ok(!i.result.components.flatMap(r=>r.toJSON().components).some(b=>b.label==='再起動する'));
});
test('Quaxly fast startup loads the saved local release entrypoint instead of the old root supervisor',async t=>{
  const root=await temp(t),sha='a'.repeat(40);await mkdir(join(root,'scripts'));await mkdir(join(root,'.astral-updates',sha),{recursive:true});await writeFile(join(root,'package.json'),'{"type":"module"}');for(const file of ['auto-update.js','bounded-response.js'])await writeFile(join(root,'scripts',file),await readFile(new URL(`../scripts/${file}`,import.meta.url)));await writeState(root,{sha,release:sha,previous:null,failed:null});await writeFile(join(root,'index.js'),`throw new Error('old root must not run');`);await writeFile(join(root,'.astral-updates',sha,'index.js'),`console.log(process.env.ASTRAL_DATA_ROOT===process.cwd()?'selected':'wrong');`);
  const sh=await readFile(new URL('../quaxly-bootstrap.sh',import.meta.url),'utf8'),program=sh.match(/exec node --input-type=module - <<'JS'\n([\s\S]*?)\nJS/)[1];assert.equal((await runFile(process.execPath,['--input-type=module','-e',program],{cwd:root,capture:true})).trim(),'selected');
});
