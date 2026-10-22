import {randomUUID,createHash} from 'node:crypto';
import {ScheduleError} from './schedule-errors.js';
export const historyLabels={edit:'予定を編集',delete:'予定を削除',color:'色を変更',shift:'日付を一括移動',restore:'履歴から復元'};
export const historyFingerprint=calendar=>createHash('sha256').update(JSON.stringify(calendar.history??[])).digest('hex');
export const eventSnapshot=e=>({id:e.id,revision:e.revision,title:e.title,date:e.date,...(e.endDate?{endDate:e.endDate}:{}),start:e.start,end:e.end,place:e.place,description:e.description,...(e.color?{color:e.color}:{})});
const histories=data=>data.calendars.flatMap(c=>(c.history??[]).map(entry=>({calendar:c,entry})));
const bytes=data=>Buffer.byteLength(JSON.stringify(data.calendars.map(c=>c.history??[])));
export function validScheduleHistory(data,validEvent){
  const ids=new Set();
  for(const c of data.calendars){
    if(c.history===undefined)continue;
    if(!Array.isArray(c.history)||c.history.length>20)return false;
    for(const h of c.history){
      if(!h||typeof h.id!=='string'||! /^[a-zA-Z0-9_-]{1,64}$/.test(h.id)||ids.has(h.id)||typeof h.kind!=='string'||!Object.hasOwn(historyLabels,h.kind)||!Number.isSafeInteger(h.at)||h.at<0||h.at>8e15||h.restored!==undefined&&typeof h.restored!=='boolean'||!Array.isArray(h.before)||!Array.isArray(h.after)||h.before.length<1||h.before.length>26||h.after.length>26||!h.before.every(validEvent)||!h.after.every(validEvent))return false;
      ids.add(h.id);if(new Set(h.before.map(e=>e.id)).size!==h.before.length||new Set(h.after.map(e=>e.id)).size!==h.after.length)return false;
      if(h.kind==='delete'?h.after.length!==0:h.before.length!==h.after.length||h.before.some(e=>!h.after.some(a=>a.id===e.id)))return false;
    }
  }
  const all=histories(data);return all.length<=50&&all.reduce((n,{entry})=>n+entry.before.length+entry.after.length,0)<=500&&bytes(data)<=512*1024;
}
// History is a bounded convenience, not an audit log or a backup. All snapshots
// whitelist event fields; publication metadata, actors and tokens are absent.
export function recordScheduleChange(data,calendar,kind,before,after,now=Date.now()){
  calendar.history??=[];
  calendar.history.push({id:randomUUID(),kind,at:now,before:before.map(eventSnapshot),after:after.map(eventSnapshot)});
  if(calendar.history.length>20)calendar.history.shift();
  while(true){
    const all=histories(data);if(all.length<=50&&all.reduce((n,{entry})=>n+entry.before.length+entry.after.length,0)<=500&&bytes(data)<=512*1024)break;
    const oldest=all.reduce((a,b)=>a.entry.at<=b.entry.at?a:b);oldest.calendar.history.splice(oldest.calendar.history.indexOf(oldest.entry),1);
  }
  // Preserve room for the original calendar data even near its storage limit.
  while(Buffer.byteLength(JSON.stringify(data))>2*1024*1024&&histories(data).length){const all=histories(data),oldest=all.reduce((a,b)=>a.entry.at<=b.entry.at?a:b);oldest.calendar.history.splice(oldest.calendar.history.indexOf(oldest.entry),1);}
}
export function scheduleRestoration(calendar,historyId){
  const h=calendar.history?.find(e=>e.id===historyId);
  if(!h||h.restored||h.kind==='restore')throw new ScheduleError('復元できる履歴を選び直してください。');
  for(const previous of h.before){
    const current=calendar.events.find(e=>e.id===previous.id),expected=h.after.find(e=>e.id===previous.id);
    if(expected?!current||JSON.stringify(eventSnapshot(current))!==JSON.stringify(eventSnapshot(expected)):!!current)throw new ScheduleError('この履歴の後に予定が変更されています。現在の予定を確認してください。');
  }
  if(calendar.events.length+h.before.length-h.after.length>200)throw new ScheduleError('予定は1つの予定表につき200件までです。空きを作ってから復元してください。');
  return {entry:h,events:h.before.map(e=>({...eventSnapshot(e),revision:(calendar.events.find(v=>v.id===e.id)?.revision??e.revision)+1}))};
}
