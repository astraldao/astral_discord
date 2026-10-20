import test from 'node:test';
import assert from 'node:assert/strict';
import {createScheduleController,scheduleScreen} from '../src/schedule-ui.js';
import {ScheduleStore} from '../src/schedule-store.js';
import {scheduleExport} from '../src/schedule-export.js';
const CHANNEL='234567890123456789';
const event=(extra={})=>({title:'取り込む予定',date:'2026-10-21',time:'20:00-23:00',place:'VC',description:'非公開の説明',...extra});
const controls=message=>message.components.flatMap(r=>r.toJSON().components);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
async function file(inputs){const s=new ScheduleStore(),id=await s.create('入力');for(const e of inputs)await s.putEvent(id,null,e);const c=s.calendar(id);return scheduleExport(c,c.events);}
async function fixture({inputs=[event()],read}={}){
  let allowed=true,time=Date.parse('2026-10-20T00:00:00Z'),reads=0;const body=await file(inputs),store=new ScheduleStore(),id=await store.create('保存先');
  const c=createScheduleController({store,guild:{id:'guild'},now:()=>time,access:async(_i,admin)=>{if(admin&&!allowed)throw new Error('permission');},readImport:async(...args)=>{reads++;return read?read(...args):body;}});
  const interaction=(customId,extra={})=>({customId,user:{id:'owner'},channelId:CHANNEL,message:{flags:{has:()=>true}},async deferReply(){this.deferred=true;},async deferUpdate(){this.deferred=true;},async editReply(message){this.result=message;},async reply(message){this.result=message;this.replied=true;},async showModal(modal){this.modal=modal;},...extra});
  const handle=async(customId,extra)=>{const i=interaction(customId,extra);await c.handle(i);return i;};
  await c.openAdmin(interaction());const s=[...c.sessions.sessions.values()][0];
  const actionId=action=>controls(scheduleScreen(s,store)).find(v=>v.custom_id?.split(':')[3]===action)?.custom_id??`schedule:${s.id}:${s.turn}:${action}`;
  const act=(action,extra)=>handle(actionId(action),extra);
  await act('calendar',{values:[id]});await act('tools');
  const uploaded={fields:{getUploadedFiles:()=>new Map([['file',{id:'file',name:'calendar.ics'}]])}};
  const choose=()=>act('import');
  const upload=async()=>{const form=await choose();assert.ok(form.modal);return handle(form.modal.toJSON().custom_id,uploaded);};
  return {store,c,s,id,body,act,handle,actionId,interaction,uploaded,choose,upload,deny:()=>allowed=false,advance:value=>time+=value,get reads(){return reads;}};
}
test('one-file modal previews dates and details privately without saving, then commits once and deduplicates reimport',async()=>{
  const f=await fixture(),form=await f.choose();assert.equal(form.modal.toJSON().components[0].component.type,19);assert.equal(form.deferred,undefined);
  const loaded=await f.handle(form.modal.toJSON().custom_id,f.uploaded);assert.equal(f.s.view,'import-preview');assert.equal(f.store.calendar(f.id).events.length,0);assert.match(JSON.stringify(loaded.result),/既存の共有先/);
  await f.act('import-event',{values:['0']});assert.match(JSON.stringify(f.s.importStage),/非公開の説明/);await f.act('import-preview');
  const old=f.actionId('import-save');await f.handle(old);await f.handle(old);assert.equal(f.store.calendar(f.id).events.length,1);assert.equal(f.s.importStage,undefined);
  await f.act('tools');f.advance(10000);await f.upload();assert.equal(f.s.importStage.events.length,0);assert.equal(f.s.importStage.duplicates,1);
  const disabled=controls(scheduleScreen(f.s,f.store)).find(v=>v.custom_id?.split(':')[3]==='import-save');assert.equal(disabled.disabled,true);await f.act('import-save');assert.equal(f.store.calendar(f.id).events.length,1);
});
test('all pages and full descriptions can be inspected and a maximum import preview fits Discord limits',async()=>{
  const inputs=Array.from({length:200},(_,n)=>event({title:`予定${n}`}));const f=await fixture({inputs});
  await f.upload();assert.equal(f.s.importStage.events.length,200);assert.equal(f.store.calendar(f.id).events.length,0);
  for(let n=0;n<25;n++){
    const screen=scheduleScreen(f.s,f.store);assert.ok(screen.components.length<=5);for(const row of screen.components)assert.ok(row.toJSON().components.length<=5);for(const embed of screen.embeds)assert.ok(embed.toJSON().description.length<=4096);assert.deepEqual(screen.allowedMentions.parse,[]);
    if(n<24)await f.act('import-next');
  }
  await f.act('import-event',{values:['199']});assert.equal(f.s.view,'import-detail');const detail=scheduleScreen(f.s,f.store);assert.match(detail.embeds[0].toJSON().description,/非公開の説明/);assert.ok(detail.embeds[0].toJSON().description.length<=4096);
  const maximum=await fixture({inputs:[event({title:'界'.repeat(80),place:'界'.repeat(100),description:'界'.repeat(500)})]});await maximum.upload();await maximum.act('import-event',{values:['0']});assert.match(scheduleScreen(maximum.s,maximum.store).embeds[0].toJSON().description,/界{500}/);
});
test('only the newest file form can change a preview, while a failed replacement retains the previous candidate',async()=>{
  const f=await fixture(),old=await f.choose(),latest=await f.choose();await f.handle(old.modal.toJSON().custom_id,f.uploaded);assert.equal(f.reads,0);
  await f.handle(latest.modal.toJSON().custom_id,f.uploaded);const stage=f.s.importStage;assert.ok(stage);
  const replacement=await f.choose();await f.handle(replacement.modal.toJSON().custom_id,f.uploaded);assert.equal(f.s.importStage,stage);assert.equal(f.reads,1);
  assert.equal(f.store.calendar(f.id).events.length,0);
});
test('cancelling and reopening clear candidates and refuse the preceding save button',async()=>{
  for(const action of ['cancel','reopen']){
    const f=await fixture();await f.upload();const old=f.actionId('import-save');if(action==='cancel')await f.act('import-cancel');else await f.c.openAdmin(f.interaction());
    assert.equal(f.s.importStage,undefined);assert.equal(f.s.view,'tools');await f.handle(old);assert.equal(f.store.calendar(f.id).events.length,0);
  }
});
for(const change of ['permission','expired','replaced','calendar','turn'])test(`an import read that outlives ${change} context never creates or displays its candidate`,async()=>{
  const gate=deferred(),f=await fixture({read:()=>gate.promise}),form=await f.choose(),task=f.handle(form.modal.toJSON().custom_id,f.uploaded);
  while(!f.reads)await new Promise(r=>setImmediate(r));
  if(change==='permission')f.deny();if(change==='expired')f.s.expires=0;if(change==='replaced')f.c.sessions.sessions.set(f.s.id,{...f.s});if(change==='calendar')await f.store.rename(f.id,'変更',0);if(change==='turn')f.s.turn++;
  gate.resolve(f.body);const result=await task;assert.equal(f.s.importStage,undefined);assert.equal(f.store.calendar(f.id).events.length,0);assert.ok(!JSON.stringify(result.result).includes('非公開の説明'));
});
test('confirmation refuses a changed destination revision and failed disk writes preserve the candidate for an explicit retry',async()=>{
  const f=await fixture();await f.upload();await f.store.rename(f.id,'変更後',0);await f.act('import-save');assert.equal(f.store.calendar(f.id).events.length,0);
  const retry=await fixture();await retry.upload();const save=retry.store.save.bind(retry.store);retry.store.save=async()=>{throw new Error('disk');};await retry.act('import-save');assert.equal(retry.store.calendar(retry.id).events.length,0);assert.ok(retry.s.importStage);
  retry.store.save=save;await retry.act('import-save');assert.equal(retry.store.calendar(retry.id).events.length,1);
});
for(const change of ['permission','expired','replaced','turn'])test(`queued import confirmation rechecks ${change} context and never saves a prefix`,async()=>{
  const f=await fixture();await f.upload();let release,entered;f.store.tail=new Promise(r=>release=r);const queue=new Promise(r=>entered=r),update=f.store.update.bind(f.store);f.store.update=(...args)=>{entered();return update(...args);};
  const pending=f.act('import-save');await queue;
  if(change==='permission')f.deny();if(change==='expired')f.s.expires=0;if(change==='replaced')f.c.sessions.sessions.set(f.s.id,{...f.s});if(change==='turn')f.s.turn++;
  release();await pending;assert.equal(f.store.calendar(f.id).events.length,0);assert.equal(f.s.busy,false);
});
test('foreign users/channels and viewer scope cannot upload or confirm imports',async()=>{
  const f=await fixture(),form=await f.choose(),submit=form.modal.toJSON().custom_id;
  for(const extra of [{user:{id:'other'}},{channelId:'other'}])await f.handle(submit,{...f.uploaded,...extra});assert.equal(f.reads,0);
  await f.handle(submit,f.uploaded);for(const extra of [{user:{id:'other'}},{channelId:'other'}])await f.handle(f.actionId('import-save'),extra);assert.equal(f.store.calendar(f.id).events.length,0);
  const p=await f.store.reserve(f.id,CHANNEL,'2026-10');await f.store.complete(p,'345678901234567890');f.s.scope='viewer';f.s.publicationId=p;f.s.view='tools';delete f.s.importStage;
  const screen=scheduleScreen(f.s,f.store);assert.ok(!controls(screen).some(c=>c.custom_id?.endsWith(':import')));await f.act('import');assert.equal(f.reads,1);assert.equal(f.s.importStage,undefined);
});
test('import keeps prior data on quota failure and frees the global reader lock after a failed read',async()=>{
  const f=await fixture();await f.store.importEvents(f.id,Array.from({length:200},(_,n)=>event({title:`既存${n}`})),0);const before=f.store.calendar(f.id);await f.upload();assert.deepEqual(f.store.calendar(f.id),before);assert.equal(f.s.importStage,undefined);
  let reads=0;const retry=await fixture({read:async()=>{if(++reads===1)throw new Error('network');return file([event()]);}});await retry.upload();assert.equal(retry.s.importStage,undefined);retry.advance(10000);await retry.upload();assert.equal(retry.s.importStage.events.length,1);
});
test('a single reader is shared by administrators, and its lock is released for a later authorized upload',async()=>{
  const gate=deferred(),f=await fixture({read:()=>gate.promise});
  await f.c.openAdmin(f.interaction('open',{user:{id:'other'}}));const other=[...f.c.sessions.sessions.values()].find(s=>s.userId==='other');
  const act=async(s,action,extra={})=>{const i=f.interaction(`schedule:${s.id}:${s.turn}:${action}`,{user:{id:s.userId},...extra});await f.c.handle(i);return i;};
  await act(other,'calendar',{values:[f.id]});await act(other,'tools');const formA=await f.choose(),formB=await act(other,'import');
  const pending=f.handle(formA.modal.toJSON().custom_id,f.uploaded);while(!f.reads)await new Promise(r=>setImmediate(r));
  const denied=f.interaction(formB.modal.toJSON().custom_id,{user:{id:'other'},...f.uploaded});await f.c.handle(denied);assert.equal(f.reads,1);assert.equal(other.importStage,undefined);
  gate.resolve(f.body);await pending;f.advance(10000);const again=await act(other,'import');const accepted=f.interaction(again.modal.toJSON().custom_id,{user:{id:'other'},...f.uploaded});await f.c.handle(accepted);assert.equal(f.reads,2);assert.equal(other.importStage.events.length,1);
});
test('at most four private import candidates are retained, and cancelling one frees a slot',async()=>{
  const f=await fixture();const sessions=[];
  for(let n=0;n<4;n++){
    const user=`admin${n}`;await f.c.openAdmin(f.interaction('open',{user:{id:user}}));const s=[...f.c.sessions.sessions.values()].find(v=>v.userId===user);
    const act=async(action,extra={})=>{const i=f.interaction(`schedule:${s.id}:${s.turn}:${action}`,{user:{id:user},...extra});await f.c.handle(i);return i;};
    await act('calendar',{values:[f.id]});await act('tools');const form=await act('import');const i=f.interaction(form.modal.toJSON().custom_id,{user:{id:user},...f.uploaded});await f.c.handle(i);assert.ok(s.importStage);sessions.push({s,act});f.advance(10000);
  }
  const blocked=await f.choose();assert.equal(blocked.modal,undefined);assert.equal(f.s.importStage,undefined);
  await sessions[0].act('import-cancel');assert.equal(sessions[0].s.importStage,undefined);await f.upload();assert.ok(f.s.importStage);
});
test('a permission change during serialization refuses the import before committing',async()=>{
  const f=await fixture();await f.upload();const save=f.store.save.bind(f.store);f.store.save=(data,check)=>{f.deny();return save(data,check);};
  await f.act('import-save');assert.equal(f.store.calendar(f.id).events.length,0);assert.equal(f.s.busy,false);
});
