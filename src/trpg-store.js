import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

export const MAX_TXT=256*1024;
export const MAX_STORE=32*1024*1024;
export function iacharaUrl(value) {
  const u=new URL(String(value).trim());
  if(u.protocol!=='https:' || u.hostname!=='iachara.com' || u.port || u.username || u.password || u.search || u.hash || !/^\/view\/\d{1,12}\/?$/.test(u.pathname))throw new Error('いあきゃらの共有URL（https://iachara.com/view/数字）を入力してください。');
  return `https://iachara.com/view/${u.pathname.split('/')[2]}`;
}
export function roomUrl(value) {
  const u=new URL(String(value).trim());
  if(u.protocol!=='https:' || u.hostname!=='ccfolia.com' || u.port || u.username || u.password || u.search || u.hash || !/^\/rooms\/[A-Za-z0-9_-]{1,128}\/?$/.test(u.pathname))throw new Error('ココフォリアの卓URL（https://ccfolia.com/rooms/…）を入力してください。');
  return u.href;
}
const key=v=>String(v).normalize('NFKC').trim().toLowerCase();
export const searchScenarios=(items,query)=>items.filter(x=>key(x.name).includes(key(query)));
export function ownCharacter(data,id,userId,panelId,isAdmin=false) {
  const c=data.characters.find(x=>x.id===id && (x.ownerId===userId || isAdmin) && (!panelId || x.panelId===panelId));
  if(!c)throw new Error('このキャラシは操作できません。');return c;
}
// Explicit whitelist: never return TXT, timestamps, notes or backups to shared panels.
export function visibleCharacters(data,panelId,userId,isAdmin=false) {
  const panel=data.panels.find(x=>x.id===panelId);
  if(!panel)throw new Error('パネルが見つかりません。');
  return data.characters.filter(c=>c.panelId===panelId && (panel.mode==='shared' || c.ownerId===userId || isAdmin)).map(c=>({id:c.id,name:c.name,url:c.url}));
}
export class TrpgStore {
  tail=Promise.resolve(); data={version:1,scenarios:[],panels:[],characters:[]};
  constructor(path){this.path=path;}
  async load(){try{const raw=await readFile(this.path,'utf8');if(Buffer.byteLength(raw)>MAX_STORE)throw new Error('卓管理データの容量が上限を超えています。');const d=JSON.parse(raw);if(d.version!==1 || !['scenarios','panels','characters'].every(k=>Array.isArray(d[k])) || d.panels.some(p=>!['secret','shared'].includes(p.mode)) || d.characters.some(c=>typeof c.txt!=='string' || Buffer.byteLength(c.txt)>MAX_TXT || !d.panels.some(p=>p.id===c.panelId)))throw new Error('卓管理データを読み込めません。');this.data=d;}catch(e){if(e.code!=='ENOENT')throw e;}return this;}
  get(){return structuredClone(this.data);}
  update(fn){const job=this.tail.then(async()=>{const d=this.get();const result=fn(d);const raw=JSON.stringify(d);if(Buffer.byteLength(raw)>MAX_STORE)throw new Error('卓管理データの合計容量は32MBまでです。');await mkdir(dirname(this.path),{recursive:true});const temp=`${this.path}.tmp`;await writeFile(temp,raw,{mode:0o600});await rename(temp,this.path);this.data=d;return result;});this.tail=job.catch(()=>{});return job;}
  async scenario(name,url){name=String(name).trim();if(!name || name.length>100)throw new Error('シナリオ名は100文字以内で入力してください。');url=roomUrl(url);return this.update(d=>{const old=d.scenarios.find(x=>key(x.name)===key(name));if(old){old.name=name;old.url=url;return old.id;}if(d.scenarios.length>=200)throw new Error('シナリオは200件まで登録できます。');const id=randomUUID();d.scenarios.push({id,name,url});return id;});}
  async addPanel(channelId,mode){if(!['secret','shared'].includes(mode))throw new Error('秘匿または共有を選んでください。');return this.update(d=>{if(d.panels.length>=30)throw new Error('パネルは30件まで設置できます。');const id=randomUUID();d.panels.push({id,channelId,messageId:null,mode});return id;});}
  async saveCharacter(panelId,ownerId,url,result){url=iacharaUrl(url);if(!result.name?.trim() || result.name.length>100 || typeof result.txt!=='string' || !result.txt.trim() || Buffer.byteLength(result.txt)>MAX_TXT)throw new Error('キャラ名・TXTの形式やサイズを確認できませんでした。');return this.update(d=>{if(!d.panels.some(p=>p.id===panelId))throw new Error('パネルが見つかりません。');let c=d.characters.find(x=>x.panelId===panelId && x.ownerId===ownerId && x.url===url);if(!c){if(d.characters.length>=100 || d.characters.filter(x=>x.ownerId===ownerId).length>=10)throw new Error('登録上限は本人10件・サーバー100件です。');c={id:randomUUID(),panelId,ownerId,url};d.characters.push(c);}Object.assign(c,{name:result.name.trim(),txt:result.txt,updatedAt:Date.now()});return c.id;});}
}
