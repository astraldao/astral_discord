# AGENTS.md — AIエージェント共通の作業ガイド

このリポジトリは Codex と Claude Code の両方で開発する。どちらのエージェントもまずこのファイルを読む。
（Claude Code は `CLAUDE.md` 経由でこのファイルを読み込む。共通ルールはここだけに書き、`CLAUDE.md` に重複させない。）

## プロジェクト概要

- メイン（`GUILD_ID`）＋登録済みサブ1件に対応するBot「astral-voice-lobby」。現行 v7.1.3。
- 主な機能：VC入室読み上げ（VOICEVOX Core）、バックアップ読み上げ、予定表・カレンダー画像・ICS、伝助（日程調整）、TRPG卓・キャラシパネル、ゲーム・チップ台帳、チャットダイス、画像工房、管理画面（更新・再起動・診断・脆弱性診断）。
- コマンドは `/menu`（利用者）と `/admin`（管理者）の2つだけ。新しいスラッシュコマンドは増やさず、既存メニューに統合する方針。
- 外部DBなし。保存は `data/*.json`。本番ホストは Quaxly。mainへのpushだけでは本番は更新されず、管理者が `/admin → バージョン管理` から手動適用する。

## セットアップと検証（変更後は必ず実行）

```sh
npm ci            # acorn（devDependency）が check に必要
npm run check     # 構文 + コード実行ポリシー検査（scripts/check.js, scripts/security.js）
npm test          # node --test test/*.test.js（2026-10-28時点 1445件すべて成功）
python3 test/voice-assets.test.py && python3 test/backup-query.test.py   # Python側（音声資産・バックアップ検索）
npm audit         # 2026-10-28時点 0件
```

- `package.json` の engines は Node.js >= 24.17.0（CI は Node 24）。Node 22 でも check/test は通るが、正式な検証は Node 24 で行う。
- CI：`.github/workflows/check.yml`（push/PRで `npm ci` → `npm run check` → `npm test`）。
- Discordの実表示・音声・Quaxly上の動作は自動テストでは確認できない。報告では「自動テストで確認」と「実機未確認」を必ず分けて書く。

## 守るべき制約

- **コード実行ポリシー**：`eval` / `Function` / `exec` / `execSync` / `vm` / 動的 `import()` パス / `shell: true` は `npm run check` で拒否される。子プロセスは `spawn`/`execFile` 系＋引数配列で。
- **秘密情報**：`.env`、`data/`、トークン、実データはコミットしない（`.gitignore` 済み）。ログやDiscordの返信に秘密情報や内部例外文を出さない。
- **権限の再確認**：保存・投稿・更新の直前（保存キュー内）で、本人／チャンネル／管理者権限／操作の有効期限・世代を再確認するのが既存パターン。新しい操作もこれに合わせる。詳細は `SECURITY.md`。
- **結果不明時は自動再送しない**：Discord投稿・伝助作成などで結果が不明な場合は重複防止のため停止し、復旧導線を出す。
- **データ形式の変更**：旧データからの移行・復元を必ずテストで確認する。依存・ENV・保存形式・コマンドを増やす場合はドキュメントに明記する。
- **ゲームのエラー表示**：ゲーム・チップの返信は `gameErrorMessage()` を通す。`GameError` はBot内で定義した固定の案内だけに使い、SDK/ファイルシステム等の `error.message` を `GameError` に包んで公開しない。
- **依存はバージョン固定**（`package.json` は完全一致指定、Actions はSHA固定）。

## コードスタイル

- ESM（`"type": "module"`）、Node標準 `node:` 接頭辞、依存は最小（discord.js / @discordjs/voice / opusscript / parse5 / sharp）。
- 既存コードは1行が長めの密な書き方で、コメントは少なく「なぜ」だけを書く。周辺コードの書き方・命名に合わせる。
- UI文言・ドキュメントは日本語。コミットメッセージは英語の Conventional Commits（`feat:` `fix:` `docs:` `security:` `perf:` `refactor:`）。
- テストは `node:test`＋`node:assert`。新機能・修正には `test/*.test.js` を追加する。
- 画面の見た目は [docs/DESIGN.md](docs/DESIGN.md) の規則に従う。カードは各ファイル先頭の `const {payload}=themed('<機能>')` で作り、`EmbedBuilder` を直接使わない。ボタンの色・矢印は文言から自動で揃うため、文言を規則に合わせる。

## 構成の早見表

| 役割 | 主なファイル |
|---|---|
| 起動・プロセス監督 | `index.js` → `scripts/supervisor.js` → `src/index.js`（`--worker`） |
| コマンド・メニュー・操作の振り分け | `src/commands.js`、`src/main-menu.js`、`src/menu-catalog.js`、`src/interaction-routing.js`、`src/feature-guides.js` |
| 複数サーバー・コピー・同期 | `src/guild-runtime.js`、`src/server-network*.js`、`src/server-copy*.js`、`src/thread-mirror.js`、`src/shared-bot-resources.js` |
| 管理画面・設定・診断 | `src/admin.js`、`src/admin-navigation.js`、`src/settings.js`、`src/diagnostics.js`、`src/security-scan.js` |
| 音声・入室 | `src/speech.js`、`src/audio.js`、`src/queue.js`、`src/opus-*.js`、`scripts/synthesize.py` |
| バックアップ読み上げ | `src/backup-*.js`、`src/persistent-voice.js`、`scripts/backup-synthesize.py` |
| 予定表・カレンダー | `src/schedule-*.js`、`src/calendar-image.js`、`src/shared-schedule-ui.js` |
| 伝助 | `src/densuke*.js`（HTML解析は Worker に隔離） |
| TRPG | `src/trpg-*.js`、`src/iachara.js` |
| ゲーム・チップ | `src/blackjack*.js`、`src/casino*.js`、`src/baccarat.js`、`src/four*.js`、`src/rps*.js`、`src/game-*.js`、`src/chip-*.js` |
| 画像工房 | `src/image-workshop-*.js`、`scripts/image-workshop-worker.js`（sharpは専用プロセス内だけで使用） |
| チャットダイス | `src/chat-dice.js`、`src/dice-request.js`、`src/dice-expression.js`、`src/dice-evaluate.js`、`src/dice-expression-ui.js`、`src/roll-route.js`、`src/roll-ui.js` |
| 更新・再起動 | `scripts/manual-update.js`、`scripts/auto-update.js`、`scripts/manual-restart.js`、`src/update-*.js`、`src/restart-ui.js` |

メインの保存先は既存の `data/*.json`、サブは `data/guilds/<ID>/*.json`。連携/対応表/処理記録は `data/server-network.json`。Bot内データをサーバー間で共有せず、全体設定にはメイン側の管理者も必要。未知のサーバーは動作させない。

保存データ：`data/settings.json`、`data/personal-readings.json`、`data/trpg.json`、`data/schedules.json`、`data/game-wallets.json`。

## ドキュメントの役割

| ファイル | 内容 |
|---|---|
| `AGENTS.md`（このファイル） | エージェント向けの作業ルール・入口。短く保つ |
| `HANDOVER.md` | 開発・運用の引き継ぎ。冒頭に現状、以降は版ごとの実装・検証記録（追記型） |
| `README.md` | 利用者・管理者向けの使い方、Quaxly導入手順 |
| `ROADMAP.md` | 採用機能と経緯 |
| `SECURITY.md` | 権限・公開範囲・外部取得の制約と確認記録 |
| `docs/COMMANDS.md` | 操作早見表。機能別は `docs/*.md`、版別ガイドは `docs/V*.md` |

## リリース時の慣例

機能追加で版を上げる場合は、同じコミットで次をそろえる：
1. `package.json` / `package-lock.json` の `version`
2. `HANDOVER.md` 末尾に `## vX.Y.Z 見出し` の節（変更点・維持した制約・検証件数・実機未確認の範囲）
3. `README.md` 冒頭付近に `## vX.Y · 見出し` の節、必要なら `docs/VX_Y.md` と機能別 `docs/*.md`

## エージェント間の引き継ぎルール

- Codex・Claude Code とも `main` へ直接コミット・pushしてよい（オーナー承認済み）。push前に `git pull --rebase origin main` で相手の変更を取り込み、`npm run check` と `npm test` を通してから push する。
- 作業ブランチ・コミット・検証結果は必ず `HANDOVER.md` に残す（チャット履歴は相手のエージェントから見えない）。
- 作業環境固有のパス（例：`/workspace/...`、`/tmp/...`）はリポジトリに残らないので、成果物として参照させない。必要なものはリポジトリ内に置くか、架空データで再生成できる手順を書く。
- 生成デザインツールや外部サービスに接続できなかった場合は、その旨と代替手段を記録する（既存記録に倣う）。
- **新しいユーザープロンプトを受け取るたび**（作業中の追加指示も含む）にリモートを取得し、mainの更新履歴・差分と `HANDOVER.md` 冒頭を確認する。未コミットの変更を破棄・自動stashせず、他者の変更を保って取り込む。作業ツリーがクリーンなら `git pull --rebase origin main`、変更中ならまず `git fetch origin main` で確認し、安全に統合してから続行する。
- 着手前に `git log --oneline -10` と `HANDOVER.md` 冒頭「現在の状況」を確認し、相手の未完了作業と衝突しないようにする。
