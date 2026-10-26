import {randomUUID} from 'node:crypto';
import {ActionRowBuilder,AttachmentBuilder,ButtonBuilder,ButtonStyle,FileUploadBuilder,LabelBuilder,ModalBuilder,StringSelectMenuBuilder,MessageFlags,PermissionFlagsBits as P} from 'discord.js';
import {themed,menuHomeButton,acknowledgePrivate} from './ui.js';
import {workshopPresets,workshopCrops,workshopOptions} from './image-workshop-options.js';
import {readWorkshopImage} from './image-workshop-input.js';
import {processWorkshopImage} from './image-workshop-process.js';
const {payload}=themed('menu'),ttl=600000,row=(...c)=>new ActionRowBuilder().addComponents(...c),token=()=>randomUUID().slice(0,12);
class WorkshopError extends Error{}
const button=(s,action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`image:${s.id}:${s.turn}:${action}`).setLabel(label).setStyle(style);
export function workshopModal(s){return new ModalBuilder().setCustomId(`image:${s.id}:${s.turn}:submit:${s.upload}`).setTitle('画像工房 / 画像を選ぶ').addLabelComponents(new LabelBuilder().setLabel('PNG・JPEGを1枚').setDescription('4MiB・約400万画素以内。アニメーションには対応していません。').setFileUploadComponent(new FileUploadBuilder().setCustomId('image').setMinValues(1).setMaxValues(1).setRequired(true)));}
export function workshopScreen(s,note=''){
  const p=workshopPresets[s.preset],crop=workshopCrops[s.crop],body=s.input?`**${s.output?'完成しました':'用途と仕上げを選んでください'}**\n元画像 ${s.input.width}×${s.input.height}px · ${(s.input.buffer.length/1024).toFixed(0)}KiB\n\n**用途** ${p.label} · ${p.description}\n**仕上げ** ${crop.label}${s.preset==='share'?'\n共有用はJPEG・白い背景です。':''}\n\n${s.output?`完成 ${s.output.width}×${s.output.height}px · ${(s.output.buffer.length/1024).toFixed(1)}KiB\n添付の画像を保存してください。設定を変えると元画像から作り直せます。`:'選択した設定で「画像を作成」を押してください。'}\n\n画像は本人だけに表示し、サーバーへの登録や公開投稿は行いません。`:'**画像を選ぶ → 用途・仕上げ → 作成・保存**\n\n絵文字・スタンプ・共有用に画像を整えます。\nPNG・JPEG、4MiB・約400万画素以内。\n\n全体を残すか、中央・上下左右を中心に正方形へ切り抜けます。操作は本人だけに表示され、10分で終了します。';
  const controls=s.input?[
    row(new StringSelectMenuBuilder().setCustomId(`image:${s.id}:${s.turn}:preset`).setPlaceholder('用途を選ぶ').addOptions(Object.entries(workshopPresets).map(([value,x])=>({value,label:x.label,description:x.description,default:value===s.preset})))),
    row(new StringSelectMenuBuilder().setCustomId(`image:${s.id}:${s.turn}:crop`).setPlaceholder('切り抜き・余白を選ぶ').addOptions(Object.entries(workshopCrops).map(([value,x])=>({value,label:x.label,...(x.description?{description:x.description}:{}),default:value===s.crop})))),
    row(button(s,'create',s.output?'同じ設定で作成':'画像を作成',ButtonStyle.Primary),button(s,'upload','画像を選び直す'),button(s,'close','操作を終了')),
  ]:[row(button(s,'upload','画像を選ぶ',ButtonStyle.Primary),button(s,'close','操作を終了'))];
  const m={...payload('画像工房',`${note?`${note}\n\n`:''}${body}`,{components:[...controls,row(menuHomeButton())]}),attachments:[]};
  if(s.output){const name=`astral-${s.preset}.${s.output.extension}`;m.files=[new AttachmentBuilder(s.output.buffer,{name,description:`${p.label}向けに整形した画像`})];m.embeds[0].setImage(`attachment://${name}`);}
  return m;
}
export function createImageWorkshop({guild,read=readWorkshopImage,convert=processWorkshopImage,access,canProcess=()=>true,now=Date.now,schedule=setTimeout,cancel=clearTimeout}={}){
  const sessions=new Map(),cooldowns=new Map();let active=false,closed=false,nextGlobal=0;
  const allowed=access??(async i=>{
    const [member,bot,channel]=await Promise.all([guild.members.fetch({user:i.user.id,force:true}),guild.members.fetchMe({force:true}),guild.channels.fetch(i.channelId,{force:true})]);
    return !member.user?.bot&&!member.pending&&channel?.guildId===guild.id&&channel.isTextBased?.()&&!channel.archived&&!channel.locked&&channel.permissionsFor(member)?.has(P.ViewChannel)&&channel.permissionsFor(bot)?.has([P.ViewChannel,P.EmbedLinks,P.AttachFiles,channel.isThread?.()?P.SendMessagesInThreads:P.SendMessages]);
  });
  function drop(s){sessions.delete(s.id);cancel(s.timer);s.abort.abort();s.input=null;s.output=null;}
  function get(id,i){const s=sessions.get(id);if(closed||!s||s.expires<=now()){if(s)drop(s);throw new WorkshopError('画面の期限が切れました。/menu の「画像工房」から開き直してください。');}if(s.owner!==i.user.id||s.channel!==i.channelId)throw new WorkshopError('開いた本人が元のチャンネルから操作してください。');return s;}
  async function check(i,s){if(!await allowed(i))throw new WorkshopError('現在の閲覧権限と、Botの送信・埋め込み・ファイル添付権限を確認してください。');if(s&&get(s.id,i)!==s)throw new WorkshopError('画像工房を開き直してください。');if(closed)throw new WorkshopError('Botを終了しています。');}
  async function failure(i,s,error){if(s?.hidden)return;let safe=false;if(s)try{await check(i,s);safe=true;}catch{}const note=error instanceof WorkshopError?error.message:'画像を処理できませんでした。PNG・JPEGの小さな画像を選び直してください。';const m=safe?workshopScreen(s,note):{...payload('画像工房',note,{state:'error',components:[row(menuHomeButton())]}),attachments:[]};if(i.deferred||i.replied)await i.editReply(m);else await i.reply({...m,flags:MessageFlags.Ephemeral});}
  return {sessions,get busy(){return active;},close(){closed=true;for(const s of sessions.values())drop(s);cooldowns.clear();},
    leave(i){
      if(i.customId?.startsWith('image:')||i.customId==='menu:workshop'||['menu:find','menu:recent'].includes(i.customId)&&i.values?.[0]==='workshop'||i.isChatInputCommand?.()&&i.commandName==='menu'&&i.options?.getString('操作')==='workshop')return;
      for(const s of sessions.values())if(s.owner===i.user.id&&s.channel===i.channelId)s.hidden=true;
    },
    async open(i){let s;try{
      await acknowledgePrivate(i);await check(i);
      for(const old of sessions.values())if(old.expires<=now())drop(old);
      const previous=[...sessions.values()].find(x=>x.owner===i.user.id);if(previous?.busy)throw new WorkshopError('前の画像を処理中です。完了してから開き直してください。');
      if(previous?.channel===i.channelId){s=previous;s.busy=true;s.hidden=false;s.turn++;s.upload=null;await check(i,s);await i.editReply(workshopScreen(s,'前の操作を再開しました。'));return;}
      if(previous)drop(previous);if(sessions.size>=20)throw new WorkshopError('画像工房が使用中です。少し待って開いてください。');
      s={id:token(),owner:i.user.id,channel:i.channelId,expires:now()+ttl,abort:new AbortController(),turn:0,preset:'emoji',crop:'contain',input:null,output:null,busy:true};sessions.set(s.id,s);s.timer=schedule(()=>drop(s),ttl);s.timer?.unref?.();await check(i,s);await i.editReply(workshopScreen(s));
    }catch(e){await failure(i,s,e);}finally{if(s)s.busy=false;}},
    async handle(i){let s,locked=false;try{
      const [,id,turn,action,upload]=i.customId.split(':');
      if(action==='upload'){
        s=get(id,i);if(s.busy||String(s.turn)!==turn)throw new WorkshopError('最新の画面で、前の操作の完了を待ってください。');s.busy=true;locked=true;s.upload=token();await i.showModal(workshopModal(s));return;
      }
      await acknowledgePrivate(i);s=get(id,i);await check(i,s);
      if(s.busy)throw new WorkshopError('前の操作を処理中です。完了してからお試しください。');if(String(s.turn)!==turn)throw new WorkshopError('古い画面です。最新の画像工房から操作してください。');s.busy=true;locked=true;
      s.hidden=false;
      if(action==='close'){drop(s);await i.editReply({...payload('画像工房','操作を終了し、Botが保持していた画像を破棄しました。',{components:[row(menuHomeButton())]}),attachments:[]});return;}
      if(action==='submit'){
        if(!s.upload||upload!==s.upload)throw new WorkshopError('最新の画像選択フォームから送信してください。');s.upload=null;s.turn++;
        const files=i.fields.getUploadedFiles('image',true);if(files.size!==1)throw new WorkshopError('画像を1枚選んでください。');
        if(!s.input&&[...sessions.values()].filter(x=>x.input||x.loading).length>=4)throw new WorkshopError('画像の保持枠が使用中です。操作の終了を待って選び直してください。');
        s.loading=true;try{await check(i,s);const input=await read(files.first?.()??[...files.values()][0],{signal:s.abort.signal});await check(i,s);s.input=input;s.output=null;}finally{s.loading=false;}
      }else if(action==='preset'||action==='crop'){
        const choices=action==='preset'?workshopPresets:workshopCrops;if(!s.input||i.values?.length!==1||!Object.hasOwn(choices,i.values[0]))throw new WorkshopError('画面の選択欄から選び直してください。');s[action]=i.values[0];s.output=null;s.turn++;
      }else if(action==='create'){
        if(!s.input||!workshopOptions(s.preset,s.crop))throw new WorkshopError('先に画像と用途を選んでください。');if(active)throw new WorkshopError('別の画像を作成中です。完了してからお試しください。');
        for(const [user,until] of cooldowns)if(until<=now())cooldowns.delete(user);const wait=Math.max(nextGlobal,cooldowns.get(s.owner)??0)-now();if(wait>0)throw new WorkshopError(`続けて作成する場合は、あと${Math.ceil(wait/1000)}秒お待ちください。`);
        if(!canProcess())throw new WorkshopError('音声の処理中です。終了してから画像を作成してください。');if(cooldowns.size>=200)throw new WorkshopError('少し待ってから作成してください。');
        s.turn++;active=true;try{
          await check(i,s);if(!canProcess())throw new WorkshopError('音声の処理中です。終了してから画像を作成してください。');cooldowns.set(s.owner,now()+10000);nextGlobal=now()+2000;
          await i.editReply({...payload('画像工房','画像を作成しています。完了までお待ちください。\nメニューへ戻った場合は、完了後に画像工房を開き直すと結果を確認できます。',{components:[row(menuHomeButton())]}),attachments:[]});
          await check(i,s);const output=await convert(s.input.buffer,{preset:s.preset,crop:s.crop,signal:s.abort.signal});await check(i,s);s.output=output;
        }finally{active=false;}
      }else throw new WorkshopError('操作を選び直してください。');
      await check(i,s);if(!s.hidden)await i.editReply(workshopScreen(s));
    }catch(e){await failure(i,locked?s:null,e);}finally{if(locked)s.busy=false;}}
  };
}
