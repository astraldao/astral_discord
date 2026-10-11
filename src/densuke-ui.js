import {ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,ModalBuilder,TextInputBuilder,TextInputStyle,MessageFlags,escapeMarkdown} from 'discord.js';
import {AdminSessions} from './admin.js';
import {canConfigure} from './commands.js';
import {payload} from './ui.js';
import {choices,eventData,UncertainCreation,createDensukeClient} from './densuke.js';
import {validDensukeEmail} from './settings.js';
const row=(...items)=>new ActionRowBuilder().addComponents(...items);
const button=(s,action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`densuke:${s.id}:${action}`).setLabel(label).setStyle(style);
const safe=(value,max)=>{const escaped=escapeMarkdown(String(value)).replace(/@/g,'＠');return escaped.length>max?escaped.slice(0,max-1)+'…':escaped;};
export function densukeScreen(s,note='') {
  const e=s.event;let description,components=[];
  if(s.phase==='done') {
    description=`**${safe(e.name,250)}** を作成しました。\n\n回答用：${s.result.answer}\n編集用：${s.result.edit}\n\n編集用URLは公開しないでください。パスワードは共有文に含めません。`;
    components=[row(new ButtonBuilder().setLabel('回答ページ').setStyle(ButtonStyle.Link).setURL(s.result.answer),button(s,'share',s.shared?'共有済み':'このチャンネルに共有',ButtonStyle.Primary).setDisabled(!!s.shared))];
  } else if(s.phase==='uncertain')description='作成結果を確認できませんでした。控えメールを確認してください。重複を避けるため、この画面からは再作成しません。';
  else if(s.phase==='closed')description='作成を取り消しました。伝助への作成送信は行っていません。';
  else {
    description=e.name?`**イベント名**\n${safe(e.name,250)}\n\n**候補日程**\n${safe(e.schedule,1200)}\n\n**説明**\n${e.description?safe(e.description,800):'なし'}\n\n**パスワード** ${e.password?'設定あり（非表示）':'なし'}\n**回答** ${choices[e.choice]}\n\nメールは管理者の固定アドレスに送ります。作成前に内容を確認してください。`:'イベント名・候補日程は必須です。説明とパスワードは任意です。候補日程は1行に1候補を入力してください。\n\n回答の選択肢を選び、「内容を入力」を押してください。';
    if(escapeMarkdown(e.schedule).length>1200 || escapeMarkdown(e.description).length>800)description+='\n\n長い内容は一部省略しています。「内容を修正」で全文を確認できます。伝助には全文を送ります。';
    components=[row(new StringSelectMenuBuilder().setCustomId(`densuke:${s.id}:choice`).setPlaceholder('回答の選択肢').addOptions(Object.entries(choices).map(([value,label])=>({value,label,default:e.choice===value})))),row(button(s,'form',e.name?'内容を修正':'内容を入力',ButtonStyle.Primary),...(s.phase==='review'?[button(s,'create','確認して作成',ButtonStyle.Success)]:[]),button(s,'cancel','取り消す'))];
    components.push(row(button(s,'form-email','固定メール設定')));
  }
  return payload('✦  伝助 · 日程調整',note?`${note}\n\n${description}`:description,{components});
}
export function densukeModal(s) {
  const modal=new ModalBuilder().setCustomId(`densuke:${s.id}:submit`).setTitle('伝助のイベント内容');
  for(const [key,label,max,required,paragraph] of [['name','イベント名（必須）',250,true,false],['schedule','候補日程（必須・1行に1候補）',4000,true,true],['description','イベント説明（任意）',2000,false,true],['password','パスワード（任意・半角英数字8文字以内）',8,false,false]]) {
    const input=new TextInputBuilder().setCustomId(key).setLabel(label).setMaxLength(max).setRequired(required).setStyle(paragraph?TextInputStyle.Paragraph:TextInputStyle.Short);
    if(s.event[key])input.setValue(s.event[key]);modal.addComponents(row(input));
  }
  return modal;
}
export function densukeEmailModal(s,email) {
  const input=new TextInputBuilder().setCustomId('email').setLabel('控えメールの固定宛先').setStyle(TextInputStyle.Short).setMaxLength(254).setRequired(true);
  if(email)input.setValue(email);
  return new ModalBuilder().setCustomId(`densuke:${s.id}:submit-email`).setTitle('固定メール設定・保存').addComponents(row(input));
}
export function createDensukeController({email,settings,client=createDensukeClient(),now=()=>Date.now()}) {
  const sessions=new AdminSessions(now),attempts=new Map();let nextGlobal=0;
  const currentEmail=()=>settings?.get().densukeEmail??email;
  function authorize(i){if(!canConfigure(i.memberPermissions))throw new Error('日程調整の作成は管理者専用です。');}
  return {sessions,async open(i){
    authorize(i);await i.deferReply({flags:MessageFlags.Ephemeral});
    const s=sessions.create(i.user.id);s.phase='draft';s.event={name:'',schedule:'',description:'',password:'',choice:'1'};s.channelId=i.channelId;s.reviewEmail=currentEmail();
    await i.editReply(densukeScreen(s,currentEmail()?'':'「固定メール設定」で宛先を設定してください。'));
  },async handle(i){
    let s,locked=false;
    try {
      authorize(i);const [,id,action]=i.customId.split(':');s=sessions.get(id,i.user.id);
      if(s.busy)throw new Error('処理中です。少しお待ちください。');s.busy=true;locked=true;
      if(action==='form-email' && ['draft','review'].includes(s.phase)){s.emailEditBase=currentEmail();await i.showModal(densukeEmailModal(s,s.emailEditBase));return;}
      if(action==='form' && ['draft','review'].includes(s.phase)){await i.showModal(densukeModal(s));return;}
      if(i.isModalSubmit() && !i.message)await i.deferReply({flags:MessageFlags.Ephemeral});else await i.deferUpdate();
      let note='';
      if(action==='share' && s.phase==='done') {
        if(s.shared)throw new Error('このイベントは共有済みです。');
        if(i.channelId!==s.channelId)throw new Error('作成したチャンネルから共有してください。');
        // Mark before sending: a timeout must not invite duplicate automatic posts.
        s.shared=true;
        try {await i.channel.send(payload('✦  日程調整',`**${safe(s.event.name,250)}**\n候補日程への回答をお願いします。`,{components:[row(new ButtonBuilder().setLabel('伝助で回答する').setStyle(ButtonStyle.Link).setURL(s.result.answer))]}));note='✓ 回答用URLを共有しました。';}
        catch{note='共有結果を確認できませんでした。チャンネルを確認し、必要なら回答用URLを手動で共有してください。';}
      } else if(!['draft','review'].includes(s.phase))throw new Error('この作成操作は終了しています。');
      else if(action==='cancel'){s.phase='closed';s.event.password='';}
      else if(action==='choice'){if(!Object.hasOwn(choices,i.values[0]))throw new Error('回答の選択肢が不正です。');s.event.choice=i.values[0];}
      else if(action==='submit-email') {
        const value=i.fields.getTextInputValue('email').trim();
        if(!validDensukeEmail(value))throw new Error('254文字以内の半角メールアドレスを入力してください。');
        if(!settings)throw new Error('メール設定を保存できません。');
        if(!Object.hasOwn(s,'emailEditBase'))throw new Error('「固定メール設定」を開き直してください。');
        await settings.update(c=>{
          if((c.densukeEmail??email)!==s.emailEditBase)throw new Error('別の操作で固定メールが変更されました。設定画面を開き直してください。');
          c.densukeEmail=value;
        });
        delete s.emailEditBase;
        if(s.phase==='review')s.reviewEmail=value;
        note='✓ 固定メールを保存しました。再起動後も引き継ぎます。';
      }
      else if(action==='submit') {
        const fields={choice:s.event.choice};for(const key of ['name','schedule','description','password'])fields[key]=i.fields.getTextInputValue(key);
        s.event=eventData(fields);s.phase='review';s.reviewEmail=currentEmail();
      } else if(action==='create') {
        if(s.phase!=='review')throw new Error('先に内容を入力してください。');
        const destination=currentEmail();
        if(!validDensukeEmail(destination))throw new Error('「固定メール設定」で宛先を設定してください。');
        if(s.reviewEmail!==destination)throw new Error('別の操作で固定メールが変更されました。「内容を修正」から再確認してください。');
        for(const [id,until] of attempts)if(until<=now())attempts.delete(id);
        const wait=Math.ceil((Math.max(nextGlobal,attempts.get(i.user.id)??0)-now())/1000);
        if(wait>0)throw new Error(`作成は${wait}秒後にお試しください。`);
        attempts.set(i.user.id,now()+300000);nextGlobal=now()+60000;
        s.phase='creating';await i.editReply(payload('✧  伝助を作成中','処理を確認しています。続けて作成を押さずにお待ちください。'));
        try{s.result=await client.create(s.event,destination);s.phase='done';s.event.password='';note='✓ 作成しました。URLはこの画面だけに表示しています。';}
        catch(error){s.phase=error instanceof UncertainCreation?'uncertain':'review';throw error;}
      } else throw new Error('不明な操作です。');
      await i.editReply(densukeScreen(s,note));
    } catch(error) {
      const message=s?densukeScreen(s,`操作できませんでした：${safe(error.message,250)}`):payload('✧  日程調整',safe(error.message,250));
      if(i.deferred || i.replied)await i.editReply(message);else await i.reply({...message,flags:MessageFlags.Ephemeral});
    } finally {if(locked)s.busy=false;}
  }};
}
