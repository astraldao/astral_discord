import test from 'node:test';
import assert from 'node:assert/strict';
import {bankerDraws,baccaratDeal,baccaratPoint,baccaratTotal} from '../src/baccarat.js';
import {casinoRound} from '../src/casino.js';
import {casinoImage} from '../src/casino-art.js';
import {createCasinoController,casinoScreen} from '../src/casino-ui.js';
import {newRps,playRps,rpsChoices} from '../src/rps.js';
import {createRpsController,rpsScreen} from '../src/rps-ui.js';
import {createBlackjackController} from '../src/blackjack-ui.js';
import {GameWalletStore,MAX_CHIPS} from '../src/game-wallets.js';
function forced(...cards){const shoe=Array.from({length:416},(_,n)=>n%52);return max=>{assert.equal(max,shoe.length);const i=shoe.indexOf(cards.shift());assert.ok(i>=0);shoe.splice(i,1);return i;};}
function i(customId='unused',user='owner',channelId='channel'){return {customId,user:{id:user},channelId,message:{flags:{has:()=>true}},replies:[],async deferReply(p){this.deferred=true;this.replies.push(p);},async deferUpdate(){this.deferred=true;},async editReply(p){this.replies.push(p);},async reply(p){this.replied=true;this.replies.push(p);}};}
const click=(prefix,s,action)=>i(`${prefix}:${s.id}:${s.turn}:${action}`);
const run=(choice,cards,bet=10)=>casinoRound({kind:'baccarat',choice,bet,balance:3000},forced(...cards));
test('baccarat point values and all banker third-card table entries match the rules',()=>{
  for(let suit=0;suit<4;suit++)for(let rank=1;rank<=13;rank++)assert.equal(baccaratPoint(suit*13+rank-1),rank>=10?0:rank);
  assert.equal(baccaratTotal([8,7]),7);
  const thirdCards=[[0,1,2,3,4,5,6,7,8,9],[0,1,2,3,4,5,6,7,8,9],[0,1,2,3,4,5,6,7,8,9],[0,1,2,3,4,5,6,7,9],[2,3,4,5,6,7],[4,5,6,7],[6,7],[],[],[]];
  for(let b=0;b<=9;b++){assert.equal(bankerDraws(b,undefined),b<=5);for(let third=0;third<=9;third++)assert.equal(bankerDraws(b,third),thirdCards[b].includes(third));}
});
test('baccarat stops either natural and otherwise applies player and banker third-card rules in deal order',()=>{
  for(const [cards,p,b] of [[[8,2,9,2],9,6],[[2,7,2,9],6,8]]){const h=baccaratDeal(forced(...cards));assert.equal(h.playerTotal,p);assert.equal(h.bankerTotal,b);assert.equal(h.player.length+h.banker.length,4);}
  const h=baccaratDeal(forced(9,0,12,1,7));assert.equal(h.player.length,3);assert.equal(h.banker.length,2);assert.equal(h.playerTotal,8);assert.equal(h.bankerTotal,3);
  const drawn=baccaratDeal(forced(9,0,12,1,6,3));assert.equal(drawn.player.length,3);assert.equal(drawn.banker.length,3);assert.equal(drawn.bankerTotal,7);
  const stood=baccaratDeal(forced(2,9,2,12,4));assert.equal(stood.player.length,2);assert.equal(stood.banker.length,3);
});
test('baccarat payouts include stake, banker six pays half profit, ties refund either side',()=>{
  for(const bet of [10,50,100]){
    assert.equal(run('player',[8,2,9,2],bet).payout,bet*2);
    assert.equal(run('banker',[9,2,12,2,9],bet).payout,bet*1.5);
    assert.equal(run('banker',[2,7,2,9],bet).payout,bet*2);
    for(const choice of ['player','banker','tie']){const r=run(choice,[2,2,2,2],bet);assert.equal(r.outcome,'tie');assert.equal(r.payout,bet*(choice==='tie'?9:1));assert.equal(r.balance,3000-bet+r.payout);}
    assert.equal(run('tie',[8,2,9,2],bet).payout,0);
  }
});
test('baccarat RNG range failure and overflow never mutate shared wallet',async()=>{
  const w=new GameWalletStore();await assert.rejects(w.playCasino('owner',{kind:'baccarat',choice:'player',bet:10},()=>416));assert.equal(w.balance('owner'),3000);
  w.accounts.set('owner',{balance:MAX_CHIPS,pending:null});await assert.rejects(w.playCasino('owner',{kind:'baccarat',choice:'player',bet:10},forced(8,2,9,2)));assert.equal(w.balance('owner'),MAX_CHIPS);
  for(const value of [-1,NaN,1.5,'0'])assert.throws(()=>baccaratDeal(()=>value));
});
test('baccarat controller settles once, save failure preserves result and owner privacy',async()=>{
  const w=new GameWalletStore(),c=createCasinoController({wallet:w,access:async()=>{},random:()=>0});await c.open(i(),'baccarat');const s=[...c.sessions.sessions.values()][0],a=click('casino',s,'player');await Promise.all([c.handle(a),c.handle(click('casino',s,'player'))]);assert.equal(s.rounds,1);assert.equal(w.balance('owner'),3010);await c.handle(a);assert.equal(s.rounds,1);
  for(const x of [i(`casino:${s.id}:${s.turn}:player`,'other'),i(`casino:${s.id}:${s.turn}:player`,'owner','other')]){await c.handle(x);assert.equal(x.replies.at(-1).files,undefined);assert.ok(!x.replies.at(-1).embeds[0].toJSON().description.includes('残高'));}
  const before=structuredClone(s.results);w.save=async()=>{throw new Error('disk');};await c.handle(click('casino',s,'player'));assert.equal(w.balance('owner'),3010);assert.deepEqual(s.results,before);
});
test('baccarat card board is compact, distinct and accessible for ready and finished states',()=>{
  const r=run('player',[8,2,9,2]),png=casinoImage('baccarat',r);assert.equal(png.readUInt32BE(16),480);assert.equal(png.readUInt32BE(20),264);assert.ok(png.length<8192);assert.notDeepEqual(png,casinoImage('baccarat'));
  const m=casinoScreen({id:'id',turn:1,kind:'baccarat',bet:10,balance:3010,results:{baccarat:r}});assert.ok(m.files[0].description.includes('9点'));assert.ok(m.embeds[0].toJSON().description.includes('1.5倍'));assert.ok(m.embeds[0].toJSON().description.includes('プレイヤー 9点'));
});
test('every rock-paper-scissors matchup is correct; first to two ends early and three draws finish',()=>{
  for(let user=0;user<3;user++)for(let bot=0;bot<3;bot++){const g=playRps(newRps(),rpsChoices[user],()=>bot);assert.equal(g.rounds[0].result,user===bot?'draw':[[0,1],[1,2],[2,0]].some(([u,b])=>u===user&&b===bot)?'win':'lose');}
  let g=newRps();for(let n=0;n<2;n++)g=playRps(g,'rock',()=>1);assert.equal(g.phase,'done');assert.equal(g.result,'win');assert.equal(g.rounds.length,2);assert.throws(()=>playRps(g,'rock',()=>1));
  g=newRps();for(let n=0;n<3;n++)g=playRps(g,'rock',()=>0);assert.equal(g.phase,'done');assert.equal(g.result,'draw');
  g=playRps(newRps(),'rock',()=>1);g=playRps(g,'rock',()=>2);g=playRps(g,'rock',()=>0);assert.equal(g.result,'draw');
});
test('rps is immutable, validates choice and RNG, and has no rewards',()=>{
  const g=newRps();for(const choice of ['bad','__proto__',undefined])assert.throws(()=>playRps(g,choice,()=>0));for(const value of [-1,3,NaN,1.5,'0'])assert.throws(()=>playRps(g,'rock',()=>value));assert.deepEqual(g,newRps());assert.deepEqual(Object.keys(playRps(g,'rock',()=>0)).sort(),['losses','phase','rounds','wins']);
});
test('rps menu routes to free controller, serialized UI stays small and owner-only',async()=>{
  const c=createRpsController({access:async()=>{},random:()=>1}),bj=createBlackjackController({access:async()=>{},openCasual:x=>c.open(x)});await bj.handle(Object.assign(i('game:select'),{values:['rps']}));const s=[...c.sessions.sessions.values()][0];assert.equal(s.game.rounds.length,0);const m=rpsScreen(s);assert.equal(m.files,undefined);assert.ok(m.embeds[0].toJSON().description.includes('無料'));assert.ok(m.components.length<=5);assert.deepEqual(m.allowedMentions.parse,[]);assert.ok(JSON.stringify(m).length<4096);
});
test('rps replay and concurrent clicks progress once; reopen resumes and new match resets safely',async()=>{
  const c=createRpsController({access:async()=>{},random:()=>1});await c.open(i());const s=[...c.sessions.sessions.values()][0],a=click('rps',s,'rock');await Promise.all([c.handle(a),c.handle(click('rps',s,'rock'))]);assert.equal(s.game.rounds.length,1);await c.handle(a);assert.equal(s.game.rounds.length,1);await c.open(i());assert.equal(c.sessions.sessions.size,1);assert.equal(s.game.rounds.length,1);await c.handle(click('rps',s,'again'));assert.equal(s.game.rounds.length,1);await c.handle(click('rps',s,'rock'));assert.equal(s.game.result,'win');await c.handle(click('rps',s,'again'));assert.deepEqual(s.game,newRps());await c.handle(a);assert.equal(s.game.rounds.length,0);
});
test('rps rejects foreign owner, other channel, expiry, and permission loss without exposing history',async()=>{
  let now=0,allowed=true;const c=createRpsController({now:()=>now,random:()=>1,access:async()=>{if(!allowed)throw new Error('revoked');}});await c.open(i());const s=[...c.sessions.sessions.values()][0];await c.handle(click('rps',s,'rock'));const before=structuredClone(s.game);
  for(const x of [i(`rps:${s.id}:${s.turn}:rock`,'other'),i(`rps:${s.id}:${s.turn}:resume`,'owner','other')]){await c.handle(x);assert.deepEqual(s.game,before);assert.ok(!JSON.stringify(x.replies).includes('今回の勝負'));}
  allowed=false;await c.handle(click('rps',s,'rock'));assert.deepEqual(s.game,before);allowed=true;now=600001;await c.handle(click('rps',s,'rock'));assert.deepEqual(s.game,before);
});
test('rps computation or revalidation failure does not consume a turn; send failure can resume result',async()=>{
  let calls=0,deny=false;const c=createRpsController({random:()=>{if(deny)throw new Error('rng');return 1;},access:async()=>{if(++calls===4)throw new Error('revoked');}});await c.open(i());const s=[...c.sessions.sessions.values()][0];await c.handle(click('rps',s,'rock'));assert.equal(s.turn,1);const before=structuredClone(s.game);await c.handle(click('rps',s,'rock'));assert.deepEqual(s.game,before);assert.equal(s.turn,1);deny=true;await c.handle(click('rps',s,'rock'));assert.deepEqual(s.game,before);deny=false;
  const x=click('rps',s,'rock');let first=true;x.editReply=async p=>{if(first){first=false;throw new Error('network');}x.replies.push(p);};await c.handle(x);assert.equal(s.game.phase,'done');await c.open(i());assert.equal(s.game.result,'win');
});
