import test from 'node:test';
import assert from 'node:assert/strict';
import {ScheduleStore,scheduleEvent} from '../src/schedule-store.js';
import {scheduleExport} from '../src/schedule-export.js';
import {parseScheduleImport,readScheduleAttachment,MAX_SCHEDULE_IMPORT_BYTES} from '../src/schedule-import.js';

const item=(extra={})=>({title:'定例卓',date:'2026-10-20',time:'20:00-23:00',place:'VC',description:'説明',...extra});
const event=(lines='SUMMARY:予定\r\nDTSTART:20261020T110000Z')=>'BEGIN:VEVENT\r\n'+lines+'\r\nEND:VEVENT';
const calendar=(events=event(),extra='')=>Buffer.from('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'+extra+(extra?'\r\n':'')+events+'\r\nEND:VCALENDAR\r\n');
const attachment=buffer=>({id:'345678901234567890',size:buffer.length,name:'schedule.ics',url:'https://cdn.discordapp.com/attachments/234567890123456789/345678901234567890/schedule.ics?ex=valid'});

test('the bot calendar export round-trips single, all-day, period, overnight and missing-end events',async()=>{
  const store=new ScheduleStore(),id=await store.create('予定表'),values=[item(),item({date:'2028-02-29',time:''}),item({date:'2026-12-30〜2027-01-02',time:''}),item({time:'23:00-01:00'}),item({time:'00:15'}),item({date:'2000-01-01',time:'00:15'}),item({date:'2099-12-31',time:'23:00-01:00'})];
  for(const value of values)await store.putEvent(id,null,value);const c=store.calendar(id),parsed=parseScheduleImport(scheduleExport(c,c.events));
  assert.equal(parsed.eventCount,values.length);assert.deepEqual(parsed.inputs.map(scheduleEvent),values.map(scheduleEvent));
});
test('UTF-8 folded and escaped text round-trips without content-line injection',async()=>{
  const store=new ScheduleStore(),id=await store.create('予定表'),value=item({title:'界😀,;\\'.repeat(8),description:'説明\nBEGIN:VALARM\nATTACH:https://private.example/secret\n終わり;値,\\'});await store.putEvent(id,null,value);const c=store.calendar(id);
  const result=parseScheduleImport(scheduleExport(c,c.events));assert.deepEqual(result.inputs.map(scheduleEvent),[scheduleEvent(value)]);assert.equal(result.ignoredComponents,0);assert.ok(!result.warnings.some(v=>v.includes('private.example')));
});
test('floating time is interpreted as JST and an explicitly quoted Tokyo TZID has the same result',()=>{
  for(const suffix of ['', ';TZID=Asia/Tokyo',';TZID="Asia/Tokyo"']){
    const value=parseScheduleImport(calendar(event(`SUMMARY:予定\r\nDTSTART${suffix}:20261020T200000\r\nDTEND${suffix}:20261020T230000`))).inputs[0];assert.equal(value.time,'20:00-23:00');assert.equal(value.date,'2026-10-20');
  }
});
test('all-day exclusive end dates preserve the final date, including the supported century boundary',()=>{
  const inputs=parseScheduleImport(calendar([event('SUMMARY:連休\r\nDTSTART;VALUE=DATE:20261030\r\nDTEND;VALUE=DATE:20261103'),event('SUMMARY:年末\r\nDTSTART;VALUE=DATE:20991231\r\nDTEND;VALUE=DATE:21000101')].join('\r\n'))).inputs;
  assert.equal(inputs[0].date,'2026-10-30〜2026-11-02');assert.equal(inputs[0].time,'');assert.equal(inputs[1].date,'2099-12-31');
});
test('timezone definitions and alarm components are bounded metadata and never become imported actions',()=>{
  const timezone='BEGIN:VTIMEZONE\r\nTZID:Asia/Tokyo\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0900\r\nTZOFFSETTO:+0900\r\nRRULE:FREQ=YEARLY\r\nEND:STANDARD\r\nEND:VTIMEZONE';
  const alarm='BEGIN:VALARM\r\nTRIGGER:-PT10M\r\nACTION:DISPLAY\r\nDESCRIPTION:PRIVATE_ALARM\r\nATTACH:https://private.example/audio\r\nEND:VALARM';
  const result=parseScheduleImport(calendar(timezone+'\r\n'+event('SUMMARY:予定\r\nDTSTART;TZID=Asia/Tokyo:20261020T200000\r\n'+alarm)));
  assert.equal(result.eventCount,1);assert.equal(result.ignoredComponents,3);assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.ok(!JSON.stringify(result).includes('private.example'));assert.ok(result.warnings.some(v=>v.includes('通知')));
});
test('unsupported recurrence, durations and cancellation reject the whole file',()=>{
  for(const field of ['RRULE:FREQ=DAILY','RDATE:20261021T110000Z','EXDATE:20261021T110000Z','EXRULE:FREQ=DAILY','RECURRENCE-ID:20261020T110000Z','DURATION:PT1H','STATUS:CANCELLED'])assert.throws(()=>parseScheduleImport(calendar(event()+'\r\n'+event('SUMMARY:予定\r\nDTSTART:20261020T110000Z\r\n'+field))),/対応/);
  assert.throws(()=>parseScheduleImport(calendar(event(),'METHOD:CANCEL')),/対応/);
  assert.equal(parseScheduleImport(calendar(event(),'METHOD:REQUEST')).eventCount,1);
});
test('event status accepts only explicit confirmed or tentative tokens and never turns cancelled or unknown status into an active event',()=>{
  for(const value of ['CONFIRMED','TENTATIVE'])assert.equal(parseScheduleImport(calendar(event('SUMMARY:予定\r\nDTSTART:20261020T110000Z\r\nSTATUS:'+value))).eventCount,1);
  for(const value of ['CANCELLED','CANCELLED ','CANCELLED\t',' CONFIRMED','CONFIRMED ','TENTATIVE\t','','PRIVATE'])assert.throws(()=>parseScheduleImport(calendar(event('SUMMARY:予定\r\nDTSTART:20261020T110000Z\r\nSTATUS:'+value))),error=>!error.message.includes('PRIVATE'));
  for(const params of [';VALUE=TEXT',';LANGUAGE=ja'])assert.throws(()=>parseScheduleImport(calendar(event('SUMMARY:予定\r\nDTSTART:20261020T110000Z\r\nSTATUS'+params+':CONFIRMED'))));
});
test('invalid temporal forms, seconds and unsupported zones fail without returning raw values',()=>{
  const starts=['20260229T110000Z','20260431T110000Z','20260001T110000Z','20261020T240000Z','20261020T116000Z','20261020T110001Z','20261020','19990101T110000Z','21000101T110000Z'];
  for(const value of starts)assert.throws(()=>parseScheduleImport(calendar(event(`SUMMARY:予定\r\nDTSTART:${value}`))));
  for(const field of ['DTSTART;TZID=America/New_York:20261020T200000','DTSTART;TZID=Asia/Tokyo:20261020T110000Z','DTSTART;VALUE=DATE;TZID=Asia/Tokyo:20261020','DTSTART;VALUE=PRIVATE:20261020T110000Z'])assert.throws(()=>parseScheduleImport(calendar(event('SUMMARY:予定\r\n'+field))));
});
test('end dates must have matching kinds and representable positive intervals',()=>{
  for(const fields of ['DTSTART:20261020T110000Z\r\nDTEND:20261020T110000Z','DTSTART:20261020T110000Z\r\nDTEND:20261020T100000Z','DTSTART:20261020T110000Z\r\nDTEND:20261021T110000Z','DTSTART:20261020T110000Z\r\nDTEND;VALUE=DATE:20261021','DTSTART;VALUE=DATE:20261020\r\nDTEND;VALUE=DATE:20261020','DTSTART;VALUE=DATE:20261001\r\nDTEND;VALUE=DATE:20261102'])assert.throws(()=>parseScheduleImport(calendar(event('SUMMARY:予定\r\n'+fields))));
});
test('malformed structure, missing mandatory fields and duplicate singleton properties fail closed',()=>{
  const malformed=[Buffer.from('BEGIN:VCALENDAR\r\n'+event()+'\r\nEND:VCALENDAR'),calendar(''),Buffer.concat([calendar(),calendar()]),calendar(event().replace('END:VEVENT','END:VALARM')),calendar(event('SUMMARY:予定')),calendar(event('DTSTART:20261020T110000Z')),calendar(event('SUMMARY:予定\r\nSUMMARY:別\r\nDTSTART:20261020T110000Z')),calendar(event('SUMMARY:予定\r\nDTSTART:20261020T110000Z\r\nUID:a\r\nUID:b')),calendar(event(),'VERSION:2.0'),calendar('BEGIN:VTODO\r\nEND:VTODO')];
  for(const buffer of malformed)assert.throws(()=>parseScheduleImport(buffer));
});
test('bad text escapes, text parameters, multiline names and over-limit fields are rejected',()=>{
  for(const fields of ['SUMMARY:bad\\x\r\nDTSTART:20261020T110000Z','SUMMARY:bad\\\r\nDTSTART:20261020T110000Z','SUMMARY:bad\\nname\r\nDTSTART:20261020T110000Z','SUMMARY;ENCODING=BASE64:PRIVATE\r\nDTSTART:20261020T110000Z','SUMMARY:'+ 'x'.repeat(81)+'\r\nDTSTART:20261020T110000Z','SUMMARY:予定\r\nDTSTART:20261020T110000Z\r\nDESCRIPTION:'+ 'x'.repeat(501)])assert.throws(()=>parseScheduleImport(calendar(event(fields))));
});
test('maximum event count is accepted but the first excess event rejects the entire file',()=>{
  const values=Array.from({length:200},()=>event()).join('\r\n');assert.equal(parseScheduleImport(calendar(values)).eventCount,200);assert.throws(()=>parseScheduleImport(calendar(values+'\r\n'+event())),/200件/);
});
test('byte, UTF-8, line, unfolded-field and component limits bound parser work',()=>{
  for(const buffer of [Buffer.alloc(MAX_SCHEDULE_IMPORT_BYTES+1),Buffer.from([0xff,0xfe]),Buffer.from('BEGIN:VCALENDAR\u0000'),Buffer.from('BEGIN:VCALENDAR\rBAD'),Buffer.from(' '+calendar().toString()),calendar(event(),'X-PRIVATE:'+ 'x'.repeat(8193)),Buffer.from('BEGIN:VCALENDAR\nVERSION:2.0\n'+'X-TEST:a\n'.repeat(10000)+'END:VCALENDAR\n')])assert.throws(()=>parseScheduleImport(buffer));
});
test('metadata containing URLs, attendees or private payloads is not copied into the import result',()=>{
  const result=parseScheduleImport(calendar(event('SUMMARY:予定\r\nDTSTART:20261020T110000Z\r\nURL:https://private.example\r\nATTACH;VALUE=URI:https://private.example/file\r\nATTENDEE:mailto:private@example.com\r\nX-PRIVATE:PRIVATE_TEXT')));
  assert.deepEqual(Object.keys(result.inputs[0]),['title','date','time','place','description']);assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.ok(!JSON.stringify(result).includes('private.example'));assert.ok(result.ignoredProperties>=4);
});
test('parsing preserves the uploaded bytes and does not retain mutable input storage',()=>{
  const bytes=calendar(),original=Buffer.from(bytes),result=parseScheduleImport(bytes);assert.deepEqual(bytes,original);bytes.fill(0);assert.equal(result.inputs[0].title,'予定');
});

test('attachments only fetch matching Discord CDN HTTPS file URLs with redirects disabled',async()=>{
  const bytes=calendar(),a=attachment(bytes);let calls=0;
  const result=await readScheduleAttachment(a,{fetcher:async(url,options)=>{calls++;assert.equal(url,a.url);assert.equal(options.redirect,'error');assert.ok(options.signal);return new Response(bytes);}});assert.deepEqual(result,bytes);assert.equal(calls,1);
  for(const url of ['http://cdn.discordapp.com/attachments/234567890123456789/345678901234567890/schedule.ics','https://evil.example/attachments/234567890123456789/345678901234567890/schedule.ics','https://cdn.discordapp.com:444/attachments/234567890123456789/345678901234567890/schedule.ics','https://user@cdn.discordapp.com/attachments/234567890123456789/345678901234567890/schedule.ics','https://cdn.discordapp.com/attachments/234567890123456789/999999999999999999/schedule.ics',a.url+'#fragment'])await assert.rejects(readScheduleAttachment({...a,url},{fetcher:()=>{throw new Error('must not fetch');}}));
});
test('invalid attachment metadata is rejected before fetching and errors never echo private native details',async()=>{
  const bytes=calendar(),a=attachment(bytes);for(const extra of [{name:'file.exe'},{name:'file.ics.exe'},{name:null},{size:0},{size:1.5},{size:MAX_SCHEDULE_IMPORT_BYTES+1}])await assert.rejects(readScheduleAttachment({...a,...extra},{fetcher:()=>{throw new Error('must not fetch');}}));
  await assert.rejects(readScheduleAttachment(a,{fetcher:async()=>{throw new Error('PRIVATE_TOKEN /private/path');}}),error=>!error.message.includes('PRIVATE')&&!error.message.includes('/private'));
});
test('bad HTTP, redirect, declared length and mismatched sizes never return a partial attachment',async()=>{
  const bytes=calendar(),a=attachment(bytes);for(const response of [new Response('',{status:403}),new Response(null,{status:302,headers:{location:'https://evil.example'}}),new Response(bytes,{headers:{'content-length':'bad'}}),new Response(bytes,{headers:{'content-length':String(MAX_SCHEDULE_IMPORT_BYTES+1)}}),new Response(Buffer.from('partial'))])await assert.rejects(readScheduleAttachment(a,{fetcher:async()=>response}));
});
test('fragmented response bytes are collected correctly and the stream lock is released',async()=>{
  const bytes=calendar();let offset=0;const stream=new ReadableStream({pull(controller){if(offset===bytes.length)controller.close();else controller.enqueue(bytes.subarray(offset,++offset));}}),response=new Response(stream);
  assert.deepEqual(await readScheduleAttachment(attachment(bytes),{fetcher:async()=>response}),bytes);assert.equal(stream.locked,false);
});
test('a response exceeding the byte bound is cancelled during receipt even when its declared size lies',async()=>{
  let cancelled=0,chunk=0;const stream=new ReadableStream({pull(controller){chunk++;controller.enqueue(new Uint8Array(65536));},cancel(){cancelled++;}});
  await assert.rejects(readScheduleAttachment({...attachment(calendar()),size:1},{fetcher:async()=>new Response(stream,{headers:{'content-length':'1'}})}),/256KiB/);assert.equal(cancelled,1);assert.equal(stream.locked,false);assert.ok(chunk<=6);
});
test('aborting a stalled response cancels its pending read and releases its stream',async()=>{
  const abort=new AbortController();let cancelled=0;const stream=new ReadableStream({cancel(){cancelled++;}}),response=new Response(stream);let fetched;
  const started=new Promise(r=>fetched=r),task=readScheduleAttachment(attachment(calendar()),{signal:abort.signal,fetcher:async()=>{fetched();return response;}});await started;await new Promise(r=>setImmediate(r));abort.abort();await assert.rejects(task);assert.equal(cancelled,1);assert.equal(stream.locked,false);
});
