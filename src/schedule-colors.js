import {ScheduleError} from './schedule-errors.js';
export const scheduleColors=Object.freeze({blue:{label:'青',emoji:'🟦',index:0},green:{label:'緑',emoji:'🟩',index:1},red:{label:'赤',emoji:'🟥',index:2},purple:{label:'紫',emoji:'🟪',index:3},yellow:{label:'黄',emoji:'🟨',index:4},slate:{label:'グレー',emoji:'⬜',index:5}});
export const validScheduleColor=value=>typeof value==='string'&&Object.hasOwn(scheduleColors,value);
export function scheduleColor(value){if(value===undefined||value==='auto')return undefined;if(!validScheduleColor(value))throw new ScheduleError('予定の色を選び直してください。');return value;}
