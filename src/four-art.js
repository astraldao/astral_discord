import {encodePng} from './sprite-image.js';
// Same navy frame, panel and border as the blackjack/casino art so every game image reads as one set.
const width=480,height=360,cell=52,radius=20,left=(width-cell*7)/2,top=24;
const background=[19,28,43],panel=[25,38,59],border=[44,67,91],hole=[19,28,43],you=[241,201,105],bot=[151,145,224],win=[105,187,168];
const mix=(a,b,t)=>a.map((v,i)=>Math.round(v+(b[i]-v)*t));
// A small indexed palette (base colors plus a few edge blends) keeps each board PNG a few KiB.
const pairs=[[background,border],[border,panel],[panel,hole],[panel,you],[panel,bot],[panel,win],[win,you],[win,bot]];
const colors=[...new Map(pairs.flatMap(([a,b])=>[0,1,2,3,4].map(n=>mix(a,b,n/4))).map(c=>[c.join(),c])).values()];
const palette=Buffer.from(colors.flat()),lookup=Buffer.alloc(32768);
for(let key=0;key<32768;key++){
  const rgb=[(key>>10)*8+4,((key>>5)&31)*8+4,(key&31)*8+4];let best=0,distance=Infinity;
  colors.forEach((c,i)=>{const d=(c[0]-rgb[0])**2+(c[1]-rgb[1])**2+(c[2]-rgb[2])**2;if(d<distance){distance=d;best=i;}});lookup[key]=best;
}
const exact=new Map(colors.map((c,i)=>[(c[0]<<16)|(c[1]<<8)|c[2],i]));
// Distance-based coverage keeps circle and corner edges smooth without a canvas dependency.
const coverage=distance=>Math.max(0,Math.min(1,0.5-distance));
function roundedRect(x,y,w,h,r,px,py){const dx=Math.max(x+r-px,0,px-(x+w-r)),dy=Math.max(y+r-py,0,py-(y+h-r));return Math.hypot(dx,dy)-r;}
const paint=(pixels,x,y,color)=>{const at=(y*width+x)*4;pixels[at]=color[0];pixels[at+1]=color[1];pixels[at+2]=color[2];pixels[at+3]=255;};
const read=(pixels,x,y)=>{const at=(y*width+x)*4;return [pixels[at],pixels[at+1],pixels[at+2]];};
// The frame and empty holes never change, so they are drawn once; each move repaints only occupied cells.
let empty;
function emptyBoard(){
  if(empty)return empty;
  empty=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const edge=roundedRect(10,10,width-20,height-20,14,x+0.5,y+0.5);paint(empty,x,y,mix(mix(background,border,coverage(edge)),panel,coverage(edge+1)));}
  for(let i=0;i<42;i++)disc(empty,i,hole,false);
  return empty;
}
function disc(pixels,i,piece,winning){
  const x0=left+(i%7)*cell,y0=top+Math.floor(i/7)*cell,cx=x0+cell/2,cy=y0+cell/2;
  for(let y=y0;y<y0+cell;y++)for(let x=x0;x<x0+cell;x++){
    const d=Math.hypot(x+0.5-cx,y+0.5-cy);if(d>radius+1)continue;
    let color=read(pixels,x,y);if(winning)color=mix(color,win,coverage(d-radius));
    paint(pixels,x,y,mix(color,piece,coverage(d-(winning?radius-4:radius))));
  }
}
export function fourImage(game){
  const pixels=Buffer.from(emptyBoard());
  game.board.forEach((c,i)=>{if(c===1||c===2)disc(pixels,i,c===1?you:bot,!!game.winning?.includes(i));});
  return encodePng(pixels,width,height,{palette,lookup,exact});
}
export function fourAlt(g){return `上から順に各行、左から右の7列。${Array.from({length:6},(_,row)=>`${row+1}行目: ${g.board.slice(row*7,row*7+7).map(c=>c===1?'あなた':c===2?'Bot':'空').join('・')}`).join('。')}${g.winning?.length?`。勝利した4つ: ${g.winning.map(i=>`${Math.floor(i/7)+1}行${i%7+1}列`).join('・')}`:''}`;}
