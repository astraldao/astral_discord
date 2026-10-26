import {bannerImageInfo,MAX_BANNER_BYTES} from './banner-image.js';
import {BoundedBytes} from './bounded-bytes.js';
export const imageWorkshopPixels=4*1024*1024;
export function workshopImageInfo(buffer){const info=bannerImageInfo(buffer);if(info.width*info.height>imageWorkshopPixels)throw new Error('画像は約400万画素以内にしてください（例：2048×2048px）。');return info;}
export async function readWorkshopImage(attachment,{fetcher=fetch,signal,timeoutMs=10000}={}){
  if(!attachment||!Number.isSafeInteger(attachment.size)||attachment.size<1||attachment.size>MAX_BANNER_BYTES)throw new Error('PNG・JPEGを1枚、4MiB以内で選んでください。');
  let url;try{url=new URL(attachment.url);}catch{throw new Error('画像をもう一度アップロードしてください。');}
  const path=url.pathname.match(/^\/(?:ephemeral-)?attachments\/(\d{17,20})\/(\d{17,20})\/[^/]+$/u);
  if(url.protocol!=='https:'||url.hostname!=='cdn.discordapp.com'||url.port||url.username||url.password||url.hash||!path||path[2]!==attachment.id)throw new Error('Discordへアップロードした画像を選んでください。');
  const controller=new AbortController(),onParent=()=>controller.abort();let reader,timer,onAbort;
  if(signal?.aborted)throw new Error('画像の取得を中止しました。');signal?.addEventListener('abort',onParent,{once:true});
  const cancelled=new Promise((resolve,reject)=>{onAbort=()=>{void reader?.cancel().catch(()=>{});reject(new Error('画像の取得を中止しました。時間をおいて選び直してください。'));};controller.signal.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>controller.abort(),Math.max(1,Math.min(10000,timeoutMs)));});
  const bytes=new BoundedBytes(MAX_BANNER_BYTES);
  try{return await Promise.race([(async()=>{
    const response=await fetcher(url.href,{redirect:'error',signal:controller.signal});if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});controller.signal.throwIfAborted();}
    const length=response.headers.get('content-length');if(!response.ok||!response.body||length!==null&&(!/^\d+$/u.test(length)||Number(length)>MAX_BANNER_BYTES)){void response.body?.cancel().catch(()=>{});throw new Error('invalid image response');}
    reader=response.body.getReader();let chunks=0;
    while(true){if(++chunks>16384)throw new Error('too many chunks');controller.signal.throwIfAborted();const {done,value}=await reader.read();controller.signal.throwIfAborted();if(done)break;bytes.append(value);}
    const buffer=Buffer.from(bytes.finish());if(buffer.length!==attachment.size)throw new Error('image size mismatch');return {buffer,...workshopImageInfo(buffer)};
  })(),cancelled]);}catch{throw new Error('画像を取得・確認できませんでした。PNG・JPEG、4MiB・約400万画素以内の画像を選び直してください。');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',onParent);controller.signal.removeEventListener('abort',onAbort);bytes.dispose();void reader?.cancel().catch(()=>{});}
}
