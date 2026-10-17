import {availableParallelism} from 'node:os';
import {readFileSync} from 'node:fs';
const read=path=>{try{return readFileSync(path,'utf8').trim();}catch{return null;}};
function cpuQuota(){
  const value=read('/sys/fs/cgroup/cpu.max');
  if(value!==null){const [quota,period]=value.split(/\s+/);return /^\d+$/.test(quota??'')&&/^\d+$/.test(period??'')&&Number(quota)>0&&Number(period)>0?Number(quota)/Number(period):null;}
  for(const group of ['cpu','cpu,cpuacct']){
    const quota=read(`/sys/fs/cgroup/${group}/cpu.cfs_quota_us`),period=read(`/sys/fs/cgroup/${group}/cpu.cfs_period_us`);
    if(quota!==null)return /^\d+$/.test(quota)&&/^\d+$/.test(period??'')&&Number(quota)>0&&Number(period)>0?Number(quota)/Number(period):null;
  }
  return null;
}
// The stored value is an upper bound. Reserve no extra inference threads beyond the visible CPU quota.
export function voiceThreads(value=process.env.VOICEVOX_BACKUP_THREADS??'2',parallel=availableParallelism(),limit=cpuQuota()){
  if(typeof value!=='string'||!/^[1-4]$/.test(value)||!Number.isInteger(parallel)||parallel<1)throw new Error('合成スレッド数を確認してください。');
  const configuredThreads=Number(value),available=Number.isFinite(limit)&&limit>0?Math.min(parallel,Math.max(1,Math.floor(limit))):parallel;
  return {configuredThreads,threads:Math.min(configuredThreads,available)};
}
