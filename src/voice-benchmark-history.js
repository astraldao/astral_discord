import {backupInfo,safeBackupFailure} from './backup-fault.js';
export const BENCHMARK_HISTORY_LIMIT=5;
const number=(value,max=3600000)=>Number.isFinite(value)&&value>=0&&value<=max?value:null;
const integer=(value,max)=>Number.isInteger(value)?number(value,max):null;
const version=value=>typeof value==='string'&&/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value)?value:'unknown';
const capacity=value=>{
  if(!value||typeof value!=='object')return undefined;
  const result={};
  for(const key of ['cpuLimitCores','effectiveCores','logicalCores'])result[key]=number(value[key],1048576);
  for(const key of ['memoryLimitBytes','memoryUsedBytes'])result[key]=integer(value[key],Number.MAX_SAFE_INTEGER);
  for(const key of ['cpuQuotaKnown','memoryQuotaKnown'])if(typeof value[key]==='boolean')result[key]=value[key];
  if(['arm','arm64','ia32','x64','riscv64','ppc64','s390x','mips','mipsel','loong64'].includes(value.arch))result.arch=value.arch;
  return result;
};
// History and reports are deliberately rebuilt from a fixed schema, never spread from worker data.
export function benchmarkHistoryEntry(value,{id=value?.id,botVersion=value?.version}={}){
  const result={id:Number.isSafeInteger(id)&&id>0?id:null,version:version(botVersion),measuredAt:integer(value?.measuredAt,8640000000000000),ok:value?.ok===true,cancelled:value?.cancelled===true};
  for(const key of ['warmupMs','warmupElapsedMs','firstAudioMs','synthesisMs','audioMs','maxGapMs','encodingMs','elapsedMs','throttledMs'])result[key]=number(value?.[key]);
  result.parts=integer(value?.parts,256);result.realTimeFactor=number(value?.realTimeFactor,1000000);result.throttledPercent=number(value?.throttledPercent,100);
  if(result.cancelled)result.cancelReason=['user','shutdown','system'].includes(value?.cancelReason)?value.cancelReason:'system';
  result.info=backupInfo(value?.info);
  const failure=safeBackupFailure(value?.failure);if(failure)result.failure=failure;
  for(const key of ['before','after']){const c=capacity(value?.[key]);if(c)result[key]=c;}
  if(value?.encoding&&typeof value.encoding==='object'){
    const e=value.encoding;result.encoding={packets:integer(e.packets,1000000),audioMs:number(e.audioMs,1000)};
    for(const key of ['warmupMs','processMs','warmupCpuMs','processCpuMs'])result.encoding[key]=number(e[key]);
    if(e.backend==='worker-opusscript')result.encoding.backend=e.backend;
  }
  return result;
}
const conditions=r=>({version:r.version==='unknown'?undefined:r.version,engine:r.info?.engine,protocol:r.info?.protocol,threads:r.info?.threads,configuredThreads:r.info?.configuredThreads,arch:(r.after??r.before)?.arch,cpuLimitCores:(r.after??r.before)?.cpuLimitCores,cpuQuotaKnown:(r.after??r.before)?.cpuQuotaKnown,logicalCores:(r.after??r.before)?.logicalCores,memoryLimitBytes:(r.after??r.before)?.memoryLimitBytes,memoryQuotaKnown:(r.after??r.before)?.memoryQuotaKnown});
export const benchmarkConditionLabels={version:'Bot版',engine:'合成方式',protocol:'音声プロトコル',threads:'実行スレッド',configuredThreads:'設定スレッド上限',arch:'CPUアーキテクチャ',cpuLimitCores:'CPU割当',cpuQuotaKnown:'CPU割当の確認状態',logicalCores:'CPU並列度',memoryLimitBytes:'メモリ上限',memoryQuotaKnown:'メモリ上限の確認状態'};
export const benchmarkMetricLabels={warmupMs:'モデル準備',firstAudioMs:'先頭音声',synthesisMs:'合成完了',encodingMs:'Opus変換',realTimeFactor:'実時間比'};
export function compareBenchmarks(current,previous){
  const a=benchmarkHistoryEntry(current),b=benchmarkHistoryEntry(previous);if(!a.ok||a.cancelled||!b.ok||b.cancelled)return null;
  const ca=conditions(a),cb=conditions(b),different=[],unknown=[];
  for(const key of Object.keys(benchmarkConditionLabels)){
    if(key==='memoryLimitBytes'){if(ca.memoryQuotaKnown===true&&cb.memoryQuotaKnown===true){if(ca[key]!==cb[key])different.push(key);}else unknown.push(key);}
    else if(key==='cpuLimitCores'&&ca.cpuQuotaKnown&&cb.cpuQuotaKnown){if(ca[key]!==cb[key])different.push(key);}
    else if(ca[key]===undefined||cb[key]===undefined||ca[key]===null||cb[key]===null)unknown.push(key);
    else if(ca[key]!==cb[key])different.push(key);
  }
  const metrics={};for(const key of Object.keys(benchmarkMetricLabels))metrics[key]=Number.isFinite(a[key])&&Number.isFinite(b[key])?Math.round((a[key]-b[key])*100)/100:null;
  return {currentId:a.id,previousId:b.id,different,unknown,metrics};
}
export function benchmarkReport(current,previous){
  const selected=benchmarkHistoryEntry(current);if(selected.id===null)throw new Error('測定履歴を開き直してください。');
  const baseline=previous?benchmarkHistoryEntry(previous):null;
  const comparison=baseline?compareBenchmarks(selected,baseline):null;
  return {format:'astral-voice-benchmark-v1',scope:'fixed-text-local-only',retention:'memory-last-five-until-restart',measurement:selected,...(comparison?{baseline,comparison}:{})};
}
