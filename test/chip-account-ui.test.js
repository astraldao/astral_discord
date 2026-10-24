import test from 'node:test';
import assert from 'node:assert/strict';
import {PermissionsBitField,PermissionFlagsBits as P} from 'discord.js';
import {createChipAccountController,chipAccountScreen} from '../src/chip-account-ui.js';
import {GameWalletStore} from '../src/game-wallets.js';
function i(customId='unused',user='owner',channelId='channel'){return {customId,user:{id:user},channelId,message:{flags:{has:()=>true}},replies:[],async deferReply(p){this.deferred=true;this.replies.push(p);},async deferUpdate(){this.deferred=true;},async editReply(p){this.replies.push(p);},async reply(p){this.replied=true;this.replies.push(p);},async showModal(p){this.modal=p;}};}
const click=(s,a)=>i(`wallet:${s.id}:${s.turn}:${a}`),body=x=>JSON.stringify(x.replies.at(-1));
async function fixture(admin=false){let allowed=true,power=true,target=true,now=0;const wallet=new GameWalletStore(null,{now:()=>now}),c=createChipAccountController({wallet,now:()=>now,member:async()=>{if(!target)throw new Error('Unknown Member');},access:async(x,needAdmin)=>{if(!allowed||needAdmin&&!power)throw new Error('権限がありません');}});await (admin?c.openAdmin(i()):c.openSelf(i()));return {c,wallet,s:[...c.sessions.sessions.values()][0],allow:x=>allowed=x,power:x=>power=x,target:x=>target=x,clock:x=>now=x};}
async function stage(f,mode='add',amount='100',reason='イベントのお礼'){
  const {c,s}=f;await c.handle(Object.assign(click(s,'target'),{values:['target']}));const a=Object.assign(click(s,'mode'),{values:[mode]});await c.handle(a);assert.ok(a.modal);const form=i(a.modal.toJSON().custom_id);form.fields={getTextInputValue:key=>key==='amount'?amount:reason};await c.handle(form);return {a,form};
}
test('self chip command is private, has no target option, and offers own history plus games without admin controls',async()=>{
  const {c,s,wallet}=await fixture();const m=chipAccountScreen(s,wallet);assert.ok(m.embeds[0].toJSON().description.includes('3,000'));assert.ok(!JSON.stringify(m).includes('残高を調整'));assert.deepEqual(m.allowedMentions.parse,[]);assert.equal(m.files,undefined);await c.handle(click(s,'history'));assert.equal(s.historySnapshot.length,1);const x=click(s,'target');x.values=['other'];await c.handle(x);assert.equal(s.target,'owner');assert.equal(wallet.accounts.size,0);assert.ok(!body(x).includes('other'));
  for(const action of ['list','audit','mode','form','save']){const x=click(s,action);await c.handle(x);assert.ok(body(x).includes('管理者専用'));assert.equal(s.scope,'self');}
});
test('administrator list, target breakdown, preview and adjustment audit use private bounded screens',async()=>{
  const f=await fixture(true);await stage(f);assert.equal(f.wallet.balance('target'),3000);assert.equal(f.s.view,'confirm');const save=click(f.s,'save');await f.c.handle(save);assert.equal(f.wallet.balance('target'),3100);assert.equal(f.s.view,'summary');await f.c.handle(save);assert.equal(f.wallet.balance('target'),3100);await f.c.handle(click(f.s,'history'));assert.ok(f.s.historySnapshot.some(e=>e.type==='adjust'));await f.c.handle(click(f.s,'audit'));assert.equal(f.s.auditSnapshot.length,1);const m=chipAccountScreen(f.s,f.wallet);assert.ok(m.embeds[0].toJSON().fields[0].value.includes('イベントのお礼'));assert.deepEqual(m.allowedMentions.parse,[]);
});
test('all ledger pages fit Discord limits for 20 entries, 7 game summaries and 200 audited adjustments',async()=>{
  const f=await fixture(true);for(let n=0;n<24;n++)await f.wallet.playCasino('target',{kind:'roulette',choice:'red',bet:10},()=>1);await f.c.handle(Object.assign(click(f.s,'target'),{values:['target']}));await f.c.handle(click(f.s,'history'));for(let n=0;n<4;n++){const m=chipAccountScreen(f.s,f.wallet);m.embeds.forEach(e=>{const j=e.toJSON();assert.ok(j.fields.length<=5);assert.ok(j.description.length<4096);assert.ok(JSON.stringify(j).length<6000);});assert.ok(m.components.length<=5);m.components.forEach(r=>{assert.ok(r.toJSON().components.length<=5);});await f.c.handle(click(f.s,'next'));}assert.equal(f.s.page,3);assert.equal(f.s.historySnapshot.length,20);
  await f.c.handle(click(f.s,'stats'));assert.ok(JSON.stringify(chipAccountScreen(f.s,f.wallet)).includes('ルーレット'));assert.ok(!JSON.stringify(chipAccountScreen(f.s,f.wallet)).includes('円'));
});
test('history snapshots and refresh cannot reveal another owner or elevate a personal session',async()=>{
  const f=await fixture(),s=f.s;await f.wallet.transfer('other','owner',50,'gift');await f.c.handle(click(s,'history'));const before=structuredClone(s.historySnapshot);for(const x of [i(`wallet:${s.id}:${s.turn}:history`,'other'),i(`wallet:${s.id}:${s.turn}:refresh`,'owner','other-channel')]){await f.c.handle(x);assert.ok(!body(x).includes('チップ受取'));assert.deepEqual(s.historySnapshot,before);}
  await f.c.handle(Object.assign(click(s,'target'),{values:['other']}));assert.equal(s.target,'owner');f.allow(false);const x=click(s,'history');await f.c.handle(x);assert.ok(!body(x).includes('直近'));f.allow(true);f.clock(600001);await f.c.handle(click(s,'history'));assert.deepEqual(s.historySnapshot,before);
});
test('admin-only entry and every subsequent view require fresh administrator permission',async()=>{
  const f=await fixture(true);await stage(f);f.power(false);const save=click(f.s,'save');await f.c.handle(save);assert.equal(f.wallet.balance('target'),3000);assert.equal(f.wallet.adjustmentAudit().length,0);assert.ok(!body(save).includes('イベントのお礼'));await f.c.openAdmin(i());assert.equal(f.c.sessions.sessions.size,1);
  const self=await fixture();self.power(false);await self.c.openSelf(i());assert.equal([...self.c.sessions.sessions.values()][0].scope,'self');
});
test('confirmation refuses balance changes including ABA, departed target and active blackjack',async()=>{
  let f=await fixture(true);await stage(f);await f.wallet.transfer('other','target',10,'one');await f.wallet.transfer('target','other',10,'two');await f.c.handle(click(f.s,'save'));assert.equal(f.wallet.balance('target'),3000);assert.equal(f.wallet.adjustmentAudit().length,0);
  f=await fixture(true);await stage(f);f.target(false);await f.c.handle(click(f.s,'save'));assert.equal(f.wallet.balance('target'),3000);
  f=await fixture(true);await stage(f);await f.wallet.beginBlackjack('target','hand',10,null,100);await f.c.handle(click(f.s,'save'));assert.equal(f.wallet.balance('target'),2990);assert.equal(f.wallet.adjustmentAudit().length,0);
});
test('queued admin revocation, stale forms and busy-session reopen cannot save an unauthorized adjustment',async()=>{
  const f=await fixture(true),{form}=await stage(f);const before=structuredClone(f.s.adjustment);await f.c.handle(form);assert.deepEqual(f.s.adjustment,before);let release;f.wallet.tail=new Promise(r=>release=r);const job=f.c.handle(click(f.s,'save'));await new Promise(r=>setImmediate(r));await f.c.openSelf(i());assert.equal(f.c.sessions.sessions.get(f.s.id),f.s);f.power(false);release();await job;assert.equal(f.wallet.balance('target'),3000);assert.equal(f.wallet.adjustmentAudit().length,0);
});
test('save failure has no audit or balance change; successful adjustment survives response failure without double saving',async()=>{
  const f=await fixture(true);await stage(f);f.wallet.save=async()=>{throw new Error('disk');};await f.c.handle(click(f.s,'save'));assert.equal(f.s.view,'confirm');assert.equal(f.wallet.balance('target'),3000);assert.equal(f.wallet.adjustmentAudit().length,0);f.wallet.save=async()=>{};const save=click(f.s,'save');let first=true;save.editReply=async p=>{if(first){first=false;throw new Error('network');}save.replies.push(p);};await f.c.handle(save);assert.equal(f.wallet.balance('target'),3100);assert.equal(f.wallet.adjustmentAudit().length,1);await f.c.handle(save);assert.equal(f.wallet.adjustmentAudit().length,1);
});
test('amount parser rejects expressions, signs, overflow, controls and empty reasons without staging a change',async()=>{
  for(const [amount,reason] of [['1+2','理由'],['-1','理由'],['1e5','理由'],['100000001','理由'],['0','理由'],['1',''],['1','x\nsecret']]){const f=await fixture(true);await stage(f,'add',amount,reason);assert.equal(f.s.view,'summary');assert.equal(f.s.adjustment,undefined);assert.equal(f.wallet.balance('target'),3000);}
});
test('default access permits only administrators with channel visibility for management',async()=>{
  let permissions=new PermissionsBitField(),visible=true;const guild={members:{fetch:async()=>({user:{bot:false},permissions})},channels:{fetch:async()=>({permissionsFor:()=>({has:()=>visible})})}},wallet=new GameWalletStore(),c=createChipAccountController({guild,wallet});await c.openAdmin(i());assert.equal(c.sessions.sessions.size,0);permissions=new PermissionsBitField(P.ManageGuild);await c.openAdmin(i());assert.equal(c.sessions.sessions.size,0);permissions=new PermissionsBitField(P.Administrator);visible=false;await c.openAdmin(i());assert.equal(c.sessions.sessions.size,0);visible=true;await c.openAdmin(i());assert.equal(c.sessions.sessions.size,1);
});
test('personal history filter applies only within the latest 20 and never expands its scope',async()=>{
  const f=await fixture();await f.wallet.transfer('other','owner',10,'one');await f.wallet.playCasino('owner',{kind:'roulette',choice:'red',bet:10},()=>1);await f.c.handle(click(f.s,'history'));await f.c.handle(Object.assign(click(f.s,'filter'),{values:['games']}));assert.equal(chipAccountScreen(f.s,f.wallet).embeds[0].toJSON().fields.length,1);await f.c.handle(Object.assign(click(f.s,'filter'),{values:['gifts']}));assert.ok(JSON.stringify(chipAccountScreen(f.s,f.wallet)).includes('チップ受取'));const before=f.s.historyFilter;await f.c.handle(Object.assign(click(f.s,'filter'),{values:['__proto__']}));assert.equal(f.s.historyFilter,before);
});

test('history explains empty filters and keeps its acquisition timestamp until an explicit refresh',async()=>{
  const f=await fixture();f.clock(1000);await f.c.handle(click(f.s,'history'));assert.equal(f.s.historyCheckedAt,1000);
  f.clock(5000);await f.wallet.transfer('other','owner',10,'later');await f.c.handle(Object.assign(click(f.s,'filter'),{values:['gifts']}));let m=chipAccountScreen(f.s,f.wallet);
  assert.ok(m.embeds[0].toJSON().description.includes('この種類の履歴はありません'));assert.ok(m.embeds[0].toJSON().description.includes('<t:1:R>'));assert.ok(m.embeds[0].toJSON().description.includes('3,010'));assert.equal(m.embeds[0].toJSON().fields?.length??0,0);
  await f.c.handle(click(f.s,'refresh'));m=chipAccountScreen(f.s,f.wallet);assert.equal(f.s.historyCheckedAt,5000);assert.ok(m.embeds[0].toJSON().description.includes('<t:5:R>'));assert.equal(m.embeds[0].toJSON().fields.length,1);assert.ok(!m.embeds[0].toJSON().description.includes('この種類の履歴はありません'));
  f.allow(false);f.clock(6000);await f.c.handle(click(f.s,'refresh'));assert.equal(f.s.historyCheckedAt,5000);
});

test('empty administrator audit retains its check time and refresh updates the same bounded snapshot',async()=>{
  const f=await fixture(true);f.clock(1000);await f.c.handle(click(f.s,'audit'));assert.equal(f.s.auditCheckedAt,1000);assert.ok(JSON.stringify(chipAccountScreen(f.s,f.wallet)).includes('<t:1:R>'));
  f.clock(3000);await f.c.handle(click(f.s,'refresh'));assert.equal(f.s.auditCheckedAt,3000);assert.equal(f.s.auditSnapshot.length,0);assert.ok(JSON.stringify(chipAccountScreen(f.s,f.wallet)).includes('調整履歴はありません'));
});
