import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareBackupSpeech} from '../src/backup-prefetch.js';
const tick=()=>new Promise(r=>setImmediate(r));
test('prepared audio replays cached chunks once and streams later chunks in the same order',async()=>{
  const abort=new AbortController();let chunk,finish;const job=prepareBackupSpeech({text:'本文',signal:abort.signal,synth:{stream:async(_,__,onChunk)=>{chunk=onChunk;onChunk(Buffer.from('first'));await new Promise(r=>finish=r);}}});
  await tick();assert.equal(job.bufferedBytes,5);const read=[],consuming=job.consume(data=>read.push(data.toString()));assert.deepEqual(read,['first']);assert.equal(job.bufferedBytes,0);chunk(Buffer.from('second'));finish();await consuming;assert.deepEqual(read,['first','second']);await assert.rejects(job.consume(()=>{}));job.dispose();
});
test('cancellation releases pending synthesis and buffered audio even when a worker is hung',async()=>{
  const abort=new AbortController();let chunk;const job=prepareBackupSpeech({text:'本文',signal:abort.signal,synth:{stream:async(_,__,onChunk)=>{chunk=onChunk;onChunk(Buffer.alloc(100));await new Promise(()=>{});}}});
  await tick();abort.abort();await assert.rejects(job.done);assert.equal(job.bufferedBytes,0);assert.throws(()=>chunk(Buffer.alloc(10)));await assert.rejects(job.consume(()=>{}));
});
test('disposed and oversized prefetch cannot retain or replay audio',async()=>{
  const abort=new AbortController(),job=prepareBackupSpeech({text:'本文',signal:abort.signal,synth:{stream:async(_,__,onChunk)=>onChunk(Buffer.alloc(8*1024*1024+1))}});await assert.rejects(job.done,/大きすぎ/);job.dispose();assert.equal(job.bufferedBytes,0);
  const pending=prepareBackupSpeech({text:'本文',signal:abort.signal,synth:{stream:async()=>new Promise(()=>{})}});pending.dispose();await assert.rejects(pending.done);await assert.rejects(pending.consume(()=>{}));
});
test('a failed preparation drops partial buffered data without ever replaying it',async()=>{
  const job=prepareBackupSpeech({text:'本文',signal:new AbortController().signal,synth:{stream:async(_,__,chunk)=>{chunk(Buffer.from('partial'));throw new Error('synthesis failed');}}});
  await assert.rejects(job.done,/synthesis failed/);assert.equal(job.bufferedBytes,0);await assert.rejects(job.consume(()=>assert.fail('failed audio must not play')),/synthesis failed/);job.dispose();
});
