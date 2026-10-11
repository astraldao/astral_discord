import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';

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
export const characterRevision=c=>createHash('sha256').update(JSON.stringify(c)).digest('hex');
export function answerUrl(value){
  if(!String(value).trim())return '';
  const u=new URL(String(value).trim());
  if(u.protocol!=='https:' || !['densuke.biz','www.densuke.biz'].includes(u.hostname) || u.port || u.username || u.password || u.hash || u.pathname!=='/list' || [...u.searchParams.keys()].some(k=>k!=='cd') || u.searchParams.getAll('cd').length!==1 || !/^[A-Za-z0-9]{1,128}$/.test(u.searchParams.get('cd')??''))throw new Error('伝助の回答用URL（https://densuke.biz/list?cd=…）を入力してください。編集用URLは登録しません。');
  u.hostname='densuke.biz';return u.href;
}
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
  tail=Promise.resolve(); data={version:1,scenarios:[],panels:[],characters:[],tables:[]};
  constructor(path){this.path=path;}
  async load(){try{const raw=await readFile(this.path,'utf8');if(Buffer.byteLength(raw)>MAX_STORE)throw new Error('卓管理データの容量が上限を超えています。');const d=JSON.parse(raw);d.tables??=[];if(d.version!==1 || !['scenarios','panels','characters','tables'].every(k=>Array.isArray(d[k])) || d.tables.length>100 || d.tables.some(t=>!t || typeof t.name!=='string' || !t.name.trim() || t.name.length>100 || !Array.isArray(t.characterIds) || t.characterIds.length>100 || t.characterIds.some(id=>!d.characters.some(c=>c.id===id)) || (t.scenarioId && !d.scenarios.some(x=>x.id===t.scenarioId)) || answerUrl(t.answerUrl)!==t.answerUrl) || d.panels.some(p=>!['secret','shared'].includes(p.mode)) || d.characters.some(c=>typeof c.txt!=='string' || Buffer.byteLength(c.txt)>MAX_TXT || !d.panels.some(p=>p.id===c.panelId)))throw new Error('卓管理データを読み込めません。');this.data=d;}catch(e){if(e.code!=='ENOENT')throw e;}return this;}
  get(){return structuredClone(this.data);}
  metadata(){const {characters,...rest}=this.data;return structuredClone({...rest,characters:characters.map(({txt,...c})=>c)});}
  character(id,userId,panelId,isAdmin=false){return structuredClone(ownCharacter(this.data,id,userId,panelId,isAdmin));}
  backupCharacters(userId,panelId,isAdmin=false){
    if(!panelId && !isAdmin)throw new Error('パネルから開いてください。');
    if(panelId && !this.data.panels.some(p=>p.id===panelId))throw new Error('パネルが見つかりません。');
    return this.data.characters.filter(c=>(!panelId || c.panelId===panelId) && (c.ownerId===userId || isAdmin)).map(c=>({...c}));
  }
  removeCharacter(id,userId,panelId,isAdmin,revision){return this.update(d=>{
    const c=ownCharacter(d,id,userId,panelId,isAdmin);
    if(!revision || characterRevision(c)!==revision)throw new Error('控えが更新されました。PCを開き直して確認してください。');
    d.characters=d.characters.filter(x=>x.id!==c.id);
    for(const t of d.tables??[])t.characterIds=t.characterIds.filter(x=>x!==c.id);
  });}
  table(id){const t=this.data.tables.find(x=>x.id===id);if(!t)throw new Error('卓セットが見つかりません。');return structuredClone(t);}
  saveTable(id,name,url,revision){name=String(name).trim();if(!name || name.length>100)throw new Error('卓名は100文字以内で入力してください。');url=answerUrl(url);return this.update(d=>{
    let t=id?d.tables.find(x=>x.id===id):null;if(id && !t)throw new Error('卓セットが見つかりません。');if(id && revision!==undefined && JSON.stringify(t)!==revision)throw new Error('卓セットが変更されました。開き直して編集してください。');
    if(!t){if(d.tables.length>=100)throw new Error('卓セットは100件までです。');t={id:randomUUID(),scenarioId:null,characterIds:[]};d.tables.push(t);}
    Object.assign(t,{name,answerUrl:url});return t.id;
  });}
  setTableScenario(id,scenarioId){return this.update(d=>{const t=d.tables.find(x=>x.id===id);if(!t || !d.scenarios.some(x=>x.id===scenarioId))throw new Error('卓またはシナリオが見つかりません。');t.scenarioId=scenarioId;});}
  changeTableCharacters(id,ids,remove=false){return this.update(d=>{const t=d.tables.find(x=>x.id===id);if(!t || !Array.isArray(ids) || !ids.length || ids.length>25 || ids.some(id=>!d.characters.some(c=>c.id===id)))throw new Error('参加PCを選び直してください。');t.characterIds=remove?t.characterIds.filter(id=>!ids.includes(id)):[...new Set([...t.characterIds,...ids])];});}
  removeTable(id,revision){return this.update(d=>{const t=d.tables.find(x=>x.id===id);if(!t || JSON.stringify(t)!==revision)throw new Error('卓セットが変更されました。開き直してください。');d.tables=d.tables.filter(x=>x.id!==id);});}
  update(fn){const job=this.tail.then(async()=>{const d=this.get();const result=fn(d);const raw=JSON.stringify(d);if(Buffer.byteLength(raw)>MAX_STORE)throw new Error('卓管理データの合計容量は32MBまでです。');await mkdir(dirname(this.path),{recursive:true});const temp=`${this.path}.tmp`;await writeFile(temp,raw,{mode:0o600});await rename(temp,this.path);this.data=d;return result;});this.tail=job.catch(()=>{});return job;}
  async scenario(name,url){name=String(name).trim();if(!name || name.length>100)throw new Error('シナリオ名は100文字以内で入力してください。');url=roomUrl(url);return this.update(d=>{const old=d.scenarios.find(x=>key(x.name)===key(name));if(old){old.name=name;old.url=url;return old.id;}if(d.scenarios.length>=200)throw new Error('シナリオは200件まで登録できます。');const id=randomUUID();d.scenarios.push({id,name,url});return id;});}
  editScenario(id,name,url,revision){name=String(name).trim();if(!name || name.length>100)throw new Error('シナリオ名は100文字以内で入力してください。');url=roomUrl(url);return this.update(d=>{
    const old=d.scenarios.find(x=>x.id===id);if(!old || JSON.stringify(old)!==revision)throw new Error('ベース卓が変更されました。選び直して編集してください。');
    if(d.scenarios.some(x=>x.id!==id && key(x.name)===key(name)))throw new Error('同じシナリオ名が別の登録で使われています。別の名前にしてください。');
    Object.assign(old,{name,url});return id;
  });}
  async addPanel(channelId,mode){if(!['secret','shared'].includes(mode))throw new Error('秘匿または共有を選んでください。');return this.update(d=>{if(d.panels.length>=30)throw new Error('パネルは30件まで設置できます。');const id=randomUUID();d.panels.push({id,channelId,messageId:null,mode});return id;});}
  async saveCharacter(panelId,ownerId,url,result,expectedId){url=iacharaUrl(url);if(!result.name?.trim() || result.name.length>100 || typeof result.txt!=='string' || !result.txt.trim() || Buffer.byteLength(result.txt)>MAX_TXT)throw new Error('キャラ名・TXTの形式やサイズを確認できませんでした。');return this.update(d=>{if(!d.panels.some(p=>p.id===panelId))throw new Error('パネルが見つかりません。');let c=d.characters.find(x=>x.panelId===panelId && x.ownerId===ownerId && x.url===url);if(expectedId && c?.id!==expectedId)throw new Error('PC登録が解除されました。更新を中止しました。');if(!c){if(d.characters.length>=100 || d.characters.filter(x=>x.ownerId===ownerId).length>=10)throw new Error('登録上限は本人10件・サーバー100件です。');c={id:randomUUID(),panelId,ownerId,url};d.characters.push(c);}Object.assign(c,{name:result.name.trim(),txt:result.txt,updatedAt:Date.now()});return c.id;});}
}
