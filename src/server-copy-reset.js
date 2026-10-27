import {emptyOnboarding,emptyWelcome} from './server-copy-steps.js';
import {ChannelType as C,PermissionFlagsBits as P} from 'discord.js';
import {ServerNetworkError} from './server-network-store.js';
export function resetPlan(source,target,snapshot,targetSnapshot,bot,owner){
 if(!owner||target.ownerId!==owner)throw new ServerNetworkError('削除してコピーする操作は、サブサーバーの所有者がメイン側から実行してください。ロール削除後も操作権限を維持するためです。');
 if(snapshot.community!==targetSnapshot.community)throw new ServerNetworkError('削除前に、サブのコミュニティ設定をメインと同じ状態にしてください。');
 if(![...bot.roles.cache.values()].some(r=>r.managed&&r.permissions.has(P.Administrator)))throw new ServerNetworkError('サブのBot管理ロールに管理者権限が必要です。通常ロールは削除するため、管理者権限をBot管理ロールへ設定してください。');
 const roles=targetSnapshot.roles.filter(r=>r.id!==target.id&&!r.managed),channels=targetSnapshot.channels;
 for(const r of roles){const live=target.roles.cache.get(r.id);if(!live?.editable||r.position>=bot.roles.highest.rawPosition)throw new ServerNetworkError('サブのBotロールを、削除対象のすべての通常ロールより上に配置してください。');}
 if(channels.some(c=>{const live=target.channels.cache.get(c.id);return !live?.deletable&&!(snapshot.community&&[target.rulesChannelId,target.publicUpdatesChannelId].includes(c.id)&&live?.manageable);}))throw new ServerNetworkError('サブにBotが削除できないチャンネルがあります。権限を確認してください。');
 if(snapshot.community){if(!snapshot.settings.rulesChannel||!snapshot.settings.publicUpdatesChannel)throw new ServerNetworkError('メインのルール用・コミュニティ更新用チャンネルを確認してください。');if(channels.length>=500)throw new ServerNetworkError('コミュニティ必須チャンネルの退避に1枠必要です。サブのチャンネルを499件以下にしてください。');}
 const limits=new Map([[1,6],[3,1],[4,1],[5,1],[6,1]]),counts=new Map();for(const rule of snapshot.moderation){const limit=limits.get(rule.triggerType);counts.set(rule.triggerType,(counts.get(rule.triggerType)??0)+1);if(!limit||counts.get(rule.triggerType)>limit)throw new ServerNetworkError('メインのAutoMod種別または件数がコピーできる上限を超えます。削除は開始しません。');}
 const keptRoles=targetSnapshot.roles.filter(r=>r.managed||r.id===target.id).length;
 if(snapshot.roles.filter(r=>r.id!==source.id&&!r.managed).length+keptRoles>250)throw new ServerNetworkError('コピー後のロール数がDiscordの上限を超えます。');
 if(snapshot.channels.length+(snapshot.community?1:0)>500)throw new ServerNetworkError('コピー中のチャンネル数がDiscordの上限を超えます。');
 return {target:target.id,roles:roles.sort((a,b)=>b.position-a.position).map(r=>r.id),channels:[...channels].sort((a,b)=>(a.type===C.GuildCategory?1:0)-(b.type===C.GuildCategory?1:0)).map(c=>c.id),moderation:targetSnapshot.moderation.map(r=>r.id),emojis:targetSnapshot.assets.emojis.map(e=>e.id),stickers:targetSnapshot.assets.stickers.map(s=>s.id),sounds:targetSnapshot.assets.sounds.map(s=>s.id),managedRoles:keptRoles-1,community:snapshot.community,onboarding:!emptyOnboarding(targetSnapshot.onboarding),welcome:!emptyWelcome(targetSnapshot.welcome)};
}
export async function resetDestination({target,plan,step}){
 let staging=null;
 if(plan.community){if(plan.onboarding)await step('reset-onboarding',()=>target.editOnboarding({enabled:false,mode:0,defaultChannels:[],prompts:[],reason:'削除してサーバーコピー'}));if(plan.welcome)await step('reset-welcome',()=>target.editWelcomeScreen({enabled:false,description:null,welcomeChannels:[],reason:'削除してサーバーコピー'}));staging=await step('reset-staging',()=>target.channels.create({name:'astral-copy-setup',type:C.GuildText,permissionOverwrites:[{id:target.id,type:0,allow:P.ViewChannel,deny:P.SendMessages}],reason:'コミュニティ必須チャンネルの一時退避'}),(record,created)=>{record.staging=created.id;});}
 await step('reset-references',()=>target.edit({afkChannel:null,systemChannel:null,...(staging?{rulesChannel:staging.id,publicUpdatesChannel:staging.id}:{}),reason:'削除してサーバーコピー'}));
 for(const [kind,manager,ids]of [['automod',target.autoModerationRules,plan.moderation],['sound',target.soundboardSounds,plan.sounds],['sticker',target.stickers,plan.stickers],['emoji',target.emojis,plan.emojis],['channel',target.channels,plan.channels],['role',target.roles,plan.roles]])for(const id of ids)await step(`reset-${kind}:${id}`,()=>manager.delete(id,'管理者確認済み・削除してサーバーコピー'));
 await step('reset-images',()=>target.edit({icon:null,banner:null,splash:null,discoverySplash:null,reason:'削除してサーバーコピー'}));
 return staging?.id??null;
}
