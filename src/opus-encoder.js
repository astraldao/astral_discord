import {Worker} from 'node:worker_threads';
import {Transform} from 'node:stream';
import {backupFault} from './backup-fault.js';
const failure=()=>backupFault(null,'ENCODING');
// One worker per voice session, reused across messages. PCM and packets stay bounded in memory.
export function createSpeechEncoder({signal,launch=()=>new Worker(new URL('./opus-worker.js',import.meta.url),{env:{},stdout:true,stderr:true,resourceLimits:{maxOldGenerationSizeMb:32}}),startupTimeout=30000,requestTimeout=5000,schedule=setTimeout,cancel=clearTimeout}={}){
  signal?.throwIfAborted();const child=launch();child.stdout?.resume();child.stderr?.resume();
  let closed=false,readySeen=false,sequence=0,serial=0,current=null,pending=null,readyResolve,readyReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});ready.catch(()=>{});
  const close=()=>{
    if(closed)return;closed=true;cancel(startup);signal?.removeEventListener('abort',close);readyReject(failure());
    if(pending){cancel(pending.timer);pending.reject(failure());pending=null;}
    current?.destroy(failure());void child.terminate();
  };
  const startup=schedule(close,startupTimeout);signal?.addEventListener('abort',close,{once:true});
  child.on('error',close);child.on('exit',close);
  child.on('message',data=>{
    if(closed)return;
    if(data?.type==='ready'){
      if(readySeen||pending||!Number.isInteger(data.warmupMs)||data.warmupMs<0||data.warmupMs>startupTimeout){close();return;}
      readySeen=true;cancel(startup);readyResolve({warmupMs:data.warmupMs});return;
    }
    if(!readySeen||!pending||data?.sequence!==pending.sequence||data.failed||!Array.isArray(data.packets)||data.packets.length>18||data.packets.some(p=>!(p instanceof Uint8Array)||!p.length||p.length>3828)){close();return;}
    const request=pending;pending=null;cancel(request.timer);request.resolve(data.packets.map(p=>Buffer.from(p)));
  });
  function request(id,type,data){
    if(closed||pending)return Promise.reject(failure());
    return new Promise((resolve,reject)=>{
      const seq=++sequence;pending={sequence:seq,resolve,reject,timer:schedule(close,requestTimeout)};
      try{child.postMessage({id,sequence:seq,type,...(data?{data}:{})});}catch{close();}
    });
  }
  return {ready,close,stream(source,abort=signal){
    abort?.throwIfAborted();if(closed||current)throw failure();const id=++serial;let finished=false;
    const stop=()=>output.destroy(failure()),sourceError=()=>output.destroy(failure());
    const output=new Transform({readableObjectMode:true,readableHighWaterMark:16,writableHighWaterMark:65536,
      construct(callback){ready.then(()=>request(id,'start')).then(()=>callback(),()=>callback(failure()));},
      transform(chunk,encoding,callback){
        (async()=>{if(!Buffer.isBuffer(chunk)||chunk.length%4||chunk.length>8*1024*1024)throw failure();for(let at=0;at<chunk.length;at+=65536){abort?.throwIfAborted();for(const packet of await request(id,'chunk',chunk.subarray(at,at+65536)))this.push(packet);}})().then(()=>callback(),()=>callback(failure()));
      },
      flush(callback){request(id,'end').then(packets=>{for(const packet of packets)this.push(packet);finished=true;callback();},()=>callback(failure()));},
      destroy(error,callback){source.unpipe(this);source.removeListener('error',sourceError);abort?.removeEventListener('abort',stop);source.destroy();if(current===this)current=null;if(!finished)close();callback(error);},
    });
    current=output;output.on('error',()=>{});source.on('error',sourceError);abort?.addEventListener('abort',stop,{once:true});source.pipe(output);return output;
  }};
}
