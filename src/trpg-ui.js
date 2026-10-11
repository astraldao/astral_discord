import {ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,ChannelSelectMenuBuilder,ChannelType,ModalBuilder,TextInputBuilder,TextInputStyle,MessageFlags,AttachmentBuilder,escapeMarkdown,PermissionFlagsBits as P} from 'discord.js';
import {AdminSessions} from './admin.js';
import {canConfigure} from './commands.js';
import {payload,text} from './ui.js';
import {visibleCharacters,searchScenarios,iacharaUrl} from './trpg-store.js';
import {createIacharaClient} from './iachara.js';
const row=(...x)=>new ActionRowBuilder().addComponents(...x);
const button=(s,a,label)=>new ButtonBuilder().setCustomId(`trpg:${s.id}:${a}`).setLabel(label).setStyle(ButtonStyle.Secondary);
const menu=(s,a,label,items)=>new StringSelectMenuBuilder().setCustomId(`trpg:${s.id}:${a}`).setPlaceholder(label).addOptions(items);
const input=(id,label,max,required=true)=>row(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setMaxLength(max).setRequired(required));
function form(s,kind){const m=new ModalBuilder().setCustomId(`trpg:${s.id}:submit-${kind}`).setTitle({scenario:'シナリオとベース卓',search:'シナリオ名で検索',register:'いあきゃら登録・更新'}[kind]);if(kind==='scenario')m.addComponents(input('name','シナリオ名（同名は上書き）',100),input('url','ココフォリアのベース卓URL',250));else if(kind==='search')m.addComponents(input('query','検索するシナリオ名',100,false));else m.addComponents(input('url','いあきゃらの共有URL',100));return m;}
export function trpgPanel(p){const shared=p.mode==='shared';return payload('✦  CHARACTER ARCHIVE',`${shared?'**共有モード** · PC名と共有URLをメンバーに表示':'**秘匿モード** · PC名と共有URLは本人・管理者のみ'}\n\nいあきゃらの共有URLから登録できます。\nTXTの控え・プレビューは、どちらのモードでも本人と管理者だけに表示します。`,{components:[row(new ButtonBuilder().setCustomId(`trpg:p:${p.id}:open`).setLabel('キャラシを開く').setStyle(ButtonStyle.Primary))]});}
export function createTrpgController({store,guild,iachara=createIacharaClient(),access=async i=>{const member=await guild.members.fetch({user:i.user.id,force:true});const channel=await guild.channels.fetch(i.channelId,{force:true});if(!channel?.permissionsFor(member)?.has(P.ViewChannel))throw new Error('このチャンネルの閲覧権限がありません。');return canConfigure(member.permissions);}}) {
  const sessions=new AdminSessions();const cooldown=new Map();
  const isAdmin=i=>access(i);
  function screen(s,note=''){
    if(['home','install','scenarios','archives'].includes(s.view) && !s.isAdmin)throw new Error('管理者専用の画面です。');
    const d=store.metadata();let title='✦  卓・キャラシ管理',body='',components=[];
    const back=()=>row(button(s,'home','戻る'));
    if(s.view==='home'){body='ベース卓は管理者用の非公開画面から確認できます。\nキャラシパネルは設置時に秘匿／共有を選択します。';components=[row(button(s,'scenarios','ベース卓を探す'),button(s,'form-scenario','ベース卓を登録'),button(s,'install','キャラシパネルを設置')),row(button(s,'archives','キャラ控えを管理'))];}
    else if(s.view==='install'){body=`**モード** ${s.mode==='shared'?'共有':'秘匿'}\n**設置先** ${s.channelId?`<#${s.channelId}>`:'未選択'}\n\n共有するのはPC名と共有URLだけです。既存パネルの公開範囲は変更しません。`;components=[row(menu(s,'mode','公開範囲を選ぶ',[{label:'秘匿 · 本人と管理者のみ',value:'secret'},{label:'共有 · PC名とURLを公開',value:'shared'}])),row(new ChannelSelectMenuBuilder().setCustomId(`trpg:${s.id}:channel`).setPlaceholder('設置先チャンネル').addChannelTypes(ChannelType.GuildText)),row(button(s,'place','この設定で設置する')),back()];}
    else if(s.view==='scenarios'){title='✦  ベース卓';const items=searchScenarios(d.scenarios,s.query??'');const pages=Math.max(1,Math.ceil(items.length/20));s.page=Math.max(0,Math.min(s.page,pages-1));body=`${items.length}件 · ${s.page+1}/${pages}ページ\n\n${s.scenario?`**${text(s.scenario.name)}**\n${s.scenario.url}`:'シナリオを選択すると、ベース卓URLを表示します。'}`;const part=items.slice(s.page*20,s.page*20+20);if(part.length)components.push(row(menu(s,'scenario','シナリオを選ぶ',part.map(x=>({label:x.name,value:x.id})))));components.push(row(button(s,'form-search','名前で検索'),button(s,'prev','前へ').setDisabled(s.page===0),button(s,'next','次へ').setDisabled(s.page>=pages-1)),back());}
    else if(s.view==='archives'){title='✦  キャラ控え';body='パネルを選ぶと、登録されたPCとバックアップを確認できます。';const pages=Math.max(1,Math.ceil(d.panels.length/25));s.page=Math.max(0,Math.min(s.page,pages-1));if(d.panels.length)components.push(row(menu(s,'archive-panel','パネルを選ぶ',d.panels.slice(s.page*25,s.page*25+25).map(p=>({label:`${p.mode==='secret'?'秘匿':'共有'} · ${guild.channels.cache.get(p.channelId)?.name??p.channelId}`.slice(0,100),value:p.id})))));components.push(row(button(s,'prev','前へ').setDisabled(s.page===0),button(s,'next','次へ').setDisabled(s.page>=pages-1)),back());}
    else {
      const p=d.panels.find(x=>x.id===s.panelId);if(!p)throw new Error('パネルが見つかりません。');title='✦  キャラシ';
      if(s.view==='detail' || s.view==='preview'){
        const c=store.character(s.characterId,s.userId,s.panelId,s.isAdmin);body=`**${text(c.name)}**\n${c.url}\n\n最終保存 <t:${Math.floor(c.updatedAt/1000)}:f>`;
        if(s.view==='preview'){const pages=Math.max(1,Math.ceil(c.txt.length/1400));s.page=Math.max(0,Math.min(s.page,pages-1));body+=`\n\n**TXT · ${s.page+1}/${pages}ページ**\n${escapeMarkdown(c.txt.slice(s.page*1400,(s.page+1)*1400)).replace(/@/g,'＠')}`;components.push(row(button(s,'prev','前へ').setDisabled(s.page===0),button(s,'next','次へ').setDisabled(s.page>=pages-1)));}
        components.push(row(button(s,'refresh','最新データに更新'),button(s,'preview','TXTプレビュー'),button(s,'download','TXTを保存')),row(button(s,'characters','PC一覧へ')));
      }else{
        const items=visibleCharacters(d,s.panelId,s.userId,s.isAdmin);const pages=Math.max(1,Math.ceil(items.length/10));s.page=Math.max(0,Math.min(s.page,pages-1));const part=items.slice(s.page*10,s.page*10+10);body=`${p.mode==='secret'?'秘匿':'共有'}モード · ${items.length}件\n\n${part.map(c=>`**${text(c.name)}**\n${c.url}`).join('\n\n')||'キャラシはまだ登録されていません。'}\n\n${s.page+1}/${pages}ページ\nTXTは本人と管理者のみ閲覧できます。`;
        const own=part.filter(c=>d.characters.some(x=>x.id===c.id && (x.ownerId===s.userId || s.isAdmin)));if(own.length)components.push(row(menu(s,'character','控えを開くPCを選ぶ',own.map(c=>({label:c.name,value:c.id})))));
        components.push(row(button(s,'form-register','登録・URLから更新'),button(s,'prev','前へ').setDisabled(s.page===0),button(s,'next','次へ').setDisabled(s.page>=pages-1)));if(s.isAdmin)components.push(back());
      }
    }
    const message=payload(title,(note?`${note}\n\n`:'')+body,{components});message.attachments=[];message.embeds[0].setAuthor({name:'ASTRAL · TABLE ARCHIVE'}).setFooter({text:'この画面はあなただけに表示 · 操作期限10分'});return message;
  }
  const requireAdmin=s=>{if(!s.isAdmin)throw new Error('管理者専用の操作です。');};
  async function fetchSave(s,url,owner=s.userId,i){const time=Date.now();if((cooldown.get(s.userId)??0)>time)throw new Error('更新は30秒に1回です。少し待ってください。');if(cooldown.size>1000)for(const [id,end] of cooldown)if(end<=time)cooldown.delete(id);cooldown.set(s.userId,time+30000);url=iacharaUrl(url);const result=await iachara.fetchCharacter(url);sessions.get(s.id,s.userId);s.isAdmin=await isAdmin(i);sessions.get(s.id,s.userId);if(owner!==s.userId && !s.isAdmin)throw new Error('管理者権限が変更されたため更新を中止しました。');s.characterId=await store.saveCharacter(s.panelId,owner,url,result);s.view='detail';s.page=0;}
  return {sessions,async open(i){await i.deferReply({flags:MessageFlags.Ephemeral});if(!await isAdmin(i))throw new Error('管理者専用です。');const s=sessions.create(i.user.id);s.isAdmin=true;s.originChannelId=i.channelId;s.view='home';await i.editReply(screen(s));},async handle(i){let s,locked=false;
    try {
      const parts=i.customId.split(':');
      if(parts[1]==='p'){const p=store.metadata().panels.find(x=>x.id===parts[2]);if(!p || p.channelId!==i.channelId || p.messageId!==i.message?.id || parts[3]!=='open')throw new Error('このパネルは利用できません。');await i.deferReply({flags:MessageFlags.Ephemeral});s=sessions.create(i.user.id);Object.assign(s,{isAdmin:await isAdmin(i),originChannelId:i.channelId,view:'characters',panelId:p.id});await i.editReply(screen(s));return;}
      s=sessions.get(parts[1],i.user.id);if(s.originChannelId && s.originChannelId!==i.channelId)throw new Error('元のチャンネルから操作してください。');const action=parts[2];if(s.busy)throw new Error('前の操作を処理中です。');s.busy=true;locked=true;
      if(action.startsWith('form-')){s.isAdmin=await isAdmin(i);const kind=action.slice(5);if(kind!=='register')requireAdmin(s);if(kind==='register' && !s.panelId)throw new Error('パネルから開いてください。');await i.showModal(form(s,kind));return;}
      // Always create a private response, including forged/public component requests.
      if(i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});s.isAdmin=await isAdmin(i);sessions.get(s.id,s.userId);let note='';
      if(['home','scenarios','archives','install'].includes(action)){requireAdmin(s);s.view=action;s.page=0;s.mode??='secret';}
      else if(action==='mode'){requireAdmin(s);if(!['secret','shared'].includes(i.values[0]))throw new Error('公開範囲を選択してください。');s.mode=i.values[0];}
      else if(action==='channel'){requireAdmin(s);s.channelId=i.values[0];}
      else if(action==='place'){requireAdmin(s);const channel=await guild.channels.fetch(s.channelId);if(channel?.type!==ChannelType.GuildText || !channel.permissionsFor(guild.members.me)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks]))throw new Error('設置先とBotの閲覧・送信・埋め込み権限を確認してください。');const id=await store.addPanel(channel.id,s.mode);const p=store.metadata().panels.find(x=>x.id===id);let message;try{message=await channel.send(trpgPanel(p));await store.update(d=>{d.panels.find(x=>x.id===id).messageId=message.id;});}catch(e){if(message)await message.delete().catch(()=>{});await store.update(d=>{d.panels=d.panels.filter(x=>x.id!==id);});throw e;}note='✓ キャラシパネルを設置しました。';s.view='home';}
      else if(action==='submit-scenario'){requireAdmin(s);await store.scenario(i.fields.getTextInputValue('name'),i.fields.getTextInputValue('url'));s.view='scenarios';s.query='';s.scenario=null;note='✓ ベース卓を登録しました。';}
      else if(action==='submit-search'){requireAdmin(s);s.query=i.fields.getTextInputValue('query');s.view='scenarios';s.page=0;s.scenario=null;}
      else if(action==='scenario'){requireAdmin(s);s.scenario=store.metadata().scenarios.find(x=>x.id===i.values[0]);if(!s.scenario)throw new Error('シナリオが見つかりません。');}
      else if(action==='archive-panel'){requireAdmin(s);s.panelId=i.values[0];s.view='characters';s.page=0;}
      else if(action==='submit-register'){await fetchSave(s,i.fields.getTextInputValue('url'),s.userId,i);note='✓ PC名・共有URL・TXTを保存しました。';}
      else if(action==='character'){store.character(i.values[0],s.userId,s.panelId,s.isAdmin);s.characterId=i.values[0];s.view='detail';s.page=0;}
      else if(action==='characters'){s.view='characters';s.page=0;}
      else if(action==='refresh'){const c=store.character(s.characterId,s.userId,s.panelId,s.isAdmin);await fetchSave(s,c.url,c.ownerId,i);note='✓ 最新のキャラデータを保存しました。';}
      else if(action==='preview'){store.character(s.characterId,s.userId,s.panelId,s.isAdmin);s.view='preview';s.page=0;}
      else if(action==='download'){const c=store.character(s.characterId,s.userId,s.panelId,s.isAdmin);await i.editReply({...screen(s),files:[new AttachmentBuilder(Buffer.from(c.txt,'utf8'),{name:`character-${c.id}.txt`})]});return;}
      else if(action==='prev' || action==='next')s.page+=action==='prev'?-1:1;
      else throw new Error('不明な操作です。');
      await i.editReply(screen(s,note));
    }catch(e){const error=payload('✧  卓・キャラシ',`操作できませんでした：${text(e.message)}\n既存の控えは保持しています。パネルまたは /管理 から開き直せます。`,{state:'error'});error.attachments=[];if(i.deferred || i.replied)await i.editReply(error);else await i.reply({...error,flags:MessageFlags.Ephemeral});}finally{if(locked)s.busy=false;}
  }};
}
