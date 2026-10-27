import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
export class ServerNetworkError extends Error {}
export const networkMessage=e=>e instanceof ServerNetworkError?e.message:'処理結果を確認できませんでした。状態を確認してください。自動で再実行はしません。';
export const snowflake=value=>typeof value==='string'&&/^\d{17,20}$/.test(value);
const key=value=>typeof value==='string'&&/^[a-f0-9-]{12,36}$/.test(value);
const states=new Set(['active','paused','copying','complete','stopped','uncertain']);
const codes=new Set(['READY','MANUAL','RESTART','LIMIT','PERMISSION','SOURCE_MISSING','API_UNKNOWN','STORAGE','STOPPED','COMPLETE']);
const idMap=(map,max)=>map&&typeof map==='object'&&!Array.isArray(map)&&Object.keys(map).length<=max&&Object.entries(map).every(([a,b])=>snowflake(a)&&snowflake(b));
export function validateNetwork(d){
 if(!d||d.version!==1||!snowflake(d.primary)||(d.sub!==null&&(!snowflake(d.sub)||d.sub===d.primary))||!Array.isArray(d.links)||d.links.length>8||!Array.isArray(d.copies)||d.copies.length>10)throw new ServerNetworkError('サーバー連携の保存形式を確認してください。');
 const ids=new Set(),sources=new Set(),targets=new Set();
 for(const l of d.links){if(!l||!key(l.id)||ids.has(l.id)||!snowflake(l.owner)||!snowflake(l.source)||!snowflake(l.target)||sources.has(l.source)||targets.has(l.target)||!states.has(l.state)||!codes.has(l.code)||!idMap(l.threads,200)||!idMap(l.messages,2000)||!idMap(l.messageThreads,2000)||!idMap(l.tags,20)||l.source===l.target||!Number.isSafeInteger(l.revision)||l.revision<0||!Number.isSafeInteger(l.at)||l.at<0||l.operation!==null&&(!l.operation||!['thread','message','edit','delete','metadata'].includes(l.operation.kind)||!snowflake(l.operation.source)))throw new ServerNetworkError('スレッド連携の保存形式を確認してください。');ids.add(l.id);sources.add(l.source);targets.add(l.target);}
 for(const c of d.copies){if(!c||!key(c.id)||ids.has(c.id)||!snowflake(c.owner)||c.source!==d.primary||c.target!==d.sub||!states.has(c.state)||!codes.has(c.code)||c.mode!==undefined&&!['add','replace'].includes(c.mode)||c.staging!==undefined&&c.staging!==null&&!snowflake(c.staging)||!idMap(c.roles,250)||!idMap(c.channels,500)||!idMap(c.tags,10000)||!idMap(c.emojis,2500)||!idMap(c.stickers,100)||!idMap(c.sounds,250)||!idMap(c.moderation,100)||!Number.isSafeInteger(c.at)||c.at<0||c.operation!==null&&(!c.operation||typeof c.operation!=='string'||c.operation.length>80))throw new ServerNetworkError('コピー記録の保存形式を確認してください。');ids.add(c.id);}
 return d;
}
export class ServerNetworkStore {
 constructor(path,primary){this.path=path;this.value=validateNetwork({version:1,primary,sub:null,links:[],copies:[]});this.tail=Promise.resolve();}
 get(){return structuredClone(this.value);}
 async load(){try{const d=validateNetwork(JSON.parse(await readFile(this.path,'utf8')));if(d.primary!==this.value.primary)throw new ServerNetworkError('GUILD_IDと連携元が一致しません。設定を確認してください。');this.value=d;}catch(e){if(e.code!=='ENOENT')throw e;}return this;}
 update(change,check=()=>{}){const run=this.tail.then(async()=>{await check();const d=this.get();await change(d);validateNetwork(d);const temp=`${this.path}.${randomUUID()}.tmp`;try{if(this.path){await mkdir(dirname(this.path),{recursive:true,mode:0o700});await writeFile(temp,JSON.stringify(d)+'\n',{mode:0o600,flag:'wx'});}await check();if(this.path)await rename(temp,this.path);this.value=d;return this.get();}catch(e){if(e instanceof ServerNetworkError)throw e;throw new ServerNetworkError('連携状態を保存できませんでした。処理を止め、Discord側の結果を確認してください。');}finally{if(this.path)await unlink(temp).catch(()=>{});}});this.tail=run.catch(()=>{});return run;}
 async recover(){return this.update(d=>{for(const l of d.links)if(l.operation||l.state==='active'){l.state=l.operation?'paused':'active';l.code=l.operation?'API_UNKNOWN':'RESTART';l.revision++;}for(const c of d.copies)if(c.state==='copying'){c.state=c.operation?'uncertain':'stopped';c.code=c.operation?'API_UNKNOWN':'RESTART';}});}
}
