import test from 'node:test';
import assert from 'node:assert/strict';
import {createScheduleController,scheduleScreen,schedulePanel} from '../src/schedule-ui.js';
import {ScheduleStore} from '../src/schedule-store.js';
import {selectedScheduleEvents} from '../src/schedule-query.js';

const input=(extra={})=>({title:'定例卓',date:'2026-10-31',time:'23:00-01:00',place:'VC',description:'説明',...extra});
const controls=message=>message.components.flatMap(r=>r.toJSON().components);
const CHANNEL='234567890123456789';
async function fixture(extra={}){
  let allowed=true;const store=new ScheduleStore(),calendarId=await store.create('予定表');
  const eventId=await store.putEvent(calendarId,null,input(extra));
  const c=createScheduleController({store,guild:{id:'guild'},now:()=>Date.parse('2026-10-20T00:00:00Z'),access:async(_i,admin)=>{if(admin&&!allowed)throw new Error('permission');}});
  const interaction=(customId,extra={})=>({customId,user:{id:'owner'},channelId:CHANNEL,message:{flags:{has:()=>true}},async deferReply(){this.deferred=true;},async deferUpdate(){this.deferred=true;},async editReply(message){this.result=message;},async reply(message){this.result=message;this.replied=true;},async showModal(modal){this.modal=modal;},...extra});
  await c.openAdmin(interaction());const s=[...c.sessions.sessions.values()][0];
  const handle=async(id,extra)=>{const i=interaction(id,extra);await c.handle(i);return i;};
  const actionId=action=>controls(scheduleScreen(s,store)).find(v=>v.custom_id?.split(':')[3]===action)?.custom_id??`schedule:${s.id}:${s.turn}:${action}`;
  const act=(action,extra)=>handle(actionId(action),extra);
  await act('calendar',{values:[calendarId]});await act('event',{values:[eventId]});
  const setCount=async value=>{const form=await act('repeat-count');return handle(form.modal.toJSON().custom_id,{fields:{getTextInputValue:()=>String(value)}});};
  const preview=async()=>{await act('repeat');return act('repeat-preview');};
  return {store,c,s,calendarId,eventId,act,handle,actionId,setCount,preview,interaction,deny:()=>allowed=false};
}

test('recurrence previews all dates without saving and a single confirmation creates independent events once',async()=>{
  const f=await fixture(),source=structuredClone(f.store.calendar(f.calendarId).events[0]);
  const preview=await f.preview();assert.equal(f.s.view,'repeat-preview');assert.equal(f.store.calendar(f.calendarId).events.length,1);
  assert.match(JSON.stringify(preview.result),/2026-11-07/);assert.match(JSON.stringify(preview.result),/2026-11-28/);
  const old=f.actionId('repeat-save');await f.handle(old);await f.handle(old);
  const events=f.store.calendar(f.calendarId).events;assert.equal(events.length,5);assert.deepEqual(events[0],source);assert.equal(new Set(events.map(e=>e.id)).size,5);
  for(const e of events.slice(1)){assert.equal(e.start,1380);assert.equal(e.end,1500);assert.equal(e.place,'VC');assert.equal(e.description,'説明');}
  assert.equal(f.s.month,'2026-11');assert.equal(f.s.repeatStage,undefined);assert.equal(f.s.view,'list');
});

test('monthly setup uses explicit added count and skips nonexistent days before confirmation',async()=>{
  const f=await fixture();await f.act('repeat');await f.act('repeat-frequency',{values:['monthly']});await f.setCount(2);await f.act('repeat-preview');
  assert.deepEqual(f.s.repeatStage.inputs.map(e=>e.date),['2026-12-31','2027-01-31']);assert.equal(f.store.calendar(f.calendarId).events.length,1);
  await f.act('repeat-save');assert.equal(f.store.calendar(f.calendarId).events.length,3);
});

test('invalid count forms and a stale submitted form cannot change the current confirmation',async()=>{
  const f=await fixture();await f.act('repeat');const form=await f.act('repeat-count'),id=form.modal.toJSON().custom_id;
  for(const value of ['0','27','1.5','-1','xx'])await f.handle(id,{fields:{getTextInputValue:()=>value}});
  assert.equal(f.s.repeat.count,4);assert.equal(f.store.calendar(f.calendarId).events.length,1);
  await f.handle(id,{fields:{getTextInputValue:()=> '1'}});assert.equal(f.s.repeat.count,1);
  await f.act('repeat-preview');await f.handle(id,{fields:{getTextInputValue:()=> '26'}});assert.equal(f.s.repeatStage.inputs.length,1);
  await f.act('repeat-save');assert.equal(f.store.calendar(f.calendarId).events.length,2);
});

test('changing conditions, cancellation and reopening invalidate the preceding save confirmation',async()=>{
  for(const mode of ['conditions','cancel','reopen']){
    const f=await fixture();await f.preview();const old=f.actionId('repeat-save');
    if(mode==='conditions'){await f.act('repeat-settings');await f.setCount(1);await f.act('repeat-preview');}
    if(mode==='cancel')await f.act('event-back');
    if(mode==='reopen')await f.c.openAdmin(f.interaction());
    await f.handle(old);assert.equal(f.store.calendar(f.calendarId).events.length,1);
    if(mode==='conditions'){await f.act('repeat-save');assert.equal(f.store.calendar(f.calendarId).events.length,2);}
    else assert.equal(f.s.view,'event');
  }
});

test('a changed or deleted source and any changed calendar revision refuse the entire pending batch',async()=>{
  for(const change of ['source','deleted','calendar']){
    const f=await fixture();await f.preview();
    if(change==='source')await f.store.putEvent(f.calendarId,f.eventId,input({title:'変更後'}),0);
    if(change==='deleted')await f.store.removeEvent(f.calendarId,f.eventId,0);
    if(change==='calendar')await f.store.rename(f.calendarId,'改名',f.store.calendar(f.calendarId).revision);
    const before=f.store.calendar(f.calendarId);await f.act('repeat-save');assert.deepEqual(f.store.calendar(f.calendarId),before);
  }
});

for(const change of ['revoked','expired','replaced','turn'])test(`queued recurrence save refuses ${change} context without partial events`,async()=>{
  const f=await fixture();await f.preview();const before=f.store.calendar(f.calendarId);let release,entered;
  const queued=new Promise(r=>entered=r);f.store.tail=new Promise(r=>release=r);const update=f.store.update.bind(f.store);f.store.update=(...args)=>{entered();return update(...args);};
  const pending=f.act('repeat-save');await queued;
  if(change==='revoked')f.deny();if(change==='expired')f.s.expires=0;if(change==='replaced')f.c.sessions.sessions.set(f.s.id,{...f.s});if(change==='turn')f.s.turn++;
  release();await pending;assert.deepEqual(f.store.calendar(f.calendarId),before);assert.equal(f.s.busy,false);
});

test('wrong owner, source channel and read-only scope cannot enter or confirm recurrence',async()=>{
  const f=await fixture();await f.preview();const id=f.actionId('repeat-save');
  for(const extra of [{user:{id:'other'}},{channelId:'other'}])await f.handle(id,extra);
  assert.equal(f.store.calendar(f.calendarId).events.length,1);
  const viewer=await fixture();viewer.s.scope='viewer';
  const publication=await viewer.store.reserve(viewer.calendarId,CHANNEL,'2026-10');
  // A viewer session must have a valid publication before it reaches the action guard.
  await viewer.store.complete(publication,'123456789012345678');viewer.s.publicationId=publication;
  await viewer.act('repeat');assert.equal(viewer.s.repeat,undefined);
});

test('disk failure permits explicit retry without partially adding the batch',async()=>{
  const f=await fixture();await f.preview();const before=f.store.calendar(f.calendarId),save=f.store.save.bind(f.store);f.store.save=async()=>{throw new Error('disk');};
  await f.act('repeat-save');assert.deepEqual(f.store.calendar(f.calendarId),before);assert.equal(f.s.view,'repeat-preview');f.store.save=save;
  await f.act('repeat-save');assert.equal(f.store.calendar(f.calendarId).events.length,5);
});
test('recurrence confirmation is revalidated again after serialization before committing the staged changes',async()=>{
  for(const change of ['permission','turn']){
    const f=await fixture();await f.preview();const before=f.store.calendar(f.calendarId),save=f.store.save.bind(f.store);
    f.store.save=(data,check)=>{if(change==='permission')f.deny();else f.s.turn++;return save(data,check);};
    await f.act('repeat-save');assert.deepEqual(f.store.calendar(f.calendarId),before);
  }
});

test('multi-day forms preserve ranges when editing and copying, and monthly panels include crossing events',async()=>{
  const f=await fixture({date:'2026-10-30〜2026-11-02',time:''});
  for(const action of ['edit-event','copy-event']){const i=await f.act(action),field=i.modal.toJSON().components[1].components[0];assert.equal(field.value,'2026-10-30〜2026-11-02');assert.equal(field.max_length,21);}
  const c=f.store.calendar(f.calendarId),panel=schedulePanel(c,{id:'preview',month:'2026-11'});assert.match(JSON.stringify(panel),/定例卓/);assert.match(JSON.stringify(panel),/11\/2/);
  assert.equal(selectedScheduleEvents(c,{month:'2026-11',date:'2026-11-01'}).length,1);
  await f.act('repeat');await f.setCount(1);await f.act('repeat-preview');assert.equal(f.s.repeatStage.inputs[0].date,'2026-11-06〜2026-11-09');
});

test('maximum recurrence previews fit Discord limits and do not create before confirmation',async()=>{
  const f=await fixture({title:'界'.repeat(80),place:'界'.repeat(100),description:'界'.repeat(500)});await f.act('repeat');await f.setCount(26);await f.act('repeat-preview');
  for(const view of ['event','repeat-settings','repeat-preview']){
    const message=scheduleScreen({...f.s,view},f.store);assert.ok(message.components.length<=5);for(const row of message.components)assert.ok(row.toJSON().components.length<=5);for(const e of message.embeds)assert.ok(e.toJSON().description.length<=4096);assert.deepEqual(message.allowedMentions.parse,[]);
  }
  assert.equal(f.store.calendar(f.calendarId).events.length,1);
});
