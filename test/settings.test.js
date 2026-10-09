import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SettingsStore,validateSettings} from '../src/settings.js';
const defaults=()=>({version:1,lobbyId:null,targetIds:[],seconds:5,voice:true,enforce:true,panel:null});
test('settings survive restart and parallel admin changes do not overwrite each other',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'astral-settings-'));
  try {
    const path=join(dir,'data/settings.json');const store=new SettingsStore(path,defaults());await store.load();
    await Promise.all([store.update(c=>{c.lobbyId='123456789012345678';}),store.update(c=>{c.targetIds.push('223456789012345678');}),store.update(c=>{c.seconds=8;})]);
    const reload=new SettingsStore(path,defaults());await reload.load();
    assert.equal(reload.get().lobbyId,'123456789012345678');assert.deepEqual(reload.get().targetIds,['223456789012345678']);assert.equal(reload.get().seconds,8);
    const copy=store.get();copy.targetIds.length=0;assert.equal(store.get().targetIds.length,1);
    await assert.rejects(store.update(c=>{c.seconds=100;}));
    assert.equal(store.get().seconds,8);assert.equal(JSON.parse(await readFile(path,'utf8')).seconds,8);
    await store.update(c=>{c.voice=false;});assert.equal(store.get().voice,false);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('corrupt persisted config fails visibly instead of silently resetting',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'astral-corrupt-'));
  try {const path=join(dir,'settings.json');await writeFile(path,'{bad json');await assert.rejects(new SettingsStore(path,defaults()).load());}
  finally{await rm(dir,{recursive:true,force:true});}
});
test('duplicate destinations and lobby as destination are rejected',()=>{
  const c=defaults();c.targetIds=['123456789012345678','123456789012345678'];assert.throws(()=>validateSettings(c));
  c.targetIds.pop();c.lobbyId=c.targetIds[0];assert.throws(()=>validateSettings(c));
});
