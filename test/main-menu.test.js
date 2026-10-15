import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageFlags,PermissionFlagsBits as P} from 'discord.js';
import {mainMenuScreen,createMainMenu} from '../src/main-menu.js';
const controls=m=>m.components.flatMap(r=>r.toJSON().components);
function interaction(action,privateScreen=false){return {customId:action?.startsWith('menu:')?action:undefined,user:{id:'owner'},channelId:'text',options:{getString:name=>{assert.equal(name,'操作');return action?.startsWith('menu:')?null:action;}},message:privateScreen?{flags:{has:flag=>flag===MessageFlags.Ephemeral}}:undefined,acks:[],async deferReply(p){this.deferred=true;this.acks.push(['reply',p]);},async deferUpdate(){this.deferred=true;this.acks.push(['update']);},async editReply(p){this.result=p;},async reply(p){this.result=p;}};}
test('hub exposes three purposes and personal shortcuts, with admin controls only for administrators',()=>{
  for(const admin of [false,true]){
    const m=mainMenuScreen({admin}),b=controls(m);
    assert.deepEqual(b.slice(0,3).map(c=>c.custom_id),['menu:vc','menu:read','menu:game']);
    for(const id of ['profile:open','wallet:open'])assert.ok(b.some(c=>c.custom_id===id));
    assert.equal(b.some(c=>c.custom_id==='admin:open'),admin);
    assert.equal(b.filter(c=>c.style===1).length,1);
    assert.deepEqual(m.attachments,[]);assert.deepEqual(m.allowedMentions.parse,[]);
    assert.ok(m.components.length<=5);for(const r of m.components)assert.ok(r.toJSON().components.length<=5);
  }
});
test('opening hub has no side effects, public entries reply privately, private buttons reuse their screen',async()=>{
  const c=createMainMenu({access:async()=>({admin:false}),openVc:()=>assert.fail(),openRead:()=>assert.fail(),openGame:()=>assert.fail()});
  for(const [i,ack] of [[interaction(null),'reply'],[interaction('menu:open',true),'update'],[interaction('menu:open'),'reply']]){
    await c.handle(i);assert.equal(i.acks.length,1);assert.equal(i.acks[0][0],ack);if(ack==='reply')assert.equal(i.acks[0][1].flags,MessageFlags.Ephemeral);assert.ok(controls(i.result).some(b=>b.custom_id==='menu:vc'));
  }
});
test('shortcuts acknowledge once and delegate without changing the requested operation',async()=>{
  const calls=[],c=createMainMenu({access:async()=>({admin:false}),openVc:async i=>calls.push(['vc',i.deferred]),openGame:async i=>calls.push(['game',i.deferred]),openRead:async(i,action)=>calls.push([action,i.deferred])});
  for(const action of ['vc','read','game','stop']){for(const input of [action,`menu:${action}`]){const i=interaction(input,true);await c.handle(i);assert.equal(i.acks.length,1);}}
  assert.deepEqual(calls.map(c=>c[0]),['vc','vc','status','status','game','game','stop','stop']);assert.ok(calls.every(c=>c[1]));
});
test('fresh member and channel permissions control access and admin visibility on each interaction',async()=>{
  let admin=true,view=true;const fetches=[],c=createMainMenu({guild:{members:{fetch:async o=>{fetches.push(o);return {permissions:{has:p=>p===P.Administrator&&admin}};}},channels:{fetch:async(id,o)=>{assert.equal(id,'text');assert.equal(o.force,true);return {permissionsFor:()=>({has:p=>p===P.ViewChannel&&view})};}}},openVc:()=>assert.fail()});
  const first=interaction();await c.handle(first);assert.ok(controls(first.result).some(b=>b.custom_id==='admin:open'));
  admin=false;const second=interaction('menu:open',true);await c.handle(second);assert.ok(!controls(second.result).some(b=>b.custom_id==='admin:open'));
  view=false;const denied=interaction('vc');await c.handle(denied);assert.match(denied.result.embeds[0].toJSON().description,/閲覧権限/);assert.deepEqual(denied.result.attachments,[]);
  assert.equal(fetches.length,3);assert.ok(fetches.every(o=>o.force&&o.user==='owner'));
});
test('unknown actions and failed access do not reach feature controllers',async()=>{
  const c=createMainMenu({access:async()=>false,openVc:()=>assert.fail(),openGame:()=>assert.fail(),openRead:()=>assert.fail()});
  for(const action of ['menu:unknown','invalid','stop']){const i=interaction(action);await c.handle(i);assert.ok(controls(i.result).some(b=>b.custom_id==='menu:open'));assert.deepEqual(i.result.attachments,[]);}
});
