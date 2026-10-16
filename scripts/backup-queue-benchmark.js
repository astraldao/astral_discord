// Real VOICEVOX + Opus, queued synthetic phrases, no Discord connection or credentials.
import {setTimeout as delay} from 'node:timers/promises';
import {availableParallelism} from 'node:os';
import {createAudioPlayer,NoSubscriberBehavior} from '@discordjs/voice';
import {createBackupReader} from '../src/backup-reader.js';
import {createPersistentVoice} from '../src/persistent-voice.js';
import {playBackupAudio} from '../src/backup-audio.js';
const accessMs=Number(process.env.ASTRAL_BENCH_ACCESS_MS??200);
if(!Number.isInteger(accessMs)||accessMs<0||accessMs>2000)throw new Error('ASTRAL_BENCH_ACCESS_MS must be 0..2000');
const worker=createPersistentVoice(),player=createAudioPlayer({behaviors:{noSubscriber:NoSubscriberBehavior.Play,maxMissedFrames:150}});
const phrases=['こんにちは。今日もよろしくお願いします。','次の予定は午後八時からなのだ。','みんなの投稿を順番に読み上げるのだ。'];
let fault,reader;const samples=[];player.on('error',e=>fault=e);
try{
  const warm=performance.now();await worker.ready;const warmupMs=Math.round(performance.now()-warm);
  for(let round=0;round<2;round++)for(const prefetch of round%2===0?[false,true]:[true,false]){
    let received,previousEnd,index=0;const rows=[];
    reader=createBackupReader({guild:{id:'benchmark'},enabled:true,prefetch,worker:()=>({...worker,close(){}}),resolveTargets:async()=>({text:{send:async()=>({edit:async()=>{}})},voice:{id:'voice'}}),authorize:()=>delay(accessMs),speaker:async()=>({healthy:()=>!fault,close(){player.stop(true);},async play(source,options){
      const row={index:index++};rows.push(row);
      await playBackupAudio(player,source,{...options,onStart:()=>{const at=performance.now();row.startMs=Math.round(at-received);if(previousEnd!==undefined)row.gapMs=Math.round(at-previousEnd);options.onStart();}},()=>fault);
      previousEnd=performance.now();row.finishMs=Math.round(previousEnd-received);
    }})});
    const start={user:{id:'owner'},channelId:'text',options:{getSubcommand:()=> 'start'},async deferReply(){this.deferred=true;},async editReply(){},async reply(){}};
    await reader.handle(start);if(!reader.state?.ready)throw new Error('reader did not initialize');
    received=performance.now();for(const content of phrases)reader.onMessage({guildId:'benchmark',channelId:'text',content,author:{bot:false}});
    await reader.idle();if(rows.length!==3||rows.some(r=>r.finishMs===undefined)||!reader.active)throw new Error('playback did not complete');
    samples.push({round,prefetch,rows,prefetched:reader.state.metrics.prefetched});
    console.error(`${samples.length}/4 prefetch=${prefetch} gaps=${rows.slice(1).map(r=>r.gapMs).join(',')}ms`);
    await reader.close();reader=null;
  }
  const summary={};for(const enabled of [false,true]){const values=samples.filter(s=>s.prefetch===enabled).flatMap(s=>s.rows.slice(1).map(r=>r.gapMs)).sort((a,b)=>a-b);summary[enabled?'prefetch':'baseline']={gapMedianMs:Math.round((values[1]+values[2])/2),gapMaxMs:values.at(-1)};}
  console.log(JSON.stringify({node:process.version,cpuCount:availableParallelism(),warmupMs,simulatedAccessMs:accessMs,phrases:phrases.length,samples,summary,scope:'Real local VOICEVOX/Opus. Gaps include fresh simulated permissions and player startup. No Discord network or 300ms guarantee.'},null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
finally{await reader?.close();worker.close();player.stop(true);}
