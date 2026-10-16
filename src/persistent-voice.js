import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gentlePcm} from './speech.js';
import {backupFault} from './backup-fault.js';
export function createPersistentVoice({launch=spawn,startupTimeout=90000,synthesisTimeout=15000,firstAudioTimeout=30000,maxSynthesisTime=60000,schedule=setTimeout,cancel=clearTimeout}={}){
  const python=process.env.VOICEVOX_PYTHON||(existsSync('.voicevox-venv/bin/python')?resolve('.voicevox-venv/bin/python'):'python3');
  const child=launch(python,[fileURLToPath(new URL('../scripts/backup-synthesize.py',import.meta.url))],{shell:false,stdio:['pipe','pipe','pipe'],env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'}});
  let buffer=Buffer.alloc(0),header=null,pending=null,serial=0,closed=false,failure,readySeen=false,tail=Promise.resolve(),readyResolve,readyReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  ready.catch(()=>{});
  const startup=schedule(()=>fail(new Error('音声モデルの準備が時間内に完了しませんでした。')),startupTimeout);
  function finish(job){cancel(job.timer);cancel(job.limit);job.signal?.removeEventListener('abort',job.abort);pending=null;}
  function wait(job,timeout,code){cancel(job.timer);job.timer=schedule(()=>fail(backupFault(null,code)),timeout);}
  function fail(error){if(closed)return;closed=true;failure=error;cancel(startup);readyReject(error);if(pending){const job=pending;finish(job);job.reject(error);}child.kill('SIGKILL');}
  child.on('error',()=>fail(new Error('バックアップ音声を起動できません。')));
  child.on('close',()=>fail(backupFault(null,'SYNTHESIS_EXIT')));
  child.stdin.on('error',()=>fail(backupFault(null,'SYNTHESIS_EXIT')));
  child.stderr.on('data',()=>{}); // Native diagnostics may contain paths; never retain channel text.
  child.stdout.on('data',part=>{
    if(closed)return;
    buffer=Buffer.concat([buffer,part]);if(buffer.length>4*1024*1024+2048){fail(backupFault(null,'SYNTHESIS_PROTOCOL'));return;}
    try{
      while(buffer.length){
        if(!header){const at=buffer.indexOf(10);if(at<0){if(buffer.length>1024)throw new Error();return;}if(at>1024)throw new Error();header=JSON.parse(buffer.subarray(0,at).toString());buffer=buffer.subarray(at+1);if(!Number.isInteger(header.bytes)||header.bytes<0||header.bytes>4*1024*1024)throw new Error();}
        if(buffer.length<header.bytes)return;
        const wav=Buffer.from(buffer.subarray(0,header.bytes)),data=header;buffer=buffer.subarray(header.bytes);header=null;
        if(data.type==='ready'){if(readySeen||data.bytes!==0||pending)throw new Error();readySeen=true;cancel(startup);readyResolve();continue;}
        if(!pending||pending.id!==data.id)throw new Error();
        const job=pending;
        if(data.error){finish(job);job.reject(backupFault(null,'SYNTHESIS'));continue;}
        if(job.onChunk){
          if(data.end){if(data.bytes!==0)throw new Error();finish(job);job.resolve();continue;}
          if(data.part!==job.part++)throw new Error();job.bytes+=wav.length;if(job.bytes>8*1024*1024)throw new Error();
          gentlePcm(wav);job.onChunk(wav);
          // Only a complete, valid WAV is progress. Partial bytes cannot extend the wait.
          if(pending===job&&!closed)wait(job,synthesisTimeout,'SYNTHESIS_TIMEOUT');continue;
        }
        finish(job);
        try{gentlePcm(wav);job.resolve(wav);}catch(error){job.reject(error);}
      }
    }catch{fail(backupFault(null,'SYNTHESIS_PROTOCOL'));}
  });
  function request(text,signal,onChunk){
    const job=tail.then(async()=>{await ready;signal?.throwIfAborted();if(closed)throw failure;
      if(!Array.from(text).length||Array.from(text).length>53)throw new Error('音声の文字数が不正です。');
      return new Promise((resolve,reject)=>{
        const id=++serial,job={id,resolve,reject,onChunk,part:0,bytes:0,signal,abort:()=>fail(signal.reason??new Error('読み上げを停止しました。'))};pending=job;
        wait(job,firstAudioTimeout,'SYNTHESIS_START_TIMEOUT');job.limit=schedule(()=>fail(backupFault(null,'SYNTHESIS_LIMIT')),maxSynthesisTime);
        signal?.addEventListener('abort',job.abort,{once:true});
        try{child.stdin.write(JSON.stringify({id,text,stream:!!onChunk})+'\n');}catch{fail(backupFault(null,'SYNTHESIS_EXIT'));}
      });
    });tail=job.catch(()=>{});return job.then(wav=>{signal?.throwIfAborted();return wav;});
  }
  return {ready,synthesize:(text,signal)=>request(text,signal),stream:(text,signal,onChunk)=>request(text,signal,onChunk),close(){fail(new Error('読み上げを停止しました。'));}};
}
