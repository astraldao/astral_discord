import {ScheduleError} from './schedule-errors.js';
import {scheduleRecurrenceOverlapCount,scheduleEventInterval,scheduleIntervalsOverlap} from './schedule-recurrence.js';
import {eventSnapshot} from './schedule-history.js';
const clock=n=>`${String(Math.floor(n%1440/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
export const eventInput=e=>({title:e.title,date:e.date,...(e.endDate?{endDate:e.endDate}:{}),time:e.start===null?'':`${clock(e.start)}${e.end===null?'':`-${clock(e.end)}`}`,place:e.place,description:e.description,...(e.color?{color:e.color}:{})});
export function scheduleShift(calendar,eventIds,days){
  if(!Array.isArray(eventIds)||eventIds.length<1||eventIds.length>26||new Set(eventIds).size!==eventIds.length||!eventIds.every(id=>typeof id==='string')||!Number.isInteger(days)||!days||Math.abs(days)>365)throw new ScheduleError('1〜26件の予定と、0以外の前後365日以内の移動日数を指定してください。');
  const date=value=>{const shifted=new Date(Date.parse(value+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);if(shifted<'2000-01-01'||shifted>'2099-12-31')throw new ScheduleError('移動後の日付は2000〜2099年に収めてください。');return shifted;};
  const changes=eventIds.map(id=>{const e=calendar.events.find(e=>e.id===id);if(!e)throw new ScheduleError('移動対象の予定が変更されました。選び直してください。');const before=eventSnapshot(e),after={...before,date:date(e.date),...(e.endDate?{endDate:date(e.endDate)}:{})};return {before,after};});
  const remaining=calendar.events.filter(e=>!eventIds.includes(e.id));
  const overlaps=scheduleRecurrenceOverlapCount(remaining,changes.map(v=>eventInput(v.after)));
  return {days,changes,overlaps};
}
// Pairwise review is bounded by the existing 200-event calendar limit. A pair
// counts once; end-times are exclusive and missing end-times remain points.
export function scheduleConflicts(calendar){
  const pairs=[],intervals=calendar.events.map(scheduleEventInterval);let total=0;for(let a=0;a<calendar.events.length;a++)for(let b=a+1;b<calendar.events.length;b++)if(scheduleIntervalsOverlap(intervals[a],intervals[b])){total++;if(pairs.length<100)pairs.push([calendar.events[a].id,calendar.events[b].id]);}return {pairs,total};
}
