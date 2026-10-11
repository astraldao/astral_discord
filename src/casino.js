import {randomInt} from 'node:crypto';
export const casinoKinds=['slots','roulette','dice'];
export const bets=[10,50,100];
const red=new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
export const rouletteColor=n=>n===0?'green':red.has(n)?'red':'black';
export function casinoRound({kind,choice,bet,balance},random=randomInt){
  if(!casinoKinds.includes(kind) || !bets.includes(bet) || !Number.isSafeInteger(balance) || balance<bet)throw new Error('チップかゲームの設定を確認してください。');
  const valid=kind==='slots'?['spin']:kind==='roulette'?['red','black']:['low','seven','high'];
  if(!valid.includes(choice))throw new Error('このゲームのボタンから選んでください。');
  const draw=max=>{const n=random(max);if(!Number.isInteger(n)||n<0||n>=max)throw new Error('抽選に失敗しました。');return n;};
  let values,multiplier=0,outcome;
  if(kind==='slots'){values=[draw(6),draw(6),draw(6)];const size=new Set(values).size;multiplier=size===1?20:size===2?1:0;outcome=size===1?'triple':size===2?'pair':'miss';}
  else if(kind==='roulette'){values=[draw(37)];outcome=rouletteColor(values[0]);multiplier=outcome===choice?2:0;}
  else{values=[draw(6)+1,draw(6)+1];const total=values[0]+values[1];outcome=total<7?'low':total>7?'high':'seven';multiplier=outcome===choice?(choice==='seven'?5:2):0;}
  const payout=bet*multiplier,nextBalance=balance-bet+payout;if(!Number.isSafeInteger(nextBalance))throw new Error('チップの上限に達しました。');
  return {kind,choice,values,outcome,bet,payout,delta:payout-bet,balance:nextBalance};
}
