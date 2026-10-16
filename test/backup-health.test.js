import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {VoiceConnectionStatus as S} from '@discordjs/voice';
import {watchBackupAudio} from '../src/backup-health.js';
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){const connection=new EventEmitter(),player=new EventEmitter(),abort=new AbortController(),reported=[];let timer,cancelled=0;connection.state={status:S.Ready};const health=watchBackupAudio({connection,player,signal:abort.signal,onFault:e=>reported.push(e),schedule:fn=>{timer=fn;return 1;},cancel:()=>{cancelled++;timer=null;}});return {connection,player,abort,health,reported,fire:()=>timer?.(),cancelled:()=>cancelled,state:status=>{const before=connection.state;connection.state={status};connection.emit('stateChange',before,connection.state);}};}
test('brief disconnection cancels its watchdog on recovery; persistent disconnection reports once',async()=>{
  const f=fixture();f.health.arm();f.state(S.Disconnected);f.state(S.Ready);assert.equal(f.cancelled(),1);f.fire();await tick();assert.equal(f.reported.length,0);f.state(S.Disconnected);f.fire();await tick();assert.equal(f.reported.length,1);f.player.emit('error',new Error('later'));await tick();assert.equal(f.reported.length,1);f.health.close();
});
test('idle player errors and destroyed connections report faults without waiting for another message',async()=>{
  for(const event of ['player','destroyed']){const f=fixture();f.health.arm();if(event==='player')f.player.emit('error',new Error('failure'));else f.state(S.Destroyed);await tick();assert.equal(f.reported.length,1);assert.ok(f.health.fault());f.health.close();}
});
test('setup failures cannot arm, while abort and manual cleanup cancel timers and notifications',async()=>{
  const setup=fixture();setup.player.emit('error',new Error('setup'));assert.throws(()=>setup.health.arm());await tick();assert.equal(setup.reported.length,0);setup.health.close();
  for(const abort of [true,false]){const f=fixture();f.health.arm();f.state(S.Disconnected);if(abort)f.abort.abort();else f.health.close();f.fire();f.player.emit('error',new Error('late'));f.state(S.Destroyed);await tick();assert.equal(f.reported.length,0);assert.equal(f.cancelled(),1);}
});
