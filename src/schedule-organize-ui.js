import {actionPicker} from './compact-controls.js';
import {scheduleActions} from './schedule-actions.js';
import {ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,escapeMarkdown} from 'discord.js';
import {scheduleColors} from './schedule-colors.js';
import {themed} from './ui.js';
import {historyLabels,scheduleRestoration} from './schedule-history.js';
import {ScheduleError} from './schedule-errors.js';
const {payload}=themed('schedule');
export const organizeViews=new Set(['organize','history','history-detail','restore-confirm','history-clear-confirm','bulk-select','bulk-preview','conflicts']);
const safe=value=>escapeMarkdown(String(value)).replace(/@/g,'＠');
const short=value=>[...value].slice(0,45).join('');
export function historyItems(s,c){return [...(c.history??[])].reverse().filter(h=>!s.historyEventId||h.before.some(e=>e.id===s.historyEventId));}
export function bulkCandidates(s,c){
  const b=s.bulk;if(!b||b.calendarId!==c.id||b.calendarRevision!==c.revision)throw new ScheduleError('予定表が変更されました。整理メニューから対象を選び直してください。');return b.candidateIds.map(id=>c.events.find(e=>e.id===id)).filter(Boolean);
}
export function organizeScreen(s,c,{time,date,note=''}){
  if(s.scope!=='admin')throw new ScheduleError('予定表の整理と履歴は管理者専用です。');
  const button=(a,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`schedule:${s.id}:${s.turn}:${a}`).setLabel(label).setStyle(style),row=(...v)=>new ActionRowBuilder().addComponents(...v);
  const intro=note?`${note}\n\n`:'',back=row(button('organize','整理・復元へ'));
  const page=(value,size,at)=>{const count=Math.max(1,Math.ceil(value.length/size)),index=Math.max(0,Math.min(at??0,count-1));return {count,index,items:value.slice(index*size,index*size+size)};};
  const eventLine=e=>`**${safe(short(e.title))}**\n${date(e)} · ${time(e)}`;
  let title='予定表の整理・復元',body='',components=[];
  if(s.view==='organize'){
    body=`**${safe(c.title)}**\n登録済み ${c.events.length}件 · 編集・削除履歴 ${(c.history??[]).length}件\n\n**日付をまとめて移動**\n現在の表示範囲・検索結果から最大26件を選び、保存前に移動前後を確認します。\n\n**変更履歴・復元**\n編集前・削除前の内容を確認し、後から変更されていない予定を復元できます。\n\n**時間の重なりを確認**\n予定表全体の同時刻の予定を確認します。重なっていても自動削除はしません。`;
    components=[actionPicker(`schedule:${s.id}:${s.turn}:actions`,scheduleActions(s,c),'整理・復元の操作を選ぶ'),row(button('list','一覧へ戻る'))];
  }else if(s.view==='history'){
    title='編集・削除の履歴';const all=historyItems(s,c),p=page(all,5,s.historyPage);s.historyPage=p.index;
    body=`${s.historyEventId?'この予定の履歴':'この予定表の履歴'} ${all.length}件 · ${p.index+1}/${p.count}ページ\n\n${p.items.map(h=>`**${historyLabels[h.kind]} · ${h.before.length}件**${h.restored?'（復元済み）':''}\n<t:${Math.floor(h.at/1000)}:f> · ${safe(short(h.before[0].title))}`).join('\n\n')||'編集・削除の履歴はまだありません。'}\n\n保存は予定表ごとに直近20操作、全体50操作・512KiBまでです。上限や保存容量に応じて古い履歴を削除します。新規登録・取り込みは記録しません。バックアップの代わりにはなりません。`;
    components=[...(p.items.length?[row(new StringSelectMenuBuilder().setCustomId(`schedule:${s.id}:${s.turn}:history-pick`).setPlaceholder('変更前後を確認する履歴').addOptions(...p.items.map(h=>({label:`${historyLabels[h.kind]} · ${short(h.before[0].title)}`,value:h.id,description:`${h.before.length}件 · ${new Date(h.at+9*3600000).toISOString().slice(0,16).replace('T',' ')} JST`})) ))]:[]),...(p.count>1?[row(button('history-prev','前のページ').setDisabled(p.index===0),button('history-next','次のページ').setDisabled(p.index===p.count-1))]:[]),row(button('history-clear','この予定表の履歴を消去').setDisabled(!(c.history?.length))),back];
  }else if(s.view==='history-clear-confirm'){
    title='履歴を消去する内容を確認';body=`この予定表の編集・削除履歴 **${c.history?.length??0}操作分すべて** を消去します。特定の予定で絞り込んでいても、この予定表全体の履歴が対象です。\n\n現在の予定と共有投稿は残します。消去した履歴・削除済み予定は、この機能から復元できなくなります。取り出し済みファイルやサーバー側のバックアップまでは削除しません。`;components=[row(button('history-clear-save','この予定表の履歴を消去',ButtonStyle.Danger),button('history-return','消去せず戻る')),back];
  }else if(s.view==='history-detail'||s.view==='restore-confirm'){
    const h=c.history?.find(h=>h.id===s.historyId);if(!h)throw new ScheduleError('この履歴は保存上限などにより終了しました。履歴の一覧を開き直してください。');
    let available=true,reason='';try{scheduleRestoration(c,h.id);}catch(e){available=false;reason=e instanceof ScheduleError?e.message:'復元できません。';}
    const p=page(h.before,1,s.historyDetailPage);s.historyDetailPage=p.index;title=s.view==='restore-confirm'?'履歴から復元する内容を確認':'変更前後を確認';
    const snapshot=e=>`**${safe(e.title)}**\n${date(e)} · ${time(e)}\n色 ${e.color?scheduleColors[e.color].label:'自動'}${e.place?`\n場所 ${safe(e.place)}`:''}${e.description?`\n説明 ${safe(e.description)}`:''}`;
    body=`**${historyLabels[h.kind]} · ${h.before.length}件**\n<t:${Math.floor(h.at/1000)}:f> · ${p.index+1}/${p.count}件目\n\n${p.items.map(before=>{const after=h.after.find(e=>e.id===before.id);return h.kind==='restore'?`復元した内容：${snapshot(after)}`:`変更前：${snapshot(before)}\n\n変更後：${after?snapshot(after):'削除済み'}`;}).join('\n\n')}\n\n${available?'変更前の予定名・日時・場所・説明・色を復元します。予定IDは維持し、共有投稿も更新します。':safe(reason)}`;
    if(s.view==='restore-confirm')body+='\n\n表示している履歴の全件をまとめて復元します。復元操作そのものは履歴から取り消せません。';
    components=[row(button(s.view==='restore-confirm'?'restore-save':'restore-preview',s.view==='restore-confirm'?`この${h.before.length}件を復元`:'復元する内容を確認',ButtonStyle.Primary).setDisabled(!available),button('history-return','履歴の一覧へ')), ...(p.count>1?[row(button('history-detail-prev','前の予定').setDisabled(p.index===0),button('history-detail-next','次の予定').setDisabled(p.index===p.count-1))]:[]),back];
  }else if(s.view==='bulk-select'){
    title='日付を移動する予定を選ぶ';const all=bulkCandidates(s,c),b=s.bulk,p=page(all,25,b.page);b.page=p.index;
    body=`**現在の表示範囲・検索結果 ${all.length}件**\n選択 **${b.eventIds.length}/26件** · ${p.index+1}/${p.count}ページ\n\n選んだ予定を **${b.days>0?`${b.days}日後`:`${-b.days}日前`}** へ移動します。複数日・翌日終了の長さ、時刻・色は保ちます。\n\nページを移っても選択を保持します。「選択をすべて解除」で選び直せます。保存前に移動前後を確認してください。`;
    components=[...(p.items.length?[row(new StringSelectMenuBuilder().setCustomId(`schedule:${s.id}:${s.turn}:bulk-pick`).setPlaceholder('このページの移動対象を選ぶ（複数可）').setMinValues(0).setMaxValues(p.items.length).addOptions(...p.items.map(e=>({label:e.title,value:e.id,description:`${date(e)} · ${time(e)}`,default:b.eventIds.includes(e.id)}))))]:[]),row(button('bulk-days','移動する日数を変更'),button('bulk-clear','選択をすべて解除'),button('bulk-preview','移動前後を確認',ButtonStyle.Primary).setDisabled(!b.eventIds.length)),...(p.count>1?[row(button('bulk-prev','前の25件').setDisabled(p.index===0),button('bulk-next','次の25件').setDisabled(p.index===p.count-1))]:[]),back];
  }else if(s.view==='bulk-preview'){
    title='日付の一括移動を確認';const b=s.bulk,stage=s.bulkStage;if(!stage)throw new ScheduleError('移動前後を確認し直してください。');const p=page(stage.plan.changes,5,b.previewPage);b.previewPage=p.index;
    body=`**選択した ${stage.plan.changes.length}件 · ${stage.plan.days>0?`${stage.plan.days}日後`:`${-stage.plan.days}日前`}へ移動**\n${p.index+1}/${p.count}ページ\n\n${p.items.map(({before,after})=>`**${safe(short(before.title))}**\n${date(before)} → **${date(after)}** · ${time(after)}`).join('\n\n')}\n\n${stage.plan.overlaps?`選択外の既存予定と重なる移動先が **${stage.plan.overlaps}件** あります。\n`:''}全ページの選択分を1回で保存します。予定を複製せず、同じIDの日時を変更します。履歴が保持されている間は元の日付へ復元できます。`;
    components=[row(button('bulk-save',`この${stage.plan.changes.length}件を移動`,ButtonStyle.Primary),button('bulk-select','対象・日数を変更')), ...(p.count>1?[row(button('bulk-preview-prev','前の5件').setDisabled(p.index===0),button('bulk-preview-next','次の5件').setDisabled(p.index===p.count-1))]:[]),back];
  }else if(s.view==='conflicts'){
    title='予定の時間の重なり';const report=s.conflictReport;if(!report||report.revision!==c.revision)throw new ScheduleError('予定表が変更されました。重なりを確認し直してください。');const p=page(report.pairs,5,s.conflictPage);s.conflictPage=p.index;
    body=`**予定表全体 · 重なり ${report.total}組**\n${p.index+1}/${p.count}ページ${report.total>100?' · 先頭100組を表示':''}\n\n${p.items.map(([a,b])=>{const first=c.events.find(e=>e.id===a),second=c.events.find(e=>e.id===b);return `${eventLine(first)}\n↳ ${safe(short(second.title))} · ${date(second)} · ${time(second)}`;}).join('\n\n')||'時間が重なる予定は見つかりませんでした。'}\n\n終日はその日全体、終了時刻未指定は開始時刻だけとして比較します。終了と次の開始が同時なら重なりません。場所・参加者の重複を判定するものではありません。`;
    components=[...(p.items.length?[row(new StringSelectMenuBuilder().setCustomId(`schedule:${s.id}:${s.turn}:conflict-event`).setPlaceholder('このページの予定を開いて確認・編集').addOptions(...[...new Set(p.items.flat())].map(id=>{const e=c.events.find(v=>v.id===id);return {value:id,label:e.title,description:`${date(e)} · ${time(e)}`};})))]:[]),row(button('conflicts','重なりを再確認',ButtonStyle.Primary),...(p.count>1?[button('conflicts-prev','前の5組').setDisabled(p.index===0),button('conflicts-next','次の5組').setDisabled(p.index===p.count-1)]:[])),back];
  }
  return payload(title,intro+body,{components});
}
