import {randomUUID} from 'node:crypto';
import {casinoKinds} from './casino.js';
import {MAX_CHIPS,HISTORY_LIMIT,AUDIT_LIMIT} from './chip-constants.js';
export {HISTORY_LIMIT,AUDIT_LIMIT};
export const ledgerGames=['blackjack',...casinoKinds];
const kinds=['initial','carry','casino','blackjack-bet','blackjack-result','blackjack-double','blackjack-interrupted','work','gift-in','gift-out','adjust','other'];
const keys=['wagered','paid','work','received','sent','added','removed','other'];
const id=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(x);
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const timestamp=x=>integer(x)&&x<=8640000000000000;
export function newLedger(balance,at,initial=false){return {opening:balance,started:at,seq:0,totals:Object.fromEntries(keys.map(k=>[k,0])),games:{},history:[{id:randomUUID(),at,type:initial?'initial':'carry',delta:initial?balance:0,balance}]};}
export function recordChip(a,at,type,delta,details={}){
  const l=a.ledger;l.seq++;const e={id:randomUUID(),at,type,delta,balance:a.balance,...details};l.history.push(e);l.history=l.history.slice(-HISTORY_LIMIT);
  const t=l.totals;
  if(details.game){const g=l.games[details.game]??={rounds:0,wins:0,draws:0,losses:0,wagered:0,paid:0};const bet=details.wager??0,payout=details.payout??0;t.wagered+=bet;t.paid+=payout;g.wagered+=bet;g.paid+=payout;if(details.result&&details.result!=='stopped'){g.rounds++;g[payout>(details.stake??bet)?'wins':payout===(details.stake??bet)?'draws':'losses']++;}}
  else if(type==='work')t.work+=delta;
  else if(type==='gift-in')t.received+=delta;
  else if(type==='gift-out')t.sent-=delta;
  else if(type==='adjust')t[delta>=0?'added':'removed']+=Math.abs(delta);
  else t.other+=delta;
  return e;
}
const validEvent=e=>e&&id(e.id)&&timestamp(e.at)&&kinds.includes(e.type)&&Number.isSafeInteger(e.delta)&&Math.abs(e.delta)<=MAX_CHIPS&&integer(e.balance)&&e.balance<=MAX_CHIPS&&(e.game===undefined||ledgerGames.includes(e.game))&&(e.actor===undefined||id(e.actor))&&(e.peer===undefined||id(e.peer))&&(e.reason===undefined||typeof e.reason==='string'&&e.reason.length<=100&&!/[\u0000-\u001f\u007f]/u.test(e.reason))&&['wager','payout','stake'].every(k=>e[k]===undefined||integer(e[k]))&&(e.result===undefined||typeof e.result==='string'&&/^[a-z0-9-]{1,32}$/.test(e.result));
export function validLedger(l,balance){
  if(!l||!integer(l.opening)||l.opening>MAX_CHIPS||!timestamp(l.started)||!integer(l.seq)||!l.totals||!l.games||typeof l.games!=='object'||Array.isArray(l.games)||!Array.isArray(l.history)||!l.history.length||l.history.length>HISTORY_LIMIT||!l.history.every(validEvent))return false;
  if(!keys.every(k=>k==='other'?Number.isSafeInteger(l.totals[k]):integer(l.totals[k])))return false;
  const t=l.totals,expected=l.opening+t.paid-t.wagered+t.work+t.received-t.sent+t.added-t.removed+t.other;
  if(!Number.isSafeInteger(expected)||expected!==balance||l.history.at(-1).balance!==balance)return false;
  if(l.history.some((e,i)=>i>0&&l.history[i-1].balance+e.delta!==e.balance))return false;
  if(Object.values(l.games).reduce((sum,g)=>sum+(g?.wagered??0),0)!==t.wagered||Object.values(l.games).reduce((sum,g)=>sum+(g?.paid??0),0)!==t.paid)return false;
  return Object.entries(l.games).every(([kind,g])=>ledgerGames.includes(kind)&&g&&['rounds','wins','draws','losses','wagered','paid'].every(k=>integer(g[k]))&&g.rounds===g.wins+g.draws+g.losses);
}
export const validAudit=a=>Array.isArray(a)&&a.length<=AUDIT_LIMIT&&a.every(e=>validEvent(e)&&e.type==='adjust'&&id(e.user)&&id(e.actor)&&typeof e.reason==='string'&&e.reason.trim().length>0);
