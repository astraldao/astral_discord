import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,unlink,stat} from 'node:fs/promises';
import {dirname} from 'node:path';
const LIMIT=2*1024*1024;
const id=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(x);
const snowflake=x=>typeof x==='string'&&/^\d{17,20}$/.test(x);
const bounded=(x,max,required=true)=>typeof x==='string'&&x.length<=max&&(!required||!!x.trim())&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(x);
export function scheduleDate(value){
  const m=String(value).trim().match(/^(20\d{2})[-/](\d{2})[-/](\d{2})$/);if(!m)throw new Error('日付は YYYY/MM/DD で入力してください。');
  const [year,month,day]=m.slice(1).map(Number),date=new Date(Date.UTC(year,month-1,day));if(date.getUTCFullYear()!==year||date.getUTCMonth()+1!==month||date.getUTCDate()!==day)throw new Error('存在する日付を入力してください。');return `${m[1]}-${m[2]}-${m[3]}`;
}
export function scheduleEventDates(value,endDate){
  const parts=String(value??'').trim().split(/\s*[〜～~]\s*/u);if(parts.length>2||parts.some(part=>!part))throw new Error('日付は YYYY/MM/DD または YYYY/MM/DD〜YYYY/MM/DD で入力してください。');
  const date=scheduleDate(parts[0]),last=parts.length===2?scheduleDate(parts[1]):endDate===undefined?date:scheduleDate(endDate);
  if(parts.length===2&&endDate!==undefined&&last!==scheduleDate(endDate))throw new Error('終了日を確認してください。');
  const days=(Date.parse(last+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/86400000+1;
  if(days<1||days>31)throw new Error('終了日は開始日以降、期間は31日以内で入力してください。');
  return {date,...(last===date?{}:{endDate:last})};
}
export const scheduleEventEndDate=event=>event.endDate??event.date;
export const scheduleInputDate=event=>event.endDate&&event.endDate!==event.date?`${event.date}〜${event.endDate}`:event.date;
export function scheduleMonth(value){const m=String(value).trim().match(/^(20\d{2})[-/](0[1-9]|1[0-2])$/);if(!m)throw new Error('表示月は YYYY/MM で入力してください。');return `${m[1]}-${m[2]}`;}
export const currentScheduleMonth=(now=Date.now())=>new Date(now+9*3600000).toISOString().slice(0,7);
export function shiftScheduleMonth(month,amount){const date=new Date(`${month}-01T00:00:00Z`);date.setUTCMonth(date.getUTCMonth()+amount);return scheduleMonth(date.toISOString().slice(0,7));}
export function scheduleTime(value){
  if(!String(value).trim())return {start:null,end:null};const m=String(value).trim().match(/^([01]\d|2[0-3]):([0-5]\d)(?:\s*[-〜～–]\s*([01]\d|2[0-3]):([0-5]\d))?$/);if(!m)throw new Error('時刻は HH:MM または HH:MM-HH:MM。空欄は終日です。');
  const start=Number(m[1])*60+Number(m[2]);let end=m[3]===undefined?null:Number(m[3])*60+Number(m[4]);if(end===start)throw new Error('開始と終了は異なる時刻にしてください。');if(end!==null&&end<start)end+=1440;return {start,end};
}
export function scheduleEvent(input){
  const title=String(input.title??'').normalize('NFKC').trim(),place=String(input.place??'').trim(),description=String(input.description??'').trim();if(!bounded(title,80)||/[\r\n]/.test(title)||!bounded(place,100,false)||/[\r\n]/.test(place)||!bounded(description,500,false))throw new Error('予定名80文字、場所100文字、説明500文字以内で入力してください。');
  const dates=scheduleEventDates(input.date,input.endDate),time=scheduleTime(input.time??'');if(dates.endDate&&time.start!==null)throw new Error('複数日の予定は終日です。時刻を空欄にしてください。');
  return {title,...dates,...time,place,description};
}
const validEvent=e=>e&&id(e.id)&&Number.isSafeInteger(e.revision)&&e.revision>=0&&bounded(e.title,80)&&!/[\r\n]/.test(e.title)&&scheduleDate(e.date)===e.date&&(!Object.hasOwn(e,'endDate')||typeof e.endDate==='string'&&scheduleDate(e.endDate)===e.endDate&&e.endDate>e.date&&scheduleEventDates(e.date,e.endDate).endDate===e.endDate&&e.start===null&&e.end===null)&&(e.start===null?e.end===null:Number.isInteger(e.start)&&e.start>=0&&e.start<1440&&(e.end===null||Number.isInteger(e.end)&&e.end>e.start&&e.end<e.start+1440))&&bounded(e.place,100,false)&&!/[\r\n]/.test(e.place)&&bounded(e.description,500,false);
function validate(d){
  if(!d||d.version!==1||!Array.isArray(d.calendars)||d.calendars.length>20)throw new Error('予定表データの形式が不正です。');
  let events=0,pubs=0;const ids=new Set();for(const c of d.calendars){if(!c||!id(c.id)||ids.has(c.id)||!bounded(c.title,60)||/[\r\n]/.test(c.title)||!Number.isSafeInteger(c.revision)||c.revision<0||!Array.isArray(c.events)||c.events.length>200||!c.events.every(validEvent)||new Set(c.events.map(e=>e.id)).size!==c.events.length||!Array.isArray(c.publications)||c.publications.length>5)throw new Error('予定表データの形式が不正です。');ids.add(c.id);events+=c.events.length;pubs+=c.publications.length;
    for(const p of c.publications){if(!p||!id(p.id)||ids.has(p.id)||!snowflake(p.channelId)||scheduleMonth(p.month)!==p.month||!['pending','ready'].includes(p.status)||(p.status==='ready'?!snowflake(p.messageId):p.messageId!==null))throw new Error('予定表の投稿情報が不正です。');ids.add(p.id);}if(new Set(c.publications.map(p=>`${p.channelId}:${p.month}`)).size!==c.publications.length)throw new Error('予定表の投稿情報が重複しています。');
  }if(events>1000||pubs>50)throw new Error('予定表の保存件数が上限を超えています。');return d;
}
export class ScheduleStore {
  constructor(path=null){this.path=path;this.data={version:1,calendars:[]};this.tail=Promise.resolve();}
  async load(){if(!this.path)return this;try{if((await stat(this.path)).size>LIMIT)throw new Error('予定表データが容量上限を超えています。');this.data=validate(JSON.parse(await readFile(this.path,'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}return this;}
  metadata(){return this.data.calendars.map(c=>({id:c.id,title:c.title,revision:c.revision,count:c.events.length,publications:structuredClone(c.publications)}));}
  calendar(id){const c=this.data.calendars.find(c=>c.id===id);if(!c)throw new Error('予定表が見つかりません。');return structuredClone(c);}
  publication(id){for(const c of this.data.calendars){const p=c.publications.find(p=>p.id===id);if(p)return {...structuredClone(p),calendarId:c.id};}throw new Error('この予定表の投稿は終了しています。');}
  update(fn,check=()=>{}){const job=this.tail.then(async()=>{await check();const next=structuredClone(this.data),result=fn(next);validate(next);await this.save(next,check);this.data=next;return result;});this.tail=job.catch(()=>{});return job;}
  async save(data,check=()=>{}){
    if(!this.path){await check();return;}
    const raw=JSON.stringify(data);if(Buffer.byteLength(raw)>LIMIT)throw new Error('予定表は2MiBまでです。');
    const temp=`${this.path}.${randomUUID()}.tmp`,io=promise=>promise.catch(()=>{throw new Error('予定表を保存できませんでした。変更は確定していません。');});
    try{
      await io(mkdir(dirname(this.path),{recursive:true,mode:0o700}));
      await io(writeFile(temp,raw,{flag:'wx',mode:0o600}));
      // Permissions and confirmation can change while filesystem operations wait.
      await check();
      await io(rename(temp,this.path));
    }finally{await unlink(temp).catch(()=>{});}
  }
  create(title,check){title=String(title).normalize('NFKC').trim();return this.update(d=>{const c={id:randomUUID(),title,revision:0,events:[],publications:[]};d.calendars.push(c);return c.id;},check);}
  rename(id,title,revision,check){title=String(title).normalize('NFKC').trim();return this.update(d=>{const c=d.calendars.find(c=>c.id===id);if(!c||c.revision!==revision)throw new Error('予定表が変更されました。開き直してください。');c.title=title;c.revision++;},check);}
  putEvent(calendarId,eventId,input,revision,check){const event=scheduleEvent(input);return this.update(d=>{const c=d.calendars.find(c=>c.id===calendarId);if(!c)throw new Error('予定表が見つかりません。');let e=eventId?c.events.find(e=>e.id===eventId):null;if(eventId&&(!e||e.revision!==revision))throw new Error('予定が変更されました。開き直して編集してください。');if(!e){e={id:randomUUID(),revision:0};c.events.push(e);}else e.revision++;delete e.endDate;Object.assign(e,event);c.revision++;return e.id;},check);}
  putEvents(calendarId,inputs,calendarRevision,check){
    if(!Array.isArray(inputs)||inputs.length<1||inputs.length>26)throw new Error('一括登録は1〜26件で指定してください。');
    const events=inputs.map(scheduleEvent);
    return this.update(d=>{const c=d.calendars.find(c=>c.id===calendarId);if(!c||c.revision!==calendarRevision)throw new Error('予定表が変更されました。内容を確認し直してください。');if(c.events.length+events.length>200||d.calendars.reduce((n,c)=>n+c.events.length,0)+events.length>1000)throw new Error('予定の保存件数が上限を超えています。');const added=events.map(event=>({id:randomUUID(),revision:0,...event}));c.events.push(...added);c.revision++;return added.map(event=>event.id);},check);
  }
  removeEvent(calendarId,eventId,revision,check){return this.update(d=>{const c=d.calendars.find(c=>c.id===calendarId),e=c?.events.find(e=>e.id===eventId);if(!e||e.revision!==revision)throw new Error('予定が変更されました。開き直してください。');c.events=c.events.filter(e=>e.id!==eventId);c.revision++;},check);}
  reserve(calendarId,channelId,month,check){month=scheduleMonth(month);return this.update(d=>{const c=d.calendars.find(c=>c.id===calendarId);if(!c)throw new Error('予定表が見つかりません。');if(c.publications.some(p=>p.channelId===channelId&&p.month===month))throw new Error('このチャンネル・表示月は投稿済み、または送信結果の確認待ちです。「投稿を更新」か「投稿URLで復旧」を使ってください。');const p={id:randomUUID(),channelId,month,status:'pending',messageId:null};c.publications.push(p);return p.id;},check);}
  complete(id,messageId,check){return this.update(d=>{const p=d.calendars.flatMap(c=>c.publications).find(p=>p.id===id);if(!p||p.status!=='pending')throw new Error('この投稿は確認済みです。');p.messageId=messageId;p.status='ready';},check);}
  changeMonth(id,month,revision,check){month=scheduleMonth(month);return this.update(d=>{const c=d.calendars.find(c=>c.publications.some(p=>p.id===id)),p=c?.publications.find(p=>p.id===id);if(!p||p.status!=='ready'||JSON.stringify({...p,calendarId:c.id})!==revision)throw new Error('投稿情報が変更されました。開き直してください。');if(c.publications.some(x=>x.id!==id&&x.channelId===p.channelId&&x.month===month))throw new Error('このチャンネルの表示月はすでに登録されています。');p.month=month;},check);}
  cancelPending(id,revision,check){return this.update(d=>{const c=d.calendars.find(c=>c.publications.some(p=>p.id===id)),p=c?.publications.find(p=>p.id===id);if(!p||p.status!=='pending'||JSON.stringify({...p,calendarId:c.id})!==revision)throw new Error('投稿の状態が変わりました。開き直してください。');c.publications=c.publications.filter(p=>p.id!==id);},check);}
  unpublish(id,revision,check){return this.update(d=>{const c=d.calendars.find(c=>c.publications.some(p=>p.id===id)),p=c?.publications.find(p=>p.id===id);if(!p||p.status!=='ready'||JSON.stringify({...p,calendarId:c.id})!==revision)throw new Error('共有の状態が変わりました。開き直してください。');c.publications=c.publications.filter(p=>p.id!==id);},check);}

}
