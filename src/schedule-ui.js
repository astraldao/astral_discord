import {calendarImage,calendarAlt} from './calendar-image.js';
import {randomUUID} from 'node:crypto';
import {AttachmentBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,ChannelSelectMenuBuilder,ChannelType,ModalBuilder,TextInputBuilder,TextInputStyle,MessageFlags,PermissionFlagsBits as P,escapeMarkdown} from 'discord.js';
import {GameSessions} from './game-sessions.js';
import {payload} from './ui.js';
import {currentScheduleMonth,shiftScheduleMonth,scheduleMonth} from './schedule-store.js';
const safe=x=>escapeMarkdown(String(x)).replace(/@/g,'＠');
const row=(...c)=>new ActionRowBuilder().addComponents(...c);
const button=(s,a,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`schedule:${s.id}:${s.turn}:${a}`).setLabel(label).setStyle(style);
const monthName=m=>`${m.slice(0,4)}年${Number(m.slice(5))}月`;
const clock=n=>`${String(Math.floor(n%1440/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
export const eventTime=e=>e.start===null?'終日':`${clock(e.start)}${e.end===null?'':`〜${e.end>=1440?'翌日 ':''}${clock(e.end)}`}`;
const eventsFor=(c,m)=>c.events.filter(e=>e.date.slice(0,7)===m).sort((a,b)=>a.date.localeCompare(b.date)||(a.start??-1)-(b.start??-1)||a.title.localeCompare(b.title));
const dateLabel=e=>{const d=new Date(`${e.date}T00:00:00+09:00`);return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',weekday:'short'}).format(d);};
function calendarMessage(m,c,month,today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),note=''){
  const image=calendarImage(month,c.events,{today}),title=m.embeds[0].toJSON().title;
  const cover=payload(title,`${note?`${note}\n\n`:''}予定 **${image.layout.count}件** · 日本時間`).embeds[0].setImage('attachment://calendar.png');
  m.embeds[0].setTitle('予定の一覧');
  return {...m,embeds:[cover,...m.embeds],attachments:[],files:[new AttachmentBuilder(image.buffer,{name:'calendar.png',description:calendarAlt(image.layout)})]};
}
export function schedulePanel(c,p){
  const events=eventsFor(c,p.month),list=events.slice(0,12).map(e=>`**${dateLabel(e)} · ${eventTime(e)}**\n${safe(e.title)}`).join('\n\n');
  return calendarMessage(payload(`📅  ${safe(c.title)} · ${monthName(p.month)}`,`${list||'この月の予定はまだありません。'}${events.length>12?`\n\nほか ${events.length-12}件。下のボタンで一覧を開けます。`:''}\n\n日本時間`,{components:[row(new ButtonBuilder().setCustomId(`schedule:panel:${p.id}`).setLabel('カレンダーを開く').setStyle(ButtonStyle.Primary))]}),c,p.month,'');
}
const pages=(s,items,size)=>{const count=Math.max(1,Math.ceil(items.length/size));s.page=Math.max(0,Math.min(count-1,s.page??0));return {count,items:items.slice(s.page*size,(s.page+1)*size)};};
export function scheduleScreen(s,store,note=''){
  const admin=s.scope==='admin',intro=note?`${note}\n\n`:'';let m;
  if(s.view==='home'){
    const p=pages(s,store.metadata(),10);m=payload('📅  予定表の管理',`${intro}${p.items.length?'予定表を選んでください。':'「予定表を作る」から始めてください。'}`,{components:[...(p.items.length?[row(new StringSelectMenuBuilder().setCustomId(`schedule:${s.id}:${s.turn}:calendar`).setPlaceholder('予定表を選ぶ').addOptions(...p.items.map(c=>({label:c.title,value:c.id,description:`予定 ${c.count}件 · 投稿 ${c.publications.length}件`})) ))]:[]),row(button(s,'new-calendar','予定表を作る',ButtonStyle.Primary),...(p.count>1?[button(s,'prev','前へ').setDisabled(s.page===0),button(s,'next','次へ').setDisabled(s.page===p.count-1)]:[]))]});
  }else{
    const c=store.calendar(s.calendarId),e=c.events.find(e=>e.id===s.eventId),p=c.publications.find(p=>p.id===s.publicationId);
    if(s.view==='event'){
      if(!e)throw new Error('予定が削除されています。一覧から開き直してください。');m=payload(`📅  ${safe(e.title)}`,`${intro}**${dateLabel(e)} · ${e.date.slice(0,4)}年**\n**${eventTime(e)}** · 日本時間${e.place?`\n\n場所 ${safe(e.place)}`:''}${e.description?`\n\n${safe(e.description)}`:''}`,{components:[...(admin?[row(button(s,'edit-event','予定を編集',ButtonStyle.Primary),button(s,'delete-event','予定を削除',ButtonStyle.Danger))]:[]),row(button(s,'list','予定の一覧へ'))]});
    }else if(s.view==='delete-confirm'){
      m=payload('📅  予定の削除を確認',`**${safe(s.deleteStage.title)}**\nこの予定を削除し、送信済みの予定表も更新します。`,{components:[row(button(s,'confirm-delete','削除する',ButtonStyle.Danger),button(s,'event-back','変更せず戻る'))]});
    }else if(s.view==='publish'){
      m=payload('📅  予定表を共有',`${intro}**${safe(c.title)} · ${monthName(s.month)}**\n予定表の送信先を選んでください。`,{components:[row(new ChannelSelectMenuBuilder().setCustomId(`schedule:${s.id}:${s.turn}:channel`).setPlaceholder('送信先テキストチャンネル').setChannelTypes(ChannelType.GuildText)),row(button(s,'list','予定の一覧へ'))]});
    }else if(s.view==='publish-confirm'){
      m=payload('📅  送信内容を確認',`<#${s.publishStage.channelId}> に **${monthName(s.month)}** の予定表を送ります。\nこの予定表の内容は、送信先を閲覧できるメンバーに共有されます。\nほかの月の予定も、一覧から閲覧できます。`,{components:[row(button(s,'send','このチャンネルに送る',ButtonStyle.Primary),button(s,'list','変更せず戻る'))]});const preview=schedulePanel(c,{id:'preview',month:s.month});m.embeds.push(...preview.embeds);m.files=preview.files;
    }else if(s.view==='publications'){
      m=payload('📅  送信済みの予定表',`${intro}${c.publications.length?'投稿を選ぶと、表示月の変更や復旧ができます。':'まだ投稿していません。'}`,{components:[...(c.publications.length?[row(new StringSelectMenuBuilder().setCustomId(`schedule:${s.id}:${s.turn}:publication`).setPlaceholder('投稿を選ぶ').addOptions(...c.publications.map(p=>({label:`${monthName(p.month)} · ${p.status==='ready'?'送信済み':'結果未確認'}`,value:p.id,description:`チャンネル ${p.channelId}`}))))]:[]),row(button(s,'refresh-posts','投稿を更新',ButtonStyle.Primary),button(s,'list','予定の一覧へ'))]});
    }else if(s.view==='publication'){
      if(!p)throw new Error('投稿情報が変わりました。選び直してください。');m=payload('📅  投稿の管理',`${intro}<#${p.channelId}> · **${monthName(p.month)}**\n${p.status==='ready'?`[投稿を開く](https://discord.com/channels/${s.guildId}/${p.channelId}/${p.messageId})`:'送信結果を確認できていません。実際の投稿があればURLで復旧してください。自動再送はしません。'}`,{components:[row(...(p.status==='ready'?[button(s,'edit-month','表示月を変更',ButtonStyle.Primary)]:[button(s,'recover','投稿URLで復旧',ButtonStyle.Primary),button(s,'cancel-pending','未送信の予約を解除')])),row(button(s,'publications','投稿一覧へ'))]});
    }else if(s.view==='cancel-confirm'){
      m=payload('📅  未送信の予約を解除',`<#${p.channelId}> の実際の投稿を確認してください。\n投稿済みなら解除せず、URLで復旧してください。未送信の予約を解除すると、もう一度送信できるようになります。`,{components:[row(button(s,'confirm-cancel','未送信として解除',ButtonStyle.Danger),button(s,'publication-back','解除せず戻る'))]});
    }else{
      const all=eventsFor(c,s.month),p=pages(s,all,8);m=payload(`📅  ${safe(c.title)} · ${monthName(s.month)}`,`${s.display==='list'?intro:''}${p.items.length?p.items.map(e=>`**${dateLabel(e)} · ${eventTime(e)}**\n${safe(e.title)}`).join('\n\n'):'この月の予定はまだありません。'}\n\n日本時間${p.count>1?` · ${s.page+1}/${p.count}ページ`:''}`,{components:[...(p.items.length?[row(new StringSelectMenuBuilder().setCustomId(`schedule:${s.id}:${s.turn}:event`).setPlaceholder('予定の詳細を開く').addOptions(...p.items.map(e=>({label:e.title,value:e.id,description:`${e.date} · ${eventTime(e)}`}))))]:[]),row(button(s,'month-prev','前の月').setDisabled(s.month==='2000-01'),button(s,'month-current','今月'),button(s,'month-next','次の月').setDisabled(s.month==='2099-12'),button(s,'month-jump','月を指定'),button(s,'display',s.display==='list'?'カレンダー表示':'一覧表示')),...(p.count>1?[row(button(s,'prev','前のページ').setDisabled(s.page===0),button(s,'next','次のページ').setDisabled(s.page===p.count-1))]:[]),...(admin?[row(button(s,'new-event','予定を追加',ButtonStyle.Primary),button(s,'publish','チャンネルに送る'),button(s,'publications','投稿を管理')),row(button(s,'rename','予定表の名前を変更'),button(s,'home','予定表の管理へ'))]:[])]});
    }
  }if(s.view==='list'&&s.display!=='list')m=calendarMessage(m,store.calendar(s.calendarId),s.month,s.today,note);return {...m,attachments:[]};
}
function modal(s,kind,store,today){
  const f=s.form,c=s.calendarId?store.calendar(s.calendarId):null,e=f.eventId?c?.events.find(e=>e.id===f.eventId):null;
  const input=(id,label,max,value='',required=true,paragraph=false)=>row(new TextInputBuilder().setCustomId(id).setLabel(label).setMaxLength(max).setStyle(paragraph?TextInputStyle.Paragraph:TextInputStyle.Short).setRequired(required).setValue(value));
  const m=new ModalBuilder().setCustomId(`schedule:${s.id}:${s.turn}:form:${f.token}`).setTitle({calendar:'予定表を作る',rename:'予定表の名前',event:e?'予定を編集':'予定を追加',navigate:'表示する月',month:'投稿の表示月',recover:'投稿URLで復旧'}[kind]);
  if(kind==='event')m.addComponents(input('title','予定名',80,s.eventDraft?.title??e?.title??''),input('date','日付（YYYY/MM/DD）',10,s.eventDraft?.date??e?.date??(today.slice(0,7)===s.month?today:`${s.month}-01`)),input('time','日本時間 HH:MM-HH:MM（終了が早い場合は翌日）',20,s.eventDraft?.time??(e?.start===null||!e?'':`${clock(e.start)}${e.end===null?'':`-${clock(e.end)}`}`),false),input('place','場所・VC・リンク（任意）',100,s.eventDraft?.place??e?.place??'',false),input('description','説明（任意）',500,s.eventDraft?.description??e?.description??'',false,true));
  else if(kind==='recover')m.addComponents(input('value','この予定表の投稿URL',200));
  else if(kind==='navigate')m.addComponents(input('value','表示月（YYYY/MM）',7,s.month));
  else if(kind==='month')m.addComponents(input('value','表示月（YYYY/MM）',7,c.publications.find(p=>p.id===s.publicationId).month));
  else m.addComponents(input('value','予定表の名前',60,kind==='rename'?c.title:''));return m;
}
export function createScheduleController({guild,store,now=()=>Date.now(),access=async(i,admin)=>{const member=await guild.members.fetch({user:i.user.id,force:true}),channel=await guild.channels.fetch(i.channelId,{force:true});if(!channel?.permissionsFor(member)?.has(P.ViewChannel)||admin&&!member.permissions.has(P.Administrator))throw new Error(admin?'管理者権限がありません。':'このチャンネルでは予定表を閲覧できません。');}}){
  const sessions=new GameSessions(now);let refreshTail=Promise.resolve();
  const get=(id,i)=>{const s=sessions.get(id,i.user.id);if(s.channelId!==i.channelId)throw new Error('元のチャンネルから操作してください。');if(s.scope==='viewer'){const p=store.publication(s.publicationId);if(p.status!=='ready'||p.channelId!==i.channelId||p.calendarId!==s.calendarId)throw new Error('この予定表は公開されていません。');}return s;};
  const channelFor=async id=>{const c=await guild.channels.fetch(id,{force:true}),me=await guild.members.fetchMe({force:true});if((c?.guildId??c?.guild?.id)!==guild.id||c?.type!==ChannelType.GuildText||!c.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks,P.ReadMessageHistory,P.AttachFiles]))throw new Error('送信先とBotの閲覧・送信・埋め込み・履歴・ファイル添付権限を確認してください。');return c;};
  async function ack(i){if(i.deferred||i.replied)return;if(i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});}
  async function error(i,e){const m={...payload('📅  予定表',safe(e.message).slice(0,700),{state:'error'}),attachments:[]};if(i.deferred||i.replied)await i.editReply(m);else await i.reply({...m,flags:MessageFlags.Ephemeral});}
  function refresh(calendarId){const job=refreshTail.then(async()=>{let updated=0,failed=0;const calendars=calendarId?[store.calendar(calendarId)]:store.metadata();for(const c of calendars)for(const publication of c.publications){if(publication.status!=='ready')continue;try{const channel=await channelFor(publication.channelId),message=await channel.messages.fetch(publication.messageId),p=store.publication(publication.id);if(message.author.id!==guild.members.me.id||!message.components.some(r=>r.components.some(b=>b.customId===`schedule:panel:${p.id}`)))throw new Error('投稿を確認できません。');await message.edit(schedulePanel(store.calendar(p.calendarId),p));updated++;}catch{failed++;}}return {updated,failed};});refreshTail=job.catch(()=>{});return job;}
  const refreshed=async id=>{const r=await refresh(id);return r.failed?`予定は保存しました。投稿更新 ${r.updated}件・失敗 ${r.failed}件。「投稿を管理」から確認してください。`:r.updated?`✓ 保存して、投稿 ${r.updated}件も更新しました。`:'✓ 保存しました。';};
  async function open(i,admin=true,pubId){try{await ack(i);await access(i,admin);if([...sessions.sessions.values()].some(s=>s.userId===i.user.id&&s.busy))throw new Error('前の操作を処理中です。');let p;if(!admin){p=store.publication(pubId);if(p.status!=='ready'||p.channelId!==i.channelId||i.message?.id!==p.messageId)throw new Error('このチャンネルの予定表から開いてください。');}const s=sessions.create(i.user.id);Object.assign(s,{scope:admin?'admin':'viewer',channelId:i.channelId,guildId:guild.id,turn:0,today:new Date(now()+9*3600000).toISOString().slice(0,10),month:p?.month??currentScheduleMonth(now()),view:admin?'home':'list',...(p?{calendarId:p.calendarId,publicationId:p.id}:{})});await i.editReply(scheduleScreen(s,store));}catch(e){await error(i,e);}}
  async function handle(i){if(i.customId.startsWith('schedule:panel:')){await open(i,false,i.customId.slice(15));return;}let s,locked=false;try{
    const [,id,turn,action,token]=i.customId.split(':');s=get(id,i);if(s.busy)throw new Error('前の操作を処理中です。');s.busy=true;locked=true;
    const forms=['new-calendar','rename','new-event','edit-event','edit-month','recover','month-jump'];if(!forms.includes(action))await ack(i);await access(i,s.scope==='admin');get(id,i);if(String(s.turn)!==turn)throw new Error('古い画面です。元のメニューから開き直してください。');
    const admin=s.scope==='admin',readonly=['list','event','month-prev','month-next','month-current','month-jump','display','prev','next'];if(!admin&&!readonly.includes(action)&&!(action==='form'&&s.form?.kind==='navigate'))throw new Error('予定表の編集は管理者専用です。');
    const check=async()=>{await access(i,admin);get(id,i);};let note='';
    if(forms.includes(action)){
      let kind=action==='month-jump'?'navigate':action==='new-calendar'?'calendar':action==='rename'?'rename':['new-event','edit-event'].includes(action)?'event':action==='edit-month'?'month':'recover';
      if(action==='month-jump'&&s.view!=='list'||action==='new-calendar'&&s.view!=='home'||['rename','new-event'].includes(action)&&s.view!=='list'||action==='edit-event'&&s.view!=='event'||['edit-month','recover'].includes(action)&&s.view!=='publication')throw new Error('元の画面から操作してください。');
      if(kind==='event'&&(s.draftCalendarId!==s.calendarId||s.draftEventId!==(action==='edit-event'?s.eventId:null)))delete s.eventDraft;
      const c=s.calendarId?store.calendar(s.calendarId):null,e=action==='edit-event'?c.events.find(e=>e.id===s.eventId):null,p=['month','recover'].includes(kind)?store.publication(s.publicationId):null;if(action==='edit-event'&&!e)throw new Error('予定が見つかりません。');if(p&&(kind==='month'?p.status!=='ready':p.status!=='pending'))throw new Error('投稿の状態が変わりました。');
      s.form={kind,token:randomUUID().slice(0,12),calendarId:s.calendarId,eventId:e?.id,revision:e?.revision??c?.revision,publicationId:p?.id,publicationRevision:p?JSON.stringify(p):null};await i.showModal(modal(s,kind,store,new Date(now()+9*3600000).toISOString().slice(0,10)));return;
    }else if(action==='form'){
      const f=s.form;if(!f||f.token!==token||f.calendarId!==s.calendarId)throw new Error('最新の入力画面から操作してください。');
      if(f.kind==='navigate'){s.month=scheduleMonth(i.fields.getTextInputValue('value'));s.page=0;s.view='list';}
      else if(f.kind==='calendar'){s.calendarId=await store.create(i.fields.getTextInputValue('value'),check);s.view='list';s.page=0;s.month=currentScheduleMonth(now());}
      else if(f.kind==='rename'){await store.rename(s.calendarId,i.fields.getTextInputValue('value'),f.revision,check);s.view='list';}
      else if(f.kind==='event'){const input=Object.fromEntries(['title','date','time','place','description'].map(k=>[k,i.fields.getTextInputValue(k)]));s.eventDraft=input;s.draftCalendarId=s.calendarId;s.draftEventId=f.eventId??null;s.eventId=await store.putEvent(s.calendarId,f.eventId,input,f.revision,check);delete s.eventDraft;delete s.draftEventId;delete s.draftCalendarId;s.month=store.calendar(s.calendarId).events.find(e=>e.id===s.eventId).date.slice(0,7);s.view='event';}
      else if(f.kind==='month'){await store.changeMonth(f.publicationId,scheduleMonth(i.fields.getTextInputValue('value')),f.publicationRevision,check);s.view='publication';}
      else if(f.kind==='recover'){
        const m=i.fields.getTextInputValue('value').trim().match(/^https:\/\/(?:discord\.com|discordapp\.com)\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/),p=store.publication(f.publicationId);if(!m||m[1]!==guild.id||m[2]!==p.channelId)throw new Error('指定チャンネルの予定表の投稿URLを入力してください。');const channel=await channelFor(p.channelId),message=await channel.messages.fetch(m[3]);if(message.author.id!==guild.members.me.id||!message.components.some(r=>r.components.some(b=>b.customId===`schedule:panel:${p.id}`)))throw new Error('このBotが送った、この予定表の投稿を指定してください。');await check();await store.complete(p.id,message.id,check);s.view='publication';
      }else throw new Error('入力を確認してください。');delete s.form;if(f.kind!=='navigate')note=await refreshed(s.calendarId);
    }else if(action==='home'){s.view='home';s.page=0;delete s.calendarId;delete s.form;delete s.publishStage;}
    else if(action==='calendar'){if(s.view!=='home'||i.values?.length!==1)throw new Error('予定表を選び直してください。');store.calendar(i.values[0]);s.calendarId=i.values[0];s.view='list';s.page=0;s.month=currentScheduleMonth(now());delete s.form;}
    else if(action==='list'){s.view='list';s.page=0;delete s.form;delete s.publishStage;delete s.deleteStage;}
    else if(action==='event'){if(s.view!=='list'||i.values?.length!==1||!store.calendar(s.calendarId).events.some(e=>e.id===i.values[0]))throw new Error('予定を選び直してください。');s.eventId=i.values[0];s.view='event';}
    else if(action==='display'){if(s.view!=='list')throw new Error('カレンダーから操作してください。');s.display=s.display==='list'?'calendar':'list';}
    else if(['month-prev','month-next','month-current'].includes(action)){if(s.view!=='list')throw new Error('一覧から操作してください。');s.month=action==='month-current'?currentScheduleMonth(now()):shiftScheduleMonth(s.month,action==='month-next'?1:-1);s.page=0;}
    else if(action==='prev'||action==='next'){if(!['home','list'].includes(s.view))throw new Error('一覧から操作してください。');s.page+=action==='next'?1:-1;}
    else if(action==='delete-event'){if(s.view!=='event')throw new Error('予定から操作してください。');s.deleteStage=store.calendar(s.calendarId).events.find(e=>e.id===s.eventId);if(!s.deleteStage)throw new Error('予定が見つかりません。');s.view='delete-confirm';}
    else if(action==='confirm-delete'){if(s.view!=='delete-confirm'||!s.deleteStage)throw new Error('削除確認から操作してください。');await store.removeEvent(s.calendarId,s.deleteStage.id,s.deleteStage.revision,check);delete s.deleteStage;s.view='list';note=await refreshed(s.calendarId);}
    else if(action==='event-back'){s.view='event';delete s.deleteStage;}
    else if(action==='publish'){if(s.view!=='list')throw new Error('一覧から操作してください。');s.view='publish';}
    else if(action==='channel'){if(s.view!=='publish'||i.values?.length!==1)throw new Error('送信先を選んでください。');await channelFor(i.values[0]);await check();s.publishStage={channelId:i.values[0],month:s.month,revision:store.calendar(s.calendarId).revision};s.view='publish-confirm';}
    else if(action==='send'){
      const stage=s.publishStage;if(s.view!=='publish-confirm'||!stage)throw new Error('送信確認から操作してください。');const channel=await channelFor(stage.channelId);const pId=await store.reserve(s.calendarId,stage.channelId,stage.month,async()=>{await check();if(store.calendar(s.calendarId).revision!==stage.revision)throw new Error('予定表が変更されました。プレビューを開き直してください。');});s.publicationId=pId;s.view='publication';delete s.publishStage;
      await check();const p=store.publication(pId),message=await channel.send(schedulePanel(store.calendar(s.calendarId),p));await store.complete(pId,message.id,check);note='✓ 予定表を送信しました。';
    }else if(action==='publications'){s.view='publications';}
    else if(action==='publication'){if(s.view!=='publications'||i.values?.length!==1||!store.calendar(s.calendarId).publications.some(p=>p.id===i.values[0]))throw new Error('投稿を選んでください。');s.publicationId=i.values[0];s.view='publication';}
    else if(action==='refresh-posts'){note=await refreshed(s.calendarId);s.view='publications';}
    else if(action==='cancel-pending'){const p=store.publication(s.publicationId);if(s.view!=='publication'||p.status!=='pending')throw new Error('未確認の投稿から操作してください。');s.cancelRevision=JSON.stringify(p);s.view='cancel-confirm';}
    else if(action==='confirm-cancel'){if(s.view!=='cancel-confirm')throw new Error('解除の確認から操作してください。');await store.cancelPending(s.publicationId,s.cancelRevision,check);delete s.cancelRevision;s.view='publications';}
    else if(action==='publication-back'){s.view='publication';delete s.cancelRevision;}
    else throw new Error('操作を確認してください。');
    s.turn++;await check();await i.editReply(scheduleScreen(s,store,note));
  }catch(e){let recover=false;if(s){try{await access(i,s.scope==='admin');get(s.id,i);recover=true;}catch{}}if(recover){try{await ack(i);const m=scheduleScreen(s,store);m.embeds[0].setDescription(`確認してください：${safe(e.message)}\n\n${m.embeds[0].toJSON().description??''}`);await i.editReply(m);}catch{await error(i,e);}}else await error(i,e);}finally{if(locked)s.busy=false;}}
  return {sessions,openAdmin:i=>open(i),handle,refresh};
}
