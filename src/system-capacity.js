import {readFile} from 'node:fs/promises';
import {availableParallelism,totalmem} from 'node:os';
const integer=raw=>/^\d+$/.test(raw??'')&&Number.isSafeInteger(Number(raw))?Number(raw):null;
const positive=raw=>integer(raw)>0?integer(raw):null;
const counter=(raw,key)=>integer(raw?.match(new RegExp(`^${key}\\s+(\\d+)$`,'m'))?.[1]);
export async function systemCapacity({read=path=>readFile(path,'utf8'),parallel=availableParallelism,total=totalmem}={}){
  const paths=['/sys/fs/cgroup/cpu.max','/sys/fs/cgroup/cpu.stat','/sys/fs/cgroup/memory.current','/sys/fs/cgroup/memory.max','/sys/fs/cgroup/cpu/cpu.cfs_quota_us','/sys/fs/cgroup/cpu/cpu.cfs_period_us','/sys/fs/cgroup/cpu/cpu.stat','/sys/fs/cgroup/cpuacct/cpuacct.usage','/sys/fs/cgroup/memory/memory.usage_in_bytes','/sys/fs/cgroup/memory/memory.limit_in_bytes'];
  const values=await Promise.all(paths.map(async path=>{try{return (await read(path)).trim();}catch{if(path.startsWith('/sys/fs/cgroup/cpu/')||path.startsWith('/sys/fs/cgroup/cpuacct/'))try{return (await read(path.replace(/\/(cpu|cpuacct)\//,'/cpu,cpuacct/'))).trim();}catch{}return null;}}));
  const [max,stat,used,memoryMax,quotaV1,periodV1,statV1,usageV1,usedV1,memoryMaxV1]=values,[quota,period]=max?.split(/\s+/)??[];
  const limit=positive(quota)&&positive(period)?Number(quota)/Number(period):max===null&&positive(quotaV1)&&positive(periodV1)?Number(quotaV1)/Number(periodV1):null;
  const logicalCores=parallel(),memoryLimit=memoryMax===null?positive(memoryMaxV1):positive(memoryMax),source=stat??statV1;
  return {arch:process.arch,logicalCores,cpuLimitCores:limit,cpuQuotaKnown:limit!==null||/^max\s+\d+$/.test(max??'')||max===null&&quotaV1==='-1',effectiveCores:limit===null?logicalCores:Math.min(logicalCores,limit),memoryLimitBytes:Math.min(memoryLimit??total(),total()),memoryQuotaKnown:memoryLimit!==null||memoryMax==='max',memoryUsedBytes:integer(used)??integer(usedV1),cpuUsageUsec:counter(stat,'usage_usec')??(integer(usageV1)===null?null:Number(usageV1)/1000),cpuThrottledUsec:counter(stat,'throttled_usec')??(counter(statV1,'throttled_time')===null?null:counter(statV1,'throttled_time')/1000),cpuPeriods:counter(source,'nr_periods'),cpuThrottledPeriods:counter(source,'nr_throttled')};
}

const mib=value=>Number.isFinite(value)?`${Math.round(value/1048576)}MiB`:'未確認';
export function capacitySummary(c){return c?`CPU上限 **${Number.isFinite(c.cpuLimitCores)?`${c.cpuLimitCores.toLocaleString('ja-JP',{maximumSignificantDigits:3})}コア`:c.cpuQuotaKnown?'未設定（cgroup）':'未確認'}** · CPU並列度 ${Number.isInteger(c.logicalCores)?c.logicalCores:'未確認'}\nメモリ **${mib(c.memoryUsedBytes)} / ${mib(c.memoryLimitBytes)}${c.memoryQuotaKnown===false?'（参考値）':''}** · ${/^[a-z0-9_-]{1,20}$/i.test(c.arch??'')?c.arch:'不明'}`:'スペックは動作診断で確認できます。';}
