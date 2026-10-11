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
