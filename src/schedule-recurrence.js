import {ScheduleError} from './schedule-errors.js';
import {scheduleDate,scheduleEvent} from './schedule-store.js';

export const MAX_RECURRENCE_COUNT=26;
export const scheduleRecurrenceChoices=Object.freeze({daily:'毎日',weekly:'毎週',biweekly:'隔週',monthly:'毎月'});
const dayMs=86400000;
const clock=minutes=>`${String(Math.floor(minutes%1440/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
const rangeError=()=>new ScheduleError('繰り返し予定は2000年〜2099年の範囲で作成してください。');
function dateAt(milliseconds){
  const value=new Date(milliseconds).toISOString().slice(0,10);
  if(!/^20\d{2}-/.test(value))throw rangeError();
  return scheduleDate(value);
}
function timeInput(event){
  if(event.start===null){if(event.end!==null)throw new ScheduleError('元の予定の時刻が不正です。');return '';}
  if(!Number.isInteger(event.start)||event.start<0||event.start>=1440||event.end!==null&&(!Number.isInteger(event.end)||event.end<=event.start||event.end>=event.start+1440))throw new ScheduleError('元の予定の時刻が不正です。');
  return `${clock(event.start)}${event.end===null?'':`-${clock(event.end)}`}`;
}

// Produce a finite preview only. Saving and authorization belong to the caller;
// there is no scheduler, persistent series state, or mutation of the source event.
export function scheduleRecurrence(event,{frequency,count}={}){
  if(!Object.hasOwn(scheduleRecurrenceChoices,frequency)||!Number.isInteger(count)||count<1||count>MAX_RECURRENCE_COUNT)throw new ScheduleError('繰り返しは毎日・毎週・隔週・毎月、追加回数は1〜26回で選んでください。');
  if(!event||typeof event!=='object'||Array.isArray(event))throw new ScheduleError('元の予定を選び直してください。');
  const date=scheduleDate(event.date),endDate=event.endDate===undefined?date:scheduleDate(event.endDate);
  const firstMs=Date.parse(`${date}T00:00:00Z`),duration=Date.parse(`${endDate}T00:00:00Z`)-firstMs,time=timeInput(event);
  if(duration<0||duration>30*dayMs||duration>0&&event.start!==null)throw new ScheduleError('複数日の繰り返しは終日の予定、31日以内で指定してください。');
  const base=scheduleEvent({title:event.title,date,time,place:event.place,description:event.description,color:event.color});
  const dates=[],inputs=[],first=new Date(firstMs),step=frequency==='daily'?1:frequency==='weekly'?7:14;
  // A monthly search visits at most the 1,200 months of the supported century.
  // The original day is retained, so January 31 never drifts to February 28.
  for(let offset=1;inputs.length<count&&offset<=1200;offset++){
    let startMs;
    if(frequency==='monthly'){
      const candidate=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+offset,first.getUTCDate()));
      if(candidate.getUTCFullYear()>2099)throw rangeError();
      if(candidate.getUTCDate()!==first.getUTCDate())continue;
      startMs=candidate.getTime();
    }else startMs=firstMs+offset*step*dayMs;
    const start=dateAt(startMs),end=dateAt(startMs+duration);
    dates.push(start);
    inputs.push({title:base.title,date:duration?`${start}〜${end}`:start,time,place:base.place,description:base.description,...(base.color?{color:base.color}:{})});
  }
  if(inputs.length!==count)throw rangeError();
  return {frequency,label:scheduleRecurrenceChoices[frequency],count,dates,inputs};
}

function eventInterval(event){
  const midnight=Date.parse(`${event.date}T00:00:00+09:00`)/60000;
  if(event.start===null)return {start:midnight,end:Date.parse(`${event.endDate??event.date}T00:00:00+09:00`)/60000+1440,point:false};
  return {start:midnight+event.start,end:event.end===null?null:midnight+event.end,point:event.end===null};
}
function intervalsOverlap(a,b){
  if(a.point&&b.point)return a.start===b.start;
  if(a.point)return a.start>=b.start&&a.start<b.end;
  if(b.point)return b.start>=a.start&&b.start<a.end;
  return a.start<b.end&&b.start<a.end;
}
// Count candidates, not matching pairs. Unspecified end times are points rather
// than invented durations; spans use [start,end) in absolute Japanese time.
export function scheduleRecurrenceOverlapCount(existingEvents,inputs){
  if(!Array.isArray(existingEvents)||!Array.isArray(inputs)||existingEvents.length>200||inputs.length>MAX_RECURRENCE_COUNT)throw new ScheduleError('重なりを確認する予定を選び直してください。');
  const existing=existingEvents.map(event=>eventInterval(scheduleEvent({title:event.title,date:event.date,endDate:event.endDate,time:timeInput(event),place:event.place,description:event.description})));
  return inputs.map(scheduleEvent).map(eventInterval).filter(candidate=>existing.some(event=>intervalsOverlap(event,candidate))).length;
}

export {eventInterval as scheduleEventInterval,intervalsOverlap as scheduleIntervalsOverlap};
