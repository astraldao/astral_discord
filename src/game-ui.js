import {ActionRowBuilder,StringSelectMenuBuilder} from 'discord.js';
import {bets} from './casino.js';
export const chipNumber=n=>n.toLocaleString('ja-JP');
export const chipDelta=n=>n===0?'±0':`${n>0?'+':''}${chipNumber(n)}`;
export function wagerRow(prefix,s,balance){
  const available=bets.filter(n=>balance===undefined||balance>=n),shown=available.length?available:bets;
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`${prefix}:${s.id}:${s.turn}:bet`).setPlaceholder(available.length?`掛け枚数 · ${s.bet??10}枚`:'チップ不足 · 最低10枚').setDisabled(!available.length).setMinValues(1).setMaxValues(1).addOptions(...shown.map(n=>({value:String(n),label:`${n}枚`,description:balance<n?'残高不足 · 現在は開始できません':'枚数を選ぶだけではチップを使いません',default:n===(s.bet??10)}))));
}
// Keep old dropdown interactions usable, while accepting only exact supported amounts.
export function wagerChoice(action,values){
  const value=action==='bet'&&values?.length===1?values[0]:/^bet-(10|50|100)$/.test(action)?action.slice(4):null;
  if(!bets.some(n=>String(n)===value))throw new Error('10・50・100枚から選んでください。');return Number(value);
}
