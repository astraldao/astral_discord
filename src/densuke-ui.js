import {ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,ModalBuilder,TextInputBuilder,TextInputStyle,MessageFlags,escapeMarkdown} from 'discord.js';
import {AdminSessions} from './admin.js';
import {canConfigure} from './commands.js';
import {payload,adminHomeButton,adminSectionButton,adminFeatureButton,acknowledgePrivate} from './ui.js';
import {randomUUID} from 'node:crypto';
import {PermissionFlagsBits as P} from 'discord.js';
import {answerUrl} from './trpg-store.js';
import {choices,eventData,UncertainCreation,createDensukeClient} from './densuke.js';
import {validDensukeEmail} from './settings.js';
const row=(...items)=>new ActionRowBuilder().addComponents(...items);
const button=(s,action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`densuke:${s.id}:${action}`).setLabel(label).setStyle(style);
const safe=(value,max)=>{const escaped=escapeMarkdown(String(value)).replace(/@/g,'＠');return escaped.length>max?escaped.slice(0,max-1)+'…':escaped;};
export function densukeScreen(s,note='') {
  const e=s.inputDraft??s.event;let title='✦  日程調整',description,components=[];
  if(s.phase==='done') {
    title=s.result.recovered?'✦  作成済みの日程調整を登録しました':'✦  日程調整を作成しました';
    description=`**${safe(e.name,250)}**\n\n**回答用URL**\n${s.result.answer}${s.result.edit?`\n\n**編集用URL · 非公開**\n${s.result.edit}`:''}\n\n共有先：<#${s.channelId}>\n共有ボタンで、回答用URLだけをこのチャンネルに投稿します。編集用URLとパスワードは投稿しません。`;
    components=[row(new ButtonBuilder().setLabel('回答ページを開く').setStyle(ButtonStyle.Link).setURL(s.result.answer),...(s.result.edit?[new ButtonBuilder().setLabel('編集ページを開く').setStyle(ButtonStyle.Link).setURL(s.result.edit)]:[])),row(button(s,'share',s.shared?'回答URLは共有済み':'回答URLを共有',ButtonStyle.Primary).setDisabled(!!s.shared)),row(button(s,'restart','別のイベントを作る'))];
  } else if(s.phase==='uncertain'){
    title='✦  作成結果の確認が必要です';
    description='伝助で作成されている可能性があります。控えメールを確認してください。\n\n**作成済みの場合**\nメールの回答用URLを登録すると、回答用URLを共有できます。\n\n重複を防ぐため、この画面から再作成はしません。';
    components=[row(button(s,'form-recover','メールのURLを登録',ButtonStyle.Primary))];
  } else if(s.phase==='closed'){
    title='✦  作成をキャンセルしました';description='伝助には作成リクエストを送信していません。';components=[row(button(s,'restart','新しいイベントを入力',ButtonStyle.Primary))];
  } else {
    title=s.phase==='review'?'✦  内容を確認して作成':'✦  日程調整を準備';
    description=e.name?`**イベント名**\n${safe(e.name,250)}\n\n**候補日程**\n${safe(e.schedule,1200)}\n\n**イベント説明**\n${e.description?safe(e.description,800):'なし'}\n\n**パスワード** ${e.password?'設定あり（非表示）':'なし'}\n**回答の選択肢** ${choices[e.choice]}\n\n${s.inputDraft?'入力に修正が必要です。「内容を修正」で直してください。':'内容がよければ「この内容で作成」を押してください。'}控えメールは設定済みの固定宛先に送信します。`:'**1**  回答の選択肢を選ぶ\n**2**  イベント名と候補日程を入力する\n**3**  内容を確認して伝助を作成する\n\nイベント説明・パスワードは任意です。候補日程は1行に1候補を入力してください。';
    if(escapeMarkdown(e.schedule).length>1200 || escapeMarkdown(e.description).length>800)description+='\n\n表示は一部省略しています。「内容を修正」で全文を確認できます。伝助には全文を送ります。';
    components=[row(new StringSelectMenuBuilder().setCustomId(`densuke:${s.id}:choice`).setPlaceholder('回答の選択肢を選ぶ').addOptions(Object.entries(choices).map(([value,label])=>({value,label,default:e.choice===value})))),row(button(s,'form',e.name?'内容を修正':'イベント内容を入力',s.phase==='review'?ButtonStyle.Secondary:ButtonStyle.Primary),...(s.phase==='review'?[button(s,'create','この内容で作成',ButtonStyle.Primary)]:[]),button(s,'cancel','作成をキャンセル')),row(button(s,'form-email','控えメールの宛先'),button(s,'form-recover','作成済みURLを登録'))];
  }
  if(s.phase!=='creating'&&components.length<5)components.push(row(adminSectionButton('schedule'),adminHomeButton()));
  return {...payload(title,note?`${note}\n\n${description}`:description,{state:s.phase==='done'?'success':s.phase==='uncertain'?'error':'normal',components}),attachments:[]};
}
export function densukeModal(s) {
  const modal=new ModalBuilder().setCustomId(`densuke:${s.id}:submit`).setTitle('伝助のイベント内容');
  const draft=s.inputDraft??s.event;
  for(const [key,label,max,required,paragraph] of [['name','イベント名（必須）',250,true,false],['schedule','候補日程（必須・1行に1候補）',4000,true,true],['description','イベント説明（任意）',2000,false,true],['password','パスワード（任意・半角英数字8文字以内）',8,false,false]]) {
    const input=new TextInputBuilder().setCustomId(key).setLabel(label).setMaxLength(max).setRequired(required).setStyle(paragraph?TextInputStyle.Paragraph:TextInputStyle.Short);
    input.setPlaceholder({name:'例：週末のセッション',schedule:'例：10/17 20:00〜\n10/18 20:00〜',description:'集合時間・参加条件など',password:'半角英数字のみ・8文字以内'}[key]);
    if(draft[key])input.setValue(draft[key].slice(0,max));modal.addComponents(row(input));
  }
  return modal;
}
export function densukeEmailModal(s,email) {
  const input=new TextInputBuilder().setCustomId('email').setLabel('控えメールの固定宛先').setStyle(TextInputStyle.Short).setMaxLength(254).setRequired(true);
  if(email)input.setValue(email);
  return new ModalBuilder().setCustomId(`densuke:${s.id}:submit-email`).setTitle('控えメールの宛先を保存').addComponents(row(input));
}
export function createDensukeController({email,settings,client=createDensukeClient(),now=()=>Date.now(),guild}) {
  const sessions=new AdminSessions(now),attempts=new Map();let nextGlobal=0;
  const currentEmail=()=>settings?.get().densukeEmail??email;
  async function authorize(i){const member=guild?await guild.members.fetch({user:i.user.id,force:true}):null;if(!canConfigure(member?.permissions??i.memberPermissions))throw new Error('日程調整の操作は管理者専用です。');if(guild){const channel=await guild.channels.fetch(i.channelId,{force:true});if(!channel?.permissionsFor(member)?.has(P.ViewChannel))throw new Error('このチャンネルの閲覧権限がありません。');}}
  async function authorizeSession(i,s){
    await authorize(i);
    if(sessions.get(s.id,i.user.id)!==s || i.channelId!==s.channelId)throw new Error('元の有効な画面から操作してください。');
  }
  return {sessions,async open(i){
    await acknowledgePrivate(i);await authorize(i);
    const previous=sessions.resume(i.user.id,i.channelId);if(previous){await i.editReply(densukeScreen(previous,'前の操作を再開しました。'));return;}
    const s=sessions.create(i.user.id);s.phase='draft';s.event={name:'',schedule:'',description:'',password:'',choice:'1'};s.channelId=i.channelId;s.reviewEmail=currentEmail();
    await i.editReply(densukeScreen(s,currentEmail()?'':'「控えメールの宛先」で宛先を設定してください。'));
  },async handle(i){
    let s,locked=false;
    try {
      await authorize(i);const [,id,action,token]=i.customId.split(':');s=sessions.get(id,i.user.id);if(i.channelId!==s.channelId)throw new Error('元のチャンネルから操作してください。');
      if(s.busy)throw new Error('処理中です。少しお待ちください。');s.busy=true;locked=true;
      if(action==='form-recover' && ['draft','review','uncertain'].includes(s.phase)){
        s.recoverToken=randomUUID().slice(0,12);s.recoverPhase=s.phase;const modal=new ModalBuilder().setCustomId(`densuke:${s.id}:submit-recover:${s.recoverToken}`).setTitle('作成済みの伝助を復旧');
        const field=new TextInputBuilder().setCustomId('answer').setLabel('メールのイベントページURL（回答用）').setStyle(TextInputStyle.Short).setMaxLength(1000).setRequired(true).setPlaceholder('https://densuke.biz/list?cd=…');if(s.recoverDraft)field.setValue(s.recoverDraft);modal.addComponents(row(field));
        await i.showModal(modal);return;
      }
      if(action==='form-email' && ['draft','review'].includes(s.phase)){s.emailEditBase=currentEmail();await i.showModal(densukeEmailModal(s,s.emailEditBase));return;}
      if(action==='form' && ['draft','review'].includes(s.phase)){await i.showModal(densukeModal(s));return;}
      if(i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});
      await authorizeSession(i,s);let note='';
      if(action==='submit-recover' && ['draft','review','uncertain'].includes(s.phase)){
        if(!s.recoverToken || token!==s.recoverToken || s.phase!==s.recoverPhase)throw new Error('最新のURL登録フォームから操作してください。');s.recoverDraft=i.fields.getTextInputValue('answer').trim().slice(0,1000);const answer=answerUrl(s.recoverDraft);if(!answer)throw new Error('回答用URLを入力してください。');s.result={answer,recovered:true};delete s.recoverDraft;delete s.recoverToken;delete s.recoverPhase;s.phase='done';s.event.name||='作成済みイベント';s.event.password='';delete s.inputDraft;note='✓ 作成済みイベントのURLを登録しました。再作成はしていません。';
      } else if(action==='share' && s.phase==='done') {
        if(s.shared)throw new Error('このイベントは共有済みです。');
        if(i.channelId!==s.channelId)throw new Error('作成したチャンネルから共有してください。');
        // Mark before sending: a timeout must not invite duplicate automatic posts.
        s.shared=true;
        try {await i.channel.send(payload('✦  日程調整',`**${safe(s.event.name,250)}**\n候補日程への回答をお願いします。`,{components:[row(new ButtonBuilder().setLabel('伝助で回答する').setStyle(ButtonStyle.Link).setURL(s.result.answer))]}));note='✓ 回答用URLを共有しました。';}
        catch{note='共有結果を確認できませんでした。チャンネルを確認し、必要なら回答用URLを手動で共有してください。';}
      } else if(action==='restart' && ['done','closed'].includes(s.phase)){s.phase='draft';s.event={name:'',schedule:'',description:'',password:'',choice:'1'};delete s.result;delete s.shared;delete s.inputDraft;delete s.recoverToken;delete s.recoverDraft;delete s.recoverPhase;s.reviewEmail=currentEmail();}
      else if(!['draft','review'].includes(s.phase))throw new Error('この作成操作は終了しています。');
      else if(action==='cancel'){s.phase='closed';s.event.password='';delete s.inputDraft;}
      else if(action==='choice'){if(!Object.hasOwn(choices,i.values[0]))throw new Error('回答の選択肢が不正です。');s.event.choice=i.values[0];if(s.inputDraft)s.inputDraft.choice=i.values[0];}
      else if(action==='submit-email') {
        const value=i.fields.getTextInputValue('email').trim();
        if(!validDensukeEmail(value))throw new Error('254文字以内の半角メールアドレスを入力してください。');
        if(!settings)throw new Error('メール設定を保存できません。');
        if(!Object.hasOwn(s,'emailEditBase'))throw new Error('「控えメールの宛先」を開き直してください。');
        await settings.update(c=>{
          if((c.densukeEmail??email)!==s.emailEditBase)throw new Error('別の操作で固定メールが変更されました。設定画面を開き直してください。');
          c.densukeEmail=value;
        },async()=>{
          await authorizeSession(i,s);
          if(!['draft','review'].includes(s.phase))throw new Error('メール設定画面を開き直してください。');
        });
        delete s.emailEditBase;
        if(s.phase==='review')s.reviewEmail=value;
        note='✓ 固定メールを保存しました。再起動後も引き継ぎます。';
      }
      else if(action==='submit') {
        const fields={choice:s.event.choice};for(const key of ['name','schedule','description','password'])fields[key]=i.fields.getTextInputValue(key);
        s.inputDraft={choice:fields.choice};for(const [key,max] of Object.entries({name:250,schedule:4000,description:2000,password:8}))s.inputDraft[key]=String(fields[key]).slice(0,max);s.phase='draft';
        s.event=eventData(fields);delete s.inputDraft;s.phase='review';s.reviewEmail=currentEmail();
      } else if(action==='create') {
        if(s.phase!=='review')throw new Error('先に内容を入力してください。');
        const destination=currentEmail();
        if(!validDensukeEmail(destination))throw new Error('「控えメールの宛先」で宛先を設定してください。');
        if(s.reviewEmail!==destination)throw new Error('別の操作で固定メールが変更されました。「内容を修正」から再確認してください。');
        for(const [id,until] of attempts)if(until<=now())attempts.delete(id);
        const wait=Math.ceil((Math.max(nextGlobal,attempts.get(i.user.id)??0)-now())/1000);
        if(wait>0)throw new Error(`作成は${wait}秒後にお試しください。`);
        attempts.set(i.user.id,now()+300000);nextGlobal=now()+60000;
        s.phase='creating';await i.editReply(payload('✧  伝助を作成中','処理を確認しています。続けて作成を押さずにお待ちください。'));
        try{s.result=await client.create(s.event,destination,{beforeCreate:async()=>{
          await authorizeSession(i,s);
          if(s.phase!=='creating')throw new Error('この作成操作は終了しています。');
          if(currentEmail()!==destination || s.reviewEmail!==destination)throw new Error('別の操作で固定メールが変更されました。「内容を修正」から再確認してください。');
        }});s.phase='done';s.event.password='';note='✓ 作成しました。URLはこの画面だけに表示しています。';}
        catch(error){s.phase=error instanceof UncertainCreation?'uncertain':'review';throw error;}
      } else throw new Error('不明な操作です。');
      await authorizeSession(i,s);await i.editReply(densukeScreen(s,note));
    } catch(error) {
      // A previous successful check cannot authorize a private error preview after I/O.
      let privatePreview=false;
      if(s){try{await authorizeSession(i,s);privatePreview=true;}catch(accessError){error=accessError;}}
      const message=privatePreview?densukeScreen(s,error instanceof UncertainCreation?'':`操作できませんでした：${safe(error.message,250)}`):{...payload('✧  日程調整',safe(error.message,250),{components:[row(adminFeatureButton('open-densuke'),adminSectionButton('schedule'),adminHomeButton())]}),attachments:[]};
      if(i.deferred || i.replied)await i.editReply(message);else await i.reply({...message,flags:MessageFlags.Ephemeral});
    } finally {if(locked)s.busy=false;}
  }};
}
