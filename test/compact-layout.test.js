import test from 'node:test';
import assert from 'node:assert/strict';
import {mainMenuScreen} from '../src/main-menu.js';
import {adminScreen,createAdminController} from '../src/admin.js';
import {adminCategories} from '../src/admin-navigation.js';
import {backupReaderScreen} from '../src/backup-reader.js';
import {ScheduleStore} from '../src/schedule-store.js';
import {scheduleScreen,createScheduleController} from '../src/schedule-ui.js';
import {gameLobby,blackjackScreen,createBlackjackController} from '../src/blackjack-ui.js';
import {casinoScreen} from '../src/casino-ui.js';
import {casinoKinds} from '../src/casino.js';
import {newRound,play} from '../src/blackjack.js';
import {diagnosticsScreen,diagnosticsHelpScreen} from '../src/diagnostics.js';

const controls=m=>m.components.flatMap(r=>r.toJSON().components);
const config={lobbyId:null,targetIds:[],seconds:5,voice:true,enforce:true,volume:30,words:[],panel:null};
function compact(message){
  assert.ok(message.components.length<=5);
  const all=controls(message),ids=all.map(c=>c.custom_id).filter(Boolean);assert.equal(new Set(ids).size,ids.length);
  for(const row of message.components){const items=row.toJSON().components;if(items[0].type===2)assert.ok(items.length<=3);else assert.equal(items.length,1);}
  for(const c of all){if(c.custom_id)assert.ok(c.custom_id.length<=100);if(c.options){assert.ok(c.options.length<=25);assert.equal(new Set(c.options.map(o=>o.value)).size,c.options.length);}}
  for(const embed of message.embeds)assert.ok(embed.toJSON().description.length<=4096);
  assert.deepEqual(message.allowedMentions.parse,[]);
}
function interaction(customId,values,extra={}){return {customId,values,user:{id:'owner'},channelId:'channel',message:{flags:{has:()=>true}},acks:0,isChatInputCommand:()=>false,isModalSubmit:()=>false,async deferUpdate(){this.deferred=true;this.acks++;},async deferReply(){this.deferred=true;this.acks++;},async editReply(m){this.result=m;},async reply(m){this.replied=true;this.result=m;},async showModal(m){assert.ok(!this.deferred&&!this.replied);this.modal=m;},...extra};}

test('main, admin, reading and diagnostic layouts have at most three buttons per row and unique native IDs',()=>{
  const diagnostics={voice:{},channels:Array.from({length:31},(_,id)=>({id:String(id),status:'必要な権限あり'})),version:'5.5.0',node:'24',uptime:0,pending:0};
  for(const admin of [false,true])compact(mainMenuScreen({admin,recent:['vc','read','calendar']}));
  for(const view of ['home','vc','audio','panel','overview','words','pick-lobby','pick-add','pick-remove',...adminCategories.map(c=>`category-${c.id}`)])compact(adminScreen({id:'s',view,page:0},config));
  for(const enabled of [false,true])compact(backupReaderScreen(null,enabled));
  const base={id:'123456789abc',ready:true,paused:false,phase:'waiting',textId:'text',voiceId:'voice',queue:[],controlRevision:2,metrics:{started:0,lastParts:null,lastMs:null,overBudget:0,dropped:0,cleared:0}};
  for(const details of [false,true])for(const preparing of [false,true])for(const confirm of [false,true])compact(backupReaderScreen({...base,ready:!preparing,clearIntent:confirm?{ids:[1,2]}:null},true,{details}));
  compact(diagnosticsScreen({id:'s',view:'diagnostics',page:0,diagnostics}));compact(diagnosticsHelpScreen({id:'s',view:'diagnostics-help',diagnostics}));
});

test('all paid games keep predictions clickable, but wagers use one picker and every balance fits compact rows',()=>{
  for(const balance of [0,5,30,3000]){
    for(const kind of casinoKinds){const m=casinoScreen({id:'s',turn:0,kind,results:{},balance,bet:50,card:7});compact(m);assert.equal(controls(m).filter(c=>c.custom_id?.endsWith(':bet')).length,1);}
    const game=newRound(Array.from({length:52},(_,n)=>n)),s={id:'s',turn:0,game,balance,bet:50,roundBet:10,payout:0};compact(blackjackScreen({...s,game:{phase:'ready'}}));compact(blackjackScreen(s));if(game.phase==='playing')play(game,'stand');compact(blackjackScreen(s));compact(gameLobby(s,balance,{id:'other',turn:0,kind:'slots'}));
  }
});

test('calendar lists, details, tools and date pickers stay compact in both scopes and dense pages',async()=>{
  const store=new ScheduleStore(),id=await store.create('架空の予定表');for(let n=0;n<12;n++)await store.putEvent(id,null,{title:`架空の予定${n}`,date:'2026/10/24',time:'20:00-21:00',place:'',description:''});
  for(const scope of ['admin','viewer'])for(const view of ['list','event','tools','days','organize'])for(const period of [undefined,'week','upcoming']){
    const s={id:'s',turn:0,scope,view,calendarId:id,eventId:store.calendar(id).events[0].id,month:'2026-10',today:'2026-10-24',viaMenu:scope==='viewer',period,rangeStart:period?'2026-10-18':undefined,rangeEnd:period?'2026-11-16':undefined,dayPicker:{month:'2026-10',page:0,onlyEvents:false}};
    if(view==='organize'&&scope!=='admin')continue;compact(scheduleScreen(s,store));if(view==='list'){s.query='架空';compact(scheduleScreen(s,store));}
  }
});

test('calendar picker opens a modal without acknowledgement or writes, and refuses writes hidden from the current view',async()=>{
  let visible=true;const store=new ScheduleStore(),id=await store.create('架空の予定表'),c=createScheduleController({store,guild:{},access:async()=>{if(!visible)throw new Error('denied');}});await c.openAdmin(interaction());const s=[...c.sessions.sessions.values()][0],act=async(values,extra={})=>{const i=interaction(`schedule:${s.id}:${s.turn}:actions`,values,extra);await c.handle(i);return i;};
  await c.handle(interaction(`schedule:${s.id}:${s.turn}:calendar`,[id]));const before=structuredClone(store.data);
  const add=await act(['new-event']);assert.ok(add.modal);assert.equal(add.acks,0);assert.deepEqual(store.data,before);
  for(const values of [[],['new-event','search'],['confirm-delete'],['repeat-save'],['publish'],['schedule:s:0:new-event'],['__proto__']]){const bad=await act(values);assert.equal(bad.modal,undefined);assert.deepEqual(store.data,before);}
  const search=await act(['search']);assert.ok(search.modal);const old=`schedule:${s.id}:${s.turn}:actions`;await c.handle(interaction(`schedule:${s.id}:${s.turn}:tools`));const stale=interaction(old,['new-event']);await c.handle(stale);assert.equal(stale.modal,undefined);
  visible=false;const denied=await act(['rename']);assert.equal(denied.modal,undefined);assert.ok(!JSON.stringify(denied.result).includes('架空の予定表'));
});

test('calendar viewer picker cannot invoke admin forms even with forged action values',async()=>{
  const channel='234567890123456789',store=new ScheduleStore(),id=await store.create('共有の予定表'),p=await store.reserve(id,channel,'2026-10');await store.complete(p,'345678901234567890');
  const c=createScheduleController({store,guild:{},access:async(_i,admin)=>{if(admin)throw new Error('denied');}});await c.handle(interaction(`schedule:panel:${p}`,undefined,{channelId:channel,message:{id:'345678901234567890',flags:{has:()=>true}}}));const s=[...c.sessions.sessions.values()][0],before=structuredClone(store.data);
  for(const value of ['new-event','import','publish','confirm-delete','home']){const i=interaction(`schedule:${s.id}:${s.turn}:actions`,[value],{channelId:channel});await c.handle(i);assert.equal(i.modal,undefined);assert.deepEqual(store.data,before);}
});

test('admin category picker accepts only that category and retains current authorization on delegated actions',async()=>{
  let allowed=true,opens=0;const c=createAdminController({settings:{get:()=>config},guild:{channels:{cache:new Map()}},access:async()=>allowed,openRestart:async()=>opens++});await c.handle(interaction('admin:open'));const s=[...c.sessions.sessions.values()][0];
  await c.handle(interaction(`admin:${s.id}:category`,['voice']));assert.equal(s.view,'category-voice');await c.handle(interaction(`admin:${s.id}:destination`,['open-restart']));assert.equal(opens,0);
  await c.handle(interaction(`admin:${s.id}:category`,['operations']));allowed=false;await c.handle(interaction(`admin:${s.id}:destination`,['open-restart']));assert.equal(opens,0);allowed=true;await c.handle(interaction(`admin:${s.id}:destination`,['open-restart']));assert.equal(opens,1);
});

test('game account navigation opens only named screens after access and never deals or charges',async()=>{
  let allowed=true;const calls=[],c=createBlackjackController({access:async()=>{if(!allowed)throw new Error('denied');},deal:()=>assert.fail('navigation cannot deal'),openWallet:async i=>{assert.equal(i.acks,1);calls.push('wallet');},openTransfer:async i=>{assert.equal(i.acks,1);calls.push('transfer');}});
  for(const values of [['save'],['wallet','transfer'],['__proto__']])await c.handle(interaction('game:account',values));assert.deepEqual(calls,[]);
  await c.handle(interaction('game:account',['wallet']));await c.handle(interaction('game:account',['transfer']));assert.deepEqual(calls,['wallet','transfer']);allowed=false;await c.handle(interaction('game:account',['wallet']));assert.deepEqual(calls,['wallet','transfer']);assert.equal(c.wallet.balance('owner'),3000);assert.equal(c.sessions.sessions.size,0);
});
