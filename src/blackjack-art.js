import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {blit,encodePng} from './sprite-image.js';
import {handValue} from './blackjack.js';
const data=JSON.parse(readFileSync(new URL('../assets/blackjack-art.json',import.meta.url),'utf8'));
const all=inflateSync(Buffer.from(data.pixels,'base64'));
const decode=s=>({...s,pixels:all.subarray(s.offset,s.offset+s.w*s.h*4)});
const base=decode(data.base),cards=data.cards.map(decode),scores=data.scores.map(decode);
export function blackjackImage(g){
  const pixels=Buffer.from(base.pixels),active=g.phase==='playing';
  const hand=(items,y)=>{const gap=Math.min(100,Math.floor(510/Math.max(1,items.length-1)));items.forEach((c,n)=>blit(pixels,base.w,cards[c],40+n*gap,y));};
  hand(active?[g.dealer[0],52]:g.dealer,76);hand(g.player,284);
  blit(pixels,base.w,scores[active?32:Math.min(31,handValue(g.dealer).total)],654,110);blit(pixels,base.w,scores[Math.min(31,handValue(g.player).total)],654,318);
  return encodePng(pixels,base.w,base.h);
}
