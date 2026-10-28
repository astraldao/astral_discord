import {createHash} from 'node:crypto';
import {MessageFlags} from 'discord.js';
import {BoundedBytes} from './bounded-bytes.js';
import {ServerNetworkError} from './server-network-store.js';
export const MIRROR_UPLOAD_LIMIT=10*1024*1024;
export class MirrorMediaLimitError extends ServerNetworkError {}
const values=x=>[...(x?.values?.()??[])];
const localUrl=(url,message)=>{const a=values(message.attachments).find(a=>[a.url,a.proxyURL].some(x=>x&&String(x).split('?')[0]===String(url).split('?')[0]));return a?`attachment://${a.name}`:url;};
const image=(x,message)=>x?.url?{url:localUrl(x.url,message)}:undefined;
// Only writable rich-embed fields. Provider/proxy dimensions are Discord-generated.
export function mirrorEmbeds(message){return (message.embeds??[]).filter(e=>!e.type||e.type==='rich').map(value=>{const e=value.toJSON?.()??value,result={};for(const key of ['title','description','url','timestamp','color'])if(e[key]!==undefined&&e[key]!==null)result[key]=e[key];if(e.author)result.author={name:e.author.name,...(e.author.url?{url:e.author.url}:{}),...(e.author.icon_url?{icon_url:e.author.icon_url}:{})};if(e.footer)result.footer={text:e.footer.text,...(e.footer.icon_url?{icon_url:e.footer.icon_url}:{})};if(e.fields?.length)result.fields=e.fields.map(f=>({name:f.name,value:f.value,inline:!!f.inline}));if(e.image?.url)result.image=image(e.image,message);if(e.thumbnail?.url)result.thumbnail=image(e.thumbnail,message);return result;});}
export function mirrorPost(message){
 const content=typeof message.content==='string'?message.content:'';
 if(content.length>2000)throw new MirrorMediaLimitError('同期元の本文がBotの投稿上限2000文字を超えています。省略せず停止します。');
 if(message.poll||message.stickers?.size||message.flags?.has?.(MessageFlags.IsComponentsV2)||message.components?.length)throw new ServerNetworkError('投票・スタンプ・操作部品を含む投稿は、そのまま再現できないため停止します。');
 const embeds=mirrorEmbeds(message);if(embeds.length>10)throw new MirrorMediaLimitError('埋め込み数がDiscordの投稿上限を超えています。');
 return {content:content||null,embeds,attachments:[],allowedMentions:{parse:[],repliedUser:false},components:[],flags:message.flags?.has?.(MessageFlags.SuppressEmbeds)?MessageFlags.SuppressEmbeds:0};
}
export const mirrorPostHash=message=>createHash('sha256').update(JSON.stringify({post:mirrorPost(message),attachments:values(message.attachments).map(a=>({id:a.id,name:a.name,size:a.size,description:a.description??null,spoiler:!!a.spoiler}))})).digest('hex');
export async function readMirrorAttachment(url,{fetcher=fetch,max=MIRROR_UPLOAD_LIMIT}={}){
 let u;try{u=new URL(url);}catch{throw new ServerNetworkError('添付ファイルのDiscord URLを確認してください。');}
 if(u.protocol!=='https:'||!['cdn.discordapp.com','media.discordapp.net'].includes(u.hostname)||u.port||u.username||u.password||u.hash||u.href.length>4096||!/^\/attachments\/\d{17,20}\/\d{17,20}\/[^/]+$/.test(u.pathname)||/\.(?:\.|%2e)(?:\/|$)/i.test(u.pathname))throw new ServerNetworkError('添付ファイルのDiscord URLを確認してください。');
 const collector=new BoundedBytes(max);let reader;
 try{const response=await fetcher(u,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok||!response.body)throw new ServerNetworkError('添付ファイルを取得できません。元の投稿を確認してください。');const declared=response.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>max)){await response.body.cancel().catch(()=>{});throw new MirrorMediaLimitError('添付ファイルが同期容量の上限を超えています。');}reader=response.body.getReader();for(;;){const {value,done}=await reader.read();if(done)break;if(value.byteLength>max-collector.length)throw new MirrorMediaLimitError('添付ファイルが同期容量の上限を超えています。');collector.append(value);}if(declared&&collector.length!==Number(declared))throw new ServerNetworkError('添付ファイルの受信が完了していません。');return collector.finish();}catch(e){if(e instanceof ServerNetworkError)throw e;throw new ServerNetworkError('添付ファイルを取得できません。通信と元の投稿を確認してください。');}finally{collector.dispose();if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();}}
}
export async function prepareMirrorPost(message,{read=readMirrorAttachment,max=MIRROR_UPLOAD_LIMIT}={}){
 const post=mirrorPost(message),attachments=values(message.attachments);if(attachments.length>10)throw new MirrorMediaLimitError('添付数がDiscordの投稿上限を超えています。');let total=0;
 for(const a of attachments){if(!Number.isSafeInteger(a.size)||a.size<0||a.size>max-total)throw new MirrorMediaLimitError('添付は1投稿合計10MiBまで同期できます。省略せず停止します。');if(typeof a.name!=='string'||!a.name.length||a.name.length>255||/[\u0000\r\n/\\]/u.test(a.name))throw new ServerNetworkError('添付ファイル名をそのまま再現できません。');total+=a.size;}
 if(!post.content&&!post.embeds.length&&!attachments.length)throw new ServerNetworkError('この投稿は本文・添付・再現可能な埋め込みがないため同期できません。');
 post.files=[];for(const a of attachments){const attachment=await read(a.url,{max:Math.max(1,a.size)});if(!Buffer.isBuffer(attachment)||attachment.length!==a.size)throw new ServerNetworkError('添付ファイルの容量が元の投稿と一致しません。');post.files.push({attachment,name:a.name,description:a.description??undefined});}return post;
}
export async function mirrorPostMatches(actual,wanted,{read=readMirrorAttachment}={}){
 if(actual.content!==(wanted.content??'')||JSON.stringify(mirrorEmbeds(actual))!==JSON.stringify(wanted.embeds)||!!actual.flags?.has?.(MessageFlags.SuppressEmbeds)!==!!(Number(wanted.flags)&MessageFlags.SuppressEmbeds))return false;
 const files=wanted.files??[],attachments=values(actual.attachments);if(attachments.length!==files.length)return false;
 for(let n=0;n<files.length;n++){const a=attachments[n],f=files[n];if(a.name!==f.name||a.size!==f.attachment.length||(a.description??'')!==(f.description??''))return false;const received=await read(a.url,{max:Math.max(1,a.size)});if(!Buffer.isBuffer(received)||!received.equals(f.attachment))return false;}return true;
}
