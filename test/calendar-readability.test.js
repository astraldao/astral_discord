import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {calendarImage} from '../src/calendar-image.js';
import {scheduleDays,scheduleImageOverflow} from '../src/schedule-days.js';
import {ScheduleStore} from '../src/schedule-store.js';
import {createScheduleController,scheduleScreen} from '../src/schedule-ui.js';

const controls=m=>m.components.flatMap(row=>row.toJSON().components);
const body=m=>m.embeds.map(e=>e.toJSON().description).join('\n');
const select=(m,action)=>controls(m).find(c=>c.custom_id?.endsWith(`:${action}`));
const input=(title,date='2026/10/14',time='')=>({title,date,time,place:'',description:''});
const CHANNEL='234567890123456789',POST='345678901234567890';
function interaction(customId,user='owner',channelId=CHANNEL){
  return {customId,user:{id:user},channelId,message:{flags:{has:()=>true}},replies:[],async deferReply(){this.deferred=true;},async deferUpdate(){this.deferred=true;},async editReply(m){this.replies.push(m);},async reply(m){this.replied=true;this.replies.push(m);}};
}
async function fixture(){
  let visible=true;
  const store=new ScheduleStore(),id=await store.create('共有'),other=await store.create('別の予定表');
  const controller=createScheduleController({store,guild:{id:'guild'},now:()=>Date.parse('2026-10-14T12:00:00Z'),access:async()=>{if(!visible)throw new Error('PRIVATE_PERMISSION');}});
  await controller.openAdmin(interaction());const s=[...controller.sessions.sessions.values()][0];
  const click=(action,values)=>Object.assign(interaction(`schedule:${s.id}:${s.turn}:${action}`),values===undefined?{}:{values});
  const act=async(action,values)=>{const i=click(action,values);await controller.handle(i);return i;};
  await act('calendar',[id]);
  return {store,id,other,s,controller,click,act,screen:()=>scheduleScreen(s,store),add:(title,date,time)=>store.putEvent(id,null,input(title,date,time)),visible:value=>visible=value};
}
function decode(buffer){
  let at=8,palette;const chunks=[];
  while(at<buffer.length){const length=buffer.readUInt32BE(at),type=buffer.toString('ascii',at+4,at+8);if(type==='PLTE')palette=buffer.subarray(at+8,at+8+length);if(type==='IDAT')chunks.push(buffer.subarray(at+8,at+8+length));at+=length+12;}
  const width=buffer.readUInt32BE(16),height=buffer.readUInt32BE(20),raw=inflateSync(Buffer.concat(chunks)),indices=Buffer.alloc(width*height);
  for(let y=0;y<height;y++){assert.equal(raw[y*(width+1)],1);for(let x=0,left=0;x<width;x++){left=(left+raw[y*(width+1)+x+1])&255;indices[y*width+x]=left;}}
  return {palette,indices,width,pixel:(x,y)=>[...palette.subarray(indices[y*width+x]*3,indices[y*width+x]*3+3)]};
}
const luminance=rgb=>rgb.map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[0.2126,0.7152,0.0722][i],0);
const ratio=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);

test('real PNG secondary text retains at least 4.5 contrast on current, adjacent and neutral surfaces',()=>{
  const colors=['blue','green','red','purple','yellow','slate'];
  const events=colors.flatMap((color,n)=>[{id:`a${n}`,title:'会議',date:`2026-10-${18+n}`,start:1200,end:null,color},{id:`b${n}`,title:'会議',date:`2026-11-0${1+n}`,start:1200,end:null,color}]);
  const image=calendarImage('2026-10',events,{today:'2026-10-24',selectedDate:'2026-10-14'}),png=decode(image.buffer),fg=[90,98,106];
  const backgrounds=[[255,255,255],[248,249,251],[250,251,252],[234,246,253]];
  for(const span of [...image.layout.spans,...image.layout.contextSpans]){
    const week=image.geometry.weeks[span.row],x=image.geometry.left+span.col*image.geometry.cellWidth+12,y=week.top+week.bandTop+span.lane*week.laneGap;
    const bg=png.pixel(x+65,y+week.bandHeight-3);backgrounds.push(bg);
    let found=false;for(let dy=0;dy<week.bandHeight;dy++)for(let dx=0;dx<90;dx++)if(png.pixel(x+dx,y+dy).join(',')===fg.join(','))found=true;
    assert.ok(found,`${span.event.color} ${!!span.outside} has real secondary-text pixels`);
  }
  for(const bg of backgrounds)assert.ok(ratio(fg,bg)>=4.5,`${bg}: ${ratio(fg,bg)}`);
  assert.equal(image.layout.rangeEnd,'2026-11-07');assert.ok(png.palette.length<=768);
});

test('overflow matches the actual lanes, excludes context-only days and never merges calendars',async()=>{
  const f=await fixture();for(let n=0;n<5;n++)await f.add(`当月${n}`);for(let n=0;n<8;n++)await f.add(`翌月${n}`,'2026/11/01');
  await f.store.putEvent(f.other,null,input('非公開','2026/10/14'));
  const c=f.store.calendar(f.id),before=structuredClone(f.store.data);
  assert.deepEqual(scheduleImageOverflow(f.s,c),[{date:'2026-10-14',hidden:2}]);
  const days=scheduleDays(c,'2026-10','2026-10-14',{onlyHidden:true,onlyEvents:true});assert.equal(days.length,1);assert.match(days[0].description,/画像では\+2件/);assert.ok(!JSON.stringify(days).includes('非公開'));
  for(const change of [{display:'list'},{query:'当月'},{date:'2026-10-14'},{period:'week'},{period:'upcoming'},{view:'event'}])assert.deepEqual(scheduleImageOverflow({...f.s,...change},c),[]);
  assert.deepEqual(f.store.data,before);
});

test('the existing picker opens hidden days, then the complete paginated text list, with no extra controls',async()=>{
  const f=await fixture();for(let n=0;n<12;n++)await f.add(`長い名前の予定${n}`,'2026/10/14',`${String(10+Math.floor(n/6)).padStart(2,'0')}:${String(n%6*10).padStart(2,'0')}`);await f.add('別の日','2026/10/15');
  const before=structuredClone(f.store.data),first=f.screen(),actions=select(first,'actions');assert.equal(actions.options.find(o=>o.value==='days').label,'省略のある日から探す');assert.match(body(first),/月の一覧/);assert.match(body(first),/当月の1日/);
  assert.equal(select(first,'period').options.length,4);assert.ok(first.components.length<=5);
  await f.act('actions',['days']);assert.equal(f.s.dayPicker.onlyHidden,true);assert.deepEqual(select(f.screen(),'days-date').options.map(o=>o.value),['2026-10-14']);
  await f.act('days-date',['2026-10-14']);assert.equal(f.s.display,'list');assert.equal(f.s.date,'2026-10-14');assert.equal(f.screen().files,undefined);assert.equal(select(f.screen(),'event').options.length,8);assert.match(body(f.screen()),/1\/2ページ/);
  await f.act('next');assert.equal(select(f.screen(),'event').options.length,4);await f.act('period',['month-calendar']);assert.equal(f.s.date,undefined);assert.equal(f.s.page,0);assert.equal(f.screen().files.length,1);
  for(const r of f.screen().components){const components=r.toJSON().components;if(components[0].type===2)assert.ok(components.length<=3);}
  assert.deepEqual(f.store.data,before);
});

test('hidden-day filtering can widen deliberately and return without changing the source view',async()=>{
  const f=await fixture();for(let n=0;n<4;n++)await f.add(`予定${n}`);await f.add('翌日','2026/10/15');
  await f.act('days');assert.equal(f.s.dayPicker.onlyHidden,true);assert.equal(select(f.screen(),'actions').options[0].label,'予定がある日を表示');
  await f.act('actions',['days-toggle']);assert.equal(f.s.dayPicker.onlyHidden,undefined);assert.equal(select(f.screen(),'days-date').options.length,2);
  await f.act('days-toggle');assert.equal(select(f.screen(),'days-date').options.length,25);await f.act('list');assert.equal(f.s.display,undefined);assert.equal(f.s.date,undefined);assert.equal(f.s.month,'2026-10');
  await f.act('days');await f.act('days-month-next');assert.equal(f.s.dayPicker.onlyHidden,undefined);assert.equal(f.s.dayPicker.month,'2026-11');await f.act('list');assert.equal(f.s.month,'2026-10');
});

test('stale or changed hidden-day selections cannot widen the filter, and revoked access blocks navigation',async()=>{
  const f=await fixture();const ids=[];for(let n=0;n<4;n++)ids.push(await f.add(`予定${n}`));await f.add('省略なし','2026/10/15');
  await f.act('days');await f.act('days-date',['2026-10-15']);assert.equal(f.s.view,'days');
  const old=f.click('days-date',['2026-10-14']);await f.act('days-toggle');await f.controller.handle(old);assert.equal(f.s.view,'days');assert.equal(f.s.date,undefined);
  await f.act('list');await f.act('days');await f.store.removeEvent(f.id,ids.at(-1),0);const result=await f.act('days-date',['2026-10-14']);assert.equal(f.s.view,'days');assert.equal(f.s.date,undefined);assert.match(body(result.replies.at(-1)),/省略のある日はなくなりました/);
  await f.act('days-toggle');const before=structuredClone(f.store.data);f.visible(false);await f.act('days-date',['2026-10-14']);assert.equal(f.s.view,'days');assert.equal(f.s.date,undefined);assert.equal(f.s.dayPicker.onlyEvents,true);assert.deepEqual(f.store.data,before);
});

test('viewer sessions keep the same read-only route while context-only overflow keeps the normal date picker',async()=>{
  const f=await fixture();for(let n=0;n<5;n++)await f.add(`翌月${n}`,'2026/11/01');
  assert.equal(select(f.screen(),'actions').options.find(o=>o.value==='days').label,'日付から探す');assert.ok(!body(f.screen()).includes('省略のある日から探す'));
  for(let n=0;n<4;n++)await f.add(`当月${n}`);const post=await f.store.reserve(f.id,CHANNEL,'2026-10');await f.store.complete(post,POST);
  Object.assign(f.s,{scope:'viewer',publicationId:post});await f.act('actions',['days']);assert.equal(f.s.dayPicker.onlyHidden,true);await f.act('days-date',['2026-10-14']);assert.equal(f.s.display,'list');
  assert.ok(!select(f.screen(),'actions').options.some(o=>o.value==='new-event'));assert.match(body(f.screen()),/当月0/);assert.ok(!body(f.screen()).includes('翌月'));
});

test('a crowded whole month keeps hidden-date pagination bounded and checks the currently displayed page',async()=>{
  const f=await fixture();for(let day=1;day<=31;day++)for(let n=0;n<4;n++)await f.add(`予定${day}-${n}`,`2026/10/${String(day).padStart(2,'0')}`);
  await f.act('days');assert.equal(f.s.dayPicker.onlyHidden,true);assert.equal(select(f.screen(),'days-date').options.length,25);
  await f.act('days-date',['2026-10-31']);assert.equal(f.s.view,'days');await f.act('days-next');assert.equal(select(f.screen(),'days-date').options.length,6);assert.ok(f.screen().components.length<=5);
  await f.act('days-date',['2026-10-31']);assert.equal(f.s.date,'2026-10-31');assert.equal(f.s.display,'list');assert.equal(select(f.screen(),'event').options.length,4);
});
