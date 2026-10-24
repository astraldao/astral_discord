import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {encodePng} from './sprite-image.js';
import {scheduleColors,validScheduleColor} from './schedule-colors.js';
const font=JSON.parse(readFileSync(new URL('../assets/calendar-font.json',import.meta.url),'utf8'));
const atlas=inflateSync(Buffer.from(font.pixels,'base64'),{maxOutputLength:8*1024*1024});
const theme={paper:[255,255,255],ink:[38,43,49],muted:[118,125,132],line:[232,235,238],weekend:[250,251,252],selected:[234,246,253],today:[38,43,49],sunday:[201,70,78],saturday:[43,111,177],white:[255,255,255]};
const bands=[[208,239,252],[210,244,229],[255,223,222],[233,223,251],[255,239,202],[223,233,244]];
const backgrounds=[...Object.values(theme),...bands];
const adjacentPaper=[248,249,251],adjacentBands=bands.map(color=>color.map(value=>Math.round(value*0.4+255*0.6)));
const adjacentBackgrounds=[adjacentPaper,...adjacentBands];
const foregrounds=[theme.ink,theme.muted,theme.white,theme.sunday,theme.saturday];
// Deduplicate the palette and preserve exact colors that share a 5-bit bucket.
const accents=bands.map(color=>color.map((value,index)=>Math.round(value*0.55+theme.ink[index]*0.45)));
const rawColors=[theme.paper,...accents,...adjacentBackgrounds,...adjacentBackgrounds.flatMap(a=>foregrounds.flatMap(b=>[1,2].map(n=>a.map((v,i)=>Math.round((v*(3-n)+b[i]*n)/3))))),...backgrounds.slice(1),...backgrounds.flatMap(a=>foregrounds.flatMap(b=>[1,2].map(n=>a.map((v,i)=>Math.round((v*(3-n)+b[i]*n)/3)))))];
const colors=[...new Map(rawColors.map(color=>[color.join(','),color])).values()];
const palette=Buffer.from(colors.flat()),lookup=Buffer.alloc(32768),exact=new Map(colors.map(([r,g,b],index)=>[(r<<16)|(g<<8)|b,index]));
for(let i=0;i<colors.length;i++){const [r,g,b]=colors[i];lookup[((r>>3)<<10)|((g>>3)<<5)|(b>>3)]=i;}
const fontSize=size=>size>=24?28:20;
const glyph=(char,size)=>font.glyphs[`${fontSize(size)}:${char}`]??font.glyphs[`${fontSize(size)}:□`];
const advance=(char,size)=>Math.round((glyph(char,size)?.advance??fontSize(size))*size/fontSize(size));
const measure=(value,size)=>[...value].reduce((n,c)=>n+advance(c,size),0);
// Explicit choices take priority; automatic colors stay stable for the same title.
function calendarEventColor(event){if(validScheduleColor(event.color))return scheduleColors[event.color].index;let hash=0;for(const c of String(event.title))hash=(Math.imul(hash,31)+c.codePointAt(0))>>>0;return hash%bands.length;}
export function calendarLayout(month,events,today,selectedDate){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||Number(month.slice(0,4))<2000||Number(month.slice(0,4))>2099)throw new Error('カレンダーの月が不正です。');
  const year=Number(month.slice(0,4)),m=Number(month.slice(5)),days=new Date(Date.UTC(year,m,0)).getUTCDate(),offset=new Date(Date.UTC(year,m-1,1)).getUTCDay();
  const first=`${month}-01`,last=`${month}-${String(days).padStart(2,'0')}`,monthRows=Math.ceil((offset+days)/7);
  // A Saturday ending otherwise hides every date of the following month.
  const rows=monthRows+((offset+days)%7===0?1:0),dateAt=index=>new Date(Date.UTC(year,m-1,index-offset+1)).toISOString().slice(0,10);
  const rangeStart=dateAt(0),rangeEnd=dateAt(rows*7-1),shown=events.filter(e=>e.date<=rangeEnd&&(e.endDate??e.date)>=rangeStart),visible=shown.filter(e=>e.date<=last&&(e.endDate??e.date)>=first);
  const gridCells=Array.from({length:rows*7},(_,index)=>{
    const date=dateAt(index),inMonth=date>=first&&date<=last,items=shown.filter(e=>e.date<=date&&(e.endDate??e.date)>=date).sort((a,b)=>(a.start??-1)-(b.start??-1)||a.title.localeCompare(b.title)||String(a.id??'').localeCompare(String(b.id??'')));
    return {day:Number(date.slice(8)),date,row:Math.floor(index/7),col:index%7,inMonth,today:date===today,selected:inMonth&&date===selectedDate,items,hidden:items.length};
  });
  const cells=gridCells.filter(c=>c.inMonth),contextCells=gridCells.filter(c=>!c.inMonth),spans=[],contextSpans=[];
  for(let row=0;row<rows;row++){
    const week=gridCells.slice(row*7,row*7+7),occupied=[0,0,0];
    const segments=shown.flatMap(event=>{
      const covered=week.filter(c=>event.date<=c.date&&(event.endDate??event.date)>=c.date);if(!covered.length)return [];
      const current=covered.filter(c=>c.inMonth),priority=current.length?0:1,rank=current.length?current:covered;
      return [{event,covered,priority,rankCol:rank[0].col,rankEnd:rank.at(-1).col}];
    }).sort((a,b)=>a.priority-b.priority||(b.rankEnd-b.rankCol)-(a.rankEnd-a.rankCol)||a.rankCol-b.rankCol||(a.event.start??-1)-(b.event.start??-1)||a.event.title.localeCompare(b.event.title)||String(a.event.id??'').localeCompare(String(b.event.id??'')));
    for(const {event,covered} of segments){
      const mask=((1<<(covered.at(-1).col-covered[0].col+1))-1)<<covered[0].col,lane=occupied.findIndex(bits=>!(bits&mask));if(lane===-1)continue;occupied[lane]|=mask;
      // Split at month boundaries, while keeping a continuous event in one lane.
      for(const part of [covered.filter(c=>c.date<first),covered.filter(c=>c.inMonth),covered.filter(c=>c.date>last)]){
        if(!part.length)continue;
        const outside=!part[0].inMonth,span={event,row,col:part[0].col,endCol:part.at(-1).col,lane,continuesBefore:event.date<part[0].date,continuesAfter:(event.endDate??event.date)>part.at(-1).date,...(outside?{outside:true}:{})};
        (outside?contextSpans:spans).push(span);for(const c of part)c.hidden--;
      }
    }
  }
  return {month,rows,offset,cells,spans,count:visible.length,gridCells,contextCells,contextSpans,rangeStart,rangeEnd};
}
function titleLines(value,maxWidth){
  const lines=[''];let used=0;for(const char of String(value).replace(/[\r\n\t]/g,' ')){const step=advance(char,20);if(used+step>maxWidth&&lines.at(-1)){lines.push('');used=0;}lines[lines.length-1]+=char;used+=step;}return lines;
}
function cardTitle(value,maxWidth){
  const clean=String(value).replace(/[\r\n\t]/g,' ');
  if(measure(clean,20)<=maxWidth)return {size:20,lines:[clean]};
  if(measure(clean,16)<=maxWidth)return {size:16,lines:[clean]};
  let lines=titleLines(clean,maxWidth);
  if(lines.length===2){
    const chars=[...clean];let best=Infinity;
    for(let i=1;i<chars.length;i++){
      const a=chars.slice(0,i).join(''),b=chars.slice(i).join(''),left=measure(a,20),right=measure(b,20),difference=Math.abs(left-right);
      if(left<=maxWidth&&right<=maxWidth&&difference<best){best=difference;lines=[a,b];}
    }
  }
  return {size:20,lines};
}
const time=n=>n==null?'終日':`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
export function calendarImage(month,events,{today,selectedDate,title=''}={}){
  const layout=calendarLayout(month,events,today,selectedDate),allSpans=[...layout.spans,...layout.contextSpans],currentEvents=new Set(layout.cells.flatMap(c=>c.items)),width=840,cell=112,left=28,top=176;
  let bottom=top;
  const weeks=Array.from({length:layout.rows},(_,row)=>{
    const spans=allSpans.filter(span=>span.row===row),lanes=spans.reduce((n,span)=>Math.max(n,span.lane+1),0),rich=lanes<=1;
    const timed=rich&&spans.some(span=>Number.isInteger(span.event.start)),wrapped=rich&&spans.some(span=>cardTitle(span.event.title,(span.endCol-span.col+1)*cell-16).lines.length>1);
    const bandTop=40,bandHeight=rich?(wrapped?52:30)+(timed?18:0):28,laneGap=bandHeight+4,hidden=layout.gridCells.slice(row*7,row*7+7).some(c=>c.hidden);
    const contentBottom=lanes?bandTop+(lanes-1)*laneGap+bandHeight:30,height=Math.max(58,contentBottom+(hidden?28:14));
    const week={row,top:bottom,height,lanes,rich,timed,wrapped,bandTop,bandHeight,laneGap,overflowY:contentBottom+3};bottom+=height;return week;
  });
  const rich=weeks.every(week=>week.rich),timed=weeks.some(week=>week.timed),wrapped=weeks.some(week=>week.wrapped);
  // Only expand titles actually shortened in a visible card. Object identity keeps
  // distinct same-title events separate while deduplicating week-crossing spans.
  const shortened=[...new Set(allSpans.filter(span=>cardTitle(span.event.title,(span.endCol-span.col+1)*cell-16).lines.length>(weeks[span.row].wrapped?2:1)).map(span=>span.event))].sort((a,b)=>Number(!currentEvents.has(a))-Number(!currentEvents.has(b))||a.date.localeCompare(b.date)||(a.start??-1)-(b.start??-1)||a.title.localeCompare(b.title));
  const titleKey=shortened.slice(0,8).map(event=>({event,lines:titleLines(event.title,668)}));
  const keyHeight=titleKey.length?34+titleKey.reduce((n,item)=>n+Math.max(44,item.lines.length*24+8),0)+(shortened.length>8?26:0):0;
  const footer=42,height=bottom+keyHeight+footer,pixels=Buffer.alloc(width*height*4,255);
  function rect(x,y,w,h,color){for(let j=Math.max(0,y);j<Math.min(height,y+h);j++)for(let i=Math.max(0,x);i<Math.min(width,x+w);i++){const at=(j*width+i)*4;for(let c=0;c<3;c++)pixels[at+c]=color[c];}}
  function circle(x,y,r,color){for(let j=-r;j<=r;j++)for(let i=-r;i<=r;i++)if(i*i+j*j<=r*r)rect(x+i,y+j,1,1,color);}
  function text(value,x,y,size,color,maxWidth=width-x){
    x=Math.round(x);y=Math.round(y);const origin=x,right=Math.min(width-left,x+maxWidth),scale=size/fontSize(size);
    const valueText=String(value).replace(/[\r\n\t]/g,' '),chars=[...valueText];let result=valueText,used=0;
    if(measure(valueText,size)>maxWidth){result='';for(const char of chars){const step=advance(char,size);if(used+step+measure('…',size)>maxWidth)break;result+=char;used+=step;}result+='…';}
    for(const char of result){const g=glyph(char,size);if(!g){x+=size;continue;}for(let j=0;j<Math.ceil(g.h*scale);j++)for(let i=0;i<Math.ceil(g.w*scale);i++){const alpha=atlas[g.offset+Math.min(g.h-1,Math.floor(j/scale))*g.w+Math.min(g.w-1,Math.floor(i/scale))];if(!alpha)continue;const px=x+Math.round(g.x*scale)+i,py=y+Math.round(g.y*scale)+j;if(px<origin||py<0||px>=right||py>=height)continue;const at=(py*width+px)*4;for(let c=0;c<3;c++)pixels[at+c]=Math.round((pixels[at+c]*(3-alpha)+color[c]*alpha)/3);}x+=advance(char,size);}
  }
  function roundedRect(x,y,w,h,r,color,{before=false,after=false}={}){
    for(let dy=0;dy<h;dy++){
      const edge=dy<r?r-dy-0.5:dy>=h-r?dy-(h-r)+0.5:0,inset=edge?Math.ceil(r-Math.sqrt(Math.max(0,r*r-edge*edge))):0;
      rect(x+(before?0:inset),y+dy,w-(before?0:inset)-(after?0:inset),1,color);
    }
  }
  function eventTitle(value,x,y,maxWidth,style,color=theme.ink){
    const {size,lines}=cardTitle(value,maxWidth);
    if(!style.wrapped||lines.length===1){text(lines.join(''),x,y+(size===16?3:0),size,color,maxWidth);return;}
    text(lines[0],x,y,20,color,maxWidth);text(lines.slice(1).join(''),x,y+22,20,color,maxWidth);
  }
  text(`${month.slice(0,4)}年`,left,14,20,theme.muted);
  text(`${Number(month.slice(5))}月`,left,38,38,theme.ink);
  const count=`当月 ${layout.count}件`,pillWidth=measure(count,20)+28;
  roundedRect(width-left-pillWidth,42,pillWidth,36,18,adjacentPaper);text(count,width-left-pillWidth+14,46,20,theme.ink);
  text('日本時間',width-left-measure('日本時間',16),88,16,theme.muted);
  text(title||'月間カレンダー',left,99,20,theme.muted,width-left*2);
  roundedRect(left,136,cell*7,32,8,adjacentPaper);
  ['日','月','火','水','木','金','土'].forEach((day,n)=>text(day,left+n*cell+(cell-20)/2,140,20,n===0?theme.sunday:n===6?theme.saturday:theme.muted));
  for(let row=0;row<layout.rows;row++){
    const style=weeks[row],y=style.top;
    for(let col=0;col<7;col++){
      const x=left+col*cell,c=layout.gridCells[row*7+col];
      rect(x,y,cell,style.height,!c.inMonth?adjacentPaper:c.selected?theme.selected:col===0||col===6?theme.weekend:theme.paper);
      rect(x,y,cell,1,theme.line);
      if(c.today&&c.inMonth)circle(x+cell/2,y+19,15,theme.saturday);
      const day=!c.inMonth&&(col===0||c.day===1)?`${Number(c.date.slice(5,7))}/${c.day}`:String(c.day);
      text(day,x+(cell-measure(day,20))/2,y+2,20,!c.inMonth?theme.muted:c.today?theme.white:col===0?theme.sunday:col===6?theme.saturday:theme.ink);
      if(c.selected)roundedRect(x+cell/2-10,y+34,20,3,1,theme.saturday);
    }
  }
  for(const span of allSpans){
    const style=weeks[span.row],x=left+3+span.col*cell,y=style.top+style.bandTop+span.lane*style.laneGap,w=(span.endCol-span.col+1)*cell-6,index=calendarEventColor(span.event);
    roundedRect(x,y,w,style.bandHeight,4,(span.outside?adjacentBands:bands)[index],{before:span.continuesBefore,after:span.continuesAfter});
    if(!span.outside&&!span.continuesBefore)rect(x+2,y+5,2,style.bandHeight-10,accents[index]);
    if(style.timed)text(time(span.event.start),x+6,y+1,16,theme.muted,w-16);
    eventTitle(span.event.title,x+6,y+(style.timed?18:1),w-10,style,span.outside?theme.muted:theme.ink);
    if(span.continuesBefore)rect(x,y+9,2,Math.min(12,style.bandHeight-18),theme.muted);
    if(span.continuesAfter)rect(x+w-2,y+9,2,Math.min(12,style.bandHeight-18),theme.muted);
  }
  for(const c of layout.gridCells)if(c.hidden){const style=weeks[c.row];text(`+${c.hidden}件`,left+7+c.col*cell,style.top+style.overflowY,16,theme.muted,cell-14);}
  rect(left,bottom,cell*7,1,theme.line);
  if(titleKey.length){
    let y=bottom+8;text('省略した予定名',left,y,20,theme.muted);y+=28;
    for(const {event,lines} of titleKey){
      const outside=!currentEvents.has(event),ink=outside?theme.muted:theme.ink;
      rect(left,y+4,3,Math.max(28,lines.length*24),(outside?adjacentBands:bands)[calendarEventColor(event)]);
      text(event.date.slice(5).replace('-','/'),left+12,y,20,ink,90);
      text(time(event.start),left+12,y+24,16,theme.muted,90);
      lines.forEach((line,index)=>text(line,144,y+index*24,20,ink,668));
      y+=Math.max(44,lines.length*24+8);
    }
    if(shortened.length>8)text(`ほか${shortened.length-8}件の長い予定名は下のメニューから`,left,y,16,theme.muted);
  }
  text('薄字は前後の月・詳細は各月の一覧から',left,height-29,16,theme.muted);
  return {buffer:encodePng(pixels,width,height,{palette,lookup,exact}),width,height,layout,geometry:{top,left,cellWidth:cell,weeks,gridBottom:bottom,rich,timed,wrapped,titleKeyCount:titleKey.length,shortenedCount:shortened.length,keyHeight}};
}
export function calendarAlt(layout){
  const describe=c=>`${c.today?'（今日）':''}${c.selected?'（選択中）':''}: ${c.items.length}件、${c.items.map(e=>`${time(e.start)} ${e.title}${e.endDate?`（${e.date}〜${e.endDate}）`:''}`).join('、')}`;
  const current=layout.cells.filter(c=>c.items.length).map(c=>`${c.day}日${describe(c)}`).join('。');
  const adjacent=layout.contextCells.filter(c=>c.items.length).map(c=>`${c.date}${describe(c)}`).join('。');
  return `${layout.month}の月間カレンダー。日曜始まり。当月${layout.count}件。前後の月は薄字。${current}${adjacent?`。前後の月の予定：${adjacent}`:''}`.slice(0,1024);
}
