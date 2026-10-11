import {deflateSync} from 'node:zlib';
const CRC=Uint32Array.from({length:256},(_,n)=>{for(let j=0;j<8;j++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function chunk(type,body){const out=Buffer.alloc(body.length+12);out.writeUInt32BE(body.length);out.write(type,4);body.copy(out,8);let crc=0xffffffff;for(const b of out.subarray(4,-4))crc=CRC[(crc^b)&255]^(crc>>>8);out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;}
export function blit(dst,width,s,x,y){for(let j=0;j<s.h;j++)for(let k=0;k<s.w;k++){const from=(j*s.w+k)*4,to=((j+y)*width+k+x)*4,alpha=s.pixels[from+3];if(!alpha)continue;for(let c=0;c<3;c++)dst[to+c]=Math.round((s.pixels[from+c]*alpha+dst[to+c]*(255-alpha))/255);}}
export function encodePng(pixels,width,height){
  const raw=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)pixels.copy(raw,y*(width*4+1)+1,y*width*4,(y+1)*width*4);
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw,{level:3})),chunk('IEND',Buffer.alloc(0))]);
}
