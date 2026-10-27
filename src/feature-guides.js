import {adminDestinations} from './admin-navigation.js';

// Only static instructions and allowlisted entry actions; never runtime settings.
export const adminGuides={
  'open-servers':{prepare:'同じBotをサブへ招待し、両サーバーで管理者権限を用意します。',steps:'サブを登録 → 構成コピーのプレビュー → 実行。同期は元/先チャンネルを指定し、公開範囲を確認します。',effect:'設定と台帳はサーバーごとに分離します。コピーは追加型、同期はメインからサブへの片方向です。',recovery:'結果不明時は再送せず停止します。状態と対応表を確認してください。通常の再起動後は権限と最近の差分を確認して再開します。',doc:'SERVER_NETWORK.md'},
  'open-schedule':{prepare:'確定した予定を登録します。候補日への回答集めは「日程調整」です。',steps:'予定表を選ぶ → 予定を追加 → 日時・名前を入力。共有するときは検索・整理から送信先を確認します。',effect:'保存で予定表と共有投稿へ反映します。削除や日付移動は確認画面から確定します。',recovery:'文字が小さいときは月の一覧。省略した予定は日付から確認できます。',doc:'CALENDAR.md'},
  'open-trpg':{prepare:'卓・シナリオ・PCをまとめます。PCの公開範囲と設置先を確認してください。',steps:'卓を作る → シナリオ・PCを選ぶ → 設置先と投稿内容を確認します。',effect:'パネルを設置するとチャンネルへ投稿します。登録したPCはパネルの公開範囲に従うため、秘匿/共有と設置先を確認してください。',recovery:'元の投稿を確認し、投稿結果が不明な場合は復旧を使ってください。再設置を繰り返さないでください。',doc:'TRPG.md'},
  'open-densuke':{prepare:'候補日を1行に1件用意します。確定した予定の管理は「予定表」です。',steps:'回答の選択肢 → イベント名と候補日 → 内容確認 → 伝助を作成 → 回答用URLを共有します。',effect:'作成で外部サービスへ送信します。共有ボタンでは回答用URLだけを投稿し、編集用URLとパスワードは公開しません。',recovery:'結果が不明なら控えメールを確認し、作成済みURLを登録します。自動再作成はしません。',doc:'DENSUKE.md'},
  'nav-vc':{prepare:'待機するロビーVCと、移動先の通常VCを用意します。',steps:'ロビーを設定 → 入室先を追加 → 待機秒数と直接入室の扱いを確認します。',effect:'設定は保存後すぐに反映します。待機中の入室予約があれば取消の確認が出ます。',recovery:'入室できないときは動作診断で閲覧・接続・移動の権限を確認します。',doc:'COMMANDS.md'},
  'nav-audio':{prepare:'参加告知とチャットの読み上げは別機能です。音量は共通です。',steps:'参加告知のON/OFFと音量を設定。名前の読みは辞書、本人だけの設定は /menu → 自分の読み方です。',effect:'保存後すぐに反映します。バックアップ読み上げの有効化はENV・起動設定から行います。',recovery:'音が出ないときは動作診断。処理の遅さは音声速度の測定で確認できます。',doc:'BACKUP_VOICE.md'},
  'nav-panel':{prepare:'先にVC設定でロビーを設定し、Botへ送信・埋め込み・履歴の権限を付けます。',steps:'設置先を確認 → 入室パネルを設置。設置済みなら同じメッセージを更新します。',effect:'操作するとロビーVCのチャットへ公開投稿します。ロビー変更前のパネルは手動で削除してください。',recovery:'投稿できないときは設置先の権限と元のメッセージを確認します。',doc:'COMMANDS.md'},
  'open-banner':{prepare:'PNG・JPEGを1枚用意します。4MiB以内、横長600×240px以上を推奨します。',steps:'画像を選ぶ → 現在と候補のプレビュー → この画像を適用します。',effect:'Bot全体のプロフィールへ反映します。このサーバーだけの設定ではありません。',recovery:'結果が不明なら「現在を確認」。未適用の候補はメニューを移動しても有効期限内は再開できます。',doc:'BANNER.md'},
  'open-forum':{prepare:'このサーバーのフォーラム投稿リンクと、利用可能なタグを用意します。',steps:'投稿リンクを入力 → タグを1つずつ順番に選ぶ → この順番で設定します。',effect:'対象投稿のタグを変更します。Discord画面の表示順は強制できません。',recovery:'結果に表示されるAPIの順番と実際の投稿を確認します。タグがない場合は先にフォーラムへタグを作成してください。',doc:'COMMANDS.md'},
  'open-updates':{prepare:'読み上げやゲームなどを終えてから実行します。更新は自動で適用しません。',steps:'更新を確認 → 現在版・候補・容量を比較 → 更新内容を確認 → この版に更新します。',effect:'取得・検証後にBotを再接続します。更新中はdnd、進行中の操作があれば見送ります。',recovery:'更新後は /admin を開き直して稼働版を確認してください。容量の未確認項目は実測値ではありません。',doc:'UPDATE_CAPACITY.md'},
  'diagnose':{prepare:'権限・設定・音声の準備状況を確認します。開くだけでは音声を合成しません。',steps:'動作診断 → 気になる項目の対処手順。速度は「速度を測る」で別途開始します。',effect:'診断と測定は別操作です。測定は固定文の合成と変換を行い、VCへ音声を送りません。',recovery:'停止理由と直近の結果を確認し、必要な設定へ戻れます。ホスト負荷とCPU割当も合わせて判断してください。',doc:'DIAGNOSTICS.md'},
  'open-security':{prepare:'既知の依存パッケージの勧告を確認します。サーバー全体の侵入試験ではありません。',steps:'診断を開始 → 本番/開発などで絞り込み → 詳細・JSONを確認します。',effect:'操作時だけ公開パッケージ情報を照会します。自動修正や自動更新は行いません。',recovery:'取得失敗は診断結果と区別します。修正版の適用はバージョン管理から手動で行います。',doc:'SECURITY_SCAN.md'},
  'open-chips':{prepare:'対象の人と理由を確認します。進行中のブラックジャックの終了後に調整します。',steps:'人を選ぶ → 残高・履歴を確認 → 追加/減額/指定 → 枚数と理由 → 確認して保存します。',effect:'確定すると残高と調整履歴へ反映します。譲渡は /menu のチップ画面から行えます。',recovery:'履歴の取得時刻を確認し、最新の内容が必要なら更新してください。',doc:'COMMANDS.md'},
  'nav-overview':{prepare:'現在のVC・音声・辞書・ダイス設定を確認できます。',steps:'設定値を確認します。チャットダイスのON/OFFもこの画面で変更できます。',effect:'通常の設定は再起動不要です。ダイスの通常投稿対応にはDiscord側のIntent設定も必要です。',recovery:'ONなのに反応しないときは @Bot 1D100 を試し、動作診断で読取範囲を確認してください。',doc:'DICE.md'},
  'open-runtime':{prepare:'起動時に読む設定だけを扱います。トークンは表示・編集しません。',steps:'項目を選ぶ → 値を入力 → 稼働中と次回起動時を比較 → 保存 → Botを再起動します。',effect:'保存だけでは稼働中の値は変わりません。空欄で外部設定・既定値へ戻します。',recovery:'再起動に失敗した場合は直前の起動設定への復旧を試みます。',doc:'RESTART.md'},
  'open-restart':{prepare:'読み上げ・VC移動・ゲームを終了してください。',steps:'稼働中と次回の起動設定を確認 → 再起動を確認 → 再起動します。',effect:'現在の版で再接続し、保存済みの起動設定を反映します。新しい版の取得はしません。',recovery:'進行中の処理があれば見送ります。終了後にもう一度確認し、完了後は /admin を開き直してください。',doc:'RESTART.md'},
};
export const adminGuideFor=action=>adminDestinations.some(d=>d.action===action)&&Object.hasOwn(adminGuides,action)?adminGuides[action]:null;
export function adminGuideDescription(action){
  const guide=adminGuideFor(action);return guide?`**使う前に**\n${guide.prepare}\n\n**手順**\n${guide.steps}\n\n**反映・保存**\n${guide.effect}\n\n**困ったとき**\n${guide.recovery}`:'操作を選ぶと、準備・手順・反映のタイミングを確認できます。\n\nガイドを開くだけでは設定の保存・投稿・更新・再起動は行いません。';
}
