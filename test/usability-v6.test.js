import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {adminGuides,adminGuideFor} from '../src/feature-guides.js';
import {adminDestinations} from '../src/admin-navigation.js';
import {adminScreen,createAdminController,settingChangeDescription} from '../src/admin.js';
import {menuGuideTopics,menuTaskDetails} from '../src/menu-catalog.js';
import {mainMenuGuideScreen} from '../src/main-menu.js';
import {gameLobby} from '../src/blackjack-ui.js';
import {gameLobbyChoices} from '../src/game-ui.js';
import {chipAccountScreen} from '../src/chip-account-ui.js';
import {GameWalletStore} from '../src/game-wallets.js';
import {backupReaderScreen} from '../src/backup-reader.js';
import {forumTagsScreen} from '../src/forum-tags.js';
import {densukeScreen} from '../src/densuke-ui.js';
import {choices} from '../src/densuke.js';
import {ScheduleStore} from '../src/schedule-store.js';
import {scheduleScreen} from '../src/schedule-ui.js';
import {restartScreen} from '../src/restart-ui.js';
import {versionScreen} from '../src/version-ui.js';

const LOBBY='111111111111111111',TARGET='222222222222222222',NEXT='333333333333333333';
const config=()=>({version:1,lobbyId:LOBBY,targetIds:[TARGET],seconds:5,volume:30,voice:true,enforce:true,words:[],panel:null});
const controls=m=>m.components.flatMap(r=>r.toJSON().components),body=m=>m.embeds.map(e=>e.toJSON().description).join('\n');
function compact(m){assert.ok(m.components.length<=5);for(const r of m.components){const c=r.toJSON().components;if(c[0].type===2)assert.ok(c.length<=3);for(const x of c)if(x.options)assert.ok(x.options.length<=25);}assert.deepEqual(m.allowedMentions.parse,[]);assert.ok(m.embeds.every(e=>e.toJSON().description.length<=4096));}
function interaction(customId,values,user='owner',channelId='channel'){
  return {customId,values,user:{id:user},channelId,message:{flags:{has:()=>true}},isChatInputCommand:()=>!customId,isModalSubmit:()=>false,async deferReply(){this.deferred=true;},async deferUpdate(){this.deferred=true;},async editReply(m){this.result=m;},async reply(m){this.replied=true;this.result=m;}};
}
async function fixture(){
  let c=config(),allowed=true,writes=0,changed=0;const calls=[];
  const settings={get:()=>structuredClone(c),async update(fn,guard){await guard?.();const next=structuredClone(c);fn(next);await guard?.();c=next;writes++;}};
  const hooks=Object.fromEntries(['openDensuke','openTrpg','openForum','openChips','openSchedule','openUpdates','openBanner','openRuntime','openRestart','diagnose'].map(key=>[key,async()=>{calls.push(key);return {};} ]));
  const controller=createAdminController({settings,guild:{channels:{cache:new Map(),fetch:async()=>({type:2,permissionsFor:()=>({has:()=>true})})},members:{me:{}}},refreshPanel:async()=>{},changed:()=>changed++,pendingCount:()=>0,access:async()=>allowed,...hooks});
  await controller.handle(interaction());const s=[...controller.sessions.sessions.values()][0];
  const act=async(action,values,user='owner',channelId='channel')=>{const i=interaction(`admin:${s.id}:${action}`,values,user,channelId);await controller.handle(i);return i;};
  return {controller,s,act,settings,calls,allowed:v=>allowed=v,writes:()=>writes,changed:()=>changed};
}

test('all fifteen admin guides have real instructions, local documentation and a safe destination',()=>{
  assert.equal(adminDestinations.length,15);assert.deepEqual(Object.keys(adminGuides).sort(),adminDestinations.map(d=>d.action).sort());
  for(const d of adminDestinations){const guide=adminGuideFor(d.action);for(const key of ['prepare','steps','effect','recovery'])assert.ok(guide[key].length>10);assert.ok(existsSync(new URL(`../docs/${guide.doc}`,import.meta.url)));
    const m=adminScreen({id:'session',view:'guides',guideTopic:d.action},config());compact(m);assert.equal(controls(m).find(c=>c.custom_id?.endsWith(':guide-topic')).options.length,15);assert.ok(controls(m).some(c=>c.custom_id===`admin:session:${d.action}`));assert.match(body(m),/反映・保存/);
  }
  for(const value of ['__proto__','constructor','save','install-panel',null,{}])assert.equal(adminGuideFor(value),null);
});

test('guide selection never writes, posts, scans or opens a feature until its explicit button is pressed',async()=>{
  const f=await fixture();await f.act('destination',['nav-guides']);assert.equal(f.s.view,'guides');
  for(const d of adminDestinations){await f.act('guide-topic',[d.action]);assert.equal(f.s.guideTopic,d.action);assert.deepEqual(f.calls,[]);assert.equal(f.writes(),0);assert.equal(f.changed(),0);}
  await f.act('guide-topic',['open-banner']);await f.act('open-banner');assert.deepEqual(f.calls,['openBanner']);assert.equal(f.writes(),0);
});

test('guide controls reject other users, channels, invalid values, revoked permissions and expired sessions',async()=>{
  const f=await fixture();await f.act('nav-guides');await f.act('guide-topic',['open-trpg']);
  for(const [values,user,channel] of [[['__proto__'],'owner','channel'],[['save'],'owner','channel'],[['open-banner','open-chips'],'owner','channel'],[['open-banner'],'other','channel'],[['open-banner'],'owner','elsewhere']]){await f.act('guide-topic',values,user,channel);assert.equal(f.s.guideTopic,'open-trpg');}
  await f.act('home');await f.act('guide-topic',['open-banner']);assert.equal(f.s.guideTopic,'open-trpg');await f.act('nav-guides');f.allowed(false);await f.act('guide-topic',['open-banner']);assert.equal(f.s.guideTopic,'open-trpg');f.allowed(true);f.s.expires=0;await f.act('guide-topic',['open-banner']);assert.equal(f.s.guideTopic,'open-trpg');assert.deepEqual(f.calls,[]);assert.equal(f.writes(),0);
});

test('settings previews describe normalized before/after values without writing, and success retains the change',async()=>{
  const c=config(),before=structuredClone(c);
  assert.match(settingChangeDescription(c,'volume','40'),/30% → 40%/);assert.match(settingChangeDescription(c,'lobby',NEXT),new RegExp(`${LOBBY}.*${NEXT}`));assert.match(settingChangeDescription(c,'chatDice',false),/ON → OFF/);
  assert.match(settingChangeDescription(c,'word-add',{surface:'ＡＳＴＲＡＬ',reading:'あすとらる'}),/ASTRAL：アストラル/);assert.deepEqual(c,before);
  const f=await fixture();await f.act('nav-audio');const result=await f.act('toggle-voice');assert.equal(f.settings.get().voice,false);assert.match(body(result.result),/ON → OFF/);assert.equal(f.writes(),1);
  await f.act('lobby',[NEXT]);assert.equal(f.settings.get().lobbyId,LOBBY);assert.match(f.s.stage.description,new RegExp(`${LOBBY}.*${NEXT}`));await f.act('nav-vc');assert.equal(f.settings.get().lobbyId,LOBBY);
});

test('all user help topics show prerequisites and effect without turning a guide into a mutation',()=>{
  assert.deepEqual(Object.keys(menuTaskDetails).sort(),Object.keys(menuGuideTopics).sort());
  for(const topic of Object.keys(menuGuideTopics)){const m=mainMenuGuideScreen(topic,{readingEnabled:false,diceEnabled:true,diceFullContent:false},'before');compact(m);assert.match(body(m),/使う前に/);assert.match(body(m),/反映・終了/);assert.ok(!controls(m).some(c=>/start|save|confirm/.test(c.custom_id??'')));}
  assert.match(body(mainMenuGuideScreen('dice')),/チップは使いません/);
});

test('low-chip game selection moves free games first without hiding paid rules or consuming chips',()=>{
  for(const balance of [0,9,10,3000,undefined]){const m=gameLobby(null,balance);compact(m);const values=controls(m).find(c=>c.custom_id==='game:select').options.map(c=>c.value);assert.equal(new Set(values).size,10);if(balance<10)assert.deepEqual(values.slice(0,3),['rps','work','four']);else assert.equal(values[0],'blackjack');}
  assert.match(gameLobbyChoices(0).find(c=>c.value==='dice').description,/チャットダイスとは別/);assert.ok(gameLobbyChoices(0).filter(c=>!['rps','work','four'].includes(c.value)).every(c=>c.description.includes('10枚')));
});

test('paginated chip history and audit never exceed three buttons in a row',()=>{
  const wallet=new GameWalletStore(null,{now:()=>0}),events=Array.from({length:20},(_,n)=>({at:n,type:'initial',delta:0,balance:3000,user:'owner'}));
  for(const scope of ['self','admin'])for(const view of ['history','audit','stats','summary']){if(scope==='self'&&view==='audit')continue;const m=chipAccountScreen({id:'s',turn:0,userId:'owner',target:'owner',scope,view,page:1,historySnapshot:events,auditSnapshot:events},wallet);compact(m);}
  assert.equal(wallet.accounts.size,0);
});

test('reader gives proactive queue guidance without exposing queued text or adding controls',()=>{
  for(const length of [0,6,8]){const s={id:'0123456789ab',ready:true,paused:true,phase:'idle',textId:LOBBY,voiceId:TARGET,queue:Array.from({length},()=>({text:'PRIVATE_QUEUED_TEXT'})),metrics:{lastMs:null,started:0,overBudget:0,dropped:0,cleared:0}};
    const m=backupReaderScreen(s,true);compact(m);assert.ok(!body(m).includes('PRIVATE_QUEUED_TEXT'));if(length===8)assert.match(body(m),/待機が満杯/);else if(length===6)assert.match(body(m),/待機が増えています/);else assert.ok(!body(m).includes('待機が満杯'));
  }
});

test('empty forum tags explain the prerequisite and do not offer a misleading apply button',()=>{
  const m=forumTagsScreen({id:'s',turn:0,postId:TARGET,postName:'投稿',tags:[],draft:[]});compact(m);assert.match(body(m),/利用可能なタグがありません/);assert.ok(!controls(m).some(c=>c.custom_id?.endsWith(':apply')));
});

test('candidate and calendar page counts describe what is visible without broadening stored data',async()=>{
  const m=densukeScreen({id:'s',phase:'review',channelId:LOBBY,event:{name:'候補',schedule:'10/25\n\n10/26\r\n10/27',description:'',password:'SECRET_PASS',choice:Object.keys(choices)[0]}});compact(m);assert.match(JSON.stringify(m.embeds.map(e=>e.toJSON())),/候補日程 · 3件/);assert.ok(!JSON.stringify(m).includes('SECRET_PASS'));
  const store=new ScheduleStore(),id=await store.create('予定');for(let n=0;n<10;n++)await store.putEvent(id,null,{title:`予定${n}`,date:'2026/10/25',time:'',place:'',description:''});const before=structuredClone(store.data);
  for(const [page,count] of [[0,8],[1,2]]){const screen=scheduleScreen({id:'s',turn:0,scope:'viewer',calendarId:id,view:'list',display:'list',month:'2026-10',page},store);compact(screen);assert.ok(body(screen).includes(`表示 ${count}件 / 全10件`));}assert.deepEqual(store.data,before);
});

test('blocked maintenance offers an ordinary-menu exit and differentiates unchanged startup settings',()=>{
  const snapshot={pending:false,running:{ASTRAL_BACKUP_TTS:'0',VOICEVOX_BACKUP_THREADS:'2'},effective:{ASTRAL_BACKUP_TTS:'0',VOICEVOX_BACKUP_THREADS:'2'}};
  const restart=restartScreen({id:'s',turn:0,data:{supported:true,phase:'blocked'}},{snapshot:()=>snapshot});compact(restart);assert.match(body(restart),/起動設定の変更はありません/);assert.ok(controls(restart).some(c=>c.custom_id==='menu:open'));
  const version=versionScreen({id:'s',turn:0,data:{supported:true,phase:'blocked',current:{version:'6.0.0',sha:'a'.repeat(40)},latest:null,checkedAt:null}});compact(version);assert.match(body(version),/進行状況を確認/);assert.ok(controls(version).some(c=>c.custom_id==='menu:open'));
});
