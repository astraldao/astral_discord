import {selectedScheduleEvents} from './schedule-query.js';
const choice=(value,label,description)=>({value,label,description});
export function scheduleActions(s,calendar){
  const admin=s.scope==='admin';
  if(s.view==='organize'&&admin)return [choice('bulk-open','日付をまとめて移動','表示範囲から対象を選び、移動前後を確認する'),choice('history','変更履歴・復元','編集・削除前の内容を確認する'),choice('conflicts','時間の重なりを確認','予定表全体を確認する'),choice('tools','検索・整理へ','検索・ICS・共有の操作へ戻る')];
  if(s.view==='list')return [
    ...(admin?[choice('new-event','予定を追加','予定名・日時を入力する')]:[]),
    ...(!s.query?[choice('search','予定を検索','予定名・場所・日付などで探す')]:[]),
    choice('days','日付から探す','日付と予定件数から選ぶ'),choice('day-today','今日の予定','日本時間の今日を開く'),
    ...(!s.query&&!['week','upcoming'].includes(s.period)?[choice('month-jump','月を指定','表示する年月を入力する')]:[]),
    ...(s.date&&!s.query?[choice('day-clear','月全体に戻る','選択日の絞り込みを解除する')]:[]),
    choice('tools',admin?'検索・整理':'検索・取り出し','ICS保存や予定表の操作を開く'),
  ];
  if(s.view==='event')return [choice('export-event','この予定だけ保存（ICS）','端末のカレンダー用に取り出す'),...(admin?[
    choice('copy-event','複製して編集','元の予定を残して新しく追加する'),choice('repeat','繰り返して追加','日付と追加件数を確認する'),choice('event-history','この予定の履歴','変更前後と復元の可否を確認する'),
    ...(s.conflictReport?.calendarId===calendar.id?[choice('conflicts-return','重なりの一覧へ','修正後の重なりを再確認する')]:[]),choice('delete-event','予定を削除…','次の画面で削除を確認する'),
  ]:[])];
  if(s.view==='tools')return [
    ...(selectedScheduleEvents(calendar,s).length?[choice('export','カレンダーファイルを作る','表示範囲の全ページをICSで保存する')]:[]),
    ...(s.query?[choice('search-clear','検索を解除','元の表示範囲へ戻る')]:[]),
    ...(admin?[choice('organize','整理・復元','一括移動・履歴・時間の重なり'),choice('import','ICSファイルから取り込む','ファイルを選び、追加前に確認する'),choice('publish','チャンネルに送る（月表示）','送信先と内容を確認する'),choice('publications','投稿を管理','共有投稿の更新・復旧・停止'),choice('rename','予定表の名前を変更','新しい名前を入力する'),choice('home','予定表の管理へ','別の予定表を選ぶ')]:[]),
  ];
  if(s.view==='days')return [choice('days-toggle',s.dayPicker?.onlyEvents?'すべての日を表示':'予定がある日だけ','日付の選択欄を切り替える'),choice('day-today','今日を開く','日本時間の今日を選ぶ'),choice('day-jump','日付を入力','年月日を指定して開く')];
  return [];
}
