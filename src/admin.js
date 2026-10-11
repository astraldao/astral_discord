import {randomUUID} from 'node:crypto';
import {ActionRowBuilder,ButtonBuilder,ButtonStyle,ChannelSelectMenuBuilder,StringSelectMenuBuilder,ModalBuilder,TextInputBuilder,TextInputStyle,ChannelType,PermissionFlagsBits as P,MessageFlags} from 'discord.js';
import {canConfigure} from './commands.js';
import {payload,text} from './ui.js';
import {validateSettings} from './settings.js';

export function changeSettings(c,action,value) {
  if(action==='lobby') {
    if(c.targetIds.includes(value))throw new Error('行き先から削除してからロビーに設定してください。');
    c.lobbyId=value;
  } else if(action==='add') {
    if(value===c.lobbyId)throw new Error('ロビーを行き先にはできません。');
    if(c.targetIds.includes(value))throw new Error('そのVCはすでに登録されています。');
    c.targetIds.push(value);
  } else if(action==='remove') {
    if(!c.targetIds.includes(value))throw new Error('そのVCは登録されていません。');
    c.targetIds=c.targetIds.filter(id=>id!==value);
  } else if(action==='seconds' || action==='volume') {
    if(!/^\d+$/.test(value))throw new Error('整数を入力してください。待機は3〜15秒、音量は10〜60%です。');
    c[action]=Number(value);
  } else if(action==='voice' || action==='enforce')c[action]=value;
  else if(action==='word-add' || action==='word-remove') {
    const surface=String(value.surface).normalize('NFKC').trim();
    if(!surface || surface.length>32 || !/^[\p{L}\p{N} ー]+$/u.test(surface))throw new Error('単語は32文字以内の文字・数字・空白で入力してください。');
    if(action==='word-remove' && !(c.words??[]).some(w=>w.surface.toLowerCase()===surface.toLowerCase()))throw new Error('その読み方は登録されていません。');
    c.words=(c.words??[]).filter(w=>w.surface.toLowerCase()!==surface.toLowerCase());
    if(action==='word-add') {
      const reading=String(value.reading).normalize('NFKC').trim().replace(/[ぁ-ゖ]/g,ch=>String.fromCharCode(ch.charCodeAt(0)+0x60));
      if(!/^[ァ-ヴー]+$/.test(reading) || reading.length>40)throw new Error('読みは40文字以内のひらがな・カタカナ・長音で入力してください。');
      c.words.push({surface,reading});
    }
  } else throw new Error('不明な設定操作です。');
  validateSettings(c);
}
export class AdminSessions {
  sessions=new Map();
  constructor(now=()=>Date.now()){this.now=now;}
  create(userId){
    for(const [id,s] of this.sessions)if(s.expires<=this.now() || s.userId===userId)this.sessions.delete(id);
    if(this.sessions.size>=200)this.sessions.delete(this.sessions.keys().next().value);
    const s={id:randomUUID().slice(0,12),userId,expires:this.now()+600000,view:'home',page:0,stage:null};
    this.sessions.set(s.id,s);return s;
  }
  get(id,userId){
    const s=this.sessions.get(id);
    if(!s || s.userId!==userId || s.expires<=this.now())throw new Error('操作期限が切れました。 /管理 で開き直してください。');
    return s;
  }
}
const row=(...components)=>new ActionRowBuilder().addComponents(...components);
const button=(s,action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`admin:${s.id}:${action}`).setLabel(label).setStyle(style);
const summary=c=>`**ロビー** ${c.lobbyId?`<#${c.lobbyId}>`:'未設定'}\n**行き先** ${c.targetIds.length}件\n**待機** ${c.seconds}秒\n**音声** ${c.voice?'ON':'OFF'} · 音量 ${c.volume}%\n**直接入室** ${c.enforce?'検出後ロビーへ戻す':'許可'}`;
export function adminScreen(s,c,channelName=id=>id,note='') {
  let title='✦  管理',description=summary(c),components=[];
  const back=()=>row(button(s,'home','戻る'));
  if(s.stage) {
    title='✧  変更を確認';description=`${s.stage.description}\n\n保存すると待機中の入室予約を取り消します。\n内容を確認して保存してください。`;
    components=[row(button(s,'save','保存する',ButtonStyle.Primary),button(s,`nav-${s.view}`,'戻る'))];
  } else if(s.view==='home') {
    description+='\n\n変更したい項目を選んでください。';
    components=[row(button(s,'nav-vc','VC設定',ButtonStyle.Primary),button(s,'nav-audio','音声設定',ButtonStyle.Primary)),row(button(s,'nav-panel','パネル管理'),button(s,'nav-overview','設定一覧'),button(s,'open-densuke','日程調整'),button(s,'open-trpg','卓・キャラシ'))];
  } else if(s.view==='vc') {
    title='✦  VC設定';
    components=[row(button(s,'pick-lobby','ロビーを変更'),button(s,'pick-add','行き先を追加'),button(s,'pick-remove','行き先を削除')),row(button(s,'form-seconds','待機秒数を変更'),button(s,'toggle-enforce',c.enforce?'直接入室を許可する':'直接入室を制御する')),back()];
  } else if(s.view==='audio') {
    title='✦  音声設定';description=`**ずんだもん** ${c.voice?'ON':'OFF'}\n**音量** ${c.volume}%\n**読み方辞書** ${c.words.length}件`;
    components=[row(button(s,'toggle-voice',c.voice?'告知をOFFにする':'告知をONにする'),button(s,'form-volume','音量を変更'),button(s,'nav-words','読み方辞書')),back()];
  } else if(s.view==='words') {
    title=`✦  読み方辞書 · ${c.words.length}件`;
    const pages=Math.max(1,Math.ceil(c.words.length/10));s.page=Math.max(0,Math.min(s.page,pages-1));
    const words=c.words.slice(s.page*10,s.page*10+10);
    description=(words.map(w=>`**${text(w.surface)}** → ${text(w.reading)}`).join('\n')||'読み方はまだ登録されていません。')+`\n\n${s.page+1} / ${pages}ページ`;
    if(words.length)components.push(row(new StringSelectMenuBuilder().setCustomId(`admin:${s.id}:word-remove`).setPlaceholder('削除する読み方を選ぶ').addOptions(words.map(w=>({label:w.surface,value:w.surface,description:w.reading})))));
    components.push(row(button(s,'form-word','登録・上書き',ButtonStyle.Primary),button(s,'words-prev','前へ').setDisabled(s.page===0),button(s,'words-next','次へ').setDisabled(s.page>=pages-1)),row(button(s,'nav-audio','戻る')));
  } else if(s.view==='panel') {
    title='✦  パネル管理';description=`**設置先** ${c.lobbyId?`<#${c.lobbyId}>`:'ロビー未設定'}\n\n同じロビーのパネルは更新します。ロビーを変更した場合、古いパネルは管理者が削除してください。`;
    components=[row(button(s,'install-panel','設置・更新',ButtonStyle.Primary)),back()];
  } else if(s.view==='overview') {
    title='✦  設定一覧';description+='\n\n**行き先**\n'+(c.targetIds.slice(0,25).map(id=>`<#${id}>`).join('\n')||'未設定')+(c.targetIds.length>25?`\nほか ${c.targetIds.length-25}件`:'')+`\n\n**読み方辞書** ${c.words.length}件\n設定は自動保存されます。`;
    components=[back()];
  } else if(s.view.startsWith('pick-')) {
    title='✦  チャンネルを選択';const action=s.view.slice(5);
    description=summary(c)+'\n\n'+({lobby:'新しいロビーVCを選んでください。',add:'追加する行き先VCを選んでください。',remove:'削除する行き先を選んでください。'}[action]);
    if(action==='remove') {
      const pages=Math.max(1,Math.ceil(c.targetIds.length/25));s.page=Math.max(0,Math.min(s.page,pages-1));
      const ids=c.targetIds.slice(s.page*25,s.page*25+25);
      if(ids.length)components.push(row(new StringSelectMenuBuilder().setCustomId(`admin:${s.id}:remove`).setPlaceholder('行き先を削除').addOptions(ids.map(id=>({label:channelName(id).slice(0,100),value:id})))));
      else description+='\n登録された行き先はありません。';
      components.push(row(button(s,'targets-prev','前へ').setDisabled(s.page===0),button(s,'targets-next','次へ').setDisabled(s.page>=pages-1)));
    } else components.push(row(new ChannelSelectMenuBuilder().setCustomId(`admin:${s.id}:${action}`).setPlaceholder('通常のVCを選ぶ').addChannelTypes(ChannelType.GuildVoice)));
    components.push(row(button(s,'nav-vc','戻る')));
  }
  if(note)description=`${note}\n\n${description}`;
  const message=payload(title,description,{components});
  message.embeds[0].setFooter({text:'管理者専用 · 操作期限10分 · /管理 で開き直せます'});
  return message;
}
export function adminModal(s,kind,c) {
  const modal=new ModalBuilder().setCustomId(`admin:${s.id}:submit-${kind}`).setTitle({seconds:'待機秒数',volume:'音量',word:'読み方の登録・上書き'}[kind]);
  const input=(id,label,max,value)=>{const field=new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setMaxLength(max).setRequired(true);if(value)field.setValue(value);return row(field);};
  if(kind==='word')modal.addComponents(input('surface','表示名全体または英単語（32文字以内）',32,''),input('reading','読み（ひらがな・カタカナ、40文字以内）',40,''));
  else modal.addComponents(input('value',kind==='seconds'?'待機秒数（3〜15秒）':'音量（10〜60%）',2,String(c[kind])));
  return modal;
}
export function createAdminController({settings,guild,refreshPanel,changed,pendingCount,openDensuke,openTrpg}) {
  const sessions=new AdminSessions();
  const screen=(s,note='')=>adminScreen(s,settings.get(),id=>guild.channels.cache.get(id)?.name??`削除済みのVC (${id})`,note);
  async function validateChannel(action,value) {
    if(!['lobby','add'].includes(action))return;
    const channel=await guild.channels.fetch(value);
    if(channel?.type!==ChannelType.GuildVoice)throw new Error('通常のVCを選んでください。');
    const bits=[P.ViewChannel,P.Connect,P.MoveMembers,P.SendMessages,P.EmbedLinks];
    if(action==='lobby')bits.push(P.ReadMessageHistory);
    if(!channel.permissionsFor(guild.members.me)?.has(bits))throw new Error('Botの閲覧・接続・移動・送信・埋め込み権限を確認してください。ロビーでは履歴を読む権限も必要です。');
    if(action==='add' && settings.get().voice && !channel.permissionsFor(guild.members.me)?.has(P.Speak))throw new Error('音声告知がONのため、Botの発言権限も必要です。');
  }
  async function save(s,confirmed=false) {
    const stage=s.stage;if(!stage)throw new Error('保存する変更がありません。');
    await validateChannel(stage.action,stage.value);
    await settings.update(c=>{
      if(!confirmed && pendingCount())throw new Error('入室予約が増えました。確認画面の「保存する」で確定してください。');
      if(JSON.stringify(c)!==stage.base)throw new Error('別の操作で設定が変わりました。画面を戻り、変更を選び直してください。');
      changeSettings(c,stage.action,stage.value);
    });
    s.stage=null;changed();
    let note='✓ 設定を保存しました。再起動は不要です。';
    try {await refreshPanel();}catch{note+='\nパネル更新に失敗しました。「パネル管理」から設置・更新してください。';}
    return note;
  }
  return {sessions,async handle(interaction){
    let s,locked=false;
    try {
      if(!canConfigure(interaction.memberPermissions))throw new Error('管理画面は管理者専用です。');
      if(interaction.isChatInputCommand()) {
        await interaction.deferReply({flags:MessageFlags.Ephemeral});s=sessions.create(interaction.user.id);await interaction.editReply(screen(s));return;
      }
      const [,id,action]=interaction.customId.split(':');s=sessions.get(id,interaction.user.id);
      if(s.busy)throw new Error('前の操作を処理中です。少し待ってからお試しください。');
      s.busy=true;locked=true;
      if(action==='open-densuke'){if(!openDensuke)throw new Error('日程調整を利用できません。');await openDensuke(interaction);return;}
      if(action==='open-trpg'){if(!openTrpg)throw new Error('卓管理を利用できません。');await openTrpg(interaction);return;}
      if(action.startsWith('form-')) {await interaction.showModal(adminModal(s,action.slice(5),settings.get()));return;}
      if(interaction.isModalSubmit() && !interaction.message)await interaction.deferReply({flags:MessageFlags.Ephemeral});else await interaction.deferUpdate();
      let note='';
      if(action==='home' || action.startsWith('nav-') || action.startsWith('pick-')) {s.stage=null;s.view=action==='home'?'home':action.startsWith('nav-')?action.slice(4):action;s.page=0;}
      else if(action.endsWith('-prev') || action.endsWith('-next'))s.page+=action.endsWith('-prev')?-1:1;
      else if(action==='install-panel'){await refreshPanel(true);note='✓ パネルを設置・更新しました。';}
      else if(action==='save')note=await save(s,true);
      else {
        const c=settings.get();let operation=action,value,description;
        if(['lobby','add','remove'].includes(action)) {value=interaction.values[0];description=`**${{lobby:'ロビー変更',add:'行き先追加',remove:'行き先削除'}[action]}**\n<#${value}>`;s.view='vc';}
        else if(action==='toggle-voice'){operation='voice';value=!c.voice;description=`音声告知 **${c.voice?'ON → OFF':'OFF → ON'}**`;}
        else if(action==='toggle-enforce'){operation='enforce';value=!c.enforce;description=`直接入室を **${value?'検出後ロビーへ戻す':'許可する'}** に変更`;}
        else if(action==='word-remove'){value={surface:interaction.values[0]};description=`読み方 **${text(value.surface)}** を削除`;}
        else if(action.startsWith('submit-')) {
          const kind=action.slice(7);operation=kind==='word'?'word-add':kind;
          value=kind==='word'?{surface:interaction.fields.getTextInputValue('surface'),reading:interaction.fields.getTextInputValue('reading')}:interaction.fields.getTextInputValue('value');
          description=kind==='word'?`**${text(value.surface)}** → ${text(value.reading)}`:`**${kind==='seconds'?'待機秒数':'音量'}** ${c[kind]} → ${text(value)}${kind==='seconds'?'秒':'%'}`;
        } else throw new Error('不明な操作です。 /管理 で開き直してください。');
        await validateChannel(operation,value);changeSettings(structuredClone(c),operation,value);
        s.stage={action:operation,value,base:JSON.stringify(c),description};
        if(pendingCount() || ['lobby','remove','word-remove'].includes(operation))s.stage.description+=`\n\n現在の入室予約：${pendingCount()}件`;else note=await save(s);
      }
      await interaction.editReply(screen(s,note));
    } catch(error) {
      const note=`変更できませんでした：${text(error.message)}`;
      if(interaction.deferred || interaction.replied)await interaction.editReply(s?screen(s,note):payload('✧  管理画面',note));
      else await interaction.reply({...payload('✧  管理画面',note),flags:MessageFlags.Ephemeral});
    } finally {if(locked)s.busy=false;}
  }};
}
