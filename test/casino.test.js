import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageFlags} from 'discord.js';
import {casinoRound,rouletteColor,casinoKinds} from '../src/casino.js';
import {createCasinoController,casinoScreen,casinoRules} from '../src/casino-ui.js';
import {createBlackjackController,gameLobby} from '../src/blackjack-ui.js';
import {casinoImage} from '../src/casino-art.js';
const random=(...values)=>()=>values.shift();
const run=(kind,choice,values,bet=10,balance=1000)=>casinoRound({kind,choice,bet,balance},random(...values));
function interaction(customId='unused',user='owner'){return {customId,user:{id:user},channelId:'channel',message:{flags:{has:()=>true}},replies:[],async deferReply(p){this.deferred=true;this.replies.push(p);},async deferUpdate(){this.deferred=true;},async editReply(p){this.replies.push(p);},async reply(p){this.replied=true;this.replies.push(p);}};}
async function fixture(kind='slots',rng=()=>0){let clock=0,allowed=true;const c=createCasinoController({now:()=>clock,random:rng,access:async()=>{if(!allowed)throw new Error('閲覧権限なし');}}),i=interaction();delete i.message;await c.open(i,kind);const s=[...c.sessions.sessions.values()][0];return {c,s,i,time:v=>clock=v,allow:v=>allowed=v};}
const click=(s,action,user='owner')=>interaction(`casino:${s.id}:${s.turn}:${action}`,user);
test('slot payouts cover every outcome; total payout includes the stake',()=>{
  assert.deepEqual(run('slots','spin',[2,2,2]),{kind:'slots',choice:'spin',values:[2,2,2],outcome:'triple',bet:10,payout:200,delta:190,balance:1190});assert.equal(run('slots','spin',[0,1,0]).balance,1000);assert.equal(run('slots','spin',[0,1,2]).balance,990);
  const counts={triple:0,pair:0,miss:0};let payout=0;for(let a=0;a<6;a++)for(let b=0;b<6;b++)for(let c=0;c<6;c++){const r=run('slots','spin',[a,b,c]);counts[r.outcome]++;payout+=r.payout;}assert.deepEqual(counts,{triple:6,pair:90,miss:120});assert.equal(payout,2100);
});
test('roulette has 18 red, 18 black and one zero; zero never wins red or black',()=>{
  const counts={red:0,black:0,green:0};for(let n=0;n<37;n++){counts[rouletteColor(n)]++;for(const choice of ['red','black']){const r=run('roulette',choice,[n],100);assert.equal(r.payout,rouletteColor(n)===choice?200:0);}}assert.deepEqual(counts,{red:18,black:18,green:1});assert.equal(run('roulette','red',[0]).balance,990);
});
test('dice enumerates all 36 pairs and dice payouts match quoted amounts',()=>{
  const counts={low:0,seven:0,high:0};for(let a=0;a<6;a++)for(let b=0;b<6;b++){const outcome=a+b+2<7?'low':a+b+2>7?'high':'seven';counts[outcome]++;for(const choice of ['low','seven','high']){const r=run('dice',choice,[a,b],50);assert.equal(r.payout,choice===outcome?(choice==='seven'?290:115):0);assert.ok(r.values.every(n=>n>=1&&n<=6));}}assert.deepEqual(counts,{low:15,seven:6,high:15});
});
test('invalid kind, choice, bet or wallet rejects before any random draw',()=>{
  let draws=0;const options={kind:'slots',choice:'spin',bet:10,balance:1000};for(const patch of [{kind:'unknown'},{choice:'red'},{bet:0},{bet:20},{bet:10.5},{bet:'10'},{balance:9},{balance:-1},{balance:Infinity},{balance:Number.MAX_SAFE_INTEGER+1}])assert.throws(()=>casinoRound({...options,...patch},()=>{draws++;return 0;}));assert.equal(draws,0);assert.throws(()=>casinoRound(options,()=>6));assert.throws(()=>casinoRound(options,()=>-1));assert.throws(()=>casinoRound(options,()=>NaN));assert.throws(()=>casinoRound({...options,balance:Number.MAX_SAFE_INTEGER},()=>0));assert.equal(options.balance,1000);
});
test('game dropdown contains six games and delegates selection without dealing blackjack',async()=>{
  const casino=createCasinoController({access:async()=>{}});let dealt=0;const bj=createBlackjackController({access:async()=>{},deal:()=>{dealt++;throw new Error('not called');},openCasino:(i,kind)=>casino.open(i,kind)});const options=gameLobby().components[0].toJSON().components[0].options;assert.deepEqual(options.map(x=>x.value),['blackjack',...casinoKinds,'rps']);for(const kind of ['slots','roulette','dice'])await bj.handle(Object.assign(interaction('game:select'),{values:[kind]}));assert.equal(dealt,0);assert.equal(bj.sessions.sessions.size,0);assert.equal(casino.sessions.sessions.size,1);assert.equal([...casino.sessions.sessions.values()][0].balance,3000);
});
test('wallet stays shared across game switches and previous outcomes are retained',async()=>{
  const {c,s}=await fixture('slots');await c.handle(click(s,'spin'));assert.equal(s.balance,3190);const slots=structuredClone(s.results.slots);await c.open(interaction(),'roulette');assert.equal(s.kind,'roulette');await c.handle(click(s,'black'));assert.equal(s.balance,3180);await c.open(interaction(),'dice');await c.handle(click(s,'low'));assert.equal(s.balance,3193);await c.open(interaction(),'slots');assert.deepEqual(s.results.slots,slots);assert.equal(s.balance,3193);assert.equal(c.sessions.sessions.size,1);
});
test('private commands, public forged buttons, foreign owners and channels never reveal another wallet',async()=>{
  const {c,s,i}=await fixture();assert.equal(i.replies[0].flags,MessageFlags.Ephemeral);const state=structuredClone(s);for(const foreign of [click(s,'spin','other'),Object.assign(click(s,'spin'),{channelId:'other-channel'})]){await c.handle(foreign);assert.deepEqual(s,state);const m=foreign.replies.at(-1);assert.equal(m.files,undefined);assert.deepEqual(m.attachments,[]);}const publicClick=click(s,'spin');publicClick.message.flags.has=()=>false;await c.handle(publicClick);assert.equal(publicClick.replies[0].flags,MessageFlags.Ephemeral);
});
test('replayed and concurrent rounds charge and pay exactly once',async()=>{
  const {c,s}=await fixture('slots',()=>0),id=`casino:${s.id}:${s.turn}:spin`;await Promise.all([c.handle(interaction(id)),c.handle(interaction(id))]);assert.equal(s.balance,3190);assert.equal(s.rounds,1);const replay=interaction(id);await c.handle(replay);assert.equal(s.balance,3190);assert.equal(s.rounds,1);assert.ok(replay.replies.at(-1).embeds[0].toJSON().description.includes('最新の状態'));
});
test('bet change invalidates previous buttons and malformed values cannot change the stake',async()=>{
  const {c,s}=await fixture();const old=click(s,'spin');await c.handle(Object.assign(click(s,'bet'),{values:['50']}));assert.equal(s.bet,50);await c.handle(old);assert.equal(s.balance,3000);assert.equal(s.rounds,0);for(const values of [[],['20'],['1e2'],['50','100']])await c.handle(Object.assign(click(s,'bet'),{values}));assert.equal(s.bet,50);await c.handle(click(s,'spin'));assert.equal(s.balance,3950);
});
test('revoked permission and expiry cannot spend or return private outcomes',async()=>{
  const {c,s,allow,time}=await fixture(),before=structuredClone(s);allow(false);let i=click(s,'spin');await c.handle(i);assert.equal(s.balance,before.balance);assert.equal(s.rounds,0);assert.equal(i.replies.at(-1).files,undefined);allow(true);time(600001);i=click(s,'spin');await c.handle(i);assert.equal(s.balance,3000);assert.equal(i.replies.at(-1).files,undefined);assert.deepEqual(i.replies.at(-1).attachments,[]);await c.open(interaction(),'dice');assert.notEqual([...c.sessions.sessions.values()][0].id,s.id);
});
test('failure during RNG leaves balance and round untouched',async()=>{
  const {c,s}=await fixture('slots',()=>{throw new Error('抽選失敗');});await c.handle(click(s,'spin'));assert.equal(s.balance,3000);assert.equal(s.rounds,0);assert.equal(s.results.slots,undefined);assert.equal(s.busy,false);
});
test('rules and returning do not roll, charge or pay; accepted rounds renew expiry',async()=>{
  const {c,s,time}=await fixture();const before=structuredClone(s);let i=click(s,'rules');await c.handle(i);assert.equal(i.replies[0].flags,MessageFlags.Ephemeral);assert.ok(i.replies.at(-1).embeds[0].toJSON().description.includes('掛けチップを含む合計'));await c.handle(click(s,'resume'));assert.equal(s.balance,before.balance);assert.equal(s.turn,before.turn);assert.equal(s.rounds,0);time(500000);await c.handle(click(s,'spin'));assert.equal(s.expires,1100000);
});
test('bankruptcy offers free work and old refill buttons cannot reset the wallet',async()=>{
  const {c,s}=await fixture('roulette');s.bet=100;for(let n=0;n<30;n++)await c.handle(click(s,'red'));assert.equal(s.balance,0);const screen=casinoScreen(s);assert.ok(screen.components[1].toJSON().components.every(x=>x.disabled));assert.ok(screen.components.at(-1).toJSON().components.some(x=>x.custom_id==='work:open'));for(const action of ['red','refill','confirm-refill'])await c.handle(click(s,action));assert.equal(c.wallet.balance(s.userId),0);
});
test('stake exceeding balance disables play but can be lowered without a refill',async()=>{
  const {c,s}=await fixture();c.wallet.accounts.set(s.userId,{balance:30,pending:null});s.balance=30;s.bet=100;let screen=casinoScreen(s);assert.ok(screen.components[1].toJSON().components[0].disabled);assert.ok(screen.embeds[0].toJSON().description.includes('残高以内'));await c.handle(Object.assign(click(s,'bet'),{values:['10']}));screen=casinoScreen(s);assert.equal(screen.components[1].toJSON().components[0].disabled,false);await c.handle(click(s,'spin'));assert.equal(s.balance,220);
});
test('every casino screen fits builder limits and PNG images carry readable outcome descriptions',async()=>{
  const {s}=await fixture();for(const kind of ['slots','roulette','dice']){s.kind=kind;const choice=kind==='slots'?'spin':kind==='roulette'?'red':'seven';s.results[kind]=run(kind,choice,kind==='slots'?[0,1,2]:kind==='roulette'?[36]:[0,5]);for(const m of [casinoScreen(s),casinoRules(s)]){assert.deepEqual(m.allowedMentions.parse,[]);m.embeds.forEach(x=>x.toJSON());assert.ok(m.components.length<=5);m.components.forEach(x=>x.toJSON());assert.ok(m.embeds[0].toJSON().description.length<4096);}const m=casinoScreen(s);assert.ok(m.files[0].description.length>0);const png=casinoImage(kind,s.results[kind]);assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(png.readUInt32BE(16),480);assert.equal(png.readUInt32BE(20),kind==='baccarat'?264:168);assert.deepEqual(png,m.files[0].attachment);assert.notDeepEqual(png,casinoImage(kind));}
});
