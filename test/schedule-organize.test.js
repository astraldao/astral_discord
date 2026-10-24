import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ScheduleStore,scheduleEvent} from '../src/schedule-store.js';
import {scheduleRestoration,historyFingerprint} from '../src/schedule-history.js';
import {scheduleShift,scheduleConflicts} from '../src/schedule-shift.js';
import {scheduleExport} from '../src/schedule-export.js';
import {createScheduleController,scheduleScreen,schedulePanel} from '../src/schedule-ui.js';
import {ChannelType} from 'discord.js';
const input=(extra={})=>({title:'定例ゲーム会',date:'2026-10-25',time:'20:00-23:00',place:'VC',description:'説明',...extra});
async function fixture(path=null){const store=new ScheduleStore(path),id=await store.create('予定表'),event=await store.putEvent(id,null,input());return {store,id,event,calendar:()=>store.calendar(id)};}
async function disk(t){const dir=await mkdtemp(join(tmpdir(),'astral-organize-'));t.after(()=>rm(dir,{recursive:true,force:true}));return {dir,path:join(dir,'schedules.json')};}
test('editing, colors and deletion retain bounded before/after snapshots while initial creation does not',async()=>{
 const f=await fixture();assert.equal(f.calendar().history,undefined);await f.store.putEvent(f.id,f.event,input({title:'新しい名前',color:'red'}),0);let h=f.calendar().history[0];assert.equal(h.kind,'edit');assert.equal(h.before[0].title,'定例ゲーム会');assert.equal(h.after[0].title,'新しい名前');await f.store.setEventColor(f.id,f.event,'green',1);h=f.calendar().history[1];assert.equal(h.before[0].color,'red');assert.equal(h.after[0].color,'green');await f.store.removeEvent(f.id,f.event,2);h=f.calendar().history[2];assert.equal(h.kind,'delete');assert.equal(h.after.length,0);assert.equal(h.before[0].color,'green');
});
test('deleted events restore with the same ID, full fields and a higher revision, exactly once',async t=>{
 const {path}=await disk(t),f=await fixture(path);await f.store.putEvent(f.id,f.event,input({date:'2026-10-30〜2026-11-02',time:'',color:'purple'}),0);const before=f.calendar().events[0];await f.store.removeEvent(f.id,f.event,1);const h=f.calendar().history.at(-1),ids=await f.store.restoreHistory(f.id,h.id,f.calendar().revision);assert.deepEqual(ids,[f.event]);assert.deepEqual(f.calendar().events[0],{...before,revision:2});assert.equal(f.calendar().history.find(e=>e.id===h.id).restored,true);await assert.rejects(f.store.restoreHistory(f.id,h.id,f.calendar().revision));assert.equal(f.calendar().history.at(-1).kind,'restore');await assert.rejects(f.store.restoreHistory(f.id,f.calendar().history.at(-1).id,f.calendar().revision));const loaded=await new ScheduleStore(path).load();assert.deepEqual(loaded.calendar(f.id),f.calendar());
});
test('restoring an edit recovers all fields without overwriting a later change or replaying old forms',async()=>{
 const f=await fixture(),before=f.calendar().events[0];await f.store.putEvent(f.id,f.event,input({title:'別の予定',date:'2026-10-26',time:'',place:'別の場所',description:'別の説明',color:'red'}),0);let c=f.calendar(),h=c.history[0];await f.store.restoreHistory(f.id,h.id,c.revision);assert.deepEqual(f.calendar().events[0],{...before,revision:2});await assert.rejects(f.store.putEvent(f.id,f.event,input(),0));await f.store.setEventColor(f.id,f.event,'green',2);c=f.calendar();assert.throws(()=>scheduleRestoration(c,h.id));await assert.rejects(f.store.restoreHistory(f.id,c.history[1].id,c.revision));
});
test('a later edit, reused ID or calendar revision prevents stale restoration without any partial changes',async()=>{
 const f=await fixture();await f.store.putEvent(f.id,f.event,input({title:'編集1'}),0);const old=f.calendar();await f.store.putEvent(f.id,f.event,input({title:'編集2'}),1);const before=f.calendar();await assert.rejects(f.store.restoreHistory(f.id,old.history[0].id,old.revision));await assert.rejects(f.store.restoreHistory(f.id,old.history[0].id,before.revision));assert.deepEqual(f.calendar(),before);await f.store.removeEvent(f.id,f.event,2);const h=f.calendar().history.at(-1);await f.store.update(d=>d.calendars[0].events.push({...h.before[0],revision:10}));assert.throws(()=>scheduleRestoration(f.calendar(),h.id));
});
test('restoration respects per-calendar and global event limits',async()=>{
 const f=await fixture();await f.store.removeEvent(f.id,f.event,0);const h=f.calendar().history[0];await f.store.importEvents(f.id,Array.from({length:200},(_,n)=>input({title:`予定${n}`})),f.calendar().revision);await assert.rejects(f.store.restoreHistory(f.id,h.id,f.calendar().revision));assert.equal(f.calendar().events.length,200);
});
test('history trims old operations by calendar, global count and snapshot/byte budgets',async()=>{
 const f=await fixture();for(let n=0;n<25;n++)await f.store.setEventColor(f.id,f.event,n%2?'red':'green',n);assert.equal(f.calendar().history.length,20);assert.equal(f.calendar().history[0].before[0].revision,5);
 for(let n=0;n<3;n++){const id=await f.store.create(`予定表${n}`),event=await f.store.putEvent(id,null,input());for(let r=0;r<20;r++)await f.store.setEventColor(id,event,'red',r);}
 assert.equal(f.store.data.calendars.reduce((n,c)=>n+(c.history?.length??0),0),50);
 const g=await fixture();await g.store.putEvents(g.id,Array.from({length:25},(_,n)=>input({title:`長い予定${n}`,description:'あ'.repeat(500)})),g.calendar().revision);const ids=g.calendar().events.map(e=>e.id);for(let n=0;n<20;n++)await g.store.shiftEvents(g.id,ids,1,g.calendar().revision);const all=g.calendar().history;assert.ok(all.reduce((n,h)=>n+h.before.length+h.after.length,0)<=500);assert.ok(Buffer.byteLength(JSON.stringify([all]))<=512*1024);assert.ok(all.length<20);
});
test('invalid histories are rejected on load and legacy data without history remains valid',async t=>{
 const {path}=await disk(t),f=await fixture(path),legacy=await readFile(path,'utf8');await new ScheduleStore(path).load();await f.store.removeEvent(f.id,f.event,0);const good=JSON.parse(await readFile(path,'utf8'));
 for(const mutate of [d=>d.calendars[0].history=null,d=>d.calendars[0].history[0].before=null,d=>d.calendars[0].history[0].kind='__proto__',d=>d.calendars[0].history[0].at=Number.MAX_SAFE_INTEGER,d=>d.calendars[0].history[0].before[0].date='bad',d=>d.calendars[0].history[0].restored='yes']){const d=structuredClone(good);mutate(d);await writeFile(path,JSON.stringify(d));await assert.rejects(new ScheduleStore(path).load());}
 await writeFile(path,legacy);assert.equal((await new ScheduleStore(path).load()).calendar(f.id).events.length,1);
});
test('shift planning preserves intervals, identity, metadata, input objects and year/leap boundaries',async()=>{
 const f=await fixture();await f.store.putEvent(f.id,f.event,input({date:'2028-02-28〜2028-03-01',time:'',color:'yellow'}),0);const c=f.calendar(),before=structuredClone(c),plan=scheduleShift(c,[f.event],1);assert.equal(plan.changes[0].after.date,'2028-02-29');assert.equal(plan.changes[0].after.endDate,'2028-03-02');assert.equal(plan.changes[0].after.color,'yellow');assert.deepEqual(c,before);
 await f.store.putEvent(f.id,f.event,input({date:'2026-12-31',time:'23:00-01:00'}),1);const next=scheduleShift(f.calendar(),[f.event],1).changes[0].after;assert.equal(next.date,'2027-01-01');assert.equal(next.end,1500);
 for(const [date,days] of [['2000-01-01',-1],['2099-12-31',1]])assert.throws(()=>scheduleShift({events:[{...c.events[0],date,endDate:undefined}]},[f.event],days));for(const days of [0,366,-366,1.5,'7'])assert.throws(()=>scheduleShift(c,[f.event],days));assert.throws(()=>scheduleShift(c,[f.event,f.event],1));assert.throws(()=>scheduleShift(c,['other'],1));assert.throws(()=>scheduleShift(c,Array(27).fill('id'),1));
});
test('multi-event shifts save atomically once and one history entry can restore all moved dates',async()=>{
 const f=await fixture();await f.store.putEvents(f.id,Array.from({length:25},(_,n)=>input({title:`予定${n}`})),f.calendar().revision);let saves=0;const save=f.store.save.bind(f.store);f.store.save=(...args)=>{saves++;return save(...args);};const c=f.calendar(),ids=c.events.map(e=>e.id);await f.store.shiftEvents(f.id,ids,7,c.revision);assert.equal(saves,1);assert.equal(f.calendar().events.length,26);assert.equal(f.calendar().history.length,1);assert.equal(f.calendar().history[0].kind,'shift');assert.ok(f.calendar().events.every(e=>e.date==='2026-11-01'&&e.revision===1));await assert.rejects(f.store.shiftEvents(f.id,ids,7,c.revision));const after=f.calendar();await f.store.restoreHistory(f.id,after.history[0].id,after.revision);assert.equal(saves,2);assert.deepEqual(f.calendar().events,c.events.map(e=>({...e,revision:2})));
});
test('overlap review uses end-exclusive JST intervals and bounds retained pairs at one hundred',()=>{
 const events=[['a','2026-10-25','23:00-01:00'],['b','2026-10-26','00:30-02:00'],['c','2026-10-26','02:00-03:00'],['d','2026-10-27','']].map(([id,date,time])=>({id,revision:0,...scheduleEvent(input({date,time}))}));const review=scheduleConflicts({events});assert.deepEqual(review.pairs,[['a','b']]);assert.equal(review.total,1);const dense=scheduleConflicts({events:Array.from({length:200},(_,n)=>({...events[0],id:String(n)}))});assert.equal(dense.total,19900);assert.equal(dense.pairs.length,100);
 const plan=scheduleShift({events},['d'],-1);assert.equal(plan.overlaps,1);
});
test('history data never enters public panels, ICS export or metadata',async()=>{
 const f=await fixture();await f.store.putEvent(f.id,f.event,input({description:'PRIVATE_OLD_DESCRIPTION'}),0);await f.store.putEvent(f.id,f.event,input({description:'現在の説明'}),1);const c=f.calendar();assert.ok(JSON.stringify(c.history).includes('PRIVATE_OLD'));for(const value of [scheduleExport(c,c.events).toString(),JSON.stringify(schedulePanel(c,{id:'p',month:'2026-10'})),JSON.stringify(f.store.metadata())])assert.ok(!value.includes('PRIVATE_OLD'));
});
test('revocation at the final file boundary preserves memory, disk and removes temporary history writes',async t=>{
 const {path,dir}=await disk(t),f=await fixture(path);for(const kind of ['edit','delete','shift','restore']){
  if(kind==='restore'&&!f.calendar().history?.length)await f.store.removeEvent(f.id,f.event,0);
  const before=await readFile(path,'utf8'),memory=f.calendar();let checks=0;const check=async()=>{if(++checks===2)throw new Error('revoked');};
  const action=kind==='edit'?()=>f.store.putEvent(f.id,f.event,input({title:'変更'}),0,check):kind==='delete'?()=>f.store.removeEvent(f.id,f.event,0,check):kind==='shift'?()=>f.store.shiftEvents(f.id,[f.event],7,f.calendar().revision,check):()=>f.store.restoreHistory(f.id,f.calendar().history.at(-1).id,f.calendar().revision,check);
  await assert.rejects(action());assert.equal(await readFile(path,'utf8'),before);assert.deepEqual(f.calendar(),memory);assert.deepEqual(await readdir(dir),['schedules.json']);
 }
});
const GUILD='123456789012345678',CHANNEL='234567890123456789',POST='345678901234567890',BOT='456789012345678901';
function interaction(customId,user='owner',channelId=CHANNEL){return {customId,user:{id:user},channelId,message:{id:POST,flags:{has:()=>true}},replies:[],async deferUpdate(){this.deferred=true;},async deferReply(){this.deferred=true;},async reply(m){this.replies.push(m);},async editReply(m){this.replies.push(m);},async showModal(m){this.modal=m;}};}
async function uiFixture(){
 const f=await fixture();let allowed=true,admin=true,publication;const edits=[],post={author:{id:BOT},get components(){return [{components:[{customId:`schedule:panel:${publication}`}]}];},async edit(m){edits.push(m);}};
 const guild={id:GUILD,members:{me:{id:BOT},fetchMe:async()=>({id:BOT})},channels:{fetch:async()=>({guildId:GUILD,type:ChannelType.GuildText,permissionsFor:()=>({has:()=>true}),messages:{fetch:async()=>post},send:()=>assert.fail('no new public posts')})}};
 const controller=createScheduleController({store:f.store,guild,access:async(i,power)=>{if(!allowed||power&&!admin)throw new Error('denied');}});await controller.openAdmin(interaction());const s=[...controller.sessions.sessions.values()][0];
 const click=(action,values,session=s)=>Object.assign(interaction(`schedule:${session.id}:${session.turn}:${action}`,session.userId),values===undefined?{}:{values});const act=async(action,values,session=s)=>{const i=click(action,values,session);await controller.handle(i);return i;};await act('calendar',[f.id]);
 return {...f,controller,s,edits,click,act,screen:()=>scheduleScreen(s,f.store),allowed:value=>allowed=value,admin:value=>admin=value,async submit(open,value){const i=Object.assign(interaction(open.modal.toJSON().custom_id),{fields:{getTextInputValue:()=>value}});await controller.handle(i);return i;},async viewer(){publication=await f.store.reserve(f.id,CHANNEL,'2026-10');await f.store.complete(publication,POST);await controller.handle(interaction(`schedule:panel:${publication}`,'viewer'));return [...controller.sessions.sessions.values()].find(v=>v.userId==='viewer');},publication:()=>publication};
}
const controls=m=>m.components.flatMap(r=>r.toJSON().components);
test('bulk selection spans pages, rejects off-page values and saves only after an explicit preview',async()=>{
 const f=await uiFixture();await f.store.putEvents(f.id,Array.from({length:25},(_,n)=>input({title:`予定${String(n).padStart(2,'0')}`})),f.calendar().revision);await f.act('tools');await f.act('organize');await f.act('bulk-open');const first=controls(f.screen()).find(c=>c.type===3).options.map(o=>o.value);await f.act('bulk-pick',first);assert.equal(f.s.bulk.eventIds.length,25);await f.act('bulk-next');const last=controls(f.screen()).find(c=>c.type===3).options[0].value;await f.act('bulk-pick',[first[0]]);assert.equal(f.s.bulk.eventIds.length,25);await f.act('bulk-pick',[last]);assert.equal(f.s.bulk.eventIds.length,26);const before=f.calendar();await f.act('bulk-save');assert.deepEqual(f.calendar(),before);await f.act('bulk-preview');assert.equal(f.s.view,'bulk-preview');await f.act('bulk-save');assert.ok(f.calendar().events.every(e=>e.date==='2026-11-01'));assert.equal(f.s.view,'organize');assert.equal(f.calendar().history.at(-1).before.length,26);
});
test('bulk day form changes only the preview; invalid values, stale previews and changed candidates cannot save',async()=>{
 const f=await uiFixture();await f.act('organize');await f.act('bulk-open');await f.act('bulk-pick',[f.event]);const form=await f.act('bulk-days');await f.submit(form,'0');assert.equal(f.s.bulk.days,7);const form2=await f.act('bulk-days');await f.submit(form2,'-7');assert.equal(f.s.bulk.days,-7);assert.equal(f.calendar().events[0].date,'2026-10-25');await f.act('bulk-preview');await f.store.putEvent(f.id,f.event,input({title:'別の編集'}),0);const before=f.calendar();await f.act('bulk-save');assert.deepEqual(f.calendar(),before);
});
test('history restoration is confirmed, refreshes existing publications and old buttons cannot replay it',async()=>{
 const f=await uiFixture();await f.viewer();await f.store.removeEvent(f.id,f.event,0);await f.act('organize');await f.act('history');const h=f.calendar().history[0];await f.act('history-pick',[h.id]);await f.act('restore-save');assert.equal(f.calendar().events.length,0);await f.act('restore-preview');const old=f.click('restore-save');await f.controller.handle(old);assert.equal(f.calendar().events[0].id,f.event);assert.equal(f.edits.length,1);const after=f.calendar();await f.controller.handle(old);assert.deepEqual(f.calendar(),after);
});
test('cancel and resume never apply a pending bulk move or restoration and preserve the original search',async()=>{
 const f=await uiFixture();f.s.query='ゲーム';await f.act('organize');await f.act('bulk-open');await f.act('bulk-pick',[f.event]);await f.act('bulk-preview');const old=f.click('bulk-save'),before=f.calendar();await f.controller.openAdmin(interaction());assert.equal(f.s.view,'organize');assert.equal(f.s.bulkStage,undefined);await f.controller.handle(old);assert.deepEqual(f.calendar(),before);assert.equal(f.s.query,'ゲーム');
});
test('viewer scope, other owners/channels, revoked permissions and expiry cannot read history or write changes',async()=>{
 for(const mode of ['viewer','owner','channel','revoked','expiry']){
  const f=await uiFixture();await f.store.putEvent(f.id,f.event,input({description:'PRIVATE_HISTORY'}),0);await f.store.putEvent(f.id,f.event,input(),1);let s=f.s;if(mode==='viewer'){s=await f.viewer();f.admin(false);}const i=f.click('history',undefined,s);if(mode==='owner')i.user.id='other';if(mode==='channel')i.channelId='other';if(mode==='revoked')f.allowed(false);if(mode==='expiry')s.expires=0;const before=f.calendar();await f.controller.handle(i);assert.ok(!JSON.stringify(i.replies).includes('PRIVATE_HISTORY'));assert.deepEqual(f.calendar(),before);if(mode==='viewer')for(const action of ['organize','bulk-open','bulk-save','restore-save','conflicts']){const denied=await f.act(action,undefined,s);assert.ok(!JSON.stringify(denied.replies).includes('PRIVATE_HISTORY'));assert.deepEqual(f.calendar(),before);}
 }
});
test('confirmation rechecks queued permissions and context after disk work before a bulk move commits',async()=>{
 for(const mode of ['revoke','stage','expiry']){
  const f=await uiFixture();await f.act('organize');await f.act('bulk-open');await f.act('bulk-pick',[f.event]);await f.act('bulk-preview');const before=f.calendar(),save=f.store.save.bind(f.store);f.store.save=async(next,check)=>{if(mode==='revoke')f.allowed(false);if(mode==='stage')delete f.s.bulkStage;if(mode==='expiry')f.s.expires=0;return save(next,check);};await f.act('bulk-save');assert.deepEqual(f.calendar(),before);
 }
});
test('organize screens respect Discord limits with long fields and only admin sees organizer actions',async()=>{
 const f=await uiFixture();await f.store.putEvent(f.id,f.event,input({title:'*'.repeat(80),place:'*'.repeat(100),description:'*'.repeat(500),color:'red'}),0);await f.store.putEvent(f.id,f.event,input({title:'_'.repeat(80),place:'_'.repeat(100),description:'_'.repeat(500),color:'blue'}),1);await f.act('organize');await f.act('history');const h=f.calendar().history.at(-1);await f.act('history-pick',[h.id]);for(const action of ['restore-preview','history-return','organize','bulk-open','bulk-pick','bulk-preview','bulk-select','organize','conflicts']){await f.act(action,action==='bulk-pick'?[f.event]:undefined);const m=f.screen();assert.ok(m.components.length<=5);for(const r of m.components)assert.ok(r.toJSON().components.length<=5);assert.ok(m.embeds.every(e=>e.toJSON().description.length<4096));assert.deepEqual(m.allowedMentions.parse,[]);}
 const viewer=await f.viewer();await f.act('tools',undefined,viewer);assert.ok(!controls(scheduleScreen(viewer,f.store)).some(b=>b.custom_id?.endsWith(':organize')));
});
test('history clearing requires the reviewed revision and exact history set, and preserves events/publications',async()=>{
 const f=await fixture();await f.store.putEvent(f.id,f.event,input({title:'編集後'}),0);const before=f.calendar(),key=historyFingerprint(before);await assert.rejects(f.store.clearHistory(f.id,before.revision,'bad'));assert.deepEqual(f.calendar(),before);await f.store.clearHistory(f.id,before.revision,key);assert.equal(f.calendar().history,undefined);assert.deepEqual(f.calendar().events,before.events);assert.deepEqual(f.calendar().publications,before.publications);await assert.rejects(f.store.clearHistory(f.id,before.revision,key));
});
test('clearing history is confirmed, cancellable and cannot run from viewer scope or an old confirmation',async()=>{
 const f=await uiFixture();await f.store.putEvent(f.id,f.event,input({title:'編集'}),0);await f.act('organize');await f.act('history');await f.act('history-clear-save');assert.equal(f.calendar().history.length,1);await f.act('history-clear');assert.equal(f.s.view,'history-clear-confirm');await f.act('history-return');assert.equal(f.calendar().history.length,1);await f.act('history-clear');const old=f.click('history-clear-save');await f.controller.handle(old);assert.equal(f.calendar().history,undefined);const after=f.calendar();await f.controller.handle(old);assert.deepEqual(f.calendar(),after);
});
test('restoration and history clearing recheck final permission and source state before committing',async()=>{
 for(const action of ['restore-save','history-clear-save']){
  const f=await uiFixture();await f.store.removeEvent(f.id,f.event,0);await f.act('organize');await f.act('history');if(action==='restore-save'){await f.act('history-pick',[f.calendar().history[0].id]);await f.act('restore-preview');}else await f.act('history-clear');const before=f.calendar(),save=f.store.save.bind(f.store);f.store.save=async(next,check)=>{f.allowed(false);return save(next,check);};await f.act(action);assert.deepEqual(f.calendar(),before);
 }
});
test('global event limits can refuse a deleted event restoration even when its own calendar has room',async()=>{
 const f=await fixture();await f.store.removeEvent(f.id,f.event,0);await f.store.importEvents(f.id,Array.from({length:199},(_,n)=>input({title:`初期${n}`})),f.calendar().revision);for(let c=0;c<4;c++){const id=await f.store.create(`別の予定表${c}`);await f.store.importEvents(id,Array.from({length:200},(_,n)=>input({title:`予定${n}`})),0);}const extra=await f.store.create('最後');await f.store.putEvent(extra,null,input());const before=f.calendar();await assert.rejects(f.store.restoreHistory(f.id,before.history[0].id,before.revision));assert.deepEqual(f.calendar(),before);
});

test('restoring the oldest retained edit returns to history even when adding the restore log prunes the source',async()=>{
 const f=await uiFixture();await f.store.putEvent(f.id,f.event,input({title:'最初の編集'}),0);for(let n=0;n<19;n++){const e=await f.store.putEvent(f.id,null,input({title:`別の予定${n}`}));await f.store.putEvent(f.id,e,input({title:`別の編集${n}`}),0);}
 await f.act('organize');await f.act('history');for(let n=0;n<3;n++)await f.act('history-next');const h=f.calendar().history[0];await f.act('history-pick',[h.id]);await f.act('restore-preview');const result=await f.act('restore-save');assert.equal(f.calendar().events.find(e=>e.id===f.event).title,'定例ゲーム会');assert.equal(f.s.view,'history');assert.ok(JSON.stringify(result.replies).includes('復元しました'));assert.equal(f.calendar().history.some(e=>e.id===h.id),false);
});

async function expiredHistoryFixture(){
 const f=await uiFixture();await f.store.putEvent(f.id,f.event,input({title:'変更'}),0);await f.act('organize');await f.act('history');await f.act('history-pick',[f.calendar().history[0].id]);for(let n=0;n<20;n++){const e=await f.store.putEvent(f.id,null,input({title:`予定${n}`}));await f.store.putEvent(f.id,e,input({title:`編集${n}`}),0);}return f;
}
test('a pruned history detail returns to usable organizer controls instead of trapping the admin in an error',async()=>{
 const f=await expiredHistoryFixture(),before=f.calendar();const i=await f.act('restore-preview');assert.equal(f.s.view,'organize');assert.ok(controls(i.replies.at(-1)).some(b=>b.custom_id?.endsWith(':history')));assert.deepEqual(f.calendar(),before);
});
test('resuming a pruned history detail opens the available history list without replaying a write',async()=>{
 const f=await expiredHistoryFixture(),before=f.calendar(),i=interaction();await f.controller.openAdmin(i);assert.equal(f.s.view,'history');assert.ok(JSON.stringify(i.replies).includes('履歴の一覧に戻りました'));assert.deepEqual(f.calendar(),before);
});

test('conflict review opens only an on-page event and returns to recomputed conflicts after editing',async()=>{
 const f=await uiFixture();const other=await f.store.putEvent(f.id,null,input({title:'重なる予定'}));await f.act('organize');await f.act('conflicts');assert.ok(controls(f.screen()).some(c=>c.custom_id?.endsWith(':conflict-event')));await f.act('conflict-event',[f.event]);assert.equal(f.s.view,'event');assert.equal(f.s.eventId,f.event);assert.ok(controls(f.screen()).some(c=>c.custom_id?.endsWith(':conflicts-return')));await f.store.putEvent(f.id,f.event,input({date:'2026-10-26'}),0);await f.act('conflicts-return');assert.equal(f.s.view,'conflicts');assert.equal(f.s.conflictReport.total,0);assert.equal(f.s.conflictReport.revision,f.calendar().revision);await f.act('conflict-event',[other]);assert.equal(f.s.view,'conflicts');
});
test('viewers cannot navigate from conflict IDs and foreign calendar reports cannot be used',async()=>{
 const f=await uiFixture(),viewer=await f.viewer();const before=f.calendar();await f.act('conflict-event',[f.event],viewer);assert.equal(viewer.view,'list');assert.deepEqual(f.calendar(),before);await f.act('organize');await f.act('conflicts');f.s.conflictReport.calendarId='foreign';await f.act('conflict-event',[f.event]);assert.notEqual(f.s.view,'event');
});
