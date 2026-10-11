import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PermissionFlagsBits as P,MessageFlags} from 'discord.js';
import {TrpgStore,visibleCharacters,ownCharacter,iacharaUrl,roomUrl,searchScenarios,MAX_TXT} from '../src/trpg-store.js';
import {characterText,createIacharaClient} from '../src/iachara.js';
import {createTrpgController,trpgPanel} from '../src/trpg-ui.js';
const sheet={version:'6th',profile:{name:'テストPC',profession:'司書'},abilities:{str:{value:12},dex:{value:11},edu:{value:14},con:{value:12},siz:{value:13},pow:{value:10},int:{value:13}},battleSkills:{static:[{name:'回避',professionPoint:10}]},searchSkills:{static:[{name:'目星',defaultPoint:25,interestPoint:40}]},memo:'秘密のメモ',battle:[{name:'武器',damage:'1D4'}],belongings:[{name:'本'}],additionalMemo:[{text:'追加の秘密'}],customField:'拡張項目も残す'};
const response=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'astral-trpg-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=await new TrpgStore(join(dir,'trpg.json')).load();const secret=await store.addPanel('channel','secret'),shared=await store.addPanel('other','shared');await store.saveCharacter(secret,'owner','https://iachara.com/view/101',{name:'秘密PC',txt:'秘密TXT'});await store.saveCharacter(shared,'owner','https://iachara.com/view/102',{name:'公開PC',txt:'非公開TXT'});return {store,secret,shared};}
test('restrict network and stored room URLs to exact HTTPS hosts',()=>{assert.equal(iacharaUrl('https://iachara.com/view/123/'),'https://iachara.com/view/123');for(const url of ['http://iachara.com/view/1','https://iachara.com.evil/view/1','https://u:p@iachara.com/view/1','https://iachara.com:444/view/1','https://iachara.com/view/1?token=x','https://iachara.com/view/1#x','https://iachara.com/edit/1','https://127.0.0.1/view/1'])assert.throws(()=>iacharaUrl(url));assert.equal(roomUrl('https://ccfolia.com/rooms/demo_1'),'https://ccfolia.com/rooms/demo_1');assert.throws(()=>roomUrl('https://ccfolia.com.evil/rooms/demo'));});
test('secret panels allow owner and admin, shared panels expose only names and URLs',async t=>{const {store,secret,shared}=await fixture(t),d=store.get();assert.deepEqual(visibleCharacters(d,secret,'other'),[]);assert.equal(visibleCharacters(d,secret,'owner').length,1);assert.equal(visibleCharacters(d,secret,'other',true).length,1);const publicData=visibleCharacters(d,shared,'other');assert.equal(publicData[0].name,'公開PC');assert.equal(JSON.stringify(publicData).includes('非公開TXT'),false);assert.equal(JSON.stringify(publicData).includes('秘密PC'),false);assert.deepEqual(Object.keys(publicData[0]),['id','name','url']);const id=d.characters[0].id;assert.throws(()=>ownCharacter(d,id,'other',secret));assert.equal(ownCharacter(d,id,'admin',secret,true).txt,'秘密TXT');assert.throws(()=>ownCharacter(d,id,'admin',shared,true));});
test('upserts preserve owner and panel privacy, persist privately, enforce size',async t=>{const {store,secret,shared}=await fixture(t);const old=store.get().characters[0];await store.saveCharacter(secret,'owner',old.url,{name:'改名',txt:'更新TXT'});assert.equal(store.get().characters.length,2);assert.equal(store.get().characters[0].id,old.id);await assert.rejects(store.saveCharacter(secret,'owner',old.url,{name:'不正',txt:'a'.repeat(MAX_TXT+1)}));assert.equal(store.get().characters[0].txt,'更新TXT');const again=await new TrpgStore(store.path).load();assert.equal(again.get().characters[0].txt,'更新TXT');assert.equal((await stat(store.path)).mode&0o777,0o600);assert.equal(visibleCharacters(store.get(),shared,'other').length,1);});
test('scenario search normalizes names and same-name registration updates',async t=>{const {store}=await fixture(t);await store.scenario('ＳＣＥＮＡＲＩＯ','https://ccfolia.com/rooms/first');await store.scenario('scenario','https://ccfolia.com/rooms/second');assert.equal(store.get().scenarios.length,1);assert.equal(searchScenarios(store.get().scenarios,'SCEN')[0].url,'https://ccfolia.com/rooms/second');});
test('backup contains all skills, character info, equipment, notes and lossless original',()=>{const txt=characterText(sheet);for(const value of ['テストPC','司書','目星: 65','回避: 32','秘密のメモ','追加の秘密','拡張項目も残す','武器','本'])assert.ok(txt.includes(value),value);assert.deepEqual(JSON.parse(txt.split('【元データ・復元用JSON】\n')[1]),sheet);assert.throws(()=>characterText({...sheet,version:'future'}));assert.throws(()=>characterText({...sheet,memo:'x'.repeat(MAX_TXT)}));const seventh=characterText({...sheet,version:'7th',abilities:{con:{value:60},siz:{value:65},pow:{value:50},hp:{fixedDiff:0},mp:{fixedDiff:0}},backstory:{ideology:'思想'}});assert.ok(seventh.includes('HP: 12'));assert.ok(seventh.includes('MP: 10'));assert.ok(seventh.includes('思想'));});
test('guest client limits requests, caches token and never requests editing endpoints',async()=>{let clock=100000;const calls=[];const client=createIacharaClient({now:()=>clock,fetchImpl:async(url,opts)=>{calls.push({url,opts});if(url.includes('guestToken'))return response({token:'guest-test'});if(url.includes('signInWithCustomToken'))return response({idToken:'id-test',expiresIn:'3600'});return response({success:true,data:{data:sheet}});}});const result=await client.fetchCharacter('https://iachara.com/view/101');assert.equal(result.name,'テストPC');assert.equal(calls.length,3);assert.equal(calls[2].opts.headers.Authorization,'Bearer id-test');await assert.rejects(client.fetchCharacter('https://iachara.com/view/101'));clock+=5000;await client.fetchCharacter('https://iachara.com/view/102');assert.equal(calls.length,4);assert.ok(calls.every(c=>c.opts.redirect==='error'));assert.ok(calls.filter(c=>c.url.includes('/charasheet/')).every(c=>!c.opts.method));});
test('public panel never embeds stored characters or TXT',()=>{const p=trpgPanel({id:'panel',mode:'secret'});const s=JSON.stringify(p);assert.ok(s.includes('秘匿モード'));assert.ok(s.includes('本人と管理者'));assert.ok(!s.includes('https://iachara.com/view/'));});
function interaction(id,userId,admin=false){const replies=[];return {customId:id,user:{id:userId},memberPermissions:{has:p=>p===P.Administrator && admin},channelId:'channel',message:{id:'message',flags:{has:()=>false}},replies,async reply(p){this.replied=true;replies.push(p);},async deferReply(p){this.deferred=true;replies.push(p);},async editReply(p){replies.push(p);},async showModal(p){replies.push(p);},fields:{getTextInputValue:()=> 'https://iachara.com/view/101'}};}
test('controller rejects forged sessions, other users TXT and revoked administrator access',async t=>{const {store,secret}=await fixture(t);const guild={channels:{cache:new Map()}};const c=createTrpgController({access:async i=>i.memberPermissions.has(P.Administrator),store,guild});const s=c.sessions.create('owner');Object.assign(s,{isAdmin:false,view:'detail',panelId:secret,characterId:store.get().characters[0].id});const attacker=interaction(`trpg:${s.id}:download`,'attacker');await c.handle(attacker);assert.equal(attacker.replies[0].flags,MessageFlags.Ephemeral);assert.ok(!JSON.stringify(attacker.replies).includes('秘密TXT'));const otherSession=c.sessions.create('other');Object.assign(otherSession,{view:'detail',panelId:secret,characterId:s.characterId});const other=interaction(`trpg:${otherSession.id}:download`,'other');await c.handle(other);assert.ok(!JSON.stringify(other.replies).includes('秘密TXT'));const adminSession=c.sessions.create('admin');Object.assign(adminSession,{entry:'admin',isAdmin:true,view:'scenarios',page:0});const revoked=interaction(`trpg:${adminSession.id}:next`,'admin');await c.handle(revoked);assert.ok(JSON.stringify(revoked.replies).includes('管理者専用'));});
test('controller serves owner and administrator downloads ephemerally; failed update keeps backup',async t=>{const {store,secret}=await fixture(t);const c=createTrpgController({access:async i=>i.memberPermissions.has(P.Administrator),store,guild:{channels:{cache:new Map()}},iachara:{fetchCharacter:async()=>{throw new Error('site unavailable');}}});for(const [user,admin] of [['owner',false],['admin',true]]){const s=c.sessions.create(user);Object.assign(s,{view:'detail',panelId:secret,characterId:store.get().characters[0].id});const i=interaction(`trpg:${s.id}:download`,user,admin);await c.handle(i);assert.equal(i.replies[0].flags,MessageFlags.Ephemeral);assert.equal(i.replies[1].files[0].attachment.toString(),'秘密TXT');}const s=c.sessions.create('owner');Object.assign(s,{view:'detail',panelId:secret,characterId:store.get().characters[0].id});await c.handle(interaction(`trpg:${s.id}:refresh`,'owner'));assert.equal(store.get().characters[0].txt,'秘密TXT');});
test('maximum UI lists, text previews and scenario pages fit Discord limits',async t=>{const {store,secret}=await fixture(t);await store.update(d=>{d.scenarios=Array.from({length:200},(_,n)=>({id:`scenario-${n}`,name:'名'.repeat(100),url:'https://ccfolia.com/rooms/example'}));d.characters[0].txt='*'.repeat(2800);d.panels.push(...Array.from({length:28},(_,n)=>({id:`panel-${n}`,channelId:'channel',mode:'secret'})));});const c=createTrpgController({access:async i=>i.memberPermissions.has(P.Administrator),store,guild:{channels:{cache:new Map([['channel',{name:'名'.repeat(100)}]])}}});const s=c.sessions.create('owner');Object.assign(s,{entry:'admin',isAdmin:true,view:'scenarios',page:0,panelId:secret,characterId:store.get().characters[0].id});for(const action of ['scenarios','next','archives','next','preview','next']){const i=interaction(`trpg:${s.id}:${action}`,'owner',true);await c.handle(i);const p=i.replies.at(-1);assert.ok(!p.embeds[0].data.title.includes('操作できません'));for(const embed of p.embeds){const data=embed.toJSON();assert.ok(data.description.length<=4096);}for(const component of p.components)component.toJSON();assert.ok(p.components.length<=5);assert.deepEqual(p.attachments,[]);}});
test('registration quota and simultaneous writes preserve existing records',async t=>{const {store,secret}=await fixture(t);await Promise.all(Array.from({length:8},(_,n)=>store.saveCharacter(secret,'owner',`https://iachara.com/view/${200+n}`,{name:`PC${n}`,txt:'backup'})));assert.equal(store.get().characters.filter(c=>c.ownerId==='owner').length,10);await assert.rejects(store.saveCharacter(secret,'owner','https://iachara.com/view/999',{name:'PC',txt:'backup'}));assert.equal(store.get().characters.length,10);});
test('guest service failures and oversized responses cannot create empty backups',async()=>{for(const r of [new Response('',{status:401}),new Response('bad',{headers:{'content-length':'2000000'}}),response({token:'x'})]){const c=createIacharaClient({fetchImpl:async()=>r});await assert.rejects(c.fetchCharacter('https://iachara.com/view/101'));}});
test('screen navigation never clones the whole TXT archive',async t=>{const {store,secret}=await fixture(t);const c=createTrpgController({access:async i=>i.memberPermissions.has(P.Administrator),store,guild:{channels:{cache:new Map()}}});const s=c.sessions.create('owner');Object.assign(s,{view:'characters',panelId:secret,page:0});store.get=()=>{throw new Error('FULL_ARCHIVE_COPY');};const i=interaction(`trpg:${s.id}:characters`,'owner');await c.handle(i);assert.ok(JSON.stringify(i.replies).includes('秘密PC'));assert.ok(!JSON.stringify(i.replies).includes('FULL_ARCHIVE_COPY'));});
test('guest client caps the total bytes across character and additional memos',async()=>{let count=0;const d={...sheet,additionalMemoIds:['memo1','memo2','memo3']};const client=createIacharaClient({fetchImpl:async url=>{if(url.includes('guestToken'))return response({token:'guest-test'});if(url.includes('signInWithCustomToken'))return response({idToken:'id-test',expiresIn:'3600'});if(url.includes('/charasheet/'))return response({success:true,data:{data:d}});count++;return response({memo:{text:'x'.repeat(140000)}});}});await assert.rejects(client.fetchCharacter('https://iachara.com/view/101'));assert.ok(count<3,'must stop before requesting all large memos');});
test('an administrator revoked while fetching cannot overwrite another user backup',async t=>{const {store,secret}=await fixture(t);let admin=true;const checks=[];const guild={channels:{cache:new Map(),fetch:async()=>({permissionsFor:()=>({has:()=>true})})},members:{async fetch(options){checks.push(options);return {permissions:{has:()=>admin}};}}};const c=createTrpgController({store,guild,iachara:{async fetchCharacter(){admin=false;return {name:'changed',txt:'changed'};}}});const s=c.sessions.create('admin');Object.assign(s,{view:'detail',panelId:secret,characterId:store.get().characters[0].id});const i=interaction(`trpg:${s.id}:refresh`,'admin',true);await c.handle(i);assert.equal(store.get().characters[0].txt,'秘密TXT');assert.ok(JSON.stringify(i.replies).includes('管理者権限が変更'));assert.equal(checks.length,2);assert.ok(checks.every(x=>x.force===true));});
test('stale interaction permissions cannot authorize a TXT download',async t=>{const {store,secret}=await fixture(t);const c=createTrpgController({store,guild:{channels:{cache:new Map(),fetch:async()=>({permissionsFor:()=>({has:()=>true})})},members:{fetch:async()=>({permissions:{has:()=>false}})}}});const s=c.sessions.create('admin');Object.assign(s,{view:'detail',panelId:secret,characterId:store.get().characters[0].id});const i=interaction(`trpg:${s.id}:download`,'admin',true);await c.handle(i);assert.ok(i.replies.every(p=>!p.files));assert.ok(!JSON.stringify(i.replies).includes('秘密TXT'));});
test('a superseded session cannot save a late character fetch',async t=>{const {store,secret}=await fixture(t);let c; c=createTrpgController({access:async()=>false,store,guild:{channels:{cache:new Map()}},iachara:{async fetchCharacter(){c.sessions.create('owner');return {name:'changed',txt:'changed'};}}});const s=c.sessions.create('owner');Object.assign(s,{view:'detail',panelId:secret,characterId:store.get().characters[0].id});await c.handle(interaction(`trpg:${s.id}:refresh`,'owner'));assert.equal(store.get().characters[0].txt,'秘密TXT');});
test('all guest requests share an operation deadline and abort without returning data',async()=>{const controller=new AbortController();let calls=0;const client=createIacharaClient({timeoutSignal:()=>controller.signal,fetchImpl:async(url,options)=>{assert.ok(options.signal);calls++;if(url.includes('guestToken'))return response({token:'guest-test'});if(url.includes('signInWithCustomToken'))return response({idToken:'id-test',expiresIn:'3600'});controller.abort(new Error('operation deadline'));assert.equal(options.signal.aborted,true);return response({success:true,data:{data:sheet}});}});await assert.rejects(client.fetchCharacter('https://iachara.com/view/101'),/operation deadline/);assert.equal(calls,3);});
test('deeply nested or excessively wide source data is rejected before pretty formatting',()=>{let nested='secret';for(let i=0;i<50;i++)nested={child:nested};assert.throws(()=>characterText({...sheet,custom:nested}),/構造が複雑/);assert.throws(()=>characterText({...sheet,custom:Array(11000).fill(0)}),/構造が複雑/);});
test('loss of channel visibility blocks a stale shared-panel session',async t=>{const {store,shared}=await fixture(t);const c=createTrpgController({store,guild:{members:{fetch:async()=>({permissions:{has:()=>false}})},channels:{cache:new Map(),fetch:async()=>({permissionsFor:()=>({has:()=>false})})}}});const s=c.sessions.create('other');Object.assign(s,{originChannelId:'channel',view:'characters',panelId:shared,page:0});const i=interaction(`trpg:${s.id}:next`,'other');await c.handle(i);assert.ok(!JSON.stringify(i.replies).includes('公開PC'));assert.ok(JSON.stringify(i.replies).includes('閲覧権限がありません'));});
test('permission changes during acknowledgement are checked before backup read',async t=>{const {store,secret}=await fixture(t);let admin=true;const c=createTrpgController({access:async()=>admin,store,guild:{channels:{cache:new Map()}}});const s=c.sessions.create('admin');Object.assign(s,{view:'detail',panelId:secret,characterId:store.get().characters[0].id});const i=interaction(`trpg:${s.id}:download`,'admin',true);const ack=i.deferReply.bind(i);i.deferReply=async p=>{await ack(p);admin=false;};await c.handle(i);assert.ok(i.replies.every(p=>!p.files));assert.ok(!JSON.stringify(i.replies).includes('秘密TXT'));});
test('session origin binding does not confuse the chosen installation channel',async t=>{const {store}=await fixture(t);const c=createTrpgController({access:async()=>true,store,guild:{channels:{cache:new Map()}}});const s=c.sessions.create('admin');Object.assign(s,{entry:'admin',isAdmin:true,view:'install',originChannelId:'channel',mode:'secret'});const choose=interaction(`trpg:${s.id}:channel`,'admin',true);choose.values=['destination'];await c.handle(choose);assert.equal(s.channelId,'destination');const mode=interaction(`trpg:${s.id}:mode`,'admin',true);mode.values=['shared'];await c.handle(mode);assert.equal(s.mode,'shared');const wrong=interaction(`trpg:${s.id}:mode`,'admin',true);wrong.channelId='different-origin';wrong.values=['secret'];await c.handle(wrong);assert.equal(s.mode,'shared');assert.ok(JSON.stringify(wrong.replies).includes('元のチャンネル'));});

const componentIds=p=>p.components.flatMap(r=>r.toJSON().components.map(c=>c.custom_id));
test('administrator panel entry stays in character views and keeps authorized TXT access',async t=>{
  const {store,secret}=await fixture(t);
  await store.update(d=>{d.panels.find(p=>p.id===secret).messageId='message';});
  const c=createTrpgController({access:async()=>true,store,guild:{channels:{cache:new Map()}}});
  const open=interaction(`trpg:p:${secret}:open`,'admin',true);
  await c.handle(open);
  const s=[...c.sessions.sessions.values()][0];
  assert.equal(s.entry,'panel');
  assert.ok(componentIds(open.replies.at(-1)).every(id=>!id.endsWith(':home')));
  const select=interaction(`trpg:${s.id}:character`,'admin',true);
  select.values=[store.get().characters[0].id];
  await c.handle(select);
  assert.equal(s.view,'detail');
  const download=interaction(`trpg:${s.id}:download`,'admin',true);
  await c.handle(download);
  assert.equal(download.replies.at(-1).files[0].attachment.toString(),'秘密TXT');
  const back=interaction(`trpg:${s.id}:characters`,'admin',true);
  await c.handle(back);
  assert.equal(s.view,'characters');
  assert.ok(componentIds(back.replies.at(-1)).every(id=>!id.endsWith(':home')));
  const before=store.get();
  for(const action of ['home','scenarios','archives','install','mode','channel','place','form-scenario','form-scenario-edit','form-search','submit-scenario','submit-search','clear-search','scenario','archive-panel']){
    const forged=interaction(`trpg:${s.id}:${action}`,'admin',true);
    forged.values=['shared'];
    await c.handle(forged);
    assert.ok(JSON.stringify(forged.replies).includes('/admin から開いてください'),action);
    assert.equal(s.view,'characters',action);
    assert.deepEqual(store.get(),before,action);
  }
});
test('management entry retains archive navigation and back to management',async t=>{
  const {store,secret}=await fixture(t);
  const c=createTrpgController({access:async()=>true,store,guild:{channels:{cache:new Map()}}});
  const open=interaction('unused','admin',true);
  await c.open(open);
  const s=[...c.sessions.sessions.values()][0];
  assert.equal(s.entry,'admin');assert.equal(s.view,'home');
  await c.handle(interaction(`trpg:${s.id}:archives`,'admin',true));
  const select=interaction(`trpg:${s.id}:archive-panel`,'admin',true);select.values=[secret];
  await c.handle(select);
  assert.ok(componentIds(select.replies.at(-1)).includes(`trpg:${s.id}:archives`));
  await c.handle(interaction(`trpg:${s.id}:archives`,'admin',true));
  assert.equal(s.view,'archives');
  await c.handle(interaction(`trpg:${s.id}:home`,'admin',true));
  assert.equal(s.view,'home');
});
test('sessions without explicit management entry fail closed even for administrators',async t=>{
  const {store}=await fixture(t);
  const c=createTrpgController({access:async()=>true,store,guild:{channels:{cache:new Map()}}});
  const s=c.sessions.create('admin');
  const i=interaction(`trpg:${s.id}:home`,'admin',true);
  await c.handle(i);
  assert.ok(JSON.stringify(i.replies).includes('/admin から開いてください'));
  assert.ok(!JSON.stringify(i.replies).includes('ベース卓を登録'));
});
test('existing character panels refresh in place, preserve privacy and isolate unavailable messages',async t=>{
  const {store,secret,shared}=await fixture(t);
  await store.update(d=>{d.panels[0].messageId='message';d.panels[1].messageId='missing';});
  const edits=[];
  const c=createTrpgController({store,guild:{channels:{async fetch(channelId){return {messages:{async fetch(messageId){if(messageId==='missing')throw new Error('not found');return {async edit(payload){edits.push({channelId,messageId,payload});}};}}};}}}});
  assert.deepEqual(await c.refreshPanels(),{updated:1,failed:1});
  assert.equal(edits[0].channelId,'channel');assert.equal(edits[0].messageId,'message');
  const panel=JSON.stringify(edits[0].payload);
  assert.ok(panel.includes(`trpg:p:${secret}:open`));assert.ok(panel.includes('秘匿'));
  assert.ok(!panel.includes('秘密PC'));assert.ok(!panel.includes('秘密TXT'));
  assert.equal(store.metadata().panels.find(p=>p.id===shared).messageId,'missing');
});
test('search can be cleared and TXT preview returns to detail without crossing panel scope',async t=>{
  const {store,secret}=await fixture(t);
  const c=createTrpgController({store,access:async()=>true,guild:{channels:{cache:new Map()}}});
  const s=c.sessions.create('admin');Object.assign(s,{entry:'admin',view:'scenarios',query:'no match',page:0});
  const clear=interaction(`trpg:${s.id}:clear-search`,'admin',true);await c.handle(clear);
  assert.equal(s.query,'');assert.equal(s.view,'scenarios');
  Object.assign(s,{entry:'panel',view:'preview',panelId:secret,characterId:store.metadata().characters[0].id});
  const detail=interaction(`trpg:${s.id}:detail`,'admin',true);await c.handle(detail);
  assert.equal(s.view,'detail');assert.ok(componentIds(detail.replies.at(-1)).includes(`trpg:${s.id}:characters`));
  assert.ok(componentIds(detail.replies.at(-1)).every(id=>!id?.endsWith(':home')&&!id?.endsWith(':archives')));
});

test('direct registration opens a private scoped modal without an intermediate screen',async t=>{
  const {store,secret}=await fixture(t);
  await store.update(d=>{d.panels.find(p=>p.id===secret).messageId='message';});
  const c=createTrpgController({store,access:async()=>true,guild:{channels:{cache:new Map()}}});
  const i=interaction(`trpg:p:${secret}:register`,'owner',true);await c.handle(i);
  assert.ok(!i.deferred);
  const modal=i.replies.at(-1).toJSON();const s=[...c.sessions.sessions.values()][0];
  assert.equal(modal.custom_id,`trpg:${s.id}:submit-register`);assert.equal(s.entry,'panel');assert.equal(s.panelId,secret);
  const wrong=interaction(`trpg:p:${secret}:register`,'attacker');wrong.message.id='copied-message';await c.handle(wrong);
  assert.equal(wrong.replies.at(-1).flags,MessageFlags.Ephemeral);assert.ok(!wrong.replies.at(-1).toJSON);
});
test('PC search and own filter only inspect already-visible metadata and never expose foreign TXT',async t=>{
  const {store,secret,shared}=await fixture(t);
  await store.saveCharacter(shared,'other','https://iachara.com/view/103',{name:'Other PC',txt:'other private backup'});
  const c=createTrpgController({store,access:async()=>false,guild:{channels:{cache:new Map()}}});
  const s=c.sessions.create('owner');Object.assign(s,{entry:'panel',view:'characters',panelId:shared,page:0});
  const act=async(action,query)=>{const i=interaction(`trpg:${s.id}:${action}`,'owner');if(query!==undefined)i.fields={getTextInputValue:()=>query};await c.handle(i);return i.replies.at(-1);};
  assert.ok(JSON.stringify(await act('characters')).includes('Other PC'));
  const mine=JSON.stringify(await act('mine'));assert.ok(mine.includes('公開PC'));assert.ok(!mine.includes('Other PC'));
  assert.ok(!mine.includes('非公開TXT'));assert.ok(!mine.includes('other private backup'));
  await act('clear-pc-filter');
  const search=JSON.stringify(await act('submit-pc-search','ＯＴＨＥＲ'));assert.ok(search.includes('Other PC'));assert.ok(!search.includes('公開PC'));
  const foreign=store.metadata().characters.find(c=>c.ownerId==='other');
  const select=interaction(`trpg:${s.id}:character`,'owner');select.values=[foreign.id];await c.handle(select);
  assert.ok(!JSON.stringify(select.replies).includes('other private backup'));
  s.panelId=secret;await act('clear-pc-filter');
  const hidden=JSON.stringify(await act('submit-pc-search','Other'));assert.ok(!hidden.includes('Other PC'));assert.ok(!hidden.includes(foreign.url));
});
test('returning from a character detail preserves search and list page',async t=>{
  const {store,secret}=await fixture(t);
  await store.update(d=>{d.characters.push(...Array.from({length:25},(_,n)=>({id:`pc-${n}`,panelId:secret,ownerId:`owner-${n}`,url:`https://iachara.com/view/${500+n}`,name:`PC ${n}`,txt:'*'.repeat(2800),updatedAt:Date.now()})));});
  const c=createTrpgController({store,access:async()=>true,guild:{channels:{cache:new Map()}}});
  const s=c.sessions.create('admin');Object.assign(s,{entry:'panel',view:'characters',panelId:secret,pcQuery:'PC',page:0});
  await c.handle(interaction(`trpg:${s.id}:next`,'admin',true));assert.equal(s.page,1);
  const select=interaction(`trpg:${s.id}:character`,'admin',true);select.values=['pc-10'];await c.handle(select);
  await c.handle(interaction(`trpg:${s.id}:preview`,'admin',true));
  await c.handle(interaction(`trpg:${s.id}:next`,'admin',true));
  const back=interaction(`trpg:${s.id}:characters`,'admin',true);await c.handle(back);
  assert.equal(s.page,1);assert.equal(s.pcQuery,'PC');assert.equal(s.view,'characters');
  const p=back.replies.at(-1);assert.ok(JSON.stringify(p).includes('PC 10'));assert.ok(p.components.length<=5);p.components.forEach(r=>r.toJSON());
});
test('editing a selected base room prefills values while new registration stays blank',async t=>{
  const {store}=await fixture(t);await store.scenario('シナリオ','https://ccfolia.com/rooms/original');
  const c=createTrpgController({store,access:async()=>true,guild:{channels:{cache:new Map()}}});
  const s=c.sessions.create('admin');Object.assign(s,{entry:'admin',view:'scenarios',scenario:store.metadata().scenarios[0]});
  const edit=interaction(`trpg:${s.id}:form-scenario-edit`,'admin',true);await c.handle(edit);
  const fields=edit.replies.at(-1).toJSON().components.map(r=>r.components[0]);
  assert.equal(fields[0].value,'シナリオ');assert.equal(fields[1].value,'https://ccfolia.com/rooms/original');
  const fresh=interaction(`trpg:${s.id}:form-scenario`,'admin',true);await c.handle(fresh);
  assert.ok(fresh.replies.at(-1).toJSON().components.every(r=>!r.components[0].value));
});
test('invalid registration keeps input for correction and does not spend fetch cooldown',async t=>{
  const {store,secret}=await fixture(t);let fetches=0;
  const c=createTrpgController({store,access:async()=>false,guild:{channels:{cache:new Map()}},iachara:{async fetchCharacter(){fetches++;return {name:'updated',txt:'new backup'};}}});
  const s=c.sessions.create('owner');Object.assign(s,{entry:'panel',view:'characters',panelId:secret});
  const invalid=interaction(`trpg:${s.id}:submit-register`,'owner');invalid.fields={getTextInputValue:()=> 'invalid URL'};await c.handle(invalid);
  assert.equal(fetches,0);assert.ok(componentIds(invalid.replies.at(-1)).includes(`trpg:${s.id}:form-register`));
  const fix=interaction(`trpg:${s.id}:form-register`,'owner');await c.handle(fix);
  assert.equal(fix.replies.at(-1).toJSON().components[0].components[0].value,'invalid URL');
  const valid=interaction(`trpg:${s.id}:submit-register`,'owner');await c.handle(valid);assert.equal(fetches,0);assert.equal(s.view,'duplicate');const update=interaction(`trpg:${s.id}:duplicate-update`,'owner');await c.handle(update);
  assert.equal(fetches,1);assert.equal(store.get().characters[0].txt,'new backup');
  assert.ok(update.replies.some(p=>JSON.stringify(p).includes('キャラシを取得中')));
});

test('character removal needs confirmation, rejects stale backups, preserves others and frees quota',async t=>{
  const {store,secret}=await fixture(t);const pc=store.get().characters[0];
  const c=createTrpgController({store,access:async()=>false,guild:{channels:{cache:new Map()}}});
  const s=c.sessions.create('owner');Object.assign(s,{entry:'panel',view:'detail',panelId:secret,characterId:pc.id});
  const act=async a=>{const i=interaction(`trpg:${s.id}:${a}`,'owner');await c.handle(i);return i;};
  await act('confirm-delete-character');assert.equal(store.get().characters.length,2);
  await act('delete-character');assert.equal(s.view,'delete-character');assert.equal(store.get().characters.length,2);
  await act('detail');await act('confirm-delete-character');assert.equal(store.get().characters.length,2);
  await act('delete-character');await store.saveCharacter(secret,'owner',pc.url,{name:'new',txt:'updated'});
  await act('confirm-delete-character');assert.equal(store.get().characters.length,2);
  await act('delete-character');await act('confirm-delete-character');assert.equal(store.get().characters.length,1);assert.equal(s.view,'characters');
  await store.saveCharacter(secret,'owner',pc.url,{name:'registered again',txt:'fresh'});assert.notEqual(store.get().characters.find(x=>x.url===pc.url).id,pc.id);
  const reloaded=await new TrpgStore(store.path).load();assert.equal(reloaded.get().characters.length,2);
});
test('foreign users and revoked administrators cannot remove PCs or download foreign ZIPs',async t=>{
  const {store,secret,shared}=await fixture(t);await store.saveCharacter(shared,'other','https://iachara.com/view/333',{name:'other',txt:'foreign secret'});
  let admin=false;const c=createTrpgController({store,access:async()=>admin,guild:{channels:{cache:new Map()}}});
  const s=c.sessions.create('stranger');Object.assign(s,{entry:'panel',view:'detail',panelId:secret,characterId:store.get().characters[0].id});
  await c.handle(interaction(`trpg:${s.id}:delete-character`,'stranger'));assert.equal(store.get().characters.length,3);
  s.panelId=shared;s.view='characters';const empty=interaction(`trpg:${s.id}:backup-panel`,'stranger');await c.handle(empty);assert.ok(empty.replies.every(p=>!p.files));
  const owner=c.sessions.create('owner');Object.assign(owner,{entry:'panel',view:'characters',panelId:shared});
  const own=interaction(`trpg:${owner.id}:backup-panel`,'owner');await c.handle(own);assert.equal(own.replies[0].flags,MessageFlags.Ephemeral);
  const zip=own.replies.at(-1).files[0].attachment;assert.ok(zip.includes(Buffer.from('非公開TXT')));assert.ok(!zip.includes(Buffer.from('foreign secret')));
  const forged=interaction(`trpg:${owner.id}:backup-all`,'owner');await c.handle(forged);assert.ok(forged.replies.every(p=>!p.files));
  const a=c.sessions.create('admin');Object.assign(a,{entry:'admin',view:'archives'});admin=true;
  const all=interaction(`trpg:${a.id}:backup-all`,'admin',true);await c.handle(all);assert.ok(all.replies.at(-1).files[0].attachment.includes(Buffer.from('foreign secret')));
  admin=false;const revoked=interaction(`trpg:${a.id}:backup-all`,'admin',true);await c.handle(revoked);assert.ok(revoked.replies.every(p=>!p.files));
});
test('late refresh cannot resurrect a character removed during the external fetch',async t=>{
  const {store,secret}=await fixture(t);const pc=store.get().characters[0];
  const {characterRevision}=await import('../src/trpg-store.js');
  const c=createTrpgController({store,access:async()=>false,guild:{channels:{cache:new Map()}},iachara:{async fetchCharacter(){await store.removeCharacter(pc.id,'owner',secret,false,characterRevision(pc));return {name:'late',txt:'late'};}}});
  const s=c.sessions.create('owner');Object.assign(s,{entry:'panel',view:'detail',panelId:secret,characterId:pc.id});
  await c.handle(interaction(`trpg:${s.id}:refresh`,'owner'));assert.ok(!store.get().characters.some(x=>x.id===pc.id || x.url===pc.url));
});
test('table sets persist privately, reject edit credentials and clean removed PC references',async t=>{
  const {store,secret}=await fixture(t);const {answerUrl,characterRevision}=await import('../src/trpg-store.js');
  for(const u of ['https://densuke.biz/edit?cd=abc&pw=secret','https://densuke.biz/list?cd=abc&pw=secret','https://evil.test/list?cd=abc','http://densuke.biz/list?cd=abc','https://densuke.biz/list?cd=a&cd=b'])assert.throws(()=>answerUrl(u));
  const scenario=await store.scenario('scenario','https://ccfolia.com/rooms/base');
  const id=await store.saveTable(null,'卓A','https://www.densuke.biz/list?cd=abc');const pc=store.get().characters[0];
  await store.setTableScenario(id,scenario);await store.changeTableCharacters(id,[pc.id,pc.id]);assert.deepEqual(store.table(id).characterIds,[pc.id]);
  await assert.rejects(store.changeTableCharacters(id,['unknown']));
  const reloaded=await new TrpgStore(store.path).load();assert.equal(reloaded.table(id).answerUrl,'https://densuke.biz/list?cd=abc');
  await store.removeCharacter(pc.id,'owner',secret,false,characterRevision(pc));assert.deepEqual(store.table(id).characterIds,[]);assert.equal(store.table(id).scenarioId,scenario);
  const revision=JSON.stringify(store.table(id));await store.saveTable(id,'changed','');await assert.rejects(store.removeTable(id,revision));
  await store.removeTable(id,JSON.stringify(store.table(id)));assert.equal(store.get().tables.length,0);assert.equal(store.get().scenarios.length,1);assert.equal(store.get().characters.length,1);
});
test('table workflows cannot be entered from public panel sessions, even by administrators',async t=>{
  const {store,secret}=await fixture(t);const c=createTrpgController({store,access:async()=>true,guild:{channels:{cache:new Map()}}});
  const s=c.sessions.create('admin');Object.assign(s,{entry:'panel',view:'characters',panelId:secret});
  for(const action of ['tables','table','table-select','table-scenario','table-pcs','table-remove-pcs','submit-table','form-table','form-table-edit','table-set-scenario','table-add-characters','table-remove-characters','delete-table','confirm-delete-table','backup-all']){
    const i=interaction(`trpg:${s.id}:${action}`,'admin',true);i.values=['anything'];await c.handle(i);assert.ok(JSON.stringify(i.replies).includes('/admin から開いてください'),action);assert.equal(s.view,'characters');
  }
  assert.equal(store.get().tables.length,0);
});
test('table creation, editing, selection and deletion work through private management screens',async t=>{
  const {store}=await fixture(t);const scenario=await store.scenario('scenario','https://ccfolia.com/rooms/base');const c=createTrpgController({store,access:async()=>true,guild:{channels:{cache:new Map()}}});
  const s=c.sessions.create('admin');Object.assign(s,{entry:'admin',view:'tables'});
  const act=async(a,values,fields)=>{const i=interaction(`trpg:${s.id}:${a}${a==='submit-table'?':'+s.tableModal?.token:''}`,'admin',true);i.values=values;i.fields={getTextInputValue:k=>fields?.[k]??''};await c.handle(i);return i;};
  await act('form-table');await act('submit-table',[],{name:'卓A',answer:'https://densuke.biz/list?cd=abc'});assert.equal(s.view,'table');const id=s.tableId;
  await act('table-set-scenario',[scenario]);await act('table-add-characters',[store.get().characters[0].id]);
  const show=await act('table');const output=JSON.stringify(show.replies);assert.ok(output.includes('秘密PC'));assert.ok(output.includes('rooms/base'));assert.ok(!output.includes('秘密TXT'));assert.equal(show.replies[0].flags,MessageFlags.Ephemeral);
  const form=await act('form-table-edit');assert.equal(form.replies.at(-1).toJSON().components[0].components[0].value,'卓A');
  await act('submit-table',[],{name:'卓B',answer:''});assert.equal(store.table(id).name,'卓B');assert.equal(store.table(id).answerUrl,'');
  await act('confirm-delete-table');assert.equal(store.get().tables.length,1);
  await act('delete-table');await act('table');await act('confirm-delete-table');assert.equal(store.get().tables.length,1);
  await act('delete-table');await act('confirm-delete-table');assert.equal(store.get().tables.length,0);assert.equal(store.get().characters.length,2);
});
test('maximum table screens fit embed and component limits without exposing TXT',async t=>{
  const {store}=await fixture(t);const {tableScreen}=await import('../src/tables-ui.js');
  await store.update(d=>{d.scenarios=Array.from({length:200},(_,n)=>({id:`s${n}`,name:'名'.repeat(100),url:'https://ccfolia.com/rooms/base'}));d.characters=Array.from({length:100},(_,n)=>({id:`c${n}`,name:'*'.repeat(100),url:`https://iachara.com/view/${n}`,panelId:d.panels[0].id,ownerId:'owner',txt:'SECRET'}));d.tables=Array.from({length:100},(_,n)=>({id:`t${n}`,name:'*'.repeat(100),answerUrl:'https://densuke.biz/list?cd=abc',scenarioId:'s0',characterIds:d.characters.map(c=>c.id)}));});
  for(const view of ['tables','table','table-scenario','table-pcs','table-remove-pcs','delete-table']){const r=tableScreen({id:'session',tableId:'t0',page:0,view},store.metadata());assert.ok(r.body.length<4096,view);assert.ok(!r.body.includes('SECRET'));assert.ok(r.components.length<=5);for(const row of r.components)row.toJSON();}
});
test('old stored data migrates without losing character backups or panel privacy',async t=>{
  const {store}=await fixture(t);const {writeFile}=await import('node:fs/promises');const old=store.get();delete old.tables;await writeFile(store.path,JSON.stringify(old),{mode:0o600});
  const next=await new TrpgStore(store.path).load();assert.deepEqual(next.get().tables,[]);assert.deepEqual(next.get().characters,old.characters);assert.deepEqual(next.get().panels,old.panels);
});
test('outdated table modal cannot overwrite another table or concurrent changes',async t=>{
  const {store}=await fixture(t);const a=await store.saveTable(null,'A',''),b=await store.saveTable(null,'B','');const c=createTrpgController({store,access:async()=>true,guild:{channels:{cache:new Map()}}});
  const s=c.sessions.create('admin');Object.assign(s,{entry:'admin',view:'table',tableId:a});
  await c.handle(interaction(`trpg:${s.id}:form-table-edit`,'admin',true));const oldToken=s.tableModal.token;
  s.tableId=b;await c.handle(interaction(`trpg:${s.id}:form-table-edit`,'admin',true));
  const submit=token=>{const i=interaction(`trpg:${s.id}:submit-table:${token}`,'admin',true);i.fields={getTextInputValue:k=>k==='name'?'OVERWRITE':''};return i;};
  await c.handle(submit(oldToken));assert.equal(store.table(a).name,'A');assert.equal(store.table(b).name,'B');
  await store.saveTable(b,'Changed by another admin','');await c.handle(submit(s.tableModal.token));assert.equal(store.table(b).name,'Changed by another admin');
});

test('table name search keeps the filtered list page when returning from a table',async t=>{
  const {store}=await fixture(t);for(let n=0;n<45;n++)await store.saveTable(null,`Scene ${n}`,'');
  const c=createTrpgController({store,access:async()=>true,guild:{channels:{cache:new Map()}}}),s=c.sessions.create('admin');Object.assign(s,{entry:'admin',view:'tables'});
  const act=async(a,values,query)=>{const i=interaction(`trpg:${s.id}:${a}`,'admin',true);i.values=values;if(query!==undefined)i.fields={getTextInputValue:()=>query};await c.handle(i);return i;};
  const form=await act('form-table-search');const id=form.replies.at(-1).toJSON().custom_id;
  const submit=interaction(id,'admin',true);submit.fields={getTextInputValue:()=> 'ＳＣＥＮＥ'};await c.handle(submit);assert.equal(s.tableQuery,'ＳＣＥＮＥ');
  await act('next');assert.equal(s.tableListPage,1);
  await act('table-select',[store.metadata().tables[25].id]);assert.equal(s.view,'table');
  const back=await act('tables');assert.equal(s.page,1);assert.equal(s.tableQuery,'ＳＣＥＮＥ');assert.ok(JSON.stringify(back.replies).includes('Scene 20'));
  await act('clear-table-search');assert.equal(s.page,0);assert.equal(s.tableQuery,'');
});
test('table scenario and PC searches are separate, bounded and reject obsolete search modals',async t=>{
  const {store}=await fixture(t);const scenario=await store.scenario('Alpha Scenario','https://ccfolia.com/rooms/alpha');await store.scenario('Beta Scenario','https://ccfolia.com/rooms/beta');
  const id=await store.saveTable(null,'卓','');const c=createTrpgController({store,access:async()=>true,guild:{channels:{cache:new Map()}}}),s=c.sessions.create('admin');Object.assign(s,{entry:'admin',view:'table-scenario',tableId:id});
  const open=async a=>{const i=interaction(`trpg:${s.id}:${a}`,'admin',true);await c.handle(i);return i.replies.at(-1).toJSON().custom_id;};
  const submit=async(customId,q)=>{const i=interaction(customId,'admin',true);i.fields={getTextInputValue:()=>q};await c.handle(i);return i;};
  const first=await open('form-table-scenario-search'),second=await open('form-table-scenario-search');await submit(first,'Beta');assert.equal(s.tableScenarioQuery,undefined);
  const result=await submit(second,'ＡＬＰＨＡ');assert.ok(JSON.stringify(result.replies).includes('Alpha Scenario'));assert.ok(!JSON.stringify(result.replies).includes('Beta Scenario'));
  const select=interaction(`trpg:${s.id}:table-set-scenario`,'admin',true);select.values=[scenario];await c.handle(select);
  await c.handle(interaction(`trpg:${s.id}:table-pcs`,'admin',true));await submit(await open('form-table-pc-search'),'秘密');assert.equal(s.tableAddQuery,'秘密');assert.equal(s.tableScenarioQuery,'ＡＬＰＨＡ');
  const pc=store.metadata().characters[0],add=interaction(`trpg:${s.id}:table-add-characters`,'admin',true);add.values=[pc.id];await c.handle(add);
  await c.handle(interaction(`trpg:${s.id}:table-remove-pcs`,'admin',true));await submit(await open('form-table-pc-search'),'公開');assert.equal(s.tableRemoveQuery,'公開');assert.equal(s.tableAddQuery,'秘密');
  assert.ok(!JSON.stringify(result.replies).includes('秘密TXT'));
});
test('table PC preview returns to the same participant page and never crosses public panel scope',async t=>{
  const {store,secret}=await fixture(t);await store.update(d=>{d.characters.push(...Array.from({length:25},(_,n)=>({id:`pc-${n}`,panelId:secret,ownerId:`owner-${n}`,url:`https://iachara.com/view/${800+n}`,name:`PC ${n}`,txt:'PRIVATE BACKUP',updatedAt:Date.now()})));});
  const id=await store.saveTable(null,'卓','');await store.changeTableCharacters(id,store.metadata().characters.slice(2).map(c=>c.id));
  let admin=true;const c=createTrpgController({store,access:async()=>admin,guild:{channels:{cache:new Map()}}}),s=c.sessions.create('admin');Object.assign(s,{entry:'admin',view:'table-remove-pcs',tableId:id,tableRemoveQuery:'PC',page:1});
  const select=interaction(`trpg:${s.id}:table-character`,'admin',true);select.values=['pc-20'];await c.handle(select);assert.equal(s.view,'detail');
  const preview=interaction(`trpg:${s.id}:preview`,'admin',true);await c.handle(preview);assert.ok(JSON.stringify(preview.replies).includes('PRIVATE BACKUP'));assert.ok(componentIds(preview.replies.at(-1)).includes(`trpg:${s.id}:table-return`));
  const back=interaction(`trpg:${s.id}:table-return`,'admin',true);await c.handle(back);assert.equal(s.view,'table-remove-pcs');assert.equal(s.page,1);assert.equal(s.tableRemoveQuery,'PC');assert.ok(!JSON.stringify(back.replies).includes('PRIVATE BACKUP'));
  await c.handle(select);admin=false;const revoked=interaction(`trpg:${s.id}:download`,'admin',true);await c.handle(revoked);assert.ok(revoked.replies.every(p=>!p.files));
  const panel=c.sessions.create('owner');Object.assign(panel,{entry:'panel',view:'characters',panelId:secret,tableId:id});admin=true;
  const forged=interaction(`trpg:${panel.id}:table-character`,'owner',true);forged.values=['pc-20'];await c.handle(forged);assert.equal(panel.view,'characters');assert.ok(!JSON.stringify(forged.replies).includes('PRIVATE BACKUP'));
});
test('base room rename preserves table references and invalid edits keep input for correction',async t=>{
  const {store}=await fixture(t);const scenario=await store.scenario('Original','https://ccfolia.com/rooms/first'),table=await store.saveTable(null,'卓','');await store.setTableScenario(table,scenario);
  const c=createTrpgController({store,access:async()=>true,guild:{channels:{cache:new Map()}}}),s=c.sessions.create('admin');Object.assign(s,{entry:'admin',view:'scenarios',scenario:store.metadata().scenarios[0]});
  const open=async()=>{const i=interaction(`trpg:${s.id}:form-scenario-edit`,'admin',true);await c.handle(i);return i.replies.at(-1).toJSON();};
  const submit=async(id,name,url)=>{const i=interaction(id,'admin',true);i.fields={getTextInputValue:k=>k==='name'?name:url};await c.handle(i);return i;};
  const initial=await open();await submit(initial.custom_id,'Renamed','bad URL');assert.equal(store.metadata().scenarios[0].name,'Original');
  const fix=await open();assert.equal(fix.components[0].components[0].value,'Renamed');assert.equal(fix.components[1].components[0].value,'bad URL');
  await submit(fix.custom_id,'Renamed','https://ccfolia.com/rooms/second');assert.equal(store.metadata().scenarios.length,1);assert.equal(store.metadata().scenarios[0].id,scenario);assert.equal(store.table(table).scenarioId,scenario);
  const again=await open();await store.scenario('Other','https://ccfolia.com/rooms/other');await submit(again.custom_id,'Other','https://ccfolia.com/rooms/new');assert.equal(store.metadata().scenarios.find(x=>x.id===scenario).name,'Renamed');assert.equal(store.metadata().scenarios.length,2);
});
test('old base room forms cannot change a different selection or overwrite concurrent edits',async t=>{
  const {store}=await fixture(t);const a=await store.scenario('A','https://ccfolia.com/rooms/a'),b=await store.scenario('B','https://ccfolia.com/rooms/b');
  const c=createTrpgController({store,access:async()=>true,guild:{channels:{cache:new Map()}}}),s=c.sessions.create('admin');Object.assign(s,{entry:'admin',view:'scenarios',scenario:store.metadata().scenarios[0]});
  const form=async()=>{const i=interaction(`trpg:${s.id}:form-scenario-edit`,'admin',true);await c.handle(i);return i.replies.at(-1).toJSON().custom_id;};
  const old=await form();s.scenario=store.metadata().scenarios.find(x=>x.id===b);const current=await form();
  const submit=async(id)=>{const i=interaction(id,'admin',true);i.fields={getTextInputValue:k=>k==='name'?'Overwrite':'https://ccfolia.com/rooms/new'};await c.handle(i);};
  await submit(old);assert.equal(store.metadata().scenarios.find(x=>x.id===a).name,'A');assert.equal(store.metadata().scenarios.find(x=>x.id===b).name,'B');
  await store.scenario('B','https://ccfolia.com/rooms/concurrent');await submit(current);assert.equal(store.metadata().scenarios.find(x=>x.id===b).url,'https://ccfolia.com/rooms/concurrent');
});

test('table guidance follows setup progress and selected scenario survives search pagination',async t=>{
  const {store}=await fixture(t);const {tableScreen}=await import('../src/tables-ui.js');const id=await store.saveTable(null,'新しい卓','');
  let s={id:'session',view:'table',tableId:id,page:0},result=tableScreen(s,store.metadata());assert.ok(result.body.includes('「シナリオを選ぶ」で'));const controls=()=>result.components.flatMap(r=>r.toJSON().components);assert.equal(controls().find(c=>c.custom_id?.endsWith(':table-remove-pcs')).disabled,true);
  const scenario=await store.scenario('ベース卓','https://ccfolia.com/rooms/base');await store.setTableScenario(id,scenario);result=tableScreen(s,store.metadata());assert.ok(result.body.includes('「参加PCを追加」で'));assert.equal(controls().find(c=>c.custom_id?.endsWith(':table-pcs')).style,1);
  await store.changeTableCharacters(id,[store.metadata().characters[0].id]);result=tableScreen(s,store.metadata());assert.ok(result.body.includes('日程調整を使う場合'));assert.equal(controls().find(c=>c.custom_id?.endsWith(':table-remove-pcs')).disabled,false);
  s.view='table-scenario';result=tableScreen(s,store.metadata());assert.equal(result.components[0].toJSON().components[0].options.find(x=>x.value===scenario).default,true);
  s.view='table-pcs';s.tableAddQuery='存在しない';result=tableScreen(s,store.metadata());assert.ok(result.body.includes('検索を解除'));for(const r of result.components)r.toJSON();assert.ok(result.body.length<4096);
});
test('same-name character choices expose only authorized names and shared URLs',async t=>{
  const {store,secret}=await fixture(t);await store.saveCharacter(secret,'owner','https://iachara.com/view/103',{name:'秘密PC',txt:'SECOND SECRET'});const c=createTrpgController({store,access:async()=>false,guild:{channels:{cache:new Map()}}}),s=c.sessions.create('owner');Object.assign(s,{entry:'panel',view:'characters',panelId:secret,page:0});const i=interaction(`trpg:${s.id}:characters`,'owner');await c.handle(i);const message=i.replies.at(-1),options=message.components.flatMap(r=>r.toJSON().components).find(x=>x.type===3).options;assert.equal(options.length,2);assert.notEqual(options[0].description,options[1].description);assert.ok(!JSON.stringify(message).includes('SECOND SECRET'));assert.ok(!JSON.stringify(message).includes('非公開TXT'));
});
test('selecting a different table clears copy draft and rejects the old copy modal',async t=>{
  const {store}=await fixture(t),a=await store.saveTable(null,'卓A',''),b=await store.saveTable(null,'卓B','');const c=createTrpgController({store,access:async()=>true,guild:{channels:{cache:new Map()}}}),s=c.sessions.create('admin');Object.assign(s,{entry:'admin',view:'table',tableId:a,page:0});await c.handle(interaction(`trpg:${s.id}:form-table-copy`,'admin',true));const token=s.copyModal.token;s.copyName='古い複製';const i=interaction(`trpg:${s.id}:table-select`,'admin',true);i.values=[b];await c.handle(i);assert.equal(s.copyName,undefined);assert.equal(s.copyModal,undefined);await c.handle(interaction(`trpg:${s.id}:submit-table-copy:${token}`,'admin',true));assert.equal(store.metadata().tables.length,2);assert.equal(s.tableId,b);
});

test('table pins enforce a persisted five-table limit even during parallel requests',async t=>{
  const {store}=await fixture(t),ids=[];for(let n=0;n<6;n++)ids.push(await store.saveTable(null,`卓${n}`,''));for(const id of ids.slice(0,4))await store.setTableState(id,'pinned',true,JSON.stringify(store.table(id)));
  const results=await Promise.allSettled(ids.slice(4).map(id=>store.setTableState(id,'pinned',true,JSON.stringify(store.table(id)))));assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(store.metadata().tables.filter(x=>x.pinned).length,5);
  const reload=await new TrpgStore(store.path).load();assert.equal(reload.metadata().tables.filter(x=>x.pinned).length,5);const first=reload.table(ids[0]);await reload.setTableState(first.id,'pinned',false,JSON.stringify(first));assert.equal(reload.metadata().tables.filter(x=>x.pinned).length,4);await assert.rejects(reload.setTableState(first.id,'pinned',true,JSON.stringify(first)));assert.throws(()=>reload.setTableState(first.id,'name',true,JSON.stringify(first)));
});
test('completion retains all URLs, participants and backups; copies start active and unpinned',async t=>{
  const {store}=await fixture(t),scenario=await store.scenario('元卓','https://ccfolia.com/rooms/base'),id=await store.saveTable(null,'完了対象','https://densuke.biz/list?cd=Keep');await store.setTableScenario(id,scenario);await store.changeTableCharacters(id,[store.metadata().characters[0].id]);await store.setTableState(id,'pinned',true,JSON.stringify(store.table(id)));const before=store.get();await store.setTableState(id,'completed',true,JSON.stringify(store.table(id)));const completed=store.table(id);assert.equal(completed.answerUrl,before.tables[0].answerUrl);assert.deepEqual(completed.characterIds,before.tables[0].characterIds);assert.deepEqual(store.get().characters,before.characters);const copy=await store.cloneTable(id,'新しい卓',JSON.stringify(completed));assert.equal(store.table(copy).completed,false);assert.equal(store.table(copy).pinned,false);await store.setTableState(id,'completed',false,JSON.stringify(completed));assert.equal(store.table(id).completed,false);
});
test('table filters sort pins first, search across completed tables, and fit Discord limits',async t=>{
  const {store}=await fixture(t);const {tableScreen}=await import('../src/tables-ui.js');const ids=[];for(let n=0;n<30;n++)ids.push(await store.saveTable(null,`卓${n}`,''));await store.setTableState(ids[27],'pinned',true,JSON.stringify(store.table(ids[27])));await store.setTableState(ids[0],'completed',true,JSON.stringify(store.table(ids[0])));
  const options=r=>r.components.flatMap(x=>x.toJSON().components).find(x=>x.custom_id?.endsWith(':table-select'))?.options??[];
  let s={id:'s',view:'tables',page:0},r=tableScreen(s,store.metadata());assert.equal(options(r)[0].value,ids[27]);assert.ok(!options(r).some(x=>x.value===ids[0]));assert.equal(r.components.length,5);
  s.tableFilter='completed';r=tableScreen(s,store.metadata());assert.deepEqual(options(r).map(x=>x.value),[ids[0]]);s.tableFilter='active';s.tableQuery='卓0';r=tableScreen(s,store.metadata());assert.deepEqual(options(r).map(x=>x.value),[ids[0]]);assert.ok(r.body.includes('すべての卓から検索'));
  s={id:'s',view:'table',tableId:ids[0],page:0};await store.saveTable(ids[0],'卓0','https://densuke.biz/list?cd=test');await store.scenario('シナリオ','https://ccfolia.com/rooms/test');await store.setTableScenario(ids[0],store.metadata().scenarios[0].id);r=tableScreen(s,store.metadata());assert.equal(r.components.length,5);for(const row of r.components)row.toJSON();assert.ok(r.body.length<4096);
});
test('new table actions require management entry and fresh administrator access',async t=>{
  const {store,secret}=await fixture(t),id=await store.saveTable(null,'対象','');const c=createTrpgController({store,access:async i=>i.memberPermissions.has(P.Administrator),guild:{channels:{cache:new Map()}}});
  for(const entry of ['panel','admin'])for(const action of ['pin-table','unpin-table','complete-table','reopen-table','table-filter']){const s=c.sessions.create('owner');Object.assign(s,{entry,view:entry==='admin'?'table':'characters',tableId:id,panelId:secret,tableStateRevision:JSON.stringify(store.table(id))});const i=interaction(`trpg:${s.id}:${action}`,'owner',entry==='panel');i.values=['completed'];const before=store.get();await c.handle(i);assert.deepEqual(store.get(),before,`${entry}:${action}`);assert.ok(JSON.stringify(i.replies).includes('管理者専用'));}
});
test('duplicate registration opens saved PC without a network call or revealing another owner',async t=>{
  const {store,secret}=await fixture(t);let fetches=0;const c=createTrpgController({store,access:async()=>false,guild:{channels:{cache:new Map()}},iachara:{fetchCharacter:async()=>{fetches++;return {name:'新PC',txt:'新しい控え'};}}}),s=c.sessions.create('owner');Object.assign(s,{entry:'panel',view:'characters',panelId:secret});await c.handle(interaction(`trpg:${s.id}:submit-register`,'owner'));assert.equal(s.view,'duplicate');assert.equal(fetches,0);await c.handle(interaction(`trpg:${s.id}:duplicate-open`,'owner'));assert.equal(s.view,'detail');assert.equal(fetches,0);
  const other=c.sessions.create('other');Object.assign(other,{entry:'panel',view:'characters',panelId:secret});const i=interaction(`trpg:${other.id}:submit-register`,'other');await c.handle(i);assert.equal(fetches,1);assert.equal(other.view,'detail');assert.ok(!JSON.stringify(i.replies).includes('秘密PC'));assert.equal(store.metadata().characters.filter(x=>x.panelId===secret && x.url==='https://iachara.com/view/101').length,2);
});
test('removed duplicate PC cannot be silently recreated by stale update controls',async t=>{
  const {store,secret}=await fixture(t);let fetches=0;const c=createTrpgController({store,access:async()=>false,guild:{channels:{cache:new Map()}},iachara:{fetchCharacter:async()=>{fetches++;return {name:'新',txt:'新'};}}}),s=c.sessions.create('owner');Object.assign(s,{entry:'panel',view:'characters',panelId:secret});await c.handle(interaction(`trpg:${s.id}:submit-register`,'owner'));await store.update(d=>{d.characters=d.characters.filter(x=>x.id!==s.duplicate.id);});await c.handle(interaction(`trpg:${s.id}:duplicate-update`,'owner'));assert.equal(fetches,0);assert.equal(store.metadata().characters.filter(x=>x.panelId===secret).length,0);
});

test('administrator table state controls persist and return to the chosen list filter',async t=>{
  const {store}=await fixture(t),id=await store.saveTable(null,'卓','');const c=createTrpgController({store,access:async()=>true,guild:{channels:{cache:new Map()}}}),s=c.sessions.create('admin');Object.assign(s,{entry:'admin',view:'tables',page:0});const act=async(action,values)=>{const i=interaction(`trpg:${s.id}:${action}`,'admin',true);i.values=values;await c.handle(i);return i;};await act('table-select',[id]);await act('pin-table');assert.equal(store.table(id).pinned,true);await act('complete-table');assert.equal(store.table(id).completed,true);await act('table-filter',['completed']);assert.equal(s.tableFilter,'completed');assert.equal(s.page,0);await act('table-select',[id]);await act('tables');assert.equal(s.tableFilter,'completed');await act('table-select',[id]);await act('reopen-table');assert.equal(store.table(id).completed,false);await act('unpin-table');assert.equal(store.table(id).pinned,false);
});
test('legacy table flags remain active and malformed or excessive pins fail on reload',async t=>{
  const {store}=await fixture(t);await store.saveTable(null,'旧卓','');await store.update(d=>{delete d.tables[0].pinned;delete d.tables[0].completed;});const old=await new TrpgStore(store.path).load();const {tableScreen}=await import('../src/tables-ui.js');assert.ok(JSON.stringify(tableScreen({id:'s',view:'tables',page:0},old.metadata())).includes('旧卓'));await store.update(d=>{d.tables[0].pinned='true';});await assert.rejects(new TrpgStore(store.path).load());await store.update(d=>{d.tables[0].pinned=false;});for(let n=0;n<5;n++)await store.saveTable(null,`追加${n}`,'');await store.update(d=>{for(const t of d.tables)t.pinned=true;});await assert.rejects(new TrpgStore(store.path).load());
});
