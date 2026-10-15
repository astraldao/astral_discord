import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {calendarLayout,calendarImage,calendarAlt} from '../src/calendar-image.js';
test('calendar grid uses Sunday start and exact dates for four, five and six week months',()=>{
  for(const [month,days,offset,rows] of [['2026-02',28,0,4],['2026-10',31,4,5],['2026-08',31,6,6],['2028-02',29,2,5]]){
    const g=calendarLayout(month,[]);assert.equal(g.cells.length,days);assert.equal(g.cells[0].col,offset);assert.equal(g.rows,rows);assert.equal(g.cells.at(-1).date,`${month}-${days}`);assert.ok(g.cells.every(c=>c.row<rows&&c.col>=0&&c.col<7));
  }
  for(const month of ['2026-00','2026-13','1999-12','2100-01','2026/10','x'])assert.throws(()=>calendarLayout(month,[]));
});
test('today, daily counts, overnight start date, all-day sorting and other months remain distinct',()=>{
  const g=calendarLayout('2026-10',[{date:'2026-10-14',start:1380,title:'翌日に終わる'},{date:'2026-10-14',start:null,title:'終日'},{date:'2026-11-14',start:1200,title:'別の月'}],'2026-10-14');assert.equal(g.count,2);assert.equal(g.cells[13].today,true);assert.equal(g.cells[13].items[0].title,'終日');assert.equal(g.cells[14].items.length,0);assert.match(calendarAlt(g),/14日（今日）: 2件、終日 終日、23:00/);assert.ok(!calendarAlt(g).includes('別の月'));
});
test('PNG is compact, indexed and correctly sized even with 200 events in one day',()=>{
  const events=Array.from({length:200},(_,n)=>({date:'2026-08-01',start:n,title:'予定'.repeat(40)}));
  const {buffer,width,height,layout}=calendarImage('2026-08',events,{today:'2026-08-01'});assert.equal(width,840);assert.equal(height,1008);assert.equal(buffer.readUInt32BE(16),width);assert.equal(buffer.readUInt32BE(20),height);assert.equal(buffer[25],3);assert.ok(buffer.length<150000);assert.ok(calendarAlt(layout).length<=1024);
  let position=8,data=[];while(position<buffer.length){const length=buffer.readUInt32BE(position),type=buffer.toString('ascii',position+4,position+8);if(type==='IDAT')data.push(buffer.subarray(position+8,position+8+length));position+=length+12;}assert.equal(inflateSync(Buffer.concat(data)).length,(width+1)*height);
});

test('Japanese event titles are rendered, clipped within their day, and overflow remains counted',()=>{
  const events=Array.from({length:200},(_,n)=>({date:'2026-10-14',start:null,title:`部活とセッション${n}`}));
  const {layout,buffer}=calendarImage('2026-10',events,{today:'2026-10-14',selectedDate:'2026-10-14',title:'あすとらるの予定'});
  const day=layout.cells[13];assert.equal(day.hidden,197);assert.equal(day.selected,true);assert.equal(layout.count,200);
  assert.notDeepEqual(calendarImage('2026-10',[{...events[0],title:'部活'}]).buffer,calendarImage('2026-10',[{...events[0],title:'休日'}]).buffer);
  assert.ok(buffer.length<150000);assert.ok(calendarAlt(layout).includes('選択中'));
  assert.doesNotThrow(()=>calendarImage('2026-10',[{date:'2026-10-01',start:null,title:'🪐𠮷'.repeat(40)}]));
});

test('Japanese glyph atlas covers common names without runtime fonts and has bounded offsets',async()=>{
  const {readFile}=await import('node:fs/promises');
  const font=JSON.parse(await readFile(new URL('../assets/calendar-font.json',import.meta.url),'utf8'));
  const atlas=inflateSync(Buffer.from(font.pixels,'base64'),{maxOutputLength:8*1024*1024});
  for(const ch of '予定授業部活休日セッション日本時間…□')assert.ok(font.glyphs[`20:${ch}`],ch);
  for(const g of Object.values(font.glyphs))assert.ok(g.offset>=0&&g.offset+g.w*g.h<=atlas.length);
  assert.ok([...atlas].every(a=>a>=0&&a<=3));
});
