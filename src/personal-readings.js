import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
export function personalReading(value){
  const reading=String(value).normalize('NFKC').trim().replace(/[ぁ-ゖ]/g,c=>String.fromCharCode(c.charCodeAt(0)+0x60));
  if(!/^[ァ-ヴー]{1,40}$/.test(reading))throw new Error('読み方は40文字以内のひらがな・カタカナ・長音で入力してください。');return reading;
}
const userId=value=>typeof value==='string' && /^\d{17,20}$/.test(value);
export class PersonalReadingsStore{
  data={version:1,items:[]};tail=Promise.resolve();
  constructor(path){this.path=path;}
  async load(){try{const raw=await readFile(this.path,'utf8');if(Buffer.byteLength(raw)>128*1024)throw new Error('本人用読み方データが大きすぎます。');const d=JSON.parse(raw);if(d.version!==1 || !Array.isArray(d.items) || d.items.length>1000 || new Set(d.items.map(x=>x.userId)).size!==d.items.length || d.items.some(x=>!userId(x.userId) || typeof x.reading!=='string' || personalReading(x.reading)!==x.reading))throw new Error('本人用読み方データを読み込めません。');this.data=d;}catch(e){if(e.code!=='ENOENT')throw e;}return this;}
  get(id){return this.data.items.find(x=>x.userId===id)?.reading??null;}
  set(id,value,expected){
    if(!userId(id))return Promise.reject(new Error('ユーザーIDが不正です。'));const reading=value===null?null:personalReading(value);
    const run=this.tail.then(async()=>{if(expected!==undefined && this.get(id)!==expected)throw new Error('読み方が変更されました。開き直してください。');const next=structuredClone(this.data);let item=next.items.find(x=>x.userId===id);
      if(reading===null)next.items=next.items.filter(x=>x.userId!==id);
      else if(item)item.reading=reading;
      else{if(next.items.length>=1000)throw new Error('本人用の読み方は1000人まで登録できます。');next.items.push({userId:id,reading});}
      await mkdir(dirname(this.path),{recursive:true});await writeFile(`${this.path}.tmp`,JSON.stringify(next),{mode:0o600});await rename(`${this.path}.tmp`,this.path);this.data=next;
    });this.tail=run.catch(()=>{});return run;
  }
}
