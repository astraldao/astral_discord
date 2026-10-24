import {scheduleMonth} from './schedule-store.js';
import {selectedScheduleEvents} from './schedule-query.js';
import {calendarLayout} from './calendar-image.js';
export function scheduleImageOverflow(session,calendar){
  if(session.view!=='list'||session.query||session.date||session.display==='list'||['week','upcoming'].includes(session.period))return [];
  return calendarLayout(session.month,calendar.events).cells.filter(day=>day.hidden>0).map(day=>({date:day.date,hidden:day.hidden}));
}
export function scheduleDays(calendar,month,today,{onlyEvents=false,onlyHidden=false}={}){
  month=scheduleMonth(month);const [year,m]=month.split('-').map(Number),count=new Date(Date.UTC(year,m,0)).getUTCDate();
  const hidden=onlyHidden?new Map(calendarLayout(month,calendar.events).cells.filter(day=>day.hidden>0).map(day=>[day.date,day.hidden])):null;
  return Array.from({length:count},(_,n)=>{
    const date=`${month}-${String(n+1).padStart(2,'0')}`,events=selectedScheduleEvents(calendar,{month,date});
    const weekday=['日','月','火','水','木','金','土'][new Date(`${date}T00:00:00Z`).getUTCDay()];
    const preview=events.slice(0,2).map(e=>e.title).join(' / '),description=`予定 ${events.length}件${hidden?.has(date)?` · 画像では+${hidden.get(date)}件`:''}${preview?` · ${preview}`:''}`;
    let short='';for(const char of description){if(short.length+char.length>97)break;short+=char;}
    return {date,count:events.length,label:`${m}/${n+1}（${weekday}）${date===today?' · 今日':''} · ${events.length}件`,description:description.length<=100?description:short+'…'};
  }).filter(day=>(!onlyEvents||day.count)&&(!onlyHidden||hidden.has(day.date)));
}
