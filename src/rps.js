import {randomInt} from 'node:crypto';
export const rpsChoices=['rock','scissors','paper'];
export const rpsNames={rock:'グー',scissors:'チョキ',paper:'パー'};
export const rpsEmoji={rock:'✊',scissors:'✌️',paper:'✋'};
export const newRps=()=>({rounds:[],wins:0,losses:0,phase:'playing'});
export function playRps(game,choice,random=randomInt){
  if(game.phase!=='playing'||!rpsChoices.includes(choice))throw new Error('最新の画面から手を選んでください。');
  const n=random(3);if(!Number.isInteger(n)||n<0||n>=3)throw new Error('抽選に失敗しました。');
  const bot=rpsChoices[n],difference=(rpsChoices.indexOf(choice)-n+3)%3;
  const result=difference===0?'draw':difference===2?'win':'lose';
  const wins=game.wins+(result==='win'?1:0),losses=game.losses+(result==='lose'?1:0);
  const rounds=[...game.rounds,{choice,bot,result}],phase=rounds.length>=3||wins===2||losses===2?'done':'playing';
  return {rounds,wins,losses,phase,...(phase==='done'?{result:wins===losses?'draw':wins>losses?'win':'lose'}:{})};
}
