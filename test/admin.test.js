import test from 'node:test';
import assert from 'node:assert/strict';
import {PermissionsBitField,PermissionFlagsBits as P} from 'discord.js';
import {AdminSessions,adminScreen,adminModal,changeSettings,createAdminController} from '../src/admin.js';
const id='111111111111111111',target='222222222222222222';
const defaults=()=>({version:1,lobbyId:id,targetIds:[target],seconds:5,volume:30,voice:true,enforce:true,words:[],panel:null});
const permissions=new PermissionsBitField(P.Administrator);
const canAdmin=i=>i.memberPermissions.has(P.Administrator);
function fixture(){
  let c=defaults(),reservations=0,changes=0;
  const settings={get:()=>structuredClone(c),async update(fn){const next=structuredClone(c);fn(next);c=next;return settings.get();}};
  const guild={channels:{cache:new Map(),async fetch(){return {type:2,permissionsFor:()=>({has:()=>true})};}},members:{me:{}}};
  const controller=createAdminController({settings,guild,access:async i=>canAdmin(i),refreshPanel:async()=>{},changed:()=>changes++,pendingCount:()=>reservations});
  const interaction=(customId,extra={})=>({customId,user:{id:'owner'},memberPermissions:permissions,deferred:false,replied:false,
    isChatInputCommand:()=>!customId,isModalSubmit:()=>customId?.includes('submit-')??false,message:{},
    async deferReply(){this.deferred=true;},async deferUpdate(){this.deferred=true;},async editReply(m){this.result=m;},async reply(m){this.replied=true;this.result=m;},async showModal(m){this.modal=m;},...extra});
  return {settings,guild,controller,interaction,setReservations:n=>reservations=n,changes:()=>changes};
}
test('all admin pages, largest lists and modals serialize within Discord limits',()=>{
  const s=new AdminSessions().create('owner'),c=defaults();
  c.targetIds=Array.from({length:125},(_,i)=>String(222222222222222222n+BigInt(i)));
  c.words=Array.from({length:100},(_,i)=>({surface:`name${i}`,reading:'ナマエ'}));
  for(const view of ['home','category-schedule','category-voice','category-appearance','category-operations','vc','audio','words','panel','overview','pick-lobby','pick-add','pick-remove']){
    s.view=view;s.page=99;
    const message=adminScreen(s,c);
    assert.ok(message.embeds[0].toJSON().description.length<4096);
    assert.ok(message.components.length<=5);
    for(const row of message.components)row.toJSON();
  }
  for(const kind of ['seconds','volume','word'])adminModal(s,kind,c).toJSON();
});

test('banner entry remains admin-only and returning home clears private preview attachments',async()=>{
  const f=fixture();let allowed=true,opened=0;
  const c=createAdminController({settings:f.settings,guild:f.guild,access:async()=>allowed,openBanner:async()=>opened++});
  const s=c.sessions.create('owner'),i=f.interaction(`admin:${s.id}:open-banner`);await c.handle(i);assert.equal(opened,1);
  allowed=false;await c.handle(f.interaction(`admin:${s.id}:open-banner`));assert.equal(opened,1);
  allowed=true;const home=f.interaction('admin:open');await c.handle(home);assert.deepEqual(home.result.attachments,[]);assert.equal(home.result.files,undefined);
});
test('sessions bind the owner, expire and invalidate older screens',()=>{
  let now=0;const sessions=new AdminSessions(()=>now),s=sessions.create('owner');
  assert.throws(()=>sessions.get(s.id,'stranger'));
  now=600000;assert.throws(()=>sessions.get(s.id,'owner'));
  const fresh=sessions.create('owner');sessions.create('owner');assert.throws(()=>sessions.get(fresh.id,'owner'));
});
test('category navigation clears drafts without writing settings or cancelling reservations',async()=>{
  const f=fixture(),s=f.controller.sessions.create('owner'),before=f.settings.get();f.setReservations(2);
  for(const category of ['schedule','voice','appearance','operations']){
    s.stage={action:'voice',value:false};s.formDraft={kind:'volume',value:'20'};s.wordEditSurface='old';
    const i=f.interaction(`admin:${s.id}:category`,{values:[category]});await f.controller.handle(i);
    assert.equal(s.view,`category-${category}`);assert.equal(s.stage,null);assert.equal(s.formDraft,undefined);assert.equal(s.wordEditSurface,undefined);
    assert.ok(i.result.components.flatMap(r=>r.toJSON().components).some(c=>c.custom_id===`admin:${s.id}:home`));
  }
  assert.deepEqual(f.settings.get(),before);assert.equal(f.changes(),0);
  for(const values of [[],['unknown'],['voice','operations']]){await f.controller.handle(f.interaction(`admin:${s.id}:category`,{values}));assert.equal(s.view,'category-operations');}
  await f.controller.handle(f.interaction(`admin:${s.id}:category`,{values:['voice'],memberPermissions:new PermissionsBitField()}));assert.equal(s.view,'category-operations');
});
test('settings retain existing data and reject invalid changes',()=>{
  const c=defaults();changeSettings(c,'word-add',{surface:'Astral',reading:'あすとらる'});
  assert.equal(c.words[0].reading,'アストラル');assert.equal(c.lobbyId,id);
  assert.throws(()=>changeSettings(structuredClone(c),'seconds','3.5'));
  assert.throws(()=>changeSettings(structuredClone(c),'volume','99'));
  assert.throws(()=>changeSettings(structuredClone(c),'add',id));
});
test('deletion requires confirmation, back discards changes, stale saves never overwrite',async()=>{
  const f=fixture(),s=f.controller.sessions.create('owner');s.view='vc';
  const act=(name,extra)=>f.interaction(`admin:${s.id}:${name}`,extra);
  await f.controller.handle(act('remove',{values:[target]}));
  assert.equal(f.settings.get().targetIds.length,1);assert.ok(s.stage);
  await f.controller.handle(act('nav-vc'));assert.equal(s.stage,null);
  await f.controller.handle(act('remove',{values:[target]}));
  await f.settings.update(c=>c.seconds=7);
  await f.controller.handle(act('save'));assert.equal(f.settings.get().targetIds.length,1);
  await f.controller.handle(act('nav-vc'));await f.controller.handle(act('remove',{values:[target]}));
  await f.controller.handle(act('save'));assert.equal(f.settings.get().targetIds.length,0);assert.equal(f.changes(),1);
});
test('active reservations require confirmation and every interaction rechecks admin permissions',async()=>{
  const f=fixture(),s=f.controller.sessions.create('owner');s.view='audio';f.setReservations(2);
  await f.controller.handle(f.interaction(`admin:${s.id}:toggle-voice`));
  assert.equal(f.settings.get().voice,true);assert.ok(s.stage);
  await f.controller.handle(f.interaction(`admin:${s.id}:save`,{memberPermissions:new PermissionsBitField()}));
  assert.equal(f.settings.get().voice,true);
  await f.controller.handle(f.interaction(`admin:${s.id}:save`));assert.equal(f.settings.get().voice,false);
});
test('valid modal submits save to the same screen with current values',async()=>{
  const f=fixture(),s=f.controller.sessions.create('owner');s.view='vc';
  await f.controller.handle(f.interaction(`admin:${s.id}:submit-seconds`,{fields:{getTextInputValue:()=> '8'}}));
  assert.equal(f.settings.get().seconds,8);assert.equal(s.view,'vc');assert.equal(f.changes(),1);
});
test('new reservation arriving during save requires confirmation instead of being silently cancelled',async()=>{
  const f=fixture(),s=f.controller.sessions.create('owner');s.view='audio';
  const update=f.settings.update;
  f.settings.update=async fn=>{f.setReservations(1);return update(fn);};
  await f.controller.handle(f.interaction(`admin:${s.id}:submit-volume`,{fields:{getTextInputValue:()=> '20'}}));
  assert.equal(f.settings.get().volume,30);assert.ok(s.stage);assert.equal(f.changes(),0);
  await f.controller.handle(f.interaction(`admin:${s.id}:save`));assert.equal(f.settings.get().volume,20);
});
test('forms are opened without deferring the interaction and denied channel permissions never save',async()=>{
  const f=fixture(),s=f.controller.sessions.create('owner');s.view='vc';
  const form=f.interaction(`admin:${s.id}:form-seconds`);
  await f.controller.handle(form);assert.ok(form.modal);assert.equal(form.deferred,false);
  f.guild.channels.fetch=async()=>({type:2,permissionsFor:()=>({has:()=>false})});
  await f.controller.handle(f.interaction(`admin:${s.id}:add`,{values:['333333333333333333']}));
  assert.deepEqual(f.settings.get().targetIds,[target]);assert.equal(f.changes(),0);
});
test('setup guidance and unavailable install/delete actions reflect actual configuration',()=>{
  const s=new AdminSessions().create('owner'),c=defaults();c.lobbyId=null;c.targetIds=[];
  assert.ok(adminScreen(s,c).embeds[0].toJSON().description.includes('初期設定'));
  s.view='panel';assert.equal(adminScreen(s,c).components[0].toJSON().components[0].disabled,true);
  s.view='vc';assert.equal(adminScreen(s,c).components[0].toJSON().components[2].disabled,true);
  s.stage={action:'remove',description:'入室先から削除'};
  assert.equal(adminScreen(s,c).components[0].toJSON().components[0].style,4);
});
test('invalid setting inputs are retained for correction without being persisted',async()=>{
  const f=fixture(),s=f.controller.sessions.create('owner');s.view='vc';
  const act=(a,extra)=>f.interaction(`admin:${s.id}:${a}`,extra);
  await f.controller.handle(act('submit-seconds',{fields:{getTextInputValue:()=> '20'}}));
  assert.equal(f.settings.get().seconds,5);
  const form=act('form-seconds');await f.controller.handle(form);
  assert.equal(form.modal.toJSON().components[0].components[0].value,'20');
  await f.controller.handle(act('submit-seconds',{fields:{getTextInputValue:()=> '8'}}));
  assert.equal(f.settings.get().seconds,8);assert.equal(s.formDraft,undefined);
  s.view='words';
  await f.controller.handle(act('submit-word',{fields:{getTextInputValue:key=>key==='surface'?'Astral':'invalid'}}));
  assert.equal(f.settings.get().words.length,0);
  const word=act('form-word');await f.controller.handle(word);
  assert.equal(word.modal.toJSON().components[0].components[0].value,'Astral');assert.equal(word.modal.toJSON().components[1].components[0].value,'invalid');
  await f.controller.handle(act('nav-audio'));assert.equal(s.formDraft,undefined);
});
test('editing a dictionary entry prefills values, renames in place and clears editing context',async()=>{
  const f=fixture();await f.settings.update(c=>c.words=[{surface:'Astral',reading:'アストラル'},{surface:'Other',reading:'アザー'}]);const s=f.controller.sessions.create('owner');s.view='words';
  const edit=f.interaction(`admin:${s.id}:word-edit`,{values:['Astral']});await f.controller.handle(edit);assert.ok(edit.modal);assert.equal(edit.deferred,false);
  assert.deepEqual(edit.modal.toJSON().components.map(r=>r.components[0].value),['Astral','アストラル']);
  await f.controller.handle(f.interaction(`admin:${s.id}:submit-word:${s.wordModal.token}`,{fields:{getTextInputValue:k=>k==='surface'?'Astral New':'あすとらる'}}));
  assert.equal(f.settings.get().words.length,2);assert.ok(!f.settings.get().words.some(w=>w.surface==='Astral'));assert.ok(f.settings.get().words.some(w=>w.surface==='Astral New'&&w.reading==='アストラル'));assert.equal(s.wordEditSurface,undefined);
});
test('dictionary rename rejects conflicting entries and keeps invalid input for correction',async()=>{
  const f=fixture();await f.settings.update(c=>c.words=[{surface:'Astral',reading:'アストラル'},{surface:'Other',reading:'アザー'}]);const s=f.controller.sessions.create('owner');s.view='words';
  const act=(a,extra)=>f.interaction(`admin:${s.id}:${a}${a==='submit-word'?':'+s.wordModal?.token:''}`,extra);await f.controller.handle(act('word-edit',{values:['Astral']}));
  await f.controller.handle(act('submit-word',{fields:{getTextInputValue:k=>k==='surface'?'Other':'アストラル'}}));assert.equal(f.settings.get().words[0].surface,'Astral');assert.equal(f.settings.get().words[1].reading,'アザー');
  const fix=act('form-word');await f.controller.handle(fix);assert.equal(fix.modal.toJSON().components[0].components[0].value,'Other');assert.equal(s.wordEditSurface,'Astral');
  const fresh=act('form-new-word');await f.controller.handle(fresh);assert.equal(s.wordEditSurface,undefined);assert.ok(fresh.modal.toJSON().components.every(r=>!r.components[0].value));
});
test('old dictionary edit forms cannot overwrite a different entry or a concurrent correction',async()=>{
  const f=fixture();await f.settings.update(c=>c.words=[{surface:'Astral',reading:'アストラル'},{surface:'Other',reading:'アザー'}]);const s=f.controller.sessions.create('owner');s.view='words';
  const edit=async(surface)=>{const i=f.interaction(`admin:${s.id}:word-edit`,{values:[surface]});await f.controller.handle(i);return i.modal.toJSON().custom_id;};
  const old=await edit('Astral'),current=await edit('Other');
  const submit=async(customId)=>f.controller.handle(f.interaction(customId,{fields:{getTextInputValue:k=>k==='surface'?'Mistaken':'ミステイク'}}));
  await submit(old);assert.deepEqual(f.settings.get().words.map(w=>w.surface),['Astral','Other']);
  await f.settings.update(c=>c.words[1].reading='アザーズ');await submit(current);assert.equal(f.settings.get().words[1].reading,'アザーズ');assert.ok(!f.settings.get().words.some(w=>w.surface==='Mistaken'));
});
