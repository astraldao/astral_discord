import {crc32} from 'node:zlib';
import {BoundedBytes} from './bounded-bytes.js';
export const MAX_BANNER_BYTES=4*1024*1024;
const imageError=()=>new Error('PNGまたはJPEGの画像を選んでください。壊れた画像は再保存してアップロードしてください。');
function dimensions(width,height,extension){
  if(!width||!height||width>8192||height>8192||width*height>16*1024*1024)throw new Error('画像は縦横8192px以内、合計1600万画素程度までにしてください。');
  return {width,height,extension,mime:extension==='png'?'image/png':'image/jpeg'};
}
// Inspect bounded image structure without invoking an image decoder or external process.
// Discord still validates decoding when the image is applied.
export function bannerImageInfo(buffer){
  if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>MAX_BANNER_BYTES)throw new Error('画像は4MiB以内でアップロードしてください。');
  if(buffer.length>=33&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
    let offset=8,info,sawData=false,count=0;
    while(offset+12<=buffer.length&&++count<=4096){
      const length=buffer.readUInt32BE(offset),end=offset+12+length;if(end>buffer.length)throw imageError();
      const kind=buffer.toString('ascii',offset+4,offset+8),data=buffer.subarray(offset+8,end-4);
      if((crc32(buffer.subarray(offset+4,end-4))>>>0)!==buffer.readUInt32BE(end-4))throw imageError();
      if(!info){if(kind!=='IHDR'||length!==13)throw imageError();info=dimensions(data.readUInt32BE(0),data.readUInt32BE(4),'png');}
      else if(kind==='IHDR'||kind==='acTL')throw imageError();
      if(kind==='IDAT'&&length)sawData=true;
      if(kind==='IEND'){if(length||end!==buffer.length||!sawData)throw imageError();return info;}
      offset=end;
    }
    throw imageError();
  }
  if(buffer.length>=12&&buffer.readUInt16BE(0)===0xffd8&&buffer.readUInt16BE(buffer.length-2)===0xffd9){
    let offset=2,info;
    while(offset+4<=buffer.length){
      if(buffer[offset++]!==255)throw imageError();while(buffer[offset]===255)offset++;
      if(offset+3>buffer.length)throw imageError();
      const marker=buffer[offset++];if(marker===0xda){if(info)return info;throw imageError();}
      if(marker===0xd8||marker===0xd9||marker===0||marker>=0xd0&&marker<=0xd7)throw imageError();
      const length=buffer.readUInt16BE(offset);if(length<2||offset+length>buffer.length)throw imageError();
      if(marker===0xc0||marker===0xc2){if(length<8||buffer[offset+2]!==8||info)throw imageError();info=dimensions(buffer.readUInt16BE(offset+5),buffer.readUInt16BE(offset+3),'jpg');}
      offset+=length;
    }
  }
  throw imageError();
}
export async function readBannerAttachment(attachment,{fetcher=fetch,signal}={}){
  signal?.throwIfAborted();
  if(!attachment||!Number.isInteger(attachment.size)||attachment.size<1||attachment.size>MAX_BANNER_BYTES)throw new Error('PNGまたはJPEGの画像を1枚、4MiB以内で選んでください。');
  let url;try{url=new URL(attachment.url);}catch{throw new Error('画像をもう一度アップロードしてください。');}
  const path=url.pathname.match(/^\/(?:ephemeral-)?attachments\/(\d{17,20})\/(\d{17,20})\/[^/]+$/);
  if(url.protocol!=='https:'||url.hostname!=='cdn.discordapp.com'||url.port||url.username||url.password||url.hash||!path||path[2]!==attachment.id)throw new Error('Discordへアップロードした画像を選んでください。');
  const timeout=AbortSignal.timeout(10000),abort=signal?AbortSignal.any([signal,timeout]):timeout;
  let response;
  try{response=await fetcher(url.href,{redirect:'error',signal:abort});}catch{throw new Error('画像を取得できませんでした。もう一度アップロードしてください。');}
  if(!response.ok||!response.body){if(response.body)await response.body.cancel().catch(()=>{});throw new Error('画像を取得できませんでした。もう一度アップロードしてください。');}
  const advertised=Number(response.headers.get('content-length'));
  if(advertised>MAX_BANNER_BYTES){await response.body.cancel().catch(()=>{});throw new Error('画像は4MiB以内でアップロードしてください。');}
  const reader=response.body.getReader(),bytes=new BoundedBytes(MAX_BANNER_BYTES);let buffer;
  try{while(true){abort.throwIfAborted();const {done,value}=await reader.read();abort.throwIfAborted();if(done)break;bytes.append(value);}buffer=bytes.finish();}
  catch(error){throw new Error(error?.code==='RESPONSE_LIMIT'?'画像は4MiB以内でアップロードしてください。':'画像を最後まで取得できませんでした。もう一度アップロードしてください。');}
  finally{bytes.dispose();await reader.cancel().catch(()=>{});reader.releaseLock();}
  return {buffer,...bannerImageInfo(buffer)};
}
