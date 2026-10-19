const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s+/gu,' ').trim();

export function scheduleQuery(value){
  const query=normalize(value);
  if(query.length>80||/[\p{Cc}\p{Cf}]/u.test(query))throw new Error('検索語は80文字以内で入力してください。');
  return query;
}

// Search stays inside one authorized calendar. Spaces combine terms with AND.
export function selectedScheduleEvents(calendar,{month,date,query}={}){
  const terms=scheduleQuery(query).split(' ').filter(Boolean);
  return calendar.events.filter(event=>{
    if(terms.length){const text=normalize([event.title,event.place,event.description].join(' '));return terms.every(term=>text.includes(term));}
    return (!month||event.date.startsWith(`${month}-`))&&(!date||event.date===date);
  }).sort((a,b)=>a.date.localeCompare(b.date)||(a.start??-1)-(b.start??-1)||a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
}
