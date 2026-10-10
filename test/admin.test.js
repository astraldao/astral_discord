import test from 'node:test';
import assert from 'node:assert/strict';
import {PermissionsBitField,PermissionFlagsBits as P} from 'discord.js';
import {AdminSessions,adminScreen,adminModal,changeSettings,createAdminController} from '../src/admin.js';
const id='111111111111111111',target='222222222222222222';
const defaults=()=>({version:1,lobbyId:id,targetIds:[target],seconds:5,volume:30,voice:true,enforce:true,words:[],panel:null});
const permissions=new PermissionsBitField(P.Administrator);
function fixture(){
  let c=defaults(),reservations=0,changes=0;
  const settings={get:()=>structuredClone(c),async update(fn){const next=structuredClone(c);fn(next);c=next;return settings.get();}};
  const guild={channels:{cache:new Map(),async fetch(){return {type:2,permissionsFor:()=>({has:()=>true})};}},members:{me:{}}};
  const controller=createAdminController({settings,guild,refreshPanel:async()=>{},changed:()=>changes++,pendingCount:()=>reservations});
  const interaction=(customId,extra={})=>({customId,user:{id:'owner'},memberPermissions:permissions,deferred:false,replied:false,
    isChatInputCommand:()=>!customId,isModalSubmit:()=>customId?.includes('submit-')??false,message:{},
    async deferReply(){this.deferred=true;},async deferUpdate(){this.deferred=true;},async editReply(m){this.result=m;},async reply(m){this.replied=true;this.result=m;},async showModal(m){this.modal=m;},...extra});
  return {settings,guild,controller,interaction,setReservations:n=>reservations=n,changes:()=>changes};
}
test('all admin pages, largest lists and modals serialize within Discord limits',()=>{
  const s=new AdminSessions().create('owner'),c=defaults();
  c.targetIds=Array.from({length:125},(_,i)=>String(222222222222222222n+BigInt(i)));
  c.words=Array.from({length:100},(_,i)=>({surface:`name${i}`,reading:'ナマエ'}));
  for(const view of ['home','vc','audio','words','panel','overview','pick-lobby','pick-add','pick-remove']){
    s.view=view;s.page=99;
    const message=adminScreen(s,c);
    assert.ok(message.embeds[0].toJSON().description.length<4096);
    assert.ok(message.components.length<=5);
    for(const row of message.components)row.toJSON();
  }
  for(const kind of ['seconds','volume','word'])adminModal(s,kind,c).toJSON();
});
test('sessions bind the owner, expire and invalidate older screens',()=>{
  let now=0;const sessions=new AdminSessions(()=>now),s=sessions.create('owner');
  assert.throws(()=>sessions.get(s.id,'stranger'));
  now=600000;assert.throws(()=>sessions.get(s.id,'owner'));
  const fresh=sessions.create('owner');sessions.create('owner');assert.throws(()=>sessions.get(fresh.id,'owner'));
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
