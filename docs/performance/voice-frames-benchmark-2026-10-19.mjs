import {VoiceFrames} from '../../src/voice-frames.js';
const mode=process.argv[2],fragmentBytes=Number(process.argv[3]??64),bytes=262144;
if(!['old','new'].includes(mode)||![64,4096].includes(fragmentBytes))throw Error('usage: old|new 64|4096');
// The prior framing algorithm, isolated from synthesis, WAV validation and I/O.
class Before {
  buffer=Buffer.alloc(0);header=null;
  push(part,emit){
    this.buffer=Buffer.concat([this.buffer,part]);if(this.buffer.length>4*1024*1024+2048)throw Error('limit');
    while(this.buffer.length){
      if(!this.header){const at=this.buffer.indexOf(10);if(at<0){if(this.buffer.length>1024)throw Error('header');return;}if(at>1024)throw Error('header');this.header=JSON.parse(this.buffer.subarray(0,at).toString());this.buffer=this.buffer.subarray(at+1);if(!Number.isInteger(this.header.bytes)||this.header.bytes<0||this.header.bytes>4*1024*1024)throw Error('bytes');}
      if(this.buffer.length<this.header.bytes)return;
      const body=Buffer.from(this.buffer.subarray(0,this.header.bytes)),header=this.header;this.buffer=this.buffer.subarray(this.header.bytes);this.header=null;emit(header,body);
    }
  }
}
const input=Buffer.concat([Buffer.from(JSON.stringify({id:1,bytes})+'\n'),Buffer.alloc(bytes,42)]),decoder=mode==='old'?new Before():new VoiceFrames();let output;
const cpu=process.cpuUsage(),began=performance.now();for(let at=0;at<input.length;at+=fragmentBytes)decoder.push(input.subarray(at,at+fragmentBytes),(_,body)=>output=body);
const elapsedMs=performance.now()-began,used=process.cpuUsage(cpu);if(output?.length!==bytes||output.some(byte=>byte!==42))throw Error('bytes changed');decoder.dispose?.();
console.log(JSON.stringify({mode,fragmentBytes,bytes,fragments:Math.ceil(input.length/fragmentBytes),elapsedMs,cpuMs:(used.user+used.system)/1000}));
