import {Readable} from 'node:stream';
import {createSpeechEncoder} from './opus-encoder.js';
import {createPersistentVoice} from './persistent-voice.js';
import {gentlePcm,wavPcm} from './speech.js';
import {backupFault,backupFailure,backupInfo} from './backup-fault.js';
import {systemCapacity} from './system-capacity.js';
import {BENCHMARK_HISTORY_LIMIT,benchmarkHistoryEntry} from './voice-benchmark-history.js';
export const benchmarkText='こんにちは。音声の処理速度を確認しています。';
export async function measureEncoding(wav,signal){
  signal.throwIfAborted();const pcm=gentlePcm(wav,30).subarray(0,192000),source=Readable.from([pcm]),began=performance.now(),encoder=createSpeechEncoder({signal});source.on('error',()=>{});let output;
  try{
    await encoder.ready;signal.throwIfAborted();const prepared=performance.now(),encodeSignal=AbortSignal.any([signal,AbortSignal.timeout(5000)]);output=encoder.stream(source,encodeSignal);let packets=0;
    for await(const packet of output){encodeSignal.throwIfAborted();packets++;}if(!packets)throw new Error('No packets');
    return {packets,audioMs:Math.round(pcm.length/192),warmupMs:Math.round(prepared-began),processMs:Math.round(performance.now()-prepared),...encoder.diagnostics,backend:'worker-opusscript'};
  }finally{source.destroy();output?.destroy();encoder.close();}
}
// Only errors constructed here may supply a user-visible operation message.
class BenchmarkRunError extends Error {}
export const benchmarkErrorMessage=error=>error instanceof BenchmarkRunError?error.message:null;
const delta=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&b>=a?b-a:null;
export function createVoiceBenchmark({worker=createPersistentVoice,capacity=systemCapacity,encode=measureEncoding,canStart=()=>{},activity=()=>()=>{},now=()=>performance.now(),date=Date.now,version,onDiagnostic=()=>{}}={}){
  let job=null,last=null,nextStart=-Infinity,closed=false,serial=0;const history=[];
  const snapshot=()=>structuredClone(job?{owner:job.owner,phase:job.phase,info:backupInfo(job.synth?.diagnostics),elapsedMs:Math.round(now()-job.began)}:{phase:'idle',result:last});
  const cancel=(owner,reason='system')=>{if(job&&owner!==undefined&&job.owner!==owner)throw new BenchmarkRunError('測定を開始した画面から中断してください。');if(job&&!job.abort.signal.aborted){job.cancelReason=reason==='shutdown'?'shutdown':reason==='confirmed-user'?'user':'system';try{onDiagnostic({stage:'cancel',cause:job.cancelReason,phase:job.phase,elapsedMs:Math.round(now()-job.began)});}catch{}job.cancelInfo=backupInfo(job.synth?.diagnostics);job.phase='cancelling';job.abort.abort();job.synth?.close();}};
  return {get busy(){return !!job;},snapshot,history:()=>structuredClone(history),cancel,close(){closed=true;cancel(undefined,'shutdown');},async run(owner){
    if(closed)throw new BenchmarkRunError('Botを停止しています。');if(job)throw new BenchmarkRunError('別の処理速度測定を実行中です。');if(now()<nextStart)throw new BenchmarkRunError(`次の測定まであと${Math.ceil((nextStart-now())/1000)}秒です。`);
    try{canStart();}catch{throw new BenchmarkRunError('読み上げ・VC入室・別の操作が進行中です。終了後に測定してください。');}const current={owner,phase:'warming',began:now(),abort:new AbortController()};job=current;let finish=()=>{},firstWav,warmupAt,synthesisAt,previous,encodingAt;
    const result={measuredAt:date(),ok:false,warmupMs:null,firstAudioMs:null,synthesisMs:null,audioMs:0,parts:0,maxGapMs:0,encodingMs:null};
    try{
      finish=activity();result.before=await capacity();current.abort.signal.throwIfAborted();
      warmupAt=now();current.synth=worker();const stop=()=>current.synth.close();current.abort.signal.addEventListener('abort',stop,{once:true});
      try{
        await current.synth.ready;current.abort.signal.throwIfAborted();result.warmupMs=Math.round(now()-warmupAt);current.phase='synthesis';synthesisAt=now();
        await current.synth.stream(benchmarkText,current.abort.signal,wav=>{
          current.abort.signal.throwIfAborted();const at=now();if(firstWav===undefined){firstWav=wav;result.firstAudioMs=Math.round(at-synthesisAt);}else result.maxGapMs=Math.max(result.maxGapMs,Math.round(at-previous));previous=at;result.parts++;result.audioMs+=wavPcm(wav).length/192;
        });
        current.abort.signal.throwIfAborted();result.synthesisMs=Math.round(now()-synthesisAt);result.audioMs=Math.round(result.audioMs);if(!firstWav)throw backupFault(null,'SYNTHESIS');
        result.realTimeFactor=Math.round(result.synthesisMs/result.audioMs*100)/100;result.info=backupInfo(current.synth.diagnostics);current.phase='encoding';encodingAt=now();
        result.encoding=await encode(firstWav,AbortSignal.any([current.abort.signal,AbortSignal.timeout(35000)]));result.encodingMs=Math.round(now()-encodingAt);current.abort.signal.throwIfAborted();result.ok=true;
      }finally{current.abort.signal.removeEventListener('abort',stop);}
    }catch(error){result.cancelled=current.abort.signal.aborted;if(result.cancelled){result.cancelReason=current.cancelReason;result.info=current.cancelInfo;}if(!result.cancelled)result.failure=backupFailure(backupFault(error,encodingAt===undefined?'SYNTHESIS':'ENCODING',current.synth?.diagnostics));if(warmupAt!==undefined&&result.warmupMs===null)result.warmupElapsedMs=Math.round(now()-warmupAt);if(synthesisAt!==undefined&&result.synthesisMs===null)result.synthesisMs=Math.round(now()-synthesisAt);}
    finally{
      firstWav=null;result.elapsedMs=Math.round(now()-current.began);
      try{result.after=await capacity();if(result.before){result.throttledMs=delta(result.before.cpuThrottledUsec,result.after.cpuThrottledUsec);if(result.throttledMs!==null)result.throttledMs=Math.round(result.throttledMs/1000);const periods=delta(result.before.cpuPeriods,result.after.cpuPeriods),throttled=delta(result.before.cpuThrottledPeriods,result.after.cpuThrottledPeriods);result.throttledPercent=periods>0&&throttled!==null?Math.min(100,Math.round(throttled/periods*100)):null;}}catch{}
      current.synth?.close();finish();nextStart=now()+30000;last=result;history.unshift(benchmarkHistoryEntry(result,{id:++serial,botVersion:version}));history.length=Math.min(history.length,BENCHMARK_HISTORY_LIMIT);job=null;
    }
    return structuredClone(result);
  }};
}
