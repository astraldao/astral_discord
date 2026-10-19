import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {wavPcm} from './speech.js';
import {voiceThreads} from './voice-threads.js';
import {VoiceFrames} from './voice-frames.js';
import {backupFault,backupWarmupSteps} from './backup-fault.js';
export function createPersistentVoice({launch=spawn,startupTimeout=90000,synthesisTimeout=15000,firstAudioTimeout=30000,maxSynthesisTime=60000,schedule=setTimeout,cancel=clearTimeout,now=()=>performance.now(),threadPlan=voiceThreads()}={}){
  const python=process.env.VOICEVOX_PYTHON||(existsSync('.voicevox-venv/bin/python')?resolve('.voicevox-venv/bin/python'):'python3');
  const child=launch(python,[fileURLToPath(new URL('../scripts/backup-synthesize.py',import.meta.url))],{shell:false,stdio:['pipe','pipe','pipe'],env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1',VOICEVOX_BACKUP_THREADS:String(threadPlan.threads)}});
  const frames=new VoiceFrames();
  let pending=null,serial=0,closed=false,failure,readySeen=false,tail=Promise.resolve(),readyResolve,readyReject,warmupParts=0,warmupBytes=0,runtime={};
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  ready.catch(()=>{});
  const startupBegan=now();let warmupStep='process',warmupStepAt=startupBegan,startupSequence=0;
  const startup=schedule(()=>fail(backupFault(null,'SYNTHESIS_WARMUP_TIMEOUT',{...snapshot(),timerLateMs:Math.round(Math.max(0,now()-startupBegan-startupTimeout))})),startupTimeout);
  function finish(job){cancel(job.timer);cancel(job.limit);job.signal?.removeEventListener('abort',job.abort);for(const key of ['synthesisCpuMs','firstAudioCpuMs'])if(job[key]!==undefined)runtime[key]=job[key];pending=null;}
  const snapshot=job=>({...runtime,...(job?{stage:job.stage,parts:job.part,activePart:job.activePart,moras:job.moras,frameStart:job.frameStart,frameEnd:job.frameEnd,framesTotal:job.framesTotal,framesDone:job.nextFrame,synthesisCpuMs:job.synthesisCpuMs,firstAudioCpuMs:job.firstAudioCpuMs,elapsedMs:Math.round(now()-job.began),idleMs:Math.round(now()-job.lastAudio)}:readySeen?{}:{stage:'warmup',warmupParts,warmupStep,warmupStepMs:Math.round(now()-warmupStepAt),elapsedMs:Math.round(now()-startupBegan)})});
  function wait(job,timeout,code){cancel(job.timer);const expected=now()+timeout;job.timer=schedule(()=>fail(backupFault(null,code,{...snapshot(job),timerLateMs:Math.round(Math.max(0,now()-expected))})),timeout);}
  function fail(error){if(closed)return;closed=true;frames.dispose();failure=error;cancel(startup);readyReject(error);if(pending){const job=pending;finish(job);job.reject(error);}child.kill('SIGKILL');}
  child.on('error',()=>fail(new Error('バックアップ音声を起動できません。')));
  child.on('close',()=>fail(backupFault(null,'SYNTHESIS_EXIT',snapshot(pending))));
  child.stdin.on('error',()=>fail(backupFault(null,'SYNTHESIS_EXIT',snapshot(pending))));
  child.stderr.on('data',()=>{}); // Native diagnostics may contain paths; never retain channel text.
  child.stdout.on('data',part=>{
    if(closed)return;
    try{
      frames.push(part,(data,wav)=>{
        if(data.type==='startup'){
          if(readySeen||pending||warmupParts||data.bytes!==0||data.sequence!==startupSequence+1||data.sequence>32||typeof data.step!=='string'||!Object.hasOwn(backupWarmupSteps,data.step)||data.step==='process'||!Number.isInteger(data.warmupCpuMs)||data.warmupCpuMs<(runtime.warmupCpuMs??0)||data.warmupCpuMs>3600000)throw new Error();
          startupSequence=data.sequence;warmupStep=data.step;warmupStepAt=now();runtime.warmupCpuMs=data.warmupCpuMs;return;
        }
        if(data.type==='warmup'){
          if(readySeen||pending||data.part!==warmupParts||warmupParts>=256||(warmupBytes+=wav.length)>8*1024*1024)throw new Error();wavPcm(wav);warmupParts++;return;
        }
        if(data.type==='ready'){
          if(readySeen||data.bytes!==0||pending)throw new Error();
          const lastWarmupCpuMs=runtime.warmupCpuMs??0;
          if(data.protocol===2||data.protocol===3){if(data.protocol===3&&!['features','packed'].includes(data.engine))throw new Error();if(!warmupParts||data.warmupParts!==warmupParts||!Number.isInteger(data.threads)||data.threads<1||data.threads>4)throw new Error();runtime={protocol:data.protocol,...(data.protocol===3?{engine:data.engine}:{}),threads:data.threads,configuredThreads:threadPlan.configuredThreads,warmupParts};}
          else {if(startupSequence||warmupParts||data.protocol!==undefined&&data.protocol!==1)throw new Error();runtime={protocol:1};}
          if(data.warmupCpuMs!==undefined){if(!Number.isInteger(data.warmupCpuMs)||data.warmupCpuMs<lastWarmupCpuMs||data.warmupCpuMs>3600000)throw new Error();runtime.warmupCpuMs=data.warmupCpuMs;}
          readySeen=true;cancel(startup);readyResolve();return;
        }
        if(!pending||pending.id!==data.id)throw new Error();
        const job=pending;
        if(data.type!=='progress'){
          if(data.synthesisCpuMs!==undefined){if(!Number.isInteger(data.synthesisCpuMs)||data.synthesisCpuMs<(job.lastCpuMs??0)||data.synthesisCpuMs>3600000)throw new Error();job.lastCpuMs=data.synthesisCpuMs;}
          job.synthesisCpuMs=data.synthesisCpuMs;
        }
        if(data.type==='progress'){
          if(![2,3].includes(runtime.protocol)||data.bytes!==0)throw new Error();
          if(data.stage==='query'){if(job.part||job.stage!=='waiting')throw new Error();job.stage='query';}
          else if(data.stage==='synthesis'){
            if(data.part!==job.part||!['query','waiting'].includes(job.stage))throw new Error();
            if(job.onChunk&&runtime.engine==='features'){
              if(!Number.isInteger(data.frameStart)||!Number.isInteger(data.frameEnd)||!Number.isInteger(data.frames)||data.frameStart!==(job.nextFrame??0)||data.frameEnd<=data.frameStart||data.frameEnd>data.frames||data.frames<1||data.frames>3750||data.frameEnd-data.frameStart>192||job.framesTotal!==undefined&&job.framesTotal!==data.frames)throw new Error();
              job.frameStart=data.frameStart;job.frameEnd=data.frameEnd;job.framesTotal=data.frames;
            }else if(job.onChunk&&(!Number.isInteger(data.moras)||data.moras<1||data.moras>12))throw new Error();
            job.stage='synthesis';job.activePart=data.part;job.moras=data.moras;
          }else throw new Error();
          return; // Status frames never extend a synthesis deadline.
        }
        if(data.error){finish(job);job.reject(backupFault(null,'SYNTHESIS',snapshot(job)));return;}
        if(job.onChunk){
          if(data.end){if(data.bytes!==0||runtime.protocol===3&&(job.stage==='synthesis'||job.framesTotal!==undefined&&job.nextFrame!==job.framesTotal))throw new Error();finish(job);job.resolve();return;}
          if(data.part!==job.part)throw new Error();job.bytes+=wav.length;if(job.bytes>8*1024*1024)throw new Error();
          const pcm=wavPcm(wav);if(runtime.engine==='features'){if(job.frameStart===undefined||pcm.length!==(job.frameEnd-job.frameStart)*2048)throw new Error();job.nextFrame=job.frameEnd;}if(!job.part&&job.synthesisCpuMs!==undefined)job.firstAudioCpuMs=job.synthesisCpuMs;job.part++;job.onChunk(wav);
          // Only a complete, valid WAV is progress. Partial bytes cannot extend the wait.
          if(pending===job&&!closed){job.lastAudio=now();job.stage=runtime.protocol>=2?'waiting':'unknown';delete job.activePart;delete job.moras;delete job.frameStart;delete job.frameEnd;wait(job,synthesisTimeout,'SYNTHESIS_TIMEOUT');}return;
        }
        finish(job);
        try{wavPcm(wav);job.resolve(wav);}catch(error){job.reject(error);}
      },data=>{if(pending&&data.id===pending.id&&data.bytes>0)pending.stage='transfer';});
    }catch{fail(backupFault(null,'SYNTHESIS_PROTOCOL',snapshot(pending)));}
  });
  function request(text,signal,onChunk){
    const job=tail.then(async()=>{await ready;signal?.throwIfAborted();if(closed)throw failure;
      if(!Array.from(text).length||Array.from(text).length>53)throw new Error('音声の文字数が不正です。');
      return new Promise((resolve,reject)=>{
        const id=++serial,began=now(),job={id,resolve,reject,onChunk,part:0,bytes:0,signal,began,lastAudio:began,stage:runtime.protocol>=2?'waiting':'unknown',abort:()=>fail(signal.reason??new Error('読み上げを停止しました。'))};delete runtime.synthesisCpuMs;delete runtime.firstAudioCpuMs;pending=job;
        wait(job,firstAudioTimeout,'SYNTHESIS_START_TIMEOUT');job.limit=schedule(()=>fail(backupFault(null,'SYNTHESIS_LIMIT',{...snapshot(job),timerLateMs:Math.round(Math.max(0,now()-began-maxSynthesisTime))})),maxSynthesisTime);
        signal?.addEventListener('abort',job.abort,{once:true});
        try{child.stdin.write(JSON.stringify({id,text,stream:!!onChunk})+'\n');}catch{fail(backupFault(null,'SYNTHESIS_EXIT',snapshot(job)));}
      });
    });tail=job.catch(()=>{});return job.then(wav=>{signal?.throwIfAborted();return wav;});
  }
  return {ready,get diagnostics(){return snapshot(pending);},synthesize:(text,signal)=>request(text,signal),stream:(text,signal,onChunk)=>request(text,signal,onChunk),close(){fail(new Error('読み上げを停止しました。'));}};
}
