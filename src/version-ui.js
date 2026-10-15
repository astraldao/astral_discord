import {ActionRowBuilder,ButtonBuilder,ButtonStyle,MessageFlags} from 'discord.js';
import {AdminSessions} from './admin.js';
import {payload,text} from './ui.js';
const row=(...buttons)=>new ActionRowBuilder().addComponents(...buttons);
const button=(s,action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`updates:${s.id}:${s.turn}:${action}`).setLabel(label).setStyle(style);
const labels={idle:'待機中',preparing:'新版を取得・検証中',switching:'切り替え中',complete:'更新が完了しました',blocked:'進行中の操作があるため更新を見送りました',failed:'前回の更新を完了できませんでした'};
export function versionScreen(s){
  const d=s.data,current=d.current,latest=d.latest,busy=['preparing','switching'].includes(d.phase),available=latest&&latest.sha!==current.sha;
  let body=`**現在** v${text(current.version)}${current.sha?` · ${current.sha.slice(0,7)}`:''}\n**更新方式** 管理者による手動更新`;
  if(!d.supported)return payload('✦  バージョン管理',body+'\n\nこの起動環境は手動更新に未対応です。QuaxlyのStartup Commandから起動用コードを一度再導入してください。手順はリポジトリのREADMEにあります。');
  body+=`\n**確認済みの最新** ${latest?`v${text(latest.version)} · ${latest.sha.slice(0,7)}`:'未確認'}\n**状態** ${labels[d.phase]??'待機中'}`;
  if(d.checkedAt!==null)body+=`\n最終確認 <t:${Math.floor(d.checkedAt/1000)}:R>`;
  if(latest)body+=`\n[更新対象のコミットを見る](https://github.com/astraldao/astral_discord/commit/${latest.sha})`;
  if(d.error)body+=`\n\n${text(d.error)}`;
  if(s.confirm){
    body+='\n\n**この版に更新しますか？**\n新版を取得・検証してからBotを再接続します。進行中の操作やゲームがある場合は切り替えを見送り、現在の版を維持します。';
    return payload('✦  更新内容を確認',body,{components:[row(button(s,'start','この版に更新する',ButtonStyle.Primary),button(s,'cancel','変更せず戻る'))]});
  }
  if(busy)body+='\n\n更新中はステータスをdndにします。切り替え時に接続が短く中断します。完了後は /admin を開き直して稼働版を確認してください。';
  else if(latest&&!available)body+='\n\n確認した最新版で稼働しています。';
  return payload('✦  バージョン管理',body,{components:[row(button(s,'check','更新を確認',ButtonStyle.Primary).setDisabled(busy),button(s,'status','状態を再表示'),...(available&&!busy?[button(s,'confirm','更新内容を確認')]:[]))]});
}
export function createVersionController({updater,access,now=Date.now}){
  const sessions=new AdminSessions(now);
  const check=async(i,s)=>{if(!await access(i))throw new Error('管理者権限がありません。');if(s){sessions.get(s.id,i.user.id);if(s.channelId!==i.channelId)throw new Error('元のチャンネルから操作してください。');}};
  const ack=async i=>{if(i.deferred||i.replied)return;if(i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});};
  async function error(i,e){const m=payload('✦  バージョン管理',text(e.message),{state:'error'});if(i.deferred||i.replied)await i.editReply(m);else await i.reply({...m,flags:MessageFlags.Ephemeral});}
  return {sessions,async open(i){try{await check(i);await ack(i);const s=sessions.create(i.user.id);s.channelId=i.channelId;s.turn=0;s.data=await updater.request('status');await check(i,s);await i.editReply(versionScreen(s));}catch(e){await error(i,e);}},async handle(i){
    let s,locked=false;
    try{
      const [,id,turn,action]=i.customId.split(':');s=sessions.get(id,i.user.id);await check(i,s);if(s.busy)throw new Error('前の操作を処理中です。');s.busy=true;locked=true;
      if(String(s.turn)!==turn)throw new Error('古い画面です。/admin から開き直してください。');await ack(i);
      if(action==='check'||action==='status'){s.data=await updater.request(action);s.confirm=false;}
      else if(action==='confirm'){
        s.data=await updater.request('status');if(!s.data.latest||s.data.latest.sha===s.data.current.sha||['preparing','switching'].includes(s.data.phase))throw new Error('更新を確認し直してください。');
        s.confirm=true;s.target=s.data.latest.sha;
      }else if(action==='cancel'){s.confirm=false;s.target=null;s.data=await updater.request('status');}
      else if(action==='start'){
        if(!s.confirm||!s.target)throw new Error('更新内容を確認してください。');await check(i,s);s.data=await updater.request('start',s.target);s.confirm=false;s.target=null;
      }else throw new Error('操作を確認してください。');
      await check(i,s);s.turn++;await i.editReply(versionScreen(s));
    }catch(e){await error(i,e);}finally{if(locked)s.busy=false;}
  }};
}
