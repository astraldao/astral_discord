import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {ChannelType,PermissionFlagsBits as P} from 'discord.js';
import {backupText} from '../src/backup-text.js';
import {createBackupReader} from '../src/backup-reader.js';
import {createPersistentVoice} from '../src/persistent-voice.js';
const wave=()=>{const b=Buffer.alloc(44+12000);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(192000,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(12000,40);return b;};
const tick=()=>new Promise(r=>setImmediate(r));
function i(action,user='owner',channelId='text'){return {user:{id:user},channelId,options:{getSubcommand:()=>action},replies:[],async deferReply(){this.deferred=true;},async editReply(p){this.replies.push(p);},async reply(p){this.replies.push(p);}};}
async function fixture(options={}){
  let allowed=true,time=0,workerClosed=0,voiceClosed=0;const spoken=[],notice={async edit(){}};
  const reader=createBackupReader({guild:{id:'guild'},enabled:true,now:()=>time,resolveTargets:async()=>({text:{send:async()=>notice},voice:{id:'voice'}}),authorize:async()=>{if(!allowed)throw new Error('permission');},canControl:async(i,s)=>{if(i.user.id!==s.owner)throw new Error('owner');},worker:()=>({ready:Promise.resolve(),stream:async(text,signal,onChunk)=>{spoken.push(text);onChunk(wave());},close:()=>workerClosed++}),speaker:async()=>({healthy:()=>true,play:async(_,o)=>{time+=100;o.onStart();},close:()=>voiceClosed++}),...options});
  await reader.handle(i('start'));assert.equal(reader.state?.ready,true);
  const message=(content,extra={})=>reader.onMessage({guildId:'guild',channelId:'text',content,author:{bot:false},...extra});
  return {reader,message,spoken,setTime:n=>time=n,deny:()=>allowed=false,workerClosed:()=>workerClosed,voiceClosed:()=>voiceClosed};
}
test('backup text reads 50 code points plus 以下略, preserves surrogate pairs and normalizes control whitespace',()=>{
  assert.equal(backupText('あ'.repeat(50)),'あ'.repeat(50));assert.equal(backupText('あ'.repeat(51)),'あ'.repeat(50)+'以下略');assert.equal(Array.from(backupText('🪐'.repeat(51))).length,53);assert.equal(backupText(' Ａ\n\tＢ '),'A B');assert.equal(backupText('   '),'');
});
test('only new human text from the command channel is read; no other guild/channel/bots/attachments',async()=>{
  const f=await fixture();for(const extra of [{guildId:'other'},{channelId:'other'},{author:{bot:true}},{webhookId:'hook'},{system:true}])f.message('秘密',extra);f.message('');assert.equal(f.spoken.length,0);
  f.message('こんにちは');await f.reader.idle();assert.deepEqual(f.spoken,['こんにちは']);assert.equal(f.reader.state.metrics.lastMs,100);await f.reader.close();assert.equal(f.workerClosed(),1);assert.equal(f.voiceClosed(),1);
});
test('messages finish in order without interruption and latency includes waiting, with bounded queue',async()=>{
  let release,plays=0;const f=await fixture({speaker:async()=>({healthy:()=>true,play:async(_,o)=>{o.onStart();if(++plays===1)await new Promise(r=>release=r);},close(){}})});
  f.message('最初の文章');await tick();f.message('次の文章');for(let n=0;n<12;n++)f.message('後続'+n);assert.ok(f.reader.state.queue.length<=8);assert.ok(f.reader.state.metrics.dropped>0);assert.deepEqual(f.spoken,['最初の文章']);f.setTime(700);release();await f.reader.idle();assert.equal(f.spoken[1],'次の文章');assert.ok(f.reader.state.metrics.overBudget>0);await f.reader.close();
});
test('foreign stop is refused, lost permissions stop without speaking and owner voice departure stops immediately',async()=>{
  const f=await fixture();await f.reader.handle(i('stop','other'));assert.equal(f.reader.active,true);f.deny();f.message('読まない');await f.reader.idle();assert.equal(f.reader.active,false);assert.deepEqual(f.spoken,[]);
  const g=await fixture();await g.reader.onVoiceChange({channelId:'voice'},{id:'owner',channelId:null,guild:{id:'guild'}});assert.equal(g.reader.active,false);assert.equal(g.workerClosed(),1);
});
test('disabled feature, active announcement and concurrent starts never acquire two voice connections',async()=>{
  let starts=0;const disabled=createBackupReader({guild:{id:'guild'},enabled:false,worker:()=>{starts++;}});await disabled.handle(i('start'));assert.equal(starts,0);
  const busy=createBackupReader({guild:{id:'guild'},enabled:true,voiceBusy:()=>true,worker:()=>{starts++;}});await busy.handle(i('start'));assert.equal(starts,0);assert.equal(busy.active,false);
  let complete;const f=await fixture();await f.reader.close();const reader=createBackupReader({guild:{id:'guild'},enabled:true,resolveTargets:()=>new Promise(r=>complete=r),canControl:async()=>{throw new Error('busy');},worker:()=>{starts++;}});const first=reader.handle(i('start'));await tick();await reader.handle(i('start','other'));assert.equal(starts,0);await reader.close();complete({text:{},voice:{id:'voice'}});await first;assert.equal(reader.active,false);
});
function fakeChild(write){const c=new EventEmitter();c.stdin=new EventEmitter();c.stdin.write=write;c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kills=0;c.kill=()=>{c.kills++;};return c;}
const frame=(data,body=Buffer.alloc(0))=>Buffer.concat([Buffer.from(JSON.stringify({...data,bytes:body.length})+'\n'),body]);
test('persistent voice reuses its process, parses fragmented WAV frames and closes cleanly',async()=>{
  let child;child=fakeChild(raw=>{const q=JSON.parse(raw),data=frame({id:q.id},wave());queueMicrotask(()=>{child.stdout.emit('data',data.subarray(0,5));child.stdout.emit('data',data.subarray(5));});});
  const worker=createPersistentVoice({launch:()=>child});child.stdout.emit('data',frame({type:'ready'}));await worker.ready;
  assert.deepEqual(await worker.synthesize('最初'),wave());assert.deepEqual(await worker.synthesize('次'),wave());await assert.rejects(worker.synthesize('a'.repeat(54)));worker.close();worker.close();assert.equal(child.kills,1);
});
test('worker startup/protocol/timeout failures reject pending work and do not leave a synthesis hanging',async()=>{
  const child=fakeChild(()=>{}),worker=createPersistentVoice({launch:()=>child,synthesisTimeout:10});child.stdout.emit('data',frame({type:'ready'}));await worker.ready;await assert.rejects(worker.synthesize('テスト'),/時間/);assert.equal(child.kills,1);
  const broken=fakeChild(()=>{}),bad=createPersistentVoice({launch:()=>broken});broken.stdout.emit('data',Buffer.from('not json\n'));await assert.rejects(bad.ready);assert.equal(broken.kills,1);
  const unopened=fakeChild(()=>{}),closed=createPersistentVoice({launch:()=>unopened});closed.close();await assert.rejects(closed.ready);
});

test('streamed segments arrive before synthesis completes and malformed order fails closed',async()=>{
  let child,lastId;child=fakeChild(raw=>{lastId=JSON.parse(raw).id;});const worker=createPersistentVoice({launch:()=>child});child.stdout.emit('data',frame({type:'ready'}));await worker.ready;
  const segments=[],job=worker.stream('本文',undefined,wav=>segments.push(wav));await tick();child.stdout.emit('data',frame({id:lastId,part:0},wave()));assert.equal(segments.length,1);child.stdout.emit('data',frame({id:lastId,part:1},wave()));child.stdout.emit('data',frame({id:lastId,end:true}));await job;assert.equal(segments.length,2);
  // Punctuation-only text can produce no moras; skip it without killing the reader.
  const silent=worker.stream('！',undefined,()=>assert.fail('unexpected audio'));await tick();child.stdout.emit('data',frame({id:lastId,end:true}));await silent;worker.close();
  let invalid,id;invalid=fakeChild(raw=>id=JSON.parse(raw).id);const bad=createPersistentVoice({launch:()=>invalid});invalid.stdout.emit('data',frame({type:'ready'}));await bad.ready;const request=bad.stream('本文',undefined,()=>{});await tick();invalid.stdout.emit('data',frame({id,part:1},wave()));await assert.rejects(request);assert.equal(invalid.kills,1);
});

test('real channel checks refuse threads and unreadable listeners, and recheck access before speaking',async()=>{
  let guestAllowed=false,starts=0,spoken=0,sourceType=ChannelType.GuildText;
  const owner={id:'owner',user:{bot:false},voice:{channelId:'voice'},permissions:{has:()=>false}},guest={id:'guest',user:{bot:false}},bot={id:'bot',user:{bot:true},voice:{serverMute:false}};
  const text={id:'text',get type(){return sourceType;},permissionsFor:member=>({has:()=>member.id!=='guest'||guestAllowed}),send:async()=>({edit:async()=>{}})};
  // Lobby moves can admit a member without the direct Connect permission.
  const voice={id:'voice',type:ChannelType.GuildVoice,members:new Map([['owner',owner],['guest',guest],['bot',bot]]),permissionsFor:member=>({has:permission=>member.id!=='owner'||permission===P.ViewChannel})};owner.voice.channel=voice;
  const fetched=[],guild={id:'guild',channels:{fetch:async id=>id==='text'?text:voice},members:{me:bot,fetchMe:async()=>bot,fetch:async options=>{assert.equal(options.force,true);fetched.push(options.user);return {owner,guest,bot}[options.user];}}};
  const reader=createBackupReader({guild,enabled:true,worker:()=>{starts++;return {ready:Promise.resolve(),stream:async(_,__,chunk)=>{spoken++;chunk(wave());},close(){}};},speaker:async()=>({healthy:()=>true,play:async(_,o)=>o.onStart(),close(){}})});
  await reader.handle(i('start'));assert.equal(reader.active,false);assert.equal(starts,0);
  guestAllowed=true;sourceType=ChannelType.PublicThread;await reader.handle(i('start'));assert.equal(reader.active,false);assert.equal(starts,0);
  sourceType=ChannelType.GuildText;await reader.handle(i('start'));assert.equal(reader.state.ready,true);assert.equal(starts,1);assert.ok(fetched.includes('guest'));
  guestAllowed=false;reader.onMessage({guildId:'guild',channelId:'text',content:'非公開の文章',author:{bot:false}});await reader.idle();assert.equal(reader.active,false);assert.equal(spoken,0);
  guestAllowed=true;await reader.handle(i('start'));assert.equal(reader.active,true);await reader.onVoiceChange({channelId:'voice'},{id:'bot',channelId:null,guild});assert.equal(reader.active,false);
});
