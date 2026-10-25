import test from 'node:test';
import assert from 'node:assert/strict';
import {createBeatApiDiceJudge,beatApiDiceEndpoint,beatApiDiceThreshold,safeDiceJudgeState,diceJudgeSummary} from '../src/beatapi-dice.js';
import {createDiagnostics,diagnosticsScreen} from '../src/diagnostics.js';
const text='この1d10どうしよう',key='fixture-not-a-real-api-key';
const response=(noul=.99,model='jev-1.14-free')=>new Response(JSON.stringify({model,answers:{should_roll:{type:'noul',noul}}}),{headers:{'Content-Type':'application/json'}});
test('BeatAPI uses the official System One Noul contract with only the filtered text and explicit model',async()=>{
  const calls=[],j=createBeatApiDiceJudge({apiKey:key,fetcher:async(url,options)=>{calls.push({url,options});return response();}});assert.equal(await j.decide(text),true);assert.equal(calls.length,1);const {url,options}=calls[0],body=JSON.parse(options.body);
  assert.equal(url,beatApiDiceEndpoint);assert.equal(url,'https://api.beatapi.io/v1/systemone');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,`Bearer ${key}`);assert.equal(body.model,'jev-1.14-free');assert.deepEqual(body.state,{text});assert.equal(body.questions.should_roll.type,'noul');assert.deepEqual(Object.keys(body).sort(),['model','questions','state']);assert.deepEqual(Object.keys(body.questions.should_roll.criteria).sort(),['false','true']);assert.equal(j.snapshot().last,'allow');assert.ok(!JSON.stringify(j.snapshot()).includes(key));assert.equal(beatApiDiceThreshold,.9);
  const paid=createBeatApiDiceJudge({apiKey:key,model:'jev-1.14',fetcher:async(_,o)=>{assert.equal(JSON.parse(o.body).model,'jev-1.14');return response(.99,'jev-1.14');}});assert.equal(await paid.decide(text),true);
});
test('the provider independently refuses unrelated, obvious, protected, overlength and unconfigured input',async()=>{
  let calls=0;const j=createBeatApiDiceJudge({apiKey:key,fetcher:async()=>{calls++;return response();}});
  for(const input of ['おはよう','手を振って','ロールケーキ食べたい','1d10ふって','サイゼロール','9'.repeat(50)+'d'+'9'.repeat(50),'あ'.repeat(26)+'1d10','1d10とは？','`1d10`','>>>\n1d10'])assert.equal(await j.decide(input),false,input);assert.equal(calls,0);
  for(const options of [{},{apiKey:' '},{apiKey:'invalid\r\nheader'},{apiKey:key,model:'secret-unapproved-model'}]){const k=createBeatApiDiceJudge({...options,fetcher:()=>assert.fail('unconfigured')});assert.equal(await k.decide(text),false);assert.equal(k.enabled,false);assert.doesNotMatch(JSON.stringify(k.snapshot()),/secret-unapproved-model|invalid/);}
});
test('only a finite Noul score at the chosen threshold authorizes a reply; malformed or changed-model replies do not',async()=>{
  for(const [score,expected] of [[0,false],[.5,false],[.89,false],[.9,true],[1,true]]){const j=createBeatApiDiceJudge({apiKey:key,fetcher:async()=>response(score)});assert.equal(await j.decide(text),expected,String(score));}
  for(const value of [{model:'jev-1.13',answers:{should_roll:{type:'noul',noul:1}}},{model:'jev-1.14-free',answers:{should_roll:{type:'choice',noul:1}}},{model:'jev-1.14-free',answers:{should_roll:{type:'noul',noul:'1'}}},{model:'jev-1.14-free',answers:{should_roll:{type:'noul',noul:2}}},{model:'jev-1.14-free',answers:{should_roll:{type:'noul',noul:null}}},null,{}]){const j=createBeatApiDiceJudge({apiKey:key,fetcher:async()=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}})});assert.equal(await j.decide(text),false);assert.equal(j.snapshot().last,'invalid-response');}
});
test('response bytes, content type, declared length and malformed JSON are bounded and never echoed',async()=>{
  for(const make of [()=>new Response('x'.repeat(8193),{headers:{'Content-Type':'application/json'}}),()=>new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':'9000'}}),()=>new Response('{}',{headers:{'Content-Type':'text/html'}}),()=>new Response(key,{headers:{'Content-Type':'application/json'}}),()=>new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':'NaN'}})]){const j=createBeatApiDiceJudge({apiKey:key,fetcher:async()=>make()});assert.equal(await j.decide(text),false);assert.doesNotMatch(JSON.stringify(j.snapshot()),new RegExp(key));}
  const bytes=new TextEncoder().encode(JSON.stringify({model:'jev-1.14-free',answers:{should_roll:{type:'noul',noul:.99}}}));let at=0;
  const j=createBeatApiDiceJudge({apiKey:key,fetcher:async()=>new Response(new ReadableStream({pull(c){if(at===bytes.length)c.close();else c.enqueue(bytes.slice(at,++at));}}),{headers:{'Content-Type':'application/json'}})});assert.equal(await j.decide(text),true);
  let canceled=false;const empty=createBeatApiDiceJudge({apiKey:key,fetcher:async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(0));},cancel(){canceled=true;}}),{headers:{'Content-Type':'application/json'}})});assert.equal(await empty.decide(text),false);assert.equal(canceled,true);
});
test('timeouts release pending work and never retry an uncertain model request',async()=>{
  let calls=0;const j=createBeatApiDiceJudge({apiKey:key,timeoutMs:10,fetcher:async()=>{calls++;return new Promise(()=>{});}});assert.equal(await j.decide(text),false);assert.equal(j.snapshot().last,'timeout');assert.equal(await j.decide(text),false);assert.equal(calls,1);
  let canceled=false;const body=createBeatApiDiceJudge({apiKey:key,timeoutMs:10,fetcher:async()=>new Response(new ReadableStream({cancel(){canceled=true;}}),{headers:{'Content-Type':'application/json'}})});assert.equal(await body.decide(text),false);assert.equal(canceled,true);
});
test('429 honors Retry-After for later new messages without automatic retries or paid fallback',async()=>{
  let stamp=0,calls=0;const j=createBeatApiDiceJudge({apiKey:key,now:()=>stamp,fetcher:async(_,o)=>{calls++;assert.equal(JSON.parse(o.body).model,'jev-1.14-free');return calls===1?new Response('SECRET HTTP ERROR',{status:429,headers:{'Retry-After':'30'}}):response();}});
  assert.equal(await j.decide(text),false);assert.equal(j.snapshot().retryAfterSeconds,30);assert.equal(await j.decide(text),false);assert.equal(calls,1);stamp=30001;assert.equal(await j.decide(text),true);assert.equal(calls,2);
  const error=createBeatApiDiceJudge({apiKey:key,fetcher:async()=>new Response(key,{status:401})});assert.equal(await error.decide(text),false);assert.equal(error.snapshot().last,'http-error');assert.ok(!JSON.stringify(error.snapshot()).includes(key));
});
test('no more than two model calls run concurrently and excess candidates are not queued',async()=>{
  const waiting=[];const j=createBeatApiDiceJudge({apiKey:key,fetcher:()=>new Promise(resolve=>waiting.push(resolve))});const first=j.decide(text),second=j.decide(text);assert.equal(await j.decide(text),false);assert.equal(j.snapshot().last,'busy');assert.equal(waiting.length,2);for(const done of waiting)done(response());assert.deepEqual(await Promise.all([first,second]),[true,true]);
});
test('diagnostics exposes only finite configuration and status, never keys, text or raw errors, and makes no API call',async()=>{
  const raw={configured:true,model:'jev-1.14-free',last:'rate-limit',retryAfterSeconds:30,key,text:'PRIVATE_TEXT',error:'RAW_ERROR'},safe=safeDiceJudgeState(raw);assert.deepEqual(safe,{configured:true,model:'jev-1.14-free',last:'rate-limit',retryAfterSeconds:30});assert.match(diceJudgeSummary(raw),/30秒/);
  const diagnose=createDiagnostics({settings:{get:()=>({lobbyId:null,targetIds:[],voice:false})},guild:{channels:{fetch:async()=>{},cache:new Map()},members:{fetchMe:async()=>({})}},version:'test',pendingCount:()=>0,components:async()=>({}),diceState:()=>({enabled:true,fullContent:true,judge:raw})}),data=await diagnose(),out=JSON.stringify(diagnosticsScreen({id:'test',page:0,diagnostics:data}));assert.match(out,/jev-1.14-free/);assert.match(out,/診断ではAPIを呼びません/);assert.doesNotMatch(out,/fixture-not|PRIVATE_TEXT|RAW_ERROR/);
  const bad=JSON.stringify(safeDiceJudgeState({configured:'yes',model:key,last:key,retryAfterSeconds:Infinity}));assert.ok(!bad.includes(key));
});
