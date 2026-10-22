import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {BoundedBytes} from './bounded-bytes.js';
const API='https://api.osv.dev/v1',MAX_LOCK=1024*1024;
const packageName=value=>typeof value==='string'&&value.length<=214&&/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(value);
const version=value=>typeof value==='string'&&value.length<=100&&/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
const advisoryId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value);
const invalid=()=>new Error('invalid security data');
export async function securityLock(path=new URL('../package-lock.json',import.meta.url)){
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const info=await file.stat();if(!info.isFile()||info.size>MAX_LOCK)throw invalid();const bytes=Buffer.alloc(MAX_LOCK+1),{bytesRead}=await file.read(bytes,0,bytes.length,0);if(bytesRead>MAX_LOCK)throw invalid();return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead));}finally{await file.close();}
}
// Use the lock shipped alongside the running source, never the data directory's
// potentially newer lock or node_modules, .npmrc, ENV, saved data or shell tools.
export function securityInventory(source){
  if(typeof source!=='string'||Buffer.byteLength(source)>MAX_LOCK)throw invalid();
  const lock=JSON.parse(source),root=lock?.packages?.[''];
  if(lock?.lockfileVersion!==3||!root||typeof root!=='object'||Array.isArray(root)||!version(root.version))throw invalid();
  const entries=Object.entries(lock.packages);if(entries.length>1001)throw invalid();
  const packages=new Map();let skipped=0;
  for(const [path,item] of entries){
    if(path==='')continue;
    if(!path.startsWith('node_modules/')||path.length>1024||!item||typeof item!=='object'||Array.isArray(item))throw invalid();
    const installedName=path.slice(path.lastIndexOf('node_modules/')+13),name=item.name??installedName;
    let publicRegistry=false;try{const url=new URL(item.resolved);publicRegistry=url.origin==='https://registry.npmjs.org'&&!url.username&&!url.password;}catch{}
    if(item.private===true||item.link||!packageName(name)||!version(item.version)||!publicRegistry){skipped++;continue;}
    const key=`${name}@${item.version}`,previous=packages.get(key),dev=item.dev===true;
    const top=path===`node_modules/${installedName}`,direct=top&&(Object.hasOwn(root.dependencies??{},installedName)||Object.hasOwn(root.devDependencies??{},installedName));
    packages.set(key,{name,version:item.version,dev:previous?previous.dev&&dev:dev,direct:direct||previous?.direct===true});
  }
  if(!packages.size)throw invalid();
  return {version:root.version,lockHash:createHash('sha256').update(source).digest('hex'),packages:[...packages.values()],skipped};
}
async function jsonResponse(response,signal,maximum){
  const reject=async()=>{await response.body?.cancel().catch(()=>{});throw invalid();};
  if(!response.ok||!response.body)return reject();
  const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>maximum))return reject();
  const reader=response.body.getReader(),bytes=new BoundedBytes(maximum);
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try{while(true){signal.throwIfAborted();const chunk=await reader.read();signal.throwIfAborted();if(chunk.done)break;bytes.append(chunk.value);}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.finish()));}
  finally{signal.removeEventListener('abort',abort);bytes.dispose();await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function securityMatches(value,inventory){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>key!=='results')||!Array.isArray(value.results)||value.results.length!==inventory.packages.length)throw invalid();
  const findings=new Map();let references=0;
  value.results.forEach((result,index)=>{
    if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).some(key=>!['vulns','next_page_token'].includes(key))||result.next_page_token!==undefined&&result.next_page_token!==''||result.vulns!==undefined&&!Array.isArray(result.vulns))throw invalid();
    for(const vuln of result.vulns??[]){
      if(!vuln||!advisoryId(vuln.id)||++references>5000)throw invalid();
      if(!findings.has(vuln.id))findings.set(vuln.id,{id:vuln.id,severity:'unknown',packages:[],detail:false,fixed:[]});
      const finding=findings.get(vuln.id),pkg=inventory.packages[index];if(!finding.packages.includes(pkg))finding.packages.push(pkg);
      if(findings.size>1000)throw invalid();
    }
  });
  return [...findings.values()];
}
const severities=['critical','high','moderate','low','unknown'];
function detail(finding,value){
  if(!value||value.id!==finding.id||value.withdrawn!==undefined)throw invalid();
  const severity=String(value.database_specific?.severity??'unknown').toLowerCase();finding.severity=severity==='medium'?'moderate':severities.includes(severity)?severity:'unknown';
  // Keep only identifiers, finite severity and explicitly fixed version numbers.
  // Remote descriptions, reference URLs, HTML and error bodies never reach Discord.
  if(Array.isArray(value.affected))for(const affected of value.affected.slice(0,100)){
    if(affected?.package?.ecosystem!=='npm'||!finding.packages.some(p=>p.name===affected.package.name))continue;
    if(Array.isArray(affected.ranges))for(const range of affected.ranges.slice(0,100))if(Array.isArray(range?.events))for(const event of range.events.slice(0,100))if(version(event?.fixed)&&!finding.fixed.some(f=>f.name===affected.package.name&&f.version===event.fixed))finding.fixed.push({name:affected.package.name,version:event.fixed});
  }
  finding.fixed=finding.fixed.slice(0,10);finding.detail=true;
}
// Explicit read-only checks share one in-flight request and five-minute cache.
// Failures never become a clean result; no retries, polling or automatic fixes.
export function createSecurityScan({read=securityLock,fetcher=fetch,now=Date.now,timeout=15000}={}){
  let pending,cached;
  const snapshot=()=>cached?structuredClone(cached):null;
  return {snapshot,async run(){
    if(pending)return structuredClone(await pending);
    if(cached&&now()>=cached.checkedAt&&now()-cached.checkedAt<(cached.status==='complete'?300000:30000))return snapshot();
    const job=(async()=>{
      const beganAt=now();let inventory;
      try{inventory=securityInventory(await read());}catch{return {status:'failed',code:'LOCK_UNAVAILABLE',checkedAt:now(),beganAt};}
      const base={version:inventory.version,lockHash:inventory.lockHash,packageCount:inventory.packages.length,runtimeCount:inventory.packages.filter(p=>!p.dev).length,devCount:inventory.packages.filter(p=>p.dev).length,skipped:inventory.skipped};
      const signal=AbortSignal.timeout(timeout),options={signal,redirect:'error',headers:{'Content-Type':'application/json',Accept:'application/json'}};
      let findings;
      try{
        const body=JSON.stringify({queries:inventory.packages.map(p=>({package:{name:p.name,ecosystem:'npm'},version:p.version}))});
        const response=await fetcher(`${API}/querybatch`,{...options,method:'POST',body});
        findings=securityMatches(await jsonResponse(response,signal,1024*1024),inventory);
      }catch{return {...base,status:'failed',code:signal.aborted?'LOOKUP_TIMEOUT':'LOOKUP_UNAVAILABLE',checkedAt:now(),beganAt};}
      const selected=findings.slice(0,20);let next=0;
      await Promise.all(Array.from({length:Math.min(2,selected.length)},async()=>{
        while(next<selected.length&&!signal.aborted){const finding=selected[next++];try{const data=await jsonResponse(await fetcher(`${API}/vulns/${encodeURIComponent(finding.id)}`,{...options,method:'GET'}),signal,65536);detail(finding,data);}catch{/* Exact-version match remains known; details remain unconfirmed. */}}
      }));
      findings.sort((a,b)=>severities.indexOf(a.severity)-severities.indexOf(b.severity)||a.id.localeCompare(b.id));
      return {...base,status:'complete',checkedAt:now(),beganAt,findings,detailMissing:findings.filter(f=>!f.detail).length,source:'OSV'};
    })();
    pending=job;try{cached=await job;return snapshot();}finally{if(pending===job)pending=null;}
  }};
}
