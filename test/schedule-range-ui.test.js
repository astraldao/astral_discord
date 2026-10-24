import test from 'node:test';
import assert from 'node:assert/strict';
import {ScheduleStore} from '../src/schedule-store.js';
import {createScheduleController,scheduleScreen} from '../src/schedule-ui.js';

const CHANNEL='234567890123456789',POST='345678901234567890';
const input=(title,date,time='')=>({title,date,time,place:'',description:''});
const controls=message=>message.components.flatMap(row=>row.toJSON().components);
const eventOptions=message=>controls(message).find(c=>c.custom_id?.endsWith(':event'))?.options??[];
const body=message=>message.embeds.map(embed=>embed.toJSON().description).join('\n');
function interaction(customId,user='owner',channelId=CHANNEL){return {customId,user:{id:user},channelId,message:{id:POST,flags:{has:()=>true}},replies:[],async deferReply(){this.deferred=true;},async deferUpdate(){this.deferred=true;},async reply(m){this.replied=true;this.replies.push(m);},async editReply(m){this.replies.push(m);},async showModal(m){this.modal=m;}};}
async function fixture(date='2026-10-14T12:00:00Z',options={}){
  let time=Date.parse(date),visible=true,admin=true;
  const store=new ScheduleStore(),id=await store.create('予定表'),other=await store.create('別の予定表'),controller=createScheduleController({store,guild:{id:'guild'},now:()=>time,access:async(i,power)=>{if(!visible||power&&!admin)throw new Error('PRIVATE_PERMISSION');},...options});
  await controller.openAdmin(interaction());const s=[...controller.sessions.sessions.values()][0];
  const click=(action,values,session=s)=>Object.assign(interaction(`schedule:${session.id}:${session.turn}:${action}`,session.userId),values===undefined?{}:{values});
  await controller.handle(click('calendar',[id]));
  const act=async(action,values,session=s)=>{const i=click(action,values,session);await controller.handle(i);return i;};
  const submit=async(open,values)=>{const i=Object.assign(interaction(open.modal.toJSON().custom_id,open.user.id),{fields:{getTextInputValue:key=>values[key]??''}});await controller.handle(i);return i;};
  return {store,id,other,controller,s,click,act,submit,screen:()=>scheduleScreen(s,store),add:(title,date,time='')=>store.putEvent(id,null,input(title,date,time)),setNow:date=>time=Date.parse(date),setVisible:value=>visible=value,setAdmin:value=>admin=value};
}

test('period selector preserves the month image and offers monthly, weekly and thirty-date views',async()=>{
  const f=await fixture(),first=f.screen();assert.equal(first.files.length,1);
  const select=controls(first).find(c=>c.custom_id?.endsWith(':period'));
  assert.deepEqual(select.options.map(o=>o.value),['month-calendar','month-list','week','upcoming']);
  await f.act('period',['week']);assert.equal(f.s.rangeStart,'2026-10-11');assert.equal(f.s.rangeEnd,'2026-10-17');assert.equal(f.screen().files,undefined);
  assert.ok(body(f.screen()).includes('10/11'));assert.equal(f.s.query,undefined);assert.equal(f.s.date,undefined);
  await f.act('period',['month-list']);assert.equal(f.s.period,undefined);assert.equal(f.s.rangeStart,undefined);assert.equal(f.s.display,'list');assert.equal(f.screen().files,undefined);
  await f.act('period',['month-calendar']);assert.equal(f.screen().files.length,1);
});

test('weekly lists include carry-in periods and overnight events once without midnight-end spillover',async()=>{
  const f=await fixture();await f.add('期間の予定','2026/10/09〜2026/10/12');await f.add('前日の深夜','2026/10/10','23:00-01:00');await f.add('午前0時終了','2026/10/10','23:00-00:00');await f.add('土曜の予定','2026/10/17');await f.add('次の週','2026/10/18');
  await f.store.putEvent(f.other,null,input('別の予定表の秘密','2026/10/14'));
  await f.act('period',['week']);const m=f.screen(),labels=eventOptions(m).map(o=>o.label);
  assert.deepEqual(labels,['期間の予定','前日の深夜','土曜の予定']);assert.equal((body(m).match(/期間前から続く予定/g)??[]).length,2);assert.ok(!body(m).includes('別の予定表の秘密'));assert.ok(body(m).includes('翌日'));
});

test('week navigation crosses years, returns to current JST week and disables supported edges',async()=>{
  const f=await fixture();f.s.month='2026-12';f.s.date='2026-12-31';await f.act('period',['week']);assert.equal(f.s.rangeStart,'2026-12-27');
  await f.act('week-next');assert.equal(f.s.rangeStart,'2027-01-03');assert.equal(f.s.month,'2027-01');await f.act('week-prev');assert.equal(f.s.rangeEnd,'2027-01-02');assert.ok(body(f.screen()).includes('2027年'));
  await f.act('week-current');assert.equal(f.s.rangeStart,'2026-10-11');
  for(const [date,action,start] of [['2000-01-01','week-prev','2000-01-01'],['2099-12-31','week-next','2099-12-27']]){
    await f.act('period',['month-list']);f.s.date=date;f.s.month=date.slice(0,7);await f.act('period',['week']);
    assert.equal(controls(f.screen()).find(c=>c.custom_id?.endsWith(`:${action}`)).disabled,true);await f.act(action);assert.equal(f.s.rangeStart,start);
  }
});

test('today through day twenty-nine is explicit, clips at 2099 and refreshes at a JST day boundary',async()=>{
  const f=await fixture('2026-10-14T14:59:59Z');await f.add('前日だけ','2026/10/13');await f.add('今日','2026/10/14');await f.add('29日後','2026/11/12');await f.add('30日後','2026/11/13');
  await f.act('period',['upcoming']);assert.equal(f.s.rangeStart,'2026-10-14');assert.equal(f.s.rangeEnd,'2026-11-12');assert.deepEqual(eventOptions(f.screen()).map(o=>o.label),['今日','29日後']);
  f.setNow('2026-10-14T15:00:00Z');await f.act('upcoming-current');assert.equal(f.s.rangeStart,'2026-10-15');assert.equal(f.s.rangeEnd,'2026-11-13');
  const last=await fixture('2099-12-30T12:00:00Z');await last.act('period',['upcoming']);assert.equal(last.s.rangeEnd,'2099-12-31');assert.ok(body(last.screen()).includes('最大30日分'));
});

test('search spans the authorized calendar and clearing search restores the previous week',async()=>{
  const f=await fixture();await f.add('星の今週','2026/10/14');await f.add('星の来年','2027/01/04');await f.act('period',['week']);
  const search=await f.act('search');await f.submit(search,{value:'星'});assert.equal(eventOptions(f.screen()).length,2);assert.equal(f.s.period,'week');assert.ok(body(f.screen()).includes('全期間'));
  await f.act('search-clear');assert.equal(f.s.rangeStart,'2026-10-11');assert.deepEqual(eventOptions(f.screen()).map(o=>o.label),['星の今週']);
});

test('month selectors clear a selected day and day navigation leaves range mode deliberately',async()=>{
  const f=await fixture();await f.add('今日','2026/10/14');await f.add('明日','2026/10/15');await f.act('day-today');assert.equal(eventOptions(f.screen()).length,1);
  await f.act('period',['month-list']);assert.equal(f.s.date,undefined);assert.equal(eventOptions(f.screen()).length,2);
  await f.act('period',['week']);await f.act('week-next');const day=await f.act('day-jump');assert.equal(day.modal.toJSON().components[0].components[0].value,'2026-10-18');
  await f.submit(day,{value:'2026/11/03'});assert.equal(f.s.period,undefined);assert.equal(f.s.rangeStart,undefined);assert.equal(f.s.date,'2026-11-03');
  await f.act('period',['week']);await f.act('month-current');assert.equal(f.s.period,undefined);assert.equal(f.s.month,'2026-10');
});

test('range details keep their page and additions prefill a date inside the selected range',async()=>{
  const f=await fixture();for(let n=0;n<10;n++)await f.add(`予定${n}`,'2026/10/14');await f.act('period',['week']);await f.act('next');const selected=eventOptions(f.screen())[0];
  await f.act('event',[selected.value]);await f.act('list');assert.equal(f.s.page,1);assert.equal(f.s.period,'week');
  const add=await f.act('new-event');assert.equal(add.modal.toJSON().components[1].components[0].value,'2026-10-14');
  await f.act('list');await f.act('week-next');const later=await f.act('new-event');assert.equal(later.modal.toJSON().components[1].components[0].value,'2026-10-18');assert.equal(f.store.calendar(f.id).events.length,10);
});

test('editing an event outside the current range returns to its new month after details',async()=>{
  const f=await fixture(),id=await f.add('移動する予定','2026/10/14');await f.act('period',['week']);await f.act('event',[id]);const edit=await f.act('edit-event');await f.submit(edit,input('移動後','2027/01/04'));
  assert.equal(f.s.view,'event');assert.equal(f.s.period,undefined);assert.equal(f.s.rangeStart,undefined);await f.act('list');assert.equal(f.s.month,'2027-01');assert.deepEqual(eventOptions(f.screen()).map(o=>o.label),['移動後']);
});

test('range export contains every filtered page, preserves whole event endpoints and makes no publication',async()=>{
  const f=await fixture();await f.add('期間','2026/10/09〜2026/10/12');for(let n=0;n<10;n++)await f.add(`週間の予定${n}`,'2026/10/14');await f.add('対象外','2026/10/18');await f.act('period',['week']);
  await f.act('tools');assert.ok(body(f.screen()).includes('11件'));assert.ok(body(f.screen()).includes('週間'));const download=await f.act('export');const file=download.replies.at(-1).files[0].attachment.toString('utf8');
  assert.equal((file.match(/BEGIN:VEVENT/g)??[]).length,11);assert.ok(file.includes('DTSTART;VALUE=DATE:20261009'));assert.ok(file.includes('DTEND;VALUE=DATE:20261013'));assert.ok(!file.includes('対象外'));assert.equal(f.store.calendar(f.id).publications.length,0);
  await f.act('list');assert.equal(f.screen().files,undefined);assert.equal(f.s.period,'week');
  await f.act('tools');await f.act('publish');assert.equal(f.s.view,'publish');assert.ok(body(f.screen()).includes('2026年10月'));assert.equal(f.store.calendar(f.id).publications.length,0);
});

test('confirmed recurrence leaves a narrow range so newly created dates are visible in their month',async()=>{
  const f=await fixture(),id=await f.add('定例','2026/10/14');await f.act('period',['week']);await f.act('event',[id]);await f.act('repeat');await f.act('repeat-preview');
  assert.equal(f.store.calendar(f.id).events.length,1);await f.act('repeat-save');assert.equal(f.store.calendar(f.id).events.length,5);assert.equal(f.s.period,undefined);assert.equal(f.s.rangeStart,undefined);assert.equal(f.s.month,'2026-10');assert.equal(f.s.view,'list');assert.ok(eventOptions(f.screen()).some(e=>e.description.startsWith('2026-10-21')));
});

test('confirmed ICS import leaves the previous range and displays the first imported month',async()=>{
  const data=Buffer.from(['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT','SUMMARY:取り込み予定','DTSTART;VALUE=DATE:20261130','END:VEVENT','END:VCALENDAR',''].join('\r\n'));
  const f=await fixture(undefined,{readImport:async()=>data});await f.add('元の週の予定','2026/10/14');await f.act('period',['week']);await f.act('tools');const upload=await f.act('import');
  const submit=Object.assign(interaction(upload.modal.toJSON().custom_id),{fields:{getUploadedFiles:()=>({size:1,first:()=>({})})}});await f.controller.handle(submit);assert.equal(f.s.view,'import-preview');assert.equal(f.store.calendar(f.id).events.length,1);
  await f.act('import-save');assert.equal(f.store.calendar(f.id).events.length,2);assert.equal(f.s.period,undefined);assert.equal(f.s.rangeEnd,undefined);assert.equal(f.s.month,'2026-11');assert.deepEqual(eventOptions(f.screen()).map(o=>o.label),['取り込み予定']);
});

test('admin resume preserves weekly navigation and search pages while refreshing an upcoming background range',async()=>{
  const f=await fixture('2026-10-14T14:59:59Z');for(let n=0;n<10;n++)await f.add(`星${n}`,'2027/01/04');await f.act('period',['week']);await f.act('week-next');const week=f.s.rangeStart;await f.controller.openAdmin(interaction());assert.equal(f.s.rangeStart,week);
  await f.act('period',['upcoming']);const search=await f.act('search');await f.submit(search,{value:'星'});await f.act('next');const stale=f.click('search-clear'),expires=f.s.expires;
  f.setNow('2026-10-14T15:00:00Z');await f.controller.openAdmin(interaction());assert.equal(f.s.query,'星');assert.equal(f.s.page,1);assert.equal(f.s.rangeStart,'2026-10-15');assert.equal(f.s.expires,expires);
  await f.controller.handle(stale);assert.equal(f.s.query,'星');await f.act('search-clear');assert.equal(f.s.rangeStart,'2026-10-15');assert.equal(f.s.page,0);
});

test('viewer range actions retain publication, owner, channel, expiry and fresh permission guards',async()=>{
  const f=await fixture(),event=await f.add('見せない予定','2026/10/14'),p=await f.store.reserve(f.id,CHANNEL,'2026-10');await f.store.complete(p,POST);f.setAdmin(false);
  await f.controller.handle(interaction(`schedule:panel:${p}`,'viewer'));const s=[...f.controller.sessions.sessions.values()].find(s=>s.userId==='viewer');await f.act('period',['week'],s);
  assert.ok(!controls(scheduleScreen(s,f.store)).some(c=>c.custom_id?.endsWith(':new-event')));const before=f.store.calendar(f.id);
  for(const action of ['new-event','publish','import']){const i=await f.act(action,undefined,s);assert.equal(i.modal,undefined);assert.ok(body(i.replies.at(-1)).includes('管理者専用'));assert.deepEqual(f.store.calendar(f.id),before);}
  for(const change of [i=>i.user.id='other',i=>i.channelId='other']){const i=f.click('period',['upcoming'],s);change(i);await f.controller.handle(i);assert.ok(!JSON.stringify(i.replies).includes(event));assert.equal(s.period,'week');}
  const stale=f.click('period',['upcoming'],s);stale.customId=stale.customId.replace(`:${s.turn}:`,':-1:');await f.controller.handle(stale);assert.ok(body(stale.replies.at(-1)).includes('古い画面'));assert.equal(s.period,'week');
  f.setVisible(false);const denied=await f.act('week-next',undefined,s);assert.ok(!body(denied.replies.at(-1)).includes('見せない予定'));f.setVisible(true);
  await f.store.unpublish(p,JSON.stringify(f.store.publication(p)));const revoked=await f.act('period',['upcoming'],s);assert.ok(!body(revoked.replies.at(-1)).includes('見せない予定'));assert.equal(f.store.calendar(f.id).events.length,before.events.length);
  s.expires=0;const expired=await f.act('list',undefined,s);assert.ok(!body(expired.replies.at(-1)).includes('見せない予定'));
});

test('invalid range controls do not change state or silently broaden the event selection',async()=>{
  const f=await fixture();await f.act('period',['week']);const start=f.s.rangeStart;
  for(const values of [[],['month'],['upcoming','week'],['__proto__']]){await f.act('period',values);assert.equal(f.s.rangeStart,start);assert.equal(f.s.period,'week');}
  await f.act('tools');await f.act('period',['upcoming']);assert.equal(f.s.view,'tools');assert.equal(f.s.period,'week');await f.act('list');await f.act('period',['upcoming']);await f.act('week-next');assert.equal(f.s.period,'upcoming');
});

test('dense monthly, daily, weekly, upcoming and search screens fit native Discord limits for both scopes',async()=>{
  const f=await fixture();for(let n=0;n<200;n++)await f.add('*'.repeat(80),'2026/10/14');
  for(const scope of ['admin','viewer'])for(const value of ['month-calendar','month-list','week','upcoming']){
    f.s.scope=scope;f.s.viaMenu=scope==='viewer'; // Render-only variants; controller guards have independent tests.
    Object.assign(f.s,{view:'list',period:value==='week'||value==='upcoming'?value:undefined,rangeStart:value==='week'||value==='upcoming'?'2026-10-11':undefined,rangeEnd:value==='week'||value==='upcoming'?'2026-11-09':undefined,date:undefined,query:undefined,display:value==='month-list'?'list':'calendar',page:0});
    for(const variant of ['normal','day','search']){
      f.s.date=variant==='day'?'2026-10-14':undefined;f.s.query=variant==='search'?'*':undefined;const m=f.screen();assert.ok(m.components.length<=5);
      assert.ok(controls(m).every(c=>!c.custom_id||c.custom_id.length<=100));for(const row of m.components)assert.ok(row.toJSON().components.length<=5);for(const embed of m.embeds)assert.ok(embed.toJSON().description.length<=4096);assert.deepEqual(m.allowedMentions.parse,[]);
    }
  }
});

test('search is directly available, returns to the previous page and retains that origin when changing terms',async()=>{
  const f=await fixture();for(let n=0;n<24;n++)await f.add(`卓 ${n}`,'2026/10/14');await f.act('period',['month-list']);await f.act('next');await f.act('next');assert.equal(f.s.page,2);
  assert.equal(controls(f.screen()).flatMap(c=>c.options??[]).filter(o=>o.value==='search').length,1);
  const first=await f.act('search');assert.ok(first.modal.toJSON().components[0].components[0].placeholder.includes('日付:'));
  await f.submit(first,{value:'日付:2026/10/14 卓'});assert.equal(eventOptions(f.screen()).length,8);assert.equal(f.s.page,0);
  const change=await f.act('search');await f.submit(change,{value:'月:2026/10 卓'});await f.act('next');await f.act('search-clear');assert.equal(f.s.page,2);assert.equal(f.s.query,undefined);assert.equal(f.s.searchReturn,undefined);
  const again=await f.act('search');await f.submit(again,{value:'卓'});const blank=await f.act('search');await f.submit(blank,{value:''});assert.equal(f.s.page,2);
});

test('invalid date search preserves results, and changing the view discards the old page origin',async()=>{
  const f=await fixture();for(let n=0;n<20;n++)await f.add(`卓 ${n}`,'2026/10/14');await f.act('next');
  let form=await f.act('search');await f.submit(form,{value:'卓'});const origin=structuredClone(f.s.searchReturn),before=structuredClone(f.store.data);
  form=await f.act('search');const rejected=await f.submit(form,{value:'日付:2026/02/30'});assert.ok(body(rejected.replies.at(-1)).includes('存在する日付'));assert.equal(f.s.query,'卓');assert.deepEqual(f.s.searchReturn,origin);assert.deepEqual(f.store.data,before);
  await f.act('period',['week']);assert.equal(f.s.searchReturn,undefined);form=await f.act('search');await f.submit(form,{value:'卓'});assert.equal(f.s.searchReturn.page,0);await f.act('search-clear');assert.equal(f.s.page,0);assert.equal(f.s.period,'week');
});

test('search page restoration clamps after removal and avoids an old page after the upcoming date range changes',async()=>{
  const f=await fixture('2026-10-14T14:59:59Z');for(let n=0;n<18;n++)await f.add(`卓 ${n}`,'2026/10/14');await f.act('period',['upcoming']);await f.act('next');await f.act('next');
  let form=await f.act('search');await f.submit(form,{value:'卓'});
  for(const e of f.store.calendar(f.id).events.slice(1))await f.store.removeEvent(f.id,e.id,e.revision);
  await f.act('search-clear');assert.equal(f.s.page,0);
  form=await f.act('search');await f.submit(form,{value:'卓'});f.setNow('2026-10-14T15:00:00Z');await f.controller.openAdmin(interaction());await f.act('search-clear');assert.equal(f.s.page,0);assert.equal(f.s.rangeStart,'2026-10-15');
});

test('an empty search submitted from an unfiltered page keeps the page and does not mutate data',async()=>{
  const f=await fixture();for(let n=0;n<12;n++)await f.add(`予定${n}`,'2026/10/14');await f.act('next');const before=structuredClone(f.store.data);
  const form=await f.act('search');await f.submit(form,{value:''});assert.equal(f.s.page,1);assert.equal(f.s.query,undefined);assert.deepEqual(f.store.data,before);
});
