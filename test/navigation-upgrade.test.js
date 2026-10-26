import test from 'node:test';
import assert from 'node:assert/strict';
import {createMainMenu,mainMenuScreen,mainMenuGuideScreen} from '../src/main-menu.js';
import {createAdminController,adminScreen} from '../src/admin.js';
import {adminDestinations} from '../src/admin-navigation.js';
import {securityScreen,securityReport,securityFindings} from '../src/security-ui.js';
import {diagnosticsHelpScreen} from '../src/diagnostics.js';
import {interactionRoute} from '../src/interaction-routing.js';
const controls=m=>m.components.flatMap(r=>r.toJSON().components);
function i(customId,values){return {customId,values,user:{id:'owner'},channelId:'channel',isChatInputCommand:()=>false,isModalSubmit:()=>false,async deferReply(){this.deferred=true;},async deferUpdate(){this.deferred=true;},async editReply(m){this.result=m;},async reply(m){this.result=m;}};}
const config={lobbyId:null,targetIds:[],seconds:5,voice:true,volume:30,words:[]};
const sample=()=>({status:'complete',checkedAt:1000,version:'5.1.0',lockHash:'a'.repeat(64),packageCount:2,runtimeCount:1,devCount:1,skipped:0,detailMissing:0,findings:[{id:'CVE-2026-1234',severity:'high',detail:true,packages:[{name:'runtime',version:'1.0.0',dev:false,direct:true},{name:'dev',version:'2.0.0',dev:true,direct:true}],fixed:[{name:'runtime',version:'1.0.1'},{name:'dev',version:'2.0.1'}]}]});
test('purpose picker routes only registered read-only entry actions after fresh access',async()=>{
 let allowed=true;const calls=[],c=createMainMenu({access:async()=>allowed?{}:false,openRead:async(_,action)=>calls.push(action),openCalendar:async()=>calls.push('calendar')});
 for(const value of ['stop','save','__proto__','not-real'])await c.handle(i('menu:find',[value]));assert.deepEqual(calls,[]);await c.handle(i('menu:find',['read']));assert.deepEqual(calls,['status']);allowed=false;await c.handle(i('menu:find',['calendar']));assert.deepEqual(calls,['status']);
 assert.equal(interactionRoute({isChatInputCommand:()=>false,isButton:()=>false,isAnySelectMenu:()=>true,isStringSelectMenu:()=>true,customId:'menu:find'}).target,'menu');
});
test('feature failure offers a safe manual reopen and never repeats stop, reads or raw exceptions automatically',async()=>{
 let calls=0;const c=createMainMenu({access:async()=>({}),openRead:async()=>{calls++;throw new Error('SECRET_TOKEN');}});const a=i('menu:read');await c.handle(a);assert.equal(calls,1);assert.ok(controls(a.result).some(b=>b.custom_id==='menu:read'));assert.ok(!JSON.stringify(a.result).includes('SECRET'));const stop=i('menu:stop');await c.handle(stop);assert.equal(calls,2);assert.ok(!controls(stop.result).some(b=>b.custom_id==='menu:stop'));
});
test('all help topics have specific recovery advice and native hub stays within five rows',()=>{
 for(const admin of [false,true]){const p=mainMenuScreen({admin,recent:['vc','read','calendar']});assert.ok(p.components.length<=5);for(const r of p.components)assert.ok(r.toJSON().components.length<=5);}
 for(const topic of ['vc','read','calendar','game','profile','wallet'])assert.ok(mainMenuGuideScreen(topic,{},'trouble').embeds[0].toJSON().title.includes('うまく動かないとき'));
 const choices=controls(adminScreen({id:'s',view:'home'},config)).find(b=>b.type===3).options;
 assert.deepEqual(choices.map(c=>c.value),[...adminDestinations.map(d=>d.action),'nav-guides']);
});
test('admin task picker rejects arbitrary writes, foreign owners and channels',async()=>{
 let opens=0;const c=createAdminController({settings:{get:()=>config},guild:{},access:async()=>true,openSchedule:async()=>opens++});await c.handle(i('admin:open'));const s=[...c.sessions.sessions.values()][0];for(const value of ['save','install-panel','__proto__'])await c.handle(i(`admin:${s.id}:destination`,[value]));assert.equal(opens,0);await c.handle({...i(`admin:${s.id}:destination`,['open-schedule']),user:{id:'other'}});await c.handle({...i(`admin:${s.id}:destination`,['open-schedule']),channelId:'other'});assert.equal(opens,0);await c.handle(i(`admin:${s.id}:destination`,['open-schedule']));assert.equal(opens,1);
});
test('security scope filters package and fixed-version details without changing the cached report',()=>{
 const d=sample(),s={id:'s',security:d,securityScope:'runtime',page:99},before=structuredClone(d);assert.deepEqual(securityFindings(s)[0].packages.map(p=>p.name),['runtime']);assert.deepEqual(securityFindings(s)[0].fixed.map(p=>p.name),['runtime']);const p=securityScreen(s);assert.ok(p.embeds[0].toJSON().description.includes('実行用'));assert.equal(s.page,0);assert.deepEqual(d,before);
 s.securityScope='dev';assert.equal(securityFindings(s)[0].packages[0].name,'dev');
});
test('download report whitelists fields, exports all scopes and refuses oversized or incomplete output',()=>{
 const d=sample();d.token='SECRET';d.findings[0].raw='SECRET';d.findings[0].packages[0].path='SECRET';const bytes=securityReport(d),data=JSON.parse(bytes);assert.equal(data.scope,'all');assert.equal(data.findings[0].packages.length,2);assert.ok(!bytes.toString().includes('SECRET'));assert.throws(()=>securityReport({status:'failed'}));d.findings=Array(3000).fill(d.findings[0]);assert.throws(()=>securityReport(d),/512KiB/);
});
test('security export rechecks permissions after completion and subsequent navigation clears the file',async()=>{
 let allowed=true;const c=createAdminController({settings:{get:()=>config},guild:{},access:async()=>allowed,securityScan:{snapshot:sample}});await c.handle(i('admin:open-feature:open-security'));const s=[...c.sessions.sessions.values()][0];const download=i(`admin:${s.id}:security-export`);await c.handle(download);assert.equal(download.result.files[0].name,'astral-security-report.json');const scope=i(`admin:${s.id}:security-scope`,['runtime']);await c.handle(scope);assert.equal(scope.result.files,undefined);assert.deepEqual(scope.result.attachments,[]);allowed=false;const denied=i(`admin:${s.id}:security-export`);await c.handle(denied);assert.equal(denied.result.files,undefined);
});
test('diagnosis remediation is based on finite checks and exposes only navigation, never automatic mutation',()=>{
 const p=diagnosticsHelpScreen({id:'s',diagnostics:{voice:{python:false,runtime:false,model:false,dictionary:false},channels:[],backup:{lastFailure:{token:'SECRET'}}}});assert.ok(p.embeds[0].toJSON().description.includes('VC設定をはじめる'));assert.ok(!JSON.stringify(p).includes('SECRET'));for(const b of controls(p))assert.ok(!b.custom_id?.includes('save'));assert.ok(p.components.length<=5);
});
