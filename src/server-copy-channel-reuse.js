import {ChannelType as C,PermissionsBitField} from 'discord.js';
import {ServerNetworkError,snowflake} from './server-network-store.js';
export const preservedChannelIds=data=>[...new Set(data.copies.filter(c=>c.review).flatMap(c=>[c.staging,c.review.step==='reset-channel'?c.review.channel:null]).filter(snowflake))];
export function channelReusePlan(source,target,preserved=[]){
 if(!target.community)return {reuseChannels:{},freezeChannels:[]};
 const roles=['rulesChannel','publicUpdatesChannel'],from=roles.map(k=>source.settings?.[k]),to=roles.map(k=>target.settings?.[k]);
 const original=new Map(source.channels.map(c=>[c.id,c])),existing=new Map(target.channels.map(c=>[c.id,c]));
 if(from.some(id=>!snowflake(id)||original.get(id)?.type!==C.GuildText)||to.some(id=>!snowflake(id)||existing.get(id)?.type!==C.GuildText))throw new ServerNetworkError('メインとサブの必須チャンネルを通常テキストチャンネルとして確認できません。削除は開始しません。');
 const keep=[...new Set([...to,...preserved.filter(id=>existing.has(id))])];
 if(keep.some(id=>existing.get(id)?.type!==C.GuildText))throw new ServerNetworkError('保持する必須チャンネルの種類を確認してください。削除は開始しません。');
 const candidates=[...new Set([...from,...source.channels.filter(c=>c.type===C.GuildText).map(c=>c.id)])];
 if(candidates.length<keep.length)throw new ServerNetworkError(`保持する必須・保護チャンネル${keep.length}件に対し、コピー元の通常テキストチャンネルは${candidates.length}件です。既存IDを安全に対応付けできないため削除しません。`);
 const reuseChannels={},used=new Set();for(let i=0;i<roles.length;i++)if(!reuseChannels[from[i]]&&!used.has(to[i])){reuseChannels[from[i]]=to[i];used.add(to[i]);}
 for(const targetId of keep)if(!used.has(targetId)){const sourceId=candidates.find(id=>!reuseChannels[id]);reuseChannels[sourceId]=targetId;used.add(targetId);}
 const base=target.roles.find(r=>r.id===target.id);if(!base)throw new ServerNetworkError('サブの@everyone権限を確認できません。削除は開始しません。');
 const mask=[...source.roles,...target.roles].reduce((mask,r)=>mask|BigInt(r.permissions),PermissionsBitField.All);
 // Freeze the old effective everyone permissions before changing global permissions or removing roles.
 const freezeChannels=keep.map(id=>{const channel=existing.get(id),overwrite=channel.overwrites.find(o=>o.id===target.id),allow=(BigInt(base.permissions)&~BigInt(overwrite?.deny??0))|BigInt(overwrite?.allow??0);return {id,permissionOverwrites:[...channel.overwrites.filter(o=>o.id!==target.id),{id:target.id,type:0,allow:String(allow),deny:String(mask&~allow)}]};});
 return {reuseChannels,freezeChannels};
}
