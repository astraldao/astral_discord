import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {blit,encodePng} from './sprite-image.js';
const data=JSON.parse(readFileSync(new URL('../assets/casino-art.json',import.meta.url),'utf8')),all=inflateSync(Buffer.from(data.pixels,'base64'));
const decode=s=>({...s,pixels:all.subarray(s.offset,s.offset+s.w*s.h*4)});
const base=decode(data.base),waiting=decode(data.waiting),slots=data.slots.map(decode),dice=data.dice.map(decode),numbers=data.numbers.map(decode),highlight=decode(data.highlight),cards=data.cards.map(decode),highlowBase=decode(data.highlowBase),highlowReadyBase=decode(data.highlowReadyBase),track=decode(data.track),animals=data.animals.map(decode);
export function casinoImage(kind,result,{card}={}){
  const frame=kind==='race'?track:kind==='highlow'?(result?highlowBase:highlowReadyBase):base,pixels=Buffer.from(frame.pixels);
  const draw=(s,x,y=48)=>blit(pixels,frame.w,s,x,y);
  if(kind==='race'){
    for(let i=0;i<4;i++){const place=result?result.values.indexOf(i):3;draw(animals[i],result?674-place*144:120,52+i*48);}
  }else if(kind==='highlow'){
    if(result){draw(cards[result.values[0]-1],206);draw(cards[(card??result.values[1])-1],426);}else{draw(cards[(card??1)-1],206);draw(waiting,426);}
  }else if(!result)draw(waiting,308);
  else if(kind==='slots')result.values.forEach((n,i)=>{draw(slots[n],108+i*208);if(result.values.filter(v=>v===n).length>=2)draw(highlight,104+i*208,44);});
  else if(kind==='dice')result.values.forEach((n,i)=>draw(dice[n-1],204+i*224));
  else draw(numbers[result.values[0]],308);
  return encodePng(pixels,frame.w,frame.h);
}
