import {ActionRowBuilder,StringSelectMenuBuilder} from 'discord.js';
import {bets} from './casino.js';
export const chipNumber=n=>n.toLocaleString('ja-JP');
export const chipDelta=n=>n===0?'±0':`${n>0?'+':''}${chipNumber(n)}`;
export function gameLobbyChoices(balance){
  const choices=[
    {label:'ブラックジャック',value:'blackjack',description:'10枚〜 · ディーラーと21点を目指す',emoji:'♠️'},
    {label:'スロット',value:'slots',description:'10枚〜 · 3つの絵柄を揃える',emoji:'🎰'},
    {label:'ルーレット',value:'roulette',description:'10枚〜 · 色・奇偶・数字の範囲を予想',emoji:'🔴'},
    {label:'ダイス',value:'dice',description:'10枚〜 · 合計を予想（チャットダイスとは別）',emoji:'🎲'},
    {label:'ハイ＆ロー',value:'highlow',description:'10枚〜 · 次のカードの大小を予想',emoji:'🃏'},
    {label:'どうぶつレース',value:'race',description:'10枚〜 · 4匹の中から1着を予想',emoji:'🏁'},
    {label:'バカラ',value:'baccarat',description:'10枚〜 · 2つの手札の勝敗を予想',emoji:'♦️'},
    {label:'じゃんけん',value:'rps',description:'無料 · Botと3回勝負',emoji:'✊'},
    {label:'ニワトリを捕まえる',value:'work',description:'無料 · 仲間の順番を覚える',emoji:'🐔'},
    {label:'4目並べ',value:'four',description:'無料 · Botと4つのコマを並べる',emoji:'🟡'},
  ];
  const free=choice=>['rps','work','four'].includes(choice.value);
  return Number.isFinite(balance)&&balance<10?[...choices.filter(free),...choices.filter(c=>!free(c))]:choices;
}
export function wagerRow(prefix,s,balance){
  const available=bets.filter(n=>balance===undefined||balance>=n),shown=available.length?available:bets;
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`${prefix}:${s.id}:${s.turn}:bet`).setPlaceholder(available.length?`掛け枚数 · ${s.bet??10}枚`:'チップ不足 · 最低10枚').setDisabled(!available.length).setMinValues(1).setMaxValues(1).addOptions(...shown.map(n=>({value:String(n),label:`${n}枚`,description:balance<n?'残高不足 · 現在は開始できません':'枚数を選ぶだけではチップを使いません',default:n===(s.bet??10)}))));
}
// Keep old dropdown interactions usable, while accepting only exact supported amounts.
export function wagerChoice(action,values){
  const value=action==='bet'&&values?.length===1?values[0]:/^bet-(10|50|100)$/.test(action)?action.slice(4):null;
  if(!bets.some(n=>String(n)===value))throw new Error('10・50・100枚から選んでください。');return Number(value);
}
