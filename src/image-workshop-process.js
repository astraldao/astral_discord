import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {BoundedBytes} from './bounded-bytes.js';
import {workshopImageInfo} from './image-workshop-input.js';
import {workshopPresets,workshopOptions} from './image-workshop-options.js';
const failed=()=>new Error('画像を変換できませんでした。壊れた画像は再保存し、サイズを小さくして選び直してください。');
export async function processWorkshopImage(image,{preset='emoji',crop='contain',signal,timeoutMs=15000,launcher=spawn}={}){
  workshopImageInfo(image);if(!workshopOptions(preset,crop))throw failed();if(signal?.aborted)throw failed();
  return new Promise((resolve,reject)=>{
    const bytes=new BoundedBytes(512*1024+256);let child,stopped=false,settled=false,timer;
    const stop=()=>{stopped=true;child?.kill('SIGKILL');},finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',stop);bytes.dispose();if(error)reject(failed());else resolve(result);};
    try{child=launcher(process.execPath,['--max-old-space-size=64',fileURLToPath(new URL('../scripts/image-workshop-worker.js',import.meta.url))],{stdio:['pipe','pipe','ignore'],env:{NODE_ENV:'production',UV_THREADPOOL_SIZE:'1',VIPS_CONCURRENCY:'1',MALLOC_ARENA_MAX:'2'}});}catch{finish(failed());return;}
    signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();timer=setTimeout(stop,Math.max(1,Math.min(15000,timeoutMs)));
    child.once('error',()=>finish(failed()));child.stdin.on('error',stop);child.stdout.on('error',stop);child.stdout.on('data',chunk=>{try{bytes.append(chunk);}catch{stop();}});
    child.once('close',code=>{try{
      if(stopped||code!==0)throw failed();const all=bytes.finish(),end=all.indexOf(10);if(end<1||end>255)throw failed();const meta=JSON.parse(all.subarray(0,end).toString('utf8')),buffer=Buffer.from(all.subarray(end+1)),info=workshopImageInfo(buffer),p=workshopPresets[preset];
      if(buffer.length>p.maxBytes||meta.format!==p.format||meta.width!==info.width||meta.height!==info.height||info.extension!==(p.format==='png'?'png':'jpg')||info.width>p.size||info.height>p.size||p.format==='png'&&(info.width!==p.size||info.height!==p.size))throw failed();
      finish(null,{buffer,width:info.width,height:info.height,extension:info.extension,mime:info.mime});
    }catch{finish(failed());}});
    child.stdin.end(Buffer.concat([Buffer.from(JSON.stringify({preset,crop})+'\n'),image]));
  });
}
