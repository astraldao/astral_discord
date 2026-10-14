import {randomInt} from 'node:crypto';
export const baccaratPoint=card=>Math.min(card%13+1,10)%10;
export const baccaratTotal=cards=>cards.reduce((sum,c)=>sum+baccaratPoint(c),0)%10;
export function bankerDraws(total,third){
  if(third===undefined)return total<=5;
  return total<=2 || total===3&&third!==8 || total===4&&third>=2&&third<=7 || total===5&&third>=4&&third<=7 || total===6&&(third===6||third===7);
}
// Fresh eight-deck shoe per round; draw without replacement in normal deal order.
export function baccaratDeal(random=randomInt){
  const shoe=Array.from({length:416},(_,n)=>n%52);
  const draw=()=>{const i=random(shoe.length);if(!Number.isInteger(i)||i<0||i>=shoe.length)throw new Error('抽選に失敗しました。');return shoe.splice(i,1)[0];};
  const player=[draw()],banker=[draw()];player.push(draw());banker.push(draw());
  const p=baccaratTotal(player),b=baccaratTotal(banker);
  if(p<8&&b<8){if(p<=5)player.push(draw());if(bankerDraws(b,player.length===3?baccaratPoint(player[2]):undefined))banker.push(draw());}
  const playerTotal=baccaratTotal(player),bankerTotal=baccaratTotal(banker);
  return {player,banker,playerTotal,bankerTotal,outcome:playerTotal===bankerTotal?'tie':playerTotal>bankerTotal?'player':'banker'};
}
export function baccaratPayout(hand,choice,bet){
  if(hand.outcome==='tie')return choice==='tie'?bet*9:bet;
  return hand.outcome!==choice?0:choice==='banker'&&hand.bankerTotal===6?bet*3/2:bet*2;
}
