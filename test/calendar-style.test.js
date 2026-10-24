import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {calendarImage} from '../src/calendar-image.js';
import {encodePng} from '../src/sprite-image.js';
const event=(id,date,extra={})=>({id,title:id,date,start:null,end:null,...extra});
function contents(buffer){
  let at=8,palette;const data=[];
  while(at<buffer.length){const n=buffer.readUInt32BE(at),type=buffer.toString('ascii',at+4,at+8);if(type==='PLTE')palette=buffer.subarray(at+8,at+8+n);if(type==='IDAT')data.push(buffer.subarray(at+8,at+8+n));at+=n+12;}
  return {palette,raw:inflateSync(Buffer.concat(data))};
}

test('empty weeks shrink while busy weeks retain all three lanes and space for overflow',()=>{
  const events=Array.from({length:200},(_,n)=>event(`予定${n}`,'2026-10-14')),before=structuredClone(events),image=calendarImage('2026-10',events),g=image.geometry;
  const busy=g.weeks[2],empty=g.weeks[0];assert.ok(busy.height>empty.height);assert.equal(busy.lanes,3);assert.equal(empty.lanes,0);assert.equal(image.layout.cells[13].hidden,197);
  assert.ok(busy.top+busy.overflowY+20<=busy.top+busy.height);assert.equal(g.gridBottom,g.weeks.at(-1).top+g.weeks.at(-1).height);assert.equal(image.height,g.gridBottom+g.keyHeight+42);assert.deepEqual(events,before);
  for(let n=1;n<g.weeks.length;n++)assert.equal(g.weeks[n].top,g.weeks[n-1].top+g.weeks[n-1].height);
});

test('a busy week does not remove wrapped names and times from another sparse week',()=>{
  const events=[...Array.from({length:10},(_,n)=>event(`混雑${n}`,'2026-10-14')),event('オンライン交流セッション','2026-10-23',{start:1230}),event('翌月の予定','2026-11-01',{start:600})];
  const image=calendarImage('2026-10',events),weeks=image.geometry.weeks;assert.equal(weeks[2].rich,false);assert.equal(weeks[3].rich,true);assert.equal(weeks[3].wrapped,true);assert.equal(weeks[3].timed,true);assert.ok(weeks[3].bandHeight>=70);assert.equal(weeks[5].timed,true);
  for(const span of [...image.layout.spans,...image.layout.contextSpans]){const week=weeks[span.row],bottom=week.bandTop+span.lane*week.laneGap+week.bandHeight;assert.ok(bottom<week.height);}
});

test('same sample keeps its following week while reducing the height of unused rows',()=>{
  const events=[event('秋のイベント','2026-10-30',{endDate:'2026-11-02'}),event('月末の打ち合わせ','2026-10-31',{start:840}),event('交流会','2026-11-01'),event('来月の定例','2026-11-05')],image=calendarImage('2026-10',events);
  assert.equal(image.layout.rangeEnd,'2026-11-07');assert.equal(image.layout.count,2);assert.ok(image.height<900);assert.equal(image.geometry.weeks.length,6);assert.equal(image.width,840);assert.ok(image.buffer.length<150000);assert.ok(contents(image.buffer).palette.length<=768);
});

test('exact indexed colors preserve different pale surfaces within one 5-bit bucket',()=>{
  const first=[248,249,251],second=[246,242,253],palette=Buffer.from([...first,...second]),lookup=Buffer.alloc(32768,1),color=rgb=>(rgb[0]<<16)|(rgb[1]<<8)|rgb[2],pixels=Buffer.from([...first,255,...second,255]);
  const png=encodePng(pixels,2,1,{palette,lookup,exact:new Map([[color(first),0],[color(second),1]])}),{raw}=contents(png);
  assert.equal(png[25],3);assert.deepEqual([...raw],[1,0,1]);assert.deepEqual([...contents(encodePng(pixels,2,1,{palette,lookup})).raw],[1,1,0]);
});

test('invalid exact palettes reject before encoding and optional empty maps keep legacy lookup behavior',()=>{
  const pixels=Buffer.from([255,255,255,255]),palette=Buffer.from([255,255,255]),lookup=Buffer.alloc(32768);
  for(const exact of [{},new Map([[-1,0]]),new Map([[0.5,0]]),new Map([[0,1]]),new Map([[0,-1]]),new Map(Array.from({length:257},(_,n)=>[n,0]))])assert.throws(()=>encodePng(pixels,1,1,{palette,lookup,exact}));
  assert.throws(()=>encodePng(pixels,1,1,{exact:new Map()}));assert.deepEqual(encodePng(pixels,1,1,{palette,lookup,exact:new Map()}),encodePng(pixels,1,1,{palette,lookup}));
});
