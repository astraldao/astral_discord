import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RuntimeEnvStore} from '../src/runtime-env.js';
import {createRuntimeEnvController,runtimeEnvScreen} from '../src/runtime-env-ui.js';
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'astral-runtime-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'runtime-env.json'),store=await new RuntimeEnvStore(file,{base:{ASTRAL_BACKUP_TTS:'0',VOICEVOX_BACKUP_THREADS:'2',DISCORD_TOKEN:'NEVER_DISPLAY'}}).load();return {dir,file,store};}
function i(customId,extra={}){return {customId,user:{id:'owner'},channelId:'channel',message:{flags:{has:()=>true}},async deferUpdate(){this.deferred=true;},async deferReply(){this.deferred=true;},async reply(m){this.result=m;},async editReply(m){this.result=m;},async showModal(m){this.modal=m;},...extra};}
test('only named non-secret values persist privately and apply on a later startup',async t=>{
  const f=await fixture(t),before=f.store.snapshot();assert.ok(!JSON.stringify(before).includes('NEVER_DISPLAY'));
  await f.store.save('ASTRAL_BACKUP_TTS','1',before.revision);assert.equal(f.store.snapshot().running.ASTRAL_BACKUP_TTS,'0');assert.equal(f.store.snapshot().effective.ASTRAL_BACKUP_TTS,'1');assert.equal(f.store.snapshot().pending,true);assert.equal((await stat(f.file)).mode&0o777,0o600);
  const next=await new RuntimeEnvStore(f.file,{base:{DISCORD_TOKEN:'NEVER_DISPLAY'}}).load(),env={DISCORD_TOKEN:'unchanged',GUILD_ID:'unchanged'};next.apply(env);assert.equal(env.ASTRAL_BACKUP_TTS,'1');assert.equal(env.VOICEVOX_BACKUP_THREADS,'2');assert.equal(env.DISCORD_TOKEN,'unchanged');assert.equal(env.GUILD_ID,'unchanged');assert.equal(next.snapshot().pending,false);
  assert.ok(!String(await readFile(f.file)).includes('TOKEN'));await f.store.save('ASTRAL_BACKUP_TTS',null,f.store.snapshot().revision);assert.equal(f.store.snapshot().effective.ASTRAL_BACKUP_TTS,'0');
});
test('arbitrary variables, injected values, stale changes and permission loss cannot write',async t=>{
  const f=await fixture(t),rev=f.store.snapshot().revision;
  for(const [key,value] of [['DISCORD_TOKEN','NEVER_DISPLAY'],['GUILD_ID','123'],['VOICEVOX_PYTHON','/tmp/evil'],['ASTRAL_BACKUP_TTS','1\nSECRET=bad'],['VOICEVOX_BACKUP_THREADS','8']])await assert.rejects(f.store.save(key,value,rev));
  let checks=0;await assert.rejects(f.store.save('ASTRAL_BACKUP_TTS','1',rev,async()=>{if(++checks===2)throw new Error('revoked');}));assert.equal(f.store.snapshot().revision,rev);
  const first=f.store.save('ASTRAL_BACKUP_TTS','1',rev),second=f.store.save('VOICEVOX_BACKUP_THREADS','4',rev);await first;await assert.rejects(second,/別の操作/);assert.equal(f.store.snapshot().effective.VOICEVOX_BACKUP_THREADS,'2');
});
test('persisted unknown keys and corrupt files never enter the process environment',async t=>{
  const f=await fixture(t);
  for(const data of [{version:1,values:{DISCORD_TOKEN:'NEVER_DISPLAY'}},{version:1,values:{ASTRAL_BACKUP_TTS:'bad'}},{version:2,values:{}},{version:1,values:{},extra:'bad'}]){await writeFile(f.file,JSON.stringify(data));await assert.rejects(new RuntimeEnvStore(f.file).load(),/確認できません/);}
  await writeFile(f.file,'x'.repeat(16385));await assert.rejects(new RuntimeEnvStore(f.file).load());
});
test('runtime settings require review and fresh authorization, and never render token values',async t=>{
  const f=await fixture(t);let allowed=true;const c=createRuntimeEnvController({store:f.store,access:async()=>{if(!allowed)throw new Error('permission');}}),open=i();await c.open(open);const s=[...c.sessions.sessions.values()][0];
  const click=(action,extra)=>i(`runtime:${s.id}:${s.turn}:${action}`,extra),edit=click('edit',{values:['ASTRAL_BACKUP_TTS']});await c.handle(edit);assert.ok(edit.modal);assert.equal(edit.deferred,undefined);
  await c.handle(i(edit.modal.toJSON().custom_id,{fields:{getTextInputValue:()=> '1'}}));assert.equal(f.store.snapshot().effective.ASTRAL_BACKUP_TTS,'0');assert.equal(s.stage.value,'1');
  allowed=false;const save=click('save');await c.handle(save);assert.equal(f.store.snapshot().effective.ASTRAL_BACKUP_TTS,'0');allowed=true;await c.handle(click('save'));assert.equal(f.store.snapshot().effective.ASTRAL_BACKUP_TTS,'1');
  for(const m of [open.result,runtimeEnvScreen(s,f.store)]){assert.ok(!JSON.stringify(m).includes('NEVER_DISPLAY'));for(const row of m.components)row.toJSON();assert.ok(m.components.length<=5);assert.deepEqual(m.attachments,[]);}
});
test('foreign users, channels, expired sessions and obsolete forms cannot alter runtime settings',async t=>{
  const f=await fixture(t),c=createRuntimeEnvController({store:f.store,access:async()=>{}});await c.open(i());const s=[...c.sessions.sessions.values()][0],click=(a,x)=>i(`runtime:${s.id}:${s.turn}:${a}`,x);
  for(const extra of [{user:{id:'other'}},{channelId:'other'}]){const x=click('edit',{...extra,values:['ASTRAL_BACKUP_TTS']});await c.handle(x);assert.equal(x.modal,undefined);}
  const first=click('edit',{values:['ASTRAL_BACKUP_TTS']});await c.handle(first);const second=click('edit',{values:['VOICEVOX_BACKUP_THREADS']});await c.handle(second);
  await c.handle(i(first.modal.toJSON().custom_id,{fields:{getTextInputValue:()=> '1'}}));assert.equal(s.stage,null);
  const forbidden=click('edit',{values:['DISCORD_TOKEN']});await c.handle(forbidden);assert.equal(forbidden.modal,undefined);
  s.expires=0;await c.handle(click('save'));assert.deepEqual(f.store.snapshot().values,{});
});
