import test from 'node:test';
import assert from 'node:assert/strict';
import {crc32} from 'node:zlib';
import {MessageFlags} from 'discord.js';
import {encodePng} from '../src/sprite-image.js';
import {bannerImageInfo,MAX_BANNER_BYTES,readBannerAttachment} from '../src/banner-image.js';
import {bannerModal,createBannerController} from '../src/banner-ui.js';
const attachmentId='222222222222222222',channelId='111111111111111111';
const png=encodePng(Buffer.alloc(40*16*4,255),40,16),image={buffer:png,...bannerImageInfo(png)};
const file=(patch={})=>({id:attachmentId,size:png.length,url:`https://cdn.discordapp.com/ephemeral-attachments/${channelId}/${attachmentId}/image.png?ex=123&is=456&hm=abc`,...patch});
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
function interaction(customId='open',owner='owner',channel='channel',privateMessage=true){return {customId,user:{id:owner},channelId:channel,message:{flags:{has:()=>privateMessage}},replies:[],async deferReply(options){this.deferred=true;this.replyFlags=options.flags;},async deferUpdate(){this.deferred=true;this.updated=true;},async editReply(p){this.replies.push(p);},async reply(p){this.replied=true;this.replies.push(p);},async showModal(m){this.modal=m;}};}
async function fixture(t,options={}){
  let clock=0,allowed=true,remote={key:'original',url:'https://cdn.discordapp.com/banners/111111111111111111/original.png'},reader=async()=>image;
  const writes=[],c=createBannerController({access:async()=>allowed,current:async()=>({...remote}),update:async buffer=>{writes.push(buffer);remote={key:buffer?'new-'+writes.length:null,url:buffer?'https://cdn.discordapp.com/banners/111111111111111111/new.png':null};return {...remote};},read:(...args)=>reader(...args),now:()=>clock,...options});t.after(()=>c.close());
  const open=async(owner='owner')=>{const i=interaction('open',owner);await c.open(i);return {i,s:[...c.sessions.values()].find(s=>s.owner===owner)};};
  const {s}=await open(),click=(action,owner=s.owner,channel=s.channelId)=>interaction(`banner:${s.id}:${s.turn}:${action}`,owner,channel);
  const upload=async(session=s)=>{
    const start=interaction(`banner:${session.id}:${session.turn}:upload`,session.owner);await c.handle(start);assert.ok(start.modal);assert.equal(start.deferred,undefined);
    const submit=interaction(start.modal.toJSON().custom_id,session.owner);submit.fields={getUploadedFiles:()=>new Map([[attachmentId,file()]])};await c.handle(submit);return submit;
  };
  return {c,s,click,upload,open,writes,allow:value=>allowed=value,advance:ms=>clock+=ms,remote:value=>remote=value,read:value=>reader=value};
}
test('banner upload validates PNG structure, JPEG dimensions and bounded image sizes',()=>{
  assert.deepEqual(bannerImageInfo(png),{width:40,height:16,extension:'png',mime:'image/png'});
  const jpeg=Buffer.from([255,216,255,192,0,11,8,0,16,0,40,1,1,17,0,255,218,0,2,255,217]);
  assert.deepEqual(bannerImageInfo(jpeg),{width:40,height:16,extension:'jpg',mime:'image/jpeg'});
  for(const bad of [Buffer.from('<svg/>'),Buffer.from('GIF89a'),png.subarray(0,-1),Buffer.concat([png,Buffer.from('extra')]),Buffer.alloc(MAX_BANNER_BYTES+1)])assert.throws(()=>bannerImageInfo(bad));
  const broken=Buffer.from(png);broken[broken.length-5]^=1;assert.throws(()=>bannerImageInfo(broken));
  const huge=Buffer.from(png);huge.writeUInt32BE(8193,16);huge.writeUInt32BE(crc32(huge.subarray(12,29))>>>0,29);assert.throws(()=>bannerImageInfo(huge),/8192/);
});
test('downloads only matching Discord upload attachments, rejects redirects/oversize bodies and never fetches canceled work',async()=>{
  let requests=0;const fetcher=async(url,options)=>{requests++;assert.equal(options.redirect,'error');assert.ok(url.includes('hm=abc'));return new Response(png);};
  assert.deepEqual((await readBannerAttachment(file(),{fetcher})).buffer,png);
  for(const url of ['http://cdn.discordapp.com/attachments/x','https://example.com/x.png',`https://cdn.discordapp.com/attachments/${channelId}/333333333333333333/x.png`,`https://cdn.discordapp.com@127.0.0.1/attachments/${channelId}/${attachmentId}/x.png`,`https://cdn.discordapp.com/attachments/${channelId}/${attachmentId}/x.png#fragment`])await assert.rejects(readBannerAttachment(file({url}),{fetcher}));
  assert.equal(requests,1);
  await assert.rejects(readBannerAttachment(file(),{fetcher:async()=>new Response(null,{status:302,headers:{location:'https://example.com'}})}));
  await assert.rejects(readBannerAttachment(file(),{fetcher:async()=>new Response(Buffer.alloc(MAX_BANNER_BYTES+1))}),/4MiB/);
  await assert.rejects(readBannerAttachment(file(),{fetcher:async()=>new Response(png,{headers:{'content-length':String(MAX_BANNER_BYTES+1)}})}),/4MiB/);
  const abort=new AbortController();abort.abort();await assert.rejects(readBannerAttachment(file(),{fetcher,signal:abort.signal}));assert.equal(requests,1);
});
test('upload is a real one-file modal, preview is private, and applying/clearing requires explicit confirmation',async t=>{
  const f=await fixture(t);const submit=await f.upload();assert.equal(f.writes.length,0);assert.equal(f.s.view,'preview');assert.equal(submit.replies.at(-1).files[0].attachment,png);
  const modal=bannerModal(f.s).toJSON();assert.equal(modal.components[0].component.type,19);assert.equal(modal.components[0].component.max_values,1);
  await f.c.handle(f.click('apply'));assert.deepEqual(f.writes,[png]);assert.equal(f.s.draft,null);
  await f.c.handle(f.click('remove'));assert.equal(f.writes.length,1);assert.equal(f.s.view,'remove');await f.c.handle(f.click('cancel'));assert.equal(f.writes.length,1);
  await f.c.handle(f.click('remove'));await f.c.handle(f.click('apply'));assert.equal(f.writes.length,1);f.advance(60001);await f.c.handle(f.click('apply'));assert.equal(f.writes[1],null);assert.equal(f.s.current.key,null);
});
test('foreign owners/channels, revoked admins and stale controls cannot apply or disclose an upload',async t=>{
  const f=await fixture(t);await f.upload();const before=f.s.draft;
  for(const bad of [f.click('apply','other'),f.click('apply','owner','other-channel'),interaction(`banner:${f.s.id}:999:apply`)]){await f.c.handle(bad);assert.equal(f.writes.length,0);if(bad.user.id!=='owner'||bad.channelId!=='channel')assert.equal(bad.replies.at(-1).files,undefined);}
  f.allow(false);const denied=f.click('apply');await f.c.handle(denied);assert.equal(f.writes.length,0);assert.equal(denied.replies.at(-1).files,undefined);assert.equal(f.s.draft,before);
});
test('permission loss during download never reveals its preview and an expired session cannot apply',async t=>{
  const f=await fixture(t);f.read(async()=>{f.allow(false);return image;});const denied=await f.upload();assert.equal(f.s.draft,undefined);assert.equal(denied.replies.at(-1).files,undefined);
  f.allow(true);f.read(async()=>image);await f.upload();f.advance(600001);await f.c.handle(f.click('apply'));assert.equal(f.writes.length,0);assert.equal(f.c.sessions.size,0);assert.equal(f.s.draft,null);
});
test('only the newest upload form can replace the draft and a failed replacement keeps the existing image',async t=>{
  const f=await fixture(t);await f.upload();const draft=f.s.draft;
  const first=f.click('upload');await f.c.handle(first);const second=f.click('upload');await f.c.handle(second);
  const stale=interaction(first.modal.toJSON().custom_id);stale.fields={getUploadedFiles:()=>new Map([[attachmentId,file()]])};await f.c.handle(stale);assert.equal(f.s.draft,draft);
  f.read(async()=>{throw new Error('画像は4MiB以内です。');});const bad=interaction(second.modal.toJSON().custom_id);bad.fields={getUploadedFiles:()=>new Map([[attachmentId,file()]])};await f.c.handle(bad);assert.equal(f.s.draft,draft);assert.equal(f.writes.length,0);
});
test('a changed remote banner blocks an old preview until the administrator explicitly reviews current state',async t=>{
  const f=await fixture(t);await f.upload();f.remote({key:'changed',url:null});await f.c.handle(f.click('apply'));assert.equal(f.writes.length,0);assert.ok(f.s.draft);
  await f.c.handle(f.click('refresh'));assert.equal(f.s.current.key,'changed');await f.c.handle(f.click('apply'));assert.equal(f.writes.length,1);
});
test('only one global change can run and concurrent clicks cannot change the banner twice',async t=>{
  const gate=deferred();let writes=0;const f=await fixture(t,{update:async()=>{writes++;await gate.promise;return {key:'new',url:null};}});await f.upload();
  const other=(await f.open('other-admin')).s;await f.upload(other);
  const apply=f.c.handle(f.click('apply'));await tick();await f.c.handle(f.click('apply'));const click=interaction(`banner:${other.id}:${other.turn}:apply`,'other-admin');await f.c.handle(click);assert.equal(writes,1);gate.resolve();await apply;assert.equal(writes,1);
});
test('close frees pending image memory, session slots are bounded, and public-origin actions get private replies',async t=>{
  const f=await fixture(t);await f.upload();await f.c.handle(f.click('close'));assert.equal(f.s.draft,null);assert.equal(f.c.sessions.size,0);
  for(let n=0;n<5;n++)await f.open('admin-'+n);assert.equal(f.c.sessions.size,4);
  const denied=interaction('open','admin-5','channel',false);await f.c.open(denied);assert.equal(denied.replyFlags,MessageFlags.Ephemeral);assert.equal(denied.replies.at(-1).files,undefined);
});
test('all banner states serialize under native Discord limits and clear attachments after leaving preview',async t=>{
  const f=await fixture(t),messages=[];for(const action of ['upload','cancel','remove','cancel','close']){
    if(action==='upload')messages.push(...(await f.upload()).replies);else{const click=f.click(action);await f.c.handle(click);messages.push(...click.replies);}
  }
  const {i,s}=await f.open();messages.push(...i.replies);assert.ok(messages.some(m=>m.files?.length===1));assert.ok(messages.some(m=>m.embeds.length===2));
  for(const message of messages){message.embeds.forEach(embed=>{assert.ok(embed.toJSON().description.length<=4096);});assert.ok(message.components.length<=5);for(const row of message.components)assert.ok(row.toJSON().components.length<=5);assert.deepEqual(message.attachments,[]);}assert.equal(s.view,'home');
});

test('default authorization fetches current membership and ignores a stale interaction admin flag',async t=>{
  let calls=0;const options=[],c=createBannerController({guild:{members:{fetch:async value=>{options.push(value);return {permissions:{has:()=>false}};}},channels:{fetch:async()=>({permissionsFor:()=>({has:()=>true})})}},current:async()=>{calls++;return {key:null,url:null};},update:async()=>assert.fail('unauthorized write')});t.after(()=>c.close());
  const i=interaction();i.memberPermissions={has:()=>true};await c.open(i);assert.equal(calls,0);assert.equal(c.sessions.size,0);assert.deepEqual(options,[{user:'owner',force:true}]);assert.ok(JSON.stringify(i.replies).includes('管理者専用'));
});
test('reopening retains the candidate, fetches the current banner, rejects old buttons and keeps the original expiry',async t=>{
  const f=await fixture(t);await f.upload();const old=f.click('apply'),draft=f.s.draft,expires=f.s.expires;
  f.remote({key:'changed',url:null});f.advance(120000);const {s,i}=await f.open();
  assert.equal(s,f.s);assert.equal(s.draft,draft);assert.equal(s.current.key,'changed');assert.equal(s.base,'changed');assert.equal(s.expires,expires);assert.equal(s.view,'preview');assert.equal(f.writes.length,0);assert.equal(i.replies.at(-1).files.length,1);
  await f.c.handle(old);assert.equal(f.writes.length,0);f.advance(480001);const fresh=await f.open();assert.notEqual(fresh.s.id,s.id);assert.equal(s.draft,null);assert.equal(fresh.s.view,'home');
});
test('reopening a banner candidate after permission loss exposes no image and cannot replace a busy upload',async t=>{
  const f=await fixture(t);await f.upload();f.allow(false);const denied=await f.open();assert.equal(denied.i.replies.at(-1).files,undefined);assert.equal(f.c.sessions.get(f.s.id),f.s);
  f.allow(true);const pending=deferred();f.read(()=>pending.promise);const task=f.upload();await tick();assert.equal(f.s.busy,true);const again=await f.open();assert.ok(JSON.stringify(again.i.replies).includes('処理中'));assert.equal(f.c.sessions.get(f.s.id),f.s);pending.resolve(image);await task;
});
test('an unknown update outcome keeps the draft and rechecks remote state before any retry',async t=>{
  let calls=0;const remote={key:'old',url:null},f=await fixture(t,{current:async()=>({...remote}),update:async()=>{calls++;remote.key='actually-applied';throw new Error('通信が切れました。現在を確認してください。');}});await f.upload();
  const apply=f.click('apply');await f.c.handle(apply);assert.equal(calls,1);assert.ok(f.s.draft);assert.equal(f.s.uncertain,true);
  const screen=apply.replies.at(-1);assert.ok(JSON.stringify(screen).includes('反映結果を確認'));assert.equal(screen.components[0].toJSON().components.find(b=>b.custom_id.endsWith(':apply')).disabled,true);
  await f.c.handle(f.click('apply'));assert.equal(calls,1);assert.ok(f.s.draft);
});
