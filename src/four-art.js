import {encodePng} from './sprite-image.js';
const width=420,height=324;
const colors=[[18,27,42],[37,53,78],[241,201,105],[151,145,224],[105,187,168]];
const palette=Buffer.from(colors.flat()),lookup=Buffer.alloc(32768);
colors.forEach(([r,g,b],i)=>{lookup[((r>>3)<<10)|((g>>3)<<5)|(b>>3)]=i;});
export function fourImage(game){
  const pixels=Buffer.alloc(width*height*4);
  for(let i=0;i<pixels.length;i+=4){pixels[i]=18;pixels[i+1]=27;pixels[i+2]=42;pixels[i+3]=255;}
  const circle=(cx,cy,r,color)=>{for(let y=cy-r;y<=cy+r;y++)for(let x=cx-r;x<=cx+r;x++)if((x-cx)**2+(y-cy)**2<=r*r){const at=(y*width+x)*4;pixels[at]=color[0];pixels[at+1]=color[1];pixels[at+2]=color[2];}};
  for(let row=0;row<6;row++)for(let col=0;col<7;col++){const i=row*7+col,cx=42+col*56,cy=22+row*56;if(game.winning?.includes(i))circle(cx,cy,22,colors[4]);circle(cx,cy,game.winning?.includes(i)?17:21,colors[game.board[i]===1?2:game.board[i]===2?3:1]);}
  return encodePng(pixels,width,height,{palette,lookup});
}
export function fourAlt(g){return `上から順に各行、左から右の7列。${Array.from({length:6},(_,row)=>`${row+1}行目: ${g.board.slice(row*7,row*7+7).map(c=>c===1?'あなた':c===2?'Bot':'空').join('・')}`).join('。')}${g.winning?.length?`。勝利した4つ: ${g.winning.map(i=>`${Math.floor(i/7)+1}行${i%7+1}列`).join('・')}`:''}`;}
