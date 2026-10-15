import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PermissionsBitField,PermissionFlagsBits as P} from 'discord.js';
import {createDiagnostics,diagnosticsScreen,voiceComponents} from '../src/diagnostics.js';
import {createAdminController} from '../src/admin.js';
test('diagnostics lists missing voice files and VC permissions without copying secret settings',async()=>{
  const settings={get:()=>({lobbyId:'111111111111111111',targetIds:['222222222222222222','333333333333333333'],voice:true,densukeEmail:'private@example.com',token:'SECRET_TOKEN'})};
  let checks=0;const guild={channels:{cache:new Map([['111111111111111111',{type:2,permissionsFor:()=>({has:()=>true})}],['222222222222222222',{type:2,permissionsFor:()=>({has:bit=>bit!==P.Speak})}]]),async fetch(){checks++;}},members:{async fetchMe(){checks++;return {};}}};
  const diagnose=createDiagnostics({settings,guild,version:'3.6.0',pendingCount:()=>2,components:async()=>({python:false,runtime:true,model:true,dictionary:false})});
  const data=await diagnose();assert.equal(checks,2);assert.equal(data.channels[0].status,'必要な権限あり');assert.ok(data.channels[1].status.includes('発言'));assert.ok(data.channels[2].status.includes('見つかりません'));
  const out=JSON.stringify(diagnosticsScreen({id:'session',page:0,diagnostics:data}));assert.ok(!out.includes('private@example.com'));assert.ok(!out.includes('SECRET_TOKEN'));assert.ok(out.includes('3.6.0'));assert.ok(out.includes('nav-category-operations'));assert.ok(out.includes('menu:open'));
  data.channels=Array.from({length:126},()=>({...data.channels[1],status:'不足：閲覧・接続・メンバー移動・送信・埋め込み・発言'}));
  const screen=diagnosticsScreen({id:'session',page:0,diagnostics:data});assert.ok(screen.embeds[0].toJSON().description.length<4096);screen.components.forEach(r=>r.toJSON());
});
test('voice file inspection matches configured directories without spawning or exposing paths',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'astral-diagnostic-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  assert.deepEqual(await voiceComponents(dir,{}),{python:false,runtime:false,model:false,dictionary:false});
  for(const path of ['.voicevox-venv/bin/python','voicevox/onnxruntime/lib/libvoicevox_onnxruntime.so.1.17.3','voicevox/models/vvms/0.vvm','voicevox/dict/japanese-plus/sys.dic']){const file=join(dir,path);await mkdir(join(file,'..'),{recursive:true});await writeFile(file,'exists');}
  assert.deepEqual(await voiceComponents(dir,{}),{python:true,runtime:true,model:true,dictionary:true});
  assert.equal((await voiceComponents(dir,{VOICEVOX_DICTIONARY:'missing'})).dictionary,false);
});
test('diagnostic completion rechecks fresh admin access and never displays data after revocation',async()=>{
  let allowed=true;const c=createAdminController({settings:{get:()=>({})},guild:{},access:async()=>allowed,diagnose:async()=>{allowed=false;return {version:'PRIVATE_DIAGNOSTIC'};}});
  const s=c.sessions.create('admin');const replies=[];const i={customId:`admin:${s.id}:diagnose`,user:{id:'admin'},isChatInputCommand:()=>false,isModalSubmit:()=>false,message:{},async deferUpdate(){this.deferred=true;},async editReply(p){replies.push(p);},async reply(p){replies.push(p);}};
  await c.handle(i);assert.ok(!JSON.stringify(replies).includes('PRIVATE_DIAGNOSTIC'));assert.ok(JSON.stringify(replies).includes('管理者権限'));assert.equal(s.diagnostics,undefined);
});
test('admin controller ignores stale interaction permissions and fetches current role by default',async()=>{
  let fetched;const c=createAdminController({settings:{get:()=>({})},guild:{members:{async fetch(options){fetched=options;return {permissions:new PermissionsBitField()};}}}});
  const replies=[];const i={user:{id:'former-admin'},memberPermissions:new PermissionsBitField(P.Administrator),async reply(p){replies.push(p);}};
  await c.handle(i);assert.deepEqual(fetched,{user:'former-admin',force:true});assert.ok(JSON.stringify(replies).includes('管理者専用'));
});

test('backup diagnostics reports only enabled/active flags and keeps the voice announcement setting independent',async()=>{
  const diagnose=createDiagnostics({settings:{get:()=>({lobbyId:null,targetIds:[],voice:false})},guild:{channels:{fetch:async()=>{},cache:new Map()},members:{fetchMe:async()=>({})}},version:'test',pendingCount:()=>0,components:async()=>({}),backupState:()=>({enabled:true,active:true,text:'PRIVATE_TEXT',token:'SECRET'})});
  const data=await diagnose();assert.deepEqual(data.backup,{enabled:true,active:true});assert.equal(data.voiceEnabled,false);
  const out=JSON.stringify(diagnosticsScreen({id:'test',page:0,diagnostics:data}));assert.ok(out.includes('起動設定 ON'));assert.ok(out.includes('使用中'));assert.ok(!out.includes('PRIVATE_TEXT'));assert.ok(!out.includes('SECRET'));
});
