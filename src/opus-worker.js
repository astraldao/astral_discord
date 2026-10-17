// Fixed local PCM -> Opus worker. Never accepts paths, code, text, or network requests.
import {parentPort} from 'node:worker_threads';
import OpusScript from 'opusscript';
const frameBytes=3840;
const create=()=>new OpusScript(48000,2,OpusScript.Application.AUDIO);
let encoder=null,owner=null,tail=Buffer.alloc(0),total=0;
const release=()=>{encoder?.delete();encoder=null;owner=null;tail=Buffer.alloc(0);total=0;};
try{
  const began=performance.now(),warm=create(),tone=Buffer.alloc(frameBytes*3);
  for(let frame=0;frame<2880;frame++){const sample=Math.round(Math.sin(frame*2*Math.PI*240/48000)*2000);tone.writeInt16LE(sample,frame*4);tone.writeInt16LE(sample,frame*4+2);}
  for(let at=0;at<tone.length;at+=frameBytes)warm.encode(tone.subarray(at,at+frameBytes),960);
  warm.delete();parentPort.postMessage({type:'ready',warmupMs:Math.round(performance.now()-began)});
}catch{parentPort.postMessage({type:'failed'});parentPort.close();}
parentPort.on('message',request=>{
  try{
    if(!Number.isSafeInteger(request.id)||request.id<1||!Number.isSafeInteger(request.sequence)||request.sequence<1)throw new Error();
    const packets=[];
    if(request.type==='start'){
      if(encoder)throw new Error();encoder=create();owner=request.id;
    }else{
      if(!encoder||owner!==request.id)throw new Error();
      if(request.type==='chunk'){
        if(!(request.data instanceof Uint8Array)||!request.data.length||request.data.length>65536||request.data.length%4||(total+=request.data.length)>8*1024*1024)throw new Error();
        const pcm=Buffer.concat([tail,request.data]);let at=0;
        while(at+frameBytes<=pcm.length){packets.push(encoder.encode(pcm.subarray(at,at+frameBytes),960));at+=frameBytes;}
        tail=Buffer.from(pcm.subarray(at));
      }else if(request.type==='end'){
        if(tail.length){const padded=Buffer.alloc(frameBytes);tail.copy(padded);packets.push(encoder.encode(padded,960));}release();
      }else throw new Error();
    }
    parentPort.postMessage({sequence:request.sequence,packets});
  }catch{release();parentPort.postMessage({sequence:request.sequence,failed:true});}
});
