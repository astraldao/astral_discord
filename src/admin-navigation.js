export const adminCategories=[
  {id:'schedule',label:'予定・卓',description:'予定表、卓とキャラシ、日程調整',actions:[['open-schedule','予定表','共有カレンダーの作成・予定の編集'],['open-trpg','卓・キャラシ','卓の登録・PCの確認'],['open-densuke','日程調整','伝助の作成・回答URLの共有']]},
  {id:'voice',label:'入室・音声',description:'ロビー、入室先、ずんだもん、入室パネル',actions:[['nav-vc','VC設定','ロビー・行き先・待機時間'],['nav-audio','音声設定','参加告知・音量・読み方辞書'],['nav-panel','入室パネル','ロビーに入室用のパネルを設置']]},
  {id:'appearance',label:'外観・投稿',description:'Botのバナー、フォーラムの投稿タグ',actions:[['open-banner','Botのバナー','画像のアップロード・適用・解除'],['open-forum','投稿タグ','フォーラムのタグを整理']]},
  {id:'operations',label:'運用・管理',description:'手動更新、再起動、診断、起動設定',actions:[['open-updates','バージョン管理','現在版・最新版の確認と手動更新'],['diagnose','動作診断','音声ファイルと必要な権限を確認'],['open-security','脆弱性診断','依存パッケージの既知の勧告を確認'],['open-servers','サーバー連携','サブ導入・構成コピー・スレッド同期'],['open-chips','チップ管理','残高の確認・調整・履歴'],['nav-overview','設定を確認','設定値・入室先・ダイス返信のON/OFF'],['open-runtime','ENV・起動設定','読み上げの有効化・合成スレッド数'],['open-restart','Botを再起動','現在の版で再接続・起動設定を反映']]},
];

export const adminDestinations=adminCategories.flatMap(category=>category.actions.map(([action,label,description])=>({action,label,description,category:category.id,categoryLabel:category.label})));
