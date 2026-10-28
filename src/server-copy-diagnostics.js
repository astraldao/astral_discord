import {protectedCommunityRule} from './server-copy-moderation.js';
import {ChannelType as C,PermissionFlagsBits as P} from 'discord.js';
import {ServerNetworkError} from './server-network-store.js';
import {networkRead,networkDiagnostic} from './server-network-fault.js';
const count=v=>v instanceof Map?v.size:Array.isArray(v)?v.length:null;
const reference=(id,channels)=>!id?'unset':!channels?'unknown':!channels.has(id)?'missing':channels.get(id).type===C.GuildText?'ok':'type';
export const copyMfaWarning=guild=>guild.mfaLevel===1?'サブは管理操作に2FAが必須です。Bot所有者のDiscordアカウントで2FAを有効にしてください。所有者の2FA状態はBot APIでは確認できません。':null;
export async function inspectCopyDiagnostics({authority,owner,check=()=>{}}){
 const guarded=async()=>{await check();const pair=await authority(owner);await check();return pair;};
 const pair=await guarded(),sourceId=pair.source.id,targetId=pair.target.id,reports=[];
 const probe=async(phase,operation)=>{await check();let r;try{r={ok:true,value:await networkRead(phase,operation)};}catch(e){r={ok:false,code:networkDiagnostic('copy-preview',e).code};}await check();return r;};
 for(const [side,guild]of [['main',pair.source],['sub',pair.target]]){
  await check();await networkRead(`${side}-guild`,()=>guild.fetch());await check();
  const roles=await probe(`${side}-roles`,()=>guild.roles.fetch()),channels=await probe(`${side}-channels`,()=>guild.channels.fetch());
  const bot=await probe(`${side}-bot`,()=>guild.members.fetchMe({force:true})),rules=await probe(`${side}-automod`,()=>guild.autoModerationRules.fetch());
  const community=Array.isArray(guild.features)?guild.features.includes('COMMUNITY'):null;
  const onboarding=community===true?await probe(`${side}-onboarding`,()=>guild.fetchOnboarding()):null;
  const fetchedChannels=channels.ok&&channels.value instanceof Map?channels.value:null;
  const permitted=flag=>roles.ok&&roles.value instanceof Map&&bot.ok&&typeof bot.value?.permissions?.has==='function'?bot.value.permissions.has(flag):null;
  reports.push({side,id:guild.id,community,mfa:([0,1].includes(guild.mfaLevel)?guild.mfaLevel:null),botAdmin:permitted(P.Administrator),botManageGuild:permitted(P.ManageGuild),channels:{ok:!!fetchedChannels,code:channels.code??'UNKNOWN'},references:{rules:reference(guild.rulesChannelId,fetchedChannels),updates:reference(guild.publicUpdatesChannelId,fetchedChannels),safety:reference(guild.safetyAlertsChannelId,fetchedChannels)},rules:rules.ok&&rules.value instanceof Map?{ok:true,count:rules.value.size,protected:[...rules.value.values()].filter(rule=>protectedCommunityRule(guild,rule)).length}:{ok:false,code:rules.code??'UNKNOWN'},onboarding:onboarding?(onboarding.ok?{ok:true,enabled:typeof onboarding.value?.enabled==='boolean'?onboarding.value.enabled:null,mode:[0,1].includes(onboarding.value?.mode)?onboarding.value.mode:null,defaults:count(onboarding.value?.defaultChannels)}:{ok:false,code:onboarding.code}):null});
 }
 const fresh=await guarded();if(fresh.source.id!==sourceId||fresh.target.id!==targetId)throw new ServerNetworkError('診断中にサーバーの選択が変わりました。開き直してください。');
 return {servers:reports,at:Date.now()};
}
const state=value=>value===true?'確認済み':value===false?'不足':'未確認',ref=value=>({ok:'正常',unset:'未設定',missing:'参照先なし',type:'種類が不正',unknown:'未確認'}[value]??'未確認');
export function copyDiagnosticsText(report){return report.servers.map(s=>`**${s.side==='main'?'メイン':'サブ'}** ${s.id}\nコミュニティ ${s.community===true?'有効':s.community===false?'無効':'未確認'} · 管理操作2FA ${s.mfa===1?'必須':s.mfa===0?'必須設定なし':'未確認'}\nBot管理者 ${state(s.botAdmin)} · サーバー管理 ${state(s.botManageGuild)}\n${s.community===true?`ルール用 ${ref(s.references.rules)} · 更新用 ${ref(s.references.updates)}\n安全通知用 ${ref(s.references.safety)}（任意）\n`:''}AutoMod一覧 ${s.rules.ok?`取得成功・${s.rules.count}件${s.rules.protected?`（削除不可の標準ルール${s.rules.protected}件）`:``}`:s.rules.code}\n${s.onboarding?`オンボーディング ${s.onboarding.ok?`${s.onboarding.enabled===true?'有効':s.onboarding.enabled===false?'無効':'未確認'} · モード ${s.onboarding.mode??'未確認'} · 既定 ${s.onboarding.defaults??'未確認'}件`:s.onboarding.code}\n`:''}`).join('\n')+'\n**確認すること**\n'+(report.servers.some(s=>s.mfa===1)?'管理操作2FAが必須のサーバーがあります。Bot所有者のDiscordアカウントで2FAを有効にしてください。\n':'')+'Bot所有者の2FA状態はBot APIでは確認できません。コミュニティの有効・無効とは別の条件です。\n一覧取得の成功は削除権限の保証ではありません。この診断は読取りだけで、削除・設定変更・コピー・記録の解除は行いません。';}
