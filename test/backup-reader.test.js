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
  let allowed=true,time=0,workerClosed=0,voiceClosed=0;const spoken=[],played=[],notice={async edit(){}};
  const reader=createBackupReader({guild:{id:'guild'},enabled:true,now:()=>time,resolveTargets:async()=>({text:{send:async()=>notice},voice:{id:'voice'}}),authorize:async()=>{if(!allowed)throw new Error('permission');},canControl:async(i,s)=>{if(i.user.id!==s.owner)throw new Error('owner');},worker:()=>({ready:Promise.resolve(),stream:async(text,signal,onChunk)=>{spoken.push(text);onChunk(wave());},close:()=>workerClosed++}),speaker:async()=>({healthy:()=>true,play:async(source,o)=>{played.push(source);time+=100;o.onStart();},close:()=>voiceClosed++}),...options});
  await reader.handle(i('start'));assert.equal(reader.state?.ready,true);
  const message=(content,extra={})=>reader.onMessage({guildId:'guild',channelId:'text',content,author:{bot:false},...extra});
  return {reader,message,spoken,played,setTime:n=>time=n,deny:()=>allowed=false,workerClosed:()=>workerClosed,voiceClosed:()=>voiceClosed};
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
  f.message('最初の文章');await tick();f.message('次の文章');for(let n=0;n<12;n++)f.message('後続'+n);assert.ok(f.reader.state.queue.length<=8);assert.ok(f.reader.state.metrics.dropped>0);await tick();assert.deepEqual(f.spoken,['最初の文章','次の文章']);f.setTime(700);release();await f.reader.idle();assert.equal(f.spoken[1],'次の文章');assert.ok(f.reader.state.metrics.overBudget>0);await f.reader.close();
});
test('only the next queued message is prepared during playback, preserving FIFO and the playback-time volume',async()=>{
  let release,level=30;const values=[],wav=wave();for(let at=44;at<wav.length;at+=2)wav.writeInt16LE(1000,at);
  const spoken=[],f=await fixture({volume:()=>level,worker:()=>({ready:Promise.resolve(),stream:async(text,_,chunk)=>{spoken.push(text);chunk(wav);},close(){}}),speaker:async()=>({healthy:()=>true,close(){},async play(source,o){o.onStart();const chunks=[];for await(const chunk of source)chunks.push(chunk);values.push(Buffer.concat(chunks).readInt16LE(6000));if(values.length===1)await new Promise(r=>release=r);}})});
  f.message('一番');await tick();f.message('二番');f.message('三番');await tick();assert.deepEqual(spoken,['一番','二番']);assert.equal(values.length,1);assert.ok(f.reader.state.queue[0].prepared.bufferedBytes>0);assert.equal(f.reader.state.queue[1].prepared,undefined);
  level=60;release();await f.reader.idle();assert.deepEqual(spoken,['一番','二番','三番']);assert.deepEqual(values,[300,600,600]);assert.equal(f.reader.state.metrics.prefetched,2);await f.reader.close();
});
test('prepared speech is discarded if permissions disappear before its turn and never reaches the player',async()=>{
  let release,played=0;const f=await fixture({speaker:async()=>({healthy:()=>true,close(){},async play(_,o){o.onStart();played++;await new Promise(r=>release=r);}})});
  f.message('先の文章');await tick();f.message('読む権限を失う文章');await tick();const prepared=f.reader.state.queue[0].prepared;assert.ok(prepared.bufferedBytes>0);
  f.deny();release();await f.reader.idle();assert.equal(played,1);assert.equal(f.reader.active,false);assert.equal(prepared.bufferedBytes,0);assert.equal(f.workerClosed(),1);
});
test('an idle voice fault stops resources, offers restart, and an old fault cannot stop a replacement session',async()=>{
  let fault,notice;const f=await fixture({resolveTargets:async()=>({text:{send:async()=>({edit:async m=>notice=m})},voice:{id:'voice'}}),speaker:async(_,__,options)=>{fault=options.onFault;return {healthy:()=>true,close(){}};}});
  const old=fault;await old();assert.equal(f.reader.active,false);assert.equal(f.workerClosed(),1);assert.ok(JSON.stringify(notice).includes('read:start'));
  await f.reader.handle(i('start'));const id=f.reader.state.id;await old();assert.equal(f.reader.state.id,id);await f.reader.close();
});
test('foreign stop is refused, lost permissions stop without speaking and owner voice departure stops immediately',async()=>{
  const f=await fixture();await f.reader.handle(i('stop','other'));assert.equal(f.reader.active,true);f.deny();f.message('読まない');await f.reader.idle();assert.equal(f.reader.active,false);assert.deepEqual(f.played,[]);
  const g=await fixture();await g.reader.onVoiceChange({channelId:'voice'},{id:'owner',channelId:null,guild:{id:'guild'}});assert.equal(g.reader.active,false);assert.equal(g.workerClosed(),1);
});
test('menu status never starts or replaces reading and direct stop still checks the current owner',async()=>{
  const f=await fixture(),id=f.reader.state.id;
  const menu=(action,user='owner')=>({...i('unused',user),customId:`menu:${action}`,deferred:true,deferReply:()=>assert.fail('already acknowledged')});
  await f.reader.handle(menu('read'),'status');assert.equal(f.reader.state.id,id);
  await f.reader.handle(menu('stop','other'),'stop');assert.equal(f.reader.state.id,id);
  await f.reader.handle(menu('stop'),'stop');assert.equal(f.reader.active,false);
  const stopped=menu('read');await f.reader.handle(stopped,'status');assert.equal(f.reader.active,false);assert.ok(JSON.stringify(stopped.replies).includes('read:start'));
  await f.reader.handle(menu('read'),'start');assert.equal(f.reader.active,false);
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
  const child=fakeChild(()=>{}),worker=createPersistentVoice({launch:()=>child,firstAudioTimeout:10});child.stdout.emit('data',frame({type:'ready'}));await worker.ready;await assert.rejects(worker.synthesize('テスト'),e=>e.code==='SYNTHESIS_START_TIMEOUT');assert.equal(child.kills,1);
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
  let latestBot=bot;
  const text={id:'text',get type(){return sourceType;},permissionsFor:member=>({has:()=>member.canRead!==false&&(member.id!=='guest'||guestAllowed)}),send:async()=>({edit:async()=>{}})};
  // Lobby moves can admit a member without the direct Connect permission.
  const voice={id:'voice',type:ChannelType.GuildVoice,members:new Map([['owner',owner],['guest',guest],['bot',bot]]),permissionsFor:member=>({has:permission=>member.id!=='owner'||permission===P.ViewChannel})};owner.voice.channel=voice;
  const fetched=[],guild={id:'guild',channels:{fetch:async id=>id==='text'?text:voice},members:{me:bot,fetchMe:async()=>latestBot,fetch:async options=>{assert.equal(options.force,true);fetched.push(options.user);return {owner,guest,bot}[options.user];}}};
  const reader=createBackupReader({guild,enabled:true,worker:()=>{starts++;return {ready:Promise.resolve(),stream:async(_,__,chunk)=>chunk(wave()),close(){}};},speaker:async()=>({healthy:()=>true,play:async(_,o)=>{spoken++;o.onStart();},close(){}})});
  await reader.handle(i('start'));assert.equal(reader.active,false);assert.equal(starts,0);
  guestAllowed=true;sourceType=ChannelType.PublicThread;await reader.handle(i('start'));assert.equal(reader.active,false);assert.equal(starts,0);
  sourceType=ChannelType.GuildText;await reader.handle(i('start'));assert.equal(reader.state.ready,true);assert.equal(starts,1);assert.ok(fetched.includes('guest'));
  guestAllowed=false;reader.onMessage({guildId:'guild',channelId:'text',content:'非公開の文章',author:{bot:false}});await reader.idle();assert.equal(reader.active,false);assert.equal(spoken,0);
  guestAllowed=true;await reader.handle(i('start'));assert.equal(reader.active,true);await reader.onVoiceChange({channelId:'voice'},{id:'bot',channelId:null,guild});assert.equal(reader.active,false);
  await reader.handle(i('start'));latestBot={...bot,canRead:false};reader.onMessage({guildId:'guild',channelId:'text',content:'権限が失効した本文',author:{bot:false}});await reader.idle();assert.equal(reader.active,false);assert.equal(spoken,0);
});

test('old stop buttons cannot end a replacement session and a fresh stop still verifies its owner',async()=>{
  const f=await fixture(),old=f.reader.state.id;
  await f.reader.handle(i('stop'));await f.reader.handle(i('start'));const current=f.reader.state.id;assert.notEqual(old,current);
  const click=(id,user='owner')=>Object.assign(i('unused',user),{customId:id});
  for(const id of ['read:stop',`read:stop:${old}`]){await f.reader.handle(click(id));assert.equal(f.reader.state.id,current);}
  await f.reader.handle(click(`read:stop:${current}`,'other'));assert.equal(f.reader.state.id,current);
  await f.reader.handle(click(`read:stop:${current}`));assert.equal(f.reader.active,false);
  await f.reader.handle(click('read:start'));assert.equal(f.reader.state.ready,true);await f.reader.close();
});
test('preparation exposes a stop action and late warmup completion cannot revive a canceled session',async()=>{
  let warm,closed=0,notice=0;
  const reader=createBackupReader({guild:{id:'guild'},enabled:true,resolveTargets:async()=>({text:{send:async()=>{notice++;}},voice:{id:'voice'}}),authorize:async()=>{},canControl:async()=>{},worker:()=>({ready:new Promise(r=>warm=r),close:()=>closed++}),speaker:async()=>({close(){}})});
  const start=i('start'),task=reader.handle(start);await tick();
  const screen=JSON.stringify(start.replies);assert.ok(screen.includes(`read:stop:${reader.state.id}`));assert.ok(screen.includes('準備中も停止'));
  await reader.handle(i('stop'));assert.equal(reader.active,false);assert.equal(closed,1);warm();await task;assert.equal(reader.active,false);assert.equal(notice,0);
});
test('latency detail is optional, buttons retain limits, and stopped/disabled screens explain the next step',async()=>{
  const f=await fixture();f.message('本文');await f.reader.idle();
  const status=i('status');await f.reader.handle(status);assert.ok(!JSON.stringify(status.replies).includes('内訳：'));
  const details=Object.assign(i('unused'),{customId:`read:details:${f.reader.state.id}`});await f.reader.handle(details);assert.ok(JSON.stringify(details.replies).includes('内訳：'));
  for(const row of details.replies.at(-1).components)assert.ok(row.toJSON().components.length<=5);
  await f.reader.close();const stopped=i('status');await f.reader.handle(stopped);assert.ok(JSON.stringify(stopped.replies).includes('read:start'));
  const disabled=createBackupReader({guild:{id:'guild'},enabled:false}),help=i('status');await disabled.handle(help);const out=JSON.stringify(help.replies);assert.ok(out.includes('管理者'));assert.ok(out.includes('docs/BACKUP_VOICE.md'));assert.ok(!out.includes('ASTRAL_BACKUP_TTS'));
});

test('a replacement session during a delayed control check cannot be stopped or disclosed by the old operation',async()=>{
  for(const action of ['stop','status','start']){
    let allow;const f=await fixture({canControl:()=>new Promise(r=>allow=r)}),old=i(action),task=f.reader.handle(old);await tick();
    await f.reader.close();await f.reader.handle(i('start','new-owner','private-source'));const id=f.reader.state.id;
    allow();await task;assert.equal(f.reader.state.id,id);assert.ok(!JSON.stringify(old.replies).includes('private-source'));await f.reader.close();
  }
});

test('status refresh edits the existing private card, while public-origin controls receive a private reply',async()=>{
  const reader=createBackupReader({guild:{id:'guild'},enabled:false});
  for(const ephemeral of [true,false]){
    let updated=0,replied=0;const click=Object.assign(i('unused'),{customId:'read:status',message:{flags:{has:()=>ephemeral}},async deferUpdate(){updated++;this.deferred=true;},async deferReply(options){assert.equal(options.flags,64);replied++;this.deferred=true;}});
    await reader.handle(click);assert.equal(updated,ephemeral?1:0);assert.equal(replied,ephemeral?0:1);assert.equal(click.replies.length,1);
  }
});

test('owner/admin can stop after source access disappears, without disclosing state or allowing another user to stop',async()=>{
  const guild={id:'guild',members:{fetch:async({user})=>({permissions:{has:()=>user==='admin'}})},channels:{fetch:async()=>{throw new Error('channel deleted');}}};
  const f=await fixture({canControl:undefined,guild});
  const status=i('status');await f.reader.handle(status);assert.equal(f.reader.active,true);assert.ok(!JSON.stringify(status.replies).includes('<#voice>'));
  await f.reader.handle(i('stop','other'));assert.equal(f.reader.active,true);
  const stop=i('stop','admin');await f.reader.handle(stop);assert.equal(f.reader.active,false);assert.ok(!JSON.stringify(stop.replies).includes('<#voice>'));
  await f.reader.handle(i('start'));await f.reader.handle(i('stop'));assert.equal(f.reader.active,false);
});
test('deleting either bound channel stops the session; unrelated channels and guilds do not',async()=>{
  for(const id of ['text','voice']){
    const f=await fixture();await f.reader.onChannelDelete({id,guildId:'other'});await f.reader.onChannelDelete({id:'other',guildId:'guild'});assert.equal(f.reader.active,true);
    await f.reader.onChannelDelete({id,guildId:'guild'});assert.equal(f.reader.active,false);assert.equal(f.workerClosed(),1);assert.equal(f.voiceClosed(),1);
  }
});

test('audio failures retain only a safe stop code in status and never replay failed or queued messages',async()=>{
  let closed=0;const diagnostics=[],secret='PRIVATE_TEXT_AND_NATIVE_PATH';
  const f=await fixture({onDiagnostic:d=>diagnostics.push(d),worker:()=>({ready:Promise.resolve(),async stream(){throw new Error(secret);},close(){closed++;}})});
  f.message('失敗する文章');f.message('待っている文章');await f.reader.idle();assert.equal(f.reader.active,false);assert.equal(closed,1);assert.equal(f.voiceClosed(),1);assert.equal(diagnostics.length,1);assert.equal(diagnostics[0].code,'SYNTHESIS');
  const status=i('status');await f.reader.handle(status);assert.ok(JSON.stringify(status.replies).includes('SYNTHESIS'));assert.ok(!JSON.stringify([...diagnostics,...status.replies]).includes(secret));assert.deepEqual(f.played,[]);
  const copy=f.reader.lastFailure;copy.message=secret;assert.ok(!JSON.stringify(f.reader.lastFailure).includes(secret));
  await f.reader.handle(i('start'));assert.equal(f.reader.lastFailure,null);assert.equal(f.reader.state.queue.length,0);await f.reader.close();
});
test('listener permission failures and idle transport faults have distinct safe diagnostics',async()=>{
  const {backupFault}=await import('../src/backup-fault.js');
  for(const code of ['AUDIENCE','CONNECTION','PLAYBACK','SYNTHESIS_START_TIMEOUT','SYNTHESIS_TIMEOUT','SYNTHESIS_LIMIT','SYNTHESIS_EXIT','SYNTHESIS_PROTOCOL']){
    let fault,deny=false;const f=await fixture({authorize:async()=>{if(deny)throw backupFault(null,code);},speaker:async(_,__,o)=>{fault=o.onFault;return {healthy:()=>true,async play(){},close(){}};}});
    if(code==='AUDIENCE'){deny=true;f.message('読まない');await f.reader.idle();}else await fault(backupFault(null,code));
    assert.equal(f.reader.active,false);assert.equal(f.reader.lastFailure.code,code);assert.deepEqual(f.played,[]);
  }
});

test('a warm worker that exits before the first post preserves its exit cause for the next request',async()=>{
  const child=fakeChild(()=>{}),worker=createPersistentVoice({launch:()=>child});child.stdout.emit('data',frame({type:'ready'}));await worker.ready;child.emit('close',1);
  await assert.rejects(worker.stream('最初の投稿',undefined,()=>assert.fail('must not synthesize')),e=>e.code==='SYNTHESIS_EXIT');worker.close();assert.equal(child.kills,1);
});
