import {ScheduleError} from './schedule-errors.js';
import {ActionRowBuilder,ButtonBuilder,ButtonStyle,FileUploadBuilder,LabelBuilder,ModalBuilder,StringSelectMenuBuilder,escapeMarkdown} from 'discord.js';
import {themed} from './ui.js';
import {scheduleInputDate} from './schedule-store.js';
const {payload}=themed('schedule');
const safe=value=>escapeMarkdown(String(value)).replace(/@/g,'＠');
const row=(...c)=>new ActionRowBuilder().addComponents(...c);
const button=(s,action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`schedule:${s.id}:${s.turn}:${action}`).setLabel(label).setStyle(style);
const clock=n=>`${String(Math.floor(n%1440/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const eventTime=e=>e.start===null?'終日':`${clock(e.start)}${e.end===null?'':`〜${e.end>=1440?'翌日 ':''}${clock(e.end)}`}`;
export function scheduleImportModal(s){
  return new ModalBuilder().setCustomId(`schedule:${s.id}:${s.turn}:form:${s.form.token}`).setTitle('予定をカレンダーファイルから取り込む').addLabelComponents(
    new LabelBuilder().setLabel('ICSファイルを1つ').setDescription('UTF-8・256KiB以内・200予定まで。読み込むだけでは保存しません。').setFileUploadComponent(
      new FileUploadBuilder().setCustomId('calendar-file').setMinValues(1).setMaxValues(1).setRequired(true)));
}
export function scheduleImportScreen(s,calendar,note=''){
  const stage=s.importStage;if(!stage)throw new ScheduleError('取り込むファイルを選び直してください。');
  const intro=note?`${note}\n\n`:'';
  if(s.view==='import-detail'){
    const event=stage.events[s.importIndex];if(!event)throw new ScheduleError('取り込む予定を選び直してください。');
    return {...payload('📅  取り込む予定の詳細',`${intro}**${safe(event.title)}**\n${scheduleInputDate(event)} · ${eventTime(event)} · 日本時間\n\n場所：${event.place?safe(event.place):'なし'}\n\n説明：${event.description?safe(event.description):'なし'}\n\nまだ保存していません。`,{components:[row(button(s,'import-preview','取り込み内容へ戻る')),row(button(s,'import-cancel','取り込まず戻る'))]}),attachments:[]};
  }
  const count=Math.max(1,Math.ceil(stage.events.length/8));s.importPage=Math.min(count-1,Math.max(0,s.importPage??0));
  const offset=s.importPage*8,events=stage.events.slice(offset,offset+8);
  const lines=events.map((e,n)=>`**${offset+n+1}. ${safe(e.title)}**\n${scheduleInputDate(e)} · ${eventTime(e)}`).join('\n\n');
  return {...payload('📅  取り込む予定を確認',`${intro}**${safe(calendar.title)}**\nファイル内 **${stage.eventCount}件** · 新規 **${stage.events.length}件** · 同じ内容 **${stage.duplicates}件を除外**\n\n${lines||'新しく追加する予定はありません。'}\n\n既存の予定は変更・削除しません。同じ予定名・日付・時刻・場所・説明の予定は追加しません。${stage.warnings.length?`\n${stage.warnings.map(safe).join('\n')}`:''}\n\nまだ保存していません。全${count}ページで内容を確認し、詳細から場所・説明も確認できます。保存すると、この予定表の既存の共有先にも表示されます。`,{components:[
    ...(events.length?[row(new StringSelectMenuBuilder().setCustomId(`schedule:${s.id}:${s.turn}:import-event`).setPlaceholder('場所・説明を確認する予定').addOptions(events.map((e,n)=>({label:e.title,value:String(offset+n),description:`${scheduleInputDate(e)} · ${eventTime(e)}`}))))]:[]),
    ...(count>1?[row(button(s,'import-prev','前のページ').setDisabled(s.importPage===0),button(s,'import-next','次のページ').setDisabled(s.importPage===count-1))]:[]),
    row(button(s,'import-save',`新規${stage.events.length}件を取り込む`,ButtonStyle.Primary).setDisabled(!stage.events.length),button(s,'import','別のファイルを選ぶ')),
    row(button(s,'import-cancel','取り込まず戻る')),
  ]}),attachments:[]};
}
