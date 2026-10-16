import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageFlags,PermissionFlagsBits as P} from 'discord.js';
import {commands} from '../src/commands.js';
import {adminDestinations,adminCategories} from '../src/admin-navigation.js';
import {createAdminController,adminScreen} from '../src/admin.js';
import {createTrpgController} from '../src/trpg-ui.js';
import {TrpgStore} from '../src/trpg-store.js';
import {createDensukeController} from '../src/densuke-ui.js';
import {createForumTagsController} from '../src/forum-tags.js';
const config={lobbyId:'lobby',targetIds:['target'],seconds:5,volume:30,voice:true,enforce:true,words:[],panel:null};
function interaction(action){return {user:{id:'owner'},channelId:'channel',options:{getString:key=>{assert.equal(key,'操作');return action;}},acks:[],isChatInputCommand:()=>true,isModalSubmit:()=>false,async deferReply(p){this.deferred=true;this.acks.push(p);},async deferUpdate(){assert.fail('already acknowledged');},async editReply(p){this.result=p;},async reply(p){this.result=p;}};}
function controller(extra={}){return createAdminController({settings:{get:()=>structuredClone(config),update:()=>assert.fail('navigation must not write')},guild:{channels:{cache:new Map()}},access:async()=>true,changed:()=>assert.fail('navigation must not cancel reservations'),pendingCount:()=>2,...extra});}
test('every direct admin choice opens its exact destination once without changing settings',async()=>{
  const choices=commands().find(c=>c.name==='admin').toJSON().options[0].choices;
  assert.equal(new Set(choices.map(c=>c.value)).size,14);
  assert.deepEqual(choices.map(c=>c.value),adminDestinations.map(d=>d.action));
  for(const d of adminDestinations){
    const calls=[],hooks={};
    for(const [action,hook] of [['open-schedule','openSchedule'],['open-trpg','openTrpg'],['open-densuke','openDensuke'],['open-banner','openBanner'],['open-forum','openForum'],['open-updates','openUpdates'],['open-chips','openChips'],['open-runtime','openRuntime'],['open-restart','openRestart']])hooks[hook]=async i=>{assert.equal(i.deferred,true);calls.push(action);};
    const c=controller({...hooks,diagnose:async()=>{calls.push('diagnose');return {version:'test',node:'test',uptime:0,pending:2,voiceEnabled:true,voice:{},channels:[]};}}),i=interaction(d.action);await c.handle(i);
    assert.equal(i.acks.length,1);assert.equal(i.acks[0].flags,MessageFlags.Ephemeral);
    const s=[...c.sessions.sessions.values()][0];assert.equal(s.originChannelId,'channel');
    if(d.action.startsWith('nav-')){assert.equal(s.view,d.action.slice(4));assert.ok(i.result.embeds[0].toJSON().description);}
    else {assert.deepEqual(calls,[d.action]);if(d.action==='diagnose'){assert.equal(s.view,'diagnostics');assert.match(i.result.embeds[0].toJSON().description,/Bot/);}}
  }
});
test('direct commands reject non-admins, unknown actions and writes before dispatch',async()=>{
  let allowed=false,opened=0;const c=controller({access:async()=>allowed,openBanner:async()=>opened++});
  await c.handle(interaction('open-banner'));assert.equal(c.sessions.sessions.size,0);assert.equal(opened,0);
  allowed=true;
  for(const action of ['save','install-panel','form-word','nav-category-voice','unknown']){await c.handle(interaction(action));assert.equal(opened,0);const s=[...c.sessions.sessions.values()][0];assert.equal(s.view,'home');}
});
test('a second direct command cannot replace a busy management session',async()=>{
  let complete,opened=0;const c=controller({openBanner:async()=>{opened++;await new Promise(resolve=>complete=resolve);}}),first=c.handle(interaction('open-banner'));
  await new Promise(resolve=>setImmediate(resolve));const s=[...c.sessions.sessions.values()][0];assert.equal(s.busy,true);
  const second=interaction('open-banner');await c.handle(second);assert.equal(opened,1);assert.equal(c.sessions.sessions.get(s.id),s);assert.match(second.result.embeds[0].toJSON().description,/処理中/);
  complete();await first;assert.equal(s.busy,false);
});
test('direct commands open actual table, scheduling and forum screens with a single acknowledgement',async()=>{
  const make=()=>({
    trpg:createTrpgController({store:new TrpgStore(),guild:{channels:{cache:new Map()}},access:async()=>true}),
    densuke:createDensukeController({email:'',client:{},guild:{members:{fetch:async()=>({permissions:{has:p=>p===P.Administrator}})},channels:{fetch:async()=>({permissionsFor:()=>({has:()=>true})})}}}),
    forum:createForumTagsController({guild:{},access:async()=>true}),
  });
  for(const [action,name,hook,title] of [['open-trpg','trpg','openTrpg','卓・キャラシ'],['open-densuke','densuke','openDensuke','日程調整'],['open-forum','forum','openForum','投稿タグ']]){
    const feature=make()[name],c=controller({[hook]:i=>feature.open(i)}),i=interaction(action);await c.handle(i);
    assert.equal(i.acks.length,1);assert.equal(feature.sessions.sessions.size,1);assert.ok(i.result.embeds[0].toJSON().title.includes(title));assert.deepEqual(i.result.attachments,[]);
    const session=[...feature.sessions.sessions.values()][0];assert.equal(session.entry==='admin'||session.phase==='draft'||session.turn===0,true);
    for(const privateScreen of [true,false]){
      const opened={...interaction(null),message:privateScreen?{flags:{has:flag=>flag===MessageFlags.Ephemeral}}:undefined,async deferUpdate(){assert.equal(privateScreen,true);this.deferred=true;this.acks.push({update:true});}};
      await feature.open(opened);assert.equal(opened.acks.length,1);assert.equal(!!opened.acks[0].update,privateScreen);assert.deepEqual(opened.result.attachments,[]);
    }
  }
});
test('category buttons preserve session access and setting pages return to their parent category',async()=>{
  const c=controller();await c.handle(interaction(null));const s=[...c.sessions.sessions.values()][0];
  for(const category of adminCategories){
    const click={...interaction(null),customId:`admin:${s.id}:nav-category-${category.id}`,isChatInputCommand:()=>false,async deferUpdate(){this.deferred=true;}};
    await c.handle(click);assert.equal(s.view,`category-${category.id}`);
    const before=s.view;await c.handle({...click,user:{id:'other'},deferred:false});assert.equal(s.view,before);
    await c.handle({...click,channelId:'other',deferred:false});assert.equal(s.view,before);
  }
  for(const view of ['vc','audio','panel','overview','diagnostics','pick-lobby','pick-add','pick-remove']){
    if(view==='diagnostics')continue; // The diagnostics renderer has its own navigation.
    const b=adminScreen({id:'id',view},config).components.flatMap(r=>r.toJSON().components);
    const parent=view.startsWith('pick-')?'nav-vc':['overview'].includes(view)?'nav-category-operations':'nav-category-voice';
    assert.ok(b.some(c=>c.custom_id===`admin:id:${parent}`));
  }
});
