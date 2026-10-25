import test from 'node:test';
import assert from 'node:assert/strict';
import {fourLine,dropFour,fourBot,newFour,playFour} from '../src/four.js';
import {fourImage} from '../src/four-art.js';
import {createFourController,fourScreen} from '../src/four-ui.js';
import {createBlackjackController} from '../src/blackjack-ui.js';
const blank=()=>Array(42).fill(0);
function i(customId='unused',user='owner',channelId='channel'){return {customId,user:{id:user},channelId,message:{flags:{has:()=>true}},replies:[],async deferReply(p){this.deferred=true;this.replies.push(p);},async deferUpdate(){this.deferred=true;},async editReply(p){this.replies.push(p);},async reply(p){this.replied=true;this.replies.push(p);}};}
const click=(s,a)=>i(`four:${s.id}:${s.turn}:${a}`);
async function fixture(){let now=0,allowed=true;const c=createFourController({random:()=>0,now:()=>now,access:async()=>{if(!allowed)throw new Error('revoked');}});await c.open(i());const s=[...c.sessions.sessions.values()][0];await c.handle(click(s,'user'));return {c,s,clock:x=>now=x,allow:x=>allowed=x};}
test('four detects exactly four in all directions and never wraps across row edges',()=>{
  for(const cells of [[35,36,37,38],[14,21,28,35],[14,22,30,38],[17,23,29,35]]){const b=blank();cells.forEach(c=>b[c]=1);assert.deepEqual(fourLine(b),{player:1,cells});}
  const b=blank();[5,6,7,8].forEach(c=>b[c]=2);assert.equal(fourLine(b),null);
});
test('drop follows gravity, never mutates the input, and rejects full or malformed columns',()=>{
  let b=blank();const next=dropFour(b,3,1);assert.equal(next[38],1);assert.equal(b[38],0);b=next;for(let n=0;n<5;n++)b=dropFour(b,3,n%2+1);assert.equal(b[3],1);for(const col of [3,-1,7,1.5,NaN,'3'])assert.throws(()=>dropFour(b,col,1));
});
test('bot immediately wins, blocks a winning threat, selects a legal move and validates tie randomness',()=>{
  let b=blank();[35,36,37].forEach(c=>b[c]=2);assert.equal(fourBot(b,()=>0),3);
  b=blank();[35,36,37].forEach(c=>b[c]=1);assert.equal(fourBot(b,()=>0),3);
  for(const value of [-1,99,NaN,0.5,'0'])assert.throws(()=>fourBot(blank(),()=>value));assert.equal(fourBot(blank(),()=>0),3);
});
test('start respects first player, user victory ends before bot moves, and a full board finishes drawn',()=>{
  assert.equal(newFour('user').board.filter(Boolean).length,0);const bot=newFour('bot',()=>0);assert.equal(bot.board[38],2);assert.equal(bot.board.filter(Boolean).length,1);
  const b=blank();[35,36,37].forEach(c=>b[c]=1);const won=playFour({board:b,phase:'playing',first:'user'},3,()=>{throw new Error('must not draw');});assert.equal(won.result,'win');assert.equal(won.phase,'done');assert.deepEqual(won.winning,[35,36,37,38]);assert.throws(()=>playFour(won,4,()=>0));
  const full=[2,2,1,1,2,2,2,1,1,1,2,2,1,2,2,2,1,1,1,2,1,2,1,2,2,2,1,1,2,1,2,1,1,2,2,1,1,2,2,1,1,1];assert.equal(fourLine(full),null);full[2]=0;const drawn=playFour({board:full,phase:'playing',first:'bot'},2,()=>{throw new Error('must not draw');});assert.equal(drawn.result,'draw');
});
test('complete deterministic bot games stop at a win or draw without exceeding 42 spaces',()=>{
  for(let choice=0;choice<7;choice++){let g=newFour(choice%2?'bot':'user',()=>0);for(let n=0;n<21&&g.phase==='playing';n++){const valid=Array.from({length:7},(_,c)=>c).filter(c=>g.board[c]===0),col=valid[(choice+n)%valid.length];const before=structuredClone(g);const next=playFour(g,col,()=>0);assert.deepEqual(g,before);g=next;assert.ok(g.board.filter(Boolean).length<=42);}assert.equal(g.phase,'done');assert.ok(['win','lose','draw'].includes(g.result));}
});
test('four is private, free, menu-routed, resumes and serializes with a small indexed board',async()=>{
  const f=await fixture(),bj=createBlackjackController({access:async()=>{},openFour:x=>f.c.open(x)});await bj.handle(Object.assign(i('game:select'),{values:['four']}));assert.equal(f.c.sessions.sessions.size,1);await f.c.handle(click(f.s,'col-3'));const m=fourScreen(f.s);assert.ok(m.embeds[0].toJSON().description.includes('無料'));assert.ok(m.files[0].description.includes('1行目'));assert.equal(m.files[0].attachment[25],3);assert.ok(m.files[0].attachment.length<8192);m.components.forEach(r=>assert.ok(r.toJSON().components.length<=5));assert.deepEqual(m.allowedMentions.parse,[]);assert.ok(m.components.length<=5);assert.equal(fourImage(f.s.game).readUInt32BE(16),480);assert.equal(fourImage(f.s.game).readUInt32BE(20),360);
});
test('foreign owner, channel, expired buttons and permission changes never expose or change the private board',async()=>{
  const f=await fixture(),before=structuredClone(f.s.game);for(const x of [i(`four:${f.s.id}:${f.s.turn}:col-3`,'other'),i(`four:${f.s.id}:${f.s.turn}:resume`,'owner','other-channel')]){await f.c.handle(x);assert.equal(x.replies.at(-1).files,undefined);assert.deepEqual(f.s.game,before);}
  f.allow(false);await f.c.handle(click(f.s,'col-3'));assert.deepEqual(f.s.game,before);f.allow(true);f.clock(600001);await f.c.handle(click(f.s,'col-3'));assert.deepEqual(f.s.game,before);
});
test('simultaneous and stale moves advance once, restart invalidates old moves and RNG failure is atomic',async()=>{
  const f=await fixture(),a=click(f.s,'col-3');await Promise.all([f.c.handle(a),f.c.handle(click(f.s,'col-3'))]);assert.equal(f.s.game.board.filter(Boolean).length,2);await f.c.handle(a);assert.equal(f.s.game.board.filter(Boolean).length,2);await f.c.handle(click(f.s,'again'));assert.equal(f.s.game.phase,'ready');await f.c.handle(a);assert.equal(f.s.game.phase,'ready');
  const c=createFourController({access:async()=>{},random:()=>99});await c.open(i());const s=[...c.sessions.sessions.values()][0];await c.handle(click(s,'user'));const before=structuredClone(s.game);await c.handle(click(s,'col-3'));assert.deepEqual(s.game,before);assert.equal(s.turn,1);
});
test('revocation after bot computation cannot publish a new position, and failed sends resume the committed board',async()=>{
  let calls=0;const c=createFourController({random:()=>0,access:async()=>{if(++calls===5)throw new Error('revoked');}});await c.open(i());const s=[...c.sessions.sessions.values()][0];await c.handle(click(s,'user'));const before=structuredClone(s.game);await c.handle(click(s,'col-3'));assert.deepEqual(s.game,before);const x=click(s,'col-3');let first=true;x.editReply=async p=>{if(first){first=false;throw new Error('network');}x.replies.push(p);};await c.handle(x);assert.equal(s.game.board.filter(Boolean).length,2);await c.open(i());assert.equal(s.game.board.filter(Boolean).length,2);
});
