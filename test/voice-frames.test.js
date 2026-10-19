import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceFrames} from '../src/voice-frames.js';
const frame=(data,body=Buffer.alloc(0))=>Buffer.concat([Buffer.from(JSON.stringify({...data,bytes:body.length})+'\n'),body]);

test('binary voice frames tolerate every header and body boundary and coalesced zero-byte frames',()=>{
  const body=Buffer.from([0,10,255,13,128,1]),raw=Buffer.concat([frame({type:'ready'}),frame({id:1,label:'ずんだもん'},body),frame({id:1,end:true})]);
  for(let split=0;split<=raw.length;split++){
    const decoder=new VoiceFrames(),received=[],headers=[],emit=(data,bytes)=>received.push({data,bytes});
    decoder.push(raw.subarray(0,split),emit,data=>headers.push(data));decoder.push(raw.subarray(split),emit,data=>headers.push(data));
    assert.equal(received.length,3);assert.equal(headers.length,3);assert.deepEqual(received[1].bytes,body);assert.equal(received[1].data.label,'ずんだもん');assert.equal(received[2].bytes.length,0);decoder.dispose();
  }
});
test('one-byte fragments copy input immediately and completed audio survives later frames and disposal',()=>{
  const decoder=new VoiceFrames(),body=Buffer.alloc(65536,42),raw=frame({id:1},body),received=[];
  for(const value of raw){const fragment=Buffer.from([value]);decoder.push(fragment,(_,bytes)=>received.push(bytes));fragment.fill(0);}
  decoder.push(frame({id:2},Buffer.alloc(100,7)),(_,bytes)=>received.push(bytes));decoder.dispose();
  assert.equal(received.length,2);assert.deepEqual(received[0],body);assert.deepEqual(received[1],Buffer.alloc(100,7));
});
test('header notification marks transfer once without delivering incomplete audio',()=>{
  const decoder=new VoiceFrames(),received=[],headers=[],head=Buffer.from('{"bytes":3,"id":1}\n');
  decoder.push(head.subarray(0,5),(_,bytes)=>received.push(bytes),data=>headers.push(data));assert.equal(headers.length,0);
  decoder.push(head.subarray(5),(_,bytes)=>received.push(bytes),data=>headers.push(data));assert.equal(headers.length,1);assert.equal(received.length,0);
  decoder.push(Buffer.from([1,2]),(_,bytes)=>received.push(bytes),()=>assert.fail());assert.equal(received.length,0);
  decoder.push(Buffer.from([3]),(_,bytes)=>received.push(bytes),()=>assert.fail());assert.deepEqual(received,[Buffer.from([1,2,3])]);decoder.dispose();
});
test('header and frame byte limits reject before delivery and never permit reuse after failure',()=>{
  const prefix='{"bytes":0,"padding":"',suffix='"}';
  const exact=prefix+'a'.repeat(1024-prefix.length-suffix.length)+suffix;
  const valid=new VoiceFrames();let count=0;valid.push(Buffer.from(exact+'\n'),()=>count++);assert.equal(count,1);valid.dispose();
  for(const raw of [Buffer.from(exact+' \n'),Buffer.alloc(1025,32),Buffer.alloc(4*1024*1024+2049),...[-1,0.5,4*1024*1024+1,'1',null].map(bytes=>Buffer.from(JSON.stringify({bytes})+'\n')),Buffer.from('null\n'),Buffer.from('[]\n'),Buffer.from('not JSON PRIVATE\n')]){
    const decoder=new VoiceFrames();assert.throws(()=>decoder.push(raw,()=>assert.fail()),/音声応答/);assert.throws(()=>decoder.push(frame({type:'ready'}),()=>assert.fail()));decoder.dispose();
  }
});
test('decoder disposal or callback failure stops delivery of the remaining coalesced frames',()=>{
  for(const fail of [false,true]){
    const decoder=new VoiceFrames(),raw=Buffer.concat([frame({id:1}),frame({id:2})]);let count=0;
    const emit=()=>{count++;if(fail)throw new Error('PRIVATE');decoder.dispose();};
    if(fail)assert.throws(()=>decoder.push(raw,emit),error=>!error.message.includes('PRIVATE'));else decoder.push(raw,emit);
    assert.equal(count,1);assert.throws(()=>decoder.push(raw,()=>assert.fail()));decoder.dispose();
  }
});

test('maximum declared audio remains supported while aggregate buffered input is bounded',()=>{
  const body=Buffer.alloc(4*1024*1024,42),raw=frame({id:1},body),decoder=new VoiceFrames();let output;
  for(let at=0;at<raw.length;at+=65536)decoder.push(raw.subarray(at,at+65536),(_,bytes)=>output=bytes);
  assert.deepEqual(output,body);decoder.dispose();
  const blocked=new VoiceFrames();blocked.push(Buffer.from('{"bytes":4194304}\n'),()=>assert.fail());blocked.push(Buffer.alloc(1024*1024),()=>assert.fail());
  assert.throws(()=>blocked.push(Buffer.alloc(3*1024*1024+2049),()=>assert.fail()));blocked.dispose();
});
