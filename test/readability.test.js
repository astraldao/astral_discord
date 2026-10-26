import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnosticsScreen,diagnosticTabs} from '../src/diagnostics.js';
import {createAdminController,adminScreen} from '../src/admin.js';
import {mainMenuScreen} from '../src/main-menu.js';
import {gameLobby} from '../src/blackjack-ui.js';
import {chipAccountScreen} from '../src/chip-account-ui.js';
import {backupReaderScreen} from '../src/backup-reader.js';
const config={lobbyId:'111111111111111111',targetIds:['222222222222222222'],voice:true,volume:30,seconds:5,enforce:true,words:[]};
const diagnostic=()=>({checkedAt:1793000000000,version:'6.12.0',node:'v24.19.0',uptime:123,pending:0,voiceEnabled:true,voice:{python:true,runtime:true,model:false,dictionary:false},channels:Array.from({length:31},(_,n)=>({id:String(111111111111111111n+BigInt(n)),lobby:n===0,status:n===1?'不足：発言':'必要な権限あり'})),capacity:{cpuLimitCores:1,logicalCores:1,memoryUsedBytes:270*1048576,memoryLimitBytes:589*1048576,arch:'x64'},backup:{enabled:true,active:false},dice:{enabled:true,fullContent:true,judge:{configured:true,model:'jev-1.14-free',lastModel:'jev-1.14',fallback:'jev-1.14',last:'allow',lastScore:.91,key:'PRIVATE_KEY'}}});
const description=m=>m.embeds[0].toJSON().description,allText=m=>m.embeds.map(e=>{const x=e.toJSON();return [x.title,x.description,...(x.fields??[]).flatMap(f=>[f.name,f.value])].join('\n');}).join('\n'),controls=m=>m.components.flatMap(row=>row.toJSON().components);
function fixture({access=async()=>true}={}){const d=diagnostic(),calls=[],c=createAdminController({settings:{get:()=>config,update:()=>assert.fail('read-only views wrote settings')},guild:{},access,diagnose:async()=>{calls.push('diagnose');return d;},jevTest:{probe:()=>assert.fail('view sent paid AI request'),snapshot:()=>d.dice.judge},securityScan:{run:()=>assert.fail('view scanned packages')}}),s=c.sessions.create('owner');Object.assign(s,{view:'diagnostics',originChannelId:'channel',diagnostics:d});const event=(action,values)=>({customId:`admin:${s.id}:${action}`,values,user:{id:'owner'},channelId:'channel',message:{},isChatInputCommand:()=>false,isModalSubmit:()=>false,async deferReply(){this.deferred=true;},async deferUpdate(){this.deferred=true;},async editReply(p){this.result=p;},async reply(p){this.result=p;}});return {c,s,d,calls,event};}
test('diagnostic overview prioritizes missing items and last Jev usage within a short native description',()=>{
  const d=diagnostic(),p=diagnosticsScreen({id:'s',page:0,diagnostics:d}),body=description(p);assert.ok(body.length<700);assert.ok(body.indexOf('確認したい項目')<body.indexOf('CPU上限'));assert.match(body,/VC・権限 1件/);assert.match(body,/構成要素 2項目/);assert.match(body,/直前 jev-1.14/);assert.doesNotMatch(JSON.stringify(p),/PRIVATE_KEY/);assert.ok(!controls(p).some(c=>/diagnostics-(prev|next)/u.test(c.custom_id??'')));
});
test('disabled audio with unconfirmed files is informative rather than incorrectly flagged as an active failure',()=>{
  const d=diagnostic();d.voiceEnabled=false;d.backup.enabled=false;d.voice={};d.channels=d.channels.slice(0,1);const body=description(diagnosticsScreen({id:'s',page:0,diagnostics:d}));assert.match(body,/確認した範囲に不足はありません/);assert.match(body,/構成要素 0\/4/);assert.doesNotMatch(body,/音声の構成要素 4項目が未確認/);
});
test('every diagnostic section reuses the cached result and never writes settings or calls an external service',async()=>{
  const f=fixture(),snapshot=structuredClone(f.d);for(const tab of Object.keys(diagnosticTabs)){const i=f.event('diagnostics-action',[`diagnostics-tab-${tab}`]);await f.c.handle(i);assert.equal(f.s.diagnosticTab,tab);assert.match(i.result.embeds[0].toJSON().title,new RegExp(diagnosticTabs[tab]));assert.equal(f.s.page,0);assert.doesNotMatch(JSON.stringify(i.result),/PRIVATE_KEY/);}
  assert.deepEqual(f.d,snapshot);assert.deepEqual(f.calls,[]);
});
test('VC pagination has five entries, covers every channel exactly once and clamps after the data shrinks',()=>{
  const d=diagnostic(),ids=[];for(let page=0;page<7;page++){const p=diagnosticsScreen({id:'s',page,diagnosticTab:'channels',diagnostics:d}),found=[...description(p).matchAll(/<#(\d+)>/gu)].map(m=>m[1]);assert.ok(found.length<=5);ids.push(...found);}
  assert.deepEqual(ids,d.channels.map(c=>c.id));const s={id:'s',page:6,diagnosticTab:'channels',diagnostics:{...d,channels:d.channels.slice(0,1)}};diagnosticsScreen(s);assert.equal(s.page,0);
});
test('only the displayed VC view can paginate; unsupported views, users, channels and selectors cannot reveal cached data',async()=>{
  const f=fixture();for(const [action,values] of [['diagnostics-next'],['diagnostics-action',['nav-vc']],['diagnostics-action',['diagnostics-tab-constructor']],['diagnostics-tab-__proto__']]){const i=f.event(action,values);await f.c.handle(i);assert.equal(f.s.diagnosticTab,undefined);assert.equal(f.s.page,0);assert.doesNotMatch(JSON.stringify(i.result),/589MiB|0.91/);}
  for(const alter of [i=>{i.user.id='other';},i=>{i.channelId='other';}]){const i=f.event('diagnostics-action',['diagnostics-tab-capacity']);alter(i);await f.c.handle(i);assert.equal(f.s.diagnosticTab,undefined);assert.doesNotMatch(JSON.stringify(i.result),/589MiB/);}
  f.s.view='home';await f.c.handle(f.event('diagnostics-tab-capacity'));assert.equal(f.s.view,'home');assert.deepEqual(f.calls,[]);
});
test('a session expiring during the current-role lookup cannot render a newly requested diagnostic section',async()=>{
  let checks=0;const f=fixture({access:async()=>{if(++checks===2)f.s.expires=0;return true;}}),i=f.event('diagnostics-tab-capacity');await f.c.handle(i);assert.equal(f.s.diagnosticTab,undefined);assert.doesNotMatch(JSON.stringify(i.result),/589MiB|v24.19.0/);assert.match(JSON.stringify(i.result),/終了しています/);
});
test('all prior diagnostic details remain available by section, without claiming the speed measurement plays into VC',()=>{
  const d=diagnostic(),screens=Object.keys(diagnosticTabs).map(diagnosticTab=>diagnosticsScreen({id:'s',page:0,diagnosticTab,diagnostics:d})),text=screens.map(allText).join('\n');for(const detail of ['Python実行ファイル','ずんだもんモデル','起動設定 ON','jev-1.14-free','0.91','589MiB','v24.19.0','123分'])assert.ok(text.includes(detail),detail);assert.match(allText(screens[1]),/VC接続・再生試験は含みません/);
});
test('wallet grouping preserves each financial component and the visible balance without mutating the account',()=>{
  const account={balance:3010,ledger:{opening:3000,started:1793000000000,totals:{paid:250,wagered:350,work:25,received:40,sent:10,added:100,removed:50,other:5},games:{},history:[]}},before=structuredClone(account),wallet={account:()=>account,now:()=>1793000000000};
  const m=chipAccountScreen({id:'s',turn:0,scope:'self',userId:'owner',view:'summary'},wallet),body=allText(m);for(const detail of ['3,010','3,000','-100','+25','+40','−10','+100','−50','+5'])assert.ok(body.includes(detail),detail);assert.ok(description(m).length<170);assert.deepEqual(account,before);
});
test('reading clear confirmation is first, while normal status stays short and preserves the queue warning and required context',()=>{
  const s={id:'123456789abc',ready:true,paused:false,phase:'waiting',textId:'111111111111111111',voiceId:'222222222222222222',queue:[],controlRevision:1,metrics:{started:0,lastParts:null,lastMs:null,overBudget:0,dropped:0,cleared:0}},normal=backupReaderScreen(s,true);assert.ok(description(normal).length<300);assert.match(description(normal),/50文字まで/);assert.match(description(normal),/読む場所.*111111111111111111/su);
  const confirm=description(backupReaderScreen({...s,queue:Array(8).fill({}),clearIntent:{ids:[1,2]}},true,{details:true}));assert.ok(confirm.indexOf('確認時に待っていた 2件')<confirm.indexOf('投稿を待っています'));assert.match(confirm,/待機が満杯/);assert.match(confirm,/新しい投稿は残します/);
});
test('overview, member and game screens fit native limits with at most one primary button and no new action rows',()=>{
  const d=diagnostic(),wallet={account:()=>({balance:3000,ledger:{opening:3000,started:1793000000000,totals:{paid:0,wagered:0,work:0,received:0,sent:0,added:0,removed:0},games:{},history:[]}}),now:()=>1793000000000};
  const screens=[mainMenuScreen({admin:true}),adminScreen({id:'s',view:'home',page:0},config),gameLobby(null,3000),chipAccountScreen({id:'s',turn:0,scope:'self',userId:'owner',view:'summary'},wallet),...Object.keys(diagnosticTabs).map(diagnosticTab=>diagnosticsScreen({id:'s',page:0,diagnosticTab,diagnostics:d}))];
  for(const m of screens){assert.ok(m.components.length<=5);assert.ok(controls(m).filter(c=>c.type===2&&c.style===1).length<=1);for(const row of m.components){const children=row.toJSON().components;assert.ok(children.length<=(children[0].type===2?3:1));}for(const e of m.embeds){const p=e.toJSON();assert.ok(p.description.length<=4096);for(const f of p.fields??[])assert.ok(f.value.length<=1024&&f.name.length<=256);}assert.deepEqual(m.allowedMentions.parse,[]);}
});
