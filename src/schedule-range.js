import {scheduleDate} from './schedule-store.js';
import {ScheduleError} from './schedule-errors.js';

const DAY=86400000,MIN='2000-01-01',MAX='2099-12-31';
const stamp=date=>Date.parse(`${date}T00:00:00Z`);
const dateAt=time=>new Date(time).toISOString().slice(0,10);
const clip=date=>date<MIN?MIN:date>MAX?MAX:date;
const sunday=date=>stamp(date)-new Date(`${date}T00:00:00Z`).getUTCDay()*DAY;

export function scheduleRange(rangeStart,rangeEnd){
  rangeStart=scheduleDate(rangeStart);rangeEnd=scheduleDate(rangeEnd);
  if(rangeStart>rangeEnd)throw new ScheduleError('表示範囲の開始日と終了日を確認してください。');
  return {rangeStart,rangeEnd};
}

// Calendar dates use UTC arithmetic; callers pass their current Japanese date.
export function scheduleWeek(date){
  const start=sunday(scheduleDate(date));
  return {rangeStart:clip(dateAt(start)),rangeEnd:clip(dateAt(start+6*DAY))};
}

export function shiftScheduleWeek(date,amount){
  if(amount!==-1&&amount!==1)throw new ScheduleError('週の移動方向を確認してください。');
  // Shift the natural Sunday first, so a clipped opening week does not skip a week.
  const target=dateAt(sunday(scheduleDate(date))+amount*7*DAY);
  return scheduleWeek(clip(target));
}

export function scheduleUpcoming(date){
  const rangeStart=scheduleDate(date);
  return {rangeStart,rangeEnd:clip(dateAt(stamp(rangeStart)+29*DAY))};
}
