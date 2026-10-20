import test from 'node:test';
import assert from 'node:assert/strict';
import {PermissionsBitField,PermissionFlagsBits as P} from 'discord.js';
import {createDensukeController,densukeScreen} from '../src/densuke-ui.js';
const fields=name=>({name,schedule:'10/21 20:00',description:'',password:''});
const controls=card=>card.components.flatMap(row=>row.toJSON().components);
const createId=card=>controls(card).find(c=>c.label==='この内容で作成').custom_id;
async function fixture(){
  let time=0,value={densukeEmail:'owner@example.com'};const calls=[],posts=[];
  const settings={get:()=>structuredClone(value),async update(fn,check=()=>{}){await check();const next=structuredClone(value);fn(next);value=next;}};
  const controller=createDensukeController({settings,now:()=>time,client:{async create(event,email,{beforeCreate}={}){await beforeCreate?.();calls.push({event:structuredClone(event),email});return {answer:'https://www.densuke.biz/list?cd=Example'+calls.length};}}});
  const interaction=(customId,extra={})=>({customId,user:{id:'owner'},channelId:'channel',memberPermissions:new PermissionsBitField(P.Administrator),message:{},channel:{send:async message=>{posts.push(message);}},async deferReply(){this.deferred=true;},async deferUpdate(){this.deferred=true;},async editReply(value){this.result=value;},async reply(value){this.result=value;},async showModal(value){this.modal=value;},...extra});
  const opened=interaction();await controller.open(opened);const s=[...controller.sessions.sessions.values()][0];
  const handle=async(customId,extra)=>{const i=interaction(customId,extra);await controller.handle(i);return i;},act=(action,extra)=>{const id=['choice','form','cancel','share','restart','form-email','form-recover'].includes(action)?controls(densukeScreen(s)).find(c=>c.custom_id?.split(':')[2]===action)?.custom_id:`densuke:${s.id}:${action}`;return handle(id??`densuke:${s.id}:${action}:closed`,extra);};
  const form=async()=> (await act('form')).modal.toJSON().custom_id;
  const submit=async(id,input)=>handle(id,{fields:{getTextInputValue:key=>input[key]}});
  const review=async(name='First preview')=>(await submit(await form(),fields(name))).result;
  return {controller,s,calls,posts,setTime:value=>time=value,settings,interaction,handle,act,form,submit,review};
}
test('an old private review card cannot create event contents edited on another reopened card',async()=>{
  const f=await fixture(),a=await f.review();await f.controller.open(f.interaction());const b=await f.review('Second preview');
  await f.handle(createId(a));assert.equal(f.calls.length,0);assert.equal(f.s.event.name,'Second preview');
  await f.handle(createId(b));assert.equal(f.calls.length,1);assert.equal(f.calls[0].event.name,'Second preview');
});
test('reopening an identical review preserves its confirmation and creates at most once',async()=>{
  const f=await fixture(),a=await f.review(),reopened=f.interaction();await f.controller.open(reopened);assert.equal(createId(reopened.result),createId(a));
  await f.handle(createId(a));await f.handle(createId(reopened.result));assert.equal(f.calls.length,1);
});
test('opening a newer event form invalidates an older form before and after the new submission',async()=>{
  const f=await fixture(),a=await f.form(),b=await f.form();await f.submit(a,fields('Stale'));assert.equal(f.s.event.name,'');assert.equal(f.s.phase,'draft');
  await f.submit(b,fields('Current'));await f.submit(a,fields('Stale'));assert.equal(f.s.event.name,'Current');assert.equal(f.s.phase,'review');assert.equal(f.calls.length,0);
});
for(const change of ['choice','email'])test(`changing ${change} invalidates the preceding creation confirmation`,async()=>{
  const f=await fixture(),a=await f.review();let updated;
  if(change==='choice')updated=await f.act('choice',{values:['2']});
  else{const form=await f.act('form-email');updated=await f.handle(form.modal.toJSON().custom_id,{fields:{getTextInputValue:()=> 'new@example.com'}});}
  await f.handle(createId(a));assert.equal(f.calls.length,0);await f.handle(createId(updated.result));assert.equal(f.calls.length,1);
  if(change==='choice')assert.equal(f.calls[0].event.choice,'2');else assert.equal(f.calls[0].email,'new@example.com');
});
test('cancel and restart invalidate both old content forms and creation confirmations',async()=>{
  const f=await fixture(),a=await f.review(),modal=await f.form();await f.act('cancel');await f.act('restart');const b=await f.review('New event');
  await f.submit(modal,fields('Old form'));assert.equal(f.s.event.name,'New event');await f.handle(createId(a));assert.equal(f.calls.length,0);await f.handle(createId(b));assert.equal(f.calls[0].event.name,'New event');
});
test('invalid input keeps corrections but cannot replay into a newer valid review',async()=>{
  const f=await fixture(),a=await f.review(),bad=await f.form();await f.submit(bad,{...fields('Needs correction'),password:'BAD_12'});assert.equal(f.s.phase,'draft');assert.equal(f.s.inputDraft.name,'Needs correction');
  await f.handle(createId(a));assert.equal(f.calls.length,0);const good=await f.form(),fixed=await f.submit(good,fields('Corrected'));await f.submit(bad,{...fields('Replay'),password:'BAD_12'});
  assert.equal(f.s.phase,'review');assert.equal(f.s.event.name,'Corrected');await f.handle(createId(fixed.result));assert.equal(f.calls[0].event.name,'Corrected');
});
test('missing and forged create tokens do not reserve a creation or call the external client',async()=>{
  const f=await fixture(),a=await f.review();for(const suffix of ['create','create:forged'])await f.act(suffix);assert.equal(f.calls.length,0);await f.handle(createId(a));assert.equal(f.calls.length,1);
});

test('missing or forged event form tokens preserve both the event and the valid open form',async()=>{
  const f=await fixture(),a=await f.review(),modal=await f.form();
  for(const action of ['submit','submit:forged'])await f.act(action,{fields:{getTextInputValue:key=>fields('Forged')[key]}});
  assert.equal(f.s.event.name,'First preview');assert.equal(f.s.phase,'review');assert.equal(f.s.inputDraft,undefined);assert.equal(f.calls.length,0);
  const updated=await f.submit(modal,fields('Valid form'));assert.equal(f.s.event.name,'Valid form');assert.notEqual(createId(updated.result),createId(a));
});
test('unchanged choice and fixed email keep an otherwise identical confirmation usable',async()=>{
  const f=await fixture(),a=await f.review();const choice=await f.act('choice',{values:['1']});assert.equal(createId(choice.result),createId(a));
  const form=await f.act('form-email'),saved=await f.handle(form.modal.toJSON().custom_id,{fields:{getTextInputValue:()=> 'owner@example.com'}});assert.equal(createId(saved.result),createId(a));
  await f.handle(createId(a));assert.equal(f.calls.length,1);
});
test('event changes invalidate an old recovery form and recovery clears old event confirmations',async()=>{
  const f=await fixture(),a=await f.review(),oldRecovery=(await f.act('form-recover')).modal.toJSON().custom_id;await f.review('Changed event');
  const input={fields:{getTextInputValue:()=> 'https://densuke.biz/list?cd=Saved'}};await f.handle(oldRecovery,input);assert.equal(f.s.phase,'review');assert.equal(f.s.result,undefined);assert.equal(f.calls.length,0);
  const latest=(await f.act('form-recover')).modal.toJSON().custom_id;await f.handle(latest,input);assert.equal(f.s.phase,'done');assert.equal(f.s.reviewToken,undefined);assert.equal(f.s.eventToken,undefined);
  await f.act('restart');const next=await f.review('Next event');await f.handle(createId(a));assert.equal(f.calls.length,0);await f.handle(createId(next));assert.equal(f.calls[0].event.name,'Next event');
});

test('old share and restart controls cannot operate on a later completed event',async()=>{
  const f=await fixture(),a=await f.review('First event'),doneA=await f.handle(createId(a));
  const shareA=controls(doneA.result).find(c=>c.custom_id?.split(':')[2]==='share').custom_id,restartA=controls(doneA.result).find(c=>c.custom_id?.split(':')[2]==='restart').custom_id;
  await f.controller.open(f.interaction());await f.act('restart');const b=await f.review('Later event');f.setTime(300001);const doneB=await f.handle(createId(b));
  await f.handle(shareA);assert.equal(f.posts.length,0);assert.equal(f.s.shared,undefined);await f.handle(restartA);assert.equal(f.s.phase,'done');assert.equal(f.s.event.name,'Later event');
  const shareB=controls(doneB.result).find(c=>c.custom_id?.split(':')[2]==='share').custom_id;await f.handle(shareB);assert.equal(f.posts.length,1);assert.ok(JSON.stringify(f.posts[0]).includes('Example2'));
});
test('old choice and cancel controls cannot change or discard a newer event draft',async()=>{
  const f=await fixture(),a=await f.review('First event'),choice=controls(a).find(c=>c.custom_id?.split(':')[2]==='choice').custom_id,cancel=controls(a).find(c=>c.custom_id?.split(':')[2]==='cancel').custom_id;
  const b=await f.review('Current event');await f.handle(choice,{values:['2']});assert.equal(f.s.event.choice,'1');await f.handle(cancel);assert.equal(f.s.phase,'review');assert.equal(f.s.event.name,'Current event');
  await f.handle(createId(b));assert.equal(f.calls[0].event.name,'Current event');
});
test('a harmless pre-send notice failure preserves the identical visible confirmation for retry',async()=>{
  const f=await fixture(),a=await f.review();let updates=0;
  const failed=await f.handle(createId(a),{async editReply(value){this.result=value;if(++updates===1)throw new Error('notice failed');}});
  assert.equal(createId(failed.result),createId(a));assert.equal(f.calls.length,0);await f.handle(createId(a));assert.equal(f.calls.length,1);
});
test('unsigned and forged screen controls do not open forms, alter choices or cancel a review',async()=>{
  for(const action of ['form','choice','cancel']){
    const f=await fixture(),card=await f.review();for(const suffix of [action,action+':forged']){const i=await f.handle(`densuke:${f.s.id}:${suffix}`,{values:['2']});assert.equal(i.modal,undefined);assert.equal(f.s.event.choice,'1');assert.equal(f.s.phase,'review');}
    await f.handle(createId(card));assert.equal(f.calls.length,1);
  }
});

const emailInput=value=>({fields:{getTextInputValue:()=>value}});
const emailForm=async f=>(await f.act('form-email')).modal.toJSON().custom_id;
test('an old email form cannot borrow the base recipient of a newer form',async()=>{
  const f=await fixture();await f.review();const old=await emailForm(f);
  await f.settings.update(c=>c.densukeEmail='other-admin@example.com');const latest=await emailForm(f);
  await f.handle(old,emailInput('stale@example.com'));assert.equal(f.settings.get().densukeEmail,'other-admin@example.com');
  await f.handle(latest,emailInput('current@example.com'));assert.equal(f.settings.get().densukeEmail,'current@example.com');assert.equal(f.calls.length,0);
});
test('opening a second email form invalidates the first even if the recipient is unchanged',async()=>{
  const f=await fixture();await f.review();const old=await emailForm(f),latest=await emailForm(f);
  await f.handle(old,emailInput('stale@example.com'));assert.equal(f.settings.get().densukeEmail,'owner@example.com');
  await f.handle(latest,emailInput('current@example.com'));assert.equal(f.settings.get().densukeEmail,'current@example.com');
});
for(const change of ['content','choice','restart','recovery'])test(`an email form opened before ${change} cannot change the recipient of the current event`,async()=>{
  const f=await fixture();await f.review();const old=await emailForm(f);
  if(change==='content')await f.review('Changed event');
  if(change==='choice')await f.act('choice',{values:['2']});
  if(change==='restart'){await f.act('cancel');await f.act('restart');await f.review('Next event');}
  if(change==='recovery'){const recovery=(await f.act('form-recover')).modal.toJSON().custom_id;await f.handle(recovery,{fields:{getTextInputValue:()=> 'https://densuke.biz/list?cd=Saved'}});await f.act('restart');await f.review('Next event');}
  await f.handle(old,emailInput('stale@example.com'));assert.equal(f.settings.get().densukeEmail,'owner@example.com');assert.equal(f.calls.length,0);
  const latest=await emailForm(f);await f.handle(latest,emailInput('current@example.com'));assert.equal(f.settings.get().densukeEmail,'current@example.com');
});
test('missing and forged email form identifiers cannot save or consume the latest valid form',async()=>{
  const f=await fixture();await f.review();const latest=await emailForm(f);
  for(const action of ['submit-email','submit-email:forged'])await f.handle(`densuke:${f.s.id}:${action}`,emailInput('forged@example.com'));
  assert.equal(f.settings.get().densukeEmail,'owner@example.com');await f.handle(latest,emailInput('current@example.com'));assert.equal(f.settings.get().densukeEmail,'current@example.com');
});
test('invalid email input preserves a valid form and a saved form cannot be replayed',async()=>{
  const f=await fixture();await f.review();const form=await emailForm(f);
  await f.handle(form,emailInput('invalid'));assert.equal(f.settings.get().densukeEmail,'owner@example.com');await f.handle(form,emailInput('saved@example.com'));assert.equal(f.settings.get().densukeEmail,'saved@example.com');
  await f.handle(form,emailInput('replay@example.com'));assert.equal(f.settings.get().densukeEmail,'saved@example.com');
});
