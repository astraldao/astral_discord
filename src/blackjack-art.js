import {readFileSync} from 'node:fs';
import {inflateSync,deflateSync} from 'node:zlib';
import {handValue} from './blackjack.js';
const data=JSON.parse(readFileSync(new URL('../assets/blackjack-art.json',import.meta.url),'utf8'));
const all=inflateSync(Buffer.from(data.pixels,'base64'));
const decode=s=>({...s,pixels:all.subarray(s.offset,s.offset+s.w*s.h*4)});
const base=decode(data.base),cards=data.cards.map(decode),scores=data.scores.map(decode);
const CRC=Uint32Array.from({length:256},(_,n)=>{for(let j=0;j<8;j++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function chunk(type,body){const out=Buffer.alloc(body.length+12);out.writeUInt32BE(body.length);out.write(type,4);body.copy(out,8);let crc=0xffffffff;for(const b of out.subarray(4,-4))crc=CRC[(crc^b)&255]^(crc>>>8);out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;}
function blit(dst,s,x,y){for(let j=0;j<s.h;j++)for(let k=0;k<s.w;k++){const from=(j*s.w+k)*4,to=((j+y)*base.w+k+x)*4,alpha=s.pixels[from+3];if(!alpha)continue;for(let c=0;c<3;c++)dst[to+c]=Math.round((s.pixels[from+c]*alpha+dst[to+c]*(255-alpha))/255);}}
export function blackjackImage(g){
  const pixels=Buffer.from(base.pixels),active=g.phase==='playing';
  const hand=(items,y)=>{const gap=Math.min(100,Math.floor(510/Math.max(1,items.length-1)));items.forEach((c,n)=>blit(pixels,cards[c],40+n*gap,y));};
  hand(active?[g.dealer[0],52]:g.dealer,76);hand(g.player,284);
  blit(pixels,scores[active?32:Math.min(31,handValue(g.dealer).total)],654,110);blit(pixels,scores[Math.min(31,handValue(g.player).total)],654,318);
  const raw=Buffer.alloc((base.w*4+1)*base.h);for(let y=0;y<base.h;y++)pixels.copy(raw,y*(base.w*4+1)+1,y*base.w*4,(y+1)*base.w*4);
  const header=Buffer.alloc(13);header.writeUInt32BE(base.w);header.writeUInt32BE(base.h,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw,{level:3})),chunk('IEND',Buffer.alloc(0))]);
}
