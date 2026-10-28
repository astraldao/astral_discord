import {networkRead} from './server-network-fault.js';
import {ServerNetworkError} from './server-network-store.js';
export const compareCopyRoles=(a,b)=>(a.rawPosition??a.position)-(b.rawPosition??b.position)||(BigInt(a.id)>BigInt(b.id)?-1:a.id===b.id?0:1);
const hint='サブのDiscord設定 → ロールで、このBotのロールを通常ロールより上へ移動してから、停止記録を確認してください。管理者権限だけではロール階層の制限を回避できません。';
export async function orderCopiedRoles({snapshot,target,roles,check=()=>{}}){
 const desired=snapshot.roles.filter(r=>r.id!==snapshot.id&&!r.managed).map(r=>roles[r.id]);
 if(!desired.length)return;
 const read=async()=>{const all=await networkRead('sub-roles',()=>target.roles.fetch()),bot=await networkRead('sub-bot',()=>target.members.fetchMe({force:true}));if(!(all instanceof Map)||new Set(desired).size!==desired.length)throw new ServerNetworkError('コピーしたロールの対応を確認できません。');const copied=desired.map(id=>all.get(id));if(copied.some(r=>!r||r.managed||r.id===target.id||!Number.isSafeInteger(r.rawPosition)||r.rawPosition<1))throw new ServerNetworkError('コピーした通常ロールの現在位置を確認できません。');const highest=[...bot.roles.cache.keys()].map(id=>all.get(id)).filter(Boolean).sort(compareCopyRoles).at(-1);if(!highest||copied.some(r=>compareCopyRoles(r,highest)>=0))throw new ServerNetworkError(hint);return {copied,highest};};
 const {copied,highest}=await read(),current=[...copied].sort(compareCopyRoles);
 // New roles are created highest first. Preserve that order without an unnecessary PATCH.
 if(current.every((r,n)=>r.id===desired[n]))return;
 const slots=current.map(r=>r.rawPosition);
 if(new Set(slots).size!==slots.length||slots.at(-1)>=highest.rawPosition)throw new ServerNetworkError(hint+' 同じ位置番号のロールがあるため、自動で順序を確定できません。');
 const positions=copied.map(r=>r.rawPosition),botId=highest.id,botPosition=highest.rawPosition;await check();const verified=await read();if(verified.highest.id!==botId||verified.highest.rawPosition!==botPosition||verified.copied.some((r,n)=>r.rawPosition!==positions[n]))throw new ServerNetworkError('確認中にロール階層が変わりました。並び替えず停止します。');await target.roles.setPositions(desired.map((role,n)=>({role,position:slots[n]})));
 const after=await read();if(!after.copied.sort(compareCopyRoles).every((r,n)=>r.id===desired[n]))throw new ServerNetworkError('ロール順の反映を確認できません。自動で並び替えを再送しません。');
}
