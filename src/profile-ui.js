import {ActionRowBuilder,ButtonBuilder,ButtonStyle,ModalBuilder,TextInputBuilder,TextInputStyle,MessageFlags,PermissionFlagsBits as P} from 'discord.js';
import {randomUUID} from 'node:crypto';
import {AdminSessions} from './admin.js';
import {payload,text,personalReadingButton} from './ui.js';
import {announcementText} from './speech.js';
const row=(...c)=>new ActionRowBuilder().addComponents(...c);
const button=(s,a,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`profile:${s.id}:${a}`).setLabel(label).setStyle(style);
export function profileScreen(s,current,note=''){
  const deleting=s.view==='delete';
  return payload(deleting?'✧  自分の読み方を解除':'✦  自分の読み方',(note?`${note}\n\n`:'')+`**登録した読み方** ${current??'自動で読む'}\n\n**告知の読み上げ文**\n${text(announcementText(s.name,s.words??[],current))}\n\n${deleting?'登録を解除すると、名前を辞書で自動的に読みます。':'自分の名前の読み方だけを変更できます。表示名やサーバーの辞書は変わりません。'}`,{components:deleting?[row(button(s,'confirm-delete','自動の読み方に戻す',ButtonStyle.Danger),button(s,'home','解除せず戻る'))]:[row(button(s,'form',current?'読み方を修正':'読み方を登録',ButtonStyle.Primary),button(s,'delete','登録を解除').setDisabled(!current)),row(new ButtonBuilder().setCustomId('vc:open').setLabel('入室先を選ぶ').setStyle(ButtonStyle.Secondary))]});
}
export function createProfileController({store,guild,words=()=>[],access=async i=>{const member=await guild.members.fetch({user:i.user.id,force:true});const channel=await guild.channels.fetch(i.channelId,{force:true});if(!channel?.permissionsFor(member)?.has(P.ViewChannel))throw new Error('このチャンネルの閲覧権限がありません。');return member;}}){
  const sessions=new AdminSessions();
  return {sessions,async handle(i){let s,locked=false;
    try{
      const [,id,action,token]=i.customId.split(':');
      if(id==='open'){await i.deferReply({flags:MessageFlags.Ephemeral});const member=await access(i);s=sessions.create(i.user.id);s.name=member.displayName;s.words=words();s.originChannelId=i.channelId;await i.editReply(profileScreen(s,store.get(s.userId)));return;}
      s=sessions.get(id,i.user.id);if(s.originChannelId!==i.channelId)throw new Error('元のチャンネルから操作してください。');if(s.busy)throw new Error('前の操作を処理中です。');s.busy=true;locked=true;
      if(action==='form'){
        const member=await access(i);sessions.get(s.id,s.userId);s.name=member.displayName;s.words=words();s.formToken=randomUUID().slice(0,12);s.expected=store.get(s.userId);
        const field=new TextInputBuilder().setCustomId('reading').setLabel('自分の名前の読み方（かな・長音40文字以内）').setStyle(TextInputStyle.Short).setMaxLength(40).setRequired(true).setPlaceholder('例：あすとらる');if(s.draft??s.expected)field.setValue(s.draft??s.expected);
        await i.showModal(new ModalBuilder().setCustomId(`profile:${s.id}:submit:${s.formToken}`).setTitle('自分の読み方を登録').addComponents(row(field)));return;
      }
      if(i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});const member=await access(i);sessions.get(s.id,s.userId);s.name=member.displayName;s.words=words();let note='';
      if(action==='submit'){if(!s.formToken || token!==s.formToken)throw new Error('最新の入力フォームから操作してください。');const value=i.fields.getTextInputValue('reading');s.draft=String(value).slice(0,40);await store.set(s.userId,value,s.expected);delete s.draft;delete s.formToken;s.view='home';note='✓ 自分の読み方を保存しました。次の音声告知から反映します。';}
      else if(action==='delete'){s.deleteExpected=store.get(s.userId);if(!s.deleteExpected)throw new Error('読み方は未登録です。');s.view='delete';}
      else if(action==='confirm-delete'){if(s.view!=='delete' || !s.deleteExpected)throw new Error('解除の確認画面から操作してください。');await store.set(s.userId,null,s.deleteExpected);delete s.deleteExpected;delete s.draft;delete s.formToken;s.view='home';note='✓ 自動の読み方に戻しました。';}
      else if(action==='home'){s.view='home';delete s.deleteExpected;}
      else throw new Error('不明な操作です。');
      await i.editReply(profileScreen(s,store.get(s.userId),note));
    }catch(e){const recovery=locked&&s?[row(button(s,'form','入力を修正'),button(s,'home','自分の読み方へ'))]:[personalReadingButton()];const message=payload('✧  自分の読み方',text(e.message),{state:'error',components:recovery});message.attachments=[];if(i.deferred || i.replied)await i.editReply(message);else await i.reply({...message,flags:MessageFlags.Ephemeral});}
    finally{if(locked)s.busy=false;}
  }};
}
