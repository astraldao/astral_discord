import {selectedAction} from './compact-controls.js';
import {randomUUID} from 'node:crypto';
import {AttachmentBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,ChannelSelectMenuBuilder,StringSelectMenuBuilder,ModalBuilder,TextInputBuilder,TextInputStyle,ChannelType,PermissionFlagsBits as P,MessageFlags} from 'discord.js';
import {canConfigure} from './commands.js';
import {themed,text,menuHomeButton,acknowledgePrivate} from './ui.js';
import {adminCategories,adminDestinations} from './admin-navigation.js';
import {adminGuideFor,adminGuideDescription} from './feature-guides.js';
export {adminCategories} from './admin-navigation.js';
import {securityScreen,securityReport,securityScopes,securityActions,securityFindings} from './security-ui.js';
import {diagnosticsScreen,diagnosticsHelpScreen,diagnosticActions,diagnosticTabs} from './diagnostics.js';
import {jevDiagnosticsScreen,safeJevProbe} from './jev-diagnostics.js';
import {safeDiceJudgeState} from './beatapi-dice.js';
import {validateSettings} from './settings.js';
const {payload}=themed('admin');

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
  } else if(action==='voice' || action==='enforce'||action==='chatDice')c[action]=value;
  else if(action==='word-add' || action==='word-remove' || action==='word-edit') {
    const surface=String(value.surface).normalize('NFKC').trim();
    if(!surface || surface.length>32 || !/^[\p{L}\p{N} ー]+$/u.test(surface))throw new Error('単語は32文字以内の文字・数字・空白で入力してください。');
    if(action==='word-remove' && !(c.words??[]).some(w=>w.surface.toLowerCase()===surface.toLowerCase()))throw new Error('その読み方は登録されていません。');
    if(action==='word-edit'){
      if(!(c.words??[]).some(w=>w.surface===value.previousSurface))throw new Error('読み方が変更されました。選び直してください。');
      if(c.words.some(w=>w.surface!==value.previousSurface && w.surface.toLowerCase()===surface.toLowerCase()))throw new Error('同じ単語が別の登録で使われています。別の単語にしてください。');
      c.words=c.words.filter(w=>w.surface!==value.previousSurface);
    }
    c.words=(c.words??[]).filter(w=>w.surface.toLowerCase()!==surface.toLowerCase());
    if(action==='word-add' || action==='word-edit') {
      const reading=String(value.reading).normalize('NFKC').trim().replace(/[ぁ-ゖ]/g,ch=>String.fromCharCode(ch.charCodeAt(0)+0x60));
      if(!/^[ァ-ヴー]+$/.test(reading) || reading.length>40)throw new Error('読みは40文字以内のひらがな・カタカナ・長音で入力してください。');
      c.words.push({surface,reading});
    }
  } else throw new Error('不明な設定操作です。');
  validateSettings(c);
}
export function settingChangeDescription(before,action,value){
  const after=structuredClone(before);changeSettings(after,action,value);
  const arrow=(label,a,b)=>`**${label}** ${a} → ${b}`;
  const on=value=>value?'ON':'OFF';
  if(action==='lobby')return arrow('ロビーVC',before.lobbyId?`<#${before.lobbyId}>`:'未設定',`<#${after.lobbyId}>`);
  if(['add','remove'].includes(action))return `${arrow('入室先VC',`${before.targetIds.length}件`,`${after.targetIds.length}件`)}\n対象 <#${value}>`;
  if(action==='seconds'||action==='volume')return arrow(action==='seconds'?'待機時間':'音量',`${before[action]}${action==='seconds'?'秒':'%'}`,`${after[action]}${action==='seconds'?'秒':'%'}`);
  if(action==='voice')return arrow('音声告知',on(before.voice),on(after.voice));
  if(action==='chatDice')return arrow('チャットダイス',on(before.chatDice!==false),on(after.chatDice!==false));
  if(action==='enforce')return arrow('直接入室',before.enforce?'ロビーへ戻す':'許可',after.enforce?'ロビーへ戻す':'許可');
  const surface=String(value.surface).normalize('NFKC').trim(),old=(before.words??[]).find(w=>action==='word-edit'?w.surface===value.previousSurface:w.surface.toLowerCase()===surface.toLowerCase()),next=(after.words??[]).find(w=>w.surface.toLowerCase()===surface.toLowerCase());
  return `${arrow('読み方',old?`${text(old.surface)}：${text(old.reading)}`:'未登録',next?`${text(next.surface)}：${text(next.reading)}`:'登録を解除')}\n次の入室告知から反映します。`;
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
    if(!s || s.userId!==userId || s.expires<=this.now())throw new Error('この画面は終了しています。元のパネルまたは /admin から開き直してください。');
    return s;
  }
  resume(userId,channelId,accept=()=>true){
    const owned=[...this.sessions.values()].filter(s=>s.userId===userId);
    if(owned.some(s=>s.busy))throw new Error('前の操作を処理中です。完了してから開き直してください。');
    return owned.find(s=>s.expires>this.now()&&(s.originChannelId??s.channelId)===channelId&&accept(s));
  }
}
const row=(...components)=>new ActionRowBuilder().addComponents(...components);
const button=(s,action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`admin:${s.id}:${action}`).setLabel(label).setStyle(style);
const summary=c=>`**ロビーVC** ${c.lobbyId?`<#${c.lobbyId}>`:'未設定'}\n**入室先** ${c.targetIds.length}件 · **待機** ${c.seconds}秒\n**音声告知** ${c.voice?'ON':'OFF'} · ${c.volume}%\n**直接入室** ${c.enforce?'ロビーへ戻す':'許可'}`;
export function adminScreen(s,c,channelName=id=>id,note='') {
  let title='✦  管理メニュー',description='',components=[];
  const back=()=>{
    const parent=s.view.startsWith('pick-')?['nav-vc','VC設定へ']:['vc','audio','panel'].includes(s.view)?['nav-category-voice','入室・音声へ']:['overview','diagnostics'].includes(s.view)?['nav-category-operations','運用・管理へ']:null;
    return row(...(parent?[button(s,...parent)]:[]),button(s,'home','管理メニューへ'),...(!parent?[menuHomeButton()]:[]));
  };
  const pagination=(prefix,page,pages)=>pages>1?[button(s,`${prefix}-prev`,'前のページ').setDisabled(page===0),button(s,`${prefix}-next`,'次のページ').setDisabled(page>=pages-1)]:[];
  if(s.stage) {
    const destructive=['remove','word-remove'].includes(s.stage.action);
    title='✦  変更内容を確認';description=`${s.stage.description}\n\n保存後に反映します。待機中の入室予約があれば取り消します。\n戻ると、この変更を破棄します。`;
    components=[row(button(s,'save',destructive?'削除を確定':'変更を保存',destructive?ButtonStyle.Danger:ButtonStyle.Primary),button(s,`nav-${s.view}`,'変更せず戻る'))];
  } else if(s.view==='home') {
    const missing=[...(!c.lobbyId?['ロビーVC']:[]),...(!c.targetIds.length?['入室先VC']:[])];
    description=missing.length?`**初期設定が必要です**\n${missing.join('・')}を「VC設定」から登録してください。`:'**よく使う操作**\n予定表・Botの更新は下のボタンから、再起動などは選択欄から開けます。';
    description+='\n\n設定名から直接開くか、カテゴリで絞り込めます。\n手順は「全機能の操作ガイド」で確認できます。';
    components=[
      row(button(s,missing.length?'nav-vc':'open-schedule',missing.length?'VC設定をはじめる':'予定表',ButtonStyle.Primary),button(s,'open-updates','バージョン管理')),
      row(new StringSelectMenuBuilder().setCustomId(`admin:${s.id}:destination`).setPlaceholder('設定名・目的から直接開く').addOptions(...adminDestinations.map(d=>({label:`${d.categoryLabel} / ${d.label}`,description:d.description,value:d.action})),{label:'全機能の操作ガイド',description:'準備・手順・反映のタイミングから探す',value:'nav-guides'})),
      row(new StringSelectMenuBuilder().setCustomId(`admin:${s.id}:category`).setPlaceholder('カテゴリから絞って探す').addOptions(...adminCategories.map(c=>({value:c.id,label:c.label,description:c.description})))),
      row(menuHomeButton()),
    ];
  } else if(s.view==='guides') {
    const selected=adminDestinations.find(d=>d.action===s.guideTopic),guide=adminGuideFor(s.guideTopic);
    title=selected?`操作ガイド / ${selected.label}`:'全機能の操作ガイド';description=adminGuideDescription(s.guideTopic);
    components=[row(new StringSelectMenuBuilder().setCustomId(`admin:${s.id}:guide-topic`).setPlaceholder('手順を確認する機能を選ぶ').addOptions(...adminDestinations.map(d=>({value:d.action,label:`${d.categoryLabel} / ${d.label}`,description:d.description,default:d.action===s.guideTopic})))),row(...(selected?[button(s,selected.action,`${selected.label}を開く`,ButtonStyle.Primary)]:[]),button(s,'home','管理メニューへ')),...(guide?[row(new ButtonBuilder().setLabel('詳しい手順を読む').setStyle(ButtonStyle.Link).setURL(`https://github.com/astraldao/astral_discord/blob/main/docs/${guide.doc}`))]:[])];
  } else if(s.view.startsWith('category-')) {
    const category=adminCategories.find(value=>s.view===`category-${value.id}`);if(!category)throw new Error('カテゴリを選び直してください。');
    title=`管理 / ${category.label}`;description=category.actions.map(([,label,help])=>`**${label}** · ${help}`).join('\n');
    components=[row(new StringSelectMenuBuilder().setCustomId(`admin:${s.id}:destination`).setPlaceholder(`${category.label}の操作を選ぶ`).addOptions(...category.actions.map(([value,label,description])=>({value,label,description})))),row(button(s,'nav-guides','操作ガイド'),button(s,'home','管理メニューへ'))];
  } else if(s.view==='vc') {
    title='✦  VC設定';description=summary(c)+'\n\nロビーは待機するVC、入室先はメンバーが選べるVCです。';
    components=[row(button(s,'pick-lobby','ロビーVCを設定',ButtonStyle.Primary),button(s,'pick-add','入室先を追加'),button(s,'pick-remove','入室先を削除').setDisabled(!c.targetIds.length)),row(button(s,'form-seconds','待機時間を変更'),button(s,'toggle-enforce',c.enforce?'直接入室を許可':'直接入室をロビーへ戻す')),back()];
  } else if(s.view==='audio') {
    title='✦  音声設定';description=`**音声** ずんだもん\n**参加告知** ${c.voice?'ON':'OFF'} · **音量** ${c.volume}%\n**読み方辞書** ${c.words.length}件\n入室告知の名前・英単語の読みを登録できます。\n\n**バックアップ読み上げ**\nVCに参加し、読みたいチャンネルで /menu → 読み上げ。\n参加告知とは別に開始・停止でき、音量は共通です。\n有効化の確認は「動作診断」、手順は下のリンクへ。`;
    components=[row(button(s,'toggle-voice',c.voice?'音声告知をOFF':'音声告知をON',ButtonStyle.Primary),button(s,'form-volume','音量を変更'),button(s,'nav-words','読み方辞書')),row(new ButtonBuilder().setLabel('読み上げの設定手順').setStyle(ButtonStyle.Link).setURL('https://github.com/astraldao/astral_discord/blob/main/docs/BACKUP_VOICE.md')),back()];
  } else if(s.view==='words') {
    title='✦  読み方辞書';
    const pages=Math.max(1,Math.ceil(c.words.length/10));s.page=Math.max(0,Math.min(s.page,pages-1));
    const words=c.words.slice(s.page*10,s.page*10+10);
    description=`${c.words.length}件 · ${s.page+1}/${pages}ページ\n\n`+(words.map(w=>`**${text(w.surface)}** → ${text(w.reading)}`).join('\n')||'読み方は未登録です。「読み方を登録」から追加できます。');
    if(words.length){
      components.push(row(new StringSelectMenuBuilder().setCustomId(`admin:${s.id}:word-edit`).setPlaceholder('修正する読み方を選ぶ').addOptions(words.map(w=>({label:w.surface,value:w.surface,description:w.reading})))));
      components.push(row(new StringSelectMenuBuilder().setCustomId(`admin:${s.id}:word-remove`).setPlaceholder('削除する読み方を選ぶ（次に確認）').addOptions(words.map(w=>({label:w.surface,value:w.surface,description:w.reading})))));
    }
    components.push(row(button(s,'form-new-word','読み方を登録',ButtonStyle.Primary),...pagination('words',s.page,pages)),row(button(s,'nav-audio','音声設定へ')));
  } else if(s.view==='panel') {
    title='✦  入室パネル';description=`**設置先** ${c.lobbyId?`<#${c.lobbyId}>`:'ロビーVCが未設定'}\n\nロビーVCのチャットに、入室先を選ぶパネルを設置します。\n設置済みのパネルは同じメッセージを更新します。\nロビー変更前のパネルは手動で削除してください。`;
    components=[row(button(s,'install-panel',c.panel?.channelId===c.lobbyId?'パネルを更新':'パネルを設置',ButtonStyle.Primary).setDisabled(!c.lobbyId)),back()];
  } else if(s.view==='overview') {
    title='✦  現在の設定';description=summary(c)+'\n\n**入室先VC**\n'+(c.targetIds.slice(0,25).map(id=>`<#${id}>`).join('\n')||'未登録')+(c.targetIds.length>25?`\nほか ${c.targetIds.length-25}件`:'')+`\n\n**読み方辞書** ${c.words.length}件\n設定の保存後は、再起動せずに反映されます。`;
    description+=`\n\n**チャットダイス** ${c.chatDice!==false?'ON':'OFF'}\n1D100などの依頼に返信します。説明・質問・引用は見送ります。通常投稿にはMessage Content Intentが必要です。`;components=[row(button(s,'toggle-dice',c.chatDice!==false?'ダイス返信をOFF':'ダイス返信をON')),back()];
  } else if(s.view.startsWith('pick-')) {
    const action=s.view.slice(5);
    title={lobby:'✦  ロビーVCを選択',add:'✦  入室先VCを追加',remove:'✦  入室先VCを削除'}[action];
    description={lobby:'メンバーが入室先を選ぶまで待機するVCを選んでください。',add:'メンバーの入室先一覧に追加するVCを選んでください。',remove:'一覧から削除するVCを選んでください。VC自体は削除しません。'}[action];
    if(action==='remove') {
      const pages=Math.max(1,Math.ceil(c.targetIds.length/25));s.page=Math.max(0,Math.min(s.page,pages-1));
      const ids=c.targetIds.slice(s.page*25,s.page*25+25);
      if(ids.length)components.push(row(new StringSelectMenuBuilder().setCustomId(`admin:${s.id}:remove`).setPlaceholder('一覧から削除するVC（次に確認）').addOptions(ids.map(id=>({label:channelName(id).slice(0,100),value:id})))));
      else description+='\n\n入室先VCは未登録です。';
      if(pages>1){description+=`\n\n${s.page+1}/${pages}ページ`;components.push(row(...pagination('targets',s.page,pages)));}
    } else components.push(row(new ChannelSelectMenuBuilder().setCustomId(`admin:${s.id}:${action}`).setPlaceholder(action==='lobby'?'ロビーにするVCを選ぶ':'追加する入室先VCを選ぶ').addChannelTypes(ChannelType.GuildVoice)));
    components.push(row(button(s,'nav-vc','VC設定へ')));
  }
  if(note)description=`${note}\n\n${description}`;
  return payload(title,description,{components});
}
export function adminModal(s,kind,c) {
  if(kind==='word'){const current=s.wordEditSurface?c.words.find(w=>w.surface===s.wordEditSurface):null;s.wordModal={token:randomUUID().slice(0,12),previousSurface:s.wordEditSurface,revision:current?JSON.stringify(current):undefined};}
  const modal=new ModalBuilder().setCustomId(`admin:${s.id}:submit-${kind}${kind==='word'?':'+s.wordModal.token:''}`).setTitle({seconds:'待機時間',volume:'音量',word:'読み方の登録・上書き'}[kind]);
  const input=(id,label,max,value)=>{const field=new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setMaxLength(max).setRequired(true);if(value)field.setValue(String(value).slice(0,max));return row(field);};
  const draft=s.formDraft?.kind===kind?s.formDraft.value:undefined;
  if(kind==='word')modal.addComponents(input('surface','表示名全体または英単語（32文字以内）',32,draft?.surface??''),input('reading','読み（ひらがな・カタカナ、40文字以内）',40,draft?.reading??''));
  else modal.addComponents(input('value',kind==='seconds'?'待機秒数（3〜15秒）':'音量（10〜60%）',2,draft??String(c[kind])));
  return modal;
}
export function createAdminController({settings,guild,refreshPanel,changed,pendingCount,openDensuke,openTrpg,openForum,openChips,openSchedule,openUpdates,openBanner,openRuntime,openRestart,openPerformance,openServers,diagnose,jevTest,securityScan,access=async i=>{const member=await guild.members.fetch({user:i.user.id,force:true});if(!canConfigure(member.permissions))return false;const channel=await guild.channels.fetch(i.channelId,{force:true});return channel?.permissionsFor(member)?.has(P.ViewChannel)===true;}}) {
  const sessions=new AdminSessions();
  const screen=(s,note='')=>({...(s.view==='jev-test'?jevDiagnosticsScreen(s):s.view==='diagnostics-help'?diagnosticsHelpScreen(s):s.view==='security'?securityScreen(s):s.view==='diagnostics'?diagnosticsScreen(s):adminScreen(s,settings.get(),id=>guild.channels.cache.get(id)?.name??`削除済みのVC (${id})`,note)),attachments:[]});
  async function validateChannel(action,value) {
    if(!['lobby','add'].includes(action))return;
    const channel=await guild.channels.fetch(value);
    if(channel?.type!==ChannelType.GuildVoice)throw new Error('通常のVCを選んでください。');
    const bits=[P.ViewChannel,P.Connect,P.MoveMembers,P.SendMessages,P.EmbedLinks];
    if(action==='lobby')bits.push(P.ReadMessageHistory);
    if(!channel.permissionsFor(guild.members.me)?.has(bits))throw new Error('Botの閲覧・接続・移動・送信・埋め込み権限を確認してください。ロビーでは履歴を読む権限も必要です。');
    if(action==='add' && settings.get().voice && !channel.permissionsFor(guild.members.me)?.has(P.Speak))throw new Error('音声告知がONのため、Botの発言権限も必要です。');
  }
  async function save(s,interaction,confirmed=false) {
    const stage=s.stage;if(!stage)throw new Error('保存する変更がありません。');
    await validateChannel(stage.action,stage.value);
    await settings.update(c=>{
      if(!confirmed && pendingCount())throw new Error('入室予約が増えました。確認画面で保存を確定してください。');
      if(JSON.stringify(c)!==stage.base)throw new Error('別の操作で設定が変わりました。画面を戻り、変更を選び直してください。');
      changeSettings(c,stage.action,stage.value);
    },async()=>{
      if(!await access(interaction))throw new Error('管理者権限がありません。');
      if(sessions.get(s.id,interaction.user.id)!==s || (s.originChannelId && s.originChannelId!==interaction.channelId) || s.stage!==stage)throw new Error('元の有効な確認画面から操作してください。');
    });
    s.stage=null;delete s.formDraft;delete s.wordEditSurface;delete s.wordModal;changed();
    let note=`✓ 設定を保存しました。再起動は不要です。${stage.changeDescription?`\n${stage.changeDescription}`:''}`;
    try {await refreshPanel();}catch{note+='\nパネル更新に失敗しました。「入室パネル」から更新してください。';}
    return note;
  }
  return {sessions,async handle(interaction){
    let s,locked=false;
    try {
      const initialAction=interaction.customId?.split(':')[2];
      if(!initialAction?.startsWith('form-')&&initialAction!=='word-edit')await acknowledgePrivate(interaction);
      if(!await access(interaction))throw new Error('管理画面は管理者専用です。');
      let action,token,securitySelected=false;
      const entry=interaction.customId?.match(/^admin:open-(section|feature):([^:]+)$/);
      if(interaction.isChatInputCommand() || interaction.customId==='admin:open' || entry) {
        if(!interaction.deferred&&!interaction.replied){if(interaction.message?.flags?.has(MessageFlags.Ephemeral))await interaction.deferUpdate();else await interaction.deferReply({flags:MessageFlags.Ephemeral});}
        if([...sessions.sessions.values()].some(value=>value.userId===interaction.user.id&&value.busy))throw new Error('前の操作を処理中です。完了してから開き直してください。');
        s=sessions.create(interaction.user.id);s.originChannelId=interaction.channelId;
        if(entry?.[1]==='section'){if(!adminCategories.some(c=>c.id===entry[2]))throw new Error('カテゴリを選び直してください。');s.view=`category-${entry[2]}`;}
        action=entry?.[1]==='feature'?entry[2]:interaction.isChatInputCommand()?interaction.options?.getString('操作'):null;
        if(!action){await interaction.editReply(screen(s));return;}
        if(!adminDestinations.some(destination=>destination.action===action))throw new Error('操作を選び直してください。');
      }else{
        const parts=interaction.customId.split(':');action=parts[2];token=parts[3];s=sessions.get(parts[1],interaction.user.id);if(s.originChannelId && s.originChannelId!==interaction.channelId)throw new Error('元のチャンネルから操作してください。');
      }
      if(action==='security-action'){if(s.view!=='security'||!Number.isSafeInteger(s.securityUiRevision)||token!==String(s.securityUiRevision))throw new Error('最新の診断画面から選び直してください。');action=selectedAction(interaction.values,securityActions(s));securitySelected=!!action;if(!action)throw new Error('この診断画面の選択欄から選び直してください。');}
      if(action==='diagnostics-action'){action=selectedAction(interaction.values,diagnosticActions(s));if(!action)throw new Error('この画面の操作一覧から選び直してください。');}
      if(action==='destination'){const category=adminCategories.find(c=>s.view===`category-${c.id}`),choices=category?category.actions.map(([action])=>action):s.view==='home'?[...adminDestinations.map(d=>d.action),'nav-guides']:[];if(interaction.values?.length!==1||!choices.includes(interaction.values[0]))throw new Error('一覧から管理操作を選び直してください。');action=interaction.values[0];}
      if(s.busy)throw new Error('前の操作を処理中です。少し待ってからお試しください。');
      s.busy=true;locked=true;
      if(action==='measure-voice'){if(!['diagnostics','diagnostics-help'].includes(s.view)||!openPerformance)throw new Error('動作診断から処理速度の測定を開いてください。');await openPerformance(interaction);return;}
      if(action==='open-servers'){if(!openServers)throw new Error('サーバー連携を利用できません。');await openServers(interaction);return;}
      if(action==='open-restart'){if(!openRestart)throw new Error('再起動を利用できません。');await openRestart(interaction);return;}
      if(action==='open-runtime'){if(!openRuntime)throw new Error('起動設定を利用できません。');await openRuntime(interaction);return;}
      if(action==='open-banner'){if(!openBanner)throw new Error('バナー設定を利用できません。');await openBanner(interaction);return;}
      if(action==='open-updates'){if(!openUpdates)throw new Error('バージョン管理を利用できません。');await openUpdates(interaction);return;}
      if(action==='open-schedule'){if(!openSchedule)throw new Error('予定表を利用できません。');await openSchedule(interaction);return;}
      if(action==='open-chips'){if(!openChips)throw new Error('チップ管理を利用できません。');await openChips(interaction);return;}
      if(action==='open-densuke'){if(!openDensuke)throw new Error('日程調整を利用できません。');await openDensuke(interaction);return;}
      if(action==='open-forum'){if(!openForum)throw new Error('投稿タグを利用できません。');await openForum(interaction);return;}
      if(action==='open-trpg'){if(!openTrpg)throw new Error('卓管理を利用できません。');await openTrpg(interaction);return;}
      if(action==='word-edit'){
        const word=settings.get().words.find(w=>w.surface===interaction.values?.[0]);if(!word)throw new Error('読み方を選び直してください。');
        s.formDraft={kind:'word',value:{...word}};s.wordEditSurface=word.surface;s.view='words';await interaction.showModal(adminModal(s,'word',settings.get()));return;
      }
      if(action==='form-new-word'){delete s.formDraft;delete s.wordEditSurface;await interaction.showModal(adminModal(s,'word',settings.get()));return;}
      if(action.startsWith('form-')) {await interaction.showModal(adminModal(s,action.slice(5),settings.get()));return;}
      if(!interaction.deferred&&!interaction.replied){if(interaction.isModalSubmit() && !interaction.message)await interaction.deferReply({flags:MessageFlags.Ephemeral});else await interaction.deferUpdate();}
      if(!await access(interaction))throw new Error('管理者権限がありません。');sessions.get(s.id,s.userId);
      let note='',securityDownload;
      if(action==='guide-topic'){
        if(s.view!=='guides'||interaction.values?.length!==1||!adminGuideFor(interaction.values[0]))throw new Error('操作ガイドの一覧から選び直してください。');s.guideTopic=interaction.values[0];
      }else if(action==='category'){
        if(interaction.values?.length!==1||!adminCategories.some(c=>c.id===interaction.values[0]))throw new Error('カテゴリを選び直してください。');
        s.stage=null;delete s.formDraft;delete s.wordEditSurface;delete s.wordModal;s.view=`category-${interaction.values[0]}`;s.page=0;
      }else if(action==='home' || action.startsWith('nav-') || action.startsWith('pick-')) {s.stage=null;delete s.formDraft;delete s.wordEditSurface;delete s.wordModal;s.view=action==='home'?'home':action.startsWith('nav-')?action.slice(4):action;s.page=0;}
      else if(action==='open-security'){s.stage=null;s.view='security';s.page=0;s.security=securityScan?.snapshot()??null;s.securityView='summary';s.securityDetail=null;}
      else if(action==='security-run'){
        if(s.view!=='security'||!securityScan)throw new Error('脆弱性診断を開き直してください。');sessions.get(s.id,s.userId);
        const result=await securityScan.run();if(!await access(interaction))throw new Error('管理者権限がありません。');sessions.get(s.id,s.userId);s.security=result;s.page=0;s.securityView='summary';s.securityDetail=null;
      }
      else if(action==='security-summary'||action==='security-help'||action.startsWith('security-filter-')||action.startsWith('security-finding-')){
        if(s.view!=='security'||!securitySelected)throw new Error('脆弱性診断から選び直してください。');
        if(action.startsWith('security-filter-')){const scope=action.slice('security-filter-'.length);if(s.security?.status!=='complete'||!Object.hasOwn(securityScopes,scope))throw new Error('診断結果から対象を選び直してください。');s.securityScope=scope;s.page=0;s.securityDetail=null;s.securityView='summary';}
        else if(action.startsWith('security-finding-')){const index=action.slice('security-finding-'.length),findings=securityFindings(s);if(s.security?.status!=='complete'||!/^(0|[1-9]\d*)$/u.test(index)||Number(index)<s.page*3||Number(index)>=s.page*3+3||!findings[Number(index)])throw new Error('一覧に表示された勧告を選んでください。');s.securityDetail=findings[Number(index)].id;s.securityDetailPage=0;s.securityView='detail';}
        else{s.securityView=action==='security-help'?'help':'summary';s.securityDetail=null;}
      }
      else if(action==='security-scope'){if(s.view!=='security'||s.security?.status!=='complete'||interaction.values?.length!==1||!Object.hasOwn(securityScopes,interaction.values[0]))throw new Error('診断結果から対象を選び直してください。');s.securityScope=interaction.values[0];s.page=0;s.securityDetail=null;s.securityView='summary';}
      else if(action==='security-export'){if(s.view!=='security')throw new Error('脆弱性診断から保存してください。');securityDownload=securityReport(s.security);}
      else if(action==='security-prev'||action==='security-next'){
        if(s.view!=='security'||s.security?.status!=='complete'||s.securityView==='help')throw new Error('脆弱性診断を開き直してください。');
        const key=s.securityDetail?'securityDetailPage':'page';s[key]=(s[key]??0)+(action==='security-prev'?-1:1);
      }
      else if(action==='open-jev'){
        if(s.view!=='diagnostics'||!s.diagnostics||!jevTest)throw new Error('動作診断からJevの接続試験を開いてください。');
        s.jevConfig=safeDiceJudgeState(jevTest.snapshot());s.jevToken=randomUUID().slice(0,12);s.jevResult=null;s.view='jev-test';
      }
      else if(action==='jev-run'){
        if(s.view!=='jev-test'||!token||s.jevToken!==token||!jevTest)throw new Error('最新のJev接続試験から操作してください。');
        const runToken=randomUUID().slice(0,12);s.jevToken=runToken;
        const beforeRequest=async()=>{try{const authorized=await access(interaction);return authorized&&sessions.get(s.id,s.userId)===s&&s.view==='jev-test'&&s.jevToken===runToken&&(!s.originChannelId||s.originChannelId===interaction.channelId);}catch{return false;}};
        const result=await jevTest.probe({beforeRequest});
        if(!await beforeRequest())throw new Error('画面の期限または管理者権限が変わりました。/admin から開き直してください。');
        s.jevResult=safeJevProbe(result);s.jevConfig=safeDiceJudgeState(jevTest.snapshot());if(s.diagnostics?.dice)s.diagnostics.dice.judge=s.jevConfig;
      }
      else if(action.startsWith('diagnostics-tab-')){
        const tab=action.slice('diagnostics-tab-'.length);if(s.view!=='diagnostics'||!s.diagnostics||!Object.hasOwn(diagnosticTabs,tab))throw new Error('動作診断の選択欄から表示を選んでください。');s.diagnosticTab=tab;s.page=0;
      }
      else if(action==='diagnostics-prev'||action==='diagnostics-next'){
        if(s.view!=='diagnostics'||s.diagnosticTab!=='channels'||!s.diagnostics)throw new Error('VC・権限の一覧から操作してください。');s.page+=action==='diagnostics-prev'?-1:1;
      }
      else if(action==='diagnostics-help'){if(s.view!=='diagnostics'||!s.diagnostics)throw new Error('動作診断から対処の手順を開いてください。');s.view='diagnostics-help';}
      else if(action==='diagnose'){if(!diagnose)throw new Error('診断を利用できません。');const result=await diagnose();sessions.get(s.id,s.userId);if(!await access(interaction))throw new Error('管理者権限がありません。');s.diagnostics=result;s.view='diagnostics';s.page=0;}
      else if(action.endsWith('-prev') || action.endsWith('-next'))s.page+=action.endsWith('-prev')?-1:1;
      else if(action==='install-panel'){await refreshPanel(true);note='✓ パネルを設置・更新しました。';}
      else if(action==='save')note=await save(s,interaction,true);
      else {
        const c=settings.get();let operation=action,value,description;
        if(['lobby','add','remove'].includes(action)) {value=interaction.values[0];description=`**${{lobby:'ロビー変更',add:'行き先追加',remove:'行き先削除'}[action]}**\n<#${value}>`;s.view='vc';}
        else if(action==='toggle-dice'){operation='chatDice';value=c.chatDice===false;description=`チャットダイス **${value?'ON':'OFF'}** に変更`;}
        else if(action==='toggle-voice'){operation='voice';value=!c.voice;description=`音声告知 **${c.voice?'ON → OFF':'OFF → ON'}**`;}
        else if(action==='toggle-enforce'){operation='enforce';value=!c.enforce;description=`直接入室を **${value?'検出後ロビーへ戻す':'許可する'}** に変更`;}
        else if(action==='word-remove'){value={surface:interaction.values[0]};description=`読み方 **${text(value.surface)}** を削除`;}
        else if(action.startsWith('submit-')) {
          const kind=action.slice(7);if(kind==='word' && s.wordModal){if(token!==s.wordModal.token)throw new Error('最新の読み方フォームから操作してください。');if(s.wordModal.previousSurface && JSON.stringify(c.words.find(w=>w.surface===s.wordModal.previousSurface))!==s.wordModal.revision)throw new Error('読み方が変更されました。選び直して編集してください。');}operation=kind==='word'?'word-add':kind;
          value=kind==='word'?{surface:interaction.fields.getTextInputValue('surface'),reading:interaction.fields.getTextInputValue('reading')}:interaction.fields.getTextInputValue('value');
          if(kind==='word' && s.wordEditSurface){operation='word-edit';value.previousSurface=s.wordEditSurface;}
          s.formDraft={kind,value};
          description=kind==='word'?`**${text(value.surface)}** → ${text(value.reading)}`:`**${kind==='seconds'?'待機秒数':'音量'}** ${c[kind]} → ${text(value)}${kind==='seconds'?'秒':'%'}`;
        } else throw new Error('不明な操作です。 /admin で開き直してください。');
        await validateChannel(operation,value);changeSettings(structuredClone(c),operation,value);
        description=settingChangeDescription(c,operation,value);s.stage={action:operation,value,base:JSON.stringify(c),description,changeDescription:description};
        if(pendingCount() || ['lobby','remove','word-remove'].includes(operation))s.stage.description+=`\n\n現在の入室予約：${pendingCount()}件`;else note=await save(s,interaction);
      }
      if(s.view==='security')sessions.get(s.id,s.userId);
      if(securityDownload){if(!await access(interaction))throw new Error('管理者権限がありません。');sessions.get(s.id,s.userId);}
      const message=screen(s,note);if(securityDownload)message.files=[new AttachmentBuilder(securityDownload,{name:'astral-security-report.json'})];await interaction.editReply(message);
    } catch(error) {
      const note=`操作できませんでした：${text(error.message)}`;
      const recovery=s?[row(button(s,'home','管理メニューへ'),...(s.formDraft?[button(s,`form-${s.formDraft.kind}`,'入力を修正')]:s.view==='diagnostics'?[button(s,'diagnose','診断をやり直す')]:[]))]:[];
      if(interaction.deferred || interaction.replied)await interaction.editReply({...payload('✧  管理画面',note,{state:'error',components:recovery}),attachments:[]});
      else await interaction.reply({...payload('✧  管理画面',note),flags:MessageFlags.Ephemeral,attachments:[]});
    } finally {if(locked)s.busy=false;}
  }};
}
