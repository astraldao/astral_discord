import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageFlags} from 'discord.js';
import {newRound,handValue,play,shuffledDeck} from '../src/blackjack.js';
import {createBlackjackController,blackjackScreen} from '../src/blackjack-ui.js';
import {blackjackImage} from '../src/blackjack-art.js';
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
  const game=newRound(deck(9,8,4,12)),s={id:'session',turn:0,game};const screen=blackjackScreen(s);assert.ok(screen.files[0].description.includes('♠9・伏せたカード'));assert.ok(!screen.files[0].description.includes('♠K'));assert.deepEqual(blackjackImage(game),blackjackImage({...game,dealer:[8,6]}));assert.deepEqual(screen.allowedMentions.parse,[]);play(game,'stop');const done=blackjackScreen(s);assert.ok(done.files[0].description.includes('♠K'));assert.notDeepEqual(done.files[0].attachment,screen.files[0].attachment);for(const m of [screen,done]){const png=m.files[0].attachment;assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(png.readUInt32BE(16),480);assert.equal(png.readUInt32BE(20),264);assert.equal(m.embeds[0].toJSON().image.url,'attachment://blackjack.png');assert.ok(m.embeds[0].toJSON().description.length<4096);assert.ok(m.components.length<=5);for(const r of m.components)r.toJSON();}
});
function interaction(customId='unused',user='owner'){return {customId,user:{id:user},channelId:'channel',message:{flags:{has:()=>true}},replies:[],async deferReply(p){this.deferred=true;this.replies.push(p);},async deferUpdate(){this.deferred=true;},async editReply(p){this.replies.push(p);},async reply(p){this.replied=true;this.replies.push(p);}};}
async function fixture(){let clock=0,allowed=true;const c=createBlackjackController({now:()=>clock,deal:()=>newRound(deck(9,8,4,6,1,2)),access:async()=>{if(!allowed)throw new Error('閲覧権限なし');}}),open=interaction();await c.open(open);const s=[...c.sessions.sessions.values()][0];await c.handle(interaction(`bj:${s.id}:0:again`));return {c,s,open,time:v=>clock=v,allow:v=>allowed=v};}
test('ordinary members can play privately; foreign users and channels cannot mutate or read a game',async()=>{
  const {c,s}=await fixture();const publicClick=interaction('game:select','public');publicClick.values=['blackjack'];publicClick.message.flags.has=()=>false;await c.handle(publicClick);assert.equal(publicClick.replies[0].flags,MessageFlags.Ephemeral);const before=structuredClone(s.game);for(const i of [interaction(`bj:${s.id}:1:hit`,'other'),Object.assign(interaction(`bj:${s.id}:1:hit`),{channelId:'other-channel'})]){await c.handle(i);assert.deepEqual(s.game,before);assert.ok(!JSON.stringify(i.replies).includes('♠10'));}
});
test('replayed buttons do not draw again; current game remains available',async()=>{
  const {c,s}=await fixture(),i=interaction(`bj:${s.id}:1:hit`);await c.handle(i);assert.equal(s.game.player.length,3);assert.equal(s.turn,2);const replay=interaction(`bj:${s.id}:1:hit`);await c.handle(replay);assert.equal(s.game.player.length,3);assert.ok(replay.replies.at(-1).components.length>0);assert.ok(JSON.stringify(replay.replies).includes('最新の状態'));
});
test('concurrent clicks draw at most one card',async()=>{
  const {c,s}=await fixture();await Promise.all([c.handle(interaction(`bj:${s.id}:1:hit`)),c.handle(interaction(`bj:${s.id}:1:hit`))]);assert.equal(s.game.player.length,3);assert.equal(s.turn,2);
});
test('stop, rematch and session expiry reject stale or invalid transitions',async()=>{
  const {c,s,time}=await fixture();await c.handle(interaction(`bj:${s.id}:1:again`));assert.equal(s.turn,1);await c.handle(interaction(`bj:${s.id}:1:stop`));assert.equal(s.game.phase,'playing');await c.handle(interaction(`bj:${s.id}:2:confirm-stop`));assert.equal(s.game.result,'stopped');await c.handle(interaction(`bj:${s.id}:3:again`));assert.equal(s.game.phase,'playing');assert.equal(s.turn,4);const before=structuredClone(s.game);time(600001);const i=interaction(`bj:${s.id}:4:hit`);await c.handle(i);assert.deepEqual(s.game,before);assert.ok(JSON.stringify(i.replies).includes('/menu → ゲーム'));assert.ok(!JSON.stringify(i.replies).includes('/admin'));
});
test('revoked channel access and invalid actions do not mutate a hand',async()=>{
  const {c,s,allow}=await fixture(),before=structuredClone(s.game);allow(false);const revoked=interaction(`bj:${s.id}:1:hit`);await c.handle(revoked);assert.deepEqual(s.game,before);assert.ok(!JSON.stringify(revoked.replies).includes('♠10'));allow(true);await c.handle(interaction(`bj:${s.id}:1:unknown`));assert.deepEqual(s.game,before);assert.equal(s.turn,1);
});
test('opening the command resumes that user’s game and the command remains public',async()=>{
  const {c,s}=await fixture();await c.open(interaction('unused','other'));assert.equal(c.sessions.sessions.size,2);await c.open(interaction());assert.equal(c.sessions.sessions.size,2);await c.handle(interaction(`bj:${s.id}:1:hit`));assert.equal(s.turn,2);await c.open(interaction());assert.equal(s.turn,2);const command=commands().find(x=>x.name==='menu').toJSON();assert.equal(command.default_member_permissions,undefined);assert.ok(command.options[0].choices.some(c=>c.value==='game'));
});

test('rules open in a separate private reply and returning does not draw or record',async()=>{
  const {c,s}=await fixture(),before=structuredClone(s.game);const i=interaction(`bj:${s.id}:1:rules`);await c.handle(i);assert.equal(i.replies[0].flags,MessageFlags.Ephemeral);assert.ok(JSON.stringify(i.replies).includes('遊び方'));assert.deepEqual(s.game,before);assert.equal(s.turn,1);await c.handle(interaction(`bj:${s.id}:1:resume`));assert.deepEqual(s.game,before);assert.deepEqual(s.stats,{win:0,lose:0,draw:0});
});
test('stop confirmation can be cancelled and stale confirmations cannot end play',async()=>{
  const {c,s}=await fixture();await c.handle(interaction(`bj:${s.id}:1:stop`));assert.equal(s.confirmStop,true);await c.handle(interaction(`bj:${s.id}:2:resume`));assert.equal(s.confirmStop,false);await c.handle(interaction(`bj:${s.id}:2:confirm-stop`));assert.equal(s.game.phase,'playing');assert.equal(s.turn,3);await c.handle(interaction(`bj:${s.id}:3:stop`));await c.handle(interaction(`bj:${s.id}:4:confirm-stop`));assert.equal(s.game.result,'stopped');assert.deepEqual(s.stats,{win:0,lose:0,draw:0});
});
test('completed rounds count once and rematches retain scores while renewing the expiry',async()=>{
  let clock=0;const c=createBlackjackController({now:()=>clock,access:async()=>{},deal:()=>newRound(deck(9,0,7,5))});await c.open(interaction());const s=[...c.sessions.sessions.values()][0];await c.handle(interaction(`bj:${s.id}:0:again`));await c.handle(interaction(`bj:${s.id}:1:stand`));assert.equal(s.stats.win,1);await c.handle(interaction(`bj:${s.id}:1:stand`));assert.equal(s.stats.win,1);clock=500000;await c.handle(interaction(`bj:${s.id}:2:again`));assert.equal(s.round,2);assert.equal(s.expires,1100000);assert.equal(s.stats.win,1);await c.handle(interaction(`bj:${s.id}:3:stand`));assert.equal(s.stats.win,2);
});
test('expired screens have a working button to start again without another command',async()=>{
  const {c,s,time}=await fixture();time(600001);const expired=interaction(`bj:${s.id}:1:hit`);await c.handle(expired);assert.equal(expired.replies.at(-1).components[0].toJSON().components[0].custom_id,'game:open');await c.handle(interaction('game:open'));const select=interaction('game:select');select.values=['blackjack'];await c.handle(select);const latest=[...c.sessions.sessions.values()][0];assert.notEqual(latest.id,s.id);assert.equal(latest.game.phase,'ready');
});

test('game lobby uses a dropdown without dealing and back navigation preserves the round',async()=>{
  let deals=0;const c=createBlackjackController({access:async()=>{},deal:()=>{deals++;return newRound(deck(9,8,4,6,1,2));}});const lobby=interaction();delete lobby.message;await c.lobby(lobby);assert.equal(lobby.replies[0].flags,MessageFlags.Ephemeral);assert.equal(deals,0);assert.equal(lobby.replies.at(-1).components[0].toJSON().components[0].custom_id,'game:select');const select=()=>Object.assign(interaction('game:select'),{values:['blackjack']});await c.handle(select());const s=[...c.sessions.sessions.values()][0];await c.handle(interaction(`bj:${s.id}:0:again`));await c.handle(interaction(`bj:${s.id}:1:hit`));const before=structuredClone(s.game),back=interaction('game:open');await c.handle(back);assert.deepEqual(back.replies.at(-1).attachments,[]);assert.equal(back.replies.at(-1).files,undefined);await c.handle(select());assert.equal(deals,1);assert.deepEqual(s.game,before);assert.equal(s.turn,2);
});
test('invalid game selection and revoked access do not deal or retain an image',async()=>{
  const {c,s,allow}=await fixture(),before=structuredClone(s.game);for(const values of [[],['unknown'],['blackjack','blackjack']]){const i=Object.assign(interaction('game:select'),{values});await c.handle(i);assert.deepEqual(i.replies.at(-1).attachments,[]);assert.equal(c.sessions.sessions.size,1);}allow(false);const i=Object.assign(interaction('game:select'),{values:['blackjack']});await c.handle(i);assert.equal(i.replies.at(-1).files,undefined);assert.deepEqual(i.replies.at(-1).attachments,[]);assert.deepEqual(s.game,before);
});

test('lobby offers the owner a direct return without showing other users or expired games',async()=>{
  const {c,s,time}=await fixture();let i=interaction('game:open');await c.handle(i);assert.equal(i.replies.at(-1).components[1].toJSON().components[0].label,'続きから遊ぶ');const before=structuredClone(s.game);await c.handle(interaction(i.replies.at(-1).components[1].toJSON().components[0].custom_id));assert.deepEqual(s.game,before);i=interaction('game:open','other');await c.handle(i);assert.equal(i.replies.at(-1).components.length,3);assert.ok(!JSON.stringify(i.replies).includes(s.id));await c.handle(interaction(`bj:${s.id}:1:stand`));i=interaction('game:open');await c.handle(i);assert.equal(i.replies.at(-1).components[1].toJSON().components[0].label,'前の結果を見る');time(600001);i=interaction('game:open');await c.handle(i);assert.equal(i.replies.at(-1).components.length,3);
});
test('playing and completed screens keep compact distinct primary actions',()=>{
  const s={id:'session',turn:0,game:newRound(deck(9,8,4,6,1,2))};let screen=blackjackScreen(s);assert.equal(screen.components.length,2);let actions=screen.components[0].toJSON().components;assert.equal(actions[0].style,1);assert.equal(actions[1].style,2);assert.equal(screen.components[1].toJSON().components.at(-1).custom_id,'game:open');play(s.game,'stand');screen=blackjackScreen(s);assert.equal(screen.components.length,1);assert.equal(screen.components[0].toJSON().components.at(-1).custom_id,'game:open');
});
