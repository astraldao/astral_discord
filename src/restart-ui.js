import {ActionRowBuilder,ButtonBuilder,ButtonStyle,PermissionFlagsBits as P,MessageFlags} from 'discord.js';
import {AdminSessions} from './admin.js';
import {runtimeVariables} from './runtime-env.js';
import {payload,acknowledgePrivate,adminHomeButton,adminSectionButton} from './ui.js';
const row=(...c)=>new ActionRowBuilder().addComponents(...c);
const button=(s,a,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`restart:${s.id}:${s.turn}:${a}`).setLabel(label).setStyle(style);
export function restartScreen(s,store){
  const d=s.data,state=store.snapshot(),busy=['scheduled','restarting'].includes(d.phase);
  const titles={scheduled:'再起動を受け付けました',restarting:'再起動中です',complete:'再起動が完了しました',restored:'起動設定を戻して復旧しました',blocked:'再起動を見送りました',failed:'再起動を完了できませんでした'};
  let body=!d.supported?'**起動プロセスの切り替えが必要です**\nこの版への更新後、Quaxly側で一度だけBotを再起動してください。以後はこのボタンで再起動できます。':s.confirm?'**現在のバージョンで再起動しますか？**\n保存済みの起動設定を反映して再接続します。起動に失敗した場合は、直前に稼働していた起動設定へ戻して復旧します。':`**${titles[d.phase]??'Botを再起動できます'}**\n${busy?'少し待ってから /admin を開き直してください。':'読み上げ・VC入室・ゲームなどが進行中なら再起動を見送ります。'}\nGitHubからの取得やバージョン変更は行いません。`;
  if(d.error)body+=`\n\n${d.error}`;
  body+='\n\n**起動設定（稼働中 → 次回）**\n'+runtimeVariables.map(v=>`**${v.label}** ${state.running[v.key]} → ${state.effective[v.key]}`).join('\n');
  if(state.effective.ASTRAL_BACKUP_TTS==='1')body+='\n読み上げをONにする前に、Developer PortalのMessage Content Intentを有効にしてください。';
  return {...payload(s.confirm?'再起動を確認':'Botを再起動',body,{state:!d.supported||['blocked','failed','restored'].includes(d.phase)?'warning':'normal',components:[
    ...(!d.supported?[row(new ButtonBuilder().setLabel('切り替え手順を見る').setStyle(ButtonStyle.Link).setURL('https://github.com/astraldao/astral_discord/blob/main/docs/RESTART.md'))]:s.confirm?[row(button(s,'start','再起動する',ButtonStyle.Primary),button(s,'cancel','再起動せず戻る'))]:[row(button(s,'confirm','再起動を確認',ButtonStyle.Primary).setDisabled(busy),button(s,'status','状態を更新'))]),
    row(adminSectionButton('operations'),adminHomeButton()),
  ]}),attachments:[]};
}
export function createRestartController({guild,store,rpc,supported=false,beforeStart=async()=>{},access=async i=>{const [m,c]=await Promise.all([guild.members.fetch({user:i.user.id,force:true}),guild.channels.fetch(i.channelId,{force:true})]);if(!m.permissions.has(P.Administrator)||!c?.permissionsFor(m)?.has(P.ViewChannel))throw new Error('再起動は管理者専用です。現在の管理者権限と閲覧権限を確認してください。');}}){
  const sessions=new AdminSessions();
  const check=async(i,s)=>{await access(i);if(s){sessions.get(s.id,i.user.id);if(s.channelId!==i.channelId)throw new Error('元のチャンネルから操作してください。');}};
  const status=()=>supported?rpc.request('restart-status'):Promise.resolve({supported:false,phase:'unavailable'});
  async function error(i,e){const m={...payload('Botを再起動',e.message,{state:'error',components:[row(new ButtonBuilder().setCustomId('restart:open').setLabel('再起動画面を開く').setStyle(ButtonStyle.Secondary),adminHomeButton())]}),attachments:[]};if(i.deferred||i.replied)await i.editReply(m);else await i.reply({...m,flags:MessageFlags.Ephemeral});}
  return {sessions,async open(i){try{await acknowledgePrivate(i);await check(i);if([...sessions.sessions.values()].some(s=>s.userId===i.user.id&&s.busy))throw new Error('前の操作を処理中です。');const s=sessions.create(i.user.id);s.channelId=i.channelId;s.turn=0;s.data=await status();await check(i,s);await i.editReply(restartScreen(s,store));}catch(e){await error(i,e);}},async handle(i){if(i.customId==='restart:open')return this.open(i);let s,locked=false;try{
    const [,id,turn,action]=i.customId.split(':');s=sessions.get(id,i.user.id);await check(i,s);if(s.busy)throw new Error('前の操作を処理中です。');s.busy=true;locked=true;if(String(s.turn)!==turn)throw new Error('古い画面です。確認画面を開き直してください。');await acknowledgePrivate(i);
    if(!supported)throw new Error('起動プロセスを切り替えるため、Quaxly側で一度再起動してください。');
    if(action==='status'||action==='cancel'){s.data=await status();s.confirm=false;}
    else if(action==='confirm'){s.data=await status();if(['scheduled','restarting'].includes(s.data.phase))throw new Error('再起動中です。');s.confirm=true;s.target=store.snapshot().revision;}
    else if(action==='start'){if(!s.confirm||s.target!==store.snapshot().revision)throw new Error('起動設定を確認し直してください。');await beforeStart();await check(i,s);s.data=await rpc.request('restart-start',s.target);s.confirm=false;}
    else throw new Error('操作を確認してください。');
    await check(i,s);s.turn++;await i.editReply(restartScreen(s,store));
  }catch(e){await error(i,e);}finally{if(locked)s.busy=false;}}};
}
