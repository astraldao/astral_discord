import {writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {calendarImage} from '../src/calendar-image.js';
import {scheduleEvent} from '../src/schedule-store.js';

// Fictional data only; this command does not read saved calendars or contact Discord.
const dense=[
  ['休日','2026-10-01〜2026-10-03'],['部活','2026-10-05'],['部活','2026-10-08'],
  ['秋休み','2026-10-11〜2026-10-17'],['連日のイベント','2026-10-14〜2026-10-16'],
  ['部活','2026-10-14'],['予定の確認','2026-10-14'],['参加する','2026-10-19'],
  ['休日','2026-10-30〜2026-11-02'],
];
const sparse=[['初めてのゲーム会','2026-10-15','20:00','slate'],['定例会','2026-10-16','21:00','red'],['遊ぶ','2026-10-17','','blue'],['定例会','2026-10-18','21:00','red'],['オンライン交流セッション','2026-10-21','20:30','yellow'],['オンライン交流セッション','2026-10-22','20:30','yellow'],['あそぶ','2026-10-26','','green']];
const november=Array.from({length:4},(_,n)=>['定例の卓',`2026-11-0${n+4}`,'','blue']);
const variant=process.argv[3]??'dense';if(!['dense','sparse','november'].includes(variant))throw new Error('Preview variant must be dense, sparse or november.');
const samples=variant==='sparse'?sparse:variant==='november'?november:dense,month=variant==='november'?'2026-11':'2026-10';
const colors=['blue','green','green','red','purple','green','yellow','slate','blue'];
const events=samples.map((sample,n)=>{const [title,date,time='',color=colors[n]]=sample;return {id:`example-${n}`,revision:0,...scheduleEvent({title,date,time,place:'',description:'',color})};});
const result=calendarImage(month,events,{today:'2026-10-14',selectedDate:variant==='dense'?'2026-10-14':undefined,title:'あすとらるの予定表'});
const target=process.argv[2]??'docs/previews/calendar-v4_4.png';
await mkdir(dirname(target),{recursive:true});await writeFile(target,result.buffer);
process.stdout.write(`${target}: ${result.width}x${result.height}, ${events.length} fictional events, ${result.buffer.length} bytes\n`);
