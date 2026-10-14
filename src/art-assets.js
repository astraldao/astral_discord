import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
export function loadArt(url){
  const data=JSON.parse(readFileSync(url,'utf8')),packed=inflateSync(Buffer.from(data.pixels,'base64'),{maxOutputLength:4*1024*1024});
  const palette=Buffer.from(data.palette,'base64'),lookup=inflateSync(Buffer.from(data.lookup,'base64'),{maxOutputLength:32768});
  if(data.encoding!=='indexed-alpha'||data.scale!==0.6||palette.length<3||palette.length>768||palette.length%3||lookup.length!==32768||packed.length%2||lookup.some(n=>n>=palette.length/3))throw new Error('画像素材を読み込めません。');
  const decode=s=>{if(!Number.isInteger(s.w)||!Number.isInteger(s.h)||s.w<1||s.h<1||s.w>480||s.h>264||!Number.isInteger(s.offset)||s.offset<0||s.offset+s.w*s.h*2>packed.length)throw new Error('画像素材のサイズが不正です。');const pixels=Buffer.allocUnsafe(s.w*s.h*4);for(let i=0;i<pixels.length/4;i++){const index=packed[s.offset+i*2]*3;pixels[i*4]=palette[index];pixels[i*4+1]=palette[index+1];pixels[i*4+2]=palette[index+2];pixels[i*4+3]=packed[s.offset+i*2+1];}return {...s,pixels};};
  return {data,decode,png:{palette,lookup}};
}
