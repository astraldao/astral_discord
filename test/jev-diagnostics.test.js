import test from 'node:test';
import assert from 'node:assert/strict';
import {createBeatApiDiceJudge,beatApiDiceSample} from '../src/beatapi-dice.js';
import {jevDiagnosticsScreen,safeJevProbe} from '../src/jev-diagnostics.js';
import {diagnosticActions} from '../src/diagnostics.js';
import {createAdminController} from '../src/admin.js';
const key='fixture-not-a-real-api-key',reply=(score=.91,model='jev-1.14-free')=>new Response(JSON.stringify({model,answers:{should_roll:{type:'noul',noul:score}}}),{headers:{'Content-Type':'application/json'}});
const config={configured:true,model:'jev-1.14-free',fallback:'jev-1.14',last:'ready'};
test('a manual probe really calls the normal Noul contract with only the fixed sample, including for a negative decision',async()=>{
  for(const score of [0,.5,.91]){
    let calls=0,clock=100;const j=createBeatApiDiceJudge({apiKey:key,now:()=>clock,wallNow:()=>123456,fetcher:async(_,o)=>{calls++;clock+=42;const body=JSON.parse(o.body);assert.deepEqual(body.state,{text:beatApiDiceSample});assert.equal(body.questions.should_roll.type,'noul');return reply(score);}});
    const r=await j.probe({text:'PRIVATE_TEXT',userId:'PRIVATE_USER'});assert.equal(calls,1);assert.deepEqual(r,{status:score===0?'deny':score===.5?'uncertain':'allow',model:'jev-1.14-free',score,attempts:['jev-1.14-free'],elapsedMs:42,checkedAt:123456,retryAfterSeconds:0});
    const p=JSON.stringify(jevDiagnosticsScreen({id:'s',jevToken:'token',jevConfig:config,jevResult:r}));assert.match(p,/接続成功/);assert.match(p,/42ms/);assert.match(p,score>=.75?/返信する判定/:/見送る判定/);assert.doesNotMatch(p,/PRIVATE_|fixture-not/);
  }
});
test('probe results belong to their own request even if a concurrent chat decision finishes last',async()=>{
  let completeProbe,completeChat,calls=0;const j=createBeatApiDiceJudge({apiKey:key,fetcher:()=>new Promise(resolve=>{if(++calls===1)completeProbe=resolve;else completeChat=resolve;})});
  const p=j.probe(),chat=j.decide('それ1d100');completeProbe(reply(.1));const result=await p;completeChat(reply(.99));assert.equal(await chat,true);assert.equal(j.snapshot().lastScore,.99);assert.equal(result.score,.1);assert.equal(result.status,'deny');
});
test('probe shares free/paid quota state, reports both attempts and resumes free after Retry-After',async()=>{
  let stamp=0;const calls=[];const j=createBeatApiDiceJudge({apiKey:key,now:()=>stamp,fetcher:async(_,o)=>{const m=JSON.parse(o.body).model;calls.push(m);return calls.length===1?new Response('PRIVATE_ERROR',{status:429,headers:{'Retry-After':'30'}}):reply(.9,m);}});
  const r=await j.probe();assert.equal(r.model,'jev-1.14');assert.deepEqual(r.attempts,['jev-1.14-free','jev-1.14']);assert.match(JSON.stringify(jevDiagnosticsScreen({id:'s',jevToken:'t',jevConfig:config,jevResult:r})),/無料版の回数制限 → 有料版/);
  assert.equal(await j.decide('それ1d100'),true);assert.equal(calls.at(-1),'jev-1.14');stamp=30001;assert.equal((await j.probe()).model,'jev-1.14-free');
});
test('probe has a shared ten second cooldown and never queues or repeats an unknown request',async()=>{
  let stamp=0,calls=0;const j=createBeatApiDiceJudge({apiKey:key,now:()=>stamp,timeoutMs:10,fetcher:async()=>{calls++;return new Promise(()=>{});}});
  const first=j.probe();assert.equal((await j.probe()).status,'test-cooldown');assert.equal((await first).status,'timeout');assert.equal(calls,1);assert.equal((await j.probe()).retryAfterSeconds,10);stamp=10001;assert.equal((await j.probe()).status,'timeout');assert.equal(calls,2);
});
test('unconfigured probes and model cooldowns make no calls, and never turn authentication failures into paid requests',async()=>{
  let calls=0;for(const options of [{},{apiKey:key,model:'unapproved'}]){const j=createBeatApiDiceJudge({...options,fetcher:()=>{calls++;assert.fail('must not send');}});assert.ok(['disabled','configuration-error'].includes((await j.probe()).status));}assert.equal(calls,0);
  const j=createBeatApiDiceJudge({apiKey:key,fetcher:async()=>{calls++;return new Response(key,{status:401});}});assert.equal((await j.probe()).status,'http-error');assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(j.snapshot()),/fixture-not/);
});
test('fresh authorization is required before each external attempt, especially before charging the paid fallback',async()=>{
  let allowed=true,calls=0,guards=0;const j=createBeatApiDiceJudge({apiKey:key,fetcher:async()=>{calls++;allowed=false;return new Response('x',{status:429,headers:{'Retry-After':'60'}});}});
  const r=await j.probe({beforeRequest:async()=>{guards++;return allowed;}});assert.equal(r.status,'cancelled');assert.equal(calls,1);assert.equal(guards,2);assert.deepEqual(r.attempts,['jev-1.14-free']);
  const never=createBeatApiDiceJudge({apiKey:key,fetcher:()=>assert.fail('not authorized')});assert.equal((await never.probe({beforeRequest:async()=>false})).status,'cancelled');
});
test('the total deadline also covers authorization waits and a late guard cannot start a paid request',async()=>{
  let checks=0,release,calls=0;const j=createBeatApiDiceJudge({apiKey:key,timeoutMs:10,fetcher:async()=>{calls++;return new Response('x',{status:429,headers:{'Retry-After':'30'}});}});
  const r=await j.probe({beforeRequest:async()=>++checks===1?true:new Promise(resolve=>{release=resolve;})});assert.equal(r.status,'timeout');assert.equal(calls,1);release(true);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
});
test('result rendering whitelists every field and remains compact for success, disabled, failure and hostile input',()=>{
  const bad={status:key,model:key,score:Infinity,attempts:[key,key,key],elapsedMs:NaN,checkedAt:Infinity,retryAfterSeconds:Infinity,key,text:'PRIVATE_TEXT',error:'PRIVATE_ERROR'};
  assert.deepEqual(safeJevProbe(bad),{status:'invalid-response',model:null,score:null,attempts:[],elapsedMs:null,checkedAt:null,retryAfterSeconds:0});
  for(const result of [null,bad,{status:'no-credits',model:'jev-1.14',attempts:['jev-1.14-free','jev-1.14'],elapsedMs:100,checkedAt:123456},{status:'allow',score:.91,model:'jev-1.14-free',elapsedMs:100}]){
    const p=jevDiagnosticsScreen({id:'s',jevToken:'t',jevConfig:config,jevResult:result});const json=JSON.stringify(p);assert.doesNotMatch(json,/fixture-not|PRIVATE_|NaN|Infinity/);assert.ok(p.embeds[0].toJSON().description.length<1500);assert.equal(p.components.length,1);assert.equal(p.components[0].toJSON().components.length,2);
  }
  const p=jevDiagnosticsScreen({id:'s',jevToken:'t',jevConfig:{configured:false,model:'jev-1.14-free',last:'disabled'}});assert.equal(p.components[0].toJSON().components[0].disabled,true);assert.match(JSON.stringify(p),/BEATAPI_API_KEY/);
});
function harness({probe,access=async()=>true,state=config}={}){
  const j=probe?{snapshot:()=>state,probe}:createBeatApiDiceJudge({apiKey:key,fetcher:async()=>reply()});
  const c=createAdminController({settings:{get:()=>({})},guild:{},jevTest:j,access}),s=c.sessions.create('admin');s.view='diagnostics';s.originChannelId='channel';s.diagnostics={voice:{},channels:[],dice:{enabled:true,fullContent:true,judge:state}};
  const event=(action,values)=>({customId:`admin:${s.id}:${action}`,values,user:{id:'admin'},channelId:'channel',message:{},isChatInputCommand:()=>false,isModalSubmit:()=>false,async deferReply(){this.deferred=true;},async deferUpdate(){this.deferred=true;},async editReply(p){this.result=p;},async reply(p){this.result=p;}});
  return {c,s,event};
}
test('only the existing diagnostic picker opens the trial, opening is free and running is explicit and single use',async()=>{
  let calls=0;const h=harness({probe:async({beforeRequest})=>{assert.equal(await beforeRequest(),true);calls++;return {status:'allow',model:'jev-1.14-free',score:.91,elapsedMs:42};}}),{c,s,event}=h;
  assert.ok(diagnosticActions(s).some(a=>a.value==='open-jev'));const open=event('diagnostics-action',['open-jev']);await c.handle(open);assert.equal(s.view,'jev-test');assert.equal(calls,0);assert.match(JSON.stringify(open.result),/Jevを試す/);
  const old=s.jevToken,run=event(`jev-run:${old}`);await c.handle(run);assert.equal(calls,1);assert.match(JSON.stringify(run.result),/接続成功/);assert.notEqual(s.jevToken,old);
  const replay=event(`jev-run:${old}`);await c.handle(replay);assert.equal(calls,1);assert.match(JSON.stringify(replay.result),/最新のJev接続試験/);await c.handle(event('nav-diagnostics'));assert.equal(s.view,'diagnostics');assert.equal(calls,1);
});
test('probe must not disclose results after admin access, session lifetime or session ownership changes',async()=>{
  for(const change of ['permission','expiry','replacement']){
    let allowed=true;const h=harness({access:async()=>allowed,probe:async()=>{if(change==='permission')allowed=false;else if(change==='expiry')h.s.expires=0;else h.c.sessions.create('admin');return {status:'allow',model:'jev-1.14-free',score:.99};}});
    await h.c.handle(h.event('open-jev'));const i=h.event(`jev-run:${h.s.jevToken}`);await h.c.handle(i);assert.equal(h.s.jevResult,null);assert.doesNotMatch(JSON.stringify(i.result),/接続成功|0\.9900/);assert.match(JSON.stringify(i.result),/権限/);
  }
});
test('wrong users, channels, screen and tokens never start a probe, including overlapping clicks',async()=>{
  let calls=0,release;const h=harness({probe:()=>{calls++;return new Promise(resolve=>{release=resolve;});}});await h.c.handle(h.event('open-jev'));
  for(const alter of [i=>{i.user.id='other';},i=>{i.channelId='other';},i=>{i.customId=`admin:${h.s.id}:jev-run:wrong`; }]){const i=h.event(`jev-run:${h.s.jevToken}`);alter(i);await h.c.handle(i);assert.equal(calls,0);}
  const old=h.s.jevToken,first=h.c.handle(h.event(`jev-run:${old}`));await new Promise(resolve=>setImmediate(resolve));await h.c.handle(h.event(`jev-run:${old}`));assert.equal(calls,1);release({status:'allow',model:'jev-1.14-free',score:.99});await first;
  h.s.view='diagnostics';await h.c.handle(h.event(`jev-run:${h.s.jevToken}`));assert.equal(calls,1);
});
test('session replacement during an awaited role fetch is checked again before an external request',async()=>{
  let mutate=false,sent=0;const h=harness({access:async()=>{if(mutate){mutate=false;h.c.sessions.create('admin');}return true;},probe:async({beforeRequest})=>{mutate=true;if(await beforeRequest())sent++;return {status:'cancelled'};}});
  await h.c.handle(h.event('open-jev'));const i=h.event(`jev-run:${h.s.jevToken}`);await h.c.handle(i);assert.equal(sent,0);assert.equal(h.s.jevResult,null);assert.doesNotMatch(JSON.stringify(i.result),/接続成功/);
});
