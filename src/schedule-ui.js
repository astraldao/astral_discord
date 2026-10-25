import {actionPicker,selectedAction} from './compact-controls.js';
import {scheduleActions} from './schedule-actions.js';
import {organizeViews,organizeScreen,historyItems,bulkCandidates} from './schedule-organize-ui.js';
import {scheduleRestoration,historyFingerprint} from './schedule-history.js';
import {scheduleShift,scheduleConflicts} from './schedule-shift.js';
import {calendarImage,calendarAlt} from './calendar-image.js';
import {scheduleQuery,selectedScheduleEvents} from './schedule-query.js';
import {scheduleWeek,shiftScheduleWeek,scheduleUpcoming} from './schedule-range.js';
import {scheduleDays,scheduleImageOverflow} from './schedule-days.js';
import {scheduleColors,scheduleColor} from './schedule-colors.js';
import {ScheduleError,scheduleErrorMessage} from './schedule-errors.js';
import {scheduleExport} from './schedule-export.js';
import {parseScheduleImport,readScheduleAttachment} from './schedule-import.js';
import {scheduleImportModal,scheduleImportScreen} from './schedule-import-ui.js';
import {scheduleRecurrence,scheduleRecurrenceChoices,scheduleRecurrenceOverlapCount} from './schedule-recurrence.js';
import {sharedScheduleAccess,sharedScheduleMessage} from './shared-schedule-ui.js';
import {randomUUID} from 'node:crypto';
import {AttachmentBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,ChannelSelectMenuBuilder,ChannelType,ModalBuilder,TextInputBuilder,TextInputStyle,MessageFlags,PermissionFlagsBits as P,escapeMarkdown} from 'discord.js';
import {GameSessions} from './game-sessions.js';
import {payload,adminHomeButton,adminSectionButton,adminFeatureButton,menuHomeButton} from './ui.js';
import {currentScheduleMonth,shiftScheduleMonth,scheduleMonth,scheduleDate,scheduleInputDate,planScheduleImport} from './schedule-store.js';
const safe=x=>escapeMarkdown(String(x)).replace(/@/g,'＠');
const row=(...c)=>new ActionRowBuilder().addComponents(...c);
const button=(s,a,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`schedule:${s.id}:${s.turn}:${a}`).setLabel(label).setStyle(style);
const monthName=m=>`${m.slice(0,4)}年${Number(m.slice(5))}月`;
const clock=n=>`${String(Math.floor(n%1440/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
export const eventTime=e=>e.start===null?'終日':`${clock(e.start)}${e.end===null?'':`〜${e.end>=1440?'翌日 ':''}${clock(e.end)}`}`;
const eventsFor=(c,m)=>selectedScheduleEvents(c,{month:m});
const shortDate=date=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',weekday:'short'}).format(new Date(`${date}T00:00:00+09:00`));
const dateLabel=e=>`${shortDate(e.date)}${e.endDate?`〜${e.endDate.slice(0,4)!==e.date.slice(0,4)?`${e.endDate.slice(0,4)}年 `:''}${shortDate(e.endDate)}`:''}`;
const hasRange=s=>s.period==='week'||s.period==='upcoming';
const rangeLabel=s=>`${s.rangeStart.slice(0,4)}年 ${shortDate(s.rangeStart)}〜${s.rangeEnd.slice(0,4)!==s.rangeStart.slice(0,4)?`${s.rangeEnd.slice(0,4)}年 `:''}${shortDate(s.rangeEnd)}`;
function eventList(items,s){
  const groups=[];let previous;
  for(const e of items){
    // Keep different multi-day ranges separate even when their start day matches.
    const date=`${s.query||hasRange(s)?`${e.date.slice(0,4)}年 `:''}${dateLabel(e)}`;
    if(date!==previous){groups.push(`**${date}**`);previous=date;}
    groups[groups.length-1]+=`\n**${eventTime(e)}** · ${e.color?`${scheduleColors[e.color].emoji} `:''}${safe(e.title)}${hasRange(s)&&!s.query&&e.date<s.rangeStart?'\n期間前から続く予定':''}`;
  }
  return groups.join('\n\n');
}
const searchScope=s=>JSON.stringify([s.calendarId,s.month,s.date,s.period,s.rangeStart,s.rangeEnd,s.display]);
function clearSearch(s,restorePage=false){
  const page=restorePage&&s.searchReturn?.scope===searchScope(s)?s.searchReturn.page:0;
  delete s.query;delete s.searchReturn;if(restorePage)s.page=page;
}
const clearRange=s=>{delete s.period;delete s.rangeStart;delete s.rangeEnd;};
const chooseRange=(s,period,range)=>{Object.assign(s,{period,...range,month:range.rangeStart.slice(0,7),page:0});delete s.date;clearSearch(s);};
const viewOptions=[{value:'month-calendar',label:'月カレンダー',description:'月全体の配置と前後の月を画像で見る'},{value:'month-list',label:'月の一覧',description:'予定名・時刻を文字で読む（スマホにも）'},{value:'week',label:'週間',description:'日曜日から土曜日の予定を見る'},{value:'upcoming',label:'今日から30日',description:'今日を含む30日分をまとめて見る'}];
function pickerDays(s,c){const picker=s.dayPicker,all=scheduleDays(c,picker.month,s.today,{onlyEvents:picker.onlyEvents,onlyHidden:picker.onlyHidden}),count=Math.max(1,Math.ceil(all.length/25));picker.page=Math.max(0,Math.min(picker.page,count-1));return {all,count,items:all.slice(picker.page*25,(picker.page+1)*25)};}
function recurrenceSource(s,store){
  const r=s.repeat,c=store.calendar(s.calendarId),e=c.events.find(e=>e.id===r?.eventId);
  if(!r||r.calendarId!==s.calendarId||!e||e.revision!==r.sourceRevision)throw new ScheduleError('元の予定が変更されました。予定の詳細から選び直してください。');
  return {r,c,e};
}
function calendarMessage(m,c,month,today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),note='',selectedDate,hint=''){
  const image=calendarImage(month,c.events,{today,title:c.title,selectedDate}),title=m.embeds[0].toJSON().title;
  const count=selectedDate?`月全体 **${image.layout.count}件** · 選択日 **${image.layout.cells.find(c=>c.date===selectedDate)?.items.length??0}件**`:`予定 **${image.layout.count}件**`;
  const cover=payload(title,`${note?`${note}\n\n`:''}${count} · 日本時間${hint?`\n\n${hint}`:''}`).embeds[0].setImage('attachment://calendar.png');
  m.embeds[0].setTitle(selectedDate?'この日の予定':'予定の一覧');
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
    const p=pages(s,store.metadata(),10);m=payload('📅  予定表の管理',`${intro}${p.items.length?'予定表を選んでください。':'「予定表を作る」から始めてください。'}`,{components:[...(p.items.length?[row(new StringSelectMenuBuilder().setCustomId(`schedule:${s.id}:${s.turn}:calendar`).setPlaceholder('予定表を選ぶ').addOptions(...p.items.map(c=>({label:c.title,value:c.id,description:`予定 ${c.count}件 · 投稿 ${c.publications.length}件`})) ))]:[]),row(button(s,'new-calendar','予定表を作る',ButtonStyle.Primary),...(p.count>1?[button(s,'prev','前へ').setDisabled(s.page===0),button(s,'next','次へ').setDisabled(s.page===p.count-1)]:[])),row(adminSectionButton('schedule'),adminHomeButton())]});
  }else{
    const c=store.calendar(s.calendarId),e=c.events.find(e=>e.id===s.eventId),p=c.publications.find(p=>p.id===s.publicationId);
    if(organizeViews.has(s.view)){m=organizeScreen(s,c,{time:eventTime,date:scheduleInputDate,note});}
    else if(['import-preview','import-detail'].includes(s.view)){
      m=scheduleImportScreen(s,c,note);
    }else if(s.view==='event'){
      if(!e)throw new ScheduleError('予定が削除されています。一覧から開き直してください。');
      const selected=selectedScheduleEvents(c,s),index=selected.findIndex(v=>v.id===e.id),stage=s.colorStage;if(!stage||stage.calendarId!==c.id||stage.eventId!==e.id||stage.revision!==e.revision||stage.turn!==s.turn)s.colorStage={calendarId:c.id,eventId:e.id,revision:e.revision,turn:s.turn};
      m=payload(`📅  ${safe(e.title)}`,`${intro}**${dateLabel(e)} · ${e.date.slice(0,4)}年**\n**${eventTime(e)}** · 日本時間${e.color?`\n${scheduleColors[e.color].emoji} ${scheduleColors[e.color].label}`:''}${e.place?`\n\n場所 ${safe(e.place)}`:''}${e.description?`\n\n${safe(e.description)}`:''}\n\n${index>=0?`表示範囲の ${index+1}/${selected.length}件目`:'この予定は現在の一覧の表示条件外です。'}`,{components:[
        row(...(admin?[button(s,'edit-event','予定を編集',ButtonStyle.Primary)]:[]),button(s,'list','一覧へ戻る')),
        row(button(s,'event-prev','前の予定').setDisabled(index<=0),button(s,'event-next','次の予定').setDisabled(index<0||index===selected.length-1)),
        actionPicker(`schedule:${s.id}:${s.turn}:actions`,scheduleActions(s,c),'予定の操作を選ぶ'),
        ...(admin?[row(new StringSelectMenuBuilder().setCustomId(`schedule:${s.id}:${s.turn}:event-color`).setPlaceholder('予定の色を選ぶ').addOptions({label:'自動（予定名で決まる）',value:'auto',default:!e.color},...Object.entries(scheduleColors).map(([value,color])=>({label:color.label,emoji:color.emoji,value,default:value===e.color}))))]:[]),
      ]});
    }else if(s.view==='days'){
      const picker=s.dayPicker,p=pickerDays(s,c);
      m=payload('📅  日付から予定を探す',`${intro}**${safe(c.title)} · ${monthName(picker.month)}**\n${picker.onlyHidden?'月画像で予定を省略した日だけを表示しています。日付を選ぶと、その日の予定を文字で全件確認できます。':picker.onlyEvents?'予定がある日だけを表示しています。':'すべての日を表示しています。'}${picker.onlyHidden?'':'\n日付を選ぶと、その日の予定を開けます。'}${!p.items.length?picker.onlyHidden?'\n省略のある日はなくなりました。「予定がある日を表示」でほかの日も確認できます。':'\n予定がある日はまだありません。「すべての日を表示」で日付を選べます。':''}${p.count>1?`\n${picker.page+1}/${p.count}ページ`:''}`,{components:[
        ...(p.items.length?[row(new StringSelectMenuBuilder().setCustomId(`schedule:${s.id}:${s.turn}:days-date`).setPlaceholder('日付・予定件数から選ぶ').addOptions(...p.items.map(day=>({label:day.label,value:day.date,description:day.description}))))]:[]),
        row(button(s,'days-month-prev','前の月').setDisabled(picker.month==='2000-01'),button(s,'days-month-current','今月'),button(s,'days-month-next','次の月').setDisabled(picker.month==='2099-12')),
        ...(p.count>1?[row(button(s,'days-prev','前のページ').setDisabled(picker.page===0),button(s,'days-next','次のページ').setDisabled(picker.page===p.count-1))]:[]),
        actionPicker(`schedule:${s.id}:${s.turn}:actions`,scheduleActions(s,c),'日付の表示・入力を選ぶ'),
        row(button(s,'list','選ばず戻る')),
      ]});m=calendarMessage(m,c,picker.month,s.today,'',s.date?.startsWith(picker.month)?s.date:undefined);m.embeds[1].setTitle('日付を選ぶ');
    }else if(s.view==='repeat-settings'){
      const r=s.repeat,source=c.events.find(e=>e.id===r?.eventId);
      if(!source||r.calendarId!==c.id)throw new ScheduleError('元の予定を選び直してください。');
      m=payload('📅  繰り返し予定を追加',`${intro}**${safe(source.title)}**\n元の予定：${scheduleInputDate(source)} · ${eventTime(source)}\n\n**${scheduleRecurrenceChoices[r.frequency]} · 追加 ${r.count}件**\n次の日付から、同じ名前・時刻・場所・説明で追加します。元の予定は残し、追加後は1件ずつ編集できます。\n毎月は、元の日が存在しない月を飛ばします。\n\n「追加する日付を確認」で、保存前に全日程を確認してください。`,{components:[
        row(new StringSelectMenuBuilder().setCustomId(`schedule:${s.id}:${s.turn}:repeat-frequency`).setPlaceholder('繰り返す間隔').addOptions(...Object.entries(scheduleRecurrenceChoices).map(([value,label])=>({value,label,default:value===r.frequency})))),
        row(button(s,'repeat-count','追加する件数を入力'),button(s,'repeat-preview','追加する日付を確認',ButtonStyle.Primary)),
        row(button(s,'event-back','追加せず戻る')),
      ]});
    }else if(s.view==='repeat-preview'){
      const stage=s.repeatStage;if(!stage)throw new ScheduleError('追加する日付を確認し直してください。');
      const lines=stage.inputs.map((input,n)=>`${n+1}. ${input.date}`).join('\n');
      m=payload('📅  追加する予定を確認',`${intro}**${safe(stage.title)} · ${stage.label} · 追加 ${stage.inputs.length}件**\n${eventTime(stage.source)} · 日本時間${stage.source.place?`\n場所：${safe(stage.source.place)}`:''}\n\n${lines}\n\n元の予定は追加件数に含めません。${stage.overlaps?`\n既存の予定と日付・時刻が重なる候補が **${stage.overlaps}件** あります。重複して追加しないか確認してください。`:''}\nこの日付を独立した予定としてまとめて保存します。あとから自動では増やしません。`,{components:[row(button(s,'repeat-save',`この${stage.inputs.length}件を追加`,ButtonStyle.Primary),button(s,'repeat-settings','条件を変更')),row(button(s,'event-back','追加せず戻る'))]});
    }else if(s.view==='tools'){
      const events=selectedScheduleEvents(c,s),scope=s.query?`検索「${safe(s.query)}」· 全期間`:hasRange(s)?`${s.period==='week'?'週間':'今日から30日'} · ${rangeLabel(s)}`:s.date?`${s.date} の予定`:`${monthName(s.month)} の予定`;
      m=payload(admin?'📅  予定の検索・整理':'📅  検索・取り出し',`${intro}**${safe(c.title)}**\n${scope} · **${events.length}件**\n\n予定名・場所・説明を全期間から検索できます。\n日付:2026/10/17 や 月:2026/10 で絞り込み、スペースで条件を組み合わせられます。\nカレンダーファイルは、この範囲の全ページの予定を含みます。端末へ保存し、対応アプリで読み込んでください。自動同期はしません。${admin?'\n\n「整理・復元」で、日付の一括移動・変更履歴・時間の重なりを確認できます。':''}`,{components:[
        row(button(s,'search','予定を検索',ButtonStyle.Primary),button(s,'list',s.query?'検索結果へ':'一覧へ戻る')),
        ...(scheduleActions(s,c).length?[actionPicker(`schedule:${s.id}:${s.turn}:actions`,scheduleActions(s,c),'保存・管理の操作を選ぶ')]:[]),
      ]});
    }else if(s.view==='delete-confirm'){
      m=payload('📅  予定の削除を確認',`**${safe(s.deleteStage.title)}**\nこの予定を削除し、送信済みの予定表も更新します。\n削除前の内容は、変更履歴が保持されている間は復元できます。`,{components:[row(button(s,'confirm-delete','削除する',ButtonStyle.Danger),button(s,'event-back','変更せず戻る'))]});
    }else if(s.view==='publish'){
      m=payload('📅  予定表を共有',`${intro}**${safe(c.title)} · ${monthName(s.month)}**\n予定表の送信先を選んでください。`,{components:[row(new ChannelSelectMenuBuilder().setCustomId(`schedule:${s.id}:${s.turn}:channel`).setPlaceholder('送信先テキストチャンネル').setChannelTypes(ChannelType.GuildText)),row(button(s,'list','予定の一覧へ'))]});
    }else if(s.view==='publish-confirm'){
      m=payload('📅  送信内容を確認',`<#${s.publishStage.channelId}> に **${monthName(s.month)}** の予定表を送ります。\nこの予定表の内容は、送信先を閲覧できるメンバーに共有されます。\nほかの月の予定も、一覧から閲覧できます。`,{components:[row(button(s,'send','このチャンネルに送る',ButtonStyle.Primary),button(s,'list','変更せず戻る'))]});const preview=schedulePanel(c,{id:'preview',month:s.month});m.embeds.push(...preview.embeds);m.files=preview.files;
    }else if(s.view==='publications'){
      m=payload('📅  送信済みの予定表',`${intro}${c.publications.length?'投稿を選ぶと、表示月の変更や復旧ができます。':'まだ投稿していません。'}`,{components:[...(c.publications.length?[row(new StringSelectMenuBuilder().setCustomId(`schedule:${s.id}:${s.turn}:publication`).setPlaceholder('投稿を選ぶ').addOptions(...c.publications.map(p=>({label:`${monthName(p.month)} · ${p.status==='ready'?'送信済み':'結果未確認'}`,value:p.id,description:`チャンネル ${p.channelId}`}))))]:[]),row(button(s,'refresh-posts','投稿を更新',ButtonStyle.Primary),button(s,'list','予定の一覧へ'))]});
    }else if(s.view==='publication'){
      if(!p)throw new ScheduleError('投稿情報が変わりました。選び直してください。');m=payload('📅  投稿の管理',`${intro}<#${p.channelId}> · **${monthName(p.month)}**\n${p.status==='ready'?`[投稿を開く](https://discord.com/channels/${s.guildId}/${p.channelId}/${p.messageId})`:'送信結果を確認できていません。実際の投稿があればURLで復旧してください。自動再送はしません。'}`,{components:[row(...(p.status==='ready'?[button(s,'edit-month','表示月を変更',ButtonStyle.Primary),button(s,'unpublish','この投稿の共有を停止')]:[button(s,'recover','投稿URLで復旧',ButtonStyle.Primary),button(s,'cancel-pending','未送信の予約を解除')])),row(button(s,'publications','投稿一覧へ'))]});
    }else if(s.view==='unpublish-confirm'){
      m=payload('📅  この投稿の共有を停止',`${intro}<#${p.channelId}> · **${monthName(p.month)}**\nこの投稿からの閲覧・検索・取り出しと、開いている閲覧画面を停止します。\n\n予定表・予定データと、ほかの共有投稿は残します。停止後に元の投稿の削除も試みます。削除できない場合、投稿に表示済みの内容は管理者が削除してください。\n取り出し済みのファイルやコピーは消せません。`,{components:[row(button(s,'confirm-unpublish','この投稿の共有を停止',ButtonStyle.Danger),button(s,'publication-back','停止せず戻る'))]});
    }else if(s.view==='cancel-confirm'){
      m=payload('📅  未送信の予約を解除',`<#${p.channelId}> の実際の投稿を確認してください。\n投稿済みなら解除せず、URLで復旧してください。未送信の予約を解除すると、もう一度送信できるようになります。`,{components:[row(button(s,'confirm-cancel','未送信として解除',ButtonStyle.Danger),button(s,'publication-back','解除せず戻る'))]});
    }else{
      const all=selectedScheduleEvents(c,s),p=pages(s,all,8),range=hasRange(s),textView=range||s.display==='list'||!!s.query;
      const day=s.date?` · ${Number(s.date.slice(5,7))}/${Number(s.date.slice(8))}`:'';
      const empty=s.query?'一致する予定がありません。下の「検索語を変える」か「検索を解除」を使ってください。':range?'この期間の予定はまだありません。':s.date?'この日の予定はまだありません。':'この月の予定はまだありません。';
      const details=eventList(p.items,s);
      const body=textView||s.date?details:(p.items.length?'予定を選ぶと、時刻・場所・説明を確認できます。':'');
      const selectedView=range?s.period:s.display==='list'?'month-list':'month-calendar';
      const navigation=s.query?[button(s,'search','検索語を変える'),button(s,'search-clear','検索を解除')]:s.period==='week'?[button(s,'week-prev','前の週').setDisabled(shiftScheduleWeek(s.rangeStart,-1).rangeStart===s.rangeStart),button(s,'week-current','今週'),button(s,'week-next','次の週').setDisabled(shiftScheduleWeek(s.rangeStart,1).rangeStart===s.rangeStart)]:s.period==='upcoming'?[button(s,'upcoming-current','今日から更新')]:[button(s,'month-prev','前の月').setDisabled(s.month==='2000-01'),button(s,'month-current','今月'),button(s,'month-next','次の月').setDisabled(s.month==='2099-12')];
      m=payload(`📅  ${safe(c.title)} · ${s.query?'予定の検索':range?s.period==='week'?'週間':'今日から30日':`${monthName(s.month)}${day}`}`,`${textView?intro:''}${s.query?`検索「${safe(s.query)}」· 全期間 · **${all.length}件**\n\n`:range?`**${rangeLabel(s)} · ${all.length}件**${s.period==='upcoming'?'\n表示開始日を含む最大30日分です。':''}\n\n`:''}${body||empty}\n\n表示 ${p.items.length}件 / 全${all.length}件 · 日本時間${p.count>1?` · ${s.page+1}/${p.count}ページ`:''}`,{components:[
        row(new StringSelectMenuBuilder().setCustomId(`schedule:${s.id}:${s.turn}:period`).setPlaceholder('表示を切り替える').addOptions(...viewOptions.map(option=>({...option,default:!s.query&&option.value===selectedView})))),
        ...(p.items.length?[row(new StringSelectMenuBuilder().setCustomId(`schedule:${s.id}:${s.turn}:event`).setPlaceholder(s.date&&!s.query?'この日の予定を開く':'予定の詳細を開く').addOptions(...p.items.map(e=>({label:e.title,value:e.id,description:`${scheduleInputDate(e)} · ${eventTime(e)}`}))))]:[]),
        row(...navigation),
        ...(p.count>1||s.viaMenu?[row(...(p.count>1?[button(s,'prev','前のページ').setDisabled(s.page===0),button(s,'next','次のページ').setDisabled(s.page===p.count-1)]:[]),...(s.viaMenu?[new ButtonBuilder().setCustomId('menu:calendar').setLabel('予定表を選ぶ').setStyle(ButtonStyle.Secondary)]:[]))]:[]),
        actionPicker(`schedule:${s.id}:${s.turn}:actions`,scheduleActions(s,c),admin?'追加・検索・その他の操作':'検索・日付・その他の操作'),
      ]});
    }
  }if(s.view==='list'&&!s.query&&!hasRange(s)&&s.display!=='list'){
    const c=store.calendar(s.calendarId),overflow=scheduleImageOverflow(s,c);
    const hint=s.date?'予定名・時刻は下の文字一覧で確認できます。':'小さい文字や省略した名前は「表示を切り替える → 月の一覧」で読めます。';
    m=calendarMessage(m,c,s.month,s.today,note,s.date,`${hint}${overflow.length?`\n当月の${overflow.length}日で予定の帯を省略しています。「${s.scope==='admin'?'追加・検索・その他の操作':'検索・日付・その他の操作'} → 省略のある日から探す」で確認できます。`:''}`);
  }return {...m,attachments:[]};
}
function modal(s,kind,store,today){
  const f=s.form,c=s.calendarId?store.calendar(s.calendarId):null,e=f.eventId?c?.events.find(e=>e.id===f.eventId):null;
  const input=(id,label,max,value='',required=true,paragraph=false)=>row(new TextInputBuilder().setCustomId(id).setLabel(label).setMaxLength(max).setStyle(paragraph?TextInputStyle.Paragraph:TextInputStyle.Short).setRequired(required).setValue(value));
  const m=new ModalBuilder().setCustomId(`schedule:${s.id}:${s.turn}:form:${f.token}`).setTitle({calendar:'予定表を作る',rename:'予定表の名前',event:f.sourceId?'複製して予定を追加':e?'予定を編集':'予定を追加',navigate:'表示する月',day:'日付を選ぶ',month:'投稿の表示月',recover:'投稿URLで復旧',search:'予定を検索','repeat-count':'繰り返し予定の追加件数','bulk-days':'日付を移動する日数'}[kind]);
  const defaultDate=s.view==='days'?(today.slice(0,7)===s.dayPicker.month?today:`${s.dayPicker.month}-01`):s.date??(hasRange(s)?today>=s.rangeStart&&today<=s.rangeEnd?today:s.rangeStart:today.slice(0,7)===s.month?today:`${s.month}-01`);
  if(kind==='event')m.addComponents(input('title','予定名',80,s.eventDraft?.title??e?.title??''),input('date','日付 YYYY/MM/DD（終日は〜で範囲・最大31日）',21,s.eventDraft?.date??(e?scheduleInputDate(e):defaultDate)),input('time','日本時間 HH:MM-HH:MM（終了が早い場合は翌日）',20,s.eventDraft?.time??(e?.start===null||!e?'':`${clock(e.start)}${e.end===null?'':`-${clock(e.end)}`}`),false),input('place','場所・VC・リンク（任意）',100,s.eventDraft?.place??e?.place??'',false),input('description','説明（任意）',500,s.eventDraft?.description??e?.description??'',false,true));
  else if(kind==='bulk-days')m.addComponents(input('value','後へ移動は7、前へ移動は-7（前後365日まで）',4,String(s.bulk.days)));
  else if(kind==='repeat-count')m.addComponents(input('value','元の予定を除く追加件数（1〜26）',2,String(s.repeat.count)));
  else if(kind==='search'){const field=input('value','検索語（空欄で解除・スペースで絞り込み）',80,s.query??'',false);field.components[0].setPlaceholder('例：図書館 / 日付:2026/10/17 / 月:2026/10 図書館');m.addComponents(field);}
  else if(kind==='recover')m.addComponents(input('value','この予定表の投稿URL',200));
  else if(kind==='navigate')m.addComponents(input('value','表示月（YYYY/MM）',7,s.month));
  else if(kind==='day')m.addComponents(input('value','日付（YYYY/MM/DD）',10,defaultDate));
  else if(kind==='month')m.addComponents(input('value','表示月（YYYY/MM）',7,c.publications.find(p=>p.id===s.publicationId).month));
  else m.addComponents(input('value','予定表の名前',60,kind==='rename'?c.title:''));return m;
}
export function createScheduleController({guild,store,now=()=>Date.now(),readImport=readScheduleAttachment,sharedAccess=i=>sharedScheduleAccess(guild,i),access=async(i,admin)=>{const member=await guild.members.fetch({user:i.user.id,force:true}),channel=await guild.channels.fetch(i.channelId,{force:true});if(!channel?.permissionsFor(member)?.has(P.ViewChannel)||admin&&!member.permissions.has(P.Administrator))throw new ScheduleError(admin?'管理者権限がありません。':'このチャンネルでは予定表を閲覧できません。');}}){
  const sessions=new GameSessions(now);let refreshTail=Promise.resolve(),importing=false,nextImport=0;
  const menuAccess=async(i,s)=>{if(s?.viaMenu)await sharedAccess(i);};
  const get=(id,i)=>{let s;try{s=sessions.get(id,i.user.id);}catch{throw new ScheduleError('この画面は終了しています。閲覧用は元の予定表の「カレンダーを開く」から、管理用は予定表を開き直してください。');}if(s.channelId!==i.channelId)throw new ScheduleError('元のチャンネルから操作してください。');if(s.scope==='viewer'){const p=store.publication(s.publicationId);if(p.status!=='ready'||p.channelId!==i.channelId||p.calendarId!==s.calendarId)throw new ScheduleError('この予定表は公開されていません。');}return s;};
  const channelFor=async id=>{const c=await guild.channels.fetch(id,{force:true}),me=await guild.members.fetchMe({force:true});if((c?.guildId??c?.guild?.id)!==guild.id||c?.type!==ChannelType.GuildText||!c.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks,P.ReadMessageHistory,P.AttachFiles]))throw new ScheduleError('送信先とBotの閲覧・送信・埋め込み・履歴・ファイル添付権限を確認してください。');return c;};
  async function ack(i){if(i.deferred||i.replied)return;if(i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});}
  async function error(i,e){let admin=false;try{await access(i,true);admin=true;}catch{}const m={...payload('📅  予定表',safe(scheduleErrorMessage(e)).slice(0,700),{state:'error',components:[row(...(admin?[adminFeatureButton('open-schedule'),adminSectionButton('schedule')]:[]),menuHomeButton())]}),attachments:[]};if(i.deferred||i.replied)await i.editReply(m);else await i.reply({...m,flags:MessageFlags.Ephemeral});}
  function refresh(calendarId){const job=refreshTail.then(async()=>{let updated=0,failed=0;const calendars=calendarId?[store.calendar(calendarId)]:store.metadata();for(const c of calendars)for(const publication of c.publications){if(publication.status!=='ready')continue;try{const channel=await channelFor(publication.channelId),message=await channel.messages.fetch(publication.messageId),p=store.publication(publication.id);if(message.author.id!==guild.members.me.id||!message.components.some(r=>r.components.some(b=>b.customId===`schedule:panel:${p.id}`)))throw new ScheduleError('投稿を確認できません。');await message.edit(schedulePanel(store.calendar(p.calendarId),p));updated++;}catch{failed++;}}return {updated,failed};});refreshTail=job.catch(()=>{});return job;}
  const refreshed=async id=>{const r=await refresh(id);return r.failed?`予定は保存しました。投稿更新 ${r.updated}件・失敗 ${r.failed}件。「投稿を管理」から確認してください。`:r.updated?`✓ 保存して、投稿 ${r.updated}件も更新しました。`:'✓ 保存しました。';};
  function resumedScreen(s){
    let note='前の操作を再開しました。';
    const c=s.calendarId?store.metadata().find(c=>c.id===s.calendarId):null;
    if(s.view!=='home'&&!c){s.view='home';s.page=0;delete s.calendarId;note='前の予定表が見つからないため、予定表の一覧に戻りました。';}
    else if(c){
      const calendar=store.calendar(s.calendarId);
      if(['event','delete-confirm','repeat-settings','repeat-preview'].includes(s.view)&&!calendar.events.some(e=>e.id===s.eventId)){s.view='list';note='前の予定が見つからないため、予定の一覧に戻りました。';}
      if(['history-detail','restore-confirm'].includes(s.view)&&!calendar.history?.some(h=>h.id===s.historyId)){s.view='history';s.historyPage=0;note='前の履歴が見つからないため、履歴の一覧に戻りました。';}
      if(['publication','cancel-confirm','unpublish-confirm'].includes(s.view)&&!calendar.publications.some(p=>p.id===s.publicationId))s.view='publications';
      s.view=({'delete-confirm':'event','repeat-settings':'event','repeat-preview':'event','import-preview':'tools','import-detail':'tools','publish-confirm':'list','cancel-confirm':'publication','unpublish-confirm':'publication','history-clear-confirm':'history','restore-confirm':'history-detail','bulk-preview':'organize','bulk-select':'organize','conflicts':'organize'})[s.view]??s.view;
    }
    delete s.form;delete s.deleteStage;delete s.publishStage;delete s.cancelRevision;delete s.unpublishStage;delete s.repeat;delete s.repeatStage;delete s.importStage;delete s.importPage;delete s.importIndex;delete s.bulk;delete s.bulkStage;delete s.restoreStage;delete s.conflictReport;delete s.historyClearStage;s.turn++;
    s.today=new Date(now()+9*3600000).toISOString().slice(0,10);if(s.period==='upcoming'){const range=scheduleUpcoming(s.today);if(!s.query&&range.rangeStart!==s.rangeStart)s.page=0;Object.assign(s,range,{month:range.rangeStart.slice(0,7)});}return scheduleScreen(s,store,note);
  }
  async function open(i,admin=true,pubId,viaMenu=false){try{await ack(i);await access(i,admin);if([...sessions.sessions.values()].some(s=>s.userId===i.user.id&&s.busy))throw new ScheduleError('前の操作を処理中です。');const previous=admin?sessions.resume(i.user.id,i.channelId,s=>s.scope==='admin'):null;if(previous){await i.editReply(resumedScreen(previous));return;}let p;if(!admin){
      p=store.publication(pubId);if(p.status!=='ready'||p.channelId!==i.channelId||!viaMenu&&i.message?.id!==p.messageId)throw new ScheduleError('このチャンネルの予定表から開いてください。');
      if(viaMenu){const {channel,bot}=await sharedAccess(i);await sharedScheduleMessage(channel,bot,p);await sharedAccess(i);const latest=store.publication(pubId);if(latest.status!=='ready'||latest.channelId!==i.channelId||latest.calendarId!==p.calendarId||latest.messageId!==p.messageId)throw new ScheduleError('共有の状態が変わりました。メニューから開き直してください。');p=latest;}
    }const s=sessions.create(i.user.id);Object.assign(s,{scope:admin?'admin':'viewer',viaMenu,channelId:i.channelId,guildId:guild.id,turn:0,today:new Date(now()+9*3600000).toISOString().slice(0,10),month:p?.month??currentScheduleMonth(now()),view:admin?'home':'list',...(p?{calendarId:p.calendarId,publicationId:p.id}:{})});await i.editReply(scheduleScreen(s,store));}catch(e){await error(i,e);}}
  async function handle(i){if(i.customId.startsWith('schedule:panel:')){await open(i,false,i.customId.slice(15));return;}let s,locked=false;try{
    const [,id,turn,incoming,token]=i.customId.split(':');s=get(id,i);let action=incoming;if(s.busy)throw new ScheduleError('前の操作を処理中です。');s.busy=true;locked=true;
    if(action==='actions'){action=selectedAction(i.values,scheduleActions(s,store.calendar(s.calendarId)));if(!action)throw new ScheduleError('この画面の操作一覧から選び直してください。');}
    const forms=['new-calendar','rename','new-event','edit-event','edit-month','recover','month-jump','day-jump','search','copy-event','repeat-count','bulk-days','import'];if(!forms.includes(action))await ack(i);await access(i,s.scope==='admin');await menuAccess(i,s);get(id,i);if(String(s.turn)!==turn)throw new ScheduleError('古い画面です。元のメニューから開き直してください。');
    const admin=s.scope==='admin',readonly=['list','event','event-prev','event-next','export-event','days','days-date','days-toggle','days-prev','days-next','days-month-prev','days-month-next','days-month-current','period','week-prev','week-next','week-current','upcoming-current','month-prev','month-next','month-current','month-jump','day-jump','day-today','day-clear','display','prev','next','tools','export','search','search-clear'];if(!admin&&!readonly.includes(action)&&!(action==='form'&&['navigate','day','search'].includes(s.form?.kind)))throw new ScheduleError('予定表の編集は管理者専用です。');
    const check=async()=>{await access(i,admin);await menuAccess(i,s);if(get(id,i)!==s)throw new ScheduleError('操作画面が変更されました。予定表を開き直してください。');};let note='',download=false,downloadEventId=null;
    const importCheck=async stage=>{await check();if(s.importStage!==stage||!['import-preview','import-detail'].includes(s.view)||stage.calendarId!==s.calendarId)throw new ScheduleError('取り込みの確認画面が変更されました。ファイルを選び直してください。');};
    if(action==='import'){
      if(!['tools','import-preview','import-detail'].includes(s.view))throw new ScheduleError('検索・取り出しから操作してください。');
      if(!s.importStage&&[...sessions.sessions.values()].filter(v=>v.importStage&&v.expires>now()).length>=4)throw new ScheduleError('ファイルの確認画面が使用中です。取り込みを完了するか、取り込まず戻ってからお試しください。');
      s.form={kind:'import',token:randomUUID().slice(0,12),calendarId:s.calendarId,revision:store.calendar(s.calendarId).revision};await i.showModal(scheduleImportModal(s));return;
    }
    if(forms.includes(action)){
      let kind=action==='bulk-days'?'bulk-days':action==='repeat-count'?'repeat-count':action==='search'?'search':action==='day-jump'?'day':action==='month-jump'?'navigate':action==='new-calendar'?'calendar':action==='rename'?'rename':['new-event','edit-event','copy-event'].includes(action)?'event':action==='edit-month'?'month':'recover';
      if(action==='bulk-days'&&s.view!=='bulk-select'||action==='month-jump'&&s.view!=='list'||action==='day-jump'&&!['list','days'].includes(s.view)||action==='new-calendar'&&s.view!=='home'||action==='new-event'&&s.view!=='list'||action==='rename'&&!['list','tools'].includes(s.view)||action==='search'&&!['list','tools'].includes(s.view)||['edit-event','copy-event'].includes(action)&&s.view!=='event'||['edit-month','recover'].includes(action)&&s.view!=='publication'||action==='repeat-count'&&s.view!=='repeat-settings')throw new ScheduleError('元の画面から操作してください。');
      if(action==='repeat-count')recurrenceSource(s,store);if(action==='bulk-days')bulkCandidates(s,store.calendar(s.calendarId));
      const source=action==='copy-event'?store.calendar(s.calendarId).events.find(e=>e.id===s.eventId):null;
      if(action==='copy-event'&&!source)throw new ScheduleError('元の予定が見つかりません。');
      const draftKey=source?`copy:${source.id}:${source.revision}`:action==='edit-event'?s.eventId:null;
      if(kind==='event'&&(s.draftCalendarId!==s.calendarId||s.draftEventId!==draftKey))delete s.eventDraft;
      if(source&&!s.eventDraft)s.eventDraft={title:source.title,date:scheduleInputDate(source),time:source.start===null?'':`${clock(source.start)}${source.end===null?'':`-${clock(source.end)}`}`,place:source.place,description:source.description};
      if(kind==='event'){s.draftCalendarId=s.calendarId;s.draftEventId=draftKey;}
      const c=s.calendarId?store.calendar(s.calendarId):null,e=action==='edit-event'?c.events.find(e=>e.id===s.eventId):null,p=['month','recover'].includes(kind)?store.publication(s.publicationId):null;if(action==='edit-event'&&!e)throw new ScheduleError('予定が見つかりません。');if(p&&(kind==='month'?p.status!=='ready':p.status!=='pending'))throw new ScheduleError('投稿の状態が変わりました。');
      s.form={kind,...(kind==='bulk-days'?{bulkId:s.bulk.id}:{}),...(source?{sourceId:source.id,sourceRevision:source.revision,sourceColor:source.color}:{}),token:randomUUID().slice(0,12),calendarId:s.calendarId,eventId:e?.id,revision:e?.revision??c?.revision,publicationId:p?.id,publicationRevision:p?JSON.stringify(p):null};await i.showModal(modal(s,kind,store,new Date(now()+9*3600000).toISOString().slice(0,10)));return;
    }else if(action==='form'){
      const f=s.form;if(!f||f.token!==token||f.calendarId!==s.calendarId)throw new ScheduleError('最新の入力画面から操作してください。');
      if(f.kind==='bulk-days'){
        if(s.view!=='bulk-select'||s.bulk?.id!==f.bulkId)throw new ScheduleError('移動対象を選び直してください。');bulkCandidates(s,store.calendar(s.calendarId));const value=i.fields.getTextInputValue('value').trim();if(!/^[+-]?[1-9]\d{0,2}$/.test(value)||Math.abs(Number(value))>365)throw new ScheduleError('日数は0以外の前後365日以内で入力してください。');s.bulk.days=Number(value);
      }
      else if(f.kind==='search'){
        const query=scheduleQuery(i.fields.getTextInputValue('value'));
        if(query){if(!s.query)s.searchReturn={scope:searchScope(s),page:s.page??0};s.query=query;s.page=0;}
        else clearSearch(s,!!s.query);
        s.view='list';
      }
      else if(f.kind==='import'){
        if(!['tools','import-preview','import-detail'].includes(s.view))throw new ScheduleError('ファイル選択から操作してください。');
        const files=i.fields.getUploadedFiles('calendar-file',true);if(files.size!==1)throw new ScheduleError('ICSファイルを1つ選んでください。');
        if(importing)throw new ScheduleError('別のファイルを読み込み中です。少し待ってから選び直してください。');
        if(now()<nextImport)throw new ScheduleError(`次のファイルは${Math.ceil((nextImport-now())/1000)}秒後に選んでください。`);
        importing=true;nextImport=now()+10000;
        try{
          const body=await readImport(files.first?.()??[...files.values()][0]);await check();
          if(s.form!==f||String(s.turn)!==turn||f.calendarId!==s.calendarId)throw new ScheduleError('ファイルの選択画面が変更されました。選び直してください。');
          const parsed=parseScheduleImport(body),calendar=store.calendar(s.calendarId);if(calendar.revision!==f.revision)throw new ScheduleError('予定表が変更されました。ファイルを選び直して確認してください。');
          const plan=planScheduleImport(calendar,parsed.inputs),total=store.metadata().reduce((n,c)=>n+c.count,0);
          if(calendar.events.length+plan.events.length>200||total+plan.events.length>1000)throw new ScheduleError('取り込み後の保存上限（1予定表200件・全体1000件）を超えます。ファイルの予定を減らしてください。');
          if(!s.importStage&&[...sessions.sessions.values()].filter(v=>v.importStage&&v.expires>now()).length>=4)throw new ScheduleError('ファイルの確認画面が使用中です。少し待ってから選び直してください。');
          s.importStage={calendarId:calendar.id,calendarRevision:calendar.revision,inputs:parsed.inputs,events:plan.events.sort((a,b)=>a.date.localeCompare(b.date)||(a.start??-1)-(b.start??-1)||a.title.localeCompare(b.title)),eventCount:plan.eventCount,duplicates:plan.duplicates,warnings:parsed.warnings};s.importPage=0;s.view='import-preview';
        }finally{importing=false;}
      }
      else if(f.kind==='repeat-count'){
        if(s.view!=='repeat-settings')throw new ScheduleError('繰り返しの条件から操作してください。');recurrenceSource(s,store);
        const value=i.fields.getTextInputValue('value').trim();if(!/^(?:[1-9]|1\d|2[0-6])$/.test(value))throw new ScheduleError('追加件数は1〜26の整数で入力してください。');s.repeat.count=Number(value);
      }
      else if(f.kind==='navigate'){s.month=scheduleMonth(i.fields.getTextInputValue('value'));clearRange(s);clearSearch(s);s.page=0;s.view='list';delete s.date;}
      else if(f.kind==='day'){const date=scheduleDate(i.fields.getTextInputValue('value'));clearRange(s);clearSearch(s);delete s.dayPicker;s.date=date;s.month=s.date.slice(0,7);s.page=0;s.view='list';}
      else if(f.kind==='calendar'){s.calendarId=await store.create(i.fields.getTextInputValue('value'),check);clearRange(s);s.view='list';s.page=0;s.month=currentScheduleMonth(now());delete s.date;clearSearch(s);}
      else if(f.kind==='rename'){await store.rename(s.calendarId,i.fields.getTextInputValue('value'),f.revision,check);s.view='list';}
      else if(f.kind==='event'){
        const input={...Object.fromEntries(['title','date','time','place','description'].map(k=>[k,i.fields.getTextInputValue(k)])),...(f.sourceColor?{color:f.sourceColor}:{})};
        s.eventDraft=input;s.draftCalendarId=s.calendarId;s.draftEventId=f.sourceId?`copy:${f.sourceId}:${f.sourceRevision}`:f.eventId??null;
        const saveCheck=async()=>{
          await check();
          if(f.sourceId&&!store.calendar(s.calendarId).events.some(e=>e.id===f.sourceId&&e.revision===f.sourceRevision))throw new ScheduleError('元の予定が変更されました。複製を開き直してください。');
        };
        s.eventId=await store.putEvent(s.calendarId,f.eventId,input,f.revision,saveCheck);
        delete s.eventDraft;delete s.draftEventId;delete s.draftCalendarId;
        const saved=store.calendar(s.calendarId).events.find(e=>e.id===s.eventId);
        s.month=saved.date.slice(0,7);s.view='event';if(s.date)s.date=saved.date;
        if(hasRange(s)&&!selectedScheduleEvents(store.calendar(s.calendarId),s).some(e=>e.id===saved.id))clearRange(s);
      }
      else if(f.kind==='month'){await store.changeMonth(f.publicationId,scheduleMonth(i.fields.getTextInputValue('value')),f.publicationRevision,check);s.view='publication';}
      else if(f.kind==='recover'){
        const m=i.fields.getTextInputValue('value').trim().match(/^https:\/\/(?:discord\.com|discordapp\.com)\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/),p=store.publication(f.publicationId);if(!m||m[1]!==guild.id||m[2]!==p.channelId)throw new ScheduleError('指定チャンネルの予定表の投稿URLを入力してください。');const channel=await channelFor(p.channelId),message=await channel.messages.fetch(m[3]);if(message.author.id!==guild.members.me.id||!message.components.some(r=>r.components.some(b=>b.customId===`schedule:panel:${p.id}`)))throw new ScheduleError('このBotが送った、この予定表の投稿を指定してください。');await check();await store.complete(p.id,message.id,check);s.view='publication';
      }else throw new ScheduleError('入力を確認してください。');delete s.form;if(!['navigate','day','search','repeat-count','bulk-days','import'].includes(f.kind))note=await refreshed(s.calendarId);
    }else if(['import-preview','import-prev','import-next','import-event'].includes(action)){
      const stage=s.importStage;await importCheck(stage);if(String(s.turn)!==turn)throw new ScheduleError('古い取り込み画面です。内容を確認し直してください。');
      if(action==='import-event'){const index=Number(i.values?.[0]);if(i.values?.length!==1||!/^\d{1,3}$/.test(i.values[0])||!Number.isInteger(index)||index<s.importPage*8||index>=s.importPage*8+8||!stage.events[index])throw new ScheduleError('確認する予定を選び直してください。');s.importIndex=index;s.view='import-detail';}
      else if(action==='import-preview'){s.view='import-preview';delete s.importIndex;}
      else{if(s.view!=='import-preview')throw new ScheduleError('取り込み内容から操作してください。');s.importPage+=action==='import-next'?1:-1;}
    }else if(action==='import-cancel'){
      await importCheck(s.importStage);delete s.importStage;delete s.importPage;delete s.importIndex;delete s.form;s.view='tools';
    }else if(action==='import-save'){
      const stage=s.importStage;if(s.view!=='import-preview'||!stage||!stage.events.length)throw new ScheduleError('新しく取り込む予定を確認してください。');
      const saveCheck=async()=>{await importCheck(stage);if(s.view!=='import-preview'||String(s.turn)!==turn)throw new ScheduleError('取り込みの確認画面が変更されました。選び直してください。');};
      const result=await store.importEvents(s.calendarId,stage.inputs,stage.calendarRevision,saveCheck);
      clearRange(s);s.month=stage.events[0].date.slice(0,7);delete s.importStage;delete s.importPage;delete s.importIndex;delete s.form;clearSearch(s);delete s.date;s.page=0;s.view='list';note=`✓ ${result.added}件を取り込みました。同じ内容 ${result.duplicates}件は追加していません。\n${await refreshed(s.calendarId)}`;
    }else if(action==='tools'){if(!['list','tools'].includes(s.view))throw new ScheduleError('一覧から操作してください。');s.view='tools';}
    else if(action==='export'){if(s.view!=='tools')throw new ScheduleError('検索・取り出しから操作してください。');if(!selectedScheduleEvents(store.calendar(s.calendarId),s).length)throw new ScheduleError('取り出す予定がありません。');s.view='tools';download=true;note='✓ ファイルを用意しました。再取り込み時の重複は、利用するアプリで確認してください。';}
    else if(action==='search-clear'){if(!['list','tools'].includes(s.view))throw new ScheduleError('一覧から操作してください。');clearSearch(s,true);s.view='list';}
    else if(action==='home'){s.view='home';s.page=0;clearSearch(s);delete s.calendarId;delete s.form;delete s.publishStage;delete s.repeat;delete s.repeatStage;delete s.importStage;delete s.importPage;delete s.importIndex;}
    else if(action==='calendar'){if(s.view!=='home'||i.values?.length!==1)throw new ScheduleError('予定表を選び直してください。');store.calendar(i.values[0]);clearRange(s);s.calendarId=i.values[0];s.view='list';s.page=0;s.month=currentScheduleMonth(now());delete s.date;clearSearch(s);delete s.form;delete s.importStage;delete s.importPage;delete s.importIndex;}
    else if(action==='organize'){s.view='organize';delete s.bulk;delete s.bulkStage;delete s.restoreStage;delete s.form;}
    else if(action==='history'||action==='event-history'){
      if(!['organize','event','history','history-detail','restore-confirm'].includes(s.view))throw new ScheduleError('整理メニューか予定の詳細から操作してください。');
      if(action==='event-history'){if(s.view!=='event')throw new ScheduleError('予定の詳細から操作してください。');s.historyEventId=s.eventId;}else delete s.historyEventId;
      s.view='history';s.historyPage=0;
    }
    else if(action==='history-return'){s.view='history';delete s.restoreStage;delete s.historyClearStage;}
    else if(action==='history-clear'){
      if(s.view!=='history')throw new ScheduleError('履歴の一覧から操作してください。');const c=store.calendar(s.calendarId);if(!c.history?.length)throw new ScheduleError('消去する履歴がありません。');s.historyClearStage={calendarId:c.id,revision:c.revision,key:historyFingerprint(c)};s.view='history-clear-confirm';
    }
    else if(action==='history-clear-save'){
      const stage=s.historyClearStage;if(s.view!=='history-clear-confirm'||!stage)throw new ScheduleError('履歴の消去確認から操作してください。');await store.clearHistory(stage.calendarId,stage.revision,stage.key,async()=>{await check();if(s.historyClearStage!==stage||s.view!=='history-clear-confirm'||s.calendarId!==stage.calendarId||String(s.turn)!==turn)throw new ScheduleError('消去の確認画面が変わりました。確認し直してください。');});delete s.historyClearStage;s.view='history';note='✓ この予定表の履歴を消去しました。現在の予定・共有投稿は保持しています。';
    }
    else if(action==='history-prev'||action==='history-next'){if(s.view!=='history')throw new ScheduleError('履歴の一覧から操作してください。');s.historyPage+=action==='history-next'?1:-1;}
    else if(action==='history-pick'){
      const items=historyItems(s,store.calendar(s.calendarId)).slice(s.historyPage*5,s.historyPage*5+5);if(s.view!=='history'||i.values?.length!==1||!items.some(h=>h.id===i.values[0]))throw new ScheduleError('表示中の履歴を選んでください。');s.historyId=i.values[0];s.historyDetailPage=0;s.view='history-detail';
    }
    else if(action==='history-detail-prev'||action==='history-detail-next'){if(!['history-detail','restore-confirm'].includes(s.view))throw new ScheduleError('履歴の詳細から操作してください。');s.historyDetailPage+=action==='history-detail-next'?1:-1;}
    else if(action==='restore-preview'){
      if(s.view!=='history-detail')throw new ScheduleError('履歴の詳細から操作してください。');const c=store.calendar(s.calendarId);scheduleRestoration(c,s.historyId);s.restoreStage={calendarId:c.id,historyId:s.historyId,revision:c.revision};s.view='restore-confirm';
    }
    else if(action==='restore-save'){
      const stage=s.restoreStage;if(s.view!=='restore-confirm'||!stage)throw new ScheduleError('復元の確認から操作してください。');
      await store.restoreHistory(stage.calendarId,stage.historyId,stage.revision,async()=>{await check();if(s.restoreStage!==stage||s.view!=='restore-confirm'||s.calendarId!==stage.calendarId||s.historyId!==stage.historyId||String(s.turn)!==turn)throw new ScheduleError('復元の確認画面が変わりました。確認し直してください。');});
      delete s.restoreStage;s.view='history';s.historyPage=0;note=`✓ 変更前の内容を復元しました。\n${await refreshed(s.calendarId)}`;
    }
    else if(action==='bulk-open'){
      if(s.view!=='organize')throw new ScheduleError('整理メニューから操作してください。');const c=store.calendar(s.calendarId),candidates=selectedScheduleEvents(c,s);if(!candidates.length)throw new ScheduleError('今の表示範囲・検索結果に予定がありません。先に一覧の条件を変更してください。');s.bulk={id:randomUUID(),calendarId:c.id,calendarRevision:c.revision,candidateIds:candidates.map(e=>e.id),eventIds:[],days:7,page:0,previewPage:0};s.view='bulk-select';
    }
    else if(['bulk-pick','bulk-prev','bulk-next','bulk-clear','bulk-select'].includes(action)){
      if(!['bulk-select','bulk-preview'].includes(s.view))throw new ScheduleError('移動対象の選択から操作してください。');const all=bulkCandidates(s,store.calendar(s.calendarId)),b=s.bulk;
      if(action==='bulk-pick'){
        if(s.view!=='bulk-select'||!Array.isArray(i.values)||new Set(i.values).size!==i.values.length)throw new ScheduleError('移動対象を選び直してください。');const pageIds=all.slice(b.page*25,b.page*25+25).map(e=>e.id);if(i.values.some(id=>!pageIds.includes(id)))throw new ScheduleError('表示中の予定から選んでください。');const selected=[...b.eventIds.filter(id=>!pageIds.includes(id)),...i.values];if(selected.length>26)throw new ScheduleError('一括移動は26件までです。選択を減らしてください。');b.eventIds=selected;
      }else if(action==='bulk-clear')b.eventIds=[];else if(action==='bulk-prev'||action==='bulk-next')b.page+=action==='bulk-next'?1:-1;
      delete s.bulkStage;s.view='bulk-select';
    }
    else if(action==='bulk-preview'){
      if(s.view!=='bulk-select')throw new ScheduleError('移動対象の選択から操作してください。');const c=store.calendar(s.calendarId);bulkCandidates(s,c);s.bulkStage={calendarId:c.id,revision:c.revision,eventIds:[...s.bulk.eventIds],plan:scheduleShift(c,s.bulk.eventIds,s.bulk.days)};s.bulk.previewPage=0;s.view='bulk-preview';
    }
    else if(action==='bulk-preview-prev'||action==='bulk-preview-next'){if(s.view!=='bulk-preview')throw new ScheduleError('移動の確認から操作してください。');s.bulk.previewPage+=action==='bulk-preview-next'?1:-1;}
    else if(action==='bulk-save'){
      const stage=s.bulkStage;if(s.view!=='bulk-preview'||!stage)throw new ScheduleError('移動前後の確認から操作してください。');
      await store.shiftEvents(stage.calendarId,stage.eventIds,stage.plan.days,stage.revision,async()=>{await check();if(s.bulkStage!==stage||s.view!=='bulk-preview'||s.calendarId!==stage.calendarId||String(s.turn)!==turn)throw new ScheduleError('一括移動の確認画面が変わりました。確認し直してください。');});
      delete s.bulkStage;delete s.bulk;s.view='organize';note=`✓ ${stage.eventIds.length}件の日付を移動しました。履歴が保持されている間は元の日付へ復元できます。\n${await refreshed(s.calendarId)}`;
    }
    else if(action==='conflicts'){
      if(!['organize','conflicts'].includes(s.view))throw new ScheduleError('整理メニューから操作してください。');const c=store.calendar(s.calendarId);s.conflictReport={...scheduleConflicts(c),calendarId:c.id,revision:c.revision};s.conflictPage=0;s.view='conflicts';
    }
    else if(action==='conflict-event'){
      const c=store.calendar(s.calendarId),r=s.conflictReport;
      if(s.view!=='conflicts'||!r||r.calendarId!==c.id||r.revision!==c.revision||i.values?.length!==1||!r.pairs.slice(s.conflictPage*5,s.conflictPage*5+5).flat().includes(i.values[0]))throw new ScheduleError('表示中の重なりから予定を選び直してください。');
      s.eventId=i.values[0];s.view='event';
    }
    else if(action==='conflicts-return'){
      if(s.view!=='event'||s.conflictReport?.calendarId!==s.calendarId)throw new ScheduleError('重なりの一覧から予定を選び直してください。');
      const c=store.calendar(s.calendarId);if(s.conflictReport.revision!==c.revision){s.conflictReport={...scheduleConflicts(c),calendarId:c.id,revision:c.revision};s.conflictPage=0;note='変更後の予定で、重なりを確認し直しました。';}s.view='conflicts';
    }
    else if(action==='conflicts-prev'||action==='conflicts-next'){if(s.view!=='conflicts')throw new ScheduleError('重なりの確認から操作してください。');s.conflictPage+=action==='conflicts-next'?1:-1;}
    else if(action==='list'){s.view='list';delete s.dayPicker;delete s.form;delete s.publishStage;delete s.deleteStage;delete s.repeat;delete s.repeatStage;delete s.importStage;delete s.importPage;delete s.importIndex;delete s.bulk;delete s.bulkStage;delete s.restoreStage;delete s.conflictReport;}
    else if(action==='days'){
      if(s.view!=='list')throw new ScheduleError('予定の一覧から操作してください。');s.today=new Date(now()+9*3600000).toISOString().slice(0,10);s.dayPicker={month:s.month,page:0,onlyEvents:true,...(scheduleImageOverflow(s,store.calendar(s.calendarId)).length?{onlyHidden:true}:{})};const all=pickerDays(s,store.calendar(s.calendarId)).all,index=all.findIndex(day=>day.date===(s.date??s.today));s.dayPicker.page=index<0?0:Math.floor(index/25);s.view='days';
    }
    else if(['days-prev','days-next','days-toggle','days-month-prev','days-month-current','days-month-next','days-date'].includes(action)){
      if(s.view!=='days'||!s.dayPicker)throw new ScheduleError('日付の選択から操作してください。');s.today=new Date(now()+9*3600000).toISOString().slice(0,10);const picker=s.dayPicker;
      if(action==='days-date'){
        if(i.values?.length!==1||!pickerDays(s,store.calendar(s.calendarId)).items.some(day=>day.date===i.values[0]))throw new ScheduleError('表示中の日付から選び直してください。');
        clearRange(s);clearSearch(s);s.date=i.values[0];s.month=s.date.slice(0,7);s.page=0;s.view='list';if(picker.onlyHidden)s.display='list';delete s.dayPicker;
      }else if(action==='days-toggle'){if(picker.onlyHidden){delete picker.onlyHidden;picker.onlyEvents=true;}else picker.onlyEvents=!picker.onlyEvents;picker.page=0;}
      else if(action==='days-prev'||action==='days-next')picker.page+=action==='days-next'?1:-1;
      else{picker.month=action==='days-month-current'?currentScheduleMonth(now()):shiftScheduleMonth(picker.month,action==='days-month-next'?1:-1);delete picker.onlyHidden;picker.page=0;}
    }
    else if(action==='event'){if(s.view!=='list'||i.values?.length!==1||!store.calendar(s.calendarId).events.some(e=>e.id===i.values[0]))throw new ScheduleError('予定を選び直してください。');s.eventId=i.values[0];s.view='event';}
    else if(action==='event-prev'||action==='event-next'){
      if(s.view!=='event')throw new ScheduleError('予定の詳細から操作してください。');const events=selectedScheduleEvents(store.calendar(s.calendarId),s),index=events.findIndex(e=>e.id===s.eventId),next=index+(action==='event-next'?1:-1);
      if(index<0||next<0||next>=events.length)throw new ScheduleError('移動できる予定がありません。一覧から選び直してください。');s.eventId=events[next].id;s.page=Math.floor(next/8);
    }
    else if(action==='export-event'){
      if(s.view!=='event'||!store.calendar(s.calendarId).events.some(e=>e.id===s.eventId))throw new ScheduleError('予定の詳細から操作してください。');downloadEventId=s.eventId;note='✓ この予定だけのファイルを用意しました。';
    }
    else if(action==='event-color'){
      const stage=s.colorStage;if(s.view!=='event'||!stage||stage.calendarId!==s.calendarId||stage.eventId!==s.eventId||stage.turn!==s.turn||i.values?.length!==1||typeof i.values[0]!=='string')throw new ScheduleError('予定の詳細から色を選び直してください。');
      const color=scheduleColor(i.values[0]);await store.setEventColor(s.calendarId,s.eventId,color,stage.revision,async()=>{await check();if(s.colorStage!==stage||s.view!=='event'||s.eventId!==stage.eventId||String(s.turn)!==turn)throw new ScheduleError('予定の詳細を開き直してください。');});note=await refreshed(s.calendarId);
    }
    else if(action==='period'){
      if(s.view!=='list'||i.values?.length!==1||!viewOptions.some(option=>option.value===i.values[0]))throw new ScheduleError('表示を選び直してください。');
      const value=i.values[0],today=new Date(now()+9*3600000).toISOString().slice(0,10);s.today=today;
      if(value==='week'){const anchor=s.date??(hasRange(s)?s.rangeStart:s.month===today.slice(0,7)?today:`${s.month}-01`);chooseRange(s,'week',scheduleWeek(anchor));}
      else if(value==='upcoming')chooseRange(s,'upcoming',scheduleUpcoming(today));
      else{clearRange(s);s.display=value==='month-list'?'list':'calendar';delete s.date;clearSearch(s);s.page=0;}
    }
    else if(['week-prev','week-next','week-current'].includes(action)){
      if(s.view!=='list'||s.period!=='week'||s.query)throw new ScheduleError('週間表示から操作してください。');
      s.today=new Date(now()+9*3600000).toISOString().slice(0,10);chooseRange(s,'week',action==='week-current'?scheduleWeek(s.today):shiftScheduleWeek(s.rangeStart,action==='week-next'?1:-1));
    }
    else if(action==='upcoming-current'){
      if(s.view!=='list'||s.period!=='upcoming'||s.query)throw new ScheduleError('今日から30日の表示から操作してください。');
      s.today=new Date(now()+9*3600000).toISOString().slice(0,10);chooseRange(s,'upcoming',scheduleUpcoming(s.today));
    }
    else if(action==='day-today'){if(!['list','days'].includes(s.view))throw new ScheduleError('カレンダーから操作してください。');clearRange(s);clearSearch(s);delete s.dayPicker;s.view='list';s.date=new Date(now()+9*3600000).toISOString().slice(0,10);s.today=s.date;s.month=s.date.slice(0,7);s.page=0;}
    else if(action==='day-clear'){if(s.view!=='list')throw new ScheduleError('一覧から操作してください。');delete s.date;s.page=0;}
    else if(action==='display'){if(s.view!=='list')throw new ScheduleError('カレンダーから操作してください。');clearRange(s);s.display=s.display==='list'?'calendar':'list';}
    else if(['month-prev','month-next','month-current'].includes(action)){if(s.view!=='list')throw new ScheduleError('一覧から操作してください。');s.month=action==='month-current'?currentScheduleMonth(now()):shiftScheduleMonth(s.month,action==='month-next'?1:-1);clearRange(s);s.page=0;delete s.date;clearSearch(s);}
    else if(action==='prev'||action==='next'){if(!['home','list'].includes(s.view))throw new ScheduleError('一覧から操作してください。');s.page+=action==='next'?1:-1;}
    else if(action==='delete-event'){if(s.view!=='event')throw new ScheduleError('予定から操作してください。');s.deleteStage=store.calendar(s.calendarId).events.find(e=>e.id===s.eventId);if(!s.deleteStage)throw new ScheduleError('予定が見つかりません。');s.view='delete-confirm';}
    else if(action==='repeat'){
      if(s.view!=='event')throw new ScheduleError('予定の詳細から操作してください。');const e=store.calendar(s.calendarId).events.find(e=>e.id===s.eventId);if(!e)throw new ScheduleError('元の予定が見つかりません。');
      s.repeat={calendarId:s.calendarId,eventId:e.id,sourceRevision:e.revision,frequency:'weekly',count:4};delete s.repeatStage;s.view='repeat-settings';
    }
    else if(action==='repeat-frequency'){
      if(s.view!=='repeat-settings'||i.values?.length!==1||!Object.hasOwn(scheduleRecurrenceChoices,i.values[0]))throw new ScheduleError('繰り返しの間隔を選び直してください。');recurrenceSource(s,store);s.repeat.frequency=i.values[0];
    }
    else if(action==='repeat-preview'){
      if(s.view!=='repeat-settings')throw new ScheduleError('繰り返しの条件から操作してください。');const {r,c,e}=recurrenceSource(s,store),plan=scheduleRecurrence(e,r);
      const total=store.metadata().reduce((n,c)=>n+c.count,0);if(c.events.length+plan.count>200||total+plan.count>1000)throw new ScheduleError('予定の保存上限（1予定表200件・全体1000件）を超えます。追加件数を減らしてください。');
      const overlaps=scheduleRecurrenceOverlapCount(c.events,plan.inputs);
      s.repeatStage={calendarId:c.id,calendarRevision:c.revision,sourceRevision:e.revision,sourceId:e.id,source:structuredClone(e),title:e.title,inputs:plan.inputs,label:plan.label,overlaps};s.view='repeat-preview';
    }
    else if(action==='repeat-settings'){
      if(s.view!=='repeat-preview')throw new ScheduleError('日付の確認から操作してください。');recurrenceSource(s,store);delete s.repeatStage;s.view='repeat-settings';
    }
    else if(action==='repeat-save'){
      const stage=s.repeatStage;if(s.view!=='repeat-preview'||!stage)throw new ScheduleError('追加する日付を確認してください。');
      const saveCheck=async()=>{await check();if(s.repeatStage!==stage||s.view!=='repeat-preview'||String(s.turn)!==turn||s.calendarId!==stage.calendarId)throw new ScheduleError('確認画面が変更されました。日付を確認し直してください。');const {e}=recurrenceSource(s,store);if(e.id!==stage.sourceId||e.revision!==stage.sourceRevision)throw new ScheduleError('元の予定が変更されました。予定から選び直してください。');};
      const ids=await store.putEvents(stage.calendarId,stage.inputs,stage.calendarRevision,saveCheck);
      clearRange(s);delete s.repeatStage;delete s.repeat;delete s.form;clearSearch(s);delete s.date;s.month=stage.inputs[0].date.slice(0,7);s.page=0;s.view='list';note=`✓ ${ids.length}件の予定を追加しました。元の予定は残しています。\n${await refreshed(s.calendarId)}`;
    }
    else if(action==='confirm-delete'){if(s.view!=='delete-confirm'||!s.deleteStage)throw new ScheduleError('削除確認から操作してください。');await store.removeEvent(s.calendarId,s.deleteStage.id,s.deleteStage.revision,check);delete s.deleteStage;s.view='list';note=await refreshed(s.calendarId);}
    else if(action==='event-back'){s.view='event';delete s.deleteStage;delete s.repeat;delete s.repeatStage;delete s.form;}
    else if(action==='publish'){if(!['list','tools'].includes(s.view))throw new ScheduleError('一覧から操作してください。');s.view='publish';}
    else if(action==='channel'){if(s.view!=='publish'||i.values?.length!==1)throw new ScheduleError('送信先を選んでください。');await channelFor(i.values[0]);await check();s.publishStage={channelId:i.values[0],month:s.month,revision:store.calendar(s.calendarId).revision};s.view='publish-confirm';}
    else if(action==='send'){
      const stage=s.publishStage;if(s.view!=='publish-confirm'||!stage)throw new ScheduleError('送信確認から操作してください。');const channel=await channelFor(stage.channelId);const pId=await store.reserve(s.calendarId,stage.channelId,stage.month,async()=>{await check();if(store.calendar(s.calendarId).revision!==stage.revision)throw new ScheduleError('予定表が変更されました。プレビューを開き直してください。');});s.publicationId=pId;s.view='publication';delete s.publishStage;
      await check();const p=store.publication(pId),message=await channel.send(schedulePanel(store.calendar(s.calendarId),p));await store.complete(pId,message.id,check);note='✓ 予定表を送信しました。';
    }else if(action==='publications'){s.view='publications';}
    else if(action==='publication'){if(s.view!=='publications'||i.values?.length!==1||!store.calendar(s.calendarId).publications.some(p=>p.id===i.values[0]))throw new ScheduleError('投稿を選んでください。');s.publicationId=i.values[0];s.view='publication';}
    else if(action==='refresh-posts'){note=await refreshed(s.calendarId);s.view='publications';}
    else if(action==='cancel-pending'){const p=store.publication(s.publicationId);if(s.view!=='publication'||p.status!=='pending')throw new ScheduleError('未確認の投稿から操作してください。');s.cancelRevision=JSON.stringify(p);s.view='cancel-confirm';}
    else if(action==='confirm-cancel'){if(s.view!=='cancel-confirm')throw new ScheduleError('解除の確認から操作してください。');await store.cancelPending(s.publicationId,s.cancelRevision,check);delete s.cancelRevision;s.view='publications';}
    else if(action==='publication-back'){s.view='publication';delete s.cancelRevision;delete s.unpublishStage;}
    else if(action==='unpublish'){
      if(s.view!=='publication')throw new ScheduleError('投稿の管理から操作してください。');
      const publication=store.publication(s.publicationId);
      if(publication.status!=='ready'||publication.calendarId!==s.calendarId)throw new ScheduleError('共有の状態が変わりました。開き直してください。');
      s.unpublishStage=publication;s.view='unpublish-confirm';
    }
    else if(action==='confirm-unpublish'){
      const stage=s.unpublishStage;if(s.view!=='unpublish-confirm'||!stage)throw new ScheduleError('共有停止の確認から操作してください。');
      await store.unpublish(stage.id,JSON.stringify(stage),check);delete s.unpublishStage;s.view='publications';
      let cleanup='unknown';
      try{
        await check();
        const channel=await guild.channels.fetch(stage.channelId,{force:true});
        if(channel?.type!==ChannelType.GuildText||(channel.guildId??channel.guild?.id)!==guild.id)throw new ScheduleError('invalid source');
        const message=await channel.messages.fetch({message:stage.messageId,force:true,cache:false});
        if(message.author?.id!==guild.members.me.id||!message.components.some(r=>r.components.some(b=>b.customId===`schedule:panel:${stage.id}`)))throw new ScheduleError('invalid message');
        await check();await message.delete();cleanup='deleted';
      }catch(error){if(error.code===10008)cleanup='missing';}
      note=cleanup==='deleted'?'✓ この投稿の共有を停止し、元の投稿も削除しました。予定データは保持しています。':cleanup==='missing'?'✓ この投稿の共有を停止しました。元の投稿は見つかりませんでした。予定データは保持しています。':`✓ この投稿の共有を停止しました。元の投稿の削除は確認できません。[投稿を確認](https://discord.com/channels/${guild.id}/${stage.channelId}/${stage.messageId})し、残っている表示内容を管理者が削除してください。予定データは保持しています。`;
    }
    else throw new ScheduleError('操作を確認してください。');
    s.turn++;await check();const message=scheduleScreen(s,store,note);
    if(download||downloadEventId){
      const calendar=store.calendar(s.calendarId),events=downloadEventId?calendar.events.filter(e=>e.id===downloadEventId):selectedScheduleEvents(calendar,s);
      if(!events.length)throw new ScheduleError('取り出す予定がありません。');
      message.files=[new AttachmentBuilder(scheduleExport(calendar,events,{now:now()}),{name:downloadEventId?'astral-event.ics':'astral-calendar.ics'})];
    }
    await i.editReply(message);
  }catch(e){let recover=false;if(s){try{await access(i,s.scope==='admin');await menuAccess(i,s);get(s.id,i);recover=true;}catch{}}if(recover){try{await ack(i);let m;try{m=scheduleScreen(s,store);}catch(renderError){if(!organizeViews.has(s.view))throw renderError;s.view='organize';delete s.bulk;delete s.bulkStage;delete s.restoreStage;delete s.historyClearStage;delete s.conflictReport;m=scheduleScreen(s,store);}m.embeds[0].setDescription(`確認してください：${safe(scheduleErrorMessage(e))}\n\n${m.embeds[0].toJSON().description??''}`);await i.editReply(m);}catch{await error(i,e);}}else await error(i,e);}finally{if(locked)s.busy=false;}}
  return {sessions,openAdmin:i=>open(i),openShared:(i,id)=>open(i,false,id,true),handle,refresh};
}
