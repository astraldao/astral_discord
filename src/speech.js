import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile,rename,readdir,stat,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {personalReading as validatePersonalReading} from './personal-readings.js';
import {readingFor} from './readings.js';
export function announcementText(name,words=[],personalReading=null) {
  const clean=String(name).normalize('NFKC').replace(/https?:\/\/\S+/g,'').replace(/[^\p{L}\p{N} ー]/gu,' ').replace(/\s+/g,' ').trim().slice(0,32);
  const reading=personalReading===null?readingFor(clean,words):validatePersonalReading(personalReading);
  return `${reading ? reading+'さん' : '新しい方'}が、まもなく参加するのだ。`;
}
export function gentlePcm(wav,volume=30) {
  if(!Buffer.isBuffer(wav) || wav.length<44 || wav.toString('ascii',0,4)!=='RIFF' || wav.toString('ascii',8,12)!=='WAVE')throw new Error('音声データがWAVではありません。');
  let fmt,data;
  for(let offset=12;offset+8<=wav.length;) {
    const type=wav.toString('ascii',offset,offset+4),size=wav.readUInt32LE(offset+4),start=offset+8;
    if(start+size>wav.length)throw new Error('音声データが途中で切れています。');
    if(type==='fmt ')fmt=wav.subarray(start,start+size);
    if(type==='data')data=wav.subarray(start,start+size);
    offset=start+size+(size%2);
  }
  if(!fmt || fmt.length<16 || fmt.readUInt16LE(0)!==1 || fmt.readUInt16LE(2)!==2 || fmt.readUInt32LE(4)!==48000 || fmt.readUInt16LE(14)!==16 || !data || data.length%4 || !data.length || data.length>48000*4*20)throw new Error('48kHz・ステレオPCM16bit・20秒以内の音声が必要です。');
  if(!Number.isInteger(volume) || volume<10 || volume>60)throw new Error('音量は10〜60です。');
  const out=Buffer.alloc(data.length),frames=data.length/4,fade=960,gain=volume/100;
  for(let frame=0;frame<frames;frame++) {
    const envelope=Math.min(1,frame/fade,(frames-1-frame)/fade);
    for(let channel=0;channel<2;channel++) {
      const offset=frame*4+channel*2;
      // No auto-normalization; cap peaks and soften the beginning/end.
      const sample=Math.round(Math.max(-10000,Math.min(10000,data.readInt16LE(offset)*gain))*envelope);
      out.writeInt16LE(sample,offset);
    }
  }
  return out;
}
export async function synthesize(name,signal,words=[],personalReading=null) {
  signal.throwIfAborted();
  const text=announcementText(name,words,personalReading),hash=createHash('sha256').update('zundamon-dictionaries-v2:'+text).digest('hex');
  const cache=resolve('data/voice-cache'),file=resolve(cache,`${hash}.wav`);
  await mkdir(cache,{recursive:true});
  try {const wav=await readFile(file);gentlePcm(wav);signal.throwIfAborted();return wav;}
  catch(error){if(error.name==='AbortError')throw error;}
  const python=process.env.VOICEVOX_PYTHON || (existsSync('.voicevox-venv/bin/python')?resolve('.voicevox-venv/bin/python'):'python3');
  const wav=await new Promise((done,fail)=>{
    const combined=AbortSignal.any([signal,AbortSignal.timeout(60000)]);
    const child=spawn(python,[fileURLToPath(new URL('../scripts/synthesize.py',import.meta.url))],{signal:combined,killSignal:'SIGKILL',stdio:['pipe','pipe','pipe'],env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'}});
    const chunks=[];let size=0,stderr='';
    child.on('error',fail);
    child.stdin.on('error',()=>{});
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>4*1024*1024){child.kill('SIGKILL');fail(new Error('音声が長すぎます。'));}else chunks.push(chunk);});
    child.stderr.on('data',chunk=>{if(stderr.length<2000)stderr+=chunk.toString();});
    child.on('close',code=>{
      if(combined.aborted){fail(new Error('音声生成がキャンセルまたはタイムアウトしました。'));return;}
      if(code!==0){console.error('VOICEVOX生成失敗:',stderr.slice(-800));fail(new Error('ローカルVOICEVOXを準備してください。'));return;}
      done(Buffer.concat(chunks));
    });
    child.stdin.end(JSON.stringify({text}));
  });
  gentlePcm(wav);signal.throwIfAborted();
  await writeFile(`${file}.tmp`,wav);await rename(`${file}.tmp`,file);
  const files=(await readdir(cache)).filter(x=>/^[a-f0-9]{64}\.wav$/.test(x));
  if(files.length>64){const entries=await Promise.all(files.map(async x=>({path:resolve(cache,x),time:(await stat(resolve(cache,x))).mtimeMs})));entries.sort((a,b)=>a.time-b.time);for(const item of entries.slice(0,entries.length-64))await unlink(item.path);}
  return wav;
}
