import {createHash} from 'node:crypto';
import {ServerNetworkError,snowflake} from './server-network-store.js';
import {networkRead,networkWrite,networkDiagnostic} from './server-network-fault.js';
import {moderationSnapshot} from './server-copy-moderation.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value??null)).digest('hex');
const operationId=c=>typeof c?.operation==='string'?c.operation.match(/^reset-automod:(\d{17,20})$/)?.[1]:undefined;
export const recoverableAutoMod=c=>!!c&&c.mode==='replace'&&!c.review&&['stopped','uncertain'].includes(c.state)&&!!operationId(c)&&['channels','tags','emojis','stickers','sounds','moderation'].every(key=>Object.keys(c[key]??{}).length===0);
async function inspect({store,authority,id,owner,check}){
 await check();const c=store.get().copies.find(c=>c.id===id);if(!recoverableAutoMod(c)||c.owner!==owner)throw new ServerNetworkError('この記録はAutoMod削除の確認では解決できません。別の結果不明の操作は保持します。');
 const {source,target}=await authority(owner);await networkRead('sub-guild',()=>target.fetch());if(source.id!==c.source||target.id!==c.target||target.id!==store.get().sub||target.ownerId!==owner)throw new ServerNetworkError('元の実行者・現在のサブ所有者とコピー対象を確認してください。');
 const sourceRoles=await networkRead('main-roles',()=>source.roles.fetch()),targetRoles=await networkRead('sub-roles',()=>target.roles.fetch());
 if(c.roles[source.id]!==target.id||Object.entries(c.roles).some(([from,to])=>from!==source.id&&(!sourceRoles.get(from)?.managed||!targetRoles.get(to)?.managed||!sourceRoles.get(from)?.tags?.botId||sourceRoles.get(from).tags.botId!==targetRoles.get(to)?.tags?.botId)))throw new ServerNetworkError('作成済みロールの可能性があるため、AutoModの確認だけでは解決しません。');
 const ruleId=operationId(c),rules=await networkRead('sub-automod',()=>target.autoModerationRules.fetch());if(!(rules instanceof Map))throw new ServerNetworkError('AutoModの取得結果を確認できません。記録を保持します。');
 const rule=rules.get(ruleId);if(rule&&(rule.id!==ruleId||rule.guild?.id!==target.id))throw new ServerNetworkError('AutoModのサーバーまたはIDが一致しません。');
 const fingerprint=rule?await networkRead('sub-automod',()=>hash(moderationSnapshot(target,new Map([[ruleId,rule]])))):null;
 await check();if(hash(store.get().copies.find(x=>x.id===id))!==hash(c))throw new ServerNetworkError('処理記録が変わりました。確認し直してください。');
 return {target,record:c,plan:{id,owner,target:target.id,rule:ruleId,record:hash(c),fingerprint,exists:!!rule,name:rule?.name??'',trigger:rule?.triggerType??null,enabled:!!rule?.enabled}};
}
export async function inspectAutoModRecovery({store,authority,id,owner,check=()=>{}}){return (await inspect({store,authority,id,owner,check})).plan;}
export async function resolveAutoModRecovery({store,authority,plan,owner,confirm,check=()=>{}}){
 if(!plan||!snowflake(plan.target)||plan.owner!==owner||confirm!==plan.target)throw new ServerNetworkError('確認対象のサブサーバーIDが一致しません。');
 const verify=async()=>{const current=await inspect({store,authority,id:plan.id,owner,check});if(current.plan.target!==plan.target||current.plan.rule!==plan.rule||current.plan.record!==plan.record||current.plan.fingerprint!==plan.fingerprint||current.plan.exists!==plan.exists)throw new ServerNetworkError('処理記録または対象ルールが変わりました。AutoModの結果を確認し直してください。');return current;};
 await verify();let expected=plan.record;
 const failure=async e=>{const info=networkDiagnostic('copy-apply',e);await store.update(d=>{const c=d.copies.find(c=>c.id===plan.id);if(hash(c)!==expected)return;c.lastFailure={step:'reset-automod',code:info.code,at:Date.now()};c.state='uncertain';c.code='API_UNKNOWN';}).catch(()=>{});};
 if(plan.exists){
  // A fresh existence check and explicit destination-ID confirmation permit only this same-ID DELETE.
  await store.update(d=>{const c=d.copies.find(c=>c.id===plan.id);c.state='uncertain';c.code='API_UNKNOWN';c.at=Date.now();},verify);
  expected=hash(store.get().copies.find(c=>c.id===plan.id));
  try{
   const fresh=await inspect({store,authority,id:plan.id,owner,check});if(fresh.plan.record!==expected||fresh.plan.fingerprint!==plan.fingerprint||!fresh.plan.exists)throw new ServerNetworkError('削除直前に記録またはルールが変わりました。再確認してください。');
   await networkWrite(`reset-automod:${plan.rule}`,()=>fresh.target.autoModerationRules.delete(plan.rule,'管理者が対象IDを再確認したAutoMod削除'));
  }catch(e){await failure(e);throw e;}
 }
 const absent=async()=>{const proof=await inspect({store,authority,id:plan.id,owner,check});if(proof.plan.record!==expected||proof.plan.target!==plan.target||proof.plan.rule!==plan.rule||proof.plan.exists)throw new ServerNetworkError('対象ルールの削除完了を確認できません。記録を保持し、自動再送しません。');};
 try{await absent();await store.update(d=>{const c=d.copies.find(c=>c.id===plan.id);c.review={step:'reset-automod',rule:plan.rule,at:Date.now()};c.operation=null;c.state='stopped';c.code='STOPPED';},absent);}catch(e){await failure(e);throw e;}
 return store.get().copies.find(c=>c.id===plan.id);
}
