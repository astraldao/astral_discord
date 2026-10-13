import test from 'node:test';
import assert from 'node:assert/strict';
import {wagerRow,wagerChoice} from '../src/game-ui.js';
import {createCasinoController} from '../src/casino-ui.js';
import {createBlackjackController,blackjackScreen} from '../src/blackjack-ui.js';
import {createChipTools,workScreen} from '../src/chip-tools.js';
import {GameWalletStore} from '../src/game-wallets.js';
import {newRound,play} from '../src/blackjack.js';
const deck=(...first)=>[...Array.from({length:52},(_,n)=>n).filter(c=>!first.includes(c)),...first.reverse()];
function interaction(customId='unused',user='owner',channelId='channel'){return {customId,user:{id:user},channelId,message:{flags:{has:()=>true}},replies:[],async deferReply(p){this.deferred=true;this.replies.push(p);},async deferUpdate(){this.deferred=true;},async editReply(p){this.replies.push(p);},async reply(p){this.replied=true;this.replies.push(p);}};}
const click=(prefix,s,action)=>interaction(`${prefix}:${s.id}:${s.turn}:${action}`);
const buttons=m=>m.components.flatMap(r=>r.toJSON().components);
async function workFixture(){const wallet=new GameWalletStore();wallet.accounts.set('owner',{balance:0,pending:null});let allowed=true;const c=createChipTools({wallet,random:()=>0,access:async()=>{if(!allowed)throw new Error('revoked');}});await c.handle(interaction('work:open'));const s=[...c.work.sessions.values()][0];await c.handle(click('work',s,'start-5'));return {c,s,wallet,allow:v=>allowed=v};}
test('wager buttons show selection and disable unaffordable choices; malformed amounts fail closed',()=>{
  const buttons=wagerRow('casino',{id:'id',turn:3,bet:50},30).toJSON().components;assert.deepEqual(buttons.map(b=>b.custom_id),['casino:id:3:bet-10','casino:id:3:bet-50','casino:id:3:bet-100']);assert.equal(buttons[0].disabled,false);assert.equal(buttons[1].disabled,true);assert.equal(buttons[1].style,1);assert.ok(buttons[1].label.includes('✓'));for(const action of ['bet-0','bet-20','bet-1e2','bet-100.0','bet-100:other'])assert.throws(()=>wagerChoice(action));assert.equal(wagerChoice('bet-50'),50);assert.equal(wagerChoice('bet',['100']),100);assert.throws(()=>wagerChoice('bet',['50','100']));
});
test('one-tap wagers never charge or redraw and invalidate old paid buttons',async()=>{
  let draws=0;const c=createCasinoController({access:async()=>{},random:()=>{draws++;return 6;}});await c.open(interaction(),'highlow');const s=[...c.sessions.sessions.values()][0],old=click('casino',s,'same');await c.handle(click('casino',s,'bet-50'));assert.equal(s.bet,50);assert.equal(s.card,7);assert.equal(draws,1);assert.equal(c.wallet.balance('owner'),3000);await c.handle(old);assert.equal(s.rounds,0);assert.equal(draws,1);
  const bj=createBlackjackController({access:async()=>{},deal:()=>newRound(deck(9,8,4,6))});await bj.open(interaction());const hand=[...bj.sessions.sessions.values()][0];await bj.handle(click('bj',hand,'bet-100'));assert.equal(hand.bet,100);assert.equal(bj.wallet.balance('owner'),3000);await bj.handle(click('bj',hand,'again'));await bj.handle(click('bj',hand,'bet-10'));assert.equal(hand.roundBet,100);assert.equal(hand.bet,100);assert.equal(bj.wallet.balance('owner'),2900);
});
test('balance refresh re-enables play after a gift without advancing or changing the wager',async()=>{
  const wallet=new GameWalletStore();wallet.accounts.set('owner',{balance:5,pending:null});const c=createCasinoController({wallet,access:async()=>{},random:()=>0});const open=interaction();await c.open(open,'slots');const s=[...c.sessions.sessions.values()][0],turn=s.turn;assert.ok(buttons(open.replies.at(-1)).some(b=>b.custom_id.endsWith(':refresh')));await wallet.transfer('sender','owner',20,'gift');const refresh=click('casino',s,'refresh');await c.handle(refresh);assert.equal(s.turn,turn);assert.equal(s.rounds,0);assert.equal(s.balance,25);assert.equal(s.bet,10);assert.equal(buttons(refresh.replies.at(-1)).find(b=>b.custom_id.endsWith(':spin')).disabled,false);
  const bj=createBlackjackController({wallet,access:async()=>{},deal:()=>newRound(deck(9,8,4,6))});await bj.open(interaction());const hand=[...bj.sessions.sessions.values()][0];await bj.handle(click('bj',hand,'again'));const before=structuredClone(hand.game),t=hand.turn;await bj.handle(click('bj',hand,'refresh'));assert.deepEqual(hand.game,before);assert.equal(hand.turn,t);assert.equal(wallet.balance('owner'),15);
});
test('completed blackjack shows net outcome, explicit next-round cost and compact navigation',()=>{
  const g=newRound(deck(9,0,7,5));play(g,'stand');for(const [payout,bet,expected] of [[20,10,'+10枚'],[10,10,'±0枚'],[0,10,'-10枚'],[40,20,'+20枚']]){const m=blackjackScreen({id:'id',turn:2,game:g,balance:3000,bet:50,roundBet:bet,payout});assert.ok(m.embeds[0].toJSON().description.includes(expected));assert.ok(buttons(m).some(b=>b.label==='50枚で次のラウンド'));assert.ok(m.components.length<=4);for(const r of m.components)r.toJSON();}
});
test('memory restart closes its ticket with no reward, keeps the best and rejects old answers',async()=>{
  const {c,s,wallet}=await workFixture();await c.handle(click('work',s,'remember'));await c.handle(click('work',s,'pick-0'));const old=click('work',s,'pick-0'),ticket=s.ticketId;const cancel=click('work',s,'cancel');await c.handle(cancel);assert.equal(s.view,'ready');assert.equal(s.best,1);assert.equal(wallet.memoryBest('owner'),1);assert.equal(wallet.balance('owner'),0);assert.equal(wallet.accounts.get('owner').work.ticket,null);await assert.rejects(wallet.earnWork('owner',ticket));await c.handle(old);assert.equal(s.view,'ready');await c.handle(click('work',s,'start-3'));assert.equal(s.length,3);assert.notEqual(s.ticketId,ticket);await c.handle(cancel);assert.equal(s.view,'watch');assert.equal(wallet.balance('owner'),0);
});
test('memory restart fails safely on disk errors, foreign users or revoked permission',async()=>{
  const {c,s,wallet,allow}=await workFixture(),before=structuredClone(s);await c.handle(interaction(`work:${s.id}:${s.turn}:cancel`,'other'));assert.deepEqual(s,before);wallet.save=async()=>{throw new Error('disk');};await c.handle(click('work',s,'cancel'));assert.deepEqual(s,before);assert.equal(wallet.accounts.get('owner').work.ticket.id,s.ticketId);wallet.save=async()=>{};allow(false);const i=click('work',s,'cancel');await c.handle(i);assert.deepEqual(s,before);assert.ok(!i.replies.at(-1).embeds[0].toJSON().description.includes('残高'));
});
test('animal answers use accessible names in two short rows with no sequence or answer hint',async()=>{
  const {c,s}=await workFixture();await c.handle(click('work',s,'remember'));const m=workScreen(s,0),rows=m.components.map(r=>r.toJSON());assert.deepEqual(rows.slice(0,2).map(r=>r.components.length),[3,2]);assert.deepEqual(rows.slice(0,2).flatMap(r=>r.components).map(b=>b.emoji.name),['🐔','🐤','🦆','🐇','🐈']);assert.ok(!m.embeds[0].toJSON().description.includes('→'));assert.ok(rows[2].components.some(b=>b.custom_id.endsWith(':cancel')));for(const r of rows)assert.ok(r.components.length<=5);
});
