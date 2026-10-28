import {compareCopyRoles} from './server-copy-role-order.js';
import {channelReusePlan} from './server-copy-channel-reuse.js';
import {protectedRulePreparation} from './server-copy-moderation.js';
import {emptyOnboarding,emptyWelcome} from './server-copy-steps.js';
import {ChannelType as C,PermissionFlagsBits as P} from 'discord.js';
import {ServerNetworkError} from './server-network-store.js';
export function resetPlan(source,target,snapshot,targetSnapshot,bot,owner,preserved=[]){
 if(!owner||target.ownerId!==owner)throw new ServerNetworkError('削除してコピーする操作は、サブサーバーの所有者がメイン側から実行してください。ロール削除後も操作権限を維持するためです。');
 if(snapshot.community!==targetSnapshot.community)throw new ServerNetworkError('削除前に、サブのコミュニティ設定をメインと同じ状態にしてください。');
 if(![...bot.roles.cache.values()].some(r=>r.managed&&r.permissions.has(P.Administrator)))throw new ServerNetworkError('サブのBot管理ロールに管理者権限が必要です。通常ロールは削除するため、管理者権限をBot管理ロールへ設定してください。');
 const highest=targetSnapshot.roles.filter(r=>bot.roles.cache.has(r.id)).sort(compareCopyRoles).at(-1);
 const roles=targetSnapshot.roles.filter(r=>r.id!==target.id&&!r.managed),channels=targetSnapshot.channels;
 for(const r of roles){const live=target.roles.cache.get(r.id);if(!live?.editable||!highest||compareCopyRoles(r,highest)>=0)throw new ServerNetworkError('サブのBotロールを、削除対象のすべての通常ロールより上に配置してください。');}
 const kept=channelReusePlan(snapshot,targetSnapshot,preserved),retained=new Set(Object.values(kept.reuseChannels));
 if(channels.some(c=>{const live=target.channels.cache.get(c.id);return !live?.deletable&&!(retained.has(c.id)&&live?.manageable);}))throw new ServerNetworkError('サブにBotが削除できないチャンネルがあります。権限を確認してください。');
 const limits=new Map([[1,6],[3,1],[4,1],[5,1],[6,1]]),counts=new Map();for(const rule of snapshot.moderation){const limit=limits.get(rule.triggerType);counts.set(rule.triggerType,(counts.get(rule.triggerType)??0)+1);if(!limit||counts.get(rule.triggerType)>limit)throw new ServerNetworkError('メインのAutoMod種別または件数がコピーできる上限を超えます。削除は開始しません。');}
 const protectedModeration=[];if(targetSnapshot.community){const existing=targetSnapshot.moderation.filter(r=>r.triggerType===5),original=snapshot.moderation.filter(r=>r.triggerType===5);if(existing.length>1||original.length>1||existing.length!==original.length)throw new ServerNetworkError('コミュニティの標準メンションルールを両サーバーで1対1に確認できません。削除せず状態を確認してください。');if(existing.length){if(existing[0].eventType!==original[0].eventType)throw new ServerNetworkError('標準メンションルールのイベント種別が一致しません。削除は開始しません。');protectedModeration.push({source:original[0].id,target:existing[0].id});}}
 const keptRoles=targetSnapshot.roles.filter(r=>r.managed||r.id===target.id).length;
 if(snapshot.roles.filter(r=>r.id!==source.id&&!r.managed).length+keptRoles>250)throw new ServerNetworkError('コピー後のロール数がDiscordの上限を超えます。');
 if(snapshot.channels.length>500)throw new ServerNetworkError('コピー中のチャンネル数がDiscordの上限を超えます。');
 return {target:target.id,roles:roles.sort((a,b)=>b.position-a.position).map(r=>r.id),...kept,channels:[...channels].filter(c=>!retained.has(c.id)).sort((a,b)=>(a.type===C.GuildCategory?1:0)-(b.type===C.GuildCategory?1:0)).map(c=>c.id),moderation:targetSnapshot.moderation.filter(r=>!protectedModeration.some(p=>p.target===r.id)).map(r=>r.id),protectedModeration,emojis:targetSnapshot.assets.emojis.map(e=>e.id),stickers:targetSnapshot.assets.stickers.map(s=>s.id),sounds:targetSnapshot.assets.sounds.map(s=>s.id),managedRoles:keptRoles-1,community:snapshot.community,onboarding:!emptyOnboarding(targetSnapshot.onboarding),welcome:!emptyWelcome(targetSnapshot.welcome)};
}
export async function resetDestination({target,plan,step}){
 // Rejecting an AutoMod delete must not first clear onboarding or create community staging.
 for(const id of plan.moderation)await step(`reset-automod:${id}`,()=>target.autoModerationRules.delete(id,'管理者確認済み・削除してサーバーコピー'));
 for(const p of plan.protectedModeration??[])await step(`reset-protected-automod:${p.target}`,()=>target.autoModerationRules.edit(p.target,protectedRulePreparation()));
 if(plan.community){
  if(plan.onboarding)await step('reset-onboarding',()=>target.editOnboarding({enabled:false,mode:0,defaultChannels:[],prompts:[],reason:'削除してサーバーコピー'}));
  if(plan.welcome)await step('reset-welcome',()=>target.editWelcomeScreen({enabled:false,description:null,welcomeChannels:[],reason:'削除してサーバーコピー'}));
  for(const c of plan.freezeChannels)await step(`reset-preserve-channel:${c.id}`,()=>target.channels.edit(c.id,{permissionOverwrites:c.permissionOverwrites,reason:'コピー中の既存チャンネル閲覧権限を保持'}));
 }
 await step('reset-references',()=>target.edit({afkChannel:null,systemChannel:null,...(plan.community&&target.safetyAlertsChannelId?{safetyAlertsChannel:target.rulesChannelId}:{}),reason:'削除してサーバーコピー'}));
 for(const [kind,manager,ids]of [['sound',target.soundboardSounds,plan.sounds],['sticker',target.stickers,plan.stickers],['emoji',target.emojis,plan.emojis],['channel',target.channels,plan.channels],['role',target.roles,plan.roles]])for(const id of ids)await step(`reset-${kind}:${id}`,()=>manager.delete(id,'管理者確認済み・削除してサーバーコピー'));
 await step('reset-images',()=>target.edit({icon:null,banner:null,splash:null,discoverySplash:null,reason:'削除してサーバーコピー'}));
 return null;
}
