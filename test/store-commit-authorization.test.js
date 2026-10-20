import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SettingsStore} from '../src/settings.js';
import {TrpgStore} from '../src/trpg-store.js';

const defaults=()=>({version:1,lobbyId:null,targetIds:[],seconds:5,voice:true,enforce:true});
async function fixture(kind,run){
  const dir=await fs.mkdtemp(join(tmpdir(),`astral-commit-${kind}-`)),path=join(dir,'data.json');
  try{
    const store=kind==='settings'?new SettingsStore(path,defaults()):new TrpgStore(path);
    await store.update(()=>{});
    const change=data=>{if(kind==='settings')data.seconds=7;else data.scenarios.push({id:'new-base',name:'new base',url:'https://ccfolia.com/rooms/new'});};
    await run({dir,path,store,change,before:store.get(),raw:await fs.readFile(path,'utf8')});
  }finally{await fs.rm(dir,{recursive:true,force:true});}
}
async function replaceIo(method,wrap,run){
  const original=fs[method];fs[method]=wrap(original);syncBuiltinESMExports();
  try{return await run();}finally{fs[method]=original;syncBuiltinESMExports();}
}
async function unchanged(f){
  assert.equal(await fs.readFile(f.path,'utf8'),f.raw);assert.deepEqual(f.store.get(),f.before);assert.deepEqual(await fs.readdir(f.dir),['data.json']);
}

for(const kind of ['settings','trpg'])for(const invalidation of ['rights','generation'])test(`${kind} rejects ${invalidation} invalidation after a real staged write and preserves its queue`,()=>fixture(kind,async f=>{
  let allowed=true,generation=1,staged;
  const check=async()=>{if(!allowed||generation!==1)throw new Error('authorization changed');};
  await replaceIo('writeFile',actual=>async(path,...args)=>{
    await actual(path,...args);staged=path;
    if(invalidation==='rights')allowed=false;else generation=2;
  },async()=>{
    await assert.rejects(f.store.update(f.change,check),/authorization changed/);
    assert.ok(staged&&staged!==f.path);await unchanged(f);
  });
  allowed=true;generation=1;await f.store.update(f.change,check);
  assert.notDeepEqual(f.store.get(),f.before);assert.deepEqual(await fs.readdir(f.dir),['data.json']);
}));

for(const kind of ['settings','trpg'])test(`${kind} uses a private exclusive unique staging file without touching a legacy sibling`,()=>fixture(kind,async f=>{
  const legacy=f.path+'.tmp';await fs.writeFile(legacy,'unrelated legacy sibling');const staged=[];
  await replaceIo('writeFile',actual=>async(path,data,options)=>{
    assert.notEqual(path,legacy);assert.equal(options.flag,'wx');assert.equal(options.mode,0o600);
    await actual(path,data,options);staged.push(path);assert.equal((await fs.stat(path)).mode&0o777,0o600);
  },async()=>{await f.store.update(f.change);await f.store.update(()=>{});});
  assert.equal(staged.length,2);assert.equal(new Set(staged).size,2);assert.equal(await fs.readFile(legacy,'utf8'),'unrelated legacy sibling');assert.deepEqual((await fs.readdir(f.dir)).sort(),['data.json','data.json.tmp']);
}));

for(const kind of ['settings','trpg'])for(const failure of ['writeFile','rename'])test(`${kind} rolls back memory and disk and cleans staging after ${failure} failure`,()=>fixture(kind,async f=>{
  await replaceIo(failure,actual=>async(...args)=>{
    if(failure==='writeFile')await actual(args[0],'partial write',args[2]);
    throw Object.assign(new Error('PRIVATE_FILESYSTEM_PATH'),{code:'EIO'});
  },async()=>{
    await assert.rejects(f.store.update(f.change));await unchanged(f);
  });
  await f.store.update(f.change);assert.notDeepEqual(f.store.get(),f.before);assert.deepEqual(await fs.readdir(f.dir),['data.json']);
}));

for(const kind of ['settings','trpg'])test(`${kind} refuses invalid input and initial authorization without writing, then saves valid queued changes`,()=>fixture(kind,async f=>{
  let writes=0;
  await replaceIo('writeFile',actual=>async(...args)=>{writes++;return actual(...args);},async()=>{
    await assert.rejects(f.store.update(f.change,async()=>{throw new Error('denied');}),/denied/);
    if(kind==='settings')await assert.rejects(f.store.update(c=>{c.seconds=100;}));else assert.throws(()=>f.store.saveTable(null,'',''));
    assert.equal(writes,0);await unchanged(f);
  });
  await Promise.all([f.store.update(f.change),f.store.update(data=>{if(kind==='settings')data.voice=false;else data.panels.push({id:'panel',channelId:'channel',messageId:null,mode:'secret'});})]);
  const reload=kind==='settings'?new SettingsStore(f.path,defaults()):new TrpgStore(f.path);await reload.load();assert.deepEqual(reload.get(),f.store.get());assert.deepEqual(await fs.readdir(f.dir),['data.json']);
}));
