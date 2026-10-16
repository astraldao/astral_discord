import {PassThrough} from 'node:stream';
import {gentlePcm} from './speech.js';
import {backupFault} from './backup-fault.js';

// Generate locally while authorizing, but never give the player audio until access passes.
// One PCM stream per message avoids restarting the encoder and adding silence per segment.
export async function streamBackupSpeech({text,signal,synth,voice,authorize,volume=()=>30,onStart=()=>{},now=()=>performance.now()}){
  signal.throwIfAborted();
  const began=now(),source=new PassThrough({highWaterMark:64*1024});
  source.on('error',()=>{});
  let firstResolve,firstReject,firstAt,accessAt;
  const first=new Promise((resolve,reject)=>{firstResolve=resolve;firstReject=reject;});
  first.catch(()=>{});
  let rejectAbort;
  const aborted=new Promise((_,reject)=>{rejectAbort=()=>reject(signal.reason??new Error('読み上げを停止しました。'));});
  signal.addEventListener('abort',rejectAbort,{once:true});
  const permitted=Promise.resolve().then(async()=>{
    await authorize();signal.throwIfAborted();
    // A brief transport reconnect must not turn the next post into a forced stop.
    const recovered=await voice.waitReady?.(signal);
    signal.throwIfAborted();if(recovered)await authorize();
    signal.throwIfAborted();accessAt=now();if(!voice.healthy())throw backupFault(null,'CONNECTION');
  }).catch(error=>{throw backupFault(error,'ACCESS');});
  const generating=Promise.resolve().then(()=>synth.stream(text,signal,wav=>{
    signal.throwIfAborted();source.write(gentlePcm(wav,volume(),{fadeMs:3}));
    if(firstAt===undefined){firstAt=now();firstResolve(true);}
  })).then(()=>{source.end();firstResolve(false);},error=>{const fault=backupFault(error,'SYNTHESIS');firstReject(fault);throw fault;});
  const playing=(async()=>{
    await permitted;
    if(!await first)return; // Punctuation-only messages can have no pronounceable moras.
    signal.throwIfAborted();
    await voice.play(source,{signal,onStart:()=>onStart({
      accessMs:Math.round(accessAt-began),firstAudioMs:Math.round(firstAt-began),
      playerMs:Math.round(now()-Math.max(firstAt,accessAt)),
    })});
  })().catch(error=>{throw backupFault(error,'PLAYBACK');});
  try{await Promise.race([Promise.all([generating,playing]),aborted]);}
  finally{signal.removeEventListener('abort',rejectAbort);source.destroy();}
}
