import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rename,rm,readdir,lstat,symlink,realpath,statfs,cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {boundedResponseText} from './bounded-response.js';
export const REPOSITORY='astraldao/astral_discord';
export const validSha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
export const intervalMs=value=>/^\d+$/.test(value??'')&&Number(value)>=60&&Number(value)<=3600?Number(value)*1000:300000;
const application=['index.js','package.json','package-lock.json','src','scripts','assets','dictionaries'];
export function dependencyHash(raw){
  const lock=JSON.parse(raw);delete lock.version;
  if(lock.packages?.[''])delete lock.packages[''].version;
  return createHash('sha256').update(JSON.stringify(lock)).digest('hex');
}
export function runFile(command,args,{cwd,timeout=300000,capture=false,signal}={}){
  return new Promise((accept,reject)=>{
    const child=spawn(command,args,{cwd,shell:false,stdio:capture?['ignore','pipe','ignore']:'inherit'});
    let output='',failed=false;
    const fail=()=>{failed=true;child.kill('SIGKILL');};
    const timer=setTimeout(fail,timeout);
    signal?.addEventListener('abort',fail,{once:true});if(signal?.aborted)fail();
    if(capture)child.stdout.on('data',part=>{output+=part;if(Buffer.byteLength(output)>4*1024*1024)fail();});
    child.once('error',()=>{clearTimeout(timer);signal?.removeEventListener('abort',fail);reject(new Error('更新用プロセスを起動できません。'));});
    child.once('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',fail);if(code===0&&!failed)accept(output);else reject(new Error('更新の取得・検証に失敗しました。'));});
  });
}
export async function githubHead({fetcher=fetch}={}){
  const signal=AbortSignal.timeout(15000);
  const response=await fetcher(`https://api.github.com/repos/${REPOSITORY}/git/ref/heads/main`,{headers:{Accept:'application/vnd.github+json','User-Agent':'astral-auto-update'},redirect:'error',signal});
  const body=await boundedResponseText(response,{signal});
  const sha=JSON.parse(body)?.object?.sha;if(!validSha(sha))throw new Error('コミットIDを確認できません。');return sha;
}
export function validateArchive(names,types){
  const entries=names.trim().split('\n'),details=types.trim().split('\n');
  if(!entries.length || entries.length>10000 || details.length!==entries.length)throw new Error('アーカイブの形式が不正です。');
  const top=entries[0].split('/')[0];
  if(!/^[\w.-]+$/.test(top))throw new Error('アーカイブのルートが不正です。');
  let size=0;
  for(let n=0;n<entries.length;n++){
    const name=entries[n],parts=name.split('/');
    if(parts[0]!==top || parts.some(p=>p==='..'||p==='.') || /[\\\x00-\x1f]/.test(name) || !/^[d-]/.test(details[n]))throw new Error('リンク・特殊ファイル・不正なパスは更新できません。');
    const match=details[n].match(/^[d-]\S*\s+\S+\s+(\d+)\s/);if(!match)throw new Error('アーカイブのサイズを確認できません。');
    size+=Number(match[1]);if(size>64*1024*1024)throw new Error('更新ファイルの合計は64MBまでです。');
  }
}
export async function validateSource(root,{run=runFile}={}){
  let bytes=0,files=0;const js=[];
  async function visit(path){const st=await lstat(path);if(st.isSymbolicLink()||(!st.isFile()&&!st.isDirectory()))throw new Error('更新ファイルにリンク・特殊ファイルがあります。');
    if(st.isDirectory()){for(const name of await readdir(path))await visit(join(path,name));}
    else{bytes+=st.size;if(++files>10000 || bytes>64*1024*1024)throw new Error('更新ファイルが大きすぎます。');if(path.endsWith('.js'))js.push(path);}}
  for(const item of application)await visit(join(root,item));
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8')),lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
  if(pkg.type!=='module'||typeof pkg.version!=='string'||lock.lockfileVersion!==3 || !(await readFile(join(root,'index.js'),'utf8')).includes('--worker'))throw new Error('自動更新対応の構成を確認できません。');
  for(const path of js)await run(process.execPath,['--check',path],{cwd:root,timeout:15000,capture:true});
}
export async function prepareRelease(root,sha,{run=runFile}={}){
  if(!validSha(sha))throw new Error('コミットIDが不正です。');
  const home=join(root,'.astral-updates');await mkdir(home,{recursive:true,mode:0o700});
  const space=await statfs(home);if(space.bavail*space.bsize<200*1024*1024)throw new Error('更新準備には空き容量200MB以上が必要です。');
  const stage=join(home,`stage-${randomUUID()}`),release=join(home,sha);await mkdir(stage,{mode:0o700});
  try{
    const archive=join(stage,'source.tar.gz'),source=join(stage,'source');await mkdir(source);
    await run('curl',['-fL','--retry','2','--connect-timeout','15','--max-time','180','--max-filesize','20971520',`https://codeload.github.com/${REPOSITORY}/tar.gz/${sha}`,'-o',archive],{cwd:root,timeout:240000});
    const names=await run('tar',['-tzf',archive],{cwd:root,capture:true}),types=await run('tar',['-tvzf',archive],{cwd:root,capture:true});validateArchive(names,types);
    await run('tar',['--no-same-owner','--no-same-permissions','--strip-components=1','-xzf',archive,'-C',source],{cwd:root});
    await validateSource(source,{run});
    // Shared dependencies prevent a second copy for ordinary source-only commits.
    const lock=await readFile(join(source,'package-lock.json')),hash=dependencyHash(lock),deps=join(home,`deps-${hash}`);
    let target;
    if(await readFile(join(root,'package-lock.json')).then(old=>dependencyHash(old)===hash).catch(()=>false))target=await realpath(join(root,'node_modules')).catch(()=>null);
    if(!target){
      if(await lstat(join(deps,'.complete')).then(()=>true).catch(()=>false))target=deps;
      else{
        await run('npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund','--cache',join(stage,'npm-cache')],{cwd:source,timeout:300000});
        await rm(deps,{recursive:true,force:true});await rename(join(source,'node_modules'),deps);await writeFile(join(deps,'.complete'),'1');target=deps;
      }
    }
    await symlink(target,join(source,'node_modules'),'dir');
    await rm(release,{recursive:true,force:true});await rename(source,release);return release;
  }finally{await rm(stage,{recursive:true,force:true});}
}
export async function readState(root){
  const file=join(root,'.astral-updates','state.json');
  try{const s=JSON.parse(await readFile(file,'utf8'));if(!(validSha(s.sha)||(s.sha===null&&s.release===null))||!(s.release===null||s.release===s.sha)||!(s.previous===null||validSha(s.previous))||!(s.failed===null||validSha(s.failed)))throw new Error();if(s.transition!==undefined&&!validSha(s.transition))throw new Error();return s;}
  catch(e){if(e.code!=='ENOENT')throw new Error('自動更新の記録が不正です。');const sha=(await readFile(join(root,'.astral-commit'),'utf8').catch(()=>'' )).trim();return {sha:validSha(sha)?sha:null,release:null,previous:null,failed:null};}
}
export async function writeState(root,state){const home=join(root,'.astral-updates');await mkdir(home,{recursive:true,mode:0o700});const temp=join(home,'state.tmp');await writeFile(temp,JSON.stringify(state),{mode:0o600});await rename(temp,join(home,'state.json'));}
export function releasePath(root,state){return state.release?join(root,'.astral-updates',state.release):root;}
export async function snapshotData(root){
  const backup=join(root,'.astral-updates','data-backup');await rm(backup,{recursive:true,force:true});
  const data=join(root,'data');let exists=true;
  try{await lstat(data);}catch(e){if(e.code==='ENOENT')exists=false;else throw e;}
  if(exists){async function safe(path){const st=await lstat(path);if(st.isSymbolicLink()||(!st.isFile()&&!st.isDirectory()))throw new Error('保存データにリンク・特殊ファイルがあります。');if(st.isDirectory())for(const name of await readdir(path))await safe(join(path,name));}await safe(data);await cp(data,backup,{recursive:true,preserveTimestamps:true});}
  await writeFile(join(root,'.astral-updates','data-backup-exists'),exists?'1':'0',{mode:0o600});return backup;
}
export async function restoreData(root){
  const home=join(root,'.astral-updates'),exists=await readFile(join(home,'data-backup-exists'),'utf8');
  if(!['0','1'].includes(exists))throw new Error('保存データの控えが不正です。');
  if(exists==='1' && !(await lstat(join(home,'data-backup'))).isDirectory())throw new Error('保存データの控えが見つかりません。');
  // Rename the failed startup's data away; do not delete the only backup.
  const data=join(root,'data'),failed=join(home,'failed-data');await rm(failed,{recursive:true,force:true});
  await rename(data,failed).catch(e=>{if(e.code!=='ENOENT')throw e;});
  if(exists==='1')await cp(join(home,'data-backup'),data,{recursive:true,preserveTimestamps:true});
}
export async function cleanup(root,state){
  const home=join(root,'.astral-updates'),keep=new Set([state.release,state.previous].filter(Boolean)),deps=new Set();
  for(const sha of keep){const path=await realpath(join(home,sha,'node_modules')).catch(()=>null);if(path)deps.add(path);}
  for(const name of await readdir(home)){if((validSha(name)&&!keep.has(name)) || (name.startsWith('deps-')&&!deps.has(resolve(home,name))) || name.startsWith('stage-'))await rm(join(home,name),{recursive:true,force:true});}
  for(const name of ['data-backup','data-backup-exists','failed-data'])await rm(join(home,name),{recursive:true,force:true});
}
