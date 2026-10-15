import {randomUUID} from 'node:crypto';
import {ActionRowBuilder,AttachmentBuilder,ButtonBuilder,ButtonStyle,FileUploadBuilder,LabelBuilder,MessageFlags,ModalBuilder,PermissionFlagsBits as P} from 'discord.js';
import {adminHomeButton,card,payload} from './ui.js';
import {readBannerAttachment} from './banner-image.js';
const ttl=10*60*1000,maximum=4;
const row=(...buttons)=>new ActionRowBuilder().addComponents(...buttons);
const button=(s,action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`banner:${s.id}:${s.turn}:${action}`).setLabel(label).setStyle(style);
export function bannerModal(s){
  return new ModalBuilder().setCustomId(`banner:${s.id}:${s.turn}:submit:${s.token}`).setTitle('バナー画像を選ぶ').addLabelComponents(
    new LabelBuilder().setLabel('PNG・JPEGを1枚').setDescription('4MiB以内。横長の600×240px以上を推奨。まだ公開されません。').setFileUploadComponent(
      new FileUploadBuilder().setCustomId('image').setMinValues(1).setMaxValues(1).setRequired(true)));
}
export function bannerScreen(s,note=''){
  const preview=s.view==='preview',remove=s.view==='remove';
  let body=s.uncertain?'**反映結果を確認してください**\n通信が切れる前に反映済みの場合があります。「現在を確認」で最新の状態を取得してください。':preview?'**まだ変更していません**\n現在のバナーと変更後の画像を確認し、「この画像を適用」を押してください。':remove?'**バナーを解除しますか？**\n下の現在の画像を外し、バナーなしに戻します。':'画像をアップロードして、Botのプロフィール上部のバナーを変更できます。';
  body+=`\n\n**${s.uncertain?'直前の確認':'現在'}** ${s.current.key?'バナーあり':'バナーなし'}\nBot全体のプロフィールに反映されます。このサーバーだけの設定ではありません。\n操作画面は10分で終了します。`;
  if(!preview&&!remove)body+='\n\n画像を選ぶ → プレビュー → 適用\nPNG・JPEG、4MiB以内。横長600×240px以上を推奨。';
  if(note)body=`${note}\n\n${body}`;
  const controls=preview?row(button(s,'apply','この画像を適用',ButtonStyle.Primary).setDisabled(!!s.uncertain),button(s,'upload','画像を選び直す'),button(s,'cancel',s.uncertain?'候補を閉じる':'変更せず戻る')):remove?row(button(s,'apply','バナーを解除',ButtonStyle.Danger).setDisabled(!!s.uncertain),button(s,'cancel',s.uncertain?'確認して戻る':'変更せず戻る')):row(button(s,'upload',s.current.key?'別の画像を選ぶ':'画像を選ぶ',ButtonStyle.Primary),button(s,'remove','バナーを解除').setDisabled(!s.current.key));
  const m={...payload('Botのバナー',body,{state:s.uncertain||remove?'warning':'normal',components:[controls,row(button(s,'refresh','現在を確認'),adminHomeButton(),button(s,'close','操作を終了'))]}),attachments:[]};
  if(s.current.url)m.embeds[0].setImage(s.current.url);
  if(preview&&s.draft){
    m.embeds.push(card(s.uncertain?'適用候補の画像 · 結果を確認中':'変更後のプレビュー · 未適用',`${s.draft.width} × ${s.draft.height}px · ${(s.draft.buffer.length/1024/1024).toFixed(2)}MiB\nプロフィールでは横長に表示されます。実際の切り抜きはDiscordの表示に従います。`).setImage(`attachment://banner-preview.${s.draft.extension}`));
    m.files=[new AttachmentBuilder(s.draft.buffer,{name:`banner-preview.${s.draft.extension}`,description:'Botのプロフィールに適用する前のバナー画像'})];
  }
  return m;
}
export function createBannerController({guild,current,update,read=readBannerAttachment,access,now=Date.now,schedule=setTimeout,cancel=clearTimeout}={}){
  const sessions=new Map();let writing=false,nextWrite=0,closed=false;
  const allowed=access??(async i=>{
    const [member,channel]=await Promise.all([guild.members.fetch({user:i.user.id,force:true}),guild.channels.fetch(i.channelId,{force:true})]);
    return member.permissions.has(P.Administrator)&&channel?.permissionsFor(member)?.has(P.ViewChannel);
  });
  function drop(s){if(!s)return;sessions.delete(s.id);cancel(s.timer);s.abort.abort();s.draft=null;}
  function get(id,i){
    const s=sessions.get(id);
    if(closed||!s||s.expires<=now()){if(s)drop(s);throw new Error('この画面は終了しています。管理メニューの「Botのバナー」から開き直してください。');}
    if(s.owner!==i.user.id||s.channelId!==i.channelId)throw new Error('この画面を開いた本人が、元のチャンネルから操作してください。');
    return s;
  }
  async function check(i,s){if(!await allowed(i))throw new Error('バナーの変更は管理者専用です。現在の権限とチャンネルの閲覧権限を確認してください。');if(s&&get(s.id,i)!==s)throw new Error('画面を開き直してください。');}
  async function ack(i){if(i.deferred||i.replied)return;if(i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});}
  async function failure(i,s,error){
    let safe=false;if(s)try{await check(i,s);safe=true;}catch{}
    let note=error.message??'操作を完了できませんでした。';if(safe&&s.draft)note+='\n表示中の候補は保持しています。適用前に画像を確認してください。';
    const m=safe?bannerScreen(s,note):{...payload('Botのバナー',note,{state:'error',components:[row(adminHomeButton())]}),attachments:[]};
    if(i.deferred||i.replied)await i.editReply(m);else await i.reply({...m,flags:MessageFlags.Ephemeral});
  }
  return {sessions,close(){closed=true;for(const s of sessions.values())drop(s);},
    async open(i){let s;try{
      await check(i);await ack(i);
      if(closed)throw new Error('Botを終了しています。');
      for(const old of sessions.values())if(old.expires<=now())drop(old);
      const previous=[...sessions.values()].find(value=>value.owner===i.user.id);if(previous?.busy)throw new Error('前の操作を処理中です。完了してから開き直してください。');
      if(previous)drop(previous);if(sessions.size>=maximum)throw new Error('バナーの操作画面が使用中です。少し待ってから開いてください。');
      s={id:randomUUID().replaceAll('-','').slice(0,12),owner:i.user.id,channelId:i.channelId,turn:0,view:'home',expires:now()+ttl,abort:new AbortController()};
      sessions.set(s.id,s);s.timer=schedule(()=>drop(s),ttl);s.timer?.unref?.();
      await i.editReply({...payload('Botのバナー','現在のバナーを確認しています。'),attachments:[]});
      s.current=await current();await check(i,s);await i.editReply(bannerScreen(s));
    }catch(error){if(s&&!s.current){drop(s);s=null;}await failure(i,s,error);}},
    async handle(i){let s,locked=false;try{
      const [,id,turn,action,token]=i.customId.split(':');s=get(id,i);await check(i,s);
      if(s.busy)throw new Error('前の操作を処理中です。完了してからお試しください。');
      if(String(s.turn)!==turn)throw new Error('古い画面です。「現在を確認」から開き直してください。');
      s.busy=true;locked=true;
      if(action==='upload'){s.token=randomUUID().replaceAll('-','').slice(0,12);await i.showModal(bannerModal(s));return;}
      await ack(i);await check(i,s);let note='';
      if(action==='close'){drop(s);await i.editReply({...payload('Botのバナー','操作画面を閉じました。現在のバナーはそのままです。',{components:[row(adminHomeButton())]}),attachments:[]});return;}
      if(action==='submit'){
        if(!s.token||s.token!==token)throw new Error('最新の画像選択フォームからアップロードしてください。');
        const files=i.fields.getUploadedFiles('image',true);if(files.size!==1)throw new Error('画像を1枚選んでください。');
        await i.editReply({...payload('Botのバナー','アップロードした画像を確認しています。現在のバナーはまだ変更しません。'),attachments:[]});
        const draft=await read(files.first?.()??[...files.values()][0],{signal:s.abort.signal}),latest=await current();await check(i,s);
        s.draft=draft;s.current=latest;s.base=latest.key;s.view='preview';s.token=null;s.uncertain=false;
      }else if(action==='refresh'){
        const latest=await current();await check(i,s);s.current=latest;s.base=latest.key;s.uncertain=false;
        if(s.view==='remove')s.view='home';note=s.draft?'現在のバナーを再取得しました。変更後の画像も確認してから適用してください。':'現在のバナーを確認しました。';
      }else if(action==='cancel'){if(s.uncertain){const latest=await current();await check(i,s);s.current=latest;}s.draft=null;s.view='home';s.token=null;s.uncertain=false;}
      else if(action==='remove'){
        const latest=await current();await check(i,s);if(!latest.key)throw new Error('現在のバナーはすでに解除されています。');
        s.current=latest;s.base=latest.key;s.draft=null;s.view='remove';s.uncertain=false;
      }else if(action==='apply'){
        if(s.view!=='remove'&&!(s.view==='preview'&&s.draft))throw new Error('先に画像のプレビューまたは解除内容を確認してください。');
        if(s.uncertain)throw new Error('前回の反映結果を「現在を確認」で確認してから操作してください。');
        if(writing)throw new Error('別のバナー変更を処理中です。完了後に「現在を確認」を押してください。');
        if(now()<nextWrite)throw new Error(`変更直後です。あと${Math.ceil((nextWrite-now())/1000)}秒待ってから適用してください。`);
        writing=true;
        try{
          const latest=await current();await check(i,s);
          if(latest.key!==s.base)throw new Error('他の操作でバナーが変わりました。「現在を確認」で変更後を確認してから適用してください。');
          const image=s.view==='remove'?null:s.draft.buffer;
          await i.editReply({...payload('Botのバナー','プロフィールに反映しています。完了するまでお待ちください。'),attachments:[]});
          await check(i,s);let result;try{result=await update(image);}catch(error){s.uncertain=true;throw error;}nextWrite=now()+60000;
          get(s.id,i);s.current=result;s.draft=null;s.view='home';s.token=null;note='✓ バナーを変更しました。再起動は不要です。';
        }finally{writing=false;}
      }else throw new Error('操作を確認してください。');
      await check(i,s);s.turn++;await i.editReply(bannerScreen(s,note));
    }catch(error){await failure(i,locked||s&&!s.busy?s:null,error);}finally{if(locked)s.busy=false;}}
  };
}
