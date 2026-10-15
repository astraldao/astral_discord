# 開発・運用の引き継ぎ

2026-10-14 時点。調査基準は `main` の `35520e121d7c156f880fa8bb2adcbbee105c7551`（v3.24.0）。
この文書はコードと既存ドキュメントから確認した内容をまとめる。本番の稼働確認とは区別する。

## 更新先と検証

- 正式な更新先は https://github.com/astraldao/astral_discord 。
- 依頼された変更はこのリポジトリにコミットし、変更内容・検証結果・コミットを報告する。
- 開発環境は Node.js 24.17.0 以上。検証前に `npm ci`、変更後に `npm run check` と `npm test` を実行する。
- `npm run check` は構文とコード実行ポリシーの検査。開発依存の acorn が必要。
- CI は `.github/workflows/check.yml`。Node.js 24 で依存導入・検査・テストを実行する。
- 実機確認は自動テストと分けて記録する。Discordの表示・音声・Quaxlyの容量や接続はテストだけでは確認できない。

## 構成

| 役割 | 主なファイル |
|---|---|
| 起動・環境設定読込 | `index.js` |
| Discord初期化・イベント・VC入室処理 | `src/index.js` |
| バックアップ読み上げ | `src/backup-reader.js`、`src/backup-playback.js`、`src/backup-audio.js`、`src/persistent-voice.js`、`scripts/backup-synthesize.py` |
| コマンド登録 | `src/commands.js` |
| 管理画面・設定・診断 | `src/admin.js`、`src/settings.js`、`src/diagnostics.js` |
| 音声生成・再生・入室待ち | `src/speech.js`、`src/audio.js`、`src/queue.js` |
| TRPG・キャラシ・卓セット | `src/trpg-store.js`、`src/trpg-ui.js`、`src/iachara.js` |
| 伝助・予定表 | `src/densuke*.js`、`src/schedule-*.js`、`src/calendar-image.js` |
| ゲーム・チップ台帳 | `src/blackjack*.js`、`src/casino*.js`、`src/game-wallets.js`、`src/chip-*.js` |
| 自動更新・プロセス監督 | `scripts/auto-update.js`、`scripts/supervisor.js`、`src/update-lifecycle.js` |

現行コマンドは `/vc`（入室）、`/game`（ゲーム・チップ）、`/read`（バックアップ読み上げ）、管理者専用の `/admin`。
v3.24.1で `/chips` を `/game → 自分のチップ` に統合した。
単一のDiscordサーバーを `GUILD_ID` で指定する。外部DBは使わずJSONへ保存する。

## 起動と保存データ

- 必須設定は `DISCORD_TOKEN` と `GUILD_ID`。`DENSUKE_EMAIL` はDiscordで宛先を設定するまでの予備値。
- ローカルの起動入口は `npm start`。Quaxlyへの導入コマンドと音声環境の要件は [README.md](README.md) を参照する。
- 音声は同じサーバー上のVOICEVOX Coreを利用する。Python 3.10以上など追加の実行環境が必要。
- `data/settings.json`：VC・音声・辞書・伝助などの設定。
- `data/personal-readings.json`：本人用の読み方。
- `data/trpg.json`：卓・パネル・PCとTXTの控え。
- `data/schedules.json`：予定表・予定・投稿情報。
- `data/game-wallets.json`：チップ残高・履歴・集計・管理者調整記録。
- `.env`、`data/`、音声環境、更新用の作業ファイルはGit管理対象外。トークンや実データをコミットしない。
- データ形式を変える場合は旧データからの移行と復元を確認する。チップ台帳v2を旧版へ戻す際は対応する旧データも必要。

## mainへの反映と手動更新（v3.26以降）

mainへのコミットだけではBotを更新しない。管理者が `/admin → バージョン管理` で現在の版・更新候補を確認し、確認画面から手動で適用する。更新確認は30秒以内の連続取得を抑え、確認から10分以内の同じSHAだけを実行する。
更新中はdndを表示し、取得・検証後、処理やゲームが進行中なら切り替えを見送る。終了後に管理者が再実行する。初期化失敗では保存データと旧版を復元する。

旧版の常駐プロセスはワーカー更新の対象外なので、v3.25以前からの移行にはREADMEのStartup CommandでQuaxlyを一度再起動・再導入する必要がある。移行済みの起動スクリプトはホスティング再起動時に保存済みの版を起動し、自動更新しない。
旧ASTRAL_AUTO_UPDATE・ASTRAL_UPDATE_INTERVALは使用しない。VOICEVOXと常駐プロセス自身の刷新は再導入で扱う。
更新後は稼働版、`/admin → 動作診断`、変更した機能を確認する。診断は音声生成・再生の試験ではない。

## 引き継ぎ時点の確認状況

- リポジトリの読み取り・書き込み権限を確認済み。
- v3.24.0の [CI実行](https://github.com/astraldao/astral_discord/actions/runs/38576162443) は `npm ci` の `ECONNRESET` で失敗。コード検査とテストはスキップされており、コード不具合の有無はこの実行から判断できない。
- 本番のQuaxly接続情報・Discordトークンはこの作業環境に設定されていない。本番の稼働版、音声、実画面、保存データは未確認。
- 通常のgit cloneは作業環境のプロキシ接続エラーで失敗したため、調査にはGitHub連携を利用した。手元の取得ファイルは完全なcloneではない。

詳細な利用方法は [README.md](README.md)、既存の仕様と経緯は [ROADMAP.md](ROADMAP.md)、権限・公開範囲・外部取得の制約は [SECURITY.md](SECURITY.md) を参照する。

## v3.28 バックアップ読み上げ

`ASTRAL_BACKUP_TTS=1` とDeveloper PortalのMessage Content Intentが必要。変更後は再起動する。`/read start` の元チャンネルから本人の参加VCへ、本文50文字＋「以下略」をFIFO再生する。最大8件待機、実行者の移動・権限失効・音声障害で停止。本文・生成音声の永続保存はしない。入室告知と音声接続を共用するため同時実行せず、読み上げ中は手動更新も見送る。
常駐Pythonは固定モデルのずんだもんstyle3。最初の2モーラから段階的に合成・再生する。`npm run backup-voice-benchmark` は合成のみの計測で、300ms以内の実際の読み上げ開始を保証しない。開発環境12回の中央値298ms・最大420ms。Discord実機の検証は未実施。詳細な導入方法・待ち行列・計測範囲はREADMEを参照する。

## v3.29 読み上げの並行処理と操作手順

`streamBackupSpeech` が権限確認とネイティブ合成を並行実行し、確認完了後だけ一本のPCMストリームをプレイヤーへ渡す。文章ごとに1リソースとして再生し、従来の分割ごとの100msの末尾無音を削減。合成の短い遅れは最大3秒まで待ち、途中でリソースが終了したら停止扱いにする。中断は保留中の権限確認も待たずに終了する。
準備中も停止でき、停止後は開始ボタンから再開できる。停止ボタンはセッションIDに固定し、前回の画面から新しいセッションを止めない。状態更新・遅延内訳・固定の手順リンクを追加。診断は起動設定・使用中の真偽値だけを公開し、Portal設定の検査や音声試験は行わない。手動更新は読み上げ中なら取得開始前に停止を案内し、切り替え前のbusy判定も維持する。
`npm run backup-playback-benchmark` は実モデル・Opus・200msの模擬権限確認を使い、Discordには接続しない。CPU2コア、各方式6回で開始中央値499→274ms、最大695→283ms。[操作・復旧・検証条件](docs/BACKUP_VOICE.md) と保存した計測JSONを参照。

元チャンネル・接続先VCの削除で自動停止する。停止の開始者・管理者確認は継続しつつ、停止だけはソース閲覧権限を要求しない。チャンネルが消えた後も停止・更新へ復旧でき、停止結果に接続先やメトリクスを含めない。状態表示には引き続きソース閲覧権限が必要。
