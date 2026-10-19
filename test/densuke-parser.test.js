import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Worker} from 'node:worker_threads';
import {parseDensukePage} from '../src/densuke-parser.js';
import {confirmationFields,resultLinks,createDensukeClient,UncertainCreation} from '../src/densuke.js';

const event={name:'卓の日程',schedule:'10/31 20:00',description:'説明',password:'Secret1',choice:'1'},email='owner@example.com';
const answer='https://www.densuke.biz/list?cd=Table123',edit='https://www.densuke.biz/edit?cd=Table123&pw=Secret2';
const result=`<a href="${answer}">回答</a><a href="${edit}">編集</a>`;
const fields={eventname:event.name,schedule:event.schedule,explain:event.description,email,pw:'1',password:event.password,eventchoice:'1',postfix:''};
const confirmation='<form action="create" method="post">'+Object.entries(fields).map(([name,value])=>`<input type="hidden" name="${name}" value="${value}">`).join('')+'</form>';
function fake(){const worker=new EventEmitter();worker.sent=[];worker.terminated=0;worker.postMessage=data=>worker.sent.push(data);worker.terminate=async()=>{worker.terminated++;};return worker;}

test('real isolated parser confirms exact fields and returns only bounded Densuke links',async()=>{
  assert.equal(await parseDensukePage('confirmation',confirmation,{event,email}),true);
  assert.deepEqual(await parseDensukePage('result',result),{answer,edit});
  await assert.rejects(parseDensukePage('confirmation',confirmation.replace('owner@example.com','other@example.com'),{event,email}),e=>e.code==='DENSUKE_HTML_PARSE'&&!e.message.includes('Secret'));
});
test('deep, wide and over-byte-limit HTML is rejected with a controlled error without recursive traversal',()=>{
  for(const html of ['<div>'.repeat(12000),'<i></i>'.repeat(21000),'界'.repeat(350000)])assert.throws(()=>resultLinks(html),e=>e.code==='DENSUKE_HTML_LIMIT'&&e.name!=='RangeError');
  assert.throws(()=>confirmationFields('<div>'.repeat(12000)+confirmation,event,email),e=>e.code==='DENSUKE_HTML_LIMIT');
});
test('linear result lookup preserves answer order and first matching edit credentials',()=>{
  const missing=Array.from({length:2000},(_,n)=>`<a href="https://www.densuke.biz/list?cd=A${n}">回答</a><a href="https://www.densuke.biz/edit?cd=B${n}">編集</a>`).join('');
  assert.deepEqual(resultLinks(missing+result+result.replace('Secret2','LaterSecret')),{answer,edit});
});
test('preflight rejects invalid kinds, size and already-aborted signals without launching',async()=>{
  let launches=0;const launch=()=>{launches++;return fake();},abort=new AbortController();abort.abort();
  for(const [kind,html,options] of [['bad','',{}],['result','x'.repeat(1024*1024+1),{}],['result','界'.repeat(350000),{}],['result','',{signal:abort.signal}],['result','',{timeout:0}],['result','',{timeout:5001}]])await assert.rejects(parseDensukePage(kind,html,{...options,launch}));
  assert.equal(launches,0);
});
test('completion, malformed replies, worker failure and cancellation terminate exactly once without native errors',async()=>{
  for(const mode of ['success','bad-message','bad-value','error','exit','abort']){
    const worker=fake(),abort=new AbortController(),job=parseDensukePage('result',result,{signal:abort.signal,launch:()=>worker});
    assert.deepEqual(worker.sent,[{kind:'result',html:result}]);
    if(mode==='success')worker.emit('message',{ok:true,value:{answer,edit}});
    if(mode==='bad-message')worker.emit('message',{ok:false,code:'PRIVATE_NATIVE_ERROR'});
    if(mode==='bad-value')worker.emit('message',{ok:true,value:{answer:'x'.repeat(2049),edit}});
    if(mode==='error')worker.emit('error',new Error('PRIVATE_NATIVE_ERROR'));
    if(mode==='exit')worker.emit('exit',1);
    if(mode==='abort')abort.abort(new Error('PRIVATE_NATIVE_ERROR'));
    if(mode==='success')assert.deepEqual(await job,{answer,edit});else await assert.rejects(job,e=>!e.message.includes('PRIVATE_NATIVE_ERROR'));
    assert.equal(worker.terminated,1);assert.equal(worker.listenerCount('message'),0);assert.equal(worker.listenerCount('exit'),0);
    worker.emit('message',{ok:true,value:{answer,edit}});abort.abort();assert.equal(worker.terminated,1);
  }
});
test('a stuck real worker times out while the parent event loop remains available',async()=>{
  let ticks=0;const timer=setInterval(()=>ticks++,5);
  try{await assert.rejects(parseDensukePage('result',result,{timeout:150,launch:()=>new Worker(new URL('./fixtures/densuke-parser-hang.js',import.meta.url),{env:{},execArgv:[]})}),e=>e.code==='DENSUKE_HTML_TIMEOUT');assert.ok(ticks>0);}finally{clearInterval(timer);}
});
test('confirmation parser failure never sends create; completion parser failure remains uncertain and is never retried',async()=>{
  for(const failAt of ['confirmation','result']){
    let requests=0;const phases=[];
    const client=createDensukeClient(async()=>new Response(++requests===1?confirmation:result),{parsePage:async kind=>{phases.push(kind);if(kind===failAt)throw Object.assign(new Error('safe failure'),{code:'DENSUKE_HTML_TIMEOUT'});return true;}});
    await assert.rejects(client.create(event,email),e=>failAt==='result'?e instanceof UncertainCreation:!(e instanceof UncertainCreation));
    assert.equal(requests,failAt==='result'?2:1);assert.deepEqual(phases,failAt==='result'?['confirmation','result']:['confirmation']);
  }
});
test('rejected redirects, HTTP failures, missing bodies and oversized headers cancel data before parsing',async()=>{
  for(const mode of ['redirect','http','large']){
    let cancelled=0,read=0;const response=new Response(new ReadableStream({pull(c){read++;c.enqueue(Buffer.from('must not read'));},cancel(){cancelled++;}},{highWaterMark:0}),mode==='redirect'?{status:302,headers:{location:'https://evil.example/'}}:mode==='http'?{status:500}:{headers:{'content-length':String(1024*1024+1)}});
    const client=createDensukeClient(async()=>response,{parsePage:()=>assert.fail('must not parse')});await assert.rejects(client.create(event,email));assert.equal(cancelled,1);assert.equal(read,0);
  }
  const client=createDensukeClient(async()=>new Response(null,{status:204}),{parsePage:()=>assert.fail()});await assert.rejects(client.create(event,email));
});
test('stream overflow releases its reader and creation parser results are validated again before use',async()=>{
  const response=new Response(new ReadableStream({start(c){c.enqueue(Buffer.alloc(1024*1024+1));c.close();}}));
  await assert.rejects(createDensukeClient(async()=>response).create(event,email));assert.equal(response.body.locked,false);
  let count=0;await assert.rejects(createDensukeClient(async()=>new Response(++count===1?confirmation:result),{parsePage:async kind=>kind==='confirmation'?true:{answer:'https://evil.example',edit}}).create(event,email),UncertainCreation);assert.equal(count,2);
});
