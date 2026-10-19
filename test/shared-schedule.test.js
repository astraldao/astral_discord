import test from 'node:test';
import assert from 'node:assert/strict';
import {ChannelType,PermissionFlagsBits as P} from 'discord.js';
import {ScheduleStore} from '../src/schedule-store.js';
import {createScheduleController} from '../src/schedule-ui.js';
import {createSharedScheduleController} from '../src/shared-schedule-ui.js';
const GUILD='123456789012345678',CHANNEL='234567890123456789',OTHER='234567890123456780',BOT='456789012345678901';
const now=()=>Date.parse('2026-10-14T12:00:00Z');
const item={title:'公開セッション',date:'2026/10/17',time:'20:00',place:'VC',description:'予定の詳細'};
function interaction(customId,user='owner',channelId=CHANNEL){return {customId,user:{id:user},channelId,message:{id:'private-menu',flags:{has:()=>true}},replies:[],async deferReply(p){this.deferred=true;this.flags=p.flags;},async deferUpdate(){this.deferred=true;},async reply(p){this.replied=true;this.replies.push(p);},async editReply(p){this.replies.push(p);},async showModal(m){this.modal=m;}};}
function last(i){return i.replies.at(-1);}
function controls(m){return m.components.flatMap(r=>r.toJSON().components);}
async function fixture(){
  const store=new ScheduleStore(),messages=new Map(),users=new Map();let history=true,view=true,botAllowed=true,fetchCount=0,serial=0,wait;
  const bot={id:BOT},channel={id:CHANNEL,guildId:GUILD,type:ChannelType.GuildText,permissionsFor:member=>({has:permissions=>(Array.isArray(permissions)?permissions:[permissions]).every(p=>member.id===BOT?botAllowed:p===P.ReadMessageHistory?history:view)}),messages:{fetch:async options=>{assert.equal(options.force,true);assert.equal(options.cache,false);fetchCount++;if(wait)await wait();const message=messages.get(options.message);if(!message)throw Object.assign(new Error('PRIVATE_NATIVE_ERROR'),{code:10008});return message;}}};
  const guild={id:GUILD,members:{me:bot,fetchMe:async options=>{assert.equal(options.force,true);return bot;},fetch:async options=>{assert.equal(options.force,true);if(!users.has(options.user))users.set(options.user,{id:options.user,permissions:{has:p=>p===P.Administrator}});return users.get(options.user);}},channels:{fetch:async(id,options)=>{assert.equal(options.force,true);assert.equal(id,CHANNEL);return channel;}}};
  const schedule=createScheduleController({guild,store,now}),opened=[],directory=createSharedScheduleController({guild,store,now,openCalendar:async(i,id)=>{opened.push(id);await schedule.openShared(i,id);}});
  async function calendar(title='共有予定表',source=CHANNEL,status='ready',calendarId){const id=calendarId??await store.create(title);if(!calendarId)await store.putEvent(id,null,item);const publicationId=await store.reserve(id,source,`2026-${String(1+serial%12).padStart(2,'0')}`),messageId=String(BigInt('345678901234567890')+BigInt(serial++));if(status==='ready')await store.complete(publicationId,messageId);messages.set(messageId,{id:messageId,author:{id:BOT},components:[{components:[{customId:`schedule:panel:${publicationId}`}]}]});return {id,publicationId,messageId};}
  async function open(user='owner'){const i=interaction(undefined,user);await directory.open(i);return {i,s:[...directory.sessions.sessions.values()].find(s=>s.userId===user)};}
  const click=(s,action,extra={})=>Object.assign(interaction(`calendars:${s.id}:${s.turn}:${action}`,s.userId),extra);
  return {store,messages,channel,guild,schedule,directory,opened,calendar,open,click,history:value=>history=value,view:value=>view=value,bot:value=>botAllowed=value,wait:fn=>wait=fn,fetchCount:()=>fetchCount};
}

test('directory exposes only verified ready publications in the current channel and deduplicates calendar posts',async()=>{
  const f=await fixture(),a=await f.calendar('表示する予定表');await f.calendar('ignored',CHANNEL,'ready',a.id);await f.calendar('他チャンネルの秘密',OTHER);await f.calendar('送信結果未確認',CHANNEL,'pending');
  const missing=await f.calendar('失われた投稿');f.messages.delete(missing.messageId);const foreign=await f.calendar('他Bot');f.messages.get(foreign.messageId).author.id='other';
  const bad=await f.calendar('違うパネル');f.messages.get(bad.messageId).components=[];
  const {i}=await f.open();const choices=controls(last(i)).find(c=>c.type===3).options;
  assert.equal(choices.length,1);assert.equal(choices[0].label,'表示する予定表');for(const secret of ['他チャンネルの秘密','送信結果未確認','失われた投稿','他Bot','違うパネル'])assert.ok(!JSON.stringify(i.replies).includes(secret));
  assert.equal(f.opened.length,0);assert.ok(!last(i).files);
});
test('menu selection opens a fresh verified read-only calendar even for an administrator',async()=>{
  const f=await fixture(),a=await f.calendar();const {s}=await f.open(),select=f.click(s,'select',{values:[a.publicationId]});await f.directory.handle(select);
  assert.deepEqual(f.opened,[a.publicationId]);const viewer=[...f.schedule.sessions.sessions.values()][0];assert.equal(viewer.scope,'viewer');assert.equal(viewer.viaMenu,true);assert.equal(viewer.calendarId,a.id);assert.ok(last(select).files);
  assert.ok(!JSON.stringify(last(select)).includes('予定を追加'));assert.ok(controls(last(select)).some(b=>b.custom_id==='menu:calendar'));
  await f.schedule.handle(interaction(`schedule:${viewer.id}:${viewer.turn}:day-today`));const day=interaction(`schedule:${viewer.id}:${viewer.turn}:list`);await f.schedule.handle(day);for(const row of last(day).components)assert.ok(row.toJSON().components.length<=5);
  const denied=interaction(`schedule:${viewer.id}:${viewer.turn}:unpublish`);await f.schedule.handle(denied);assert.equal(f.store.publication(a.publicationId).status,'ready');
});
test('history and visibility are freshly checked before metadata, and bot permissions are required',async()=>{
  for(const mode of ['history','view','bot']){
    const f=await fixture();await f.calendar('表示してはいけない予定表');f[mode](false);let metadata=0;const original=f.store.metadata.bind(f.store);f.store.metadata=()=>{metadata++;return original();};
    const {i}=await f.open();assert.equal(metadata,0);assert.equal(f.fetchCount(),0);assert.ok(!JSON.stringify(i.replies).includes('表示してはいけない予定表'));assert.equal(f.directory.sessions.sessions.size,0);
  }
});
test('permission loss during a scan suppresses labels and source revocation suppresses stale selection',async()=>{
  const f=await fixture(),a=await f.calendar('一時的に見える予定表');f.wait(async()=>{f.history(false);});const {i}=await f.open();assert.ok(!JSON.stringify(i.replies).includes('一時的に見える予定表'));
  f.history(true);f.wait(null);const {s}=await f.open();await f.store.unpublish(a.publicationId,JSON.stringify(f.store.publication(a.publicationId)));
  const select=f.click(s,'select',{values:[a.publicationId]});await f.directory.handle(select);assert.equal(f.opened.length,0);assert.ok(!JSON.stringify(select.replies).includes('一時的に見える予定表'));
});
test('foreign sessions, channels, expired controls and stale generations cannot delegate selection',async()=>{
  const f=await fixture(),a=await f.calendar();const {s}=await f.open();
  for(const extra of [{user:{id:'other'}},{channelId:OTHER},{customId:`calendars:${s.id}:-1:select`}])await f.directory.handle(f.click(s,'select',{values:[a.publicationId],...extra}));
  assert.equal(f.opened.length,0);s.expires=0;await f.directory.handle(f.click(s,'select',{values:[a.publicationId]}));assert.equal(f.opened.length,0);
});
test('source post disappearance after listing prevents opening and history loss prevents later exports',async()=>{
  const f=await fixture(),a=await f.calendar();const {s}=await f.open();f.messages.delete(a.messageId);
  const select=f.click(s,'select',{values:[a.publicationId]});await f.directory.handle(select);assert.ok(!last(select).files);assert.equal(f.schedule.sessions.sessions.size,0);assert.ok(!JSON.stringify(select.replies).includes('PRIVATE_NATIVE_ERROR'));
  f.messages.set(a.messageId,{author:{id:BOT},components:[{components:[{customId:`schedule:panel:${a.publicationId}`}]}]});
  const next=await f.open();await f.directory.handle(f.click(next.s,'select',{values:[a.publicationId]}));const viewer=[...f.schedule.sessions.sessions.values()][0];
  await f.schedule.handle(interaction(`schedule:${viewer.id}:${viewer.turn}:tools`));f.history(false);
  const download=interaction(`schedule:${viewer.id}:${viewer.turn}:export`);await f.schedule.handle(download);assert.ok(!download.replies.some(m=>m.files));assert.ok(!JSON.stringify(download.replies).includes('予定の詳細'));
});
test('opening a viewer directly validates channel, live post identity and current publication before creating a session',async()=>{
  const f=await fixture(),a=await f.calendar(),b=await f.calendar('他チャンネル',OTHER);
  for(const id of [b.publicationId,'unknown']){const i=interaction();await f.schedule.openShared(i,id);assert.equal(f.schedule.sessions.sessions.size,0);assert.ok(!last(i).files);}
  f.wait(async()=>{await f.store.unpublish(a.publicationId,JSON.stringify(f.store.publication(a.publicationId)));f.wait(null);});
  const i=interaction();await f.schedule.openShared(i,a.publicationId);assert.equal(f.schedule.sessions.sessions.size,0);assert.ok(!last(i).files);
});
test('concurrent users reuse one channel scan and sessions stay independent',async()=>{
  const f=await fixture();await f.calendar();let release,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);f.wait(async()=>{entered();await gate;});
  const first=f.open('first');await started;const second=f.open('second');await new Promise(r=>setImmediate(r));release();const [a,b]=await Promise.all([first,second]);
  assert.equal(f.fetchCount(),1);assert.notEqual(a.s.id,b.s.id);assert.ok(controls(last(a.i)).some(c=>c.type===3));assert.ok(controls(last(b.i)).some(c=>c.type===3));
});
test('twenty calendars paginate within Discord limits and refresh removes vanished posts',async()=>{
  const f=await fixture(),posts=[];for(let n=0;n<20;n++)posts.push(await f.calendar('共有予定表'+n));const {i,s}=await f.open();assert.equal(controls(last(i)).find(c=>c.type===3).options.length,10);
  const next=f.click(s,'next');await f.directory.handle(next);assert.equal(s.page,1);const m=last(next);assert.ok(m.components.length<=5);assert.deepEqual(m.allowedMentions.parse,[]);assert.ok(controls(m).find(c=>c.type===3).options.every(c=>c.label.startsWith('共有予定表')));
  for(const p of posts)f.messages.delete(p.messageId);const refresh=f.click(s,'refresh');await f.directory.handle(refresh);assert.equal(s.page,0);assert.ok(!controls(last(refresh)).some(c=>c.type===3));assert.equal(f.opened.length,0);
});

test('late refreshes cannot render expired sessions and raw permission lookup errors are never shown',async()=>{
  const f=await fixture();await f.calendar('期限後に隠す予定表');const {s}=await f.open();let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  f.wait(async()=>{entered();await gate;});const refresh=f.click(s,'refresh'),job=f.directory.handle(refresh);await started;s.expires=0;release();await job;
  assert.ok(!JSON.stringify(refresh.replies).includes('期限後に隠す予定表'));
  f.guild.members.fetch=async()=>{throw new Error('PRIVATE_PERMISSION_ERROR');};const {i}=await f.open();assert.ok(!JSON.stringify(i.replies).includes('PRIVATE_PERMISSION_ERROR'));
});

test('scans are capped across channels and release capacity when pending work completes',async()=>{
  const store=new ScheduleStore(),bot={id:BOT},channels=new Map(),pending=[];let requested=0;
  for(let n=0;n<5;n++){
    const channelId=String(BigInt(CHANNEL)+BigInt(n)),id=await store.create(`予定表${n}`),p=await store.reserve(id,channelId,'2026-10'),messageId=String(BigInt('345678901234567890')+BigInt(n));await store.complete(p,messageId);
    channels.set(channelId,{id:channelId,messages:{fetch:async()=>{requested++;await new Promise(r=>pending.push(r));return {author:{id:BOT},components:[{components:[{customId:`schedule:panel:${p}`}]}]};}}});
  }
  const controller=createSharedScheduleController({store,now,access:async i=>({channel:channels.get(i.channelId),bot}),openCalendar:()=>assert.fail()});
  const ids=[...channels.keys()],jobs=ids.slice(0,4).map((id,n)=>controller.open(interaction(undefined,`owner${n}`,id)));await new Promise(r=>setImmediate(r));
  const rejected=interaction(undefined,'owner4',ids[4]);await controller.open(rejected);assert.ok(JSON.stringify(rejected.replies).includes('確認中'));assert.equal(requested,4);
  pending.splice(0).forEach(r=>r());await Promise.all(jobs);
  const retry=controller.open(interaction(undefined,'owner4',ids[4]));await new Promise(r=>setImmediate(r));assert.equal(requested,5);pending.splice(0).forEach(r=>r());await retry;
});
