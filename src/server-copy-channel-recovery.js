import {createHash} from 'node:crypto';
import {ChannelType as C} from 'discord.js';
import {networkRead} from './server-network-fault.js';
import {ServerNetworkError} from './server-network-store.js';
const hash=c=>createHash('sha256').update(JSON.stringify(c??null)).digest('hex');
export const blockedChannelId=c=>typeof c?.operation==='string'?c.operation.match(/^reset-channel:(\d{17,20})$/)?.[1]:undefined;
export const reviewableChannelFailure=c=>!!c&&c.mode==='replace'&&!c.review&&['stopped','uncertain'].includes(c.state)&&!!blockedChannelId(c)&&c.lastFailure?.step==='reset-channel'&&c.lastFailure.code==='DISCORD_50074'&&['channels','tags','emojis','stickers','sounds','moderation'].every(key=>Object.keys(c[key]??{}).length===0);
export async function reviewChannelFailure({store,authority,id,owner,check=()=>{}}){
 const original=store.get().copies.find(c=>c.id===id),signature=hash(original),channel=blockedChannelId(original);
 if(!reviewableChannelFailure(original)||original.owner!==owner)throw new ServerNetworkError('この記録は50074の停止確認では解決できません。結果不明の操作は保持します。');
 const verify=async()=>{await check();const c=store.get().copies.find(c=>c.id===id);if(hash(c)!==signature||!reviewableChannelFailure(c))throw new ServerNetworkError('処理記録が変わりました。確認し直してください。');
  const {source,target}=await authority(owner);await networkRead('sub-guild',()=>target.fetch());if(source.id!==c.source||target.id!==c.target||target.id!==store.get().sub||target.ownerId!==owner||!target.features?.includes('COMMUNITY'))throw new ServerNetworkError('元の実行者・現在のサブ所有者・コミュニティと対象IDを確認してください。');
  const sourceRoles=await networkRead('main-roles',()=>source.roles.fetch()),targetRoles=await networkRead('sub-roles',()=>target.roles.fetch());
  if(c.roles[source.id]!==target.id||Object.entries(c.roles).some(([from,to])=>from!==source.id&&(!sourceRoles.get(from)?.managed||!targetRoles.get(to)?.managed||!sourceRoles.get(from)?.tags?.botId||sourceRoles.get(from).tags.botId!==targetRoles.get(to)?.tags?.botId)))throw new ServerNetworkError('作成済みロールの可能性があるため、停止確認だけでは解決しません。');
  const channels=await networkRead('sub-channels',()=>target.channels.fetch());if(!(channels instanceof Map))throw new ServerNetworkError('チャンネル一覧を確認できません。記録を保持します。');const existing=channels.get(channel);if(existing&&(existing.guild?.id!==target.id||existing.type!==C.GuildText))throw new ServerNetworkError('停止対象のサーバーまたは種類が一致しません。');
  await networkRead('sub-guild',()=>target.fetch());await check();if(target.ownerId!==owner||target.id!==store.get().sub||!target.features?.includes('COMMUNITY'))throw new ServerNetworkError('サブの所有者・対象・コミュニティが変わりました。記録を保持します。');if(hash(store.get().copies.find(c=>c.id===id))!==signature)throw new ServerNetworkError('処理記録が変わりました。確認し直してください。');
 };
 await verify();await store.update(d=>{const c=d.copies.find(c=>c.id===id);c.review={step:'reset-channel',channel,at:Date.now()};c.operation=null;c.state='stopped';c.code='STOPPED';},verify);
 return store.get().copies.find(c=>c.id===id);
}
