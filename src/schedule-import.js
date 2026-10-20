import {ScheduleError} from './schedule-errors.js';
import {scheduleEvent} from './schedule-store.js';
import {BoundedBytes} from './bounded-bytes.js';

export const MAX_SCHEDULE_IMPORT_BYTES=256*1024;
export const MAX_SCHEDULE_IMPORT_EVENTS=200;
const DAY=86400000;
const invalid=()=>new ScheduleError('カレンダーファイルの形式を確認してください。UTF-8の.icsを選んでください。');
const unsupported=()=>new ScheduleError('対応していない予定形式があります。繰り返し・取消・期間指定を含めず、通常の予定として書き出してください。');
const textFields=new Set(['SUMMARY','LOCATION','DESCRIPTION']);
const singleFields=new Set(['SUMMARY','DTSTART','DTEND','LOCATION','DESCRIPTION','UID','DTSTAMP','SEQUENCE','STATUS','TRANSP','CLASS','CREATED','LAST-MODIFIED','URL']);
const recurrenceFields=new Set(['RRULE','RDATE','EXRULE','EXDATE','RECURRENCE-ID','DURATION']);
const clock=minutes=>`${String(Math.floor(minutes%1440/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;

function splitQuoted(value,separator){
  const values=[];let quoted=false,start=0;
  for(let n=0;n<value.length;n++){
    if(value[n]==='"')quoted=!quoted;
    else if(value[n]===separator&&!quoted){values.push(value.slice(start,n));start=n+1;}
  }
  if(quoted)throw invalid();values.push(value.slice(start));return values;
}
function property(line){
  let quoted=false,colon=-1;
  for(let n=0;n<line.length;n++){if(line[n]==='"')quoted=!quoted;else if(line[n]===':'&&!quoted){colon=n;break;}}
  if(colon<1||quoted)throw invalid();
  const [rawName,...items]=splitQuoted(line.slice(0,colon),';'),name=rawName.toUpperCase(),params=new Map();
  if(!/^[A-Z0-9-]{1,64}$/.test(name)||items.length>16)throw invalid();
  for(const item of items){
    const equals=item.indexOf('='),key=item.slice(0,equals).toUpperCase();let value=item.slice(equals+1);
    if(equals<1||!value||!/^[A-Z0-9-]{1,64}$/.test(key)||params.has(key))throw invalid();
    if(value.startsWith('"')){if(!value.endsWith('"')||value.length<2||value.slice(1,-1).includes('"'))throw invalid();value=value.slice(1,-1);}
    else if(value.includes('"'))throw invalid();
    params.set(key,value);
  }
  return {name,params,value:line.slice(colon+1)};
}
function unfold(buffer){
  if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>MAX_SCHEDULE_IMPORT_BYTES)throw new ScheduleError('カレンダーファイルは256KiB以内で選んでください。');
  let value;try{value=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw invalid();}
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)||value.replace(/\r\n/g,'').includes('\r'))throw invalid();
  const physical=value.split(/\r?\n/);if(physical.length>10000)throw new ScheduleError('カレンダーファイルの行数が多すぎます。取り込む予定を減らしてください。');
  const lines=[];let parts=[],length=0;
  const finish=()=>{if(parts.length)lines.push(parts.join(''));parts=[];length=0;};
  for(const line of physical){
    if(line.startsWith(' ')||line.startsWith('\t')){if(!parts.length)throw invalid();parts.push(line.slice(1));length+=line.length-1;}
    else {finish();if(!line)continue;parts=[line];length=line.length;}
    if(length>8192)throw new ScheduleError('カレンダーファイルの1項目が長すぎます。予定の内容を短くしてください。');
  }
  finish();return lines;
}
function textValue(p){
  for(const [key,value] of p.params)if(!['LANGUAGE','ALTREP'].includes(key)&&!(key==='VALUE'&&value.toUpperCase()==='TEXT'))throw unsupported();
  const parts=[];for(let n=0;n<p.value.length;n++){const char=p.value[n];if(char!=='\\'){parts.push(char);continue;}const escaped=p.value[++n];if(escaped==='n'||escaped==='N')parts.push('\n');else if(['\\',',',';'].includes(escaped))parts.push(escaped);else throw invalid();}return parts.join('');
}
function temporal(p){
  for(const key of p.params.keys())if(!['VALUE','TZID'].includes(key))throw unsupported();
  const kind=p.params.get('VALUE')?.toUpperCase(),zone=p.params.get('TZID');
  if(zone!==undefined&&zone!=='Asia/Tokyo')throw new ScheduleError('時刻のタイムゾーンはUTCまたはAsia/Tokyoに対応しています。');
  if(kind==='DATE'){
    if(zone!==undefined||!/^\d{8}$/.test(p.value))throw invalid();
    const date=p.value.slice(0,4)+'-'+p.value.slice(4,6)+'-'+p.value.slice(6),ms=Date.parse(date+'T00:00:00Z');
    if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==date)throw invalid();
    return {kind:'date',date,ms};
  }
  if(kind!==undefined&&kind!=='DATE-TIME')throw unsupported();
  const m=p.value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if(!m||zone!==undefined&&m[7]||Number(m[4])>23||Number(m[5])>59||Number(m[6])>59)throw invalid();
  if(m[6]!=='00')throw new ScheduleError('秒単位の予定は取り込めません。開始・終了を分単位にしてください。');
  const day=`${m[1]}-${m[2]}-${m[3]}`,dayMs=Date.parse(day+'T00:00:00Z');
  if(!Number.isFinite(dayMs)||new Date(dayMs).toISOString().slice(0,10)!==day)throw invalid();
  const ms=dayMs+(Number(m[4])*60+Number(m[5]))*60000-(m[7]?0:9*3600000),jst=new Date(ms+9*3600000).toISOString();
  return {kind:'time',ms,date:jst.slice(0,10),minutes:Number(jst.slice(11,13))*60+Number(jst.slice(14,16))};
}
function eventInput(fields){
  if(!fields.has('SUMMARY')||!fields.has('DTSTART'))throw new ScheduleError('すべての予定に、予定名と開始日を設定してください。');
  const start=temporal(fields.get('DTSTART')),end=fields.has('DTEND')?temporal(fields.get('DTEND')):null;
  if(end&&end.kind!==start.kind)throw invalid();
  let date=start.date,time='';
  if(start.kind==='date'){
    if(end){const days=(end.ms-start.ms)/DAY;if(!Number.isInteger(days)||days<1||days>31)throw new ScheduleError('終日の予定は開始日から31日以内の期間にしてください。');const last=new Date(end.ms-DAY).toISOString().slice(0,10);if(last!==date)date+=`〜${last}`;}
  }else{
    time=clock(start.minutes);
    if(end){const minutes=(end.ms-start.ms)/60000;if(!Number.isInteger(minutes)||minutes<=0||minutes>=1440)throw new ScheduleError('時刻付きの予定は、開始後24時間未満の終了にしてください。');time+=`-${clock(end.minutes)}`;}
  }
  const input={title:textValue(fields.get('SUMMARY')),date,time,place:fields.has('LOCATION')?textValue(fields.get('LOCATION')):'',description:fields.has('DESCRIPTION')?textValue(fields.get('DESCRIPTION')):''};
  // Reuse the calendar's canonical bounds, without returning raw ICS values in errors.
  try{scheduleEvent(input);}catch{throw new ScheduleError('取り込む予定は2000〜2099年、予定名80文字・場所100文字・説明500文字以内で指定してください。複数日は終日にしてください。');}
  return input;
}

// A deliberately finite ICS subset: no recurrence expansion, invitations, URL fetches or alarm execution.
export function parseScheduleImport(buffer){
  const lines=unfold(buffer),stack=[],inputs=[];let fields,calendarSeen=false,closed=false,version=false,ignoredProperties=0,ignoredComponents=0;
  const calendarFields=new Set();
  for(const line of lines){
    const p=property(line),context=stack.at(-1);
    if(p.name==='BEGIN'){
      if(p.params.size||closed||stack.length>=4)throw invalid();const component=p.value.toUpperCase();
      if(component==='VCALENDAR'){if(calendarSeen||stack.length)throw invalid();calendarSeen=true;}
      else if(component==='VEVENT'){if(context!=='VCALENDAR'||inputs.length>=MAX_SCHEDULE_IMPORT_EVENTS)throw new ScheduleError('1つのカレンダーから最大200件の通常予定を取り込めます。');fields=new Map();}
      else if(component==='VTIMEZONE'&&context==='VCALENDAR'||component==='VALARM'&&context==='VEVENT'||['STANDARD','DAYLIGHT'].includes(component)&&context==='VTIMEZONE')ignoredComponents++;
      else throw unsupported();
      stack.push(component);continue;
    }
    if(p.name==='END'){
      if(p.params.size||!context||p.value.toUpperCase()!==context)throw invalid();
      stack.pop();if(context==='VEVENT'){inputs.push(eventInput(fields));fields=undefined;}if(context==='VCALENDAR')closed=true;continue;
    }
    if(!context||closed)throw invalid();
    if(context==='VCALENDAR'){
      if(['VERSION','METHOD','CALSCALE','X-WR-TIMEZONE'].includes(p.name)){if(calendarFields.has(p.name)||p.params.size)throw invalid();calendarFields.add(p.name);}
      if(p.name==='VERSION'){if(p.value!=='2.0')throw invalid();version=true;}
      else if(p.name==='METHOD'&&!['PUBLISH','REQUEST'].includes(p.value.toUpperCase())||p.name==='CALSCALE'&&p.value.toUpperCase()!=='GREGORIAN')throw unsupported();
      else if(p.name==='X-WR-TIMEZONE'&&p.value!=='Asia/Tokyo'&&p.value!=='UTC')throw new ScheduleError('時刻のタイムゾーンはUTCまたはAsia/Tokyoに対応しています。');
      else ignoredProperties++;
    }else if(context==='VEVENT'){
      if(recurrenceFields.has(p.name)||p.name==='STATUS'&&(p.params.size||!['CONFIRMED','TENTATIVE'].includes(p.value)))throw unsupported();
      if(singleFields.has(p.name)){if(fields.has(p.name))throw invalid();fields.set(p.name,p);}
      if(!textFields.has(p.name)&&!['DTSTART','DTEND'].includes(p.name))ignoredProperties++;
    }else ignoredProperties++;
  }
  if(stack.length||!calendarSeen||!closed||!version||!inputs.length)throw invalid();
  const warnings=[];
  if(ignoredProperties||ignoredComponents)warnings.push('通知・添付・URL・参加者など、予定名・日時・場所・説明以外の情報は取り込みません。');
  warnings.push('タイムゾーンのない時刻は日本時間として取り込みます。自動同期・繰り返し展開は行いません。');
  return {inputs,eventCount:inputs.length,ignoredProperties,ignoredComponents,warnings};
}

export async function readScheduleAttachment(attachment,{fetcher=fetch,signal}={}){
  signal?.throwIfAborted();
  if(!attachment||!Number.isInteger(attachment.size)||attachment.size<1||attachment.size>MAX_SCHEDULE_IMPORT_BYTES||typeof attachment.name!=='string'||!/\.ics$/i.test(attachment.name))throw new ScheduleError('UTF-8の.icsファイルを1枚、256KiB以内で選んでください。');
  let url;try{url=new URL(attachment.url);}catch{throw new ScheduleError('カレンダーファイルをもう一度アップロードしてください。');}
  const path=url.pathname.match(/^\/(?:ephemeral-)?attachments\/(\d{17,20})\/(\d{17,20})\/[^/]+$/);
  if(url.protocol!=='https:'||url.hostname!=='cdn.discordapp.com'||url.port||url.username||url.password||url.hash||!path||path[2]!==attachment.id)throw new ScheduleError('Discordへアップロードしたカレンダーファイルを選んでください。');
  const timeout=AbortSignal.timeout(10000),abort=signal?AbortSignal.any([signal,timeout]):timeout;let response;
  try{response=await fetcher(url.href,{redirect:'error',signal:abort});}catch{throw new ScheduleError('カレンダーファイルを取得できませんでした。もう一度アップロードしてください。');}
  if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});throw new ScheduleError('カレンダーファイルを取得できませんでした。もう一度アップロードしてください。');}
  const advertised=response.headers.get('content-length');
  if(advertised!==null&&(!/^\d+$/.test(advertised)||!Number.isSafeInteger(Number(advertised))||Number(advertised)>MAX_SCHEDULE_IMPORT_BYTES)){await response.body.cancel().catch(()=>{});throw new ScheduleError('カレンダーファイルの容量を確認できません。256KiB以内でアップロードしてください。');}
  const reader=response.body.getReader(),bytes=new BoundedBytes(MAX_SCHEDULE_IMPORT_BYTES),onAbort=()=>{void reader.cancel().catch(()=>{});};let buffer;
  abort.addEventListener('abort',onAbort,{once:true});
  try{while(true){abort.throwIfAborted();const {done,value}=await reader.read();abort.throwIfAborted();if(done)break;bytes.append(value);}buffer=bytes.finish();if(buffer.length!==attachment.size)throw invalid();}
  catch(error){throw new ScheduleError(error?.code==='RESPONSE_LIMIT'?'カレンダーファイルは256KiB以内で選んでください。':'カレンダーファイルを最後まで取得できませんでした。もう一度アップロードしてください。');}
  finally{abort.removeEventListener('abort',onAbort);bytes.dispose();await reader.cancel().catch(()=>{});reader.releaseLock();}
  return buffer;
}
