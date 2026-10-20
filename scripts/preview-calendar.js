import {writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {calendarImage} from '../src/calendar-image.js';
import {scheduleEvent} from '../src/schedule-store.js';

// Fictional data only; this command does not read saved calendars or contact Discord.
const samples=[
  ['休日','2026-10-01〜2026-10-03'],['部活','2026-10-05'],['部活','2026-10-08'],
  ['秋休み','2026-10-11〜2026-10-17'],['連日のイベント','2026-10-14〜2026-10-16'],
  ['部活','2026-10-14'],['予定の確認','2026-10-14'],['参加する','2026-10-19'],
  ['休日','2026-10-30〜2026-11-02'],
];
const events=samples.map(([title,date],n)=>({id:`example-${n}`,revision:0,...scheduleEvent({title,date,time:'',place:'',description:''})}));
const result=calendarImage('2026-10',events,{today:'2026-10-14',selectedDate:'2026-10-14',title:'あすとらるの予定表'});
const target=process.argv[2]??'docs/previews/calendar-v4.png';
await mkdir(dirname(target),{recursive:true});await writeFile(target,result.buffer);
process.stdout.write(`${target}: ${result.width}x${result.height}, ${events.length} fictional events, ${result.buffer.length} bytes\n`);
