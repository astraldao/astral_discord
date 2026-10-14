import {deflateSync} from 'node:zlib';
const CRC=Uint32Array.from({length:256},(_,n)=>{for(let j=0;j<8;j++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function chunk(type,body){const out=Buffer.alloc(body.length+12);out.writeUInt32BE(body.length);out.write(type,4);body.copy(out,8);let crc=0xffffffff;for(const b of out.subarray(4,-4))crc=CRC[(crc^b)&255]^(crc>>>8);out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;}
export function blit(dst,width,s,x,y){for(let j=0;j<s.h;j++)for(let k=0;k<s.w;k++){const from=(j*s.w+k)*4,to=((j+y)*width+k+x)*4,alpha=s.pixels[from+3];if(!alpha)continue;if(alpha===255){dst[to]=s.pixels[from];dst[to+1]=s.pixels[from+1];dst[to+2]=s.pixels[from+2];continue;}for(let c=0;c<3;c++)dst[to+c]=Math.round((s.pixels[from+c]*alpha+dst[to+c]*(255-alpha))/255);}}
export function encodePng(pixels,width,height,{palette,lookup}={}){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>2097152||pixels.length!==width*height*4)throw new Error('画像のサイズが不正です。');
  if(palette&&(!lookup||palette.length<3||palette.length>768||palette.length%3||lookup.length!==32768))throw new Error('画像の配色が不正です。');
  let channels=3;for(let i=3;i<pixels.length;i+=4)if(pixels[i]!==255){channels=4;break;}
  if(channels===3&&palette&&lookup)channels=1;
  const stride=width*channels+1,raw=Buffer.allocUnsafe(stride*height);
  // PNG Sub filter compresses flat panels and text while keeping encoding inexpensive.
  for(let y=0;y<height;y++){let out=y*stride;raw[out++]=1;let previous=0;for(let x=0;x<width;x++){const from=(y*width+x)*4;if(channels===1){const index=lookup[((pixels[from]>>3)<<10)|((pixels[from+1]>>3)<<5)|(pixels[from+2]>>3)];raw[out++]=(index-previous)&255;previous=index;}else for(let c=0;c<channels;c++)raw[out++]=(pixels[from+c]-(x?pixels[from-4+c]:0))&255;}}
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=channels===1?3:channels===3?2:6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...(channels===1?[chunk('PLTE',palette)]:[]),chunk('IDAT',deflateSync(raw,{level:3})),chunk('IEND',Buffer.alloc(0))]);
}
