import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink,readdir,truncate} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createUpdateCapacity,updateSourceBytes,updateCapacityFields} from '../src/update-capacity.js';
import {dependencyHash} from '../scripts/auto-update.js';
import {createVersionController,versionScreen} from '../src/version-ui.js';
const old='a'.repeat(40),target='b'.repeat(40),next='c'.repeat(40),MiB=1024*1024;
const lock=(version='4.2.0',dependency='1')=>JSON.stringify({version,lockfileVersion:3,packages:{'':{version},'node_modules/example':{version:dependency}}});
const blob=(path,size=10)=>({path,size,type:'blob',mode:'100644'});
const tree=()=>({truncated:false,tree:[blob('package.json'),blob('package-lock.json'),blob('index.js'),{path:'assets',type:'tree',mode:'040000'},blob('assets/image.png',4096)]});
const data=()=>({supported:true,current:{sha:old,version:'4.2.0'},latest:{sha:target,version:'4.3.0'},phase:'idle',checkedAt:100000});
async function fixture(t,{remoteLock=lock('4.3.0'),head=true,fetcher}={}){
  const root=await mkdtemp(join(tmpdir(),'astral-capacity-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'node_modules'));await mkdir(join(root,'data'));await writeFile(join(root,'package-lock.json'),lock());await writeFile(join(root,'data','settings.json'),'PRIVATE_DATA');await writeFile(join(root,'.env'),'PRIVATE_ENV');
  const calls=[];let time=100000;
  const fetch=async(url,options)=>{calls.push({url,options});assert.equal(options.redirect,'error');assert.ok(options.signal);if(fetcher)return fetcher(url,options);if(url.includes('/git/trees/'))return Response.json(tree());if(options.method==='HEAD')return new Response(null,{headers:head?{'content-length':'1024'}:{}});return new Response(remoteLock);};
  const estimate=createUpdateCapacity({root,fetcher:fetch,now:()=>time});return {root,calls,estimate,advance:ms=>time+=ms};
}
test('tree size counts bounded regular files only and rejects incomplete or ambiguous metadata',()=>{
  assert.equal(updateSourceBytes(tree()),4126);
  for(const change of [v=>v.truncated=true,v=>delete v.truncated,v=>v.tree.push(blob('package.json')),v=>v.tree.push(blob('../secret')),v=>v.tree.push({...blob('link'),mode:'120000'}),v=>v.tree.push({...blob('module'),type:'commit',mode:'160000'}),v=>v.tree[0].size=-1,v=>v.tree[0].size=64*MiB,v=>v.tree=v.tree.slice(1),v=>v.tree=Array.from({length:10001},(_,n)=>blob('file'+n))]){const value=tree();change(value);assert.throws(()=>updateSourceBytes(value));}
});
test('manual estimates pin metadata to the target, use archive HEAD only and reuse unchanged dependencies',async t=>{
  const f=await fixture(t),before=await readdir(f.root),value=await f.estimate(data());
  assert.equal(value.targetSha,target);assert.equal(value.currentSha,old);assert.equal(value.sourceBytes,4126);assert.equal(value.archiveBytes,1024);assert.equal(value.dependencies,'reuse');assert.equal(value.dataBackupBytes,12);assert.ok(Number.isSafeInteger(value.freeBytes));
  assert.equal(f.calls.length,3);for(const call of f.calls)assert.ok(call.url.includes(target));assert.equal(f.calls.find(c=>c.url.includes('codeload')).options.method,'HEAD');assert.deepEqual(await readdir(f.root),before);assert.ok(!JSON.stringify(value).includes('PRIVATE'));assert.ok(!JSON.stringify(value).includes(f.root));
});
test('changed dependencies are explicit unknown size, while an existing updater cache is reused',async t=>{
  const remote=lock('4.3.0','2'),f=await fixture(t,{remoteLock:remote});assert.equal((await f.estimate(data())).dependencies,'install');
  const cache=join(f.root,'.astral-updates',`deps-${dependencyHash(remote)}`);await mkdir(cache,{recursive:true});await writeFile(join(cache,'.complete'),'1');f.advance(30000);assert.equal((await f.estimate(data())).dependencies,'install');
  const release=join(f.root,'.astral-updates',old);await mkdir(release);await symlink(cache,join(release,'node_modules'));await writeFile(join(f.root,'.astral-updates','state.json'),JSON.stringify({sha:old,release:old,previous:null,failed:null}));f.advance(30000);assert.equal((await f.estimate(data())).dependencies,'reuse');
});
test('missing local modules do not falsely promise dependency reuse',async t=>{
  const f=await fixture(t);await rm(join(f.root,'node_modules'),{recursive:true});assert.equal((await f.estimate(data())).dependencies,'install');
});
test('missing archive length stays unknown without downloading it or hiding the other measurements',async t=>{
  const f=await fixture(t,{head:false}),value=await f.estimate(data());assert.equal(value.archiveBytes,null);assert.equal(value.sourceBytes,4126);const fields=updateCapacityFields({data:data(),capacity:value});assert.ok(JSON.stringify(fields).includes('取得上限20 MiB'));assert.ok(JSON.stringify(fields).includes('再利用予定'));assert.ok(JSON.stringify(fields).includes('200 MiB'));assert.ok(JSON.stringify(fields).includes('契約上限'));
});
test('failed remote metadata never exposes native details and leaves local measurements available',async t=>{
  const f=await fixture(t,{fetcher:async()=>{throw new Error('PRIVATE_NATIVE /srv/secret');}}),value=await f.estimate(data());assert.equal(value.sourceBytes,null);assert.equal(value.dependencies,null);assert.equal(value.archiveBytes,null);assert.equal(value.dataBackupBytes,12);assert.ok(Number.isSafeInteger(value.freeBytes));assert.ok(!JSON.stringify(value).includes('PRIVATE_NATIVE'));
});
test('oversized advertised and streamed tree responses are cancelled and never parsed',async t=>{
  for(const advertised of [true,false]){
    let cancelled=0;
    const f=await fixture(t,{fetcher:async(url,options)=>{if(!url.includes('/git/trees/'))return options.method==='HEAD'?new Response(null):new Response(lock());return new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(2*MiB+1));},cancel(){cancelled++;}}),{headers:advertised?{'content-length':String(2*MiB+1)}:{}});}});
    const value=await f.estimate(data());assert.equal(value.sourceBytes,null);assert.ok(cancelled>=1);
  }
});
test('invalid dependency metadata and a symlinked local lock cannot read unrelated files',async t=>{
  const invalid=await fixture(t,{remoteLock:'{}'});assert.equal((await invalid.estimate(data())).dependencies,null);
  const f=await fixture(t);await rm(join(f.root,'package-lock.json'));await symlink(join(f.root,'.env'),join(f.root,'package-lock.json'));assert.equal((await f.estimate(data())).dependencies,'install');
});
test('data scanning refuses links and oversized files and treats an absent directory as empty',async t=>{
  for(const kind of ['link','large','missing']){
    const f=await fixture(t);if(kind==='link')await symlink(join(f.root,'.env'),join(f.root,'data','secret'));if(kind==='large')await truncate(join(f.root,'data','settings.json'),64*MiB+1);if(kind==='missing')await rm(join(f.root,'data'),{recursive:true});
    assert.equal((await f.estimate(data())).dataBackupBytes,kind==='missing'?0:null);
  }
});
test('same version and active updates never request capacity metadata',async t=>{
  const f=await fixture(t);for(const value of [{...data(),latest:null},{...data(),latest:{sha:old}},{...data(),latest:{sha:'invalid'}},{...data(),phase:'preparing'},{...data(),phase:'switching'}])assert.equal(await f.estimate(value),null);assert.equal(f.calls.length,0);
});
test('capacity network requests share a deadline and a concurrent different target cannot reuse the report',async t=>{
  const f=await fixture(t),first=f.estimate(data());assert.equal(await f.estimate({...data(),latest:{sha:next}}),null);await first;
  let aborted=0;const estimate=createUpdateCapacity({root:f.root,timeout:10,fetcher:async(url,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{aborted++;reject(new Error('PRIVATE_TIMEOUT'));},{once:true});})});
  const [value]=await Promise.all([estimate(data()),new Promise(resolve=>setTimeout(resolve,30))]);assert.equal(aborted,3);assert.equal(value.sourceBytes,null);assert.equal(value.dependencies,null);assert.equal(value.archiveBytes,null);assert.ok(!JSON.stringify(value).includes('PRIVATE_TIMEOUT'));
});
test('concurrent estimates share one job, reports are cloned and the cache expires after thirty seconds',async t=>{
  const f=await fixture(t),[a,b]=await Promise.all([f.estimate(data()),f.estimate(data())]);assert.equal(f.calls.length,3);a.sourceBytes=0;assert.equal(b.sourceBytes,4126);assert.equal((await f.estimate(data())).sourceBytes,4126);assert.equal(f.calls.length,3);f.advance(30000);await f.estimate(data());assert.equal(f.calls.length,6);await f.estimate({...data(),latest:{sha:next}});assert.equal(f.calls.length,9);
});
test('reports never cross current or target versions and UI only formats known numeric values and categories',()=>{
  const capacity={currentSha:old,targetSha:target,sourceBytes:4126,archiveBytes:1024,dataBackupBytes:12,freeBytes:100*MiB,dependencies:'reuse'};
  for(const changed of [{...data(),current:{sha:next}},{...data(),latest:{sha:next}}])assert.ok(JSON.stringify(updateCapacityFields({data:changed,capacity})).includes('未計測'));
  assert.deepEqual(updateCapacityFields({data:{...data(),latest:{sha:old}},capacity}),[]);
  const fields=updateCapacityFields({data:data(),capacity:{...capacity,sourceBytes:'PRIVATE',dependencies:'PRIVATE',freeBytes:Infinity}});assert.ok(!JSON.stringify(fields).includes('PRIVATE'));assert.ok(!JSON.stringify(fields).includes('Infinity'));
  const m=versionScreen({id:'id',turn:0,data:data(),capacity});assert.ok(m.embeds[0].toJSON().fields.every(field=>field.value.length<=1024));assert.ok(m.components.length<=5);assert.deepEqual(m.allowedMentions.parse,[]);
});

function interaction(customId){return {customId,user:{id:'owner'},channelId:'channel',message:{flags:{has:()=>true}},replies:[],async deferUpdate(){this.deferred=true;},async deferReply(){this.deferred=true;},async editReply(p){this.replies.push(p);},async reply(p){this.replied=true;this.replies.push(p);}};}
test('capacity is requested only by explicit check, stays on confirmation and never starts the updater',async()=>{
  const calls=[];let estimates=0,allowed=true,lose=false;const updater={request:async(action)=>{calls.push(action);if(action==='check'&&lose)allowed=false;return data();}},controller=createVersionController({updater,access:async()=>allowed,estimateCapacity:async d=>{estimates++;return {currentSha:d.current.sha,targetSha:d.latest.sha,sourceBytes:4096,dataBackupBytes:12,archiveBytes:1024,dependencies:'reuse',freeBytes:MiB};}});
  await controller.open(interaction());const s=[...controller.sessions.sessions.values()][0],act=async action=>{const i=interaction(`updates:${s.id}:${s.turn}:${action}`);await controller.handle(i);return i;};
  assert.equal(estimates,0);await act('status');assert.equal(estimates,0);await act('check');assert.equal(estimates,1);const confirm=await act('confirm');assert.ok(JSON.stringify(confirm.replies).includes('追加の保存容量'));assert.equal(estimates,1);assert.ok(!calls.includes('start'));
  lose=true;const denied=await act('check');assert.equal(estimates,1);assert.ok(!JSON.stringify(denied.replies).includes('追加の保存容量'));
});
test('permissions, expiry and session replacement after estimation suppress the report',async()=>{
  for(const mode of ['permission','expiry','replacement']){
    let allowed=true,release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);const controller=createVersionController({updater:{request:async()=>data()},access:async()=>allowed,estimateCapacity:async()=>{entered();await gate;return {currentSha:old,targetSha:target,sourceBytes:1234567};}});
    await controller.open(interaction());const s=[...controller.sessions.sessions.values()][0],i=interaction(`updates:${s.id}:${s.turn}:check`),job=controller.handle(i);await started;if(mode==='permission')allowed=false;if(mode==='expiry')s.expires=0;if(mode==='replacement')controller.sessions.sessions.delete(s.id);release();await job;assert.ok(!JSON.stringify(i.replies).includes('追加の保存容量'));
  }
});
test('capacity lookup failure is optional and does not prevent deliberate version confirmation',async()=>{
  const controller=createVersionController({updater:{request:async()=>data()},access:async()=>true,estimateCapacity:async()=>{throw new Error('PRIVATE_PATH');}});await controller.open(interaction());const s=[...controller.sessions.sessions.values()][0];const i=interaction(`updates:${s.id}:${s.turn}:check`);await controller.handle(i);assert.ok(!JSON.stringify(i.replies).includes('PRIVATE_PATH'));await controller.handle(interaction(`updates:${s.id}:${s.turn}:confirm`));assert.equal(s.confirm,true);assert.equal(s.target,target);
});
