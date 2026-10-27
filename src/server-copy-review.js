import {ServerNetworkError} from './server-network-store.js';
import {networkRead} from './server-network-fault.js';
import {emptyOnboarding} from './server-copy-steps.js';
export const reviewablePreparation=c=>!!c&&c.mode==='replace'&&!c.review&&['uncertain','stopped'].includes(c.state)&&c.operation==='reset-onboarding'&&c.staging===null&&(c.completed===undefined||c.completed===0)&&['channels','tags','emojis','stickers','sounds','moderation'].every(key=>Object.keys(c[key]??{}).length===0);
// An old unknown empty PATCH cannot undo a later copy when both guilds still want that same empty state.
export async function reviewCopyPreparation({store,authority,id,owner,check=()=>{}}){
 const original=store.get().copies.find(c=>c.id===id);if(!reviewablePreparation(original)||original.owner!==owner)throw new ServerNetworkError('この記録は準備段階の確認だけでは解決できません。結果不明の削除・作成は再実行しません。');
 const signature=JSON.stringify(original);
 const verify=async()=>{await check();const c=store.get().copies.find(c=>c.id===id);if(JSON.stringify(c)!==signature||!reviewablePreparation(c))throw new ServerNetworkError('処理記録が変わりました。状態を開き直してください。');const {source,target}=await authority(owner);await networkRead('sub-guild',()=>target.fetch());if(source.id!==c.source||target.id!==c.target||target.id!==store.get().sub||target.ownerId!==owner)throw new ServerNetworkError('サブの所有者とコピー対象を確認してください。');
  const sourceRoles=await networkRead('main-roles',()=>source.roles.fetch()),targetRoles=await networkRead('sub-roles',()=>target.roles.fetch());
  if(c.roles[source.id]!==target.id||Object.entries(c.roles).some(([from,to])=>from!==source.id&&(!sourceRoles.get(from)?.managed||!targetRoles.get(to)?.managed||!sourceRoles.get(from)?.tags?.botId||sourceRoles.get(from).tags.botId!==targetRoles.get(to)?.tags?.botId)))throw new ServerNetworkError('作成済みロールの可能性があるため、準備段階の確認では解決しません。');
  const sourceOnboarding=await networkRead('main-onboarding',()=>source.fetchOnboarding()),onboarding=await networkRead('sub-onboarding',()=>target.fetchOnboarding());if(!emptyOnboarding(sourceOnboarding)||!emptyOnboarding(onboarding))throw new ServerNetworkError('メインとサブのオンボーディングが同じ空の停止状態ではないため、準備の完了を確認できません。既存ルールは変更せず、記録を保持します。');await check();
 };
 await verify();await store.update(d=>{const c=d.copies.find(c=>c.id===id);c.review={step:'reset-onboarding',at:Date.now()};c.operation=null;c.state='stopped';c.code='STOPPED';},verify);
 return store.get().copies.find(c=>c.id===id);
}
