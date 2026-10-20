import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {backupBundles,MAX_ZIP} from '../src/backups.js';
test('ZIP is readable by an independent parser, keeps UTF-8 TXT and safe distinct filenames',()=>{
  const files=backupBundles([{name:'../../秘密PC',txt:'日本語の秘密\nUTF-8'},{name:'../../秘密PC',txt:'second'}]);assert.equal(files.length,1);
  const result=spawnSync('python',['-c','import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({n:z.read(n).decode("utf-8") for n in z.namelist()}))'],{input:files[0].data,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);const entries=JSON.parse(result.stdout);assert.equal(Object.keys(entries).length,2);assert.ok(Object.keys(entries).every(n=>!n.includes('/')&&!n.includes('..')));assert.deepEqual(Object.values(entries),['日本語の秘密\nUTF-8','second']);
});
test('ZIP parts stay bounded with all 100 maximum-size PCs and no files are lost',()=>{
  const files=backupBundles(Array.from({length:100},(_,n)=>({name:`PC${n}`,txt:'x'.repeat(256*1024)})));assert.ok(files.length>1&&files.length<=5);assert.equal(files.reduce((n,f)=>n+f.count,0),100);assert.ok(files.every(f=>f.data.length<=MAX_ZIP));assert.throws(()=>backupBundles([]));assert.throws(()=>backupBundles([{name:'PC',txt:'x'.repeat(256*1024+1)}]));
});

test('a backup plan keeps only bounded statistics and a digest while individual parts remain valid ZIPs',async()=>{
  const {prepareBackups}=await import('../src/backups.js');
  const characters=Array.from({length:4},(_,index)=>({id:`pc-${index}`,ownerId:'PRIVATE OWNER',name:'秘密PC'+index,txt:('本文🪐'+index).repeat(50)}));
  const prepared=prepareBackups(characters,1024);assert.ok(prepared.plan.parts.length>1);assert.equal(prepared.plan.totalCount,4);
  const stored=JSON.stringify(prepared.plan);assert.ok(!/本文|秘密PC|PRIVATE OWNER|pc-0/.test(stored));assert.equal(prepared.plan.signature.length,64);
  const restored=[];
  for(let index=0;index<prepared.plan.parts.length;index++){
    const file=prepared.part(index);assert.equal(file.data.length,prepared.plan.parts[index].bytes);assert.ok(file.data.length<=1024);
    const result=spawnSync('python',['-c','import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps([z.read(n).decode("utf-8") for n in z.namelist()]))'],{input:file.data,encoding:'utf8'});assert.equal(result.status,0,result.stderr);restored.push(...JSON.parse(result.stdout));
  }
  assert.deepEqual(restored,characters.map(c=>c.txt));
});
test('backup signatures detect content, identity, scope, ordering and upload budget changes',async()=>{
  const {prepareBackups}=await import('../src/backups.js'),characters=[{id:'one',name:'A',ownerId:'owner',panelId:'panel',url:'https://iachara.com/view/1',updatedAt:1,txt:'SAME SIZE'},{id:'two',name:'B',txt:'second'}];
  const original=prepareBackups(characters,1024).plan.signature;assert.equal(prepareBackups(structuredClone(characters),1024).plan.signature,original);
  for(const change of [{txt:'DIFFERENT'},{name:'changed'},{id:'changed'},{ownerId:'changed'},{panelId:'changed'},{url:'https://iachara.com/view/2'},{updatedAt:2}])assert.notEqual(prepareBackups([{...characters[0],...change},characters[1]],1024).plan.signature,original);
  assert.notEqual(prepareBackups([...characters].reverse(),1024).plan.signature,original);assert.notEqual(prepareBackups(characters,1023).plan.signature,original);
});
test('backup planning rejects an unfittable record before building a ZIP and validates requested parts',async()=>{
  const {prepareBackups}=await import('../src/backups.js'),characters=[{name:'A',txt:'本文'}],size=prepareBackups(characters).plan.parts[0].bytes;
  assert.equal(prepareBackups(characters,size).part(0).data.length,size);assert.throws(()=>prepareBackups(characters,size-1),/送信上限/);
  for(const limit of [0,-1,1.5,MAX_ZIP+1,Infinity])assert.throws(()=>prepareBackups(characters,limit));
  const prepared=prepareBackups(characters);for(const part of [-1,0.5,1,'0',NaN])assert.throws(()=>prepared.part(part));
  characters[0].txt='mutated';assert.ok(prepared.part(0).data.includes(Buffer.from('本文')));
});

test('cooperative ZIP generation lets another task run and produces byte-identical output',async()=>{
  const {prepareBackups}=await import('../src/backups.js'),characters=Array.from({length:4},(_,n)=>({name:`PC${n}`,txt:'本文🪐'.repeat(300)})),prepared=prepareBackups(characters);let heartbeat=false;
  setImmediate(()=>{heartbeat=true;});const asynchronous=await prepared.partAsync(0);assert.equal(heartbeat,true);assert.deepEqual(asynchronous,prepared.part(0));
  await assert.rejects(prepared.partAsync(-1),/ZIP/);
});
test('cooperative generation retains the original snapshot even if its input records are edited during a yield',async()=>{
  const {prepareBackups}=await import('../src/backups.js'),characters=[{name:'PC',txt:'ORIGINAL'}],prepared=prepareBackups(characters);
  const pending=prepared.partAsync(0);characters[0].txt='MUTATED';const file=await pending;assert.ok(file.data.includes(Buffer.from('ORIGINAL')));assert.ok(!file.data.includes(Buffer.from('MUTATED')));
});
