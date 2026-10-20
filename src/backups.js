import {createHash} from 'node:crypto';
import {setImmediate as yieldTurn} from 'node:timers/promises';
// ZIP method 0 (stored): one bounded output buffer, no temporary files.
const CRC=Uint32Array.from({length:256},(_,n)=>{for(let j=0;j<8;j++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=data=>{let c=0xffffffff;for(const b of data)c=CRC[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
export const MAX_ZIP=7*1024*1024;
export function prepareBackups(characters,maxBytes=MAX_ZIP){
  if(!Array.isArray(characters)||!characters.length)throw new Error('ダウンロードできるPCの控えがありません。');
  if(characters.length>100||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_ZIP)throw new Error('控えの件数または送信上限を確認できません。');
  const signature=createHash('sha256').update(String(maxBytes)+'\n');
  const files=characters.map((c,n)=>{
    if(typeof c.txt!=='string')throw new Error('控えの形式を確認できません。');
    const label=String(c.name).normalize('NFKC').replace(/[^\p{L}\p{N} _-]/gu,'_').slice(0,40)||'PC';
    const name=Buffer.from(`${String(n+1).padStart(3,'0')}-${label}.txt`,'utf8'),bytes=Buffer.byteLength(c.txt,'utf8');
    if(bytes>256*1024)throw new Error('控えのサイズが上限を超えています。');
    signature.update(JSON.stringify([c.id??null,c.panelId??null,c.ownerId??null,c.url??null,c.updatedAt??null,c.name,bytes])).update(c.txt,'utf8');
    return {name,txt:c.txt,bytes};
  });
  const groups=[];let group=[],size=22,total=0;
  for(const f of files){
    const bytes=f.bytes+76+2*f.name.length;total+=bytes;
    if(total>33*1024*1024)throw new Error('控えの合計サイズが上限を超えています。');
    if(22+bytes>maxBytes)throw new Error('この控えはZIPの送信上限に収まりません。PCを選び、TXTの個別保存を確認してください。');
    if(size+bytes>maxBytes){groups.push(group);group=[];size=22;}group.push(f);size+=bytes;
  }
  if(group.length)groups.push(group);
  const parts=groups.map(items=>Object.freeze({count:items.length,bytes:22+items.reduce((sum,f)=>sum+f.bytes+76+2*f.name.length,0)}));
  const plan=Object.freeze({signature:signature.digest('hex'),maxBytes,totalCount:files.length,parts:Object.freeze(parts)});
  function* encode(index){
    if(!Number.isInteger(index)||index<0||index>=groups.length)throw new Error('ZIPを選び直してください。');
    const items=groups[index],data=Buffer.alloc(parts[index].bytes),centralStart=items.reduce((sum,f)=>sum+30+f.name.length+f.bytes,0);let offset=0,directory=centralStart;
    for(const f of items){
      const body=offset+30+f.name.length;
      if(data.write(f.txt,body,f.bytes,'utf8')!==f.bytes)throw new Error('控えをZIPにまとめられませんでした。');
      const crc=crc32(data.subarray(body,body+f.bytes));
      data.writeUInt32LE(0x04034b50,offset);data.writeUInt16LE(20,offset+4);data.writeUInt16LE(0x800,offset+6);data.writeUInt16LE(33,offset+12);data.writeUInt32LE(crc,offset+14);data.writeUInt32LE(f.bytes,offset+18);data.writeUInt32LE(f.bytes,offset+22);data.writeUInt16LE(f.name.length,offset+26);f.name.copy(data,offset+30);
      data.writeUInt32LE(0x02014b50,directory);data.writeUInt16LE(20,directory+4);data.writeUInt16LE(20,directory+6);data.writeUInt16LE(0x800,directory+8);data.writeUInt16LE(33,directory+14);data.writeUInt32LE(crc,directory+16);data.writeUInt32LE(f.bytes,directory+20);data.writeUInt32LE(f.bytes,directory+24);data.writeUInt16LE(f.name.length,directory+28);data.writeUInt32LE(offset,directory+42);f.name.copy(data,directory+46);
      directory+=46+f.name.length;offset=body+f.bytes;
      yield;
    }
    data.writeUInt32LE(0x06054b50,directory);data.writeUInt16LE(items.length,directory+8);data.writeUInt16LE(items.length,directory+10);data.writeUInt32LE(directory-centralStart,directory+12);data.writeUInt32LE(centralStart,directory+16);
    return {name:`pc-backups-${index+1}.zip`,data,count:items.length};
  }
  return {plan,part(index){const job=encode(index);let result;while(!(result=job.next()).done){}return result.value;},async partAsync(index){
    const job=encode(index);let result;while(!(result=job.next()).done)await yieldTurn();return result.value;
  }};
}
// Compatibility for local callers that explicitly request every ZIP at once.
export function backupBundles(characters){const prepared=prepareBackups(characters);return prepared.plan.parts.map((_,index)=>prepared.part(index));}
