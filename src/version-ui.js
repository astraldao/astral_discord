import {ActionRowBuilder,ButtonBuilder,ButtonStyle,MessageFlags} from 'discord.js';
import {AdminSessions} from './admin.js';
import {payload,text,adminHomeButton} from './ui.js';
import {updateCapacityFields} from './update-capacity.js';
const row=(...buttons)=>new ActionRowBuilder().addComponents(...buttons);
const button=(s,action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`updates:${s.id}:${s.turn}:${action}`).setLabel(label).setStyle(style);
const labels={idle:'待機中',preparing:'新版を取得・検証中',switching:'切り替え中',complete:'更新が完了しました',blocked:'進行中の操作があるため更新を見送りました',failed:'前回の更新を完了できませんでした'};
export function versionScreen(s){
  const d=s.data,current=d.current,latest=d.latest,busy=['preparing','switching'].includes(d.phase),available=latest&&latest.sha!==current.sha;
  const navigation=row(adminHomeButton());
  if(!d.supported){
    const m=payload('バージョン管理','**初回の切り替えが必要です**\nQuaxlyのStartup Commandから一度再導入すると、この画面で更新できるようになります。',{state:'warning',components:[row(new ButtonBuilder().setLabel('導入手順を見る').setStyle(ButtonStyle.Link).setURL('https://github.com/astraldao/astral_discord#quaxlyでgithubから導入更新')),navigation]});
    m.embeds[0].addFields({name:'現在のバージョン',value:`v${text(current.version)}`});return m;
  }
  const heading=busy?labels[d.phase]:d.phase==='blocked'?'操作の終了後に再試行できます':d.phase==='failed'?'更新結果を確認してください':available?'新しい更新があります':latest?'確認した最新版で稼働中':'まず更新を確認してください';
  let body=`**${heading}**`;
  if(d.error)body+=`\n${text(d.error)}`;
  if(s.confirm)body+='\n\n取得・検証後にBotを再接続します。進行中の操作やゲームがあれば更新を見送ります。';
  else if(busy)body+='\n\n更新中はdnd（取り込み中）になります。切り替え後に /admin を開き直すと、稼働版を確認できます。';
  else if(available)body+='\n内容を確認してから更新できます。';
  else if(!latest)body+='\n管理者が操作したときだけ確認・更新します。';
  if(d.checkedAt!==null)body+=`\n\n最終確認 <t:${Math.floor(d.checkedAt/1000)}:R>`;
  const controls=s.confirm?row(button(s,'start','この版に更新する',ButtonStyle.Primary),button(s,'cancel','変更せず戻る')):busy?row(button(s,'status','進行状況を確認',ButtonStyle.Primary)):row(...(available?[button(s,'confirm','更新内容を確認',ButtonStyle.Primary)]:[]),button(s,'check',latest?'更新を再確認':'更新を確認',available?ButtonStyle.Secondary:ButtonStyle.Primary));
  const m=payload(s.confirm?'更新内容を確認':'バージョン管理',body,{state:d.phase==='blocked'?'warning':d.phase==='failed'?'error':latest&&!available&&!busy?'success':'normal',components:[controls,...(latest?[row(new ButtonBuilder().setLabel('変更内容を見る').setStyle(ButtonStyle.Link).setURL(`https://github.com/astraldao/astral_discord/commit/${latest.sha}`))]:[]),navigation]});
  m.embeds[0].addFields({name:'現在のバージョン',value:`**v${text(current.version)}**${current.sha?`\n${current.sha.slice(0,7)}`:''}`,inline:true},{name:'確認した最新版',value:latest?`**v${text(latest.version)}**\n${latest.sha.slice(0,7)}`:'未確認',inline:true},...updateCapacityFields(s));return m;
}
export function createVersionController({updater,access,beforeStart=async()=>{},estimateCapacity=async()=>null,now=Date.now}){
  const sessions=new AdminSessions(now);
  const check=async(i,s)=>{if(!await access(i))throw new Error('管理者権限がありません。');if(s){sessions.get(s.id,i.user.id);if(s.channelId!==i.channelId)throw new Error('元のチャンネルから操作してください。');}};
  const ack=async i=>{if(i.deferred||i.replied)return;if(i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});};
  async function error(i,e,s){let recover=false;try{await check(i,s);recover=true;}catch{}const m=payload('バージョン管理',text(e.message),{state:'error',components:recover?[row(...(s?[button(s,'check','更新を確認し直す')]:[]),adminHomeButton())]:[]});if(i.deferred||i.replied)await i.editReply(m);else await i.reply({...m,flags:MessageFlags.Ephemeral});}
  return {sessions,async open(i){try{await ack(i);await check(i);const s=sessions.create(i.user.id);s.channelId=i.channelId;s.turn=0;s.data=await updater.request('status');await check(i,s);await i.editReply(versionScreen(s));}catch(e){await error(i,e);}},async handle(i){
    let s,locked=false;
    try{
      await ack(i);
      const [,id,turn,action]=i.customId.split(':');s=sessions.get(id,i.user.id);await check(i,s);if(s.busy)throw new Error('前の操作を処理中です。');s.busy=true;locked=true;
      if(String(s.turn)!==turn)throw new Error('古い画面です。/admin から開き直してください。');await ack(i);
      if(action==='check'||action==='status'){s.data=await updater.request(action);s.confirm=false;if(action==='check'){await check(i,s);try{s.capacity=await estimateCapacity(s.data);}catch{s.capacity=null;}}}
      else if(action==='confirm'){
        s.data=await updater.request('status');if(!s.data.latest||s.data.latest.sha===s.data.current.sha||['preparing','switching'].includes(s.data.phase))throw new Error('更新を確認し直してください。');
        s.confirm=true;s.target=s.data.latest.sha;
      }else if(action==='cancel'){s.confirm=false;s.target=null;s.data=await updater.request('status');}
      else if(action==='start'){
        if(!s.confirm||!s.target)throw new Error('更新内容を確認してください。');await beforeStart(i);await check(i,s);s.data=await updater.request('start',s.target);s.confirm=false;s.target=null;
      }else throw new Error('操作を確認してください。');
      await check(i,s);s.turn++;await i.editReply(versionScreen(s));
    }catch(e){await error(i,e,s);}finally{if(locked)s.busy=false;}
  }};
}
