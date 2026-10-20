import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,stat,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ChannelType,PermissionsBitField,PermissionFlagsBits as P} from 'discord.js';
import {ScheduleStore,scheduleDate,scheduleTime,currentScheduleMonth,shiftScheduleMonth} from '../src/schedule-store.js';
import {createScheduleController,schedulePanel,scheduleScreen,eventTime} from '../src/schedule-ui.js';
const GUILD='123456789012345678',CHANNEL='234567890123456789',POST='345678901234567890',BOT='456789012345678901';
const event=(extra={})=>({title:'セッション',date:'2026/10/17',time:'20:00-23:00',place:'VC',description:'みんなで遊ぶ',...extra});
function i(customId='unused',user='owner',channelId=CHANNEL){return {customId,user:{id:user},channelId,message:{id:POST,flags:{has:()=>true}},replies:[],async deferReply(p){this.deferred=true;this.replies.push(p);},async deferUpdate(){this.deferred=true;},async editReply(p){this.replies.push(p);},async reply(p){this.replied=true;this.replies.push(p);},async showModal(m){this.modal=m;}};}
const click=(s,a)=>i(`schedule:${s.id}:${s.turn}:${a}`);
const form=(x,values)=>Object.assign(i(x.modal.toJSON().custom_id),{fields:{getTextInputValue:k=>values[k]??''}});
async function fixture(){let admin=true,visible=true,botPermission=true,sendError=false,editError=false,sendCount=0;const store=new ScheduleStore(),id=await store.create('卓サーバー'),calendar=store.calendar(id);let posted;
  const channel={id:CHANNEL,guildId:GUILD,type:ChannelType.GuildText,permissionsFor:()=>({has:()=>botPermission}),messages:{fetch:async value=>{const messageId=typeof value==='string'?value:value.message;if(messageId!==POST||!posted)throw new Error('Unknown Message');return posted;}},send:async p=>{sendCount++;posted={id:POST,author:{id:BOT},components:p.components.map(r=>({components:r.components.map(b=>({customId:b.toJSON().custom_id}))})),payload:p,async edit(next){if(editError)throw new Error('edit');this.payload=next;}};if(sendError)throw new Error('network');return posted;}};
  const guild={id:GUILD,members:{me:{id:BOT},async fetchMe(){return this.me;}},channels:{fetch:async id=>{if(id!==CHANNEL)throw new Error('Unknown Channel');return channel;}}},c=createScheduleController({store,guild,now:()=>Date.parse('2026-10-14T12:00:00Z'),access:async(x,power)=>{if(!visible||power&&!admin)throw new Error('permission');}});await c.openAdmin(i());const s=[...c.sessions.sessions.values()][0];await c.handle(Object.assign(click(s,'calendar'),{values:[id]}));return {store,c,s,id,channel,guild,posted:()=>posted,sendCount:()=>sendCount,admin:x=>admin=x,visible:x=>visible=x,bot:x=>botPermission=x,sendError:x=>sendError=x,editError:x=>editError=x};
}
async function add(f,input=event()){const x=click(f.s,'new-event');await f.c.handle(x);assert.ok(x.modal);await f.c.handle(form(x,input));return f.store.calendar(f.id).events.at(-1);}
async function publish(f){await f.c.handle(click(f.s,'list'));await f.c.handle(click(f.s,'publish'));await f.c.handle(Object.assign(click(f.s,'channel'),{values:[CHANNEL]}));const x=click(f.s,'send');await f.c.handle(x);return x;}
test('schedule validates calendar dates, leap days, JST month boundaries and overnight times without locale guessing',()=>{
  assert.equal(scheduleDate('2028/02/29'),'2028-02-29');for(const date of ['2026/02/29','2026/04/31','2026/13/01','2026/00/01','26/10/17','x','2026/10/00'])assert.throws(()=>scheduleDate(date));assert.deepEqual(scheduleTime(''),{start:null,end:null});assert.deepEqual(scheduleTime('20:00'),{start:1200,end:null});assert.deepEqual(scheduleTime('23:00-01:00'),{start:1380,end:1500});assert.equal(eventTime({start:1380,end:1500}),'23:00〜翌日 01:00');for(const value of ['24:00','1:00','20:60','12:00-12:00','12+1','x'])assert.throws(()=>scheduleTime(value));assert.equal(currentScheduleMonth(Date.parse('2026-10-31T15:00:00Z')),'2026-11');assert.equal(shiftScheduleMonth('2026-12',1),'2027-01');assert.throws(()=>shiftScheduleMonth('2000-01',-1));
});
test('schedule edits and deletion are atomic, revision checked, and never resurrect an obsolete event',async()=>{
  const w=new ScheduleStore(),id=await w.create('予定'),e=await w.putEvent(id,null,event()),first=w.calendar(id).events[0];await w.putEvent(id,e,event({title:'変更'}),first.revision);await assert.rejects(w.putEvent(id,e,event(),first.revision));const last=w.calendar(id).events[0];await w.removeEvent(id,e,last.revision);await assert.rejects(w.putEvent(id,e,event(),last.revision));assert.equal(w.calendar(id).events.length,0);const before=w.metadata();w.save=async()=>{throw new Error('disk');};await assert.rejects(w.putEvent(id,null,event()));assert.deepEqual(w.metadata(),before);
});
test('durable schedules preserve pending posts and reject corrupt dates, duplicate posts and oversized data',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'schedule-'));try{const path=join(dir,'schedules.json'),w=new ScheduleStore(path),id=await w.create('予定');await w.putEvent(id,null,event());const p=await w.reserve(id,CHANNEL,'2026-10');const loaded=await new ScheduleStore(path).load();assert.equal(loaded.publication(p).status,'pending');assert.equal(loaded.calendar(id).events.length,1);assert.equal((await stat(path)).mode&0o777,0o600);assert.deepEqual(await readdir(dir),['schedules.json']);const good=JSON.parse(await readFile(path,'utf8'));for(const mutate of [d=>d.calendars[0].events[0].date='2026-02-30',d=>d.calendars[0].publications[0].channelId='../bad',d=>d.calendars[0].publications.push({...d.calendars[0].publications[0],id:'other'})]){const bad=structuredClone(good);mutate(bad);await writeFile(path,JSON.stringify(bad));await assert.rejects(new ScheduleStore(path).load());}await writeFile(path,'x'.repeat(2*1024*1024+1));await assert.rejects(new ScheduleStore(path).load());}finally{await rm(dir,{recursive:true,force:true});}
});
test('create, add, edit, rename and delete forms serialize and update the posted schedule instead of sending another message',async()=>{
  const f=await fixture(),first=await add(f);await publish(f);assert.equal(f.sendCount(),1);assert.equal(f.store.calendar(f.id).publications[0].status,'ready');await f.c.handle(click(f.s,'list'));await f.c.handle(Object.assign(click(f.s,'event'),{values:[first.id]}));const edit=click(f.s,'edit-event');await f.c.handle(edit);assert.equal(edit.modal.toJSON().components[0].components[0].value,'セッション');await f.c.handle(form(edit,event({title:'別のシナリオ',time:'23:00-01:00'})));assert.equal(f.sendCount(),1);assert.ok(JSON.stringify(f.posted().payload).includes('別のシナリオ'));assert.ok(JSON.stringify(f.posted().payload).includes('翌日'));
  await f.c.handle(click(f.s,'list'));const rename=click(f.s,'rename');await f.c.handle(rename);await f.c.handle(form(rename,{value:'新しい予定表'}));assert.ok(JSON.stringify(f.posted().payload).includes('新しい予定表'));await f.c.handle(Object.assign(click(f.s,'event'),{values:[first.id]}));await f.c.handle(click(f.s,'delete-event'));assert.equal(f.store.calendar(f.id).events.length,1);await f.c.handle(click(f.s,'confirm-delete'));assert.equal(f.store.calendar(f.id).events.length,0);assert.ok(JSON.stringify(f.posted().payload).includes('まだありません'));assert.equal(f.sendCount(),1);
});
test('viewers can browse only the clicked calendar in its publication channel and never navigate into editing',async()=>{
  const f=await fixture(),e=await add(f);await publish(f);const p=f.store.calendar(f.id).publications[0];f.admin(false);const start=i(`schedule:panel:${p.id}`,'viewer');await f.c.handle(start);const s=[...f.c.sessions.sessions.values()].find(s=>s.userId==='viewer');assert.equal(s.scope,'viewer');assert.ok(!JSON.stringify(start.replies).includes('予定を編集'));const a=(action)=>i(`schedule:${s.id}:${s.turn}:${action}`,'viewer');await f.c.handle(Object.assign(a('event'),{values:[e.id]}));assert.ok(JSON.stringify(a('event')).length>0);for(const action of ['home','new-event','edit-event','publish','send','calendar','form','delete-event']){const x=a(action);await f.c.handle(x);assert.ok(JSON.stringify(x.replies).includes('管理者専用'));assert.equal(f.store.calendar(f.id).events.length,1);}await f.c.handle(a('list'));await f.c.handle(a('month-next'));assert.equal(s.month,'2026-11');
  for(const x of [i(`schedule:${s.id}:${s.turn}:list`,'other'),i(`schedule:${s.id}:${s.turn}:list`,'viewer','567890123456789012'),Object.assign(i(`schedule:panel:${p.id}`,'intruder'),{message:{id:'567890123456789012',flags:{has:()=>false}}})]){await f.c.handle(x);assert.ok(!JSON.stringify(x.replies).includes('みんなで遊ぶ'));}f.visible(false);const x=a('event');x.values=[e.id];await f.c.handle(x);assert.ok(!JSON.stringify(x.replies).includes('みんなで遊ぶ'));
});
test('send preview refuses stale calendar changes, wrong channel permissions and duplicate sends',async()=>{
  const f=await fixture();await add(f);await f.c.handle(click(f.s,'list'));await f.c.handle(click(f.s,'publish'));f.bot(false);const denied=Object.assign(click(f.s,'channel'),{values:[CHANNEL]});await f.c.handle(denied);assert.equal(f.s.view,'publish');assert.equal(f.sendCount(),0);f.bot(true);await f.c.handle(Object.assign(click(f.s,'channel'),{values:[CHANNEL]}));await f.store.putEvent(f.id,null,event({title:'並行追加'}));await f.c.handle(click(f.s,'send'));assert.equal(f.sendCount(),0);await publish(f);assert.equal(f.sendCount(),1);await publish(f);assert.equal(f.sendCount(),1);
});
test('unknown send outcome remains reserved through restart and cannot be retried; own message URL restores it',async()=>{
  const f=await fixture();await add(f);f.sendError(true);await publish(f);assert.equal(f.sendCount(),1);const p=f.store.calendar(f.id).publications[0];assert.equal(p.status,'pending');assert.equal((await f.c.refresh()).updated,0);assert.equal(f.sendCount(),1);await publish(f);assert.equal(f.sendCount(),1);await f.c.handle(click(f.s,'publications'));await f.c.handle(Object.assign(click(f.s,'publication'),{values:[p.id]}));const recover=click(f.s,'recover');await f.c.handle(recover);await f.c.handle(form(recover,{value:`https://discord.com/channels/${GUILD}/${CHANNEL}/${POST}`}));assert.equal(f.store.publication(p.id).status,'ready');assert.equal(f.sendCount(),1);assert.ok(JSON.stringify(f.posted().payload).includes('セッション'));
});
test('recovery cannot adopt another bot, channel, or unrelated message even if its URL is valid',async()=>{
  const f=await fixture();f.sendError(true);await publish(f);const p=f.store.calendar(f.id).publications[0];await f.c.handle(click(f.s,'publications'));await f.c.handle(Object.assign(click(f.s,'publication'),{values:[p.id]}));const recover=click(f.s,'recover');await f.c.handle(recover);f.posted().author.id='567890123456789012';await f.c.handle(form(recover,{value:`https://discord.com/channels/${GUILD}/${CHANNEL}/${POST}`}));assert.equal(f.store.publication(p.id).status,'pending');f.posted().author.id=BOT;f.posted().components=[];await f.c.handle(form(recover,{value:`https://discord.com/channels/${GUILD}/${CHANNEL}/${POST}`}));assert.equal(f.store.publication(p.id).status,'pending');
});
test('pending cancellation and display-month edits require unchanged publication state and do not duplicate posts',async()=>{
  const f=await fixture();f.sendError(true);await publish(f);let p=f.store.calendar(f.id).publications[0];await f.c.handle(click(f.s,'publications'));await f.c.handle(Object.assign(click(f.s,'publication'),{values:[p.id]}));await f.c.handle(click(f.s,'cancel-pending'));assert.equal(f.store.calendar(f.id).publications.length,1);await f.c.handle(click(f.s,'confirm-cancel'));assert.equal(f.store.calendar(f.id).publications.length,0);f.sendError(false);await publish(f);p=f.store.calendar(f.id).publications[0];const month=click(f.s,'edit-month');await f.c.handle(month);await f.c.handle(form(month,{value:'2026/11'}));assert.equal(f.store.publication(p.id).month,'2026-11');assert.ok(JSON.stringify(f.posted().payload).includes('11月'));assert.equal(f.sendCount(),2);
});
test('queued permission loss, stale form token and failed persistence never commit a schedule edit',async()=>{
  const f=await fixture();const x=click(f.s,'new-event');await f.c.handle(x);let release;f.store.tail=new Promise(r=>release=r);const job=f.c.handle(form(x,event()));await new Promise(r=>setImmediate(r));f.admin(false);release();await job;assert.equal(f.store.calendar(f.id).events.length,0);f.admin(true);const wrong=form(x,event());wrong.customId=wrong.customId.replace(f.s.form.token,'bad');await f.c.handle(wrong);assert.equal(f.store.calendar(f.id).events.length,0);f.store.save=async()=>{throw new Error('disk');};await f.c.handle(form(x,event()));assert.equal(f.store.calendar(f.id).events.length,0);
});
test('all schedule screens, 200 dense events, max-length text and month boundaries fit Discord and disable mentions',async()=>{
  const w=new ScheduleStore(),id=await w.create('*'.repeat(60));for(let n=0;n<200;n++)await w.putEvent(id,null,event({title:'*'.repeat(80),description:'x'.repeat(500),date:`2026/10/${String(n%28+1).padStart(2,'0')}`}));const c=w.calendar(id),s={id:'session',userId:'owner',scope:'admin',calendarId:id,month:'2026-10',view:'list',page:0,turn:1};for(const view of ['list','event','home','publish','publications']){s.view=view;s.eventId=c.events[0].id;const m=scheduleScreen(s,w);m.embeds.forEach(e=>assert.ok(e.toJSON().description.length<=4096));assert.ok(m.components.length<=5);for(const r of m.components){const row=r.toJSON();assert.ok(row.components.length<=5);for(const b of row.components)assert.ok(!b.custom_id||b.custom_id.length<=100);}assert.deepEqual(m.allowedMentions.parse,[]);}
  const publicPanel=schedulePanel(c,{id:'pub',month:'2026-10'});assert.ok(publicPanel.embeds[0].toJSON().description.length<4096);assert.ok(publicPanel.embeds.some(e=>e.toJSON().description.includes('ほか 188件')));assert.deepEqual(publicPanel.allowedMentions.parse,[]);await assert.rejects(w.putEvent(id,null,event()));assert.equal(w.calendar(id).events.length,200);
});
test('successful edits stay saved when a public refresh fails and manual refresh never creates another message',async()=>{
  const f=await fixture(),e=await add(f);await publish(f);await f.c.handle(click(f.s,'list'));await f.c.handle(Object.assign(click(f.s,'event'),{values:[e.id]}));const x=click(f.s,'edit-event');await f.c.handle(x);f.editError(true);await f.c.handle(form(x,event({title:'保存は成功'})));assert.equal(f.store.calendar(f.id).events[0].title,'保存は成功');assert.equal(f.sendCount(),1);await f.c.handle(click(f.s,'publications'));await f.c.handle(click(f.s,'refresh-posts'));assert.equal(f.sendCount(),1);f.editError(false);await f.c.refresh();assert.ok(JSON.stringify(f.posted().payload).includes('保存は成功'));
});
test('new calendars serialize a named form, choose current JST date and stale creation forms cannot create duplicates',async()=>{
  const f=await fixture();await f.c.handle(click(f.s,'home'));const title=click(f.s,'new-calendar');await f.c.handle(title);const x=form(title,{value:'新しい共有予定表'});await f.c.handle(x);assert.equal(f.store.metadata().length,2);assert.equal(f.store.calendar(f.s.calendarId).title,'新しい共有予定表');await f.c.handle(x);assert.equal(f.store.metadata().length,2);const add=click(f.s,'new-event');await f.c.handle(add);assert.equal(add.modal.toJSON().components[1].components[0].value,'2026-10-14');
});
test('publication validation rejects a channel from another server before reserving or sending',async()=>{
  const f=await fixture();f.channel.guildId='567890123456789012';await publish(f);assert.equal(f.sendCount(),0);assert.equal(f.store.calendar(f.id).publications.length,0);
});
test('an administrator opening the public panel gets a read-only viewer, and expired sessions expose no details',async()=>{
  const f=await fixture(),e=await add(f);await publish(f);const p=f.store.calendar(f.id).publications[0];const start=i(`schedule:panel:${p.id}`,'admin-viewer');await f.c.handle(start);const s=[...f.c.sessions.sessions.values()].find(s=>s.userId==='admin-viewer');assert.equal(s.scope,'viewer');const edit=i(`schedule:${s.id}:${s.turn}:edit-event`,'admin-viewer');await f.c.handle(edit);assert.ok(JSON.stringify(edit.replies).includes('管理者専用'));s.expires=0;const expired=i(`schedule:${s.id}:${s.turn}:event`,'admin-viewer');expired.values=[e.id];await f.c.handle(expired);assert.ok(!JSON.stringify(expired.replies).includes('みんなで遊ぶ'));
});
test('default access requires Administrator for management and fresh channel visibility for viewers',async()=>{
  let permissions=new PermissionsBitField(P.ManageGuild),visible=true;const f=await fixture();f.guild.members.fetch=async()=>({permissions});f.channel.permissionsFor=()=>({has:()=>visible});const c=createScheduleController({guild:f.guild,store:f.store});await c.openAdmin(i());assert.equal(c.sessions.sessions.size,0);permissions=new PermissionsBitField(P.Administrator);visible=false;await c.openAdmin(i());assert.equal(c.sessions.sessions.size,0);visible=true;await c.openAdmin(i());assert.equal(c.sessions.sessions.size,1);
});
test('failure to save a successful send retains its reservation and does not send again',async()=>{
  const f=await fixture();f.store.save=async d=>{if(d.calendars.some(c=>c.publications.some(p=>p.status==='ready')))throw new Error('disk');};await publish(f);assert.equal(f.sendCount(),1);assert.equal(f.store.calendar(f.id).publications[0].status,'pending');await publish(f);assert.equal(f.sendCount(),1);
});
test('serialized public refreshes end at the latest calendar revision even when an older edit is in flight',async()=>{
  const f=await fixture(),e=await add(f);await publish(f);let release,entered;const waiting=new Promise(r=>entered=r),pause=new Promise(r=>release=r);let first=true;f.posted().edit=async function(p){if(first){first=false;entered();await pause;}this.payload=p;};await f.store.putEvent(f.id,e.id,event({title:'最初の変更'}),0);const a=f.c.refresh(f.id);await waiting;await f.store.putEvent(f.id,e.id,event({title:'最新の変更'}),1);const b=f.c.refresh(f.id);release();await Promise.all([a,b]);assert.ok(JSON.stringify(f.posted().payload).includes('最新の変更'));assert.equal(f.sendCount(),1);
});

test('calendar attachments appear on public posts, private views and previews; list toggle clears them',async()=>{
  const f=await fixture();await add(f);await f.c.handle(click(f.s,'list'));const screen=scheduleScreen(f.s,f.store);assert.equal(screen.embeds[0].toJSON().image.url,'attachment://calendar.png');assert.equal(screen.files.length,1);assert.ok(screen.files[0].attachment.length<150000);await f.c.handle(click(f.s,'display'));assert.equal(f.s.display,'list');assert.equal(scheduleScreen(f.s,f.store).files,undefined);assert.deepEqual(scheduleScreen(f.s,f.store).attachments,[]);await f.c.handle(click(f.s,'display'));assert.equal(f.s.display,'calendar');await publish(f);assert.equal(f.posted().payload.files.length,1);assert.equal(f.posted().payload.embeds[0].toJSON().image.url,'attachment://calendar.png');
});
test('viewer may jump directly to a month and toggle views, but navigation forms cannot write or expose admin buttons',async()=>{
  const f=await fixture();await publish(f);const p=f.store.calendar(f.id).publications[0];await f.c.handle(i(`schedule:panel:${p.id}`,'viewer'));const s=[...f.c.sessions.sessions.values()].find(x=>x.userId==='viewer');const a=action=>i(`schedule:${s.id}:${s.turn}:${action}`,'viewer');const jump=a('month-jump');await f.c.handle(jump);assert.ok(jump.modal);const submit=Object.assign(form(jump,{value:'2027/02'}),{user:{id:'viewer'}});await f.c.handle(submit);assert.equal(s.month,'2027-02');assert.equal(f.store.calendar(f.id).events.length,0);assert.ok(!JSON.stringify(submit.replies).includes('予定を追加'));await f.c.handle(a('display'));assert.equal(s.display,'list');const denied=a('new-event');await f.c.handle(denied);assert.equal(denied.modal,undefined);assert.equal(s.scope,'viewer');
});
test('invalid event input keeps the draft and useful buttons without leaking details after permission loss',async()=>{
  const f=await fixture(),x=click(f.s,'new-event');await f.c.handle(x);const bad=form(x,event({title:'入力した予定',date:'2026/02/30'}));await f.c.handle(bad);assert.equal(f.store.calendar(f.id).events.length,0);assert.ok(bad.replies.at(-1).components.length>0);const retry=click(f.s,'new-event');await f.c.handle(retry);assert.equal(retry.modal.toJSON().components[0].components[0].value,'入力した予定');assert.equal(retry.modal.toJSON().components[1].components[0].value,'2026/02/30');f.admin(false);const denied=form(retry,event());await f.c.handle(denied);assert.ok(denied.replies.at(-1).components.flatMap(r=>r.toJSON().components).every(b=>b.custom_id?.startsWith('admin:open-')||b.custom_id==='menu:open'));assert.ok(!JSON.stringify(denied.replies).includes('入力した予定'));
});
test('reopening admin schedules preserves month, day, display and invalid input, and invalidates old controls',async()=>{
  const f=await fixture(),expires=f.s.expires;f.s.month='2026-12';f.s.date='2026-12-25';f.s.display='list';
  const before=click(f.s,'month-next');const draft={title:'下書き',date:'2026/12/25',time:'',place:'',description:''};f.s.eventDraft=draft;f.s.draftCalendarId=f.id;f.s.draftEventId=null;
  const reopened=i();await f.c.openAdmin(reopened);assert.equal(f.c.sessions.sessions.get(f.s.id),f.s);assert.equal(f.s.month,'2026-12');assert.equal(f.s.date,'2026-12-25');assert.equal(f.s.display,'list');assert.equal(f.s.eventDraft,draft);assert.equal(f.s.expires,expires);
  await f.c.handle(before);assert.equal(f.s.month,'2026-12');const edit=click(f.s,'new-event');await f.c.handle(edit);assert.equal(edit.modal.toJSON().components[0].components[0].value,'下書き');assert.equal(f.sendCount(),0);
});
test('reopening schedules cancels pending confirmation and deleted selections fall back to a usable list',async()=>{
  const f=await fixture(),e=await add(f);await f.c.handle(click(f.s,'delete-event'));const old=click(f.s,'confirm-delete');await f.c.openAdmin(i());assert.equal(f.s.view,'event');assert.equal(f.s.deleteStage,undefined);
  await f.c.handle(old);assert.equal(f.store.calendar(f.id).events.length,1);
  const current=f.store.calendar(f.id).events[0];await f.store.removeEvent(f.id,e.id,current.revision);await f.c.openAdmin(i());assert.equal(f.s.view,'list');assert.equal(f.sendCount(),0);
  f.admin(false);const denied=i();await f.c.openAdmin(denied);assert.ok(!JSON.stringify(denied.replies).includes('卓サーバー'));
});

test('day navigation filters details, prefills new events and resets when changing months',async()=>{
  const f=await fixture();await add(f);await f.c.handle(click(f.s,'list'));await add(f,event({title:'別の日',date:'2026/10/18'}));await f.c.handle(click(f.s,'list'));
  const day=click(f.s,'day-jump');await f.c.handle(day);await f.c.handle(form(day,{value:'2026/10/17'}));
  assert.equal(f.s.date,'2026-10-17');assert.equal(f.s.month,'2026-10');
  const screen=scheduleScreen(f.s,f.store),menu=screen.components.flatMap(r=>r.toJSON().components).find(c=>c.type===3&&c.custom_id.endsWith(':event'));
  assert.equal(menu.options.length,1);assert.equal(menu.options[0].label,'セッション');
  const addHere=click(f.s,'new-event');await f.c.handle(addHere);assert.equal(addHere.modal.toJSON().components[1].components[0].value,'2026-10-17');
  await f.c.handle(click(f.s,'day-clear'));assert.equal(f.s.date,undefined);
  const empty=click(f.s,'day-jump');await f.c.handle(empty);await f.c.handle(form(empty,{value:'2026/10/19'}));
  assert.ok(JSON.stringify(scheduleScreen(f.s,f.store)).includes('この日の予定はまだありません'));
  await f.c.handle(click(f.s,'month-next'));assert.equal(f.s.month,'2026-11');assert.equal(f.s.date,undefined);
});

test('viewers may select empty days without writes; invalid or stale forms preserve the current view',async()=>{
  const f=await fixture();await add(f);await publish(f);const publication=f.store.calendar(f.id).publications[0];
  await f.c.handle(i(`schedule:panel:${publication.id}`,'viewer'));
  const s=[...f.c.sessions.sessions.values()].find(s=>s.userId==='viewer'),a=action=>i(`schedule:${s.id}:${s.turn}:${action}`,'viewer');
  const jump=a('day-jump');await f.c.handle(jump);const submit=value=>Object.assign(form(jump,{value}),{user:{id:'viewer'}});
  await f.c.handle(submit('2026/02/30'));assert.equal(s.date,undefined);assert.equal(s.month,'2026-10');
  const bad=submit('2026/10/17');bad.customId=bad.customId.replace(s.form.token,'wrong');await f.c.handle(bad);assert.equal(s.date,undefined);
  await f.c.handle(submit('2026/10/19'));assert.equal(s.date,'2026-10-19');assert.equal(f.store.calendar(f.id).events.length,1);
  assert.ok(!JSON.stringify(scheduleScreen(s,f.store)).includes('この日に予定を追加'));
  const denied=a('new-event');await f.c.handle(denied);assert.equal(denied.modal,undefined);
  const next=a('month-jump');await f.c.handle(next);await f.c.handle(Object.assign(form(next,{value:'2027/01'}),{user:{id:'viewer'}}));assert.equal(s.date,undefined);
});

test('filtered dense month screens stay within five action rows and returning from details keeps the page',async()=>{
  const f=await fixture();for(let n=0;n<18;n++){await f.c.handle(click(f.s,'list'));await add(f,event({title:`予定${String(n).padStart(2,'0')}`}));}
  await f.c.handle(click(f.s,'list'));const jump=click(f.s,'day-jump');await f.c.handle(jump);await f.c.handle(form(jump,{value:'2026/10/17'}));
  await f.c.handle(click(f.s,'next'));assert.equal(f.s.page,1);
  const screen=scheduleScreen(f.s,f.store);assert.equal(screen.components.length,5);
  const menu=screen.components.flatMap(r=>r.toJSON().components).find(c=>c.type===3&&c.custom_id.endsWith(':event'));
  await f.c.handle(Object.assign(click(f.s,'event'),{values:[menu.options[0].value]}));
  await f.c.handle(click(f.s,'list'));assert.equal(f.s.page,1);assert.equal(f.s.date,'2026-10-17');
  for(const row of scheduleScreen(f.s,f.store).components)assert.ok(row.toJSON().components.length<=5);
});

test('today shortcut works from another month for both admin and read-only viewer without changing events',async()=>{
  const f=await fixture();await add(f);await f.c.handle(click(f.s,'list'));await f.c.handle(click(f.s,'month-next'));await f.c.handle(click(f.s,'day-today'));assert.equal(f.s.date,'2026-10-14');assert.equal(f.s.month,'2026-10');assert.equal(f.store.calendar(f.id).events.length,1);
  await publish(f);const p=f.store.calendar(f.id).publications[0];await f.c.handle(i(`schedule:panel:${p.id}`,'viewer'));const s=[...f.c.sessions.sessions.values()].find(s=>s.userId==='viewer');await f.c.handle(i(`schedule:${s.id}:${s.turn}:day-today`,'viewer'));assert.equal(s.date,'2026-10-14');const controls=scheduleScreen(s,f.store).components.flatMap(r=>r.toJSON().components);assert.ok(!controls.some(b=>b.custom_id==='admin:open'));assert.ok(!controls.some(b=>b.custom_id.endsWith(':new-event')));
});

test('search spans months, preserves its page through detail and resume, and clears back to the previous date',async()=>{
  const f=await fixture();
  for(let n=0;n<10;n++)await f.store.putEvent(f.id,null,event({title:`星の卓${n}`,date:n<5?'2026/10/17':'2027/01/04',place:'VC3'}));
  f.s.date='2026-10-17';await f.c.handle(click(f.s,'tools'));
  const search=click(f.s,'search');await f.c.handle(search);await f.c.handle(form(search,{value:'星 ＶＣ３'}));
  assert.equal(f.s.query,'星 vc3');assert.equal(f.s.month,'2026-10');assert.equal(f.s.date,'2026-10-17');
  let screen=scheduleScreen(f.s,f.store);assert.ok(!screen.files);assert.ok(JSON.stringify(screen).includes('全期間'));
  assert.equal(screen.components.flatMap(r=>r.toJSON().components).find(c=>c.type===3&&c.custom_id.endsWith(':event')).options.length,8);
  await f.c.handle(click(f.s,'next'));screen=scheduleScreen(f.s,f.store);
  const menu=screen.components.flatMap(r=>r.toJSON().components).find(c=>c.type===3&&c.custom_id.endsWith(':event'));
  await f.c.handle(Object.assign(click(f.s,'event'),{values:[menu.options[0].value]}));await f.c.handle(click(f.s,'list'));
  assert.equal(f.s.page,1);await f.c.openAdmin(i());assert.equal(f.s.query,'星 vc3');assert.equal(f.s.page,1);
  const invalid=click(f.s,'day-jump');await f.c.handle(invalid);await f.c.handle(form(invalid,{value:'2026/02/30'}));assert.equal(f.s.query,'星 vc3');
  await f.c.handle(click(f.s,'search-clear'));assert.equal(f.s.query,undefined);assert.equal(f.s.date,'2026-10-17');assert.equal(f.s.page,0);
  assert.equal(f.sendCount(),0);
});

test('copy is a prefilled unsaved draft, preserves overnight time and source, and saves only once',async()=>{
  const f=await fixture(),source=await add(f,event({time:'23:00-01:00'}));
  const copy=click(f.s,'copy-event');await f.c.handle(copy);assert.ok(copy.modal);assert.equal(f.store.calendar(f.id).events.length,1);
  assert.equal(copy.modal.toJSON().title,'複製して予定を追加');assert.equal(copy.modal.toJSON().components[2].components[0].value,'23:00-01:00');
  const submit=form(copy,event({title:'翌週の卓',date:'2026/10/24',time:'23:00-01:00'}));await f.c.handle(submit);await f.c.handle(submit);
  const events=f.store.calendar(f.id).events;assert.equal(events.length,2);assert.deepEqual(events[0],source);
  assert.notEqual(events[1].id,source.id);assert.equal(events[1].end,1500);assert.equal(events[1].date,'2026-10-24');
});

test('copy retries retain invalid input, reject changed sources and recheck permission after queued writes',async()=>{
  const f=await fixture(),source=await add(f);
  const copy=click(f.s,'copy-event');await f.c.handle(copy);await f.c.handle(form(copy,event({title:'下書き',date:'2026/02/30'})));
  const retry=click(f.s,'copy-event');await f.c.handle(retry);assert.equal(retry.modal.toJSON().components[0].components[0].value,'下書き');
  await f.store.putEvent(f.id,source.id,event({title:'元が変更'}),source.revision);
  await f.c.handle(form(retry,event()));assert.equal(f.store.calendar(f.id).events.length,1);
  const fresh=click(f.s,'copy-event');await f.c.handle(fresh);assert.equal(fresh.modal.toJSON().components[0].components[0].value,'元が変更');
  let release;f.store.tail=new Promise(r=>release=r);const save=f.c.handle(form(fresh,event()));await new Promise(r=>setImmediate(r));f.admin(false);release();await save;
  assert.equal(f.store.calendar(f.id).events.length,1);assert.equal(f.sendCount(),0);
});

test('viewers may search and export only the clicked calendar, with fresh access and session validation',async()=>{
  const f=await fixture();await add(f);const other=await f.store.create('秘密の予定表');await f.store.putEvent(other,null,event({title:'秘密の予定'}));await publish(f);
  const publication=f.store.calendar(f.id).publications[0];await f.c.handle(i(`schedule:panel:${publication.id}`,'viewer'));
  const s=[...f.c.sessions.sessions.values()].find(s=>s.userId==='viewer'),a=action=>i(`schedule:${s.id}:${s.turn}:${action}`,'viewer');
  await f.c.handle(a('tools'));const search=a('search');await f.c.handle(search);await f.c.handle(Object.assign(form(search,{value:'セッション'}),{user:{id:'viewer'}}));
  await f.c.handle(a('tools'));const download=a('export');await f.c.handle(download);
  const result=download.replies.at(-1);assert.equal(result.files[0].name,'astral-calendar.ics');assert.ok(result.files[0].attachment.toString().includes('セッション'));assert.ok(!result.files[0].attachment.toString().includes('秘密'));
  assert.deepEqual(result.attachments,[]);assert.ok(!JSON.stringify(result).includes('予定を編集'));
  const denied=a('copy-event');await f.c.handle(denied);assert.ok(!denied.modal);assert.equal(f.store.calendar(f.id).events.length,1);
  for(const change of ['owner','channel','generation','permission','expiry']){
    const x=a('export');if(change==='owner')x.user.id='intruder';if(change==='channel')x.channelId='567890123456789012';if(change==='generation')x.customId=x.customId.replace(`:${s.turn}:`,':-1:');if(change==='permission')f.visible(false);if(change==='expiry')s.expires=0;
    await f.c.handle(x);assert.ok(!x.replies.some(r=>r.files?.some(file=>file.name==='astral-calendar.ics')));f.visible(true);
  }
});

test('export covers all filtered pages, clears old files on navigation and requires a new explicit action after resume',async()=>{
  const f=await fixture();for(let n=0;n<12;n++)await f.store.putEvent(f.id,null,event({title:`予定${n}`}));
  await f.c.handle(click(f.s,'next'));assert.equal(f.s.page,1);await f.c.handle(click(f.s,'tools'));
  const download=click(f.s,'export');await f.c.handle(download);assert.equal(download.replies.at(-1).files[0].attachment.toString().split('BEGIN:VEVENT').length-1,12);
  const back=click(f.s,'list');await f.c.handle(back);assert.deepEqual(back.replies.at(-1).attachments,[]);assert.ok(back.replies.at(-1).files.every(file=>file.name!=='astral-calendar.ics'));assert.equal(f.s.page,1);
  await f.c.handle(click(f.s,'tools'));await f.c.handle(click(f.s,'export'));const resume=i();await f.c.openAdmin(resume);assert.equal(f.s.view,'tools');assert.equal(resume.replies.at(-1).files,undefined);
  await f.c.handle(click(f.s,'list'));await f.c.handle(click(f.s,'month-next'));await f.c.handle(click(f.s,'tools'));
  const empty=click(f.s,'export');await f.c.handle(empty);assert.ok(!empty.replies.some(r=>r.files));assert.equal(f.s.view,'tools');assert.equal(f.sendCount(),0);
});

test('maximum search screens and tools respect Discord component and text limits for both scopes',async()=>{
  const f=await fixture();for(let n=0;n<200;n++)await f.store.putEvent(f.id,null,event({title:'*'.repeat(80),date:`2026/10/${String(n%28+1).padStart(2,'0')}`}));
  f.s.query='*'.repeat(80);f.s.date='2026-10-17';
  for(const scope of ['admin','viewer'])for(const view of ['list','tools']){
    const s={...f.s,scope,view,exportedAt:0},m=scheduleScreen(s,f.store);
    assert.ok(m.components.length<=5);for(const row of m.components){assert.ok(row.toJSON().components.length<=5);row.toJSON();}
    for(const embed of m.embeds)assert.ok(embed.toJSON().description.length<=4096);
    assert.deepEqual(m.allowedMentions.parse,[]);
  }
});

test('unpublish is revision checked and durable, preserves all events and other publications, and rejects pending records',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'schedule-unpublish-'));
  try{
    const path=join(dir,'schedules.json'),store=await new ScheduleStore(path).load(),id=await store.create('予定表');
    await store.putEvent(id,null,event());const first=await store.reserve(id,CHANNEL,'2026-10'),other=await store.reserve(id,CHANNEL,'2026-11');await store.complete(first,POST);
    const stage=store.publication(first),before=store.calendar(id).events;
    await assert.rejects(store.unpublish(other,JSON.stringify(store.publication(other))));
    await assert.rejects(store.unpublish(first,JSON.stringify({...stage,month:'2026-12'})));
    await store.unpublish(first,JSON.stringify(stage));assert.deepEqual(store.calendar(id).events,before);assert.equal(store.publication(other).status,'pending');
    const loaded=await new ScheduleStore(path).load();assert.throws(()=>loaded.publication(first));assert.deepEqual(loaded.calendar(id).events,before);assert.equal(loaded.publication(other).status,'pending');
    await assert.rejects(store.unpublish(first,JSON.stringify(stage)));
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('confirmed unpublish revokes access before deleting only the matching bot post and cannot run twice',async()=>{
  const f=await fixture();await add(f);await publish(f);const publication=f.store.calendar(f.id).publications[0];let deleted=0;
  f.posted().delete=async()=>{assert.throws(()=>f.store.publication(publication.id));deleted++;};
  await f.c.handle(click(f.s,'unpublish'));assert.equal(f.s.view,'unpublish-confirm');assert.equal(deleted,0);assert.equal(f.store.publication(publication.id).status,'ready');
  const confirm=click(f.s,'confirm-unpublish');await f.c.handle(confirm);await f.c.handle(confirm);
  assert.equal(deleted,1);assert.equal(f.store.calendar(f.id).events.length,1);assert.equal(f.store.calendar(f.id).publications.length,0);assert.equal(f.s.view,'publications');assert.equal(f.sendCount(),1);
});
test('unpublish cancellation and reopening preserve sharing and invalidate the old confirmation',async()=>{
  const f=await fixture();await publish(f);const id=f.s.publicationId;let deleted=0;f.posted().delete=async()=>deleted++;
  await f.c.handle(click(f.s,'unpublish'));await f.c.handle(click(f.s,'publication-back'));assert.equal(f.s.unpublishStage,undefined);assert.equal(f.store.publication(id).status,'ready');
  await f.c.handle(click(f.s,'unpublish'));const old=click(f.s,'confirm-unpublish');await f.c.openAdmin(i());assert.equal(f.s.view,'publication');assert.equal(f.s.unpublishStage,undefined);await f.c.handle(old);
  assert.equal(f.store.publication(id).status,'ready');assert.equal(deleted,0);
});
test('unpublish refuses foreign ownership, wrong channel, stale confirmation and queued permission loss',async()=>{
  const f=await fixture();await publish(f);const id=f.s.publicationId;let deleted=0;f.posted().delete=async()=>deleted++;
  await f.c.handle(click(f.s,'unpublish'));
  for(const extra of [{user:{id:'other'}},{channelId:'567890123456789012'}])await f.c.handle(Object.assign(click(f.s,'confirm-unpublish'),extra));
  assert.equal(f.store.publication(id).status,'ready');
  let release;f.store.tail=new Promise(r=>release=r);const job=f.c.handle(click(f.s,'confirm-unpublish'));await new Promise(r=>setImmediate(r));f.admin(false);release();await job;f.admin(true);
  assert.equal(f.store.publication(id).status,'ready');assert.equal(deleted,0);
  await f.store.changeMonth(id,'2026-11',JSON.stringify(f.store.publication(id)));await f.c.handle(click(f.s,'confirm-unpublish'));assert.equal(f.store.publication(id).month,'2026-11');assert.equal(deleted,0);
});
test('public-message deletion failures leave sharing revoked, do not resend, and explain manual cleanup without raw errors',async()=>{
  for(const kind of ['permission','author','buttons','missing']){
    const f=await fixture();await add(f);await publish(f);let deleted=0;
    f.posted().delete=async()=>{deleted++;throw new Error('PRIVATE_NATIVE_ERROR');};
    if(kind==='author')f.posted().author.id='567890123456789012';if(kind==='buttons')f.posted().components=[];
    if(kind==='missing')f.channel.messages.fetch=async()=>{throw Object.assign(new Error('PRIVATE_NATIVE_ERROR'),{code:10008});};
    await f.c.handle(click(f.s,'unpublish'));const confirm=click(f.s,'confirm-unpublish');await f.c.handle(confirm);
    assert.equal(f.store.calendar(f.id).publications.length,0);assert.equal(f.store.calendar(f.id).events.length,1);assert.equal(f.sendCount(),1);assert.ok(!JSON.stringify(confirm.replies).includes('PRIVATE_NATIVE_ERROR'));
    assert.ok(JSON.stringify(confirm.replies).includes(kind==='missing'?'見つかりませんでした':'削除は確認できません'));assert.equal(deleted,kind==='permission'?1:0);
  }
});
test('unpublish immediately invalidates old public sessions and exports but retains another explicitly shared publication',async()=>{
  const f=await fixture(),e=await add(f);await publish(f);const publication=f.store.calendar(f.id).publications[0];
  await f.c.handle(i(`schedule:panel:${publication.id}`,'viewer'));const viewer=[...f.c.sessions.sessions.values()].find(s=>s.userId==='viewer');
  await f.c.handle(i(`schedule:${viewer.id}:${viewer.turn}:tools`,'viewer'));
  f.posted().delete=async()=>{};await f.c.handle(click(f.s,'unpublish'));await f.c.handle(click(f.s,'confirm-unpublish'));
  for(const action of ['export','event','search','list']){const x=i(`schedule:${viewer.id}:${viewer.turn}:${action}`,'viewer');x.values=[e.id];await f.c.handle(x);assert.ok(!x.replies.some(r=>r.files));assert.ok(!JSON.stringify(x.replies).includes('みんなで遊ぶ'));}
  const old=i(`schedule:panel:${publication.id}`,'another');await f.c.handle(old);assert.ok(!JSON.stringify(old.replies).includes('みんなで遊ぶ'));
  const next=await f.store.reserve(f.id,CHANNEL,'2026-11');await f.store.complete(next,POST);const opened=i(`schedule:panel:${next}`,'fresh');await f.c.handle(opened);assert.ok(JSON.stringify(opened.replies).includes('卓サーバー'));
});
test('failed unpublish persistence never deletes the post and read-only viewers cannot invoke unpublish',async()=>{
  const f=await fixture();await publish(f);const publication=f.store.calendar(f.id).publications[0];let deleted=0;f.posted().delete=async()=>deleted++;
  await f.c.handle(i(`schedule:panel:${publication.id}`,'viewer'));const viewer=[...f.c.sessions.sessions.values()].find(s=>s.userId==='viewer');
  for(const action of ['unpublish','confirm-unpublish'])await f.c.handle(i(`schedule:${viewer.id}:${viewer.turn}:${action}`,'viewer'));
  await f.c.handle(click(f.s,'unpublish'));f.store.save=async()=>{throw new Error('disk');};await f.c.handle(click(f.s,'confirm-unpublish'));
  assert.equal(f.store.publication(publication.id).status,'ready');assert.equal(f.s.view,'unpublish-confirm');assert.equal(deleted,0);
});
