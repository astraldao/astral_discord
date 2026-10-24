import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageFlags,PermissionFlagsBits as P} from 'discord.js';
import {mainMenuScreen,mainMenuGuideScreen,createMainMenu} from '../src/main-menu.js';
const controls=m=>m.components.flatMap(r=>r.toJSON().components);
function interaction(action,privateScreen=false){return {customId:action?.startsWith('menu:')?action:undefined,user:{id:'owner'},channelId:'text',options:{getString:name=>{assert.equal(name,'操作');return action?.startsWith('menu:')?null:action;}},message:privateScreen?{flags:{has:flag=>flag===MessageFlags.Ephemeral}}:undefined,acks:[],async deferReply(p){this.deferred=true;this.acks.push(['reply',p]);},async deferUpdate(){this.deferred=true;this.acks.push(['update']);},async editReply(p){this.result=p;},async reply(p){this.result=p;}};}
test('hub exposes four purposes and personal shortcuts, with admin controls only for administrators',()=>{
  for(const admin of [false,true]){
    const m=mainMenuScreen({admin}),b=controls(m);
    assert.deepEqual(b.slice(0,4).map(c=>c.custom_id),['menu:vc','menu:read','menu:game','menu:calendar']);
    for(const id of ['menu:profile','menu:wallet','menu:help'])assert.ok(b.some(c=>c.custom_id===id));
    assert.equal(b.some(c=>c.custom_id==='admin:open'),admin);
    assert.equal(b.filter(c=>c.style===1).length,1);
    assert.deepEqual(m.attachments,[]);assert.deepEqual(m.allowedMentions.parse,[]);
    assert.ok(m.components.length<=5);for(const r of m.components)assert.ok(r.toJSON().components.length<=5);
  }
});

const recentOptions=i=>controls(i.result).find(c=>c.custom_id==='menu:recent')?.options??[];
function fixture(){
  let stamp=1000,allowed=true;const calls=[],c=createMainMenu({now:()=>stamp,access:async()=>allowed?{admin:false}:false,
    ...Object.fromEntries(['Vc','Game','Profile','Wallet','Calendar'].map(name=>[`open${name}`,async()=>calls.push(name.toLowerCase())])),
    openRead:async(i,action)=>calls.push(action),
  });
  const run=async(action='menu:open',extra={})=>{const i=Object.assign(interaction(action,true),{user:{id:'PRIVATE_USER_SENTINEL'},channelId:'PRIVATE_CHANNEL_SENTINEL'},extra);await c.handle(i);return i;};
  return {c,run,calls,time:value=>stamp=value,allow:value=>allowed=value};
}
test('recent destinations are unique, newest first, at most three, and stop never enters history',async()=>{
  const f=fixture();for(const action of ['vc','read','game','calendar','game','stop'])await f.run(`menu:${action}`);
  const i=await f.run();assert.deepEqual(recentOptions(i).map(o=>o.value),['game','calendar','read']);
  assert.ok(!JSON.stringify(i.result).includes('PRIVATE_USER_SENTINEL'));assert.ok(!JSON.stringify(i.result).includes('PRIVATE_CHANNEL_SENTINEL'));
  assert.deepEqual(f.calls,['vc','status','game','calendar','game','stop']);
});
test('recent selection opens the current feature screen, with reading remaining a status operation',async()=>{
  const f=fixture();await f.run('menu:read');f.calls.length=0;
  const i=await f.run('menu:recent',{values:['read']});assert.deepEqual(f.calls,['status']);assert.equal(i.acks.length,1);
});
test('history belongs to the user and channel, and expires ten minutes after the last successful feature opening',async()=>{
  const f=fixture();await f.run('menu:calendar');
  for(const extra of [{user:{id:'other'}},{channelId:'elsewhere'}]){
    assert.equal(recentOptions(await f.run('menu:open',extra)).length,0);
    await f.run('menu:recent',{...extra,values:['calendar']});
  }
  assert.deepEqual(f.calls,['calendar']);
  f.time(600999);assert.equal(recentOptions(await f.run()).length,1);
  // Merely reopening the menu does not extend the retention period.
  f.time(601000);assert.equal(recentOptions(await f.run()).length,0);
  await f.run('menu:recent',{values:['calendar']});assert.deepEqual(f.calls,['calendar']);
});
test('stale or crafted recent values cannot delegate missing, removed or destructive destinations',async()=>{
  const f=fixture();for(const action of ['vc','read','game','calendar'])await f.run(`menu:${action}`);f.calls.length=0;
  for(const values of [undefined,[],['vc'],['stop'],['admin'],['game','calendar'],['__proto__']]){
    const i=await f.run('menu:recent',{values});assert.match(i.result.embeds[0].toJSON().description,/開き直して/);
  }
  assert.deepEqual(f.calls,[]);
});
test('lost visibility suppresses history and prevents recent and guide actions from opening features',async()=>{
  const f=fixture();await f.run('menu:wallet');f.calls.length=0;f.allow(false);
  for(const [action,extra] of [['menu:open',{}],['menu:recent',{values:['wallet']}],['menu:help-topic',{values:['wallet']}],['menu:wallet',{}]]){
    const i=await f.run(action,extra);assert.equal(recentOptions(i).length,0);assert.match(i.result.embeds[0].toJSON().description,/閲覧権限/);
  }
  assert.deepEqual(f.calls,[]);
});
test('history retains only the two hundred most recently opened user-channel destinations',async()=>{
  const f=fixture();for(let n=0;n<200;n++)await f.run('menu:vc',{user:{id:`user${n}`}});
  // Refreshing a destination moves it to the retained end of the bounded map.
  await f.run('menu:read',{user:{id:'user0'}});
  await f.run('menu:game',{user:{id:'user200'}});
  assert.equal(recentOptions(await f.run('menu:open',{user:{id:'user1'}})).length,0);
  assert.deepEqual(recentOptions(await f.run('menu:open',{user:{id:'user0'}})).map(o=>o.value),['read','vc']);
  assert.deepEqual(recentOptions(await f.run('menu:open',{user:{id:'user200'}})).map(o=>o.value),['game']);
});
test('failed feature calls are not remembered and arbitrary permission or controller errors remain private',async()=>{
  for(const failure of ['access','feature']){
    let fail=true;const c=createMainMenu({access:async()=>{if(failure==='access'&&fail)throw new Error('PRIVATE_NATIVE_ACCESS');return {admin:false};},openCalendar:async()=>{if(fail)throw new Error('PRIVATE_NATIVE_FEATURE');}});
    const i=interaction('menu:calendar',true);await c.handle(i);assert.ok(!JSON.stringify(i.result).includes('PRIVATE_NATIVE'));assert.match(i.result.embeds[0].toJSON().description,/開き直して/);
    fail=false;const menu=interaction('menu:open',true);await c.handle(menu);assert.equal(recentOptions(menu).length,0);
  }
});
test('guide topics explain the next step and open existing screens without starting a feature',async()=>{
  const f=fixture(),first=await f.run('menu:help');assert.deepEqual(f.calls,[]);assert.match(first.result.embeds[0].toJSON().description,/普段は/);
  const choices=controls(first.result).find(c=>c.custom_id==='menu:help-topic').options;assert.equal(choices.length,7);
  for(const {value} of choices){
    const i=await f.run('menu:help-topic',{values:[value]}),buttons=controls(i.result);assert.equal(buttons.some(b=>b.custom_id===`menu:${value}`),value!=='dice');assert.ok(buttons.some(b=>b.custom_id==='menu:open'));
    assert.deepEqual(f.calls,[]);assert.deepEqual(i.result.attachments,[]);assert.deepEqual(i.result.allowedMentions.parse,[]);
  }
  const read=await f.run('menu:help-topic',{values:['read']});assert.match(read.result.embeds[0].toJSON().description,/画面を開くだけでは開始しません/);
  await f.run('menu:read');assert.deepEqual(f.calls,['status']);
});
test('guide rejects unknown or multiple topics and every menu variant meets native component limits',async()=>{
  const f=fixture();for(const values of [[],['stop'],['__proto__'],['read','vc']]){const i=await f.run('menu:help-topic',{values});assert.match(i.result.embeds[0].toJSON().description,/選び直して/);}
  assert.deepEqual(f.calls,[]);
  for(const m of [mainMenuScreen({admin:true,recent:['read','read','stop','game','vc','calendar']}),mainMenuGuideScreen(),...['vc','read','game','calendar','profile','wallet'].map(mainMenuGuideScreen)]){
    assert.ok(m.components.length<=5);for(const r of m.components)assert.ok(r.toJSON().components.length<=5);
    for(const control of controls(m)){assert.ok(control.custom_id.length<=100);if(control.options)assert.ok(control.options.length<=25);}
    assert.ok(m.embeds[0].toJSON().description.length<=4096);
  }
});
test('opening hub has no side effects, public entries reply privately, private buttons reuse their screen',async()=>{
  const c=createMainMenu({access:async()=>({admin:false}),openVc:()=>assert.fail(),openRead:()=>assert.fail(),openGame:()=>assert.fail()});
  for(const [i,ack] of [[interaction(null),'reply'],[interaction('menu:open',true),'update'],[interaction('menu:open'),'reply']]){
    await c.handle(i);assert.equal(i.acks.length,1);assert.equal(i.acks[0][0],ack);if(ack==='reply')assert.equal(i.acks[0][1].flags,MessageFlags.Ephemeral);assert.ok(controls(i.result).some(b=>b.custom_id==='menu:vc'));
  }
});
test('shortcuts acknowledge once and delegate without changing the requested operation',async()=>{
  const calls=[],c=createMainMenu({access:async()=>({admin:false}),openVc:async i=>calls.push(['vc',i.deferred]),openGame:async i=>calls.push(['game',i.deferred]),openProfile:async i=>calls.push(['profile',i.deferred]),openWallet:async i=>calls.push(['wallet',i.deferred]),openRead:async(i,action)=>calls.push([action,i.deferred])});
  for(const action of ['vc','read','game','stop','profile','wallet']){for(const input of [action,`menu:${action}`]){const i=interaction(input,true);await c.handle(i);assert.equal(i.acks.length,1);}}
  assert.deepEqual(calls.map(c=>c[0]),['vc','vc','status','status','game','game','stop','stop','profile','profile','wallet','wallet']);assert.ok(calls.every(c=>c[1]));
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

test('calendar has one menu button and delegates its direct shortcut without opening administration',async()=>{
  const calls=[],c=createMainMenu({access:async()=>({admin:false}),openCalendar:async i=>calls.push(i.deferred)});
  assert.equal(controls(mainMenuScreen()).filter(b=>b.custom_id==='menu:calendar').length,1);
  for(const action of ['calendar','menu:calendar']){const i=interaction(action,true);await c.handle(i);assert.equal(i.acks.length,1);}
  assert.deepEqual(calls,[true,true]);
});

test('guidance shows live capability booleans and does not expose arbitrary runtime fields',async()=>{
  let state={readingEnabled:false,diceEnabled:false,diceFullContent:false,token:'PRIVATE_CONFIG_SENTINEL'};
  const c=createMainMenu({access:async()=>({admin:false}),capabilities:()=>state}),run=async(action,values)=>{const i=Object.assign(interaction(action,true),{values});await c.handle(i);return JSON.stringify(i.result);};
  let menu=await run('menu:open');assert.ok(menu.includes('未有効'));assert.ok(menu.includes('現在OFF'));assert.ok(!menu.includes('メンションして使えます'));assert.ok(!menu.includes('PRIVATE_CONFIG'));
  let guide=await run('menu:help-topic',['dice']);assert.ok(guide.includes('現在はOFF'));assert.ok(!guide.includes('メンションが必要'));
  state={readingEnabled:true,diceEnabled:true,diceFullContent:false};menu=await run('menu:open');assert.ok(menu.includes('@Bot 1D100'));assert.ok(!menu.includes('未有効'));guide=await run('menu:help-topic',['dice']);assert.ok(guide.includes('現在はBotへのメンションが必要'));
  state={diceEnabled:true,diceFullContent:true};guide=await run('menu:help-topic',['dice']);assert.ok(guide.includes('通常の投稿から利用できます'));assert.ok(!guide.includes('PRIVATE_CONFIG'));
  for(const value of ['false',0,null])assert.ok(!JSON.stringify(mainMenuScreen({capabilities:{diceEnabled:value,readingEnabled:value}})).includes('現在OFF'));
});

test('live capability reads occur only after access checks and never execute or modify a feature',async()=>{
  let allowed=false,reads=0;const c=createMainMenu({access:async()=>allowed?{admin:false}:false,capabilities:()=>{reads++;return {readingEnabled:false};},openRead:async(_i,action)=>assert.equal(action,'status')});
  await c.handle(interaction('menu:open',true));assert.equal(reads,0);
  allowed=true;await c.handle(interaction('menu:read',true));assert.equal(reads,0);
  await c.handle(Object.assign(interaction('menu:help-topic',true),{values:['read']}));assert.equal(reads,1);
});
