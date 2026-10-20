import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TrpgStore} from '../src/trpg-store.js';
import {createTrpgController} from '../src/trpg-ui.js';
const controls=i=>i.result.components.flatMap(row=>row.toJSON().components);
async function fixture(t,{admin=true,entry=admin?'admin':'panel',limit=3200}={}){
  const dir=await mkdtemp(join(tmpdir(),'astral-backup-ui-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=await new TrpgStore(join(dir,'trpg.json')).load(),panel=await store.addPanel('channel','shared');
  for(let n=0;n<6;n++)await store.saveCharacter(panel,n<3?'owner':'other',`https://iachara.com/view/${n+1}`,{name:n<3?`OWN NAME ${n}`:`FOREIGN NAME ${n}`,txt:`${n<3?'OWN':'FOREIGN'} TXT ${n}:`+'x'.repeat(1200)});
  let isAdmin=admin,visible=true;const controller=createTrpgController({store,guild:{channels:{cache:new Map()}},access:async()=>{if(!visible)throw new Error('閲覧権限がありません。');return isAdmin;}}),s=controller.sessions.create('owner');Object.assign(s,{entry,isAdmin,originChannelId:'channel',panelId:panel,view:entry==='admin'?'archives':'characters',page:0});
  const interaction=(customId,extra={})=>({customId,user:{id:'owner'},channelId:'channel',attachmentSizeLimit:limit,message:{flags:{has:()=>true}},async deferUpdate(){this.deferred=true;},async deferReply(){this.deferred=true;},async editReply(value){this.result=value;},async reply(value){this.result=value;},...extra});
  const act=async(action,extra={})=>{const i=interaction(`trpg:${s.id}:${action}`,extra);await controller.handle(i);return i;};
  return {store,controller,s,panel,interaction,act,setAdmin:value=>isAdmin=value,deny:()=>visible=false,part:(index,extra)=>act(`backup-part:${s.backup.token}:${index}`,extra)};
}
test('multipart backups attach one bounded ZIP at a time and every PC appears across the complete set',async t=>{
  const f=await fixture(t),first=await f.act('backup-all');assert.equal(first.result.files.length,1);assert.ok(f.s.backup.parts.length>1);assert.equal(f.s.view,'backup');
  assert.ok(!/OWN NAME|FOREIGN NAME|TXT|iachara/.test(JSON.stringify(f.s.backup)));const output=[first.result.files[0].attachment];
  for(let n=1;n<f.s.backup.parts.length;n++){const i=await f.part(n);assert.equal(i.result.files.length,1);output.push(i.result.files[0].attachment);assert.equal(f.s.backup.page,n);}
  assert.ok(output.every(data=>data.length<=3200));for(let n=0;n<6;n++)assert.equal(output.filter(data=>data.includes(Buffer.from(`${n<3?'OWN':'FOREIGN'} TXT ${n}:`))).length,1);
  for(const c of controls(first))assert.ok((c.custom_id?.length??0)<=100);assert.ok(first.result.embeds[0].toJSON().description.length<4096);
});
test('panel backups keep the original owner-only scope even after an administrator role is granted',async t=>{
  const f=await fixture(t,{admin:false,limit:1800}),first=await f.act('backup-panel');assert.equal(f.s.backup.admin,false);assert.equal(f.s.backup.totalCount,3);assert.ok(!first.result.files[0].attachment.includes(Buffer.from('FOREIGN TXT')));
  f.setAdmin(true);for(let n=1;n<f.s.backup.parts.length;n++){const i=await f.part(n);assert.ok(i.result.files);assert.ok(!i.result.files[0].attachment.includes(Buffer.from('FOREIGN TXT')));}
});
test('administrator scope from a public panel cannot survive administrator revocation',async t=>{
  const f=await fixture(t,{entry:'panel'});await f.act('backup-panel');assert.equal(f.s.backup.admin,true);f.setAdmin(false);const i=await f.part(1);assert.ok(!i.result.files);assert.ok(!JSON.stringify(i.result).includes('FOREIGN NAME'));
});
for(const denied of ['owner','channel','expired','replaced','visibility'])test(`ZIP retrieval refuses changed ${denied} without returning a file`,async t=>{
  const f=await fixture(t);await f.act('backup-all');const action=`backup-part:${f.s.backup.token}:1`;let extra={};
  if(denied==='owner')extra.user={id:'stranger'};if(denied==='channel')extra.channelId='other-channel';if(denied==='expired')f.s.expires=0;if(denied==='replaced')f.controller.sessions.create('owner');if(denied==='visibility')f.deny();
  const i=await f.act(action,extra);assert.ok(!i.result.files);assert.deepEqual(i.result.attachments,[]);assert.ok(!JSON.stringify(i.result).includes('FOREIGN TXT'));
});
test('stale buttons and leaving the download screen cannot select another part',async t=>{
  const f=await fixture(t);await f.act('backup-all');const old=`backup-part:${f.s.backup.token}:1`;await f.part(1);const stale=await f.act(old);assert.ok(!stale.result.files);
  const current=`backup-part:${f.s.backup.token}:0`,back=await f.act(`backup-return:${f.s.backup.token}`);assert.equal(f.s.view,'archives');assert.equal(f.s.backup,undefined);assert.deepEqual(back.result.attachments,[]);
  const late=await f.act(current);assert.ok(!late.result.files);
});
test('changed or removed backups require a new plan rather than mixing revisions',async t=>{
  const f=await fixture(t);await f.act('backup-all');await f.store.update(d=>{d.characters[0].txt='CHANGED';});
  const i=await f.part(1);assert.ok(!i.result.files);assert.match(i.result.embeds[0].toJSON().description,/控えが更新・変更/);assert.ok(controls(i).some(c=>c.label==='最新の控えを取得'));assert.equal(f.store.character(f.store.metadata().characters[0].id,'owner',f.panel,true).txt,'CHANGED');
});
test('a lower upload limit blocks old grouping while a raised limit keeps the same snapshot',async t=>{
  const f=await fixture(t);await f.act('backup-all');const blocked=await f.part(1,{attachmentSizeLimit:1000});assert.ok(!blocked.result.files);assert.match(blocked.result.embeds[0].toJSON().description,/送信上限/);
  const raised=await f.part(1,{attachmentSizeLimit:6400});assert.equal(raised.result.files.length,1);assert.ok(raised.result.files[0].attachment.length<=3200);
});
test('reopening a management backup retains the part and never uploads automatically',async t=>{
  const f=await fixture(t);await f.act('backup-all');await f.part(1);const token=f.s.backup.token,i=f.interaction('unused');await f.controller.open(i);
  assert.equal(f.s.backup.page,1);assert.equal(f.s.backup.token,token);assert.ok(!i.result.files);assert.deepEqual(i.result.attachments,[]);assert.ok(controls(i).some(c=>c.label==='このZIPを取得'));
});
for(const fails of [false,true])test(`simultaneous ZIP transfers are bounded and the slot is released after ${fails?'failure':'success'}`,{timeout:5000},async t=>{
  const f=await fixture(t);let entered,release;const enteredUpload=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const first=f.act('backup-all',{async editReply(value){this.result=value;if(value.files){entered();await gate;if(fails)throw new Error('simulated upload failure');}}});
  await enteredUpload;const second=f.controller.sessions.create('second');Object.assign(second,{entry:'admin',isAdmin:true,originChannelId:'channel',view:'archives'});
  const i=f.interaction(`trpg:${second.id}:backup-all`,{user:{id:'second'}});await f.controller.handle(i);assert.ok(!i.result.files);assert.match(i.result.embeds[0].toJSON().description,/別の控えを送信中/);
  release();await first;const retry=f.interaction(`trpg:${second.id}:backup-all`,{user:{id:'second'}});await f.controller.handle(retry);assert.equal(retry.result.files.length,1);
});
test('source changes can be explicitly regrouped after the new-plan cooldown',async t=>{
  let time=0;t.mock.method(Date,'now',()=>time);const f=await fixture(t);await f.act('backup-all');const previous=f.s.backup.signature;
  await f.store.update(d=>{d.characters[0].txt='updated';});await f.part(1);const early=await f.act('backup-all');assert.ok(!early.result.files);
  time=10001;const fresh=await f.act('backup-all');assert.equal(fresh.result.files.length,1);assert.notEqual(f.s.backup.signature,previous);assert.ok(fresh.result.files[0].attachment.includes(Buffer.from('updated')));
});

test('a change to another member backup does not invalidate an owner-only download',async t=>{
  const f=await fixture(t,{admin:false,limit:1800});await f.act('backup-panel');await f.store.update(d=>{d.characters.find(c=>c.ownerId==='other').txt='changed foreign data';});
  const i=await f.part(1);assert.equal(i.result.files.length,1);assert.ok(!i.result.files[0].attachment.includes(Buffer.from('changed foreign data')));
});
test('single-part backups keep one useful download button and reject malformed part selectors',async t=>{
  const f=await fixture(t,{limit:100000});const first=await f.act('backup-all');assert.equal(f.s.backup.parts.length,1);assert.ok(!controls(first).some(c=>c.label==='前のZIP'||c.label==='次のZIP'));
  for(const page of ['-1','1.5','Infinity','1000','99','']){const i=await f.act(`backup-part:${f.s.backup.token}:${page}`);assert.ok(!i.result.files);assert.deepEqual(i.result.attachments,[]);}
});

test('an obsolete pagination action cannot redraw administrator backup metadata after role loss',async t=>{
  const f=await fixture(t,{entry:'panel'});await f.act('backup-panel');f.setAdmin(false);
  const i=await f.act('next');assert.ok(!i.result.files);assert.ok(!JSON.stringify(i.result).includes('このパネルの全PCの控え'));assert.deepEqual(i.result.attachments,[]);
});

for(const change of ['source','permission'])test(`${change} changes while ZIP construction yields cannot expose the generated file`,{timeout:5000},async t=>{
  const f=await fixture(t),pending=f.act('backup-all');
  let observed;const changed=new Promise(resolve=>setImmediate(()=>{observed={view:f.s.view,busy:f.s.busy};if(change==='permission')f.deny();else{const replacement=structuredClone(f.store.data);replacement.characters.shift();f.store.data=replacement;}resolve();}));
  const i=await pending;await changed;assert.deepEqual(observed,{view:'backup',busy:true});assert.ok(!i.result.files);assert.deepEqual(i.result.attachments,[]);assert.equal(f.s.busy,false);
  assert.ok(!JSON.stringify(i.result).includes('FOREIGN TXT'));
});
