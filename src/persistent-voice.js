import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {wavPcm} from './speech.js';
import {voiceThreads} from './voice-threads.js';
import {backupFault} from './backup-fault.js';
export function createPersistentVoice({launch=spawn,startupTimeout=90000,synthesisTimeout=15000,firstAudioTimeout=30000,maxSynthesisTime=60000,schedule=setTimeout,cancel=clearTimeout,now=()=>performance.now(),threadPlan=voiceThreads()}={}){
  const python=process.env.VOICEVOX_PYTHON||(existsSync('.voicevox-venv/bin/python')?resolve('.voicevox-venv/bin/python'):'python3');
  const child=launch(python,[fileURLToPath(new URL('../scripts/backup-synthesize.py',import.meta.url))],{shell:false,stdio:['pipe','pipe','pipe'],env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1',VOICEVOX_BACKUP_THREADS:String(threadPlan.threads)}});
  let buffer=Buffer.alloc(0),header=null,pending=null,serial=0,closed=false,failure,readySeen=false,tail=Promise.resolve(),readyResolve,readyReject,warmupParts=0,warmupBytes=0,runtime={};
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  ready.catch(()=>{});
  const startupBegan=now(),startup=schedule(()=>fail(backupFault(null,'SYNTHESIS_WARMUP_TIMEOUT',snapshot())),startupTimeout);
  function finish(job){cancel(job.timer);cancel(job.limit);job.signal?.removeEventListener('abort',job.abort);pending=null;}
  const snapshot=job=>({...runtime,...(job?{stage:job.stage,parts:job.part,activePart:job.activePart,moras:job.moras,frameStart:job.frameStart,frameEnd:job.frameEnd,framesTotal:job.framesTotal,framesDone:job.nextFrame,elapsedMs:Math.round(now()-job.began),idleMs:Math.round(now()-job.lastAudio)}:readySeen?{}:{stage:'warmup',warmupParts,elapsedMs:Math.round(now()-startupBegan)})});
  function wait(job,timeout,code){cancel(job.timer);job.timer=schedule(()=>fail(backupFault(null,code,snapshot(job))),timeout);}
  function fail(error){if(closed)return;closed=true;failure=error;cancel(startup);readyReject(error);if(pending){const job=pending;finish(job);job.reject(error);}child.kill('SIGKILL');}
  child.on('error',()=>fail(new Error('バックアップ音声を起動できません。')));
  child.on('close',()=>fail(backupFault(null,'SYNTHESIS_EXIT',snapshot(pending))));
  child.stdin.on('error',()=>fail(backupFault(null,'SYNTHESIS_EXIT',snapshot(pending))));
  child.stderr.on('data',()=>{}); // Native diagnostics may contain paths; never retain channel text.
  child.stdout.on('data',part=>{
    if(closed)return;
    buffer=Buffer.concat([buffer,part]);if(buffer.length>4*1024*1024+2048){fail(backupFault(null,'SYNTHESIS_PROTOCOL',snapshot(pending)));return;}
    try{
      while(buffer.length){
        if(!header){const at=buffer.indexOf(10);if(at<0){if(buffer.length>1024)throw new Error();return;}if(at>1024)throw new Error();header=JSON.parse(buffer.subarray(0,at).toString());buffer=buffer.subarray(at+1);if(!Number.isInteger(header.bytes)||header.bytes<0||header.bytes>4*1024*1024)throw new Error();if(pending&&header.id===pending.id&&header.bytes>0)pending.stage='transfer';}
        if(buffer.length<header.bytes)return;
        const wav=Buffer.from(buffer.subarray(0,header.bytes)),data=header;buffer=buffer.subarray(header.bytes);header=null;
        if(data.type==='warmup'){
          if(readySeen||pending||data.part!==warmupParts||warmupParts>=256||(warmupBytes+=wav.length)>8*1024*1024)throw new Error();wavPcm(wav);warmupParts++;continue;
        }
        if(data.type==='ready'){
          if(readySeen||data.bytes!==0||pending)throw new Error();
          if(data.protocol===2||data.protocol===3){if(data.protocol===3&&!['features','packed'].includes(data.engine))throw new Error();if(!warmupParts||data.warmupParts!==warmupParts||!Number.isInteger(data.threads)||data.threads<1||data.threads>4)throw new Error();runtime={protocol:data.protocol,...(data.protocol===3?{engine:data.engine}:{}),threads:data.threads,configuredThreads:threadPlan.configuredThreads,warmupParts};}
          else {if(warmupParts||data.protocol!==undefined&&data.protocol!==1)throw new Error();runtime={protocol:1};}
          readySeen=true;cancel(startup);readyResolve();continue;
        }
        if(!pending||pending.id!==data.id)throw new Error();
        const job=pending;
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
          continue; // Status frames never extend a synthesis deadline.
        }
        if(data.error){finish(job);job.reject(backupFault(null,'SYNTHESIS',snapshot(job)));continue;}
        if(job.onChunk){
          if(data.end){if(data.bytes!==0||runtime.protocol===3&&(job.stage==='synthesis'||job.framesTotal!==undefined&&job.nextFrame!==job.framesTotal))throw new Error();finish(job);job.resolve();continue;}
          if(data.part!==job.part)throw new Error();job.bytes+=wav.length;if(job.bytes>8*1024*1024)throw new Error();
          const pcm=wavPcm(wav);if(runtime.engine==='features'){if(job.frameStart===undefined||pcm.length!==(job.frameEnd-job.frameStart)*2048)throw new Error();job.nextFrame=job.frameEnd;}job.part++;job.onChunk(wav);
          // Only a complete, valid WAV is progress. Partial bytes cannot extend the wait.
          if(pending===job&&!closed){job.lastAudio=now();job.stage=runtime.protocol>=2?'waiting':'unknown';delete job.activePart;delete job.moras;delete job.frameStart;delete job.frameEnd;wait(job,synthesisTimeout,'SYNTHESIS_TIMEOUT');}continue;
        }
        finish(job);
        try{wavPcm(wav);job.resolve(wav);}catch(error){job.reject(error);}
      }
    }catch{fail(backupFault(null,'SYNTHESIS_PROTOCOL',snapshot(pending)));}
  });
  function request(text,signal,onChunk){
    const job=tail.then(async()=>{await ready;signal?.throwIfAborted();if(closed)throw failure;
      if(!Array.from(text).length||Array.from(text).length>53)throw new Error('音声の文字数が不正です。');
      return new Promise((resolve,reject)=>{
        const id=++serial,began=now(),job={id,resolve,reject,onChunk,part:0,bytes:0,signal,began,lastAudio:began,stage:runtime.protocol>=2?'waiting':'unknown',abort:()=>fail(signal.reason??new Error('読み上げを停止しました。'))};pending=job;
        wait(job,firstAudioTimeout,'SYNTHESIS_START_TIMEOUT');job.limit=schedule(()=>fail(backupFault(null,'SYNTHESIS_LIMIT',snapshot(job))),maxSynthesisTime);
        signal?.addEventListener('abort',job.abort,{once:true});
        try{child.stdin.write(JSON.stringify({id,text,stream:!!onChunk})+'\n');}catch{fail(backupFault(null,'SYNTHESIS_EXIT',snapshot(job)));}
      });
    });tail=job.catch(()=>{});return job.then(wav=>{signal?.throwIfAborted();return wav;});
  }
  return {ready,get diagnostics(){return snapshot(pending);},synthesize:(text,signal)=>request(text,signal),stream:(text,signal,onChunk)=>request(text,signal,onChunk),close(){fail(new Error('読み上げを停止しました。'));}};
}
