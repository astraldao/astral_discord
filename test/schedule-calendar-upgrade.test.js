import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inflateSync} from 'node:zlib';
import {ChannelType} from 'discord.js';
import {ScheduleStore,scheduleEvent,planScheduleImport} from '../src/schedule-store.js';
import {scheduleColors,scheduleColor} from '../src/schedule-colors.js';
import {scheduleDays} from '../src/schedule-days.js';
import {scheduleRecurrence} from '../src/schedule-recurrence.js';
import {createScheduleController,scheduleScreen} from '../src/schedule-ui.js';
import {calendarImage} from '../src/calendar-image.js';
const GUILD='123456789012345678',CHANNEL='234567890123456789',POST='345678901234567890',BOT='456789012345678901';
const input=(extra={})=>({title:'予定',date:'2026/10/14',time:'',place:'VC',description:'説明',...extra});
const controls=m=>m.components.flatMap(r=>r.toJSON().components),body=m=>m.embeds.map(e=>e.toJSON().description).join('\n');
function interaction(customId,user='owner',channelId=CHANNEL){return {customId,user:{id:user},channelId,message:{id:POST,flags:{has:()=>true}},replies:[],async deferUpdate(){this.deferred=true;},async deferReply(){this.deferred=true;},async reply(m){this.replied=true;this.replies.push(m);},async editReply(m){this.replies.push(m);},async showModal(m){this.modal=m;}};}
async function fixture({startTime='2026-10-14T12:00:00Z'}={}){
  let visible=true,admin=true,time=Date.parse(startTime);const store=new ScheduleStore(),id=await store.create('予定表'),other=await store.create('非共有の秘密'),edits=[];let publication;
  const post={author:{id:BOT},get components(){return [{components:[{customId:`schedule:panel:${publication}`}]}];},async edit(message){edits.push(message);}};
  const guild={id:GUILD,members:{me:{id:BOT},fetchMe:async()=>({id:BOT})},channels:{fetch:async()=>({type:ChannelType.GuildText,guildId:GUILD,permissionsFor:()=>({has:()=>true}),messages:{fetch:async()=>post},send:()=>assert.fail('unexpected public send')})}};
  const controller=createScheduleController({store,guild,now:()=>time,access:async(i,power)=>{if(!visible||power&&!admin)throw new Error('PRIVATE_PERMISSION');}});
  await controller.openAdmin(interaction());const s=[...controller.sessions.sessions.values()][0];
  const click=(action,values,session=s)=>Object.assign(interaction(`schedule:${session.id}:${session.turn}:${action}`,session.userId),values===undefined?{}:{values});
  const act=async(action,values,session=s)=>{const i=click(action,values,session);await controller.handle(i);return i;};await act('calendar',[id]);
  const submit=async(open,values)=>{const i=Object.assign(interaction(open.modal.toJSON().custom_id,open.user.id),{fields:{getTextInputValue:k=>values[k]??''}});await controller.handle(i);return i;};
  return {store,id,other,s,controller,edits,click,act,submit,screen:()=>scheduleScreen(s,store),add:value=>store.putEvent(id,null,input(value)),visible:value=>visible=value,admin:value=>admin=value,now:value=>time=Date.parse(value),async viewer(){publication=await store.reserve(id,CHANNEL,'2026-10');await store.complete(publication,POST);await controller.handle(interaction(`schedule:panel:${publication}`,'viewer'));return [...controller.sessions.sessions.values()].find(s=>s.userId==='viewer');},publication:()=>publication};
}
async function temporary(t){const dir=await mkdtemp(join(tmpdir(),'astral-calendar-colors-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'schedules.json'),store=new ScheduleStore(path),id=await store.create('予定表');return {dir,path,store,id};}

test('color choices are finite, automatic is absent in legacy inputs and invalid values are rejected',()=>{
  assert.equal(Object.keys(scheduleColors).length,6);assert.equal(scheduleColor('auto'),undefined);assert.equal(Object.hasOwn(scheduleEvent(input()),'color'),false);
  for(const color of Object.keys(scheduleColors))assert.equal(scheduleEvent(input({color})).color,color);
  for(const color of [null,0,{},'__proto__','BLUE','green '])assert.throws(()=>scheduleEvent(input({color})));
});
test('optional colors persist with old events, edits preserve them and automatic removes the override',async t=>{
  const f=await temporary(t),first=await f.store.putEvent(f.id,null,input()),second=await f.store.putEvent(f.id,null,input({title:'色付き',color:'green'}));
  await f.store.setEventColor(f.id,first,'red',0);await f.store.putEvent(f.id,first,input({title:'修正'}),1);let loaded=await new ScheduleStore(f.path).load();assert.equal(loaded.calendar(f.id).events[0].color,'red');assert.equal(loaded.calendar(f.id).events[1].color,'green');
  await f.store.setEventColor(f.id,first,'auto',2);assert.equal(Object.hasOwn(f.store.calendar(f.id).events[0],'color'),false);assert.equal(JSON.parse(await readFile(f.path)).version,1);assert.equal((await stat(f.path)).mode&0o777,0o600);assert.notEqual(first,second);
});
test('loading refuses unknown stored colors and stale color writes cannot override another edit',async t=>{
  const f=await temporary(t),event=await f.store.putEvent(f.id,null,input()),good=await readFile(f.path,'utf8');await f.store.setEventColor(f.id,event,'blue',0);await assert.rejects(f.store.setEventColor(f.id,event,'red',0));assert.equal(f.store.calendar(f.id).events[0].color,'blue');
  const invalid=JSON.parse(good);invalid.calendars[0].events[0].color='auto';await writeFile(f.path,JSON.stringify(invalid));await assert.rejects(new ScheduleStore(f.path).load());
});
test('color authorization is rechecked after file writing, preserving disk and memory on refusal',async t=>{
  const f=await temporary(t),event=await f.store.putEvent(f.id,null,input()),before=await readFile(f.path,'utf8'),memory=f.store.calendar(f.id);let checks=0;
  await assert.rejects(f.store.setEventColor(f.id,event,'red',0,()=>{if(++checks===2)throw new Error('denied');}));assert.equal(checks,2);assert.equal(await readFile(f.path,'utf8'),before);assert.deepEqual(f.store.calendar(f.id),memory);assert.deepEqual(await readdir(f.dir),['schedules.json']);await f.store.setEventColor(f.id,event,'green',0);assert.equal(f.store.calendar(f.id).events[0].color,'green');
});
test('recurrence inherits chosen colors while ICS import duplicate detection ignores presentation',async()=>{
  const store=new ScheduleStore(),id=await store.create('予定表'),event=await store.putEvent(id,null,input({color:'purple'})),source=store.calendar(id).events[0],plan=scheduleRecurrence(source,{frequency:'weekly',count:2});assert.ok(plan.inputs.every(v=>v.color==='purple'));
  await store.putEvents(id,plan.inputs,store.calendar(id).revision);assert.ok(store.calendar(id).events.every(v=>v.color==='purple'));assert.equal(planScheduleImport(store.calendar(id),[input()]).duplicates,1);assert.equal(store.calendar(id).events[0].id,event);
});
function pixel(png,x,y){let offset=8,palette,parts=[],width;while(offset<png.length){const length=png.readUInt32BE(offset),kind=png.toString('ascii',offset+4,offset+8),chunk=png.subarray(offset+8,offset+8+length);if(kind==='IHDR')width=chunk.readUInt32BE(0);if(kind==='PLTE')palette=chunk;if(kind==='IDAT')parts.push(chunk);offset+=length+12;}const raw=inflateSync(Buffer.concat(parts)),row=raw.subarray(y*(width+1),(y+1)*(width+1));assert.equal(row[0],1);let index=0;for(let n=0;n<=x;n++)index=(index+row[n+1])&255;return [...palette.subarray(index*3,index*3+3)];}
test('explicit colors reach real PNG pixels and unchanged automatic colors remain deterministic',()=>{
  const e={id:'e',...scheduleEvent(input({date:'2026/10/01'}))},expected=[[208,239,252],[210,244,229],[255,223,222],[233,223,251],[255,239,202],[223,233,244]];
  Object.keys(scheduleColors).forEach((color,n)=>{const image=calendarImage('2026-10',[{...e,color}]);assert.deepEqual(pixel(image.buffer,580,image.geometry.top+image.geometry.bandTop+image.geometry.bandHeight-3),expected[n]);});assert.deepEqual(calendarImage('2026-10',[e]).buffer,calendarImage('2026-10',[{...e}]).buffer);
});
test('sparse months shrink unused vertical space without merging separate same-name events',()=>{
  const events=Array.from({length:4},(_,n)=>({id:`day-${n}`,...scheduleEvent(input({title:'定例の卓',date:`2026/11/0${n+4}`}))}));
  const result=calendarImage('2026-11',events);assert.equal(result.height,556);assert.equal(result.layout.count,4);assert.equal(result.layout.spans.length,4);assert.equal(result.geometry.rich,true);assert.equal(result.geometry.wrapped,false);assert.deepEqual(result.layout.spans.map(s=>s.event.id),events.map(e=>e.id));assert.ok(result.buffer.length<150000);
});
test('a sparse month reserves two title lines and a start-time line when needed, without changing stored times',()=>{
  const events=[{id:'long',...scheduleEvent(input({title:'オンライン交流セッション',date:'2026/10/21',time:'20:30-23:00'}))},{id:'short',...scheduleEvent(input({title:'定例会',date:'2026/10/16',time:'21:00'}))}];
  const before=structuredClone(events),result=calendarImage('2026-10',events);assert.equal(result.geometry.wrapped,true);assert.equal(result.geometry.timed,true);assert.ok(result.geometry.bandHeight>=60);assert.ok(result.height<866);assert.deepEqual(events,before);assert.equal(result.width,840);assert.equal(result.buffer.readUInt32BE(20),result.height);
});
test('dense months keep their three lanes, stable dimensions and honest overflow instead of wrapping into other rows',()=>{
  const events=Array.from({length:200},(_,n)=>({id:`dense-${n}`,...scheduleEvent(input({date:'2026/08/01',title:'長い予定名'.repeat(10),time:'20:00',color:'red'}))}));
  const result=calendarImage('2026-08',events);assert.equal(result.geometry.rich,false);assert.equal(result.geometry.timed,false);assert.equal(result.height,1008+result.geometry.keyHeight);assert.equal(result.layout.cells.find(c=>c.date==='2026-08-01').hidden,197);assert.ok(result.buffer.length<150000);
});
test('day choices use exact month dates, leap days and interval counts without other calendars',async()=>{
  const f=await fixture();await f.add({date:'2026/09/30〜2026/10/02'});await f.add({title:'深夜',date:'2026/10/02',time:'23:00-01:00'});await f.store.putEvent(f.other,null,input({title:'秘密'}));
  const all=scheduleDays(f.store.calendar(f.id),'2026-10','2026-10-14');assert.equal(all.length,31);assert.equal(all[1].count,2);assert.equal(all[2].count,0);assert.ok(all[13].label.includes('今日'));assert.equal(scheduleDays(f.store.calendar(f.id),'2028-02').length,29);assert.equal(scheduleDays(f.store.calendar(f.id),'2026-02').length,28);assert.equal(scheduleDays(f.store.calendar(f.id),'2026-10','',{onlyEvents:true}).length,2);assert.ok(!JSON.stringify(all).includes('秘密'));
});
test('long emoji titles keep valid bounded Unicode in date select descriptions',async()=>{
  const f=await fixture();await f.add({title:'😀'.repeat(40)});await f.add({title:'😃'.repeat(40)});const day=scheduleDays(f.store.calendar(f.id),'2026-10','',{onlyEvents:true})[0];assert.ok(day.description.length<=100);assert.equal(day.description.isWellFormed(),true);assert.ok(day.description.endsWith('…'));
});
test('day picker opens without a modal, can show empty days and selects one without saving',async()=>{
  const f=await fixture();await f.add({date:'2026/10/17'});const before=f.store.calendar(f.id),open=await f.act('days');assert.equal(open.modal,undefined);assert.equal(f.s.view,'days');assert.equal(controls(f.screen()).find(c=>c.custom_id?.endsWith(':days-date')).options.length,1);
  await f.act('days-toggle');const options=controls(f.screen()).find(c=>c.custom_id?.endsWith(':days-date')).options;assert.equal(options.length,25);await f.act('days-date',['2026-10-18']);assert.equal(f.s.date,'2026-10-18');assert.equal(f.s.view,'list');assert.ok(body(f.screen()).includes('この日の予定はまだありません'));assert.deepEqual(f.store.calendar(f.id),before);
});
test('dense date picker paginates at twenty-five choices and rejects off-page date values',async()=>{
  const f=await fixture();for(let n=1;n<=31;n++)await f.add({date:`2026/10/${String(n).padStart(2,'0')}`});await f.act('days');await f.act('days-next');assert.equal(f.s.dayPicker.page,1);assert.equal(controls(f.screen()).find(c=>c.custom_id?.endsWith(':days-date')).options.length,6);
  await f.act('days-date',['2026-10-01']);assert.equal(f.s.view,'days');await f.act('days-date',['2026-10-31']);assert.equal(f.s.date,'2026-10-31');
});
test('cancelling date browsing preserves the prior query, range and page even after browsing another month',async()=>{
  const f=await fixture();for(let n=0;n<10;n++)await f.add({title:`星${n}`});await f.act('period',['week']);const search=await f.act('search');await f.submit(search,{value:'星'});await f.act('next');const before={month:f.s.month,query:f.s.query,rangeStart:f.s.rangeStart,page:f.s.page};
  await f.act('days');await f.act('days-month-next');assert.equal(f.s.month,before.month);await f.act('list');for(const [key,value] of Object.entries(before))assert.equal(f.s[key],value);assert.equal(f.s.dayPicker,undefined);
});
test('date typing and today remain available in the picker and use its displayed month and current JST date',async()=>{
  const f=await fixture({startTime:'2026-10-14T14:59:59Z'});await f.act('days');await f.act('days-month-next');const open=await f.act('day-jump');assert.equal(open.modal.toJSON().components[0].components[0].value,'2026-11-01');await f.submit(open,{value:'2028/02/29'});assert.equal(f.s.date,'2028-02-29');
  f.now('2026-10-14T14:59:59Z');await f.act('days');f.now('2026-10-14T15:00:00Z');await f.act('day-today');assert.equal(f.s.date,'2026-10-15');assert.equal(f.s.dayPicker,undefined);
});
test('month boundaries disable unavailable date navigation and invalid days cannot broaden selection',async()=>{
  const f=await fixture();await f.act('days');f.s.dayPicker.month='2000-01';assert.equal(controls(f.screen()).find(c=>c.custom_id?.endsWith(':days-month-prev')).disabled,true);await f.act('days-month-prev');assert.equal(f.s.dayPicker.month,'2000-01');
  f.s.dayPicker.month='2099-12';assert.equal(controls(f.screen()).find(c=>c.custom_id?.endsWith(':days-month-next')).disabled,true);for(const values of [[],['2026-10-14','2026-10-15'],['2026-02-30'],['2000-01-01']]){await f.act('days-date',values);assert.equal(f.s.view,'days');}
});
test('event details navigate across list pages in the same filter and back opens the current event page',async()=>{
  const f=await fixture(),ids=[];for(let n=0;n<10;n++)ids.push(await f.add({title:`予定${String(n).padStart(2,'0')}`}));await f.act('event',[ids[7]]);await f.act('event-next');assert.equal(f.s.eventId,ids[8]);assert.equal(f.s.page,1);await f.act('list');assert.equal(f.s.page,1);
  await f.act('event',[ids[0]]);assert.equal(controls(f.screen()).find(c=>c.custom_id?.endsWith(':event-prev')).disabled,true);await f.act('event-prev');assert.equal(f.s.eventId,ids[0]);
});
test('event navigation cannot leave a search or week while an edited-out event remains individually viewable',async()=>{
  const f=await fixture(),inside=await f.add({title:'星'}),outside=await f.add({title:'外',date:'2027/01/04'});await f.act('period',['week']);await f.act('event',[inside]);await f.act('event-next');assert.equal(f.s.eventId,inside);
  await f.act('list');const search=await f.act('search');await f.submit(search,{value:'星'});await f.act('event',[outside]);assert.ok(body(f.screen()).includes('表示条件外'));assert.equal(controls(f.screen()).find(c=>c.custom_id?.endsWith(':event-next')).disabled,true);await f.act('event-next');assert.equal(f.s.eventId,outside);
});
test('a single-event ICS export preserves its full period and identity, and navigation clears the attachment',async()=>{
  const f=await fixture(),event=await f.add({title:'選んだ予定',date:'2026/10/30〜2026/11/02',color:'red'});await f.add({title:'含めない'});await f.store.putEvent(f.other,null,input({title:'秘密'}));await f.act('event',[event]);const exported=await f.act('export-event'),file=exported.replies.at(-1).files[0];assert.equal(file.name,'astral-event.ics');const raw=file.attachment.toString().replace(/\r\n /g,'');assert.equal((raw.match(/BEGIN:VEVENT/g)??[]).length,1);assert.ok(raw.includes(event));assert.ok(raw.includes('DTEND;VALUE=DATE:20261103'));assert.ok(!raw.includes('含めない'));assert.ok(!raw.includes('秘密'));assert.ok(!raw.includes('COLOR:'));await f.act('list');assert.equal(f.screen().files.length,1);assert.equal(f.screen().files[0].name,'calendar.png');
});
test('administrator color selection saves once, updates the existing publication and retains dates',async()=>{
  const f=await fixture(),event=await f.add({date:'2026/10/30〜2026/11/02'});await f.viewer();await f.act('event',[event]);const old=f.click('event-color',['green']);await f.controller.handle(old);assert.equal(f.store.calendar(f.id).events[0].color,'green');assert.equal(f.store.calendar(f.id).events[0].revision,1);assert.equal(f.edits.length,1);assert.ok(f.edits[0].files[0].attachment.length>0);
  await f.controller.handle(old);assert.equal(f.store.calendar(f.id).events[0].revision,1);await f.act('event-color',['auto']);assert.equal(Object.hasOwn(f.store.calendar(f.id).events[0],'color'),false);
});
test('stale color revisions and invalid choices never override changed event data',async()=>{
  const f=await fixture(),event=await f.add();await f.act('event',[event]);await f.store.putEvent(f.id,event,input({title:'別管理者の修正'}),0);await f.act('event-color',['red']);assert.equal(f.store.calendar(f.id).events[0].color,undefined);assert.equal(f.store.calendar(f.id).events[0].title,'別管理者の修正');
  for(const values of [[],[undefined],['green','red'],['__proto__'],['unknown']])await f.act('event-color',values);assert.equal(f.store.calendar(f.id).events[0].color,undefined);await f.act('event-color',['blue']);assert.equal(f.store.calendar(f.id).events[0].color,'blue');
});
test('color changes recheck queued permissions and a changed confirmation context',async()=>{
  for(const mode of ['permission','context']){
    const f=await fixture(),event=await f.add();await f.act('event',[event]);let release,entered;f.store.tail=new Promise(r=>release=r);const called=new Promise(r=>entered=r),original=f.store.setEventColor.bind(f.store);f.store.setEventColor=(...args)=>{entered();return original(...args);};const job=f.act('event-color',['red']);await called;if(mode==='permission')f.visible(false);else f.s.colorStage={...f.s.colorStage};release();await job;assert.equal(f.store.calendar(f.id).events[0].color,undefined);
  }
});
test('a second click while a color save is queued does not invalidate the first authorized save',async()=>{
  const f=await fixture(),event=await f.add();await f.act('event',[event]);let release,entered;f.store.tail=new Promise(r=>release=r);const called=new Promise(r=>entered=r),original=f.store.setEventColor.bind(f.store);f.store.setEventColor=(...args)=>{entered();return original(...args);};
  const first=f.click('event-color',['green']),second=f.click('event-color',['red']),job=f.controller.handle(first);await called;await f.controller.handle(second);release();await job;assert.equal(f.store.calendar(f.id).events[0].color,'green');assert.equal(f.store.calendar(f.id).events[0].revision,1);
});
test('copy and recurrence confirmation preserve the source color but stale source edits cannot create a copy',async()=>{
  const f=await fixture(),event=await f.add({color:'yellow'});await f.act('event',[event]);const copy=await f.act('copy-event');await f.submit(copy,input({title:'複製',date:'2026/10/21'}));assert.equal(f.store.calendar(f.id).events[1].color,'yellow');
  await f.act('repeat');await f.act('repeat-preview');await f.act('repeat-save');assert.ok(f.store.calendar(f.id).events.every(e=>e.color==='yellow'));
  await f.act('event',[event]);const stale=await f.act('copy-event');await f.store.setEventColor(f.id,event,'red',0);const count=f.store.calendar(f.id).events.length;await f.submit(stale,input());assert.equal(f.store.calendar(f.id).events.length,count);
});
test('viewers may browse dates and export one event but cannot recolor; revoked sharing blocks all new actions',async()=>{
  const f=await fixture(),event=await f.add(),viewer=await f.viewer();f.admin(false);await f.act('days',undefined,viewer);await f.act('days-date',['2026-10-14'],viewer);await f.act('event',[event],viewer);const screen=scheduleScreen(viewer,f.store);assert.ok(!controls(screen).some(c=>c.custom_id?.endsWith(':event-color')));await f.act('event-color',['red'],viewer);assert.equal(f.store.calendar(f.id).events[0].color,undefined);
  const download=await f.act('export-event',undefined,viewer);assert.ok(download.replies.at(-1).files);await f.store.unpublish(f.publication(),JSON.stringify(f.store.publication(f.publication())));const denied=await f.act('export-event',undefined,viewer);assert.ok(!denied.replies.some(m=>m.files));assert.ok(!JSON.stringify(denied.replies).includes('説明'));
});
test('foreign owners, channels, expired controls and permission loss cannot show dates or export private details',async()=>{
  for(const mode of ['owner','channel','expiry','permission']){
    const f=await fixture(),event=await f.add({title:'非公開の予定'});await f.act('event',[event]);const i=f.click('export-event');if(mode==='owner')i.user.id='other';if(mode==='channel')i.channelId='other';if(mode==='expiry')f.s.expires=0;if(mode==='permission')f.visible(false);await f.controller.handle(i);assert.ok(!i.replies.some(m=>m.files));assert.ok(!JSON.stringify(i.replies).includes('非公開の予定'));
  }
});
test('dense new screens fit native limits, readonly screens lack edit controls and resume does not replay downloads',async()=>{
  const f=await fixture(),event=await f.add({title:'*'.repeat(80),description:'*'.repeat(500),color:'purple'});await f.act('event',[event]);const message=f.screen();assert.equal(message.components.length,4);for(const row of message.components)assert.ok(row.toJSON().components.length<=5);assert.ok(message.embeds.every(e=>e.toJSON().description.length<=4096));assert.deepEqual(message.allowedMentions.parse,[]);
  await f.act('export-event');await f.controller.openAdmin(interaction());assert.equal(f.s.view,'event');assert.equal(f.screen().files,undefined);await f.act('list');await f.act('days');const old=f.click('days-toggle');await f.controller.openAdmin(interaction());assert.equal(f.s.view,'days');await f.controller.handle(old);assert.equal(f.s.dayPicker.onlyEvents,true);assert.ok(f.screen().components.length<=5);assert.ok(controls(f.screen()).filter(c=>c.type===3).every(c=>c.options.length<=25));
});

// Full-title keys belong to this rendered month and never merge distinct events.
test('truncated names get bounded full-title keys without merging same-name events or repeating week spans',()=>{
  const long='オンライン交流セッション'.repeat(4),first={id:'a',date:'2026-10-01',endDate:'2026-10-31',start:null,title:long};
  const second={...first,id:'b',date:'2026-10-22',endDate:undefined};
  const result=calendarImage('2026-10',[first,second,{...first,id:'private',date:'2026-11-01',endDate:undefined}]);
  assert.equal(result.geometry.shortenedCount,2);assert.equal(result.geometry.titleKeyCount,2);assert.equal(result.layout.count,2);assert.ok(result.geometry.keyHeight>100);assert.equal(result.geometry.bandTop,40);
  const short=calendarImage('2026-10',[{date:'2026-10-21',start:null,title:'会議'}]);assert.equal(short.geometry.keyHeight,0);
});
test('many long titles and astral Unicode keep the image bounded and retain honest hidden counts',()=>{
  const events=Array.from({length:200},(_,n)=>({id:String(n),date:`2026-10-${String(n%31+1).padStart(2,'0')}`,start:null,title:'🪐𠮷'.repeat(40)}));
  const result=calendarImage('2026-10',events);assert.equal(result.geometry.titleKeyCount,8);assert.ok(result.geometry.shortenedCount>8);assert.ok(result.height<1800);assert.ok(result.buffer.length<150000);assert.equal(result.layout.count,200);assert.equal(result.layout.cells.reduce((n,c)=>n+c.hidden,0),200-result.layout.spans.length);
});

test('a six-character Japanese title fits a single readable line instead of an orphan character',()=>{
  const result=calendarImage('2026-10',[{date:'2026-10-21',start:null,title:'ホームシック'}]);assert.equal(result.geometry.wrapped,false);assert.equal(result.geometry.bandHeight,25);assert.equal(result.geometry.titleKeyCount,0);
});
