import test from 'node:test';
import assert from 'node:assert/strict';
import {casinoRound,casinoChoices,winningPayout,casinoKinds} from '../src/casino.js';
import {createCasinoController,casinoScreen,casinoRules} from '../src/casino-ui.js';
import {GameWalletStore,MAX_CHIPS} from '../src/game-wallets.js';
import {createBlackjackController,gameLobby} from '../src/blackjack-ui.js';
import {newRound} from '../src/blackjack.js';
const rng=(...n)=>()=>n.shift();
const run=(kind,choice,n,extra={})=>casinoRound({kind,choice,bet:10,balance:3000,...extra},rng(...n));
function interaction(customId='unused',user='owner',channelId='channel'){return {customId,user:{id:user},channelId,message:{flags:{has:()=>true}},replies:[],async deferReply(p){this.deferred=true;this.replies.push(p);},async deferUpdate(){this.deferred=true;},async editReply(p){this.replies.push(p);},async reply(p){this.replied=true;this.replies.push(p);}};}
const click=(prefix,s,action)=>interaction(`${prefix}:${s.id}:${s.turn}:${action}`);
async function casino(kind,random=()=>6){const wallet=new GameWalletStore(),c=createCasinoController({wallet,access:async()=>{},random});await c.open(interaction(),kind);return {c,wallet,s:[...c.sessions.sessions.values()][0]};}
test('all higher/lower ranks and wagers match their exact integer quote; no choice has positive expected profit',()=>{
  for(const bet of [10,50,100])for(let card=1;card<=13;card++)for(const choice of ['higher','same','lower']){
    const quote=winningPayout('highlow',choice,bet,card);let paid=0,wins=0;
    for(let next=1;next<=13;next++){
      if(!quote){let draws=0;assert.throws(()=>casinoRound({kind:'highlow',choice,bet,balance:3000,card},()=>{draws++;return next-1;}));assert.equal(draws,0);continue;}
      const r=run('highlow',choice,[next-1],{bet,card});const won=choice==='same'?next===card:choice==='higher'?next>card:next<card;
      assert.equal(r.payout,won?quote:0);assert.equal(r.balance,3000-bet+r.payout);paid+=r.payout;if(won)wins++;
    }
    assert.ok(paid<=13*bet);if(quote){assert.ok(paid/(13*bet)>=0.92);assert.ok(wins>0);}
  }
  for(const card of [undefined,0,14,1.5,'7',NaN])assert.throws(()=>run('highlow','higher',[0],{card}));
});
test('every animal race finish order is possible exactly once and all four animals have equal chances',()=>{
  const orders=new Set(),wins=[0,0,0,0];let payout=0;
  for(let a=0;a<4;a++)for(let b=0;b<3;b++)for(let c=0;c<2;c++){
    const r=run('race','animal0',[a,b,c]);orders.add(r.values.join());wins[r.values[0]]++;assert.equal(new Set(r.values).size,4);assert.equal(r.payout,r.values[0]===0?39:0);payout+=r.payout;
  }
  assert.equal(orders.size,24);assert.deepEqual(wins,[6,6,6,6]);assert.equal(payout/(24*10),0.975);
  for(const choice of ['animal4','animal-1','spin'])assert.throws(()=>run('race',choice,[]));
});
test('roulette outside bets win on 18 numbers each and all lose on zero',()=>{
  for(const choice of casinoChoices('roulette')){let wins=0;for(let n=0;n<=36;n++){const r=run('roulette',choice,[n]);if(n===0)assert.equal(r.payout,0);if(r.payout)wins++;}assert.equal(wins,18);}
});
test('opening blackjack is free, supports wager selection, and an explicit start cannot be replayed',async()=>{
  let deals=0;const c=createBlackjackController({access:async()=>{},deal:()=>{deals++;return newRound([...Array(52).keys()]);}});await c.open(interaction());const s=[...c.sessions.sessions.values()][0];assert.equal(c.wallet.balance('owner'),3000);assert.equal(deals,0);assert.equal(s.game.phase,'ready');assert.equal(gameLobby(s,3000).components[1].toJSON().components[0].label,'準備画面に戻る');
  await c.handle(Object.assign(click('bj',s,'bet'),{values:['100']}));const start=click('bj',s,'again');await c.handle(start);assert.equal(deals,1);assert.equal(s.roundBet,100);assert.equal(s.round,1);assert.equal(c.wallet.balance('owner'),2900);await c.handle(start);assert.equal(deals,1);assert.equal(c.wallet.balance('owner'),2900);
});
test('opening and returning to higher/lower does not redraw the reference or change balance',async()=>{
  let draws=0;const {c,s}=await casino('highlow',()=>{draws++;return 6;});assert.equal(draws,1);assert.equal(s.card,7);
  await c.handle(click('casino',s,'rules'));await c.handle(click('casino',s,'resume'));await c.handle(Object.assign(click('casino',s,'bet'),{values:['50']}));await c.open(interaction(),'slots');await c.open(interaction(),'highlow');assert.equal(draws,1);assert.equal(s.card,7);assert.equal(s.balance,3000);
  const action=click('casino',s,'same');await c.handle(action);assert.equal(s.card,7);assert.equal(s.balance,3580);assert.equal(draws,2);await c.handle(action);assert.equal(draws,2);assert.equal(s.balance,3580);
});
test('higher/lower result, next reference and wallet roll back together when saving fails',async()=>{
  const {c,s,wallet}=await casino('highlow',rng(6,12,12));wallet.save=async()=>{throw new Error('disk failed');};await c.handle(click('casino',s,'higher'));assert.equal(s.card,7);assert.equal(s.results.highlow,undefined);assert.equal(s.rounds,0);assert.equal(wallet.balance('owner'),3000);
  wallet.save=async()=>{};await c.handle(click('casino',s,'higher'));assert.equal(s.card,13);assert.equal(s.results.highlow.values[1],13);assert.equal(wallet.balance('owner'),3011);const buttons=casinoScreen(s).components[1].toJSON().components;assert.ok(buttons.find(b=>b.custom_id.endsWith(':higher')).disabled);
});
test('race replay, overflow and RNG failure cannot produce a partial settlement',async()=>{
  const {c,s,wallet}=await casino('race',()=>0);const action=click('casino',s,'animal1');await Promise.all([c.handle(action),c.handle(click('casino',s,'animal1'))]);assert.equal(s.rounds,1);assert.equal(wallet.balance('owner'),3029);await c.handle(action);assert.equal(wallet.balance('owner'),3029);
  wallet.accounts.set('owner',{balance:MAX_CHIPS,pending:null});await c.handle(click('casino',s,'animal1'));assert.equal(wallet.balance('owner'),MAX_CHIPS);assert.equal(s.rounds,1);
  let draws=0;const broken=await casino('race',()=>{if(++draws===2)throw new Error('bad RNG');return 0;});await broken.c.handle(click('casino',broken.s,'animal0'));assert.equal(broken.wallet.balance('owner'),3000);assert.equal(broken.s.rounds,0);
});
test('a cross-channel reopen cannot evict a casino session during a queued wallet commit',async()=>{
  const {c,s,wallet}=await casino('race',()=>0);let release;wallet.tail=new Promise(r=>release=r);const pending=c.handle(click('casino',s,'animal1'));await new Promise(r=>setImmediate(r));await c.open(interaction('unused','owner','other'),'slots');assert.equal(c.sessions.sessions.get(s.id),s);assert.equal(s.kind,'race');release();await pending;assert.equal(wallet.balance('owner'),3029);
});
test('every expanded game state serializes within Discord limits and quotes agree with settlement',async()=>{
  for(const kind of casinoKinds){const {s}=await casino(kind,()=>0);const choices=casinoChoices(kind);for(const bet of [10,50,100]){
    s.bet=bet;for(const card of kind==='highlow'?[1,7,13]:[undefined]){s.card=card;for(const m of [casinoScreen(s),casinoRules(s)]){m.embeds.forEach(e=>e.toJSON());assert.ok(m.components.length<=5);for(const row of m.components){const json=row.toJSON();assert.ok(json.components.length<=5);for(const component of json.components)if(component.custom_id)assert.ok(component.custom_id.length<=100);}assert.deepEqual(m.allowedMentions.parse,[]);assert.ok(m.embeds[0].toJSON().description.length<4096);assert.ok(!m.embeds[0].toJSON().description.includes('円'));}
      const m=casinoScreen(s),actions=m.components.slice(1,-1).flatMap(r=>r.toJSON().components);for(const choice of choices){const b=actions.find(b=>b.custom_id.endsWith(`:${choice}`));const quote=winningPayout(kind,choice,bet,card);assert.equal(b.disabled,!quote);if(kind!=='slots')assert.ok(b.label.includes(quote.toLocaleString('ja-JP')));}assert.equal(m.files[0].attachment.readUInt32BE(16),480);assert.equal(m.files[0].attachment.readUInt32BE(20),168);
    }
  }}
});
test('failed reference-card initialization shows a generic recovery screen and creates no paid state',async()=>{
  const c=createCasinoController({access:async()=>{},random:()=>99});const i=interaction();await c.open(i,'highlow');assert.equal(c.sessions.sessions.size,0);assert.equal(c.wallet.balance('owner'),3000);assert.equal(i.replies.at(-1).files,undefined);assert.deepEqual(i.replies.at(-1).attachments,[]);
});
const deck=(...first)=>[...Array.from({length:52},(_,n)=>n).filter(c=>!first.includes(c)),...first.reverse()];
async function doubleHand(first=[9,0,4,5,2]){const wallet=new GameWalletStore(),c=createBlackjackController({wallet,access:async()=>{},deal:()=>newRound(deck(...first))});await c.open(interaction());const s=[...c.sessions.sessions.values()][0];await c.handle(click('bj',s,'again'));return {c,s,wallet};}
test('double down draws exactly one card, doubles the stake, settles once and retains the original next-round wager',async()=>{
  const {c,s,wallet}=await doubleHand();const before=s.game.deck.length,action=click('bj',s,'double');await Promise.all([c.handle(action),c.handle(click('bj',s,'double'))]);assert.equal(s.game.player.length,3);assert.equal(s.game.deck.length,before-1);assert.equal(s.game.result,'win');assert.equal(s.roundBet,20);assert.equal(s.bet,10);assert.equal(s.payout,40);assert.equal(wallet.balance('owner'),3020);assert.equal(wallet.hasActiveBlackjack('owner'),false);await c.handle(action);assert.equal(wallet.balance('owner'),3020);assert.equal(s.stats.win,1);
});
test('double-down loss and push pay the doubled stake correctly for all allowed wagers',async()=>{
  for(const bet of [10,50,100])for(const [result,multiplier] of [['win',4],['dealer-bust',4],['push',2],['lose',0],['bust',0]]){
    const wallet=new GameWalletStore();await wallet.beginBlackjack('owner','hand',bet,null,Date.now()+600000);const r=await wallet.doubleBlackjack('owner','hand',result);assert.equal(r.payout,bet*multiplier);assert.equal(r.bet,bet*2);assert.equal(r.balance,3000-bet*2+bet*multiplier);await assert.rejects(wallet.doubleBlackjack('owner','hand',result));
  }
});
test('double down is disabled without spare chips and unavailable after a hit or while confirming stop',async()=>{
  const {c,s,wallet}=await doubleHand();wallet.accounts.get('owner').balance=5;await c.open(interaction());const b=interaction();await c.open(b);assert.ok(b.replies.at(-1).components[0].toJSON().components.find(x=>x.custom_id.endsWith(':double')).disabled);await c.handle(click('bj',s,'double'));assert.equal(s.game.phase,'playing');assert.equal(s.game.player.length,2);assert.equal(wallet.balance('owner'),5);
  wallet.accounts.get('owner').balance=2990;await c.handle(click('bj',s,'stop'));await c.handle(click('bj',s,'double'));assert.equal(s.game.player.length,2);await c.handle(click('bj',s,'resume'));await c.handle(click('bj',s,'hit'));assert.equal(s.game.player.length,3);const before=structuredClone(s.game);await c.handle(click('bj',s,'double'));assert.deepEqual(s.game,before);
});
test('double-down save failure or queued permission loss restores the complete original hand and wallet',async()=>{
  const {c,s,wallet}=await doubleHand(),before=structuredClone(s.game),turn=s.turn;wallet.save=async()=>{throw new Error('disk');};await c.handle(click('bj',s,'double'));assert.deepEqual(s.game,before);assert.equal(wallet.balance('owner'),2990);assert.equal(s.roundBet,10);assert.equal(s.turn,turn);wallet.save=async()=>{};await c.handle(click('bj',s,'double'));assert.equal(wallet.balance('owner'),3020);
  const w=new GameWalletStore();await w.beginBlackjack('owner','hand',10,null,Date.now()+600000);await assert.rejects(w.doubleBlackjack('owner','hand','win',()=>{throw new Error('revoked');}));assert.equal(w.balance('owner'),2990);assert.ok(w.hasActiveBlackjack('owner'));
});
test('double-down natural result, expired holds, invalid IDs and overflow cannot create chips',async()=>{
  let now=0;const w=new GameWalletStore(null,{now:()=>now});await w.beginBlackjack('owner','hand',100,null,100);await assert.rejects(w.doubleBlackjack('owner','hand','blackjack'));await assert.rejects(w.doubleBlackjack('owner','other','win'));assert.equal(w.balance('owner'),2900);w.accounts.get('owner').balance=MAX_CHIPS;await assert.rejects(w.doubleBlackjack('owner','hand','win'));assert.equal(w.balance('owner'),MAX_CHIPS);now=100;await assert.rejects(w.doubleBlackjack('owner','hand','win'));assert.ok(!w.hasActiveBlackjack('owner'));
});
test('game home offers a private direct return to the latest casino without resetting its reference or balance',async()=>{
  const {c:controller,s,wallet}=await casinoFixture();const bj=createBlackjackController({wallet,access:async()=>{},casinoCurrent:i=>controller.current(i)});const home=interaction();await bj.lobby(home);const rows=home.replies.at(-1).components.map(r=>r.toJSON());const back=rows.flatMap(r=>r.components).find(b=>b.custom_id?.startsWith('casino:'));assert.equal(back.label,'ハイ＆ローに戻る');assert.equal(back.custom_id,`casino:${s.id}:${s.turn}:resume`);const before=structuredClone(s);await controller.handle(interaction(back.custom_id));assert.deepEqual(s,before);
  for(const i of [interaction('unused','other'),interaction('unused','owner','other-channel')]){await bj.lobby(i);assert.ok(!JSON.stringify(i.replies).includes(s.id));}
  async function casinoFixture(){return casino('highlow',()=>6);}
});
test('session capacity protects paid hands and queued transactions instead of silently evicting them',async()=>{
  const {GameSessions}=await import('../src/game-sessions.js');let now=0;const sessions=new GameSessions(()=>now,s=>s.game?.phase==='playing');
  for(let n=0;n<200;n++){const s=sessions.create(`user${n}`);s.game={phase:'playing'};}
  const first=[...sessions.sessions.values()][0];assert.throws(()=>sessions.create('new'));assert.throws(()=>sessions.create(first.userId));assert.equal(sessions.sessions.size,200);assert.equal(sessions.sessions.get(first.id),first);
  first.game.phase='done';first.busy=true;assert.throws(()=>sessions.create('new'));first.busy=false;const latest=sessions.create('new');assert.equal(sessions.sessions.size,200);assert.ok(!sessions.sessions.has(first.id));latest.busy=true;assert.throws(()=>sessions.create('new'));now=600001;assert.equal(sessions.create('new').userId,'new');assert.equal(sessions.sessions.size,1);
});
test('a blackjack start queued for saving cannot be replaced by opening another channel',async()=>{
  const wallet=new GameWalletStore(),c=createBlackjackController({wallet,access:async()=>{},deal:()=>newRound(deck(9,8,4,6))});await c.open(interaction());const s=[...c.sessions.sessions.values()][0];let release;wallet.tail=new Promise(r=>release=r);const start=c.handle(click('bj',s,'again'));await new Promise(r=>setImmediate(r));await assert.rejects(c.open(interaction('unused','owner','other-channel')));assert.equal(c.sessions.sessions.get(s.id),s);release();await start;assert.equal(s.game.phase,'playing');assert.equal(wallet.balance('owner'),2990);assert.ok(wallet.hasActiveBlackjack('owner'));
});
test('expanded private games reject foreign owners, channels, expiry and queued permission changes',async()=>{
  for(const kind of ['highlow','race']){
    let now=0,allowed=true;const wallet=new GameWalletStore(null,{now:()=>now}),c=createCasinoController({wallet,now:()=>now,random:()=>0,access:async()=>{if(!allowed)throw new Error('revoked');}});await c.open(interaction(),kind);const s=[...c.sessions.sessions.values()][0],before=structuredClone(s),action=kind==='highlow'?'same':'animal1';
    for(const i of [interaction(`casino:${s.id}:${s.turn}:${action}`,'other'),interaction(`casino:${s.id}:${s.turn}:${action}`,'owner','other-channel')]){await c.handle(i);assert.equal(i.replies.at(-1).files,undefined);assert.ok(!i.replies.at(-1).embeds[0].toJSON().description.includes('残高'));assert.deepEqual(s,before);}
    let release;wallet.tail=new Promise(r=>release=r);const i=click('casino',s,action),job=c.handle(i);await new Promise(r=>setImmediate(r));allowed=false;release();await job;assert.equal(wallet.balance('owner'),3000);assert.equal(s.card,before.card);assert.equal(s.rounds,0);assert.equal(i.replies.at(-1).files,undefined);
    allowed=true;now=600001;const expired=click('casino',s,action);await c.handle(expired);assert.equal(expired.replies.at(-1).files,undefined);assert.equal(wallet.balance('owner'),3000);
  }
});
test('double-down controller hides the hand when permission is revoked while waiting to save',async()=>{
  let allowed=true;const wallet=new GameWalletStore(),c=createBlackjackController({wallet,access:async()=>{if(!allowed)throw new Error('revoked');},deal:()=>newRound(deck(9,0,4,5,2))});await c.open(interaction());const s=[...c.sessions.sessions.values()][0];await c.handle(click('bj',s,'again'));const before=structuredClone(s.game);let release;wallet.tail=new Promise(r=>release=r);const i=click('bj',s,'double'),job=c.handle(i);await new Promise(r=>setImmediate(r));allowed=false;release();await job;assert.deepEqual(s.game,before);assert.equal(wallet.balance('owner'),2990);assert.equal(i.replies.at(-1).files,undefined);assert.ok(!i.replies.at(-1).embeds[0].toJSON().description.includes('残高'));
});
test('memory-game sessions at capacity keep unfinished games available',async()=>{
  const {createChipTools}=await import('../src/chip-tools.js');const wallet=new GameWalletStore(),c=createChipTools({wallet,access:async()=>{}});for(let n=0;n<200;n++){const s=c.work.create(`user${n}`);s.view='watch';}const first=[...c.work.sessions.values()][0];const i=interaction('work:open');await c.handle(i);assert.equal(c.work.sessions.size,200);assert.equal(c.work.sessions.get(first.id),first);assert.ok(i.replies.at(-1).embeds[0].toJSON().description.includes('混み合'));
});
