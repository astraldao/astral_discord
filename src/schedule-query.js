import {scheduleRange} from './schedule-range.js';
import {ScheduleError} from './schedule-errors.js';
const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s+/gu,' ').trim();

export function scheduleQuery(value){
  const query=normalize(value);
  if(query.length>80||/[\p{Cc}\p{Cf}]/u.test(query))throw new ScheduleError('検索語は80文字以内で入力してください。');
  return query;
}

// Search stays inside one authorized calendar. Spaces combine terms with AND.
export function selectedScheduleEvents(calendar,{month,date,query,rangeStart,rangeEnd}={}){
  const terms=scheduleQuery(query).split(' ').filter(Boolean);
  const range=!terms.length&&(rangeStart!==undefined||rangeEnd!==undefined)?scheduleRange(rangeStart,rangeEnd):null;
  return calendar.events.filter(event=>{
    if(terms.length){const text=normalize([event.title,event.place,event.description].join(' '));return terms.every(term=>text.includes(term));}
    if(range){
      // A midnight end belongs only to the previous date; a later end overlaps the next date.
      const last=event.endDate??(event.end>1440?new Date(Date.parse(`${event.date}T00:00:00Z`)+86400000).toISOString().slice(0,10):event.date);
      return event.date<=range.rangeEnd&&last>=range.rangeStart;
    }
    const end=event.endDate??event.date;
    return (!month||event.date.slice(0,7)<=month&&end.slice(0,7)>=month)&&(!date||event.date<=date&&end>=date);
  }).sort((a,b)=>a.date.localeCompare(b.date)||(a.start??-1)-(b.start??-1)||a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
}
