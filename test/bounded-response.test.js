import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedResponseText} from '../scripts/bounded-response.js';
import {githubHead} from '../scripts/auto-update.js';
import {githubRelease} from '../scripts/manual-update.js';

function stream(chunks,{headers={},status=200}={}){
  let read=0,cancelled=0;
  const response=new Response(new ReadableStream({pull(controller){if(read===chunks.length)controller.close();else controller.enqueue(chunks[read++]);},cancel(){cancelled++;}},{highWaterMark:0}),{headers,status});
  return {response,reads:()=>read,cancelled:()=>cancelled};
}
const bytes=text=>Buffer.from(text);
test('response limits count decoded bytes, allow split UTF-8 and release the reader',async()=>{
  const raw=bytes('日本語😀'),f=stream([raw.subarray(0,2),raw.subarray(2,6),raw.subarray(6)]);
  assert.equal(await boundedResponseText(f.response,{maxBytes:raw.length}),'日本語😀');assert.equal(f.response.body.locked,false);
  const large=stream([raw]);await assert.rejects(boundedResponseText(large.response,{maxBytes:raw.length-1}));assert.equal(large.response.body.locked,false);
});
test('oversize and malformed advertised lengths cancel before reading any body',async()=>{
  for(const length of ['65537','-1','1e9','NaN','9007199254740993']){
    const f=stream([bytes('not read')],{headers:{'content-length':length}});await assert.rejects(boundedResponseText(f.response));assert.equal(f.reads(),0);assert.equal(f.cancelled(),1);
  }
});
test('absent or understated lengths cannot bypass the streaming cap and remaining data is not read',async()=>{
  for(const headers of [{},{'content-length':'1'}]){
    const f=stream([Buffer.alloc(32768),Buffer.alloc(32769),bytes('must not be read')],{headers});
    await assert.rejects(boundedResponseText(f.response));assert.equal(f.reads(),2);assert.equal(f.cancelled(),1);assert.equal(f.response.body.locked,false);
  }
});
test('HTTP errors, empty bodies, malformed UTF-8 and aborts fail closed without native error text',async()=>{
  const f=stream([bytes('PRIVATE_RESPONSE')],{status:503});await assert.rejects(boundedResponseText(f.response),e=>!e.message.includes('PRIVATE_RESPONSE'));assert.equal(f.cancelled(),1);
  await assert.rejects(boundedResponseText(new Response(null,{status:204})));
  await assert.rejects(boundedResponseText(new Response(Buffer.from([0xff]))));
  const abort=new AbortController();abort.abort(new Error('PRIVATE_REASON'));const pending=stream([bytes('never')]);
  await assert.rejects(boundedResponseText(pending.response,{signal:abort.signal}),e=>!e.message.includes('PRIVATE_REASON'));assert.equal(pending.reads(),0);assert.equal(pending.cancelled(),1);
  for(const maxBytes of [0,-1,1.5,Infinity,65537])await assert.rejects(boundedResponseText(new Response('text'),{maxBytes}));
});
test('both update metadata requests reject growing bodies and retain fixed paths and timeouts',async()=>{
  const sha='a'.repeat(40),head=stream([Buffer.alloc(65537),bytes('unused')]);
  await assert.rejects(githubHead({fetcher:async(url,options)=>{assert.ok(options.signal);assert.equal(options.redirect,'error');return head.response;}}));assert.equal(head.reads(),1);assert.equal(head.cancelled(),1);
  const version=stream([Buffer.alloc(65537),bytes('unused')]);let request=0;
  await assert.rejects(githubRelease({fetcher:async(url,options)=>{assert.ok(options.signal);assert.equal(options.redirect,'error');if(++request===1)return new Response(JSON.stringify({object:{sha}}));assert.ok(url.endsWith(`/${sha}/package.json`));return version.response;}}));
  assert.equal(version.reads(),1);assert.equal(version.cancelled(),1);
});
