import test from 'node:test';
import assert from 'node:assert/strict';
import {BoundedBytes} from '../src/bounded-bytes.js';

test('one-byte fragments reassemble exactly while capacity remains within the byte budget',()=>{
  const maximum=131073,bytes=new BoundedBytes(maximum),expected=Buffer.alloc(maximum),chunk=new Uint8Array(1);
  for(let n=0;n<maximum;n++){chunk[0]=n%251;expected[n]=chunk[0];bytes.append(chunk);assert.ok(bytes.capacity<=maximum);}
  assert.equal(bytes.length,maximum);assert.deepEqual(bytes.finish(),expected);assert.equal(bytes.capacity,0);assert.equal(bytes.length,0);
});
test('empty and short responses allocate on demand and return only initialized bytes',()=>{
  const empty=new BoundedBytes(4*1024*1024);empty.append(new Uint8Array(0));assert.equal(empty.capacity,0);assert.deepEqual(empty.finish(),Buffer.alloc(0));
  const short=new BoundedBytes(4*1024*1024);short.append(Buffer.from('hello'));assert.ok(short.capacity<4*1024*1024);const result=short.finish();assert.equal(result.length,5);assert.equal(result.toString(),'hello');assert.equal(result.buffer.byteLength,5);
});
test('mixed fragment lengths preserve boundaries and overflow is rejected before changing prior data',()=>{
  const bytes=new BoundedBytes(100000),expected=Buffer.alloc(70003,7);
  for(const chunk of [expected.subarray(0,1),expected.subarray(1,16000),expected.subarray(16000,65537),expected.subarray(65537)])bytes.append(chunk);
  assert.throws(()=>bytes.append(Buffer.alloc(30000)),e=>e.code==='RESPONSE_LIMIT');assert.equal(bytes.length,70003);assert.ok(bytes.capacity<=100000);assert.deepEqual(bytes.finish(),expected);
});
test('input bytes are copied immediately, so reused input storage cannot alter earlier fragments',()=>{
  const bytes=new BoundedBytes(100),chunk=Uint8Array.of(1,2);bytes.append(chunk);chunk.fill(9);bytes.append(chunk);chunk.fill(0);assert.deepEqual(bytes.finish(),Buffer.from([1,2,9,9]));
});
test('invalid inputs and budgets fail closed and disposal releases storage without allowing reuse',()=>{
  for(const value of [0,-1,1.5,NaN,Infinity,32*1024*1024+1])assert.throws(()=>new BoundedBytes(value));
  const bytes=new BoundedBytes(10);for(const value of [null,undefined,'secret',[1,2],new DataView(new ArrayBuffer(2))])assert.throws(()=>bytes.append(value));assert.equal(bytes.capacity,0);
  bytes.append(Buffer.from('data'));bytes.dispose();bytes.dispose();assert.equal(bytes.capacity,0);assert.equal(bytes.length,0);assert.throws(()=>bytes.append(Buffer.from('more')));assert.throws(()=>bytes.finish());
});
