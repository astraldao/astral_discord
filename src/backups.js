// ZIP method 0 (stored): bounded in memory, no temporary files or new dependencies.
const CRC=Uint32Array.from({length:256},(_,n)=>{for(let j=0;j<8;j++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=data=>{let c=0xffffffff;for(const b of data)c=CRC[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
export const MAX_ZIP=7*1024*1024;
export function backupBundles(characters){
  if(!characters.length)throw new Error('ダウンロードできるPCの控えがありません。');
  const files=characters.map((c,n)=>{
    const label=String(c.name).normalize('NFKC').replace(/[^\p{L}\p{N} _-]/gu,'_').slice(0,40)||'PC';
    const name=Buffer.from(`${String(n+1).padStart(3,'0')}-${label}.txt`,'utf8'),data=Buffer.from(c.txt,'utf8');
    if(data.length>256*1024)throw new Error('控えのサイズが上限を超えています。');
    return {name,data};
  });
  const groups=[];let group=[],size=22,total=0;
  for(const f of files){const bytes=f.data.length+76+2*f.name.length;total+=bytes;if(total>33*1024*1024)throw new Error('控えの合計サイズが上限を超えています。');if(size+bytes>MAX_ZIP){groups.push(group);group=[];size=22;}group.push(f);size+=bytes;}
  if(group.length)groups.push(group);
  return groups.map((items,index)=>{
    const body=[],directory=[];let offset=0;
    for(const {name,data} of items){
      const crc=crc32(data),local=Buffer.alloc(30),central=Buffer.alloc(46);
      local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
      central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
      body.push(local,name,data);directory.push(central,name);offset+=local.length+name.length+data.length;
    }
    const cd=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(items.length,8);end.writeUInt16LE(items.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
    return {name:`pc-backups-${index+1}.zip`,data:Buffer.concat([...body,cd,end]),count:items.length};
  });
}
