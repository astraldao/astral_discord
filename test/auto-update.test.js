import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile,symlink,realpath,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {githubHead,validSha,dependencyHash,intervalMs,validateArchive,validateSource,runFile,prepareRelease,readState,writeState,snapshotData,restoreData,cleanup} from '../scripts/auto-update.js';
import {launchWorker,requestStop,switchRelease,recoverTransition} from '../scripts/supervisor.js';
import {updateBusy,createUpdateLifecycle} from '../src/update-lifecycle.js';
const old='a'.repeat(40),fresh='b'.repeat(40),other='c'.repeat(40);
const state={sha:old,release:null,previous:null,failed:null};
async function temp(t){const root=await mkdtemp(join(tmpdir(),'astral-update-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
async function fixture(root){
  for(const name of ['src','scripts','assets','dictionaries'])await mkdir(join(root,name),{recursive:true});
  await writeFile(join(root,'index.js'),'// --worker\nexport {};');
  await writeFile(join(root,'package.json'),JSON.stringify({type:'module',version:'1.0.0'}));
  await writeFile(join(root,'package-lock.json'),JSON.stringify({lockfileVersion:3}));
  await writeFile(join(root,'src','index.js'),'export {};');
}
test('fixed repository head is validated and polling interval cannot flood GitHub',async()=>{
  assert.equal(await githubHead({fetcher:async(url,options)=>{assert.match(url,/astraldao\/astral_discord\/git\/ref\/heads\/main$/);assert.equal(options.redirect,'error');return {ok:true,text:async()=>JSON.stringify({object:{sha:fresh}})};}}),fresh);
  for(const value of ['../main','x'.repeat(40),null,'A'.repeat(40)])assert.equal(validSha(value),false);
  await assert.rejects(githubHead({fetcher:async()=>({ok:true,text:async()=>JSON.stringify({object:{sha:'main'}})})}));
  await assert.rejects(githubHead({fetcher:async()=>({ok:false})}));
  assert.equal(intervalMs('60'),60000);assert.equal(intervalMs('3600'),3600000);for(const v of ['1','3601','NaN','-1','60;evil',undefined])assert.equal(intervalMs(v),300000);
});
test('archive traversal, symlinks, special files, mismatched listings and expansion are rejected',()=>{
  const names='repo/\nrepo/index.js\n',types='drwxr-xr-x root/root 0 2026-01-01 00:00 repo/\n-rw-r--r-- root/root 12 2026-01-01 00:00 repo/index.js\n';
  assert.doesNotThrow(()=>validateArchive(names,types));
  for(const bad of ['repo/\nrepo/../x\n','repo/\n/absolute\n','repo/\nother/x\n','repo/\nrepo/x\\y\n','repo/\nrepo/./x\n'])assert.throws(()=>validateArchive(bad,types));
  for(const type of ['l','b','p'])assert.throws(()=>validateArchive(names,types.replace('-rw-r--r--',`${type}rw-r--r--`)));
  assert.throws(()=>validateArchive(names,types.replace(' 12 ',' 67108865 ')));assert.throws(()=>validateArchive(names,types.split('\n')[0]));
});
test('candidate requires worker protocol and source syntax; links are never executable',async t=>{
  const root=await temp(t);await fixture(root);await validateSource(root);
  await writeFile(join(root,'src','bad.js'),'let = ;');await assert.rejects(validateSource(root));await rm(join(root,'src','bad.js'));
  await symlink('/tmp',join(root,'scripts','link'));await assert.rejects(validateSource(root));await rm(join(root,'scripts','link'));
  await writeFile(join(root,'index.js'),'export {};');await assert.rejects(validateSource(root));
});
test('fixed argument subprocess times out and rejects failures without a shell',async()=>{
  assert.equal(await runFile(process.execPath,['-e','process.stdout.write(process.argv[1])','$(not-a-shell)'],{capture:true}),'$(not-a-shell)');
  await assert.rejects(runFile(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:50,capture:true}));
  await assert.rejects(runFile(process.execPath,['-e','process.exit(1)'],{capture:true}));
  const abort=new AbortController();abort.abort();await assert.rejects(runFile(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:abort.signal,capture:true}));
});
test('state validates paths and atomic save preserves the source commit marker',async t=>{
  const root=await temp(t);assert.equal((await readState(root)).sha,null);await writeFile(join(root,'.astral-commit'),old);assert.equal((await readState(root)).sha,old);
  await writeState(root,state);assert.deepEqual(await readState(root),state);await writeState(root,{...state,release:'../escape'});await assert.rejects(readState(root));
  await writeState(root,{...state,transition:'invalid'});await assert.rejects(readState(root));
});
test('saved data snapshot restores startup migrations without touching secrets or voice files',async t=>{
  const root=await temp(t);await mkdir(join(root,'.astral-updates'));await mkdir(join(root,'data'));await writeFile(join(root,'data','wallet.json'),'old',{mode:0o600});await writeFile(join(root,'.env'),'secret');
  await snapshotData(root);await writeFile(join(root,'data','wallet.json'),'migration');await writeFile(join(root,'data','new.json'),'new');await restoreData(root);
  assert.equal(await readFile(join(root,'data','wallet.json'),'utf8'),'old');await assert.rejects(access(join(root,'data','new.json')));assert.equal(await readFile(join(root,'.env'),'utf8'),'secret');
  await symlink('/tmp',join(root,'data','link'));await assert.rejects(snapshotData(root));
});
test('rollback also handles a data directory created during the first startup',async t=>{
  const root=await temp(t);await mkdir(join(root,'.astral-updates'));await snapshotData(root);await mkdir(join(root,'data'));await writeFile(join(root,'data','migration'),'x');await restoreData(root);await assert.rejects(access(join(root,'data')));
});
test('busy checks protect active operations, voice queue, paid hands and free games',()=>{
  assert.equal(updateBusy(),false);assert.equal(updateBusy({active:1}),true);assert.equal(updateBusy({pending:1}),true);
  assert.equal(updateBusy({accounts:[{pending:{expires:101}}],now:100}),true);assert.equal(updateBusy({accounts:[{pending:{expires:100}}],now:100}),false);
  assert.equal(updateBusy({accounts:[{work:{ticket:{expires:101}}}],now:100}),true);
  for(const session of [{game:{phase:'playing'}},{busy:true},{view:'watch'},{view:'playing'},{view:'claim'}])assert.equal(updateBusy({sessions:[{sessions:new Map([['x',{...session,expires:101}]])}],now:100}),true);
  assert.equal(updateBusy({sessions:[{sessions:new Map([['x',{game:{phase:'done'},expires:101}]])}],now:100}),false);
});
test('prepare freezes intake before awaiting saves and exits only after acknowledgment delivery',async()=>{
  let isBusy=true,freeze=0,exit=null,complete,ack;const replies=[];
  const handler=createUpdateLifecycle({busy:()=>isBusy,freeze:()=>freeze++,drain:()=>new Promise(resolve=>{complete=resolve;}),send:(m,done)=>{replies.push(m);ack=done;},exit:code=>{exit=code;}});
  await handler({type:'prepare-update',id:'1'});assert.equal(replies[0].type,'update-busy');assert.equal(freeze,0);
  isBusy=false;const stop=handler({type:'prepare-update',id:'2'});assert.equal(freeze,1);assert.equal(exit,null);await handler({type:'prepare-update',id:'3'});assert.equal(replies.at(-1).type,'update-busy');complete();await stop;assert.equal(replies.at(-1).type,'update-stopped');assert.equal(exit,null);ack();assert.equal(exit,0);
});
test('worker stop busy response keeps the current worker running',async()=>{
  const child=new EventEmitter();child.connected=true;child.send=m=>queueMicrotask(()=>child.emit('message',{type:'update-busy',id:m.id}));assert.equal(await requestStop({child}),false);assert.equal(child.listenerCount('message'),0);
  child.send=()=>{};await assert.rejects(requestStop({child},{timeout:10}));assert.equal(child.listenerCount('message'),0);
});
test('actual IPC worker waits for activation and drains before exiting',async t=>{
  const root=await temp(t);await writeFile(join(root,'index.js'),`process.send({type:'worker-ready'});process.on('message',m=>{if(m.type==='activate')console.log('active');if(m.type==='prepare-update')process.send({type:'update-stopped',id:m.id},()=>process.exit(0));});`);
  const worker=launchWorker(root,root,{timeout:2000});t.after(()=>worker.child.kill('SIGKILL'));await worker.ready;worker.child.send({type:'activate'});assert.equal(await requestStop(worker),true);assert.equal((await worker.exited).code,0);
});
function fakeWorker({bad=false,onLaunch=()=>{}}={}){let end;const exited=new Promise(resolve=>{end=resolve;});onLaunch();return {ready:bad?Promise.reject(new Error('startup failure')):Promise.resolve(),exited,child:{messages:[],send(m){this.messages.push(m);},kill(){end({code:1});}}};}
test('successful activation persists commit before exposing the new worker to interactions',async t=>{
  const root=await temp(t);await mkdir(join(root,'.astral-updates'));const worker=fakeWorker();const result=await switchRelease(root,state,join(root,'.astral-updates',fresh),{launch:()=>worker});assert.equal(result.state.sha,fresh);assert.equal((await readState(root)).sha,fresh);assert.deepEqual(worker.child.messages,[{type:'activate'}]);
});
test('startup failure kills the candidate, restores migrated data and activates the old version',async t=>{
  const root=await temp(t);await mkdir(join(root,'.astral-updates'));await mkdir(join(root,'data'));await writeFile(join(root,'data','wallet'),'3000');let launches=0;
  const result=await switchRelease(root,state,join(root,'.astral-updates',fresh),{launch:(data,source)=>{assert.equal(data,root);launches++;if(launches===1){assert.equal(source,join(root,'.astral-updates',fresh));const worker=fakeWorker();worker.ready=writeFile(join(root,'data','wallet'),'migration').then(()=>{throw new Error('migration startup failure');});return worker;}assert.equal(source,root);return fakeWorker();}});
  assert.equal(launches,2);assert.equal(result.state.sha,old);assert.equal(result.state.failed,fresh);assert.equal(await readFile(join(root,'data','wallet'),'utf8'),'3000');assert.equal(result.worker.child.messages[0].type,'activate');
});
test('release preparation pins a SHA, checks syntax and shares unchanged dependencies',async t=>{
  const root=await temp(t);await fixture(root);await mkdir(join(root,'node_modules'));const archiveRoot=join(root,'archive');await fixture(join(archiveRoot,'repo'));const archive=join(root,'repo.tar.gz');await runFile('tar',['-czf',archive,'-C',archiveRoot,'repo']);
  let npm=false;const release=await prepareRelease(root,fresh,{run:async(command,args,options)=>{if(command==='curl'){assert.ok(args.includes(`https://codeload.github.com/astraldao/astral_discord/tar.gz/${fresh}`));await writeFile(args.at(-1),await readFile(archive));return '';}if(command==='npm'){npm=true;throw new Error('unnecessary npm');}return runFile(command,args,options);}});
  assert.equal(release,join(root,'.astral-updates',fresh));assert.equal(npm,false);assert.equal(await realpath(join(release,'node_modules')),join(root,'node_modules'));
});
test('cleanup retains current and previous releases and their dependency trees',async t=>{
  const root=await temp(t),home=join(root,'.astral-updates');for(const name of [old,fresh,other,'deps-keep','deps-stale','stage-stale','data-backup'])await mkdir(join(home,name),{recursive:true});await symlink(join(home,'deps-keep'),join(home,fresh,'node_modules'));await writeFile(join(home,'state.json'),'state');await cleanup(root,{...state,release:fresh,previous:old});await access(join(home,old));await access(join(home,fresh));await access(join(home,'deps-keep'));assert.equal(await readFile(join(home,'state.json'),'utf8'),'state');for(const name of [other,'deps-stale','stage-stale','data-backup'])await assert.rejects(access(join(home,name)));
});

test('version-only commits reuse dependencies while package integrity changes do not',()=>{
 const lock={version:'3.22.0',lockfileVersion:3,packages:{'':{version:'3.22.0',dependencies:{x:'1.0.0'}},'node_modules/x':{version:'1.0.0',integrity:'old'}}};
 const newer=structuredClone(lock);newer.version='3.23.0';newer.packages[''].version='3.23.0';assert.equal(dependencyHash(JSON.stringify(lock)),dependencyHash(JSON.stringify(newer)));
 newer.packages['node_modules/x'].integrity='new';assert.notEqual(dependencyHash(JSON.stringify(lock)),dependencyHash(JSON.stringify(newer)));
});
test('interrupted startup restores the snapshot and rejects the unfinished commit on the next boot',async t=>{
 const root=await temp(t);await mkdir(join(root,'.astral-updates'));await mkdir(join(root,'data'));await writeFile(join(root,'data','wallet'),'3000');await snapshotData(root);await writeFile(join(root,'data','wallet'),'migration');await writeState(root,{...state,transition:fresh});const result=await recoverTransition(root,await readState(root));assert.equal(result.sha,old);assert.equal(result.failed,fresh);assert.equal(result.transition,undefined);assert.equal(await readFile(join(root,'data','wallet'),'utf8'),'3000');assert.deepEqual(await readState(root),result);
});
test('dependency installation failure removes staging and never edits the running application',async t=>{
 const root=await temp(t);await fixture(root);await mkdir(join(root,'node_modules'));await writeFile(join(root,'.env'),'secret');const archiveRoot=join(root,'archive');await fixture(join(archiveRoot,'repo'));await writeFile(join(archiveRoot,'repo','package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{'node_modules/x':{version:'2.0.0'}}}));const archive=join(root,'repo.tar.gz');await runFile('tar',['-czf',archive,'-C',archiveRoot,'repo']);let installed=false;
 await assert.rejects(prepareRelease(root,fresh,{run:async(command,args,options)=>{if(command==='curl'){await writeFile(args.at(-1),await readFile(archive));return '';}if(command==='npm'){installed=true;assert.ok(args.includes('--ignore-scripts'));throw new Error('installation failed');}return runFile(command,args,options);}}));assert.equal(installed,true);assert.equal(await readFile(join(root,'.env'),'utf8'),'secret');assert.equal(await readFile(join(root,'src','index.js'),'utf8'),'export {};');await assert.rejects(access(join(root,'.astral-updates',fresh)));
});
test('missing rollback snapshot fails closed and preserves the startup data',async t=>{
 const root=await temp(t);await mkdir(join(root,'.astral-updates'));await mkdir(join(root,'data'));await writeFile(join(root,'data','wallet'),'3000');await writeFile(join(root,'.astral-updates','data-backup-exists'),'1');await assert.rejects(restoreData(root));assert.equal(await readFile(join(root,'data','wallet'),'utf8'),'3000');
});
