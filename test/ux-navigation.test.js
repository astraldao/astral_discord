import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminController,adminScreen} from '../src/admin.js';
import {createVersionController,versionScreen} from '../src/version-ui.js';
import {gameLobby} from '../src/blackjack-ui.js';
import {chipAccountScreen} from '../src/chip-account-ui.js';
import {GameWalletStore} from '../src/game-wallets.js';
const config={lobbyId:'lobby',targetIds:['target'],seconds:5,voice:true,enforce:true,volume:30,words:[],panel:null};
const buttons=m=>m.components.flatMap(r=>r.toJSON().components);
function interaction(customId,user='owner'){return {customId,user:{id:user},channelId:'channel',message:{flags:{has:()=>true}},replies:[],isChatInputCommand:()=>false,async deferReply(){this.deferred=true;},async deferUpdate(){this.deferred=true;},async reply(p){this.replies.push(p);},async editReply(p){this.replies.push(p);}};}
test('shared management home opens a fresh authorized session without reviving an expired screen',async()=>{
  let allowed=true;const c=createAdminController({settings:{get:()=>config},guild:{channels:{cache:new Map()}},access:async()=>allowed});
  const old=c.sessions.create('owner');old.expires=0;
  const home=interaction('admin:open');await c.handle(home);const active=[...c.sessions.sessions.values()][0];
  assert.notEqual(active.id,old.id);assert.equal(active.originChannelId,'channel');assert.ok(buttons(home.replies.at(-1)).some(b=>b.custom_id.endsWith(':open-schedule')));
  allowed=false;const denied=interaction('admin:open','other');await c.handle(denied);assert.equal(denied.replies.at(-1).components.length,0);assert.equal(c.sessions.sessions.size,1);
});
test('admin home highlights setup first, then the common calendar action, while retaining every destination',()=>{
  for(const missing of [true,false]){
    const m=adminScreen({id:'id',view:'home'},missing?{...config,lobbyId:null}:config),b=buttons(m);
    assert.equal(b.find(b=>b.style===1).custom_id,`admin:id:${missing?'nav-vc':'open-schedule'}`);
    for(const action of ['open-trpg','open-densuke','nav-vc','nav-audio','nav-panel','open-forum','open-chips','diagnose','nav-overview','open-updates'])assert.ok(b.some(b=>b.custom_id.endsWith(':'+action)));
  }
});
test('failed version checks retain a usable retry and management home, but not after permission loss',async()=>{
  let allowed=true,fail=true;const data={supported:true,current:{version:'1.0.0',sha:'a'.repeat(40)},latest:null,phase:'idle',checkedAt:null};
  const controller=createVersionController({access:async()=>allowed,updater:{request:async action=>{if(action==='check'&&fail)throw new Error('通信に失敗しました');return data;}}});
  await controller.open(interaction('open'));const s=[...controller.sessions.sessions.values()][0];
  const x=interaction(`updates:${s.id}:${s.turn}:check`);await controller.handle(x);const controls=buttons(x.replies.at(-1));assert.ok(controls.some(b=>b.custom_id.endsWith(':check')));assert.ok(controls.some(b=>b.custom_id==='admin:open'));
  fail=false;await controller.handle(interaction(controls.find(b=>b.custom_id.endsWith(':check')).custom_id));assert.equal(s.turn,1);
  allowed=false;const denied=interaction(`updates:${s.id}:${s.turn}:check`);await controller.handle(denied);assert.equal(denied.replies.at(-1).components.length,0);
});
test('version states show one primary action, side-by-side versions and useful exit/help controls',()=>{
  const current={version:'1.0.0',sha:'a'.repeat(40)},latest={version:'2.0.0',sha:'b'.repeat(40)};
  for(const phase of ['idle','preparing','switching','complete','blocked','failed']){
    const m=versionScreen({id:'id',turn:0,data:{supported:true,current,latest,phase,checkedAt:0}});
    assert.equal(m.embeds[0].toJSON().fields.length,2);assert.equal(buttons(m).filter(b=>b.style===1).length,1);assert.ok(buttons(m).some(b=>b.custom_id==='admin:open'));assert.ok(m.components.length<=5);
  }
  const unavailable=versionScreen({id:'id',turn:0,data:{supported:false,current}});assert.ok(buttons(unavailable).some(b=>b.url?.includes('README')||b.url?.includes('github.com')));
});
test('game and chip screens explain free play and keep management navigation separate from player navigation',()=>{
  const lobby=gameLobby(null,0);assert.match(lobby.embeds[0].toJSON().description,/無料ゲーム/);assert.equal(buttons(lobby).find(b=>b.type===3).options.length,10);
  const wallet=new GameWalletStore();
  const admin=chipAccountScreen({id:'id',turn:0,scope:'admin',view:'list'},wallet),player=chipAccountScreen({id:'id',turn:0,scope:'self',view:'summary',userId:'owner'},wallet);
  assert.ok(buttons(admin).some(b=>b.custom_id==='admin:open'));assert.ok(!buttons(admin).some(b=>b.custom_id==='game:open'));assert.ok(buttons(player).some(b=>b.custom_id==='game:open'));assert.ok(!buttons(player).some(b=>b.custom_id==='admin:open'));
});
