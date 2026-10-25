import {ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,ModalBuilder,TextInputBuilder,TextInputStyle,ChannelType,MessageFlags,PermissionFlagsBits as P} from 'discord.js';
import {randomUUID} from 'node:crypto';
import {AdminSessions} from './admin.js';
import {payload,text,adminHomeButton,adminSectionButton,adminFeatureButton,acknowledgePrivate} from './ui.js';
const row=(...items)=>new ActionRowBuilder().addComponents(...items);
const button=(s,action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`forum:${s.id}:${s.turn}:${action}`).setLabel(label).setStyle(style);
export function parseForumPost(value,guildId){let url;try{url=new URL(String(value).trim());}catch{}if(!url || url.protocol!=='https:' || url.hostname!=='discord.com' || url.port || url.username || url.password || url.search || url.hash)throw new Error('Discordの投稿リンクを入力してください。');const m=url.pathname.match(/^\/channels\/(\d{17,20})\/(\d{17,20})(?:\/\d{17,20})?\/?$/);if(!m || m[1]!==guildId)throw new Error('このサーバーの投稿リンクを入力してください。');return m[2];}
export function forumTagsScreen(s,note=''){
  const names=ids=>ids.map((id,n)=>`${n+1}. ${text(s.tags.find(t=>t.id===id)?.name??'削除されたタグ')}`).join('\n')||'未選択';
  let body,components;
  if(!s.postId){body='投稿リンクを入力し、タグを表示したい順に1つずつ選びます。';components=[row(button(s,'link','投稿リンクを入力',ButtonStyle.Primary))];}
  else if(s.result){body=`**${text(s.postName)}**\n\n**送信した順番**\n${names(s.result.requested)}\n\n**APIで確認した順番**\n${s.result.actual?names(s.result.actual):'確認できませんでした。投稿を確認してください。'}\n\n${s.result.actual?(JSON.stringify(s.result.actual)===JSON.stringify(s.result.requested)?'APIでは指定順を保持しています。Discordの画面でも確認してください。':'Discord側で順番が変わりました。画面の表示順は強制できません。'):'自動で再送はしません。'}`;components=[row(button(s,'link','別の投稿を指定'))];}
  else if(!s.tags.length){body=`**${text(s.postName)}**\n\nこのフォーラムに利用可能なタグがありません。フォーラムの設定でタグを作成してから、投稿リンクを入力し直してください。`;components=[row(button(s,'link','投稿を選び直す',ButtonStyle.Primary))];}
  else{body=`**${text(s.postName)}**\n\n**送信する順番**\n${names(s.draft)}\n\nタグを1つずつ選ぶと末尾に追加します。Discordの表示順は保証されません。`;components=[];const options=s.tags.filter(t=>!s.draft.includes(t.id));if(options.length && s.draft.length<5)components.push(row(new StringSelectMenuBuilder().setCustomId(`forum:${s.id}:${s.turn}:add`).setPlaceholder(`${s.draft.length+1}番目のタグを選ぶ`).addOptions(options.map(t=>({label:t.name.slice(0,100),value:t.id})))));components.push(row(button(s,'undo','最後の選択を戻す').setDisabled(!s.draft.length),button(s,'reset','最初から選ぶ').setDisabled(!s.draft.length)),row(button(s,'apply','この順番で設定',ButtonStyle.Primary).setDisabled(!s.draft.length),button(s,'link','投稿を選び直す')));}
  components.push(row(adminSectionButton('appearance'),adminHomeButton()));
  return {...payload('✦  投稿タグ',(note?`${note}\n\n`:'')+body,{state:s.result?(s.result.actual?'success':'error'):'normal',components}),attachments:[]};
}
export function createForumTagsController({guild,now=()=>Date.now(),access=async i=>{const member=await guild.members.fetch({user:i.user.id,force:true}),channel=await guild.channels.fetch(i.channelId,{force:true});if(!member.permissions.has(P.Administrator)||!channel?.permissionsFor(member)?.has(P.ViewChannel))throw new Error('投稿タグの設定は管理者専用です。');return member;}}){
  const sessions=new AdminSessions(now),busyPosts=new Set();
  const get=(id,i)=>{let s;try{s=sessions.get(id,i.user.id);}catch{throw new Error('この画面は終了しています。/admin から開き直してください。');}if(s.channelId!==i.channelId)throw new Error('元のチャンネルから操作してください。');return s;};
  const ack=acknowledgePrivate;
  async function post(id,member){const thread=await guild.channels.fetch(id,{force:true});if(thread?.guildId!==guild.id || thread.type!==ChannelType.PublicThread)throw new Error('フォーラムの投稿を指定してください。');const parent=await guild.channels.fetch(thread.parentId,{force:true});if(parent?.type!==ChannelType.GuildForum || parent.guildId!==guild.id)throw new Error('フォーラムの投稿を指定してください。');if(!thread.permissionsFor(member)?.has(P.ViewChannel)||!parent.permissionsFor(member)?.has(P.ViewChannel))throw new Error('投稿を閲覧できません。');const me=await guild.members.fetchMe({force:true});if(!thread.permissionsFor(me)?.has([P.ViewChannel,P.ManageThreads]))throw new Error('Botに投稿の閲覧とスレッド管理の権限が必要です。');if(thread.archived || thread.locked)throw new Error('アーカイブ・ロックされていない投稿を指定してください。');return {thread,tags:parent.availableTags.map(t=>({id:t.id,name:t.name,moderated:t.moderated})),parentId:parent.id};}
  const revision=x=>JSON.stringify({tags:x.thread.appliedTags,available:x.tags,parentId:x.parentId});
  async function open(i){let s;try{
    await ack(i);const member=await access(i);s=sessions.resume(i.user.id,i.channelId);
    if(s){if(s.postId){try{await post(s.postId,member);}catch{throw new Error('編集中の投稿を確認できません。権限やアーカイブ状態を確認するか、別の投稿を選んでください。');}await access(i);get(s.id,i);}await i.editReply(forumTagsScreen(s,'前の操作を再開しました。'));return;}
    s=sessions.create(i.user.id);Object.assign(s,{channelId:i.channelId,turn:0,tags:[],draft:[]});await i.editReply(forumTagsScreen(s));
  }catch(e){let safe=false;if(s)try{await access(i);get(s.id,i);safe=!s.busy;}catch{}const m={...payload('投稿タグ',text(e.message),{state:'error',components:[row(...(safe?[button(s,'link','別の投稿を選ぶ')]:[adminFeatureButton('open-forum')]),adminSectionButton('appearance'),adminHomeButton())]}),attachments:[]};if(i.deferred||i.replied)await i.editReply(m);else await i.reply({...m,flags:MessageFlags.Ephemeral});}}
  async function handle(i){let s,locked=false,authorized=false,lockedPost;try{
    const [,id,turn,action,token]=i.customId.split(':');s=get(id,i);if(s.busy)throw new Error('前の操作を処理中です。');s.busy=true;locked=true;
    if(action!=='link')await ack(i);await access(i);get(id,i);authorized=true;if(String(s.turn)!==turn)throw new Error('画面を最新に戻しました。もう一度選んでください。');
    if(action==='link'){s.formToken=randomUUID().slice(0,12);await i.showModal(new ModalBuilder().setCustomId(`forum:${s.id}:${s.turn}:link-form:${s.formToken}`).setTitle('フォーラムの投稿を指定').addComponents(row(new TextInputBuilder().setCustomId('link').setLabel('投稿のリンク').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200).setPlaceholder('https://discord.com/channels/…'))));return;}
    if(action==='link-form'){if(!token||token!==s.formToken)throw new Error('最新の入力フォームから操作してください。');const postId=parseForumPost(i.fields.getTextInputValue('link'),guild.id);authorized=false;const current=await post(postId,await access(i));await access(i);get(id,i);authorized=true;Object.assign(s,{postId,postName:current.thread.name,tags:current.tags,draft:[...current.thread.appliedTags],base:revision(current),result:null});delete s.formToken;}
    else if(action==='add'){if(!s.postId||s.result||i.values?.length!==1||!s.tags.some(t=>t.id===i.values[0])||s.draft.includes(i.values[0])||s.draft.length>=5)throw new Error('タグを選び直してください。');s.draft.push(i.values[0]);}
    else if(action==='undo'){if(!s.postId||s.result)throw new Error('投稿を選び直してください。');s.draft.pop();}
    else if(action==='reset'){if(!s.postId||s.result)throw new Error('投稿を選び直してください。');s.draft=[];}
    else if(action==='apply'){
      if(!s.postId||s.result||s.draft.length<1||s.draft.length>5||new Set(s.draft).size!==s.draft.length)throw new Error('タグを1〜5個選んでください。');if(busyPosts.has(s.postId))throw new Error('この投稿は別の操作で処理中です。');busyPosts.add(s.postId);lockedPost=s.postId;
      authorized=false;const current=await post(s.postId,await access(i));await access(i);get(id,i);authorized=true;if(revision(current)!==s.base)throw new Error('投稿のタグが別の操作で変更されています。投稿を選び直してください。');if(s.draft.some(id=>!current.tags.some(t=>t.id===id)))throw new Error('タグが変更されました。投稿を選び直してください。');
      const requested=[...s.draft];s.result={requested,actual:null};s.turn++;
      try{await current.thread.setAppliedTags(requested,'ASTRAL: ordered forum tag request');}catch{throw new Error('設定結果を確認できません。投稿を確認してください。再送はしません。');}
      try{authorized=false;const member=await access(i);const saved=await guild.channels.fetch(s.postId,{force:true});await access(i);get(id,i);if(!saved?.permissionsFor(member)?.has(P.ViewChannel))throw new Error('投稿を閲覧できません。');authorized=true;s.result.actual=[...saved.appliedTags];}catch{if(!authorized)throw new Error('権限または結果を確認できませんでした。投稿を確認してください。');}
    }else throw new Error('操作を確認してください。');
    s.turn++;await i.editReply(forumTagsScreen(s));
  }catch(e){let safe=false;if(authorized){try{get(s.id,i);safe=true;}catch{}}const m=safe?forumTagsScreen(s,text(e.message)):{...payload('✦  投稿タグ',text(e.message),{state:'error',components:[row(adminFeatureButton('open-forum'),adminSectionButton('appearance'),adminHomeButton())]}),attachments:[]};if(i.deferred||i.replied)await i.editReply(m);else await i.reply({...m,flags:MessageFlags.Ephemeral});}finally{if(locked)s.busy=false;if(lockedPost)busyPosts.delete(lockedPost);}}
  return {sessions,open,handle};
}
