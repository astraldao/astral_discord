const text=value=>String(value??'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const stamp=date=>date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
const utc=(date,minutes)=>new Date(Date.parse(`${date}T00:00:00+09:00`)+minutes*60000);
const nextDate=date=>new Date(Date.parse(`${date}T00:00:00Z`)+86400000).toISOString().slice(0,10).replace(/-/g,'');

// RFC 5545 folds at 75 octets, including the continuation space, without
// splitting a UTF-8 code point. No executable fields, invites or subscriptions.
export function foldCalendarLine(line){
  const lines=[];let part='',bytes=0;
  for(const char of line){const size=Buffer.byteLength(char);if(bytes+size>75){lines.push(part);part=' ';bytes=1;}part+=char;bytes+=size;}
  lines.push(part);return lines.join('\r\n');
}

export function scheduleExport(calendar,events,{now=Date.now()}={}){
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Astral Discord//Schedule//JA','CALSCALE:GREGORIAN',`X-WR-CALNAME:${text(calendar.title)}`];
  for(const event of events){
    lines.push('BEGIN:VEVENT',`UID:${calendar.id}.${event.id}@astral.local`,`DTSTAMP:${stamp(new Date(now))}`,`SEQUENCE:${event.revision}`,`SUMMARY:${text(event.title)}`);
    if(event.start===null)lines.push(`DTSTART;VALUE=DATE:${event.date.replace(/-/g,'')}`,`DTEND;VALUE=DATE:${nextDate(event.endDate??event.date)}`);
    else {lines.push(`DTSTART:${stamp(utc(event.date,event.start))}`);if(event.end!==null)lines.push(`DTEND:${stamp(utc(event.date,event.end))}`);}
    if(event.place)lines.push(`LOCATION:${text(event.place)}`);
    if(event.description)lines.push(`DESCRIPTION:${text(event.description)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const buffer=Buffer.from(`${lines.map(foldCalendarLine).join('\r\n')}\r\n`,'utf8');
  if(buffer.length>2*1024*1024)throw new Error('カレンダーファイルが容量上限を超えています。');
  return buffer;
}
