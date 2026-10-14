import {loadArt} from './art-assets.js';
import {blit,encodePng} from './sprite-image.js';
import {handValue} from './blackjack.js';
const {data,decode,png}=loadArt(new URL('../assets/blackjack-art.json',import.meta.url));
const at=n=>Math.round(n*data.scale);
const base=decode(data.base),cards=data.cards.map(decode),scores=data.scores.map(decode);
export function blackjackImage(g){
  const pixels=Buffer.from(base.pixels),active=g.phase==='playing';
  const hand=(items,y)=>{const gap=Math.min(100,Math.floor(510/Math.max(1,items.length-1)));items.forEach((c,n)=>blit(pixels,base.w,cards[c],at(40+n*gap),at(y)));};
  hand(active?[g.dealer[0],52]:g.dealer,76);hand(g.player,284);
  blit(pixels,base.w,scores[active?32:Math.min(31,handValue(g.dealer).total)],at(654),at(110));blit(pixels,base.w,scores[Math.min(31,handValue(g.player).total)],at(654),at(318));
  return encodePng(pixels,base.w,base.h,png);
}
