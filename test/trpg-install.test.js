import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PermissionFlagsBits as P} from 'discord.js';
import {TrpgStore} from '../src/trpg-store.js';
import {createTrpgController} from '../src/trpg-ui.js';
const guildId='123456789012345600',targetId='123456789012345601';
const controls=message=>(message.components??[]).flatMap(row=>row.toJSON().components);
async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'astral-install-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=await new TrpgStore(join(dir,'trpg.json')).load(),posts=[];let sends=0,deletes=0,allowed=true,history=true,outcome='success',deleteFails=false,targetFetches=0,onTarget=()=>{};
  const channel={id:targetId,type:0,permissionsFor:()=>({has:bits=>!bits.includes(P.ReadMessageHistory)||history}),messages:{fetch:async id=>{const post=posts.find(p=>p.id===id&&!p.deleted);if(!post)throw Object.assign(new Error('missing'),{code:10008});return post;}},send:async payload=>{
    sends++;if(outcome==='denied')throw Object.assign(new Error('denied'),{code:50013});
    const post={id:String(123456789012345670n+BigInt(sends)),author:{id:'bot'},...payload,deleted:false,edit:async()=>{},delete:async()=>{deletes++;if(deleteFails)throw new Error('unknown deletion');post.deleted=true;}};posts.push(post);
    if(outcome==='unknown')throw new Error('simulated response loss');return post;
  }};
  const guild={id:guildId,members:{me:{id:'bot'},fetchMe:async options=>{assert.equal(options.force,true);return {id:'bot'};}},channels:{cache:new Map(),fetch:async()=>{onTarget(++targetFetches);return channel;}}};
  const access=async()=>allowed,controller=createTrpgController({store,guild,access});
  const interaction=(customId,extra={})=>({customId,user:{id:'actor'},channelId:'source',message:{flags:{has:()=>true}},async deferUpdate(){this.deferred=true;},async deferReply(){this.deferred=true;},async editReply(message){this.result=message;},async reply(message){this.result=message;this.replied=true;},async showModal(modal){this.modal=modal;},...extra});
  await controller.open(interaction());const s=[...controller.sessions.sessions.values()][0];
  const act=async(action,extra={})=>{const i=interaction(`trpg:${s.id}:${action}`,extra);await controller.handle(i);return i;};
  await act('install');const chosen=await act('channel',{values:[targetId]});
  const place=controls(chosen.result).find(c=>/:place(?::|$)/.test(c.custom_id)).custom_id;
  const click=async(id=place)=>{const i=interaction(id);await controller.handle(i);return i;};
  return {store,controller,s,guild,access,interaction,act,place,click,posts,get sends(){return sends;},get deletes(){return deletes;},setOutcome:value=>outcome=value,setAllowed:value=>allowed=value,setHistory:value=>history=value,setDeleteFails:value=>deleteFails=value,onTarget:fn=>onTarget=fn};
}
test('successful installation cannot repeat from an old button, including after a fresh install screen',async t=>{
  const f=await fixture(t);await f.click();assert.equal(f.sends,1);assert.equal(f.store.metadata().panels[0].messageId,f.posts[0].id);assert.equal(f.s.view,'home');
  await f.click();assert.equal(f.sends,1);
  const fresh=await f.act('install'),next=controls(fresh.result).find(c=>/:place:/.test(c.custom_id)).custom_id;assert.notEqual(next,f.place);
  await f.click();assert.equal(f.sends,1);await f.click(next);assert.equal(f.sends,2);assert.equal(f.store.metadata().panels.length,2);
});
test('unknown first send retains one durable identity and reopening or old buttons never send again',async t=>{
  const f=await fixture(t);f.setOutcome('unknown');const failed=await f.click();assert.equal(f.sends,1);assert.equal(f.s.view,'repair');
  const p=f.store.metadata().panels[0];assert.ok(p.repairPending);assert.equal(p.messageId,null);assert.ok(controls(failed.result).some(c=>c.custom_id?.endsWith(':form-repair-result')));
  await f.click();await f.controller.open(f.interaction());assert.equal(f.sends,1);assert.equal(f.store.metadata().panels.length,1);
  const loaded=await new TrpgStore(f.store.path).load();assert.deepEqual(loaded.metadata().panels,[p]);
  const c=createTrpgController({store:loaded,guild:f.guild,access:f.access});await c.open(f.interaction());assert.equal(f.sends,1);assert.equal(loaded.metadata().panels[0].id,p.id);
});
test('an unknown installation adopts the verified message after reload without sending a replacement',async t=>{
  const f=await fixture(t);f.setOutcome('unknown');await f.click();const p=f.store.metadata().panels[0],loaded=await new TrpgStore(f.store.path).load(),c=createTrpgController({store:loaded,guild:f.guild,access:f.access});
  await c.open(f.interaction());const s=[...c.sessions.sessions.values()][0],act=async(action,extra={})=>{const i=f.interaction(`trpg:${s.id}:${action}`,extra);await c.handle(i);return i;};
  await act('repair-select',{values:[p.id]});await act('form-repair-result');
  f.posts[0].author={id:'foreign-bot'};await act(`submit-repair-result:${s.repairToken}`,{fields:{getTextInputValue:()=>f.posts[0].id}});assert.ok(loaded.metadata().panels[0].repairPending);
  f.posts[0].author={id:'bot'};await act(`submit-repair-result:${s.repairToken}`,{fields:{getTextInputValue:()=>f.posts[0].id}});
  assert.equal(loaded.metadata().panels[0].messageId,f.posts[0].id);assert.equal(loaded.metadata().panels[0].repairPending,undefined);assert.equal(f.sends,1);
});
test('known send denial keeps the same recoverable panel and requires an explicit recovery',async t=>{
  const f=await fixture(t);f.setOutcome('denied');await f.click();const p=f.store.metadata().panels[0];assert.equal(p.repairPending,undefined);assert.equal(f.posts.length,0);
  f.setOutcome('success');await f.click();assert.equal(f.sends,1);await f.act('confirm-repair');assert.equal(f.sends,2);assert.equal(f.store.metadata().panels.length,1);assert.equal(f.store.metadata().panels[0].id,p.id);
});
for(const deleteFails of [false,true])test(`finalization failure preserves identity when compensation deletion ${deleteFails?'fails':'succeeds'}`,async t=>{
  const f=await fixture(t),update=f.store.update.bind(f.store);let writes=0;f.setDeleteFails(deleteFails);
  f.store.update=(...args)=>++writes===3?Promise.reject(new Error('simulated write failure')):update(...args);
  await f.click();assert.equal(f.sends,1);assert.equal(f.deletes,1);const p=f.store.metadata().panels[0];assert.ok(p);assert.equal(!!p.repairPending,deleteFails);assert.equal(f.posts[0].deleted,!deleteFails);
  await f.click();assert.equal(f.sends,1);assert.equal((await new TrpgStore(f.store.path).load()).metadata().panels[0].id,p.id);
});
test('reservation failure sends nothing and recovery uses the already allocated identity',async t=>{
  const f=await fixture(t),update=f.store.update.bind(f.store);let writes=0;
  f.store.update=(...args)=>++writes===2?Promise.reject(new Error('simulated write failure')):update(...args);
  await f.click();assert.equal(f.sends,0);const p=f.store.metadata().panels[0];assert.equal(p.repairPending,undefined);
  await f.click();assert.equal(f.sends,0);await f.act('confirm-repair');assert.equal(f.sends,1);assert.equal(f.store.metadata().panels[0].id,p.id);
});
test('loss of administrator access between allocation and reservation never posts',async t=>{
  const f=await fixture(t);f.onTarget(n=>{if(n===2)f.setAllowed(false);});await f.click();assert.equal(f.sends,0);assert.equal(f.store.metadata().panels.length,1);assert.equal(f.store.metadata().panels[0].repairPending,undefined);
  await f.click();assert.equal(f.sends,0);
});
test('missing history access fails before allocating or posting and can be corrected safely',async t=>{
  const f=await fixture(t);f.setHistory(false);await f.click();assert.equal(f.sends,0);assert.equal(f.store.metadata().panels.length,0);assert.equal(f.s.view,'install');
  f.setHistory(true);await f.click();assert.equal(f.sends,1);assert.equal(f.store.metadata().panels.length,1);
});
test('failure to allocate a panel never sends or consumes the current install confirmation',async t=>{
  const f=await fixture(t),update=f.store.update.bind(f.store);f.store.update=async()=>{throw new Error('simulated allocation failure');};
  await f.click();assert.equal(f.sends,0);assert.equal(f.store.metadata().panels.length,0);assert.equal(f.s.view,'install');f.store.update=update;
  await f.click();assert.equal(f.sends,1);
});

test('recovery form keeps invalid links for correction and adopts a valid copied link without posting',async t=>{
  const f=await fixture(t);f.setOutcome('unknown');await f.click();await f.act('form-repair-result');
  const link=`https://discord.com/channels/${guildId}/${targetId}/${f.posts[0].id}`,wrong=link.replace(targetId,'123456789012345602');
  let fetched=0;const fetch=f.guild.channels.fetch;f.guild.channels.fetch=async(...args)=>{fetched++;return fetch(...args);};
  await f.act(`submit-repair-result:${f.s.repairToken}`,{fields:{getTextInputValue:()=>wrong}});assert.equal(fetched,0);assert.equal(f.s.repairMessageDraft,wrong);assert.ok(f.store.metadata().panels[0].repairPending);
  const form=await f.act('form-repair-result'),field=form.modal.toJSON().components[0].components[0];assert.equal(field.value,wrong);assert.equal(field.max_length,200);assert.match(field.label,/リンク/);
  await f.act(`submit-repair-result:${f.s.repairToken}`,{fields:{getTextInputValue:()=>link}});assert.equal(f.store.metadata().panels[0].messageId,f.posts[0].id);assert.equal(f.store.metadata().panels[0].repairPending,undefined);assert.equal(f.sends,1);
});
test('a copied link cannot adopt a different bot panel even in the correct channel',async t=>{
  const f=await fixture(t);f.setOutcome('unknown');await f.click();await f.act('form-repair-result');
  const original=f.posts[0].components;f.posts[0].components=[];
  const link=`https://discord.com/channels/${guildId}/${targetId}/${f.posts[0].id}`;
  await f.act(`submit-repair-result:${f.s.repairToken}`,{fields:{getTextInputValue:()=>link}});assert.ok(f.store.metadata().panels[0].repairPending);assert.equal(f.store.metadata().panels[0].messageId,null);assert.equal(f.sends,1);f.posts[0].components=original;
});
test('revoked administrator cannot adopt a linked message and leaves the uncertain installation intact',async t=>{
  const f=await fixture(t);f.setOutcome('unknown');await f.click();await f.act('form-repair-result');const before=f.store.metadata();f.setAllowed(false);
  await f.act(`submit-repair-result:${f.s.repairToken}`,{fields:{getTextInputValue:()=>`https://discord.com/channels/${guildId}/${targetId}/${f.posts[0].id}`}});assert.deepEqual(f.store.metadata(),before);assert.equal(f.sends,1);
});
