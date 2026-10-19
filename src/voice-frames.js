import {BoundedBytes} from './bounded-bytes.js';
const maximumAudio=4*1024*1024;
const invalid=()=>new Error('音声応答の形式が不正です。');
// A newline-delimited JSON header followed by exactly header.bytes binary bytes.
// Each new fragment is copied into bounded storage; prior fragments are not
// concatenated again. Completed frames own their buffers before delivery.
export class VoiceFrames {
  #line=new BoundedBytes(1024);#body=null;#header=null;#closed=false;
  push(part,emit,onHeader=()=>{}){
    if(this.#closed)throw invalid();
    try{
      if(!(part instanceof Uint8Array)||part.length+(this.#header?this.#body?.length??0:this.#line.length)>maximumAudio+2048)throw invalid();
      let offset=0;
      while(!this.#closed&&(offset<part.length||this.#header&&this.#header.bytes===0)){
        if(!this.#header){
          const newline=part.indexOf(10,offset);
          if(newline<0){this.#line.append(part.subarray(offset));return;}
          this.#line.append(part.subarray(offset,newline));
          const data=JSON.parse(this.#line.finish().toString('utf8'));
          this.#line=new BoundedBytes(1024);
          if(!data||typeof data!=='object'||Array.isArray(data)||!Number.isInteger(data.bytes)||data.bytes<0||data.bytes>maximumAudio)throw invalid();
          this.#header=data;this.#body=data.bytes?new BoundedBytes(data.bytes):null;offset=newline+1;
          onHeader(data);if(this.#closed)return;
        }
        const remaining=this.#header.bytes-(this.#body?.length??0),take=Math.min(remaining,part.length-offset);
        if(take)this.#body.append(part.subarray(offset,offset+take));offset+=take;
        if(take<remaining)return;
        const header=this.#header,body=this.#body?.finish()??Buffer.alloc(0);this.#header=null;this.#body=null;
        emit(header,body);
      }
    }catch{this.dispose();throw invalid();}
  }
  dispose(){this.#closed=true;this.#line.dispose();this.#body?.dispose();this.#body=null;this.#header=null;}
}
