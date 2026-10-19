import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedResponseText} from '../scripts/bounded-response.js';
import {readBannerAttachment} from '../src/banner-image.js';
import {encodePng} from '../src/sprite-image.js';
import {createIacharaClient} from '../src/iachara.js';
import {createDensukeClient} from '../src/densuke.js';
const fragmented=data=>{
  const buffer=Buffer.isBuffer(data)?data:Buffer.from(data);let offset=0;
  return new Response(new ReadableStream({pull(controller){if(offset===buffer.length){controller.close();return;}const end=Math.min(buffer.length,offset+1+offset%7);controller.enqueue(buffer.subarray(offset,end));offset=end;}},{highWaterMark:0}));
};
test('update metadata preserves UTF-8 split across many fragments and keeps the same exact cap',async()=>{
  const text='日本語😀'.repeat(1000);assert.equal(await boundedResponseText(fragmented(text)),text);
  await assert.rejects(boundedResponseText(fragmented('a'.repeat(65537))));
});
test('banner downloads reassemble many small fragments without changing the image or attachment policy',async()=>{
  const png=encodePng(Buffer.alloc(40*16*4,255),40,16),id='222222222222222222',source={id,size:png.length,url:`https://cdn.discordapp.com/attachments/111111111111111111/${id}/banner.png`};
  const result=await readBannerAttachment(source,{fetcher:async(_,options)=>{assert.equal(options.redirect,'error');return fragmented(png);}});assert.deepEqual(result.buffer,png);assert.equal(result.width,40);assert.equal(result.height,16);
});
test('Iachara auth and character responses retain JSON, Unicode and the operation byte budget under fragmentation',async()=>{
  let requests=0;const sheet={version:'6th',profile:{name:'分割された日本語'},abilities:{str:{value:10}},memo:'本文'};
  const client=createIacharaClient({fetchImpl:async url=>{requests++;return fragmented(JSON.stringify(url.includes('guestToken')?{token:'guest'}:url.includes('signInWithCustomToken')?{idToken:'id',expiresIn:'3600'}:{success:true,data:{data:sheet}}));}});
  const result=await client.fetchCharacter('https://iachara.com/view/101');assert.equal(result.name,sheet.profile.name);assert.ok(result.txt.includes('分割された日本語'));assert.equal(requests,3);
});
test('Densuke passes complete fragmented pages to its parser and still creates at most once',async()=>{
  let requests=0;const pages=['確認ページ 日本語'.repeat(1500),'完了ページ 日本語'.repeat(1500)],seen=[];
  const answer='https://www.densuke.biz/list?cd=Example1',edit='https://www.densuke.biz/edit?cd=Example1&pw=private';
  const client=createDensukeClient(async()=>fragmented(pages[requests++]),{parsePage:async(kind,html)=>{seen.push(html);return kind==='confirmation'?true:{answer,edit};}});
  assert.deepEqual(await client.create({name:'卓',schedule:'10/31',description:'',password:'',choice:'1'},'owner@example.com'),{answer,edit});assert.equal(requests,2);assert.deepEqual(seen,pages);
});
