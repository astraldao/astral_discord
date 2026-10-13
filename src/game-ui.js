import {ActionRowBuilder,ButtonBuilder,ButtonStyle} from 'discord.js';
import {bets} from './casino.js';
export const chipNumber=n=>n.toLocaleString('ja-JP');
export const chipDelta=n=>n===0?'±0':`${n>0?'+':''}${chipNumber(n)}`;
export function wagerRow(prefix,s,balance){return new ActionRowBuilder().addComponents(bets.map(n=>new ButtonBuilder().setCustomId(`${prefix}:${s.id}:${s.turn}:bet-${n}`).setLabel(`${n}枚${n===(s.bet??10)?' ✓':''}`).setStyle(n===(s.bet??10)?ButtonStyle.Primary:ButtonStyle.Secondary).setDisabled(balance<n)));}
// Keep old dropdown interactions usable, while accepting only exact supported amounts.
export function wagerChoice(action,values){
  const value=action==='bet'&&values?.length===1?values[0]:/^bet-(10|50|100)$/.test(action)?action.slice(4):null;
  if(!bets.some(n=>String(n)===value))throw new Error('10・50・100枚から選んでください。');return Number(value);
}
