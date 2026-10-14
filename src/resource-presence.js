import {readFile} from 'node:fs/promises';
import {totalmem} from 'node:os';
import {ActivityType} from 'discord.js';
const integer=value=>typeof value==='string'&&/^\d+$/.test(value.trim())&&Number.isSafeInteger(Number(value.trim()))?Number(value.trim()):null;
const cpuTotal=usage=>usage.user+usage.system;
export function createResourceSampler({read=path=>readFile(path,'utf8'),now=()=>performance.now(),cpu=()=>process.cpuUsage(),memory=()=>process.memoryUsage.rss(),total=totalmem}={}){
  let previous;
  const optional=async path=>{try{return await read(path);}catch{return null;}};
  return async()=>{
    const [stat,used,max]=await Promise.all([optional('/sys/fs/cgroup/cpu.stat'),optional('/sys/fs/cgroup/memory.current'),optional('/sys/fs/cgroup/memory.max')]);
    let usage=integer(stat?.match(/^usage_usec\s+(\d+)\s*$/m)?.[1]),source='cgroup-v2';
    if(usage===null){const v1=integer(await optional('/sys/fs/cgroup/cpuacct/cpuacct.usage')??await optional('/sys/fs/cgroup/cpu,cpuacct/cpuacct.usage'));usage=v1===null?cpuTotal(cpu()):v1/1000;source=v1===null?'process':'cgroup-v1';}
    let bytes=integer(used),limit=integer(max),memorySource='cgroup-v2';
    if(bytes===null){const v1=await Promise.all([optional('/sys/fs/cgroup/memory/memory.usage_in_bytes'),optional('/sys/fs/cgroup/memory/memory.limit_in_bytes')]);bytes=integer(v1[0]);limit=integer(v1[1]);memorySource='cgroup-v1';}
    if(bytes===null){bytes=memory();memorySource='process';}
    const systemLimit=total();limit=limit>0?Math.min(limit,systemLimit):systemLimit;
    const time=now(),elapsed=previous?time-previous.time:0;
    const cpuPercent=previous&&previous.source===source&&elapsed>0&&usage>=previous.usage?(usage-previous.usage)/(elapsed*1000)*100:null;
    previous={usage,time,source};
    return {cpuPercent:Number.isFinite(cpuPercent)?cpuPercent:null,memoryPercent:Number.isFinite(bytes)&&limit>0?bytes/limit*100:null,cpuSource:source,memorySource};
  };
}
const percent=n=>Number.isFinite(n)&&n>=0?`${n.toFixed(1)}%`:'計測中';
export const resourceStatus=sample=>`CPU ${percent(sample.cpuPercent)} · MEM ${percent(sample.memoryPercent)}`;
export function profileVersion(description,version){
  if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version))throw new Error('バージョンが不正です。');
  const body=String(description??'').split(/\r?\n/).filter(line=>!/^ASTRAL · v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(line)).join('\n').trimEnd();
  const result=`${body?`${body}\n\n`:''}ASTRAL · v${version}`;
  return result.length<=400?result:null;
}
export async function updateProfileVersion(application,version){const current=await application.fetch(),description=profileVersion(current.description,version);if(description===null)return false;if(description!==current.description)await application.edit({description});return true;}
export function createResourcePresence(client,{sample=createResourceSampler(),version='',schedule=setInterval,cancel=clearInterval,after=setTimeout,cancelAfter=clearTimeout,now=()=>performance.now(),onError=()=>{}}={}){
  let timer,pending,busy=false,stopped=true,last,lastSent=-Infinity,active=0,activeUntil=0,metrics={cpuPercent:null,memoryPercent:null};
  function publish(){if(stopped||!client.isReady())return;const time=now(),status=active>0||time<activeUntil?'online':'idle',state=`${version?`v${version} · `:''}${resourceStatus(metrics)}`,signature=`${status}:${state}`;
    if(signature===last&&client.presence?.status===status)return;
    const wait=Math.max(0,5000-(time-lastSent));if(wait){if(pending===undefined){pending=after(()=>{pending=undefined;publish();},wait);pending?.unref?.();}return;}
    try{client.user.setPresence({status,afk:false,activities:[{name:'リソース使用率',type:ActivityType.Custom,state}]});last=signature;lastSent=time;}catch{onError();}
  }
  async function refresh(){if(stopped||busy||!client.isReady())return;busy=true;try{metrics=await sample();publish();}catch{onError();}finally{busy=false;}}
  function activity(){active++;activeUntil=Math.max(activeUntil,now()+5000);publish();let released=false;return ()=>{if(released)return;released=true;active=Math.max(0,active-1);publish();if(!active&&!stopped&&now()<activeUntil&&pending===undefined){pending=after(()=>{pending=undefined;publish();},activeUntil-now());pending?.unref?.();}};}
  return {refresh,activity,async track(operation){const done=activity();try{return await operation();}finally{done();}},start(){if(!stopped)return;stopped=false;void refresh();timer=schedule(()=>void refresh(),30000);timer?.unref?.();},stop(){stopped=true;if(timer!==undefined)cancel(timer);if(pending!==undefined)cancelAfter(pending);timer=undefined;pending=undefined;}};
}
