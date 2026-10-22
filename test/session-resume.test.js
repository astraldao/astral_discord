import test from 'node:test';
import assert from 'node:assert/strict';
import {AdminSessions,createAdminController} from '../src/admin.js';
import {adminCategories,adminDestinations} from '../src/admin-navigation.js';
const config={lobbyId:'lobby',targetIds:['target'],seconds:5,volume:30,voice:true,enforce:true,words:[],panel:null};
function interaction(customId){return {customId,user:{id:'owner'},channelId:'channel',isChatInputCommand:()=>false,isModalSubmit:()=>false,message:{flags:{has:()=>true}},async deferUpdate(){this.deferred=true;},async deferReply(){this.deferred=true;},async reply(m){this.result=m;},async editReply(m){this.result=m;}};}
test('resume is bound to owner, source channel, scope and original expiry without creating a session',()=>{
  let time=0;const sessions=new AdminSessions(()=>time),s=sessions.create('owner');s.originChannelId='channel';s.scope='admin';s.query='search';
  time=1000;assert.equal(sessions.resume('owner','channel',s=>s.scope==='admin'),s);assert.equal(s.expires,600000);
  for(const [user,channel,scope] of [['other','channel','admin'],['owner','other','admin'],['owner','channel','viewer']])assert.equal(sessions.resume(user,channel,s=>s.scope===scope),undefined);
  s.busy=true;assert.throws(()=>sessions.resume('owner','channel'),/処理中/);assert.equal(sessions.sessions.get(s.id),s);s.busy=false;
  time=600000;assert.equal(sessions.resume('owner','channel'),undefined);assert.equal(sessions.sessions.size,1);
});
test('recovery buttons open only registered destinations after fresh admin authorization',async()=>{
  let allowed=true,opened=0;const c=createAdminController({settings:{get:()=>config,update:()=>assert.fail('must not save')},guild:{channels:{cache:new Map()}},access:async()=>allowed,openBanner:async()=>opened++});
  for(const category of adminCategories){const i=interaction(`admin:open-section:${category.id}`);await c.handle(i);const s=[...c.sessions.sessions.values()][0];assert.equal(s.view,`category-${category.id}`);assert.equal(s.originChannelId,'channel');}
  await c.handle(interaction('admin:open-feature:open-banner'));assert.equal(opened,1);
  for(const action of ['save','install-panel','toggle-voice','unknown']){const i=interaction(`admin:open-feature:${action}`);await c.handle(i);assert.equal(opened,1);assert.match(i.result.embeds[0].toJSON().description,/選び直し/);}
  allowed=false;for(const id of ['admin:open-feature:open-banner','admin:open-section:appearance'])await c.handle(interaction(id));assert.equal(opened,1);
  assert.equal(adminDestinations.length,15);
});
