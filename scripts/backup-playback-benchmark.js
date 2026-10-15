// Local comparison using the real model and Opus encoder, with a simulated permission delay.
// No Discord connection, credentials, or channel text are used.
import {setTimeout as delay} from 'node:timers/promises';
import {createAudioPlayer,NoSubscriberBehavior} from '@discordjs/voice';
import {createPersistentVoice} from '../src/persistent-voice.js';
import {backupText} from '../src/backup-text.js';
import {gentlePcm} from '../src/speech.js';
import {streamBackupSpeech} from '../src/backup-playback.js';
import {playBackupAudio} from '../src/backup-audio.js';
const worker=createPersistentVoice(),abort=new AbortController();
const player=createAudioPlayer({behaviors:{noSubscriber:NoSubscriberBehavior.Play,maxMissedFrames:150}});
let fault;player.on('error',error=>{fault=error;});
const simulatedAccessMs=200,phrases=['こんにちは。今日はよろしくお願いします。','次のセッションは午後八時から開始する予定です。','この文章は文字数を確認するために用意したバックアップ読み上げシステムのテスト文章です。続きは以下略になります。'];
const samples=[];
try{
  const warm=performance.now();await worker.ready;const warmupMs=Math.round(performance.now()-warm);
  for(let n=0;n<6;n++)for(const mode of n%2===0?['sequential','pipeline']:['pipeline','sequential']){
    const text=backupText(phrases[n%3]),began=performance.now();let first=null,audioBytes=0,chunks=0,parts;
    const record=()=>{if(first===null)first=performance.now();};
    const play=(pcm,options={signal:abort.signal,onStart:record})=>playBackupAudio(player,pcm,options,()=>fault);
    if(mode==='pipeline')await streamBackupSpeech({text,signal:abort.signal,authorize:()=>delay(simulatedAccessMs),synth:{stream:(value,signal,chunk)=>worker.stream(value,signal,wav=>{audioBytes+=wav.length-44;chunks++;chunk(wav);})},voice:{healthy:()=>!fault,play},onStart:value=>{parts=value;record();}});
    else{
      await delay(simulatedAccessMs);let playback=Promise.resolve();
      await worker.stream(text,abort.signal,wav=>{const pcm=gentlePcm(wav,30,{fadeMs:3});audioBytes+=pcm.length;chunks++;playback=playback.then(()=>play(pcm));playback.catch(()=>{});});await playback;
    }
    const ended=performance.now();samples.push({mode,phrase:n%3,firstStartMs:Math.round(first-began),finishMs:Math.round(ended-began),audioMs:Math.round(audioBytes/192),extraAfterStartMs:Math.round(ended-first-audioBytes/192),chunks,...(parts?{parts}:{})});
    console.error(`${samples.length}/12 ${mode} first=${samples.at(-1).firstStartMs}ms finish=${samples.at(-1).finishMs}ms`);
  }
  const summary={};for(const mode of ['sequential','pipeline']){const rows=samples.filter(r=>r.mode===mode);summary[mode]={};for(const field of ['firstStartMs','finishMs','extraAfterStartMs']){const values=rows.map(r=>r[field]).sort((a,b)=>a-b);summary[mode][field]={median:Math.round((values[2]+values[3])/2),max:values.at(-1)};}}
  console.log(JSON.stringify({warmupMs,simulatedAccessMs,samples,summary},null,2));
  console.log('開発環境・合成とローカルAudioPlayerのみ。権限確認は200msの模擬待ちです。Discordの実測・300msの保証ではありません。');
}catch(error){console.error(error.message);process.exitCode=1;}
finally{abort.abort();worker.close();player.stop(true);}
