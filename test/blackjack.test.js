import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageFlags} from 'discord.js';
import {newRound,handValue,play,shuffledDeck} from '../src/blackjack.js';
import {createBlackjackController,blackjackScreen} from '../src/blackjack-ui.js';
import {commands} from '../src/commands.js';
const deck=(...first)=>[...Array.from({length:52},(_,n)=>n).filter(c=>!first.includes(c)),...first.reverse()];
// card indices: A=0, 2=1, ... 10=9, J=10, Q=11, K=12; +13 for the next suit.
test('ace scoring, face cards and natural blackjack use standard totals',()=>{
  assert.deepEqual(handValue([0,13,9]),{total:12,soft:false,blackjack:false});assert.equal(handValue([0,5]).total,17);assert.equal(handValue([0,5]).soft,true);assert.equal(handValue([0,12]).blackjack,true);assert.equal(handValue([10,11]).total,20);assert.equal(handValue([0,13,26,39,9]).total,14);
  for(let n=0;n<10;n++){const d=shuffledDeck();assert.equal(new Set(d).size,52);assert.ok(d.every(c=>Number.isInteger(c)&&c>=0&&c<52));}assert.throws(()=>newRound(Array(52).fill(0)));
});
test('natural blackjacks resolve before play, including simultaneous blackjack',()=>{
  const p=newRound(deck(0,8,12,7));assert.equal(p.result,'blackjack');assert.throws(()=>play(p,'hit'));const d=newRound(deck(8,0,7,12));assert.equal(d.result,'lose');const tie=newRound(deck(0,13,12,25));assert.equal(tie.result,'push');
});
test('hit busts immediately and a dealer stands on soft 17',()=>{
  const bust=newRound(deck(9,8,7,6,12));play(bust,'hit');assert.equal(bust.result,'bust');assert.equal(bust.dealer.length,2);
  const soft=newRound(deck(9,0,7,5));play(soft,'stand');assert.equal(soft.dealer.length,2);assert.equal(soft.result,'win');
});
test('dealer draws below 17; ties, dealer bust and auto-stand on player 21 resolve correctly',()=>{
  const tie=newRound(deck(9,8,7,6,1));play(tie,'stand');assert.equal(tie.dealer.length,3);assert.equal(tie.result,'push');const bust=newRound(deck(9,8,7,6,12));play(bust,'stand');assert.equal(bust.result,'dealer-bust');const auto=newRound(deck(9,8,4,6,5,1));play(auto,'hit');assert.equal(handValue(auto.player).total,21);assert.equal(auto.phase,'done');assert.equal(auto.result,'win');
});
test('active screen hides the dealer hole card and has no full dealer total',()=>{
  const game=newRound(deck(9,8,4,12)),s={id:'session',turn:0,game};const screen=blackjackScreen(s),description=screen.embeds[0].toJSON().description;assert.ok(description.includes('♠9　▧'));assert.ok(!description.includes('♠K'));assert.deepEqual(screen.allowedMentions.parse,[]);play(game,'stop');const done=blackjackScreen(s);assert.ok(done.embeds[0].toJSON().description.includes('♠K'));for(const m of [screen,done]){assert.ok(m.embeds[0].toJSON().description.length<4096);assert.ok(m.components.length<=5);for(const r of m.components)r.toJSON();}
});
function interaction(customId='unused',user='owner'){return {customId,user:{id:user},channelId:'channel',message:{flags:{has:()=>true}},replies:[],async deferReply(p){this.deferred=true;this.replies.push(p);},async deferUpdate(){this.deferred=true;},async editReply(p){this.replies.push(p);},async reply(p){this.replied=true;this.replies.push(p);}};}
async function fixture(){let clock=0,allowed=true;const c=createBlackjackController({now:()=>clock,deal:()=>newRound(deck(9,8,4,6,1,2)),access:async()=>{if(!allowed)throw new Error('閲覧権限なし');}}),open=interaction();await c.open(open);const s=[...c.sessions.sessions.values()][0];return {c,s,open,time:v=>clock=v,allow:v=>allowed=v};}
test('ordinary members can play privately; foreign users and channels cannot mutate or read a game',async()=>{
  const {c,s,open}=await fixture();assert.equal(open.replies[0].flags,MessageFlags.Ephemeral);const before=structuredClone(s.game);for(const i of [interaction(`bj:${s.id}:0:hit`,'other'),Object.assign(interaction(`bj:${s.id}:0:hit`),{channelId:'other-channel'})]){await c.handle(i);assert.deepEqual(s.game,before);assert.ok(!JSON.stringify(i.replies).includes('♠10'));}
});
test('replayed buttons do not draw again; current game remains available',async()=>{
  const {c,s}=await fixture(),i=interaction(`bj:${s.id}:0:hit`);await c.handle(i);assert.equal(s.game.player.length,3);assert.equal(s.turn,1);const replay=interaction(`bj:${s.id}:0:hit`);await c.handle(replay);assert.equal(s.game.player.length,3);assert.ok(replay.replies.at(-1).components.length>0);assert.ok(JSON.stringify(replay.replies).includes('古いボタン'));
});
test('concurrent clicks draw at most one card',async()=>{
  const {c,s}=await fixture();await Promise.all([c.handle(interaction(`bj:${s.id}:0:hit`)),c.handle(interaction(`bj:${s.id}:0:hit`))]);assert.equal(s.game.player.length,3);assert.equal(s.turn,1);
});
test('stop, rematch and session expiry reject stale or invalid transitions',async()=>{
  const {c,s,time}=await fixture();await c.handle(interaction(`bj:${s.id}:0:again`));assert.equal(s.turn,0);await c.handle(interaction(`bj:${s.id}:0:stop`));assert.equal(s.game.result,'stopped');await c.handle(interaction(`bj:${s.id}:1:again`));assert.equal(s.game.phase,'playing');assert.equal(s.turn,2);const before=structuredClone(s.game);time(600001);const i=interaction(`bj:${s.id}:2:hit`);await c.handle(i);assert.deepEqual(s.game,before);assert.ok(JSON.stringify(i.replies).includes('/ゲーム'));assert.ok(!JSON.stringify(i.replies).includes('/管理'));
});
test('revoked channel access and invalid actions do not mutate a hand',async()=>{
  const {c,s,allow}=await fixture(),before=structuredClone(s.game);allow(false);const revoked=interaction(`bj:${s.id}:0:hit`);await c.handle(revoked);assert.deepEqual(s.game,before);assert.ok(!JSON.stringify(revoked.replies).includes('♠10'));allow(true);await c.handle(interaction(`bj:${s.id}:0:unknown`));assert.deepEqual(s.game,before);assert.equal(s.turn,0);
});
test('new game replaces only that user’s previous game and the command remains public',async()=>{
  const {c,s}=await fixture();await c.open(interaction('unused','other'));assert.equal(c.sessions.sessions.size,2);await c.open(interaction());assert.equal(c.sessions.sessions.size,2);await c.handle(interaction(`bj:${s.id}:0:hit`));assert.equal(s.turn,0);const command=commands().find(x=>x.name==='ゲーム').toJSON();assert.equal(command.default_member_permissions,undefined);assert.equal(command.options[0].name,'ブラックジャック');
});
