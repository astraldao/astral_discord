import {open,opendir,lstat,realpath,statfs} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {BoundedBytes} from './bounded-bytes.js';
import {dependencyHash,validSha,REPOSITORY} from '../scripts/auto-update.js';

const MiB=1024*1024;
export const UPDATE_MIN_FREE_BYTES=200*MiB,UPDATE_ARCHIVE_LIMIT=20*MiB;
const size=value=>Number.isSafeInteger(value)&&value>=0;
async function responseText(response,signal,maximum){
  const reject=()=>new Error('capacity unavailable');
  if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});throw reject();}
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||!size(Number(length))||Number(length)>maximum)){await response.body.cancel().catch(()=>{});throw reject();}
  const reader=response.body.getReader(),bytes=new BoundedBytes(maximum);
  try{while(true){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done)break;bytes.append(part.value);}return new TextDecoder('utf-8',{fatal:true}).decode(bytes.finish());}
  finally{bytes.dispose();await reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function lockFile(path){
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const info=await file.stat();if(!info.isFile()||info.size>65536)throw new Error('capacity unavailable');const buffer=Buffer.alloc(65537),{bytesRead}=await file.read(buffer,0,buffer.length,0);if(bytesRead>65536)throw new Error('capacity unavailable');return buffer.subarray(0,bytesRead);}
  finally{await file.close();}
}
export function updateSourceBytes(value){
  if(!value||value.truncated!==false||!Array.isArray(value.tree)||value.tree.length>10000)throw new Error('capacity unavailable');
  let bytes=0;const paths=new Set();
  for(const entry of value.tree){
    if(!entry||typeof entry.path!=='string'||!entry.path||entry.path.length>1024||entry.path.startsWith('/')||entry.path.split('/').some(p=>!p||p==='.'||p==='..')||/[\\\u0000-\u001f]/u.test(entry.path)||paths.has(entry.path))throw new Error('capacity unavailable');paths.add(entry.path);
    if(entry.type==='tree'&&entry.mode==='040000')continue;
    if(entry.type!=='blob'||!['100644','100755'].includes(entry.mode)||!size(entry.size))throw new Error('capacity unavailable');
    bytes+=entry.size;if(bytes>64*MiB)throw new Error('capacity unavailable');
  }
  if(!paths.has('package.json')||!paths.has('package-lock.json')||!paths.has('index.js'))throw new Error('capacity unavailable');return bytes;
}
async function dataBytes(root,signal){
  let bytes=0,entries=0;
  async function visit(path,depth){
    signal.throwIfAborted();if(depth>16||++entries>10000)throw new Error('capacity unavailable');const info=await lstat(path);
    if(info.isSymbolicLink())throw new Error('capacity unavailable');
    if(info.isFile()){bytes+=info.size;if(!size(bytes)||bytes>64*MiB)throw new Error('capacity unavailable');}
    else if(info.isDirectory()){const dir=await opendir(path);for await(const entry of dir)await visit(join(path,entry.name),depth+1);}
    else throw new Error('capacity unavailable');
  }
  try{await visit(join(root,'data'),0);}catch(error){if(error.code==='ENOENT'&&entries===1)return 0;throw error;}return bytes;
}

// Read-only metadata, only on an explicit update check. No archive download,
// npm execution, cleanup, data contents, environment values or persisted report.
export function createUpdateCapacity({root=process.cwd(),fetcher=fetch,now=Date.now,timeout=8000}={}){
  let cached,pending;
  return async function estimate(data){
    const currentSha=data.current?.sha,targetSha=data.latest?.sha;
    if(!validSha(targetSha)||targetSha===currentSha||['preparing','switching'].includes(data.phase))return null;
    const key=`${currentSha}:${targetSha}`;
    if(cached?.key===key&&now()>=cached.value.checkedAt&&now()-cached.value.checkedAt<30000)return structuredClone(cached.value);
    if(pending)return pending.key===key?structuredClone(await pending.job):null;
    const signal=AbortSignal.timeout(timeout),options={redirect:'error',signal};
    const attempt=async fn=>{try{return await fn();}catch{return null;}};
    const job=(async()=>{
      const [sourceBytes,archiveBytes,dependencies,dataBackupBytes,freeBytes]=await Promise.all([
        attempt(async()=>updateSourceBytes(JSON.parse(await responseText(await fetcher(`https://api.github.com/repos/${REPOSITORY}/git/trees/${targetSha}?recursive=1`,{...options,headers:{Accept:'application/vnd.github+json','User-Agent':'astral-update-capacity'}}),signal,2*MiB)))),
        attempt(async()=>{const response=await fetcher(`https://codeload.github.com/${REPOSITORY}/tar.gz/${targetSha}`,{...options,method:'HEAD'});try{if(!response.ok)return null;const value=response.headers.get('content-length');return value!==null&&/^\d+$/.test(value)&&size(Number(value))&&Number(value)>0&&Number(value)<=UPDATE_ARCHIVE_LIMIT?Number(value):null;}finally{await response.body?.cancel().catch(()=>{});}}),
        attempt(async()=>{
          const remote=await responseText(await fetcher(`https://raw.githubusercontent.com/${REPOSITORY}/${targetSha}/package-lock.json`,options),signal,65536);const lock=JSON.parse(remote);if(lock.lockfileVersion!==3||!lock.packages?.['']||typeof lock.packages['']!=='object')throw new Error('capacity unavailable');const hash=dependencyHash(remote);
          try{if(dependencyHash(await lockFile(join(root,'package-lock.json')))===hash){const path=await realpath(join(root,'node_modules'));if((await lstat(path)).isDirectory())return 'reuse';}}catch{}
          const home=join(root,'.astral-updates'),deps=resolve(home,`deps-${hash}`);
          // The supervisor removes orphan caches before preparing a release.
          // Only caches referenced by one of its retained releases survive.
          try{if((await lstat(join(deps,'.complete'))).isFile()){
            const state=JSON.parse(await lockFile(join(home,'state.json')));
            if((state.release===null||state.release===state.sha&&validSha(state.release))&&(state.previous===null||validSha(state.previous)))for(const sha of [state.release,state.previous].filter(validSha))if(await realpath(join(home,sha,'node_modules')).catch(()=>null)===deps)return 'reuse';
          }}catch{}return 'install';
        }),
        attempt(()=>dataBytes(root,signal)),
        attempt(async()=>{const fs=await statfs(root),bytes=fs.bavail*fs.bsize;return size(bytes)?bytes:null;}),
      ]);
      const value={currentSha:validSha(currentSha)?currentSha:null,targetSha,checkedAt:now(),sourceBytes,archiveBytes,dependencies,dataBackupBytes,freeBytes};
      cached={key,value};return value;
    })();
    pending={key,job};try{return structuredClone(await job);}finally{if(pending?.job===job)pending=null;}
  };
}

export function updateCapacityWarning(s){
  const v=s.capacity,d=s.data;
  return d.latest&&d.latest.sha!==d.current.sha&&v&&v.targetSha===d.latest.sha&&v.currentSha===(validSha(d.current.sha)?d.current.sha:null)&&size(v.freeBytes)&&v.freeBytes<UPDATE_MIN_FREE_BYTES?'確認時のOSの空き容量が最低条件200 MiBを下回っています。空きを確保し、更新を再確認してください。':null;
}

export function updateCapacityFields(s,{compact=false}={}){
  const value=s.capacity,data=s.data;
  if(!data.latest||data.latest.sha===data.current.sha)return [];
  const valid=value&&value.targetSha===data.latest.sha&&value.currentSha===(validSha(data.current.sha)?data.current.sha:null);
  const format=bytes=>!size(bytes)?'未確認':bytes>=1024*MiB?`${(bytes/(1024*MiB)).toFixed(1)} GiB`:bytes>=MiB?`${(bytes/MiB).toFixed(1)} MiB`:bytes>=1024?`${(bytes/1024).toFixed(1)} KiB`:`${bytes} B`;
  if(!valid)return ['preparing','switching'].includes(data.phase)?[]:[{name:'更新に使う容量',value:'未計測です。「更新を再確認」で調べられます。取得できない項目があっても、更新確認は続けられます。'}];
  const deps=value.dependencies==='reuse'?'再利用予定（追加取得なし）':value.dependencies==='install'?'新規取得が必要（容量未確認）':'未確認';
  const subtotal=size(value.sourceBytes)&&size(value.dataBackupBytes)?format(value.sourceBytes+value.dataBackupBytes):'未確認';
  if(compact)return [{name:'更新容量の目安',value:`取得 **${format(value.archiveBytes)}**${!size(value.archiveBytes)?'（取得上限20 MiB）':''} · 依存：${deps}\n追加の保存容量 **${subtotal}**${value.dependencies!=='reuse'?' ＋ 依存（未確認）':''}\nOSの空き **${format(value.freeBytes)}** · 最低条件 ${UPDATE_MIN_FREE_BYTES/MiB} MiB\n\n一時領域・旧版の控え等は別途必要です。契約上限とは異なる場合があります。詳しくは「容量の内訳」へ。`}];
  return [
    {name:'取得する容量',value:`コード圧縮ファイル：${format(value.archiveBytes)}${!size(value.archiveBytes)?'（取得上限20 MiB）':''}\n依存パッケージ：${deps}`},
    {name:'追加の保存容量（目安）',value:`新版コード：${format(value.sourceBytes)}\n保存データの控え1組：${format(value.dataBackupBytes)}\n小計：${subtotal}${value.dependencies!=='reuse'?' ＋ 依存パッケージ（未確認）':''}\n更新中は圧縮ファイル・一時領域・復旧用の控えも使用します。`},
    {name:'空き容量の確認',value:`更新処理の最低条件：${UPDATE_MIN_FREE_BYTES/MiB} MiB以上\nOSが報告する確認時の空き：${format(value.freeBytes)}\nホストの契約上限とは異なる場合があります。\n\n差分だけでなくコード一式を取得し、旧版も保持します。小計はファイル合計で、ディスク上の使用量・npmキャッシュは別です。古い版の整理で減る分は差し引きません。`},
  ];
}
