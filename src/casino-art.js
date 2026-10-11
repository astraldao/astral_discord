import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {blit,encodePng} from './sprite-image.js';
const data=JSON.parse(readFileSync(new URL('../assets/casino-art.json',import.meta.url),'utf8')),all=inflateSync(Buffer.from(data.pixels,'base64'));
const decode=s=>({...s,pixels:all.subarray(s.offset,s.offset+s.w*s.h*4)});
const base=decode(data.base),waiting=decode(data.waiting),slots=data.slots.map(decode),dice=data.dice.map(decode),numbers=data.numbers.map(decode);
export function casinoImage(kind,result){
  const pixels=Buffer.from(base.pixels);
  const draw=(s,x)=>blit(pixels,base.w,s,x,48);
  if(!result)draw(waiting,308);
  else if(kind==='slots')result.values.forEach((n,i)=>draw(slots[n],108+i*208));
  else if(kind==='dice')result.values.forEach((n,i)=>draw(dice[n-1],204+i*224));
  else draw(numbers[result.values[0]],308);
  return encodePng(pixels,base.w,base.h);
}
