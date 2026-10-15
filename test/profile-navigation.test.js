import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageFlags} from 'discord.js';
import {createProfileController} from '../src/profile-ui.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function interaction(customId='profile:open',privateScreen=false){return {customId,user:{id:'owner'},channelId:'channel',acks:[],message:privateScreen?{flags:{has:flag=>flag===MessageFlags.Ephemeral}}:undefined,async deferReply(p){this.deferred=true;this.acks.push(['reply',p]);},async deferUpdate(){this.deferred=true;this.acks.push(['update']);},async editReply(p){this.result=p;},async reply(p){this.result=p;},async showModal(p){this.modal=p;}};}
test('profile reuses private screens, keeps public entries private, and supports an acknowledged shortcut',async()=>{
  const c=createProfileController({store:{get:()=>null},access:async()=>({displayName:'Name'})});
  for(const [i,ack] of [[interaction(), 'reply'],[interaction('profile:open',true),'update'],[{...interaction(undefined,true),deferred:true},null]]){
    if(ack)await c.handle(i);else await c.open(i);
    assert.equal(i.acks.length,ack?1:0);if(ack)assert.equal(i.acks[0][0],ack);if(ack==='reply')assert.equal(i.acks[0][1].flags,MessageFlags.Ephemeral);
    assert.deepEqual(i.result.attachments,[]);assert.ok(i.result.components.flatMap(r=>r.toJSON().components).some(b=>b.custom_id==='menu:open'));
  }
});
test('opening a new profile screen cannot evict a pending save or bypass current access',async()=>{
  let complete,value=null,allowed=true;const c=createProfileController({store:{get:()=>value,set:async(_,next)=>{await new Promise(resolve=>complete=resolve);value=next;}},access:async()=>{if(!allowed)throw new Error('revoked');return {displayName:'Name'};}});
  await c.open(interaction());const s=[...c.sessions.sessions.values()][0];await c.handle(interaction(`profile:${s.id}:form`));
  const submit={...interaction(`profile:${s.id}:submit:${s.formToken}`),fields:{getTextInputValue:()=> 'ナマエ'}},saving=c.handle(submit);await tick();assert.equal(s.busy,true);
  const duplicate=interaction('profile:open',true);await c.handle(duplicate);assert.match(duplicate.result.embeds[0].toJSON().description,/処理中/);assert.equal(c.sessions.sessions.get(s.id),s);assert.equal(value,null);
  complete();await saving;assert.equal(value,'ナマエ');assert.deepEqual(submit.result.attachments,[]);
  allowed=false;const denied=interaction('profile:open',true);await c.handle(denied);assert.equal(c.sessions.sessions.get(s.id),s);assert.ok(!JSON.stringify(denied.result).includes('ナマエ'));
});
test('expired personal screens return to personal navigation instead of requesting admin access',async()=>{
  const c=createProfileController({store:{get:()=>null},access:async()=>({displayName:'Name'})}),i=interaction('profile:missing:home',true);await c.handle(i);
  const m=i.result.embeds[0].toJSON().description;assert.match(m,/自分の読み方/);assert.ok(!m.includes('/admin'));
});
