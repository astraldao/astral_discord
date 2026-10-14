import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {encodePng} from './sprite-image.js';
const font=JSON.parse(readFileSync(new URL('../assets/calendar-font.json',import.meta.url),'utf8'));
const atlas=inflateSync(Buffer.from(font.pixels,'base64'),{maxOutputLength:262144});
const colors=[[18,27,42],[26,38,57],[39,53,75],[223,230,242],[139,157,184],[168,156,242],[221,146,160],[122,181,226],[71,70,113]];
const shades=colors.flatMap(a=>colors.flatMap(b=>[1,2].map(n=>a.map((v,i)=>Math.round((v*(3-n)+b[i]*n)/3)))));
const palette=Buffer.from([...colors,...shades].flat()),lookup=Buffer.alloc(32768);
for(let i=0;i<palette.length/3;i++){const [r,g,b]=palette.subarray(i*3,i*3+3);lookup[((r>>3)<<10)|((g>>3)<<5)|(b>>3)]=i;}
export function calendarLayout(month,events,today){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||Number(month.slice(0,4))<2000||Number(month.slice(0,4))>2099)throw new Error('カレンダーの月が不正です。');
  const year=Number(month.slice(0,4)),m=Number(month.slice(5)),days=new Date(Date.UTC(year,m,0)).getUTCDate(),offset=new Date(Date.UTC(year,m-1,1)).getUTCDay();
  const cells=Array.from({length:days},(_,n)=>{const date=`${month}-${String(n+1).padStart(2,'0')}`,items=events.filter(e=>e.date===date).sort((a,b)=>(a.start??-1)-(b.start??-1));return {day:n+1,date,row:Math.floor((offset+n)/7),col:(offset+n)%7,today:date===today,items};});
  return {month,rows:Math.ceil((offset+days)/7),cells,count:cells.reduce((n,c)=>n+c.items.length,0)};
}
const time=n=>n===null?'ALL':`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
export function calendarImage(month,events,{today}={}){
  const layout=calendarLayout(month,events,today),width=560,cell=76,height=104+layout.rows*72+16,pixels=Buffer.alloc(width*height*4);
  for(let n=0;n<pixels.length;n+=4){pixels[n]=18;pixels[n+1]=27;pixels[n+2]=42;pixels[n+3]=255;}
  function rect(x,y,w,h,color){for(let j=Math.max(0,y);j<Math.min(height,y+h);j++)for(let i=Math.max(0,x);i<Math.min(width,x+w);i++){const at=(j*width+i)*4;for(let c=0;c<3;c++)pixels[at+c]=color[c];}}
  function text(value,x,y,size,color){for(const char of value){const g=font.glyphs[`${size}:${char}`];if(!g)continue;for(let j=0;j<g.h;j++)for(let i=0;i<g.w;i++){const alpha=atlas[g.offset+j*g.w+i];if(!alpha)continue;const px=x+g.x+i,py=y+g.y+j;if(px<0||py<0||px>=width||py>=height)continue;const at=(py*width+px)*4;for(let c=0;c<3;c++)pixels[at+c]=Math.round((pixels[at+c]*(3-alpha)+color[c]*alpha)/3);}x+=g.advance;}}
  text(`${month.slice(0,4)} / ${Number(month.slice(5))}`,18,12,28,colors[3]);text(`${layout.count} EVENTS`,414,24,16,colors[4]);
  ['SUN','MON','TUE','WED','THU','FRI','SAT'].forEach((day,n)=>text(day,22+n*cell,68,16,colors[n===0?6:n===6?7:4]));
  for(const c of layout.cells){const x=14+c.col*cell,y=104+c.row*72;rect(x,y,72,68,c.today?colors[5]:colors[1]);if(c.today)rect(x+2,y+2,68,64,colors[8]);
    text(String(c.day),x+7,y+3,22,colors[c.col===0?6:c.col===6?7:3]);
    if(c.items.length){const count=String(c.items.length),countWidth=[...count].reduce((n,ch)=>n+font.glyphs[`16:${ch}`].advance,0);text(count,x+66-countWidth,y+7,16,colors[5]);rect(x+7,y+36,3,23,colors[5]);text(time(c.items[0].start),x+14,y+35,16,colors[3]);}
  }
  return {buffer:encodePng(pixels,width,height,{palette,lookup}),width,height,layout};
}
export function calendarAlt(layout){return `${layout.month}の月間カレンダー。日曜始まり。${layout.count}件。${layout.cells.filter(c=>c.items.length).map(c=>`${c.day}日: ${c.items.length}件、${c.items.map(e=>`${e.start===null?'終日':time(e.start)} ${e.title}`).join('、')}`).join('。')}`.slice(0,1024);}
