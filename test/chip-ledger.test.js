import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GameWalletStore,MAX_CHIPS} from '../src/game-wallets.js';
import {validLedger} from '../src/chip-ledger.js';
const adjust=(w,user,value,extra={},check=async()=>{})=>{const a=w.account(user);return w.adjust(user,{actor:'admin',id:`a${a.ledger.seq}`,mode:'set',value,reason:'テストの調整',expectedBalance:a.balance,expectedRevision:a.ledger.seq,...extra},check);};
test('new wallets track game stake, returned chips, net balance and game outcomes without changing initial chips',async()=>{
  const w=new GameWalletStore(null,{now:()=>0});assert.equal(w.account('owner').balance,3000);assert.equal(w.accounts.size,0);
  await w.playCasino('owner',{kind:'roulette',choice:'red',bet:10},()=>1);let a=w.account('owner');assert.equal(a.balance,3010);assert.equal(a.ledger.totals.wagered,10);assert.equal(a.ledger.totals.paid,20);assert.equal(a.ledger.games.roulette.wins,1);assert.equal(a.ledger.history.at(-1).delta,10);assert.ok(validLedger(a.ledger,a.balance));
  await w.playCasino('owner',{kind:'roulette',choice:'red',bet:50},()=>0);a=w.account('owner');assert.equal(a.ledger.games.roulette.losses,1);assert.equal(a.ledger.games.roulette.rounds,2);assert.equal(a.ledger.totals.wagered,60);assert.equal(a.ledger.totals.paid,20);assert.equal(a.balance,2960);
});
test('blackjack escrow, normal finish, natural, push and double reconcile their separate ledger entries',async()=>{
  const w=new GameWalletStore(null,{now:()=>0});await w.beginBlackjack('owner','one',10,null,1000);assert.equal(w.account('owner').ledger.games.blackjack.rounds,0);await w.finishBlackjack('owner','one','win');await w.beginBlackjack('owner','two',50,'blackjack',1000);await w.beginBlackjack('owner','three',100,null,1000);await w.doubleBlackjack('owner','three','push');
  const a=w.account('owner'),t=a.ledger.totals,g=a.ledger.games.blackjack;assert.equal(t.wagered,260);assert.equal(t.paid,345);assert.equal(a.balance,3085);assert.equal(g.rounds,3);assert.equal(g.wins,2);assert.equal(g.draws,1);assert.ok(validLedger(a.ledger,a.balance));assert.equal(a.ledger.history.at(-1).delta,100);
});
test('transfer entries share a receipt but neither account snapshot includes the other balance',async()=>{
  const w=new GameWalletStore();await w.transfer('alice','bob',100,'gift');const a=w.account('alice'),b=w.account('bob');assert.equal(a.ledger.totals.sent,100);assert.equal(b.ledger.totals.received,100);assert.equal(a.ledger.history.at(-1).id,b.ledger.history.at(-1).id);assert.equal(a.ledger.history.at(-1).peer,'bob');assert.ok(!JSON.stringify(a).includes('3100'));assert.equal(a.balance+b.balance,6000);const before=structuredClone([...w.accounts]);await assert.rejects(w.transfer('alice','bob',100,'gift'));assert.deepEqual([...w.accounts],before);
});
test('bounded history keeps the latest 20 while cumulative summaries survive eviction and returned objects cannot mutate state',async()=>{
  const w=new GameWalletStore();for(let n=0;n<35;n++)await w.playCasino('owner',{kind:'roulette',choice:'red',bet:10},()=>1);const a=w.account('owner');assert.equal(a.ledger.history.length,20);assert.equal(a.ledger.seq,35);assert.equal(a.ledger.games.roulette.rounds,35);assert.equal(a.ledger.totals.wagered,350);assert.equal(a.ledger.totals.paid,700);assert.ok(!a.ledger.history.some(e=>e.type==='initial'));a.balance=0;a.ledger.history[0].delta=100000;assert.equal(w.balance('owner'),3350);assert.notEqual(w.account('owner').ledger.history[0].delta,100000);
});
test('work tracks only fixed positive rewards and preserves reward cooldown and history during no-reward games',async()=>{
  const w=new GameWalletStore(null,{now:()=>0});await adjust(w,'owner',0);await w.beginWork('owner','one');await w.earnWork('owner','one');const before=w.account('owner');await w.beginWork('owner','two');await w.earnWork('owner','two');assert.equal(w.account('owner').ledger.totals.work,5);assert.deepEqual(w.account('owner').ledger.history,before.ledger.history);
});
test('adjustments require a check, reason, bounds and current balance plus revision; preserve audit with atomic rollback',async()=>{
  const w=new GameWalletStore();const a=w.account('owner'),args={actor:'admin',id:'adjust',mode:'add',value:100,reason:'イベントのお礼',expectedBalance:a.balance,expectedRevision:a.ledger.seq};await assert.rejects(w.adjust('owner',args));await w.adjust('owner',args,()=>{});assert.equal(w.balance('owner'),3100);assert.equal(w.account('owner').ledger.totals.added,100);assert.equal(w.adjustmentAudit()[0].actor,'admin');await assert.rejects(w.adjust('owner',args,()=>{}));
  await adjust(w,'owner',3000);assert.equal(w.account('owner').ledger.totals.removed,100);await assert.rejects(w.adjust('owner',{...args,id:'new'},()=>{}));
  for(const extra of [{value:-1},{value:MAX_CHIPS+1},{reason:''},{reason:'\n'},{reason:'x'.repeat(101)},{mode:'multiply'},{actor:'../bad'}])await assert.rejects(adjust(w,'owner',1,extra));
  const before=structuredClone([...w.accounts]),audit=w.adjustmentAudit();w.save=async()=>{throw new Error('disk');};await assert.rejects(adjust(w,'owner',10));assert.deepEqual([...w.accounts],before);assert.deepEqual(w.adjustmentAudit(),audit);
});
test('queued permission loss, active blackjack and concurrent adjustment never change balances twice',async()=>{
  const w=new GameWalletStore(null,{now:()=>0});await w.beginBlackjack('owner','hand',10,null,100);await assert.rejects(adjust(w,'owner',100));assert.equal(w.balance('owner'),2990);await w.finishBlackjack('owner','hand','stopped');assert.equal(w.account('owner').ledger.games.blackjack.rounds,0);let release;w.tail=new Promise(r=>release=r);let allowed=true;const job=adjust(w,'owner',100,{},()=>{if(!allowed)throw new Error('revoked');});allowed=false;release();await assert.rejects(job);assert.equal(w.balance('owner'),2990);
  const a=w.account('owner'),args={actor:'admin',id:'one',mode:'add',value:10,reason:'理由',expectedBalance:a.balance,expectedRevision:a.ledger.seq};const results=await Promise.allSettled([w.adjust('owner',args,()=>{}),w.adjust('owner',{...args,id:'two'},()=>{})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(w.balance('owner'),3000);
});
test('audit history retains the latest 200 independently of individual last 20 records',async()=>{
  const w=new GameWalletStore();for(let n=0;n<205;n++)await adjust(w,'owner',3000+n+1);assert.equal(w.adjustmentAudit().length,200);assert.equal(w.account('owner').ledger.history.length,20);assert.equal(w.account('owner').ledger.totals.added,205);assert.equal(w.adjustmentAudit()[0].balance,3205);assert.equal(w.adjustmentAudit().at(-1).balance,3006);
});
test('legacy balances migrate without fabricating income and durable v2 preserves histories, audit and interrupted stake',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ledger-'));try{const path=join(dir,'wallet.json');await writeFile(path,JSON.stringify({version:1,accounts:[{user:'owner',balance:1234,pending:null}]}));const w=await new GameWalletStore(path,{now:()=>10}).load();assert.equal(JSON.parse(await readFile(`${path}.v1-backup`,'utf8')).accounts[0].balance,1234);assert.equal(w.balance('owner'),1234);assert.equal(w.account('owner').ledger.opening,1234);assert.equal(w.account('owner').ledger.totals.paid,0);assert.equal(w.account('owner').ledger.history[0].type,'carry');await adjust(w,'owner',1300);await w.beginBlackjack('owner','hand',10,null,100);const restored=await new GameWalletStore(path,{now:()=>20}).load();assert.equal(restored.balance('owner'),1290);assert.equal(restored.account('owner').pending,null);assert.equal(restored.account('owner').ledger.history.at(-1).type,'blackjack-interrupted');assert.equal(restored.adjustmentAudit().length,1);const d=JSON.parse(await readFile(path,'utf8'));assert.equal(d.version,2);assert.ok(validLedger(d.accounts[0].ledger,1290));}finally{await rm(dir,{recursive:true,force:true});}
});
test('corrupt v2 history, totals and audit fail closed rather than resetting balances',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ledger-corrupt-'));try{const path=join(dir,'wallet.json'),w=new GameWalletStore(path);await adjust(w,'owner',10);const d=JSON.parse(await readFile(path,'utf8'));for(const mutate of [d=>d.accounts[0].ledger.history.push({}),d=>d.accounts[0].ledger.totals.paid++,d=>d.accounts[0].ledger.seq=-1,d=>d.audit[0].actor='../bad',d=>d.accounts[0].ledger.history.at(-1).balance=99,d=>d.accounts[0].ledger.history.at(-1).delta++]){const bad=structuredClone(d);mutate(bad);await writeFile(path,JSON.stringify(bad));await assert.rejects(new GameWalletStore(path).load());}}finally{await rm(dir,{recursive:true,force:true});}
});
