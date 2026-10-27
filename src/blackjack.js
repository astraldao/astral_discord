import {GameError} from './game-errors.js';
import {randomInt} from 'node:crypto';
const ranks=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const suits=['♠','♥','♦','♣'];
export function cardName(card){return `${suits[Math.floor(card/13)]}${ranks[card%13]}`;}
export function handValue(cards){let total=0,aces=0;for(const card of cards){const rank=card%13;total+=rank===0?11:Math.min(rank+1,10);if(rank===0)aces++;}while(total>21 && aces){total-=10;aces--;}return {total,soft:aces>0,blackjack:cards.length===2 && total===21};}
export function shuffledDeck(){const deck=Array.from({length:52},(_,n)=>n);for(let n=51;n>0;n--){const k=randomInt(n+1);[deck[n],deck[k]]=[deck[k],deck[n]];}return deck;}
export function newRound(deck=shuffledDeck()){
  if(deck.length!==52 || new Set(deck).size!==52 || deck.some(c=>!Number.isInteger(c) || c<0 || c>51))throw new GameError('カードの構成が不正です。');
  const g={deck:[...deck],player:[],dealer:[],phase:'playing',result:null};
  for(let n=0;n<2;n++){g.player.push(g.deck.pop());g.dealer.push(g.deck.pop());}
  const p=handValue(g.player),d=handValue(g.dealer);if(p.blackjack || d.blackjack){g.phase='done';g.result=p.blackjack && d.blackjack?'push':p.blackjack?'blackjack':'lose';}return g;
}
function settle(g){const p=handValue(g.player).total,d=handValue(g.dealer).total;g.phase='done';g.result=p>21?'bust':d>21?'dealer-bust':p>d?'win':p<d?'lose':'push';}
export function play(g,action){
  if(g.phase!=='playing')throw new GameError('このラウンドは終了しています。');
  if(!['hit','stand','stop'].includes(action))throw new GameError('ゲームの操作が不正です。');
  if(action==='stop'){g.phase='done';g.result='stopped';return;}
  if(action==='hit'){g.player.push(g.deck.pop());if(handValue(g.player).total>21){settle(g);return;}if(handValue(g.player).total<21)return;}
  // Dealer stands on all 17s, including soft 17. A player reaching 21 proceeds automatically.
  while(handValue(g.dealer).total<17)g.dealer.push(g.deck.pop());settle(g);
}
