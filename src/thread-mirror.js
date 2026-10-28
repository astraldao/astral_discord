import {randomUUID} from 'node:crypto';
import {AuditLogEvent} from 'discord.js';
import {mirrorPostHash,prepareMirrorPost,mirrorPostMatches,MirrorMediaLimitError} from './thread-mirror-post.js';
import {legacyMirrorPost,legacyThreadName} from './thread-mirror-legacy.js';
import {ChannelType as C,PermissionFlagsBits as P} from 'discord.js';
import {ServerNetworkError} from './server-network-store.js';
const types=new Set([C.GuildText,C.GuildAnnouncement,C.GuildForum,C.GuildMedia]);
const values=x=>[...(x?.values?.()??[])];
export const mirrorThreadName=t=>String(t.name);
export {mirrorPost} from './thread-mirror-post.js';
export async function inspectMirror(source,target,sourceId,targetId){
 const [a,b]=await Promise.all([source.channels.fetch(sourceId,{force:true}),target.channels.fetch(targetId,{force:true})]);
 if(!a||!b||a.guildId!==source.id||b.guildId!==target.id||!types.has(a.type)||a.type!==b.type)throw new ServerNetworkError('両サーバーから同じ種類のテキスト/アナウンス/フォーラム/メディアを選んでください。');
 const tags={};for(const tag of a.availableTags??[]){const matches=(b.availableTags??[]).filter(x=>x.name===tag.name&&x.moderated===tag.moderated);if(matches.length!==1)throw new ServerNetworkError('コピー先に同名・同じ要承認設定のタグが必要です。タグを揃えてください。');tags[tag.id]=matches[0].id;}
 return {source:a,target:b,tags};
}
export function createThreadMirror({client,store,authority,activity=()=>()=>{},enabled=()=>true,readAttachment}){
 const tails=new Map(),pending=new Map();let closed=false;
 const get=id=>store.get().links.find(l=>l.id===id);
 const pause=async(id,code)=>store.update(d=>{const l=d.links.find(l=>l.id===id);if(l){l.state='paused';l.code=code;l.revision++;l.at=Date.now();}});
 const guard=async(id,rev)=>{const l=get(id);if(closed||!enabled()||l?.state!=='active'||l.revision!==rev)throw new ServerNetworkError('同期は停止しています。');const {source,target}=await authority(l.owner);const pair=await inspectMirror(source,target,l.source,l.target);const current=get(id);if(closed||!enabled()||current?.state!=='active'||current.revision!==rev)throw new ServerNetworkError('同期設定が変わりました。');return {l:current,...pair};};
 const modify=(id,fn,check=()=>{})=>store.update(d=>{const l=d.links.find(l=>l.id===id);if(!l)throw new ServerNetworkError('同期設定がありません。');fn(l);},check);
 const prepare=message=>prepareMirrorPost(message,{read:readAttachment});
 const readable=async(thread,owner)=>{const [actor,bot]=await Promise.all([thread.guild.members.fetch({user:owner,force:true}),thread.guild.members.fetchMe({force:true})]);if(!thread.permissionsFor(actor)?.has([P.ViewChannel,P.ReadMessageHistory])||!thread.permissionsFor(bot)?.has([P.ViewChannel,P.ReadMessageHistory]))throw new ServerNetworkError('元スレッドを閲覧できません。');};
 async function write(id,rev,kind,source,operation,record=()=>{},verify=()=>{},digest){
  const intent={kind,source,format:'plain',token:randomUUID(),...(digest?{digest}:{})};
  await modify(id,l=>{if(l.operation)throw new ServerNetworkError('前の処理の結果が不明です。');l.operation=intent;},async()=>{await guard(id,rev);await verify();});
  const current=get(id);if(closed||!enabled()||current?.state!=='active'||current.revision!==rev)throw new ServerNetworkError('同期設定が変わりました。');await guard(id,rev);await verify();const latest=get(id);if(closed||!enabled()||latest?.state!=='active'||latest.revision!==rev)throw new ServerNetworkError('同期設定が変わりました。');const result=await operation(intent);
  // Recording an acknowledged write must survive a concurrent pause; never send it twice.
  await modify(id,l=>{record(l,result);l.operation=null;l.at=Date.now();});return result;
 }
 async function destination(l,target,sourceId){const dest=await target.guild.channels.fetch(l.threads[sourceId],{force:true});if(!dest||dest.parentId!==l.target||dest.guildId!==target.guildId||dest.ownerId!==client.user.id)throw new ServerNetworkError('同期先スレッドの所属と作成者を確認してください。');return dest;}
 async function ownMessage(dest,id){const m=await dest.messages.fetch({message:id,force:true,cache:false});if(m.author.id!==client.user.id)throw new ServerNetworkError('Bot自身の同期投稿以外は操作しません。');return m;}
 async function ensureThread(id,rev,sourceThread){
  let {l,target}=await guard(id,rev);if(l.threads[sourceThread.id])return destination(l,target,sourceThread.id);
  if([C.GuildForum,C.GuildMedia].includes(target.type)&&Object.keys(l.messages).length>=2000){await pause(id,'LIMIT');throw new ServerNetworkError('同期投稿数の上限です。');}
  if(Object.keys(l.threads).length>=200){await pause(id,'LIMIT');throw new ServerNetworkError('同期スレッド数の上限です。');}
  const t=await sourceThread.fetch(true);if(t.type===C.PrivateThread||t.parentId!==l.source)throw new ServerNetworkError('公開スレッド以外は同期しません。');
  const appliedTags=(t.appliedTags??[]).map(tag=>{if(!l.tags[tag])throw new ServerNetworkError('タグの対応が変更されました。');return l.tags[tag];});
  const options={name:mirrorThreadName(t),autoArchiveDuration:t.autoArchiveDuration,rateLimitPerUser:t.rateLimitPerUser??0,reason:'管理者設定による片方向同期'};
  if([C.GuildForum,C.GuildMedia].includes(target.type)){const first=await t.fetchStarterMessage({force:true});if(!first)throw new ServerNetworkError('先頭の投稿を取得できません。');const digest=mirrorPostHash(first);options.message=await prepare(first);options.appliedTags=appliedTags;
   return write(id,rev,'thread',t.id,intent=>target.threads.create({...options,reason:`astral-sync:${intent.token}`}),(record,created)=>{record.threads[t.id]=created.id;record.messages[first.id]=created.id;record.messageThreads[first.id]=t.id;(record.postHashes??={})[first.id]=digest;},()=>readable(t,l.owner),digest);
  }
  options.type=target.type===C.GuildAnnouncement?C.AnnouncementThread:C.PublicThread;
  let first=null;try{first=await t.fetchStarterMessage({force:true,cache:false});}catch(e){if(e.code!==10008)throw e;}
  if(first&&!first.system&&Object.keys(l.messages).length>=2000){await pause(id,'LIMIT');throw new ServerNetworkError('同期投稿数の上限です。');}
  const created=await write(id,rev,'thread',t.id,intent=>target.threads.create({...options,reason:`astral-sync:${intent.token}`}),(record,result)=>{record.threads[t.id]=result.id;},()=>readable(t,l.owner));
  if(first&&!first.system){const digest=mirrorPostHash(first),post=await prepare(first);await write(id,rev,'message',first.id,()=>created.send({...post,nonce:first.id,enforceNonce:true}),(record,sent)=>{record.messages[first.id]=sent.id;record.messageThreads[first.id]=t.id;(record.postHashes??={})[first.id]=digest;},()=>readable(t,l.owner),digest);}return created;
 }
 async function originalMessage(thread,id){if(id===thread.id){try{const first=await thread.fetchStarterMessage({force:true,cache:false});if(first)return first;}catch(e){if(e.code!==10008)throw e;}}return thread.messages.fetch({message:id,force:true,cache:false});}
 async function upsert(id,rev,message,remove=false){
  let {l,source,target}=await guard(id,rev);
  const threadId=message.channelId===l.source?l.messageThreads[message.id]:message.channelId;
  if(remove){if(!l.messages[message.id]||!l.threads[threadId])return;const dest=await destination(l,target,threadId);const mid=l.messages[message.id];try{await ownMessage(dest,mid);}catch(e){if(e.code!==10008)throw e;await modify(id,r=>{delete r.messages[message.id];delete r.messageThreads[message.id];if(r.postHashes)delete r.postHashes[message.id];},()=>guard(id,rev));return;}await write(id,rev,'delete',message.id,async()=>{try{return await dest.messages.delete(mid);}catch(e){if(e.code!==10008)throw e;}},record=>{delete record.messages[message.id];delete record.messageThreads[message.id];if(record.postHashes)delete record.postHashes[message.id];});return;}
  const thread=await source.guild.channels.fetch(threadId,{force:true});
  if(!thread?.isThread?.()||thread.parentId!==l.source||thread.type===C.PrivateThread)return;
  let fresh;try{fresh=await originalMessage(thread,message.id);}catch(e){if(e.code!==10008)throw e;if(l.messages[message.id])await upsert(id,rev,message,true);return;}if(fresh.system)return;
  // Check current source read permissions for every publication, not only at link time.
  await readable(thread,l.owner);
  const extra=!l.messages[fresh.id]?1:0,starter=!l.threads[thread.id]&&[C.GuildForum,C.GuildMedia].includes(target.type)&&fresh.id!==thread.id?1:0;if(Object.keys(l.messages).length+extra+starter>2000){await pause(id,'LIMIT');throw new ServerNetworkError('同期投稿数の上限です。');}
  const dest=await ensureThread(id,rev,thread);l=get(id);
  if(dest.archived||dest.locked)await write(id,rev,'metadata',thread.id,()=>dest.edit({archived:false,locked:false,reason:'同期投稿の差分反映'}));
  const known=l.messages[fresh.id];if(!known&&Object.keys(l.messages).length>=2000){await pause(id,'LIMIT');throw new ServerNetworkError('同期メッセージ数の上限です。');}
  const digest=mirrorPostHash(fresh);if(known)await ownMessage(dest,known);
  if(!known||l.postHashes?.[fresh.id]!==digest){const post=await prepare(fresh);if(known)await write(id,rev,'edit',fresh.id,()=>dest.messages.edit(known,post),record=>{(record.postHashes??={})[fresh.id]=digest;},()=>readable(thread,l.owner),digest);
  else await write(id,rev,'message',fresh.id,()=>dest.send({...post,nonce:fresh.id,enforceNonce:true}),(record,sent)=>{record.messages[fresh.id]=sent.id;record.messageThreads[fresh.id]=thread.id;(record.postHashes??={})[fresh.id]=digest;},()=>readable(thread,l.owner),digest);}
  if(thread.archived||thread.locked)await write(id,rev,'metadata',thread.id,()=>dest.edit({archived:thread.archived,locked:thread.locked,reason:'同期元の状態に戻す'}));
 }
 async function metadata(id,rev,thread,remove=false){
  const {l,target}=await guard(id,rev);if(thread.type===C.PrivateThread||thread.parentId!==l.source)return;
  if(remove){const tid=l.threads[thread.id];if(!tid)return;try{await destination(l,target,thread.id);}catch(e){if(e.code!==10003)throw e;}await write(id,rev,'delete',thread.id,async()=>{try{return await target.guild.channels.delete(tid,'同期元スレッド削除');}catch(e){if(e.code!==10003)throw e;}},record=>{delete record.threads[thread.id];for(const [mid,sid]of Object.entries(record.messageThreads))if(sid===thread.id){delete record.messages[mid];delete record.messageThreads[mid];if(record.postHashes)delete record.postHashes[mid];}});return;}
  const fresh=await thread.fetch(true),dest=await ensureThread(id,rev,fresh);
  const tags=(fresh.appliedTags??[]).map(t=>{if(!l.tags[t])throw new ServerNetworkError('タグの対応を確認してください。');return l.tags[t];});
  await write(id,rev,'metadata',fresh.id,()=>dest.edit({name:mirrorThreadName(fresh),archived:fresh.archived,locked:fresh.locked,rateLimitPerUser:fresh.rateLimitPerUser??0,autoArchiveDuration:fresh.autoArchiveDuration,...([C.GuildForum,C.GuildMedia].includes(target.type)?{appliedTags:tags}:{}),reason:'同期元の変更を反映'}));
 }
 function enqueue(link,operation){
  if(closed||!enabled()||link.state!=='active')return Promise.resolve();
  if((pending.get(link.id)??0)>=100){void pause(link.id,'LIMIT').catch(()=>{});return Promise.resolve();}
  pending.set(link.id,(pending.get(link.id)??0)+1);
  const run=(tails.get(link.id)??Promise.resolve()).then(async()=>{if(get(link.id)?.state!=='active')return;const finish=activity();try{await operation(link.revision);}catch(e){const current=get(link.id);if(current?.state==='active'||current?.operation){if(!current?.operation&&(closed||!enabled()))await modify(link.id,x=>{x.code='RESTART';x.revision++;}).catch(()=>{});else await pause(link.id,current?.operation?'API_UNKNOWN':e instanceof MirrorMediaLimitError?'LIMIT':'PERMISSION').catch(()=>{});}}finally{finish();}}).finally(()=>pending.set(link.id,Math.max(0,(pending.get(link.id)??1)-1)));
  tails.set(link.id,run.catch(()=>{}));return run;
 }
 const forMessage=(m,remove)=>Promise.all(store.get().links.filter(l=>m.guildId===store.get().primary&&(m.channel?.parentId===l.source||Object.hasOwn(l.threads,m.channelId)||m.channelId===l.source&&l.messageThreads[m.id]===m.id)).map(l=>enqueue(l,rev=>upsert(l.id,rev,m,remove))));
 return {get busy(){return [...pending.values()].some(n=>n>0);},async close(){closed=true;await Promise.all(tails.values());},
  message:m=>forMessage(m,false),remove:m=>forMessage(m,true),
  channelDelete:c=>Promise.all(store.get().links.filter(l=>c.id===l.source||c.id===l.target).map(l=>pause(l.id,'SOURCE_MISSING'))),
  thread:(t,remove=false)=>Promise.all(store.get().links.filter(l=>t.guildId===store.get().primary&&t.parentId===l.source).map(l=>enqueue(l,rev=>metadata(l.id,rev,t,remove)))),
  async pause(id){await pause(id,'MANUAL');},
  async resume(id){const l=get(id);if(!l||l.state!=='paused'||(pending.get(id)??0)>0||l.operation)throw new ServerNetworkError('結果不明の処理が残っています。自動再送はできません。');const pair=await authority(l.owner);const channels=await inspectMirror(pair.source,pair.target,l.source,l.target);await modify(id,x=>{if(x.operation)throw new ServerNetworkError('前の処理結果を確認してください。');x.tags=channels.tags;x.state='active';x.code='READY';x.revision++;});return this.catchup(id);},
  async catchup(id){const l=get(id);return enqueue(l,async rev=>{const {source}=await guard(id,rev);const active=await source.threads.fetchActive(),archived=await source.threads.fetchArchived({type:'public',limit:20},false);const threads=[...new Map([...values(active.threads),...values(archived.threads)].filter(t=>t.parentId===l.source&&t.type!==C.PrivateThread).map(t=>[t.id,t])).values()].sort((a,b)=>BigInt(a.id)>BigInt(b.id)?-1:1).slice(0,20);
   for(const t of threads){const messages=await t.messages.fetch({limit:50,cache:false});for(const m of values(messages).reverse())await upsert(id,rev,m);for(const [mid,sid]of Object.entries(get(id).messageThreads))if(sid===t.id&&!messages.has(mid)){try{const older=await originalMessage(t,mid);await upsert(id,rev,older);}catch(e){if(e.code!==10008)throw e;await upsert(id,rev,{id:mid,channelId:t.id},true);}}await metadata(id,rev,t);}
   await modify(id,x=>{if(x.state==='active'&&x.revision===rev){x.code='READY';x.at=Date.now();}});
  });},
  async repair(id){const l=get(id);if(l?.state!=='paused'||(pending.get(id)??0)>0)throw new ServerNetworkError('停止後、進行中の操作が終わるまでお待ちください。');if(!l?.operation)throw new ServerNetworkError('復旧対象の処理はありません。');const {target,source}=await authority(l.owner);const pair=await inspectMirror(source,target,l.source,l.target);const op=l.operation;
   const repairCheck=async()=>{const current=get(id);if(closed||current?.state!=='paused'||current.revision!==l.revision||JSON.stringify(current.operation)!==JSON.stringify(op))throw new ServerNetworkError('復旧の対象が変わりました。');const currentPair=await authority(l.owner);if(currentPair.source.id!==source.id||currentPair.target.id!==target.id)throw new ServerNetworkError('復旧のサーバーが変わりました。');await inspectMirror(currentPair.source,currentPair.target,l.source,l.target);if(closed||get(id)?.revision!==l.revision||JSON.stringify(get(id)?.operation)!==JSON.stringify(op))throw new ServerNetworkError('復旧の対象が変わりました。');};
   await repairCheck();
   if(op.kind==='thread'){let audited=null;if(op.format==='plain'){const log=await target.fetchAuditLogs({type:AuditLogEvent.ThreadCreate,user:client.user.id,limit:100});const entries=values(log.entries).filter(e=>e.action===AuditLogEvent.ThreadCreate&&e.executorId===client.user.id&&e.reason===`astral-sync:${op.token}`);if(entries.length!==1)throw new ServerNetworkError('監査ログで作成結果を一意に確認できません。再送しません。');audited=entries[0].targetId;}const active=await pair.target.threads.fetchActive(),archived=await pair.target.threads.fetchArchived({type:'public',limit:100},false);const found=[...new Map([...values(active.threads),...values(archived.threads)].filter(t=>t.parentId===l.target&&t.ownerId===client.user.id&&(op.format==='plain'?t.id===audited:t.name.endsWith(` · ${op.source}`))).map(t=>[t.id,t])).values()];if(found.length!==1)throw new ServerNetworkError('対応するスレッドを一意に確認できません。再送せず、Discord側を確認してください。');let starter=null;if([C.GuildForum,C.GuildMedia].includes(pair.target.type)){starter=await found[0].messages.fetch({message:found[0].id,force:true,cache:false});if(starter.author.id!==client.user.id||op.format!=='plain'&&!starter.embeds?.some(e=>e.footer?.text===`astral-sync:${op.source}`))throw new ServerNetworkError('先頭投稿の対応を確認できません。');}
   await modify(id,x=>{if(JSON.stringify(x.operation)!==JSON.stringify(op))throw new ServerNetworkError('状態が変わりました。');x.threads[op.source]=found[0].id;if(starter){x.messages[op.source]=starter.id;x.messageThreads[op.source]=op.source;if(op.format==='plain'&&op.digest)(x.postHashes??={})[op.source]=op.digest;}x.operation=null;x.code='MANUAL';x.revision++;},repairCheck);
   }else if(op.kind==='message'){
    const original=await source.channels.fetch(l.source,{force:true});let match=null,sourceThreadId=null;for(const [sid,tid] of Object.entries(l.threads)){const thread=await original.guild.channels.fetch(sid,{force:true});try{await originalMessage(thread,op.source);}catch(e){if(e.code===10008||e.code===10003)continue;throw e;}const dest=await destination(l,pair.target,sid),recent=await dest.messages.fetch({limit:100,cache:false}),found=values(recent).filter(m=>m.author.id===client.user.id&&(op.format==='plain'?String(m.nonce??'')===op.source:m.embeds?.some(e=>e.footer?.text===`astral-sync:${op.source}`)));if(found.length===1){match=found[0];sourceThreadId=sid;}break;}if(!match)throw new ServerNetworkError('送信結果を一意に確認できません。再送せず、Discord側を確認してください。');await modify(id,x=>{if(JSON.stringify(x.operation)!==JSON.stringify(op))throw new ServerNetworkError('状態が変わりました。');x.messages[op.source]=match.id;x.messageThreads[op.source]=sourceThreadId;if(op.format==='plain'&&op.digest)(x.postHashes??={})[op.source]=op.digest;x.operation=null;x.code='MANUAL';x.revision++;},repairCheck);
   }else if(op.kind==='edit'){
    const sid=l.messageThreads[op.source];if(!sid||!l.messages[op.source])throw new ServerNetworkError('投稿の対応表を確認できません。');const original=await source.channels.fetch(sid,{force:true}),fresh=await originalMessage(original,op.source),dest=await destination(l,pair.target,sid),actual=await ownMessage(dest,l.messages[op.source]);
    await readable(original,l.owner);if(op.format==='plain'){if(op.digest&&op.digest!==mirrorPostHash(fresh)||!await mirrorPostMatches(actual,await prepare(fresh),{read:readAttachment}))throw new ServerNetworkError('編集内容の一致を確認できません。再送せず停止します。');}else{const wanted=legacyMirrorPost(fresh),a=actual.embeds?.[0],w=wanted.embeds[0];if(actual.content!==(wanted.content??'')||a?.description!==w.description||a?.author?.name!==w.author.name||a?.footer?.text!==w.footer.text||JSON.stringify((a?.fields??[]).map(f=>({name:f.name,value:f.value})))!==JSON.stringify(w.fields??[]))throw new ServerNetworkError('編集内容の一致を確認できません。再送せず停止します。');}
    await modify(id,x=>{if(JSON.stringify(x.operation)!==JSON.stringify(op))throw new ServerNetworkError('状態が変わりました。');if(op.format==='plain')(x.postHashes??={})[op.source]=mirrorPostHash(fresh);x.operation=null;x.code='MANUAL';x.revision++;},repairCheck);
   }else if(op.kind==='delete'){
    const isThread=!!l.threads[op.source],sid=isThread?op.source:l.messageThreads[op.source],destId=isThread?l.threads[op.source]:l.messages[op.source];if(!sid||!destId)throw new ServerNetworkError('削除の対応表を確認できません。');let absent=false;
    try{if(isThread)await target.channels.fetch(destId,{force:true});else{const dest=await destination(l,pair.target,sid);await ownMessage(dest,destId);}}catch(e){if(e.code===10003||!isThread&&e.code===10008)absent=true;else throw e;}
    if(!absent)throw new ServerNetworkError('同期先が残っています。自動で削除し直しません。');await modify(id,x=>{if(JSON.stringify(x.operation)!==JSON.stringify(op))throw new ServerNetworkError('状態が変わりました。');if(isThread){delete x.threads[op.source];for(const [mid,tid]of Object.entries(x.messageThreads))if(tid===sid){delete x.messages[mid];delete x.messageThreads[mid];if(x.postHashes)delete x.postHashes[mid];}}else{delete x.messages[op.source];delete x.messageThreads[op.source];if(x.postHashes)delete x.postHashes[op.source];}x.operation=null;x.code='MANUAL';x.revision++;},repairCheck);
   }else if(op.kind==='metadata'){
    const original=await source.channels.fetch(op.source,{force:true}),dest=await destination(l,pair.target,op.source),tags=(original.appliedTags??[]).map(t=>l.tags[t]).sort();if(dest.name!==(op.format==='plain'?mirrorThreadName(original):legacyThreadName(original))||dest.archived!==original.archived||dest.locked!==original.locked||dest.rateLimitPerUser!==original.rateLimitPerUser||dest.autoArchiveDuration!==original.autoArchiveDuration||JSON.stringify([...(dest.appliedTags??[])].sort())!==JSON.stringify(tags))throw new ServerNetworkError('スレッド設定の一致を確認できません。再送せず停止します。');await modify(id,x=>{if(JSON.stringify(x.operation)!==JSON.stringify(op))throw new ServerNetworkError('状態が変わりました。');x.operation=null;x.code='MANUAL';x.revision++;},repairCheck);
   }else throw new ServerNetworkError('結果を確認できません。自動再実行はしません。');
  },
 };
}
