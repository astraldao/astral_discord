import {ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,ModalBuilder,TextInputBuilder,TextInputStyle,PermissionFlagsBits as P,MessageFlags} from 'discord.js';
import {randomUUID} from 'node:crypto';
import {AdminSessions} from './admin.js';
import {runtimeVariables} from './runtime-env.js';
import {payload,acknowledgePrivate,adminSectionButton,adminHomeButton,adminFeatureButton,restartButton} from './ui.js';
const row=(...c)=>new ActionRowBuilder().addComponents(...c);
const button=(s,action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`runtime:${s.id}:${s.turn}:${action}`).setLabel(label).setStyle(style);
export function runtimeEnvScreen(s,store,note=''){
  const state=store.snapshot(),stage=s.stage,d=stage&&runtimeVariables.find(d=>d.key===stage.key);
  const description=stage?`**${d.label}**\n${d.key}\n次回起動時：${state.effective[d.key]} → ${stage.value??'外部設定・既定値に戻す'}\n\n${d.help}\n\n保存後、「Botを再起動」から再起動すると反映します。`:runtimeVariables.map(d=>`**${d.label}**\n${d.key}\n稼働中 **${state.running[d.key]}** → 次回起動時 **${state.effective[d.key]}**`).join('\n\n')+`\n\n${state.pending?'**保存済みの変更があります。Botを再起動して反映してください。**':'項目を選んで変更できます。'}\n保存値は外部の環境変数より優先します。空欄で保存すると外部設定・既定値へ戻します。\nトークンは表示・編集しません。`;
  return {...payload(stage?'起動設定の変更を確認':'ENV・起動設定',`${note?`${note}\n\n`:''}${description}`,{state:stage||state.pending?'warning':'normal',components:stage?[row(button(s,'save','変更を保存',ButtonStyle.Primary),button(s,'cancel','変更せず戻る'))]:[
    row(new StringSelectMenuBuilder().setCustomId(`runtime:${s.id}:${s.turn}:edit`).setPlaceholder('変更する起動設定を選ぶ').addOptions(...runtimeVariables.map(d=>({label:d.label,value:d.key,description:d.key})))),
    row(button(s,'refresh','状態を更新'),restartButton(),adminSectionButton('operations'),adminHomeButton()),
  ]}),attachments:[]};
}
export function createRuntimeEnvController({guild,store,access=async i=>{const [m,c]=await Promise.all([guild.members.fetch({user:i.user.id,force:true}),guild.channels.fetch(i.channelId,{force:true})]);if(!m.permissions.has(P.Administrator)||!c?.permissionsFor(m)?.has(P.ViewChannel))throw new Error('起動設定は管理者専用です。現在の管理者権限と閲覧権限を確認してください。');}}){
  const sessions=new AdminSessions();
  const check=async(i,s)=>{await access(i);if(s){sessions.get(s.id,i.user.id);if(s.channelId!==i.channelId)throw new Error('元のチャンネルから操作してください。');}};
  const error=async(i,e)=>{const m={...payload('ENV・起動設定',e.message,{state:'error',components:[row(adminFeatureButton('open-runtime'),adminSectionButton('operations'))]}),attachments:[]};if(i.deferred||i.replied)await i.editReply(m);else await i.reply({...m,flags:MessageFlags.Ephemeral});};
  return {sessions,async open(i){try{await acknowledgePrivate(i);await check(i);const s=sessions.resume(i.user.id,i.channelId)??sessions.create(i.user.id);s.channelId=i.channelId;s.turn=(s.turn??-1)+1;s.stage=null;delete s.form;await i.editReply(runtimeEnvScreen(s,store));}catch(e){await error(i,e);}},async handle(i){let s,locked=false;try{
    const [,id,turn,action,token]=i.customId.split(':');s=sessions.get(id,i.user.id);await check(i,s);if(s.busy)throw new Error('前の操作を処理中です。');s.busy=true;locked=true;
    if(String(s.turn)!==turn)throw new Error('古い画面です。起動設定を開き直してください。');
    if(action==='edit'){
      const d=i.values?.length===1&&runtimeVariables.find(d=>d.key===i.values[0]);if(!d)throw new Error('項目を選び直してください。');
      s.form={key:d.key,revision:store.snapshot().revision,token:randomUUID().slice(0,12)};
      await i.showModal(new ModalBuilder().setCustomId(`runtime:${s.id}:${s.turn}:submit:${s.form.token}`).setTitle(d.label).addComponents(row(new TextInputBuilder().setCustomId('value').setLabel(d.key==='ASTRAL_BACKUP_TTS'?'0=OFF、1=ON（空欄で外部設定へ）':'1〜4（空欄で外部設定へ）').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(1).setValue(store.snapshot().effective[d.key]))));return;
    }
    await acknowledgePrivate(i);await check(i,s);let note='';
    if(action==='submit'){
      if(!s.form||s.form.token!==token)throw new Error('入力画面から操作してください。');const d=runtimeVariables.find(d=>d.key===s.form.key),value=i.fields.getTextInputValue('value').trim();if(value&&!d.valid(value))throw new Error(d.help);
      s.stage={key:d.key,value:value||null,revision:s.form.revision};delete s.form;
    }else if(action==='save'){
      if(!s.stage)throw new Error('変更内容を確認してください。');await store.save(s.stage.key,s.stage.value,s.stage.revision,()=>check(i,s));s.stage=null;note='保存しました。「Botを再起動」から再起動すると反映します。';
    }else if(action==='cancel'||action==='refresh'){s.stage=null;delete s.form;}else throw new Error('操作を確認してください。');
    s.turn++;await check(i,s);await i.editReply(runtimeEnvScreen(s,store,note));
  }catch(e){await error(i,e);}finally{if(locked)s.busy=false;}}};
}
