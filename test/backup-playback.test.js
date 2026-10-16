import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createAudioPlayer,AudioPlayerStatus,NoSubscriberBehavior,VoiceConnectionStatus,entersState} from '@discordjs/voice';
import {streamBackupSpeech} from '../src/backup-playback.js';
import {playBackupAudio,waitBackupReady,backupPlayerBehaviors} from '../src/backup-audio.js';
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function wave(){const b=Buffer.alloc(44+11520);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(192000,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(11520,40);return b;}
test('generation overlaps permission lookup but no audio reaches the player until authorized',async()=>{
  const gate=deferred(),generated=deferred(),abort=new AbortController(),bytes=[];let calls=0,at=0,parts;
  const task=streamBackupSpeech({text:'本文',signal:abort.signal,now:()=>at,authorize:()=>gate.promise,synth:{async stream(_,__,chunk){chunk(wave());generated.resolve();chunk(wave());}},voice:{healthy:()=>true,async play(source,{onStart}){calls++;onStart();for await(const chunk of source)bytes.push(chunk);}},onStart:value=>parts=value});
  await generated.promise;assert.equal(calls,0);at=180;gate.resolve();await task;
  assert.equal(calls,1);assert.equal(Buffer.concat(bytes).length,23040);assert.equal(parts.accessMs,180);assert.equal(parts.firstAudioMs,0);
});
test('denied access ends immediately even while generation is pending and never plays buffered data',async()=>{
  const gate=deferred(),generated=deferred(),finished=deferred(),abort=new AbortController();let calls=0;
  const task=streamBackupSpeech({text:'本文',signal:abort.signal,authorize:()=>gate.promise,synth:{async stream(_,__,chunk){chunk(wave());generated.resolve();await finished.promise;}},voice:{healthy:()=>true,play:async()=>calls++}});
  await generated.promise;gate.reject(new Error('denied'));await assert.rejects(task,e=>e.code==='ACCESS'&&!e.message.includes('denied'));assert.equal(calls,0);finished.resolve();
});
test('stop releases a pending lookup and cannot play after that lookup eventually completes',async()=>{
  const gate=deferred(),abort=new AbortController();let calls=0;
  const task=streamBackupSpeech({text:'本文',signal:abort.signal,authorize:()=>gate.promise,synth:{async stream(_,__,chunk){chunk(wave());}},voice:{healthy:()=>true,play:async()=>calls++}});
  await tick();abort.abort();await assert.rejects(task);gate.resolve();await tick();assert.equal(calls,0);
});
test('silent input never starts the player and a synthesis failure rejects after cleaning up the stream',async()=>{
  const abort=new AbortController();let calls=0,source;
  const options={text:'！',signal:abort.signal,authorize:async()=>{},voice:{healthy:()=>true,async play(stream){calls++;source=stream;for await(const _ of stream){}}}};
  await streamBackupSpeech({...options,synth:{stream:async()=>{}}});assert.equal(calls,0);
  const fail=deferred();const task=streamBackupSpeech({...options,synth:{async stream(_,__,chunk){chunk(wave());await fail.promise;throw new Error('synthesis failed');}}});await tick();fail.resolve();await assert.rejects(task,e=>e.code==='SYNTHESIS'&&!e.message.includes('synthesis failed'));assert.equal(source.destroyed,true);
});
test('one real encoder plays late PCM chunks without restarting or discarding the remaining message',async()=>{
  const player=createAudioPlayer({behaviors:{noSubscriber:NoSubscriberBehavior.Play,maxMissedFrames:150}}),source=new PassThrough(),abort=new AbortController();player.on('error',()=>{});
  let starts=0,playing=0;player.on('stateChange',(_,next)=>{if(next.status===AudioPlayerStatus.Playing)playing++;});
  try{
    source.write(Buffer.alloc(11520));const job=playBackupAudio(player,source,{signal:abort.signal,onStart:()=>starts++});
    await delay(250);source.end(Buffer.alloc(11520));await job;
    assert.equal(starts,1);assert.equal(playing,1);assert.equal(player.state.status,AudioPlayerStatus.Idle);
  }finally{player.stop(true);source.destroy();}
});
test('aborting real playback closes the player promptly',async()=>{
  const player=createAudioPlayer({behaviors:{noSubscriber:NoSubscriberBehavior.Play,maxMissedFrames:150}}),source=new PassThrough(),abort=new AbortController();player.on('error',()=>{});
  try{
    source.write(Buffer.alloc(192000));const started=deferred(),job=playBackupAudio(player,source,{signal:abort.signal,onStart:started.resolve});
    await started.promise;abort.abort();await assert.rejects(job);assert.equal(player.state.status,AudioPlayerStatus.Idle);
  }finally{player.stop(true);source.destroy();}
});

test('a first post waits for transport recovery and rechecks access before giving audio to the player',async()=>{
  for(const revoked of [false,true]){
    const recovered=deferred(),abort=new AbortController();let checks=0,plays=0;
    const job=streamBackupSpeech({text:'本文',signal:abort.signal,authorize:async()=>{if(++checks===2&&revoked)throw new Error('private diagnostic');},synth:{async stream(_,__,chunk){chunk(wave());}},voice:{waitReady:()=>recovered.promise,healthy:()=>true,async play(source){plays++;for await(const _ of source){}}}});
    await tick();assert.equal(checks,1);assert.equal(plays,0);recovered.resolve(true);
    if(revoked)await assert.rejects(job,e=>e.code==='ACCESS'&&!e.message.includes('private diagnostic'));else await job;
    assert.equal(checks,2);assert.equal(plays,revoked?0:1);
  }
});
test('connection readiness waits are cancellable and remove their pending listeners',async()=>{
  const connection=new EventEmitter(),abort=new AbortController();connection.state={status:VoiceConnectionStatus.Disconnected};
  const ready=waitBackupReady(connection,abort.signal);connection.state={status:VoiceConnectionStatus.Ready};connection.emit(VoiceConnectionStatus.Ready);assert.equal(await ready,true);assert.equal(await waitBackupReady(connection,abort.signal),false);
  connection.state={status:VoiceConnectionStatus.Disconnected};const cancelled=waitBackupReady(connection,abort.signal);abort.abort();await assert.rejects(cancelled,e=>e.code==='CONNECTION');assert.equal(connection.listenerCount(VoiceConnectionStatus.Ready),0);
});
test('the production player pauses for a short transport loss and finishes the same resource after recovery',async()=>{
  const player=createAudioPlayer({behaviors:backupPlayerBehaviors}),source=new PassThrough(),abort=new AbortController();player.on('error',()=>{});
  const connection={state:{status:VoiceConnectionStatus.Ready},prepareAudioPacket(){},dispatchAudio(){},setSpeaking(){},onSubscriptionRemoved(){}};
  const subscription=player.subscribe(connection);let settled=false;
  try{
    source.write(Buffer.alloc(57600));const started=deferred(),job=playBackupAudio(player,source,{signal:abort.signal,onStart:started.resolve});job.then(()=>settled=true,()=>settled=true);
    await started.promise;connection.state={status:VoiceConnectionStatus.Disconnected};await entersState(player,AudioPlayerStatus.AutoPaused,1000);
    assert.equal(settled,false);assert.equal(source.destroyed,false);
    connection.state={status:VoiceConnectionStatus.Ready};source.end(Buffer.alloc(11520));await job;assert.equal(player.state.status,AudioPlayerStatus.Idle);assert.equal(settled,true);
  }finally{abort.abort();player.stop(true);source.destroy();subscription.unsubscribe();}
});

test('production playback survives synthesis gaps longer than the previous three-second cutoff',async()=>{
  const player=createAudioPlayer({behaviors:backupPlayerBehaviors}),source=new PassThrough(),abort=new AbortController();player.on('error',()=>{});
  const connection={state:{status:VoiceConnectionStatus.Ready},prepareAudioPacket(){},dispatchAudio(){},setSpeaking(){},onSubscriptionRemoved(){}};
  const subscription=player.subscribe(connection);let starts=0;
  try{
    const started=deferred();source.write(Buffer.alloc(11520));const job=playBackupAudio(player,source,{signal:abort.signal,onStart:()=>{starts++;started.resolve();}});job.catch(()=>{});
    await started.promise;await delay(3300);assert.equal(player.state.status,AudioPlayerStatus.Playing);assert.equal(source.destroyed,false);
    source.end(Buffer.alloc(11520));await job;assert.equal(starts,1);assert.equal(player.state.status,AudioPlayerStatus.Idle);
  }finally{abort.abort();player.stop(true);source.destroy();subscription.unsubscribe();}
});
