import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageFlags} from 'discord.js';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GameWalletStore,MAX_CHIPS} from '../src/game-wallets.js';
import {createChipTools,transferScreen,workScreen} from '../src/chip-tools.js';
import {gameLobby} from '../src/blackjack-ui.js';
const OWNER='111111111111111111',TARGET='222222222222222222',OTHER='333333333333333333';
function interaction(customId='unused',user=OWNER,channelId='channel'){return {customId,user:{id:user},channelId,message:{flags:{has:()=>true}},replies:[],async deferReply(p){this.deferred=true;this.replies.push(p);},async deferUpdate(){this.deferred=true;},async editReply(p){this.replies.push(p);},async reply(p){this.replied=true;this.replies.push(p);},async showModal(m){this.replied=true;this.modal=m;}};}
const click=(prefix,s,action)=>interaction(`${prefix}:${s.id}:${s.turn}:${action}`);
async function fixture(balance=3000){let time=0,allowed=true,targetAllowed=true;const wallet=new GameWalletStore(null,{now:()=>time});wallet.accounts.set(OWNER,{balance,pending:null});const c=createChipTools({wallet,now:()=>time,random:()=>2,access:async()=>{if(!allowed)throw new Error('権限なし');},recipient:async(id,user)=>{if(!targetAllowed||id===user||id!==TARGET)throw new Error('相手を確認してください');return {user:{id,bot:false}};}});return {c,wallet,clock:n=>time=n,allow:v=>allowed=v,targetAllow:v=>targetAllowed=v};}
async function draft(f,amount='100'){const i=interaction('chips:open');await f.c.handle(i);const s=[...f.c.transfers.sessions.values()][0];await f.c.handle(Object.assign(click('chips',s,'target'),{values:[TARGET]}));const modal=click('chips',s,'amount');await f.c.handle(modal);const submit=interaction(modal.modal.toJSON().custom_id);submit.fields={getTextInputValue:()=>amount};await f.c.handle(submit);return {s,submit,modal};}
async function workStart(f){await f.c.handle(interaction('work:open'));const s=[...f.c.work.sessions.values()][0];await f.c.handle(click('work',s,'start'));return s;}
async function catchAll(f,s){for(let n=0;n<3;n++)await f.c.handle(click('work',s,`pick-${s.target}`));await f.c.handle(click('work',s,'claim'));}
test('transfer moves only available chips and commits both wallets together',async()=>{
 const w=new GameWalletStore();const r=await w.transfer(OWNER,TARGET,100,'send');assert.deepEqual(r,{amount:100,balance:2900});assert.equal(w.balance(TARGET),3100);assert.equal(w.balance(OWNER)+w.balance(TARGET),6000);await assert.rejects(w.transfer(OWNER,TARGET,100,'send'));assert.equal(w.balance(OWNER),2900);
});
test('invalid, self, overdrawn or overflowing transfers make no changes',async()=>{
 const w=new GameWalletStore();for(const [to,amount] of [[OWNER,1],['../bad',1],[TARGET,0],[TARGET,-1],[TARGET,1.5],[TARGET,'10'],[TARGET,3001],[TARGET,Infinity]])await assert.rejects(w.transfer(OWNER,to,amount,'id'));assert.equal(w.accounts.size,0);w.accounts.set(TARGET,{balance:MAX_CHIPS,pending:null});await assert.rejects(w.transfer(OWNER,TARGET,1,'id'));assert.equal(w.balance(OWNER),3000);assert.equal(w.balance(TARGET),MAX_CHIPS);
});
test('parallel transfers and casino charges never spend chips twice',async()=>{
 const w=new GameWalletStore();w.accounts.set(OWNER,{balance:10,pending:null});const r=await Promise.allSettled([w.transfer(OWNER,TARGET,10,'one'),w.transfer(OWNER,OTHER,10,'two'),w.playCasino(OWNER,{kind:'roulette',choice:'red',bet:10},()=>0)]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(w.balance(OWNER),0);
});
test('disk failure rolls back sender and recipient and a retry sends exactly once',async()=>{
 const w=new GameWalletStore();w.save=async()=>{throw new Error('disk');};await assert.rejects(w.transfer(OWNER,TARGET,100,'id'));assert.equal(w.accounts.size,0);w.save=async()=>{};await w.transfer(OWNER,TARGET,100,'id');assert.equal(w.balance(OWNER),2900);assert.equal(w.balance(TARGET),3100);
});
test('transfer UI uses recipient, amount modal and confirmation without showing recipient balance',async()=>{
 const f=await fixture(),{s,modal,submit}=await draft(f);assert.equal(s.view,'confirm');assert.equal(f.wallet.balance(OWNER),3000);const m=submit.replies.at(-1);assert.ok(m.embeds[0].toJSON().description.includes(`<@${TARGET}>`));assert.ok(!m.embeds[0].toJSON().description.includes('相手の残高'));assert.deepEqual(m.allowedMentions.parse,[]);assert.equal(modal.modal.toJSON().components[0].components[0].max_length,9);const send=click('chips',s,'confirm');await f.c.handle(send);assert.equal(s.view,'done');assert.equal(f.wallet.balance(OWNER),2900);assert.equal(f.wallet.balance(TARGET),3100);await f.c.handle(send);assert.equal(f.wallet.balance(OWNER),2900);
});
test('forged owners, channels, modal tokens and amounts cannot create a transfer',async()=>{
 const f=await fixture(),{s}=await draft(f);for(const i of [interaction(`chips:${s.id}:${s.turn}:confirm`,OTHER),interaction(`chips:${s.id}:${s.turn}:confirm`,OWNER,'elsewhere')]){await f.c.handle(i);assert.ok(!JSON.stringify(i.replies).includes(TARGET));}await f.c.handle(click('chips',s,'back'));for(const amount of ['0','-10','1.5','1e2','100000001','5000']){const i=click('chips',s,'amount');await f.c.handle(i);const submit=interaction(i.modal.toJSON().custom_id);submit.fields={getTextInputValue:()=>amount};await f.c.handle(submit);assert.equal(s.view,'draft');}const forged=click('chips',s,'amount-form:fake');forged.fields={getTextInputValue:()=>100};await f.c.handle(forged);assert.equal(f.wallet.balance(OWNER),3000);assert.equal(f.wallet.accounts.has(TARGET),false);
});
test('changing recipients or returning from confirmation invalidates old send buttons and modal tokens',async()=>{
 const f=await fixture(),{s,modal}=await draft(f);const oldSend=click('chips',s,'confirm');await f.c.handle(click('chips',s,'back'));await f.c.handle(oldSend);assert.equal(f.wallet.balance(OWNER),3000);const oldModal=interaction(modal.modal.toJSON().custom_id);oldModal.fields={getTextInputValue:()=>100};await f.c.handle(oldModal);assert.equal(s.view,'draft');assert.equal(f.wallet.balance(TARGET),3000);
});
test('recipient leaving and sender permission revocation deny transfers without exposing data',async()=>{
 const f=await fixture(),{s}=await draft(f);f.targetAllow(false);let i=click('chips',s,'confirm');await f.c.handle(i);assert.equal(f.wallet.balance(OWNER),3000);assert.ok(!JSON.stringify(i.replies).includes(TARGET));f.targetAllow(true);f.allow(false);i=click('chips',s,'confirm');await f.c.handle(i);assert.equal(f.wallet.balance(OWNER),3000);assert.ok(!JSON.stringify(i.replies).includes('残高'));
});
test('default recipient validation rejects bots, self and users outside the configured guild',async()=>{
 const wallet=new GameWalletStore(),guild={members:{fetch:async({user})=>{if(user===OTHER)throw new Error('Unknown Member');return {user:{id:user,bot:user===TARGET}};}}},c=createChipTools({wallet,guild,access:async()=>{}});await c.handle(interaction('chips:open'));const s=[...c.transfers.sessions.values()][0];for(const id of [OWNER,TARGET,OTHER,'bad']){await c.handle(Object.assign(click('chips',s,'target'),{values:[id]}));assert.equal(s.target,undefined);}assert.equal(wallet.accounts.size,0);
});
test('public forged entries are acknowledged privately and expired sessions cannot send',async()=>{
 const f=await fixture();const i=interaction('chips:open');i.message.flags.has=()=>false;await f.c.handle(i);assert.equal(i.replies[0].flags,MessageFlags.Ephemeral);const {s}=await draft(f);f.clock(600001);await f.c.handle(click('chips',s,'confirm'));assert.equal(f.wallet.balance(OWNER),3000);
});
test('free work pays a fixed five once and requires a valid completed ticket',async()=>{
 const f=await fixture(0),s=await workStart(f);const early=click('work',s,'claim');await f.c.handle(early);assert.equal(f.wallet.balance(OWNER),0);await catchAll(f,s);assert.equal(s.view,'done');assert.equal(s.reward,5);assert.equal(f.wallet.balance(OWNER),5);await f.c.handle(click('work',s,'claim'));await f.wallet.earnWork(OWNER,s.ticketId).then(()=>assert.fail('double payout'),()=>{});assert.equal(f.wallet.balance(OWNER),5);
});
test('wrong eggs, repeated picks and simultaneous clicks cannot advance more than one capture',async()=>{
 const f=await fixture(0),s=await workStart(f);await f.c.handle(click('work',s,'pick-0'));assert.equal(s.caught,0);const i=click('work',s,`pick-${s.target}`);await Promise.all([f.c.handle(i),f.c.handle(interaction(i.customId))]);assert.equal(s.caught,1);await f.c.handle(interaction(i.customId));assert.equal(s.caught,1);assert.equal(f.wallet.balance(OWNER),0);
});
test('work cooldown, hour cap and balance eligibility stop unlimited chip farming',async()=>{
 let now=0;const w=new GameWalletStore(null,{now:()=>now});w.accounts.set(OWNER,{balance:0,pending:null});for(let n=0;n<6;n++){now=n*30000;w.accounts.get(OWNER).balance=0;await w.beginWork(OWNER,`ticket${n}`);await w.earnWork(OWNER,`ticket${n}`);if(n===0){w.accounts.get(OWNER).balance=0;await w.beginWork(OWNER,'too-soon');assert.equal((await w.earnWork(OWNER,'too-soon')).reward,0);}}w.accounts.get(OWNER).balance=0;now=180000;await w.beginWork(OWNER,'over-budget');assert.equal((await w.earnWork(OWNER,'over-budget')).reward,0);assert.equal(w.accounts.get(OWNER).work.earned,30);now=3600000;await w.beginWork(OWNER,'next-hour');await w.earnWork(OWNER,'next-hour');assert.equal(w.balance(OWNER),5);w.accounts.get(OWNER).balance=10;now+=30000;await w.beginWork(OWNER,'already-solvent');assert.equal((await w.earnWork(OWNER,'already-solvent')).reward,0);
});
test('ticket expiry, another owner and in-flight blackjack reject free-work payouts',async()=>{
 let now=0;const w=new GameWalletStore(null,{now:()=>now});w.accounts.set(OWNER,{balance:0,pending:null});await w.beginWork(OWNER,'ticket');await assert.rejects(w.earnWork(OTHER,'ticket'));w.accounts.get(OWNER).pending={id:'bj',bet:10,expires:600000};assert.equal((await w.earnWork(OWNER,'ticket')).reward,0);w.accounts.get(OWNER).pending=null;await w.beginWork(OWNER,'expired');now=600001;await assert.rejects(w.earnWork(OWNER,'expired'));assert.equal(w.balance(OWNER),0);
});
test('a gift received during work prevents an unnecessary chip payout',async()=>{
 const f=await fixture(0),s=await workStart(f);await f.wallet.transfer(TARGET,OWNER,10,'gift');await catchAll(f,s);assert.equal(s.reward,0);assert.equal(f.wallet.balance(OWNER),10);
});
test('restart preserves work caps and cooldowns and clears unfinished tickets without a payout',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'work-wallet-'));try{const path=join(dir,'wallet.json'),w=new GameWalletStore(path,{now:()=>0});w.accounts.set(OWNER,{balance:0,pending:null});await w.beginWork(OWNER,'ticket');await w.earnWork(OWNER,'ticket');await w.beginWork(OWNER,'unfinished');const loaded=await new GameWalletStore(path,{now:()=>1}).load();assert.equal(loaded.balance(OWNER),5);assert.equal(loaded.accounts.get(OWNER).work.notBefore,30000);assert.equal(loaded.accounts.get(OWNER).work.ticket,null);await loaded.beginWork(OWNER,'restart');assert.equal((await loaded.earnWork(OWNER,'restart')).reward,0);await assert.rejects(loaded.earnWork(OWNER,'ticket'));const raw=JSON.parse(await readFile(path,'utf8'));assert.equal(raw.accounts[0].work.ticket,null);}finally{await rm(dir,{recursive:true,force:true});}
});
test('work rejects malformed budget files and preserves old wallets during migration',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'work-wallet-'));try{const path=join(dir,'wallet.json');await writeFile(path,JSON.stringify({version:1,accounts:[{user:OWNER,balance:100,pending:null}]}));const w=await new GameWalletStore(path).load();assert.equal(w.balance(OWNER),100);for(const work of [{windowStarted:0,earned:31,notBefore:0,ticket:null},{windowStarted:0,earned:0,notBefore:0,ticket:{id:'../bad',expires:1}}]){await writeFile(path,JSON.stringify({version:1,accounts:[{user:OWNER,balance:100,pending:null,work}]}));await assert.rejects(new GameWalletStore(path).load());}}finally{await rm(dir,{recursive:true,force:true});}
});
test('work permission loss, foreign users and cross-channel entry never expose or abandon a ticket',async()=>{
 const f=await fixture(0),s=await workStart(f),ticket=s.ticketId;await f.c.handle(interaction(`work:${s.id}:${s.turn}:pick-${s.target}`,OTHER));assert.equal(s.caught,0);await f.c.handle(interaction('work:open',OWNER,'elsewhere'));assert.equal(f.c.work.sessions.get(s.id).ticketId,ticket);for(let n=0;n<3;n++)await f.c.handle(click('work',s,`pick-${s.target}`));f.allow(false);const i=click('work',s,'claim');await f.c.handle(i);assert.equal(f.wallet.balance(OWNER),0);assert.ok(!JSON.stringify(i.replies).includes('残高'));
});
test('failed work payout remains claimable without progress loss and retries pay only once',async()=>{
 const f=await fixture(0),s=await workStart(f);for(let n=0;n<3;n++)await f.c.handle(click('work',s,`pick-${s.target}`));f.wallet.save=async()=>{throw new Error('disk');};await f.c.handle(click('work',s,'claim'));assert.equal(s.view,'claim');assert.equal(f.wallet.balance(OWNER),0);f.wallet.save=async()=>{};await f.c.handle(click('work',s,'claim'));assert.equal(f.wallet.balance(OWNER),5);assert.equal(s.view,'done');
});
test('new chip and work screens fit Discord builders with no money rates or recipient balance',()=>{
 for(const view of ['draft','confirm','done']){const m=transferScreen({id:'id',turn:0,view,target:TARGET,amount:100},3000);m.embeds[0].toJSON();m.components.forEach(r=>r.toJSON());assert.deepEqual(m.allowedMentions.parse,[]);assert.ok(!m.embeds[0].toJSON().description.includes('円'));}for(const view of ['ready','playing','claim','done']){const m=workScreen({id:'id',turn:0,view,target:2,caught:0,reward:5},0);assert.ok(m.components.length<=5);m.components.forEach(r=>r.toJSON());assert.ok(m.embeds[0].toJSON().description.length<4096);}const home=gameLobby(undefined,0);const buttons=home.components.flatMap(r=>r.toJSON().components);assert.ok(buttons.some(x=>x.custom_id==='chips:open'));assert.ok(buttons.some(x=>x.custom_id==='work:open'));
});
test('correcting a transfer prefills the previous amount and refreshes the form token',async()=>{
 const f=await fixture(),{s,modal}=await draft(f,'100');await f.c.handle(click('chips',s,'back'));const next=click('chips',s,'amount');await f.c.handle(next);assert.equal(next.modal.toJSON().components[0].components[0].value,'100');assert.notEqual(next.modal.toJSON().custom_id,modal.modal.toJSON().custom_id);
});
test('permission loss while a transfer waits for the ledger denies debit and private result',async()=>{
 const f=await fixture(),{s}=await draft(f);let release;f.wallet.tail=new Promise(r=>release=r);const i=click('chips',s,'confirm'),job=f.c.handle(i);await new Promise(r=>setImmediate(r));f.allow(false);release();await job;assert.equal(f.wallet.balance(OWNER),3000);assert.equal(f.wallet.accounts.has(TARGET),false);assert.ok(!JSON.stringify(i.replies).includes(TARGET));
});
test('work receipts and transfer deduplication survive save and reload',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'work-receipt-'));try{const path=join(dir,'wallet.json');let now=0;const w=new GameWalletStore(path,{now:()=>now});w.accounts.set(OWNER,{balance:0,pending:null});for(let n=0;n<6;n++){now=n*30000;w.accounts.get(OWNER).balance=0;await w.beginWork(OWNER,`t${n}`);await w.earnWork(OWNER,`t${n}`);}await w.transfer(OWNER,TARGET,5,'receipt');const restored=await new GameWalletStore(path,{now:()=>180000}).load();assert.equal(restored.balance(OWNER),0);assert.equal(restored.accounts.get(OWNER).work.earned,30);await restored.beginWork(OWNER,'over-limit');assert.equal((await restored.earnWork(OWNER,'over-limit')).reward,0);await assert.rejects(restored.transfer(OWNER,TARGET,5,'receipt'));assert.equal(restored.balance(TARGET),3005);}finally{await rm(dir,{recursive:true,force:true});}
});

test('free chicken game is playable at any balance and replayable during reward cooldown',async()=>{
 const f=await fixture(3000),s=await workStart(f);assert.equal(s.view,'playing');await catchAll(f,s);assert.equal(s.reward,0);assert.equal(f.wallet.balance(OWNER),3000);await f.c.handle(click('work',s,'again'));assert.equal(s.view,'playing');await catchAll(f,s);assert.equal(s.view,'done');const buttons=gameLobby(undefined,3000).components.flatMap(r=>r.toJSON().components);assert.ok(buttons.some(x=>x.custom_id==='work:open'));assert.equal(workScreen(s,3000).components[0].toJSON().components[0].disabled,undefined);
 const poor=await fixture(0),p=await workStart(poor);await catchAll(poor,p);await poor.c.handle(click('work',p,'again'));assert.equal(p.view,'playing');await catchAll(poor,p);assert.equal(p.reward,0);assert.equal(p.rewardReason,'cooldown');assert.equal(poor.wallet.balance(OWNER),5);
});
