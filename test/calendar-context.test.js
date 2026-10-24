import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {calendarLayout,calendarImage,calendarAlt} from '../src/calendar-image.js';
import {ScheduleStore} from '../src/schedule-store.js';
import {scheduleScreen,schedulePanel} from '../src/schedule-ui.js';
import {selectedScheduleEvents} from '../src/schedule-query.js';
import {scheduleExport} from '../src/schedule-export.js';
const event=(id,date,extra={})=>({id,date,title:id,start:null,end:null,...extra});
function decoder(buffer){
  let at=8,palette;const chunks=[];
  while(at<buffer.length){const n=buffer.readUInt32BE(at),type=buffer.toString('ascii',at+4,at+8);if(type==='PLTE')palette=buffer.subarray(at+8,at+8+n);if(type==='IDAT')chunks.push(buffer.subarray(at+8,at+8+n));at+=n+12;}
  assert.ok(palette.length<=768);const width=buffer.readUInt32BE(16),raw=inflateSync(Buffer.concat(chunks));
  return (x,y)=>{const offset=y*(width+1);assert.equal(raw[offset],1);let index=0;for(let n=0;n<=x;n++)index=(index+raw[offset+1+n])&255;return [...palette.subarray(index*3,index*3+3)];};
}

test('all supported months show adjacent dates in complete weeks, including Saturday endings and year boundaries',()=>{
  for(let year=2000;year<=2099;year++)for(let m=1;m<=12;m++){
    const month=`${year}-${String(m).padStart(2,'0')}`,g=calendarLayout(month,[]),days=new Date(Date.UTC(year,m,0)).getUTCDate(),last=`${month}-${days}`;
    assert.equal(g.cells.length,days);assert.ok(g.rows>=5&&g.rows<=6);assert.equal(g.gridCells.length,g.rows*7);assert.equal(g.contextCells.length,g.rows*7-days);
    assert.ok(g.rangeEnd>last);assert.equal(g.rangeEnd,g.gridCells.at(-1).date);assert.equal(new Date(g.rangeEnd+'T00:00:00Z').getUTCDay(),6);
    assert.equal(g.rows,Math.ceil((g.offset+days)/7)+((g.offset+days)%7===0?1:0));
    for(let n=0;n<g.gridCells.length;n++){const c=g.gridCells[n];assert.equal(c.row,Math.floor(n/7));assert.equal(c.col,n%7);if(n)assert.equal(Date.parse(c.date)-Date.parse(g.gridCells[n-1].date),86400000);}
  }
  const october=calendarLayout('2026-10',[]);assert.equal(october.rows,6);assert.equal(october.rangeEnd,'2026-11-07');assert.equal(calendarLayout('2026-02',[]).rangeEnd,'2026-03-07');
  assert.ok(calendarLayout('2000-01',[]).rangeStart.startsWith('1999-12'));assert.ok(calendarLayout('2099-12',[]).rangeEnd.startsWith('2100-01'));
});

test('adjacent plans are drawn only inside the grid and do not change month counts or selected-day metadata',()=>{
  const events=[event('前月','2026-09-27'),event('当月','2026-10-31'),event('翌月','2026-11-01'),event('最終日','2026-11-07'),event('表示外','2026-11-08')],g=calendarLayout('2026-10',events,'2026-11-01','2026-11-01');
  assert.equal(g.count,1);assert.deepEqual(g.spans.map(s=>s.event.id),['当月']);assert.deepEqual(g.contextSpans.map(s=>s.event.id),['前月','翌月','最終日']);assert.ok(g.contextCells.every(c=>!c.selected));assert.equal(g.contextCells.find(c=>c.date==='2026-11-01').today,true);
  const alt=calendarAlt(g);assert.ok(alt.includes('当月1件'));assert.ok(alt.includes('前後の月は薄字'));assert.ok(alt.includes('2026-11-01（今日）'));assert.ok(!alt.includes('表示外'));
});

test('a month-crossing event keeps one lane when split into current and faded portions of a week',()=>{
  for(const [month,date,endDate] of [['2026-10','2026-09-29','2026-10-03'],['2026-11','2026-11-30','2026-12-02'],['2026-12','2026-12-30','2027-01-02']]){
    const g=calendarLayout(month,[event('連続予定',date,{endDate})]),inside=g.spans.find(s=>g.contextSpans.some(c=>c.row===s.row)),outside=g.contextSpans.find(s=>s.row===inside.row);
    assert.equal(g.count,1);assert.equal(inside.lane,outside.lane);assert.ok(inside.continuesBefore||inside.continuesAfter);assert.ok(outside.continuesBefore||outside.continuesAfter);
    for(const c of g.gridCells){const cover=[...g.spans,...g.contextSpans].filter(s=>s.row===c.row&&s.col<=c.col&&s.endCol>=c.col);assert.equal(new Set(cover.map(s=>s.lane)).size,cover.length);assert.equal(c.hidden+cover.length,c.items.length);}
  }
});

test('adjacent bands and text are visually faded while current-month colors remain unchanged',()=>{
  const image=calendarImage('2026-10',[event('会議','2026-10-18',{color:'blue'}),event('会議','2026-11-01',{color:'blue'})]),pixel=decoder(image.buffer),g=image.geometry;
  const sample=row=>pixel(124,g.weeks[row].top+g.weeks[row].bandTop+g.weeks[row].bandHeight-3),current=sample(3),next=sample(5);assert.deepEqual(current,[208,239,252]);assert.ok(next.reduce((a,b)=>a+b,0)>current.reduce((a,b)=>a+b,0));
  const darkest=row=>{let min=255;for(let y=g.weeks[row].top+g.weeks[row].bandTop;y<g.weeks[row].top+g.weeks[row].bandTop+g.weeks[row].bandHeight;y++)for(let x=22;x<90;x++)min=Math.min(min,pixel(x,y)[0]);return min;};
  assert.ok(darkest(5)>darkest(3)+40);
});

test('dense adjacent plans keep honest overflow and bounded PNG output without changing source data',()=>{
  const events=Array.from({length:200},(_,n)=>event(`長い予定${n}`.repeat(8),'2026-11-01')),before=structuredClone(events),image=calendarImage('2026-10',events);
  assert.equal(image.layout.count,0);assert.equal(image.layout.spans.length,0);assert.equal(image.layout.contextSpans.length,3);assert.equal(image.layout.contextCells.find(c=>c.date==='2026-11-01').hidden,197);assert.ok(image.buffer.length<150000);assert.ok(image.height<1800);assert.ok(calendarAlt(image.layout).length<=1024);assert.deepEqual(events,before);
  assert.deepEqual(calendarImage('2026-10',[...events].reverse()).buffer,image.buffer);
});

test('image context does not broaden dropdowns, publication text, ICS selection or another calendar',async()=>{
  const store=new ScheduleStore(),id=await store.create('公開予定表'),other=await store.create('別の予定表');
  const add=(calendar,title,date)=>store.putEvent(calendar,null,{title,date,time:'',place:'',description:''});const current=await add(id,'当月の予定','2026/10/31'),next=await add(id,'翌月の予定','2026/11/01');await add(other,'別の予定表の秘密','2026/11/01');const before=structuredClone(store.data),c=store.calendar(id);
  const image=calendarImage('2026-10',c.events);assert.equal(image.layout.count,1);assert.ok(calendarAlt(image.layout).includes('翌月の予定'));assert.ok(!calendarAlt(image.layout).includes('秘密'));
  const screen=scheduleScreen({id:'session',scope:'viewer',calendarId:id,view:'list',month:'2026-10',page:0,turn:0},store),options=screen.components.flatMap(r=>r.toJSON().components).find(c=>c.custom_id?.endsWith(':event')).options;
  assert.deepEqual(options.map(o=>o.value),[current]);assert.ok(!options.some(o=>o.value===next));const publication=schedulePanel(c,{id:'post',month:'2026-10'});assert.ok(!publication.embeds.map(e=>e.toJSON().description).join('').includes('翌月の予定'));
  const exported=scheduleExport(c,selectedScheduleEvents(c,{month:'2026-10'})).toString();assert.ok(exported.includes('当月の予定'));assert.ok(!exported.includes('翌月の予定'));assert.deepEqual(store.data,before);
});
