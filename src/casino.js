import {randomInt} from 'node:crypto';
import {baccaratDeal,baccaratPayout} from './baccarat.js';
export const casinoKinds=['slots','roulette','dice','highlow','race','baccarat'];
export const casinoNames={slots:'スロット',roulette:'ルーレット',dice:'ダイス',highlow:'ハイ＆ロー',race:'どうぶつレース',baccarat:'バカラ'};
export const bets=[10,50,100];
export const animals=['ウサギ','ネコ','ニワトリ','カメ'];
export const rankName=n=>({1:'A',11:'J',12:'Q',13:'K'}[n]??String(n));
const red=new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
export const rouletteColor=n=>n===0?'green':red.has(n)?'red':'black';
export function drawRank(random=randomInt){return checkedDraw(random,13)+1;}
function checkedDraw(random,max){const n=random(max);if(!Number.isInteger(n)||n<0||n>=max)throw new Error('抽選に失敗しました。');return n;}
export function casinoChoices(kind){return {slots:['spin'],roulette:['red','black','odd','even','lower','upper'],dice:['low','seven','high'],highlow:['higher','same','lower'],race:['animal0','animal1','animal2','animal3'],baccarat:['player','banker','tie']}[kind]??[];}
// Quotes and settlement share integer arithmetic. Payout includes the original stake.
export function winningPayout(kind,choice,bet,card){
  if(!bets.includes(bet)||!casinoChoices(kind).includes(choice))throw new Error('掛けチップと予想を確認してください。');
  if(kind==='highlow'){
    if(!Number.isInteger(card)||card<1||card>13)throw new Error('カードを確認できません。');
    const count=choice==='higher'?13-card:choice==='lower'?card-1:1;
    return count?Math.floor(bet*1261/(100*count)):0;
  }
  return kind==='baccarat'?bet*(choice==='tie'?9:2):kind==='slots'?bet*20:kind==='roulette'?bet*2:kind==='race'?bet*39/10:bet*(choice==='seven'?58:23)/10;
}
export function casinoRound({kind,choice,bet,balance,card},random=randomInt){
  if(!casinoKinds.includes(kind) || !bets.includes(bet) || !Number.isSafeInteger(balance) || balance<bet)throw new Error('チップかゲームの設定を確認してください。');
  if(!casinoChoices(kind).includes(choice))throw new Error('このゲームのボタンから選んでください。');
  const quote=winningPayout(kind,choice,bet,card);
  if(!quote)throw new Error('当たる可能性のある予想を選んでください。');
  const draw=max=>checkedDraw(random,max);
  let values,payout=0,outcome,hand;
  if(kind==='slots'){values=[draw(6),draw(6),draw(6)];const size=new Set(values).size;payout=size===1?quote:size===2?bet:0;outcome=size===1?'triple':size===2?'pair':'miss';}
  else if(kind==='roulette'){
    values=[draw(37)];const n=values[0];outcome=rouletteColor(n);
    const wins={red:outcome==='red',black:outcome==='black',odd:n%2===1,even:n>0&&n%2===0,lower:n>=1&&n<=18,upper:n>=19};payout=wins[choice]?quote:0;
  }else if(kind==='dice'){values=[draw(6)+1,draw(6)+1];const total=values[0]+values[1];outcome=total<7?'low':total>7?'high':'seven';payout=outcome===choice?quote:0;
  }else if(kind==='highlow'){values=[card,draw(13)+1];outcome=values[1]>card?'higher':values[1]<card?'lower':'same';payout=outcome===choice?quote:0;
  }else if(kind==='baccarat'){hand=baccaratDeal(random);values=[...hand.player,...hand.banker];outcome=hand.outcome;payout=baccaratPayout(hand,choice,bet);
  }else{values=[0,1,2,3];for(let i=3;i>0;i--){const j=draw(i+1);[values[i],values[j]]=[values[j],values[i]];}outcome=`animal${values[0]}`;payout=outcome===choice?quote:0;}
  const nextBalance=balance-bet+payout;if(!Number.isSafeInteger(payout)||!Number.isSafeInteger(nextBalance))throw new Error('チップの上限に達しました。');
  return {kind,choice,values,outcome,bet,payout,delta:payout-bet,balance:nextBalance,...(hand??{})};
}
