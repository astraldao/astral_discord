import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {encodePng} from './sprite-image.js';
import {scheduleColors,validScheduleColor} from './schedule-colors.js';
const font=JSON.parse(readFileSync(new URL('../assets/calendar-font.json',import.meta.url),'utf8'));
const atlas=inflateSync(Buffer.from(font.pixels,'base64'),{maxOutputLength:8*1024*1024});
const theme={paper:[255,255,255],ink:[38,43,49],muted:[118,125,132],line:[232,235,238],weekend:[250,251,252],selected:[234,246,253],today:[38,43,49],sunday:[201,70,78],saturday:[43,111,177],white:[255,255,255]};
const bands=[[208,239,252],[210,244,229],[255,223,222],[233,223,251],[255,239,202],[223,233,244]];
const backgrounds=[...Object.values(theme),...bands];
const foregrounds=[theme.ink,theme.muted,theme.white,theme.sunday,theme.saturday];
const colors=[...backgrounds,...backgrounds.flatMap(a=>foregrounds.flatMap(b=>[1,2].map(n=>a.map((v,i)=>Math.round((v*(3-n)+b[i]*n)/3)))))];
const palette=Buffer.from(colors.flat()),lookup=Buffer.alloc(32768);
for(let i=0;i<colors.length;i++){const [r,g,b]=colors[i];lookup[((r>>3)<<10)|((g>>3)<<5)|(b>>3)]=i;}
const glyph=(char,size)=>font.glyphs[`${size===16?20:size}:${char}`]??font.glyphs[`${size===16?20:size}:□`];
const advance=(char,size)=>Math.round((glyph(char,size)?.advance??size)*(size===16?0.8:1));
const measure=(value,size)=>[...value].reduce((n,c)=>n+advance(c,size),0);
// Explicit choices take priority; automatic colors stay stable for the same title.
function calendarEventColor(event){if(validScheduleColor(event.color))return scheduleColors[event.color].index;let hash=0;for(const c of String(event.title))hash=(Math.imul(hash,31)+c.codePointAt(0))>>>0;return hash%bands.length;}
export function calendarLayout(month,events,today,selectedDate){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||Number(month.slice(0,4))<2000||Number(month.slice(0,4))>2099)throw new Error('カレンダーの月が不正です。');
  const year=Number(month.slice(0,4)),m=Number(month.slice(5)),days=new Date(Date.UTC(year,m,0)).getUTCDate(),offset=new Date(Date.UTC(year,m-1,1)).getUTCDay();
  const last=`${month}-${String(days).padStart(2,'0')}`,visible=events.filter(e=>e.date<=last&&(e.endDate??e.date)>=`${month}-01`);
  const cells=Array.from({length:days},(_,n)=>{const date=`${month}-${String(n+1).padStart(2,'0')}`,items=visible.filter(e=>e.date<=date&&(e.endDate??e.date)>=date).sort((a,b)=>(a.start??-1)-(b.start??-1)||a.title.localeCompare(b.title));return {day:n+1,date,row:Math.floor((offset+n)/7),col:(offset+n)%7,today:date===today,selected:date===selectedDate,items,hidden:items.length};});
  const rows=Math.ceil((offset+days)/7),spans=[];
  for(let row=0;row<rows;row++){
    const week=cells.filter(c=>c.row===row),occupied=[0,0,0];
    const segments=visible.flatMap(event=>{const covered=week.filter(c=>event.date<=c.date&&(event.endDate??event.date)>=c.date);if(!covered.length)return [];return [{event,row,col:covered[0].col,endCol:covered.at(-1).col,continuesBefore:event.date<covered[0].date,continuesAfter:(event.endDate??event.date)>covered.at(-1).date}];}).sort((a,b)=>(b.endCol-b.col)-(a.endCol-a.col)||a.col-b.col||(a.event.start??-1)-(b.event.start??-1)||a.event.title.localeCompare(b.event.title)||String(a.event.id??'').localeCompare(String(b.event.id??'')));
    for(const segment of segments){const mask=((1<<(segment.endCol-segment.col+1))-1)<<segment.col,lane=occupied.findIndex(bits=>!(bits&mask));if(lane===-1)continue;occupied[lane]|=mask;spans.push({...segment,lane});for(const c of week)if(c.col>=segment.col&&c.col<=segment.endCol)c.hidden--;}
  }
  return {month,rows,offset,cells,spans,count:visible.length};
}
function titleLines(value,maxWidth){
  const lines=[''];let used=0;for(const char of String(value).replace(/[\r\n\t]/g,' ')){const step=advance(char,20);if(used+step>maxWidth&&lines.at(-1)){lines.push('');used=0;}lines[lines.length-1]+=char;used+=step;}return lines;
}
const time=n=>n==null?'終日':`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
export function calendarImage(month,events,{today,selectedDate,title=''}={}){
  const layout=calendarLayout(month,events,today,selectedDate),width=840,cell=116,top=118;
  const lanes=layout.spans.reduce((n,span)=>Math.max(n,span.lane+1),0),rich=lanes<=1;
  const timed=rich&&layout.spans.some(span=>Number.isInteger(span.event.start)),wrapped=rich&&layout.spans.some(span=>measure(span.event.title,20)>(span.endCol-span.col+1)*cell-14);
  const bandTop=40,bandHeight=rich?(wrapped?45:25)+(timed?18:0):25,laneGap=28,week=rich?bandTop+bandHeight+15:142;
  // Only expand titles actually shortened in a visible card. Object identity keeps
  // distinct same-title events separate while deduplicating week-crossing spans.
  const shortened=[...new Set(layout.spans.filter(span=>titleLines(span.event.title,(span.endCol-span.col+1)*cell-14).length>(wrapped?2:1)).map(span=>span.event))].sort((a,b)=>a.date.localeCompare(b.date)||(a.start??-1)-(b.start??-1)||a.title.localeCompare(b.title));
  const titleKey=shortened.slice(0,8).map(event=>({event,lines:titleLines(event.title,680)}));
  const keyHeight=titleKey.length?34+titleKey.reduce((n,item)=>n+Math.max(44,item.lines.length*24+8),0)+(shortened.length>8?26:0):0;
  const footer=timed?52:38,height=top+layout.rows*week+keyHeight+footer,pixels=Buffer.alloc(width*height*4,255);
  function rect(x,y,w,h,color){for(let j=Math.max(0,y);j<Math.min(height,y+h);j++)for(let i=Math.max(0,x);i<Math.min(width,x+w);i++){const at=(j*width+i)*4;for(let c=0;c<3;c++)pixels[at+c]=color[c];}}
  function circle(x,y,r,color){for(let j=-r;j<=r;j++)for(let i=-r;i<=r;i++)if(i*i+j*j<=r*r)rect(x+i,y+j,1,1,color);}
  function text(value,x,y,size,color,maxWidth=width-x){
    x=Math.round(x);y=Math.round(y);const left=x,right=Math.min(width-14,x+maxWidth),scale=size===16?0.8:1;
    const valueText=String(value).replace(/[\r\n\t]/g,' '),chars=[...valueText];let result=valueText,used=0;
    if(measure(valueText,size)>maxWidth){result='';for(const char of chars){const step=advance(char,size);if(used+step+measure('…',size)>maxWidth)break;result+=char;used+=step;}result+='…';}
    for(const char of result){const g=glyph(char,size);if(!g){x+=size;continue;}for(let j=0;j<Math.ceil(g.h*scale);j++)for(let i=0;i<Math.ceil(g.w*scale);i++){const alpha=atlas[g.offset+Math.min(g.h-1,Math.floor(j/scale))*g.w+Math.min(g.w-1,Math.floor(i/scale))];if(!alpha)continue;const px=x+Math.round(g.x*scale)+i,py=y+Math.round(g.y*scale)+j;if(px<left||py<0||px>=right||py>=height)continue;const at=(py*width+px)*4;for(let c=0;c<3;c++)pixels[at+c]=Math.round((pixels[at+c]*(3-alpha)+color[c]*alpha)/3);}x+=advance(char,size);}
  }
  function eventTitle(value,x,y,maxWidth){
    const clean=String(value).replace(/[\r\n\t]/g,' ');if(!wrapped||measure(clean,20)<=maxWidth){text(clean,x,y,20,theme.ink,maxWidth);return;}
    const lines=titleLines(clean,maxWidth);text(lines[0],x,y,20,theme.ink,maxWidth);text(lines.slice(1).join(''),x,y+22,20,theme.ink,maxWidth);
  }
  text(`${month.slice(0,4)}年${Number(month.slice(5))}月`,22,8,28,theme.ink);
  const count=`予定 ${layout.count}件`;text(count,width-22-measure(count,20),18,20,theme.muted);
  text(title||'月間カレンダー',22,49,20,theme.muted,width-44);
  ['日','月','火','水','木','金','土'].forEach((day,n)=>text(day,14+n*cell+(cell-20)/2,86,20,n===0?theme.sunday:n===6?theme.saturday:theme.muted));
  for(let row=0;row<layout.rows;row++){
    const y=top+row*week;
    for(let col=0;col<7;col++){
      const x=14+col*cell,c=layout.cells.find(c=>c.row===row&&c.col===col);
      rect(x,y,cell,week,c?.selected?theme.selected:col===0||col===6?theme.weekend:theme.paper);
      rect(x,y,cell,1,theme.line);
      if(!c){const day=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5))-1,row*7+col-layout.offset+1)).getUTCDate();text(String(day),x+(cell-measure(String(day),20))/2,y+2,20,theme.muted);continue;}
      if(c.today)circle(x+cell/2,y+19,15,theme.today);
      const day=String(c.day);text(day,x+(cell-measure(day,20))/2,y+2,20,c.today?theme.white:col===0?theme.sunday:col===6?theme.saturday:theme.ink);
      if(c.selected)rect(x+4,y+1,cell-8,3,theme.saturday);
    }
  }
  for(const span of layout.spans){
    const x=17+span.col*cell,y=top+span.row*week+bandTop+span.lane*laneGap,w=(span.endCol-span.col+1)*cell-6;
    rect(x,y,w,bandHeight,bands[calendarEventColor(span.event)]);
    const titleY=y+(timed?18:0)-2;
    if(timed)text(time(span.event.start),x+4,y-2,16,theme.ink,w-8);
    eventTitle(span.event.title,x+4,titleY,w-8);
    if(span.continuesBefore)rect(x,y+7,2,11,theme.muted);
    if(span.continuesAfter)rect(x+w-2,y+7,2,11,theme.muted);
  }
  for(const c of layout.cells)if(c.hidden)text(`+${c.hidden}件`,21+c.col*cell,top+c.row*week+121,20,theme.muted,cell-14);
  rect(14,top+layout.rows*week,width-28,1,theme.line);
  if(titleKey.length){
    let y=top+layout.rows*week+8;text('枠内で省略した予定名',22,y,20,theme.muted);y+=28;
    for(const {event,lines} of titleKey){
      rect(22,y+4,4,Math.max(28,lines.length*24),bands[calendarEventColor(event)]);
      text(event.date.slice(5).replace('-','/'),34,y,20,theme.ink,90);
      text(time(event.start),34,y+24,16,theme.muted,90);
      lines.forEach((line,index)=>text(line,138,y+index*24,20,theme.ink,680));
      y+=Math.max(44,lines.length*24+8);
    }
    if(shortened.length>8)text(`ほか${shortened.length-8}件の長い予定名は下のメニューから`,22,y,16,theme.muted);
  }
  if(timed){text('時刻は開始時刻・色は予定の目印です',22,height-48,16,theme.muted);text('予定の詳細は下のメニューから',22,height-28,16,theme.muted);}
  else text('色は予定の目印・詳細は下のメニューから',22,height-31,20,theme.muted);
  return {buffer:encodePng(pixels,width,height,{palette,lookup}),width,height,layout,geometry:{top,weekHeight:week,bandTop,bandHeight,laneGap,rich,timed,wrapped,titleKeyCount:titleKey.length,shortenedCount:shortened.length,keyHeight}};
}
export function calendarAlt(layout){return `${layout.month}の月間カレンダー。日曜始まり。${layout.count}件。${layout.cells.filter(c=>c.items.length).map(c=>`${c.day}日${c.today?'（今日）':''}${c.selected?'（選択中）':''}: ${c.items.length}件、${c.items.map(e=>`${time(e.start)} ${e.title}${e.endDate?`（${e.date}〜${e.endDate}）`:''}`).join('、')}`).join('。')}`.slice(0,1024);}
