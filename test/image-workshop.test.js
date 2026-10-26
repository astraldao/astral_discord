import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {crc32} from 'node:zlib';
import sharp from 'sharp';
import {MessageFlags,PermissionFlagsBits as P} from 'discord.js';
import {readWorkshopImage,workshopImageInfo} from '../src/image-workshop-input.js';
import {processWorkshopImage} from '../src/image-workshop-process.js';
import {createImageWorkshop,workshopScreen} from '../src/image-workshop-ui.js';
import {commands} from '../src/commands.js';
import {createMainMenu} from '../src/main-menu.js';
const png=await sharp({create:{width:60,height:20,channels:4,background:{r:255,g:0,b:0,alpha:.5}}}).png().toBuffer(),source={buffer:png,width:60,height:20,extension:'png',mime:'image/png'},channel='111111111111111111',id='222222222222222222';
const file=(extra={})=>({id,size:png.length,url:`https://cdn.discordapp.com/ephemeral-attachments/${channel}/${id}/image.png?ex=123&hm=fixture`,...extra}),tick=()=>new Promise(r=>setImmediate(r));
test('actual native conversion outputs the three fixed presets and strips metadata',async()=>{
  const original=await sharp(png).withMetadata({exif:{IFD0:{Artist:'PRIVATE_ARTIST',Copyright:'PRIVATE_GPS'}}}).toBuffer();
  for(const preset of ['emoji','sticker','share']){
    const r=await processWorkshopImage(original,{preset}),m=await sharp(r.buffer).metadata();assert.equal(m.format,preset==='share'?'jpeg':'png');assert.equal(m.exif,undefined);assert.equal(m.icc,undefined);assert.equal(m.xmp,undefined);assert.equal(m.orientation,undefined);assert.doesNotMatch(r.buffer.toString(),/PRIVATE_ARTIST|PRIVATE_GPS/);
    if(preset==='emoji')assert.deepEqual([m.width,m.height],[128,128]);if(preset==='sticker')assert.deepEqual([m.width,m.height],[320,320]);if(preset==='share')assert.deepEqual([m.width,m.height],[60,20]);assert.ok(r.buffer.length<=(preset==='emoji'?256:512)*1024);
  }
});
test('contain keeps transparent margins, while JPEG uses a white background and honors EXIF orientation',async()=>{
  const r=await processWorkshopImage(png),a=await sharp(r.buffer).ensureAlpha().raw().toBuffer();assert.equal(a[3],0);assert.ok(a[(64*128+64)*4+3]>=127);
  const jpeg=await sharp({create:{width:60,height:20,channels:3,background:'red'}}).jpeg().withMetadata({orientation:6}).toBuffer(),out=await processWorkshopImage(jpeg,{preset:'share'});assert.deepEqual([out.width,out.height],[20,60]);
  const white=await processWorkshopImage(png,{preset:'share'}),pixel=await sharp(white.buffer).raw().toBuffer();assert.ok(pixel[0]>240&&pixel[1]>110&&pixel[2]>110);
  const square=await processWorkshopImage(png,{preset:'share',crop:'centre'});assert.deepEqual([square.width,square.height],[20,20]);
});
test('crop anchors select the expected original region instead of distorting the image',async()=>{
  const raw=Buffer.alloc(60*20*3);for(let y=0;y<20;y++)for(let x=0;x<60;x++)raw[(y*60+x)*3+(x<20?0:x<40?1:2)]=255;
  const input=await sharp(raw,{raw:{width:60,height:20,channels:3}}).png().toBuffer();
  for(const [crop,component] of [['west',0],['centre',1],['east',2]]){const r=await processWorkshopImage(input,{crop}),b=await sharp(r.buffer).removeAlpha().raw().toBuffer();assert.ok(b[(64*128+64)*3+component]>240,crop);}
});
test('a detailed image near the upload limit is actually compressed to the shared-image byte budget',async()=>{
  const raw=Buffer.alloc(1024*1024*3);let seed=123456789;for(let i=0;i<raw.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;raw[i]=seed&255;}
  const input=await sharp(raw,{raw:{width:1024,height:1024,channels:3}}).png().toBuffer();assert.ok(input.length>2*1024*1024);const output=await processWorkshopImage(input,{preset:'share'});assert.ok(output.buffer.length<=512*1024);assert.ok(output.width<=1024&&output.height<=1024);assert.equal((await sharp(output.buffer).metadata()).format,'jpeg');
});
test('oversized pixels, animation, unsupported formats and untrusted options fail before a decoder process starts',async()=>{
  const large=await sharp({create:{width:3000,height:2000,channels:3,background:'white'}}).png().toBuffer();assert.throws(()=>workshopImageInfo(large),/400万/);
  const actl=Buffer.alloc(20);actl.writeUInt32BE(8,0);actl.write('acTL',4);actl.writeUInt32BE(2,8);actl.writeUInt32BE(crc32(actl.subarray(4,16))>>>0,16);const animated=Buffer.concat([png.subarray(0,33),actl,png.subarray(33)]);
  for(const image of [large,animated,Buffer.from('GIF89a'),Buffer.from('<svg/>'),Buffer.from('RIFFxxxxWEBP'),Buffer.alloc(4*1024*1024+1)])await assert.rejects(processWorkshopImage(image,{launcher:()=>assert.fail('must not spawn')}));
  for(const options of [{preset:'constructor'},{crop:'__proto__'},{preset:'../secret'}])await assert.rejects(processWorkshopImage(png,{...options,launcher:()=>assert.fail('must not spawn')}));
});
test('a structurally valid PNG with corrupt pixel data fails in the real decoder without exposing native errors',async()=>{
  const broken=Buffer.from(png);let at=8;while(at<broken.length){const length=broken.readUInt32BE(at);if(broken.toString('ascii',at+4,at+8)==='IDAT'){broken[at+8]=0;broken.writeUInt32BE(crc32(broken.subarray(at+4,at+8+length))>>>0,at+8+length);break;}at+=12+length;}
  assert.equal(workshopImageInfo(broken).width,60);await assert.rejects(processWorkshopImage(broken),e=>/変換できません/.test(e.message)&&!e.message.includes('libvips'));
});
test('upload accepts only a bounded matching Discord CDN attachment and cancels stalled streams',async()=>{
  let calls=0;const fetcher=async()=>{calls++;return new Response(png);};assert.deepEqual((await readWorkshopImage(file(),{fetcher})).buffer,png);
  for(const patch of [{size:0},{size:4*1024*1024+1},{url:'https://127.0.0.1/image.png'},{url:`https://cdn.discordapp.com@127.0.0.1/attachments/${channel}/${id}/x.png`},{url:`https://cdn.discordapp.com/attachments/${channel}/333333333333333333/x.png`},{url:`https://cdn.discordapp.com/attachments/${channel}/${id}/x.png#x`}])await assert.rejects(readWorkshopImage(file(patch),{fetcher:()=>assert.fail('invalid upload fetched')}));
  for(const response of [new Response(png,{status:302}),new Response(png,{headers:{'content-length':'NaN'}}),new Response(Buffer.alloc(4*1024*1024+1)),new Response(png.subarray(1))])await assert.rejects(readWorkshopImage(file(),{fetcher:async()=>response}));
  let canceled=false;await assert.rejects(readWorkshopImage(file(),{timeoutMs:10,fetcher:async()=>new Response(new ReadableStream({cancel(){canceled=true;}}))}));assert.equal(canceled,true);
  await assert.rejects(readWorkshopImage(file(),{timeoutMs:10,fetcher:()=>new Promise(()=>{})}));assert.equal(calls,1);
});
test('too many empty upload chunks and aborting before fetch cannot retain or disclose image data',async()=>{
  let canceled=false;await assert.rejects(readWorkshopImage(file(),{fetcher:async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array());},cancel(){canceled=true;}}))}));assert.equal(canceled,true);
  const abort=new AbortController();abort.abort();await assert.rejects(readWorkshopImage(file(),{signal:abort.signal,fetcher:()=>assert.fail('aborted')}));
});
function fakeLauncher(output,{hang=false,code=0}={}){
  let killed=0,options;const launch=(bin,args,opts)=>{assert.equal(bin,process.execPath);assert.ok(args[1].endsWith('/scripts/image-workshop-worker.js'));assert.equal(opts.shell,undefined);options=opts;const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.kill=()=>{killed++;queueMicrotask(()=>child.emit('close',null));};child.stdin.on('finish',()=>{if(!hang)queueMicrotask(()=>{child.stdout.write(output);child.emit('close',code);});});return child;};return {launch,kills:()=>killed,options:()=>options};
}
test('decoder processes receive no inherited secrets, and malformed or excessive output never escapes as a native error',async()=>{
  for(const output of [Buffer.from('PRIVATE_NATIVE_ERROR'),Buffer.concat([Buffer.from('{"width":1,"height":1,"format":"png"}\n'),png]),Buffer.alloc(512*1024+257)]){const f=fakeLauncher(output);await assert.rejects(processWorkshopImage(png,{launcher:f.launch}),e=>!e.message.includes('PRIVATE'));assert.deepEqual(Object.keys(f.options().env).sort(),['MALLOC_ARENA_MAX','NODE_ENV','UV_THREADPOOL_SIZE','VIPS_CONCURRENCY']);assert.deepEqual(f.options().stdio,['pipe','pipe','ignore']);}
});
test('decoder timeout and session abort kill the child before completing the operation',async()=>{
  const timed=fakeLauncher(null,{hang:true});await assert.rejects(processWorkshopImage(png,{timeoutMs:10,launcher:timed.launch}));assert.equal(timed.kills(),1);
  const f=fakeLauncher(null,{hang:true}),abort=new AbortController(),job=processWorkshopImage(png,{launcher:f.launch,signal:abort.signal});abort.abort();await assert.rejects(job);assert.equal(f.kills(),1);
});
function fixture(t,extra={}){
  let stamp=0,allowed=true,voice=false,reads=0,converts=0;const c=createImageWorkshop({now:()=>stamp,access:async()=>allowed,canProcess:()=>!voice,read:async()=>{reads++;return source;},convert:async()=>{converts++;return source;},...extra});t.after(()=>c.close());
  const event=customId=>({customId,user:{id:'owner'},channelId:'channel',message:{flags:{has:x=>x===MessageFlags.Ephemeral}},async deferReply(){this.deferred=true;},async deferUpdate(){this.deferred=true;},async editReply(m){this.result=m;},async reply(m){this.result=m;},async showModal(m){this.modal=m;}});
  const open=async()=>{const i=event();await c.open(i);return i;},click=(s,action)=>({...event(`image:${s.id}:${s.turn}:${action}`),user:{id:s.owner},channelId:s.channel}),upload=async s=>{const modal=click(s,'upload');await c.handle(modal);const i={...event(modal.modal.toJSON().custom_id),user:{id:s.owner},channelId:s.channel};i.fields={getUploadedFiles:()=>new Map([['image',file()]])};await c.handle(i);return i;};
  return {c,event,open,click,upload,session:()=>[...c.sessions.values()][0],allow:x=>allowed=x,voice:x=>voice=x,time:x=>stamp=x,counts:()=>({reads,converts})};
}
test('workshop is an existing-menu destination, and opening never fetches or converts an image',async t=>{
  const f=fixture(t),i=await f.open(),s=f.session();assert.equal(f.c.sessions.size,1);assert.deepEqual(f.counts(),{reads:0,converts:0});assert.equal(i.result.files,undefined);assert.ok(i.result.components.length<=5);
  const menu=commands()[0].toJSON();assert.ok(menu.options[0].choices.some(c=>c.value==='workshop'));let opened=0;const hub=createMainMenu({access:async()=>({admin:false}),openWorkshop:async()=>opened++});await hub.handle({...f.event('menu:workshop'),options:{getString:()=>null}});assert.equal(opened,1);assert.equal(s.input,null);
});
test('file picker acknowledges immediately, upload requires a fresh permitted session, and creation is explicit',async t=>{
  let checkCount=0;const f=fixture(t,{access:async()=>{checkCount++;return true;}});await f.open();const s=f.session(),checks=checkCount,modal=f.click(s,'upload');await f.c.handle(modal);assert.equal(checkCount,checks);assert.ok(modal.modal);assert.equal(modal.deferred,undefined);
  const submit=f.event(modal.modal.toJSON().custom_id);submit.fields={getUploadedFiles:()=>new Map([['x',file()]])};await f.c.handle(submit);assert.ok(s.input);assert.deepEqual(f.counts(),{reads:1,converts:0});
  const create=f.click(s,'create');await f.c.handle(create);assert.equal(f.counts().converts,1);assert.equal(create.result.files.length,1);assert.match(create.result.files[0].name,/^astral-emoji\.png$/);assert.equal(create.result.embeds[0].toJSON().image.url,'attachment://astral-emoji.png');
});
test('settings invalidate the previous output, validate every value, and stale controls cannot create again',async t=>{
  const f=fixture(t);await f.open();const s=f.session();await f.upload(s);const old=f.click(s,'create');await f.c.handle(old);assert.ok(s.output);
  const preset=f.click(s,'preset');preset.values=['sticker'];await f.c.handle(preset);assert.equal(s.output,null);assert.equal(preset.result.files,undefined);assert.deepEqual(preset.result.attachments,[]);assert.equal(s.preset,'sticker');await f.c.handle(old);assert.equal(f.counts().converts,1);
  for(const value of ['__proto__','constructor','../x']){const i=f.click(s,'crop');i.values=[value];await f.c.handle(i);assert.equal(s.crop,'contain');}
});
test('other users, channels, outdated forms and revoked permissions cannot read or create image files',async t=>{
  const f=fixture(t);await f.open();const s=f.session();await f.upload(s);
  for(const change of [i=>{i.user={id:'other'};},i=>{i.channelId='other';},i=>{i.customId=`image:${s.id}:999:create`;}]){const i=f.click(s,'create');change(i);await f.c.handle(i);assert.equal(i.result.files,undefined);assert.equal(f.counts().converts,0);}
  const modal=f.click(s,'upload');await f.c.handle(modal);f.allow(false);const i=f.event(modal.modal.toJSON().custom_id);i.fields={getUploadedFiles:()=>assert.fail('revoked')};await f.c.handle(i);assert.equal(i.result.files,undefined);
});
test('permission loss during upload or conversion prevents adoption and disclosure of the new image',async t=>{
  for(const stage of ['read','convert']){let allowed=true;const f=fixture(t,{access:async()=>allowed,...(stage==='read'?{read:async()=>{allowed=false;return source;}}:{convert:async()=>{allowed=false;return source;}})});await f.open();const s=f.session();const uploaded=await f.upload(s);if(stage==='convert'){assert.ok(s.input);const i=f.click(s,'create');await f.c.handle(i);assert.equal(s.output,null);assert.equal(i.result.files,undefined);}else{assert.equal(s.input,null);assert.equal(uploaded.result.files,undefined);}}
});
test('expiry, explicit close and shutdown discard buffers and cancel work',async t=>{
  for(const action of ['expiry','close','shutdown']){const f=fixture(t);await f.open();const s=f.session();await f.upload(s);if(action==='close')await f.c.handle(f.click(s,'close'));else if(action==='shutdown')f.c.close();else{f.time(600001);await f.c.handle(f.click(s,'create'));}assert.equal(s.input,null);assert.equal(s.output,null);assert.equal(s.abort.signal.aborted,true);assert.equal(f.c.sessions.size,0);}
});
test('a session that expires during native processing cannot publish the resulting file',async t=>{
  const f=fixture(t,{convert:async()=>{f.time(600001);return source;}});await f.open();const s=f.session();await f.upload(s);const i=f.click(s,'create');await f.c.handle(i);assert.equal(i.result.files,undefined);assert.equal(s.input,null);assert.equal(f.c.busy,false);
});
test('voice activity, double clicks and overlapping users do not queue decoder jobs',async t=>{
  let release,calls=0;const f=fixture(t,{convert:()=>{calls++;return new Promise(resolve=>{release=resolve;});}});await f.open();const s=f.session();await f.upload(s);f.voice(true);await f.c.handle(f.click(s,'create'));assert.equal(calls,0);f.voice(false);
  const first=f.c.handle(f.click(s,'create'));await tick();assert.equal(f.c.busy,true);await f.c.handle(f.click(s,'create'));assert.equal(calls,1);release(source);await first;assert.equal(f.c.busy,false);
  const again=f.click(s,'create');await f.c.handle(again);assert.equal(calls,1);assert.match(JSON.stringify(again.result),/秒お待ち/);
});
test('a second user cannot enqueue work behind an active decoder',async t=>{
  let release,calls=0;const f=fixture(t,{convert:()=>{calls++;return new Promise(resolve=>{release=resolve;});}});await f.open();const a=f.session();await f.upload(a);const task=f.c.handle(f.click(a,'create'));await tick();
  const open=f.event();open.user={id:'second'};await f.c.open(open);const b=[...f.c.sessions.values()].find(s=>s.owner==='second');await f.upload(b);const i=f.click(b,'create');await f.c.handle(i);assert.equal(calls,1);assert.match(JSON.stringify(i.result),/別の画像/);release(source);await task;
});
test('leaving for another menu preserves the completed result without overwriting the new screen',async t=>{
  let release;const f=fixture(t,{convert:()=>new Promise(resolve=>{release=resolve;})});await f.open();const s=f.session();await f.upload(s);const i=f.click(s,'create'),task=f.c.handle(i);await tick();assert.match(JSON.stringify(i.result),/作成しています/);
  f.c.leave(f.event('menu:open'));release(source);await task;assert.equal(i.result.files,undefined);assert.ok(s.output);const resumed=await f.open();assert.equal(resumed.result.files.length,1);assert.equal(s.hidden,false);
});
test('default authorization refetches members and channels and requires file permissions even for ordinary members',async t=>{
  const fetched=[];let files=false;const member={user:{bot:false},pending:false},bot={},text={guildId:'g',isTextBased:()=>true,isThread:()=>false,permissionsFor:person=>({has:bits=>person===member||files||!Array.isArray(bits)||!bits.includes(P.AttachFiles)})},guild={id:'g',members:{fetch:async o=>{fetched.push(o);return member;},fetchMe:async o=>{fetched.push(o);return bot;}},channels:{fetch:async(_id,o)=>{fetched.push(o);return text;}}};
  const c=createImageWorkshop({guild});t.after(()=>c.close());const f=fixture(t),denied=f.event();await c.open(denied);assert.equal(c.sessions.size,0);assert.match(JSON.stringify(denied.result),/ファイル添付/);files=true;await c.open(f.event());assert.equal(c.sessions.size,1);assert.ok(fetched.every(o=>o.force===true));
});
test('session expiry during awaited access validation prevents image retrieval',async t=>{
  let expire=false;const f=fixture(t,{access:async()=>{if(expire)f.time(600001);return true;}});await f.open();const s=f.session(),modal=f.click(s,'upload');await f.c.handle(modal);expire=true;const submit=f.event(modal.modal.toJSON().custom_id);submit.fields={getUploadedFiles:()=>assert.fail('expired form')};await f.c.handle(submit);assert.equal(f.counts().reads,0);assert.equal(s.input,null);assert.equal(f.c.sessions.size,0);
});
test('reopening resumes the same draft, but another channel replaces it and global session capacity stays bounded',async t=>{
  const f=fixture(t);await f.open();const s=f.session();await f.upload(s);await f.open();assert.equal(f.session(),s);assert.ok(s.input);
  const other=f.event();other.channelId='new-channel';await f.c.open(other);assert.equal(s.input,null);assert.equal(s.abort.signal.aborted,true);
  for(let n=1;n<=20;n++){const i=f.event();i.user={id:`user${n}`};await f.c.open(i);}assert.equal(f.c.sessions.size,20);
});
test('empty screens do not occupy image slots, but four concurrent uploads reserve the full buffer budget',async t=>{
  const waiting=[];const f=fixture(t,{read:()=>new Promise(resolve=>waiting.push(resolve))}),jobs=[];
  for(let n=0;n<5;n++){const open=f.event();open.user={id:`slot${n}`};await f.c.open(open);const s=[...f.c.sessions.values()].find(s=>s.owner===`slot${n}`);jobs.push(f.upload(s));await tick();}
  assert.equal(waiting.length,4);for(const done of waiting)done(source);const results=await Promise.all(jobs);assert.match(JSON.stringify(results[4].result),/保持枠/);assert.equal([...f.c.sessions.values()].filter(s=>s.input).length,4);
});
test('screens fit native component limits and never echo original names, URLs or arbitrary errors',async t=>{
  const f=fixture(t);await f.open();const s=f.session();await f.upload(s);s.input.name='PRIVATE_NAME';s.input.url='PRIVATE_URL';s.output=source;
  const m=workshopScreen(s),json=JSON.stringify(m);assert.doesNotMatch(json,/PRIVATE_/);assert.ok(m.components.length<=5);for(const r of m.components){const components=r.toJSON().components;if(components[0].type===2)assert.ok(components.length<=3);}assert.ok(m.embeds[0].toJSON().description.length<1500);
  const g=fixture(t,{convert:async()=>{throw new Error('SECRET_TOKEN /private/path');}});await g.open();const b=g.session();await g.upload(b);const i=g.click(b,'create');await g.c.handle(i);assert.doesNotMatch(JSON.stringify(i.result),/SECRET_TOKEN|private\/path/);
});
