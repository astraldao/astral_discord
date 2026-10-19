# 音声配布物の検証

v3.40.1以降の `setup-voicevox.sh` は、新しくダウンロードする次の配布物を、リポジトリに固定したSHA-256と正確なサイズで照合します。照合前に展開・Pythonへの導入・モデルの置き換えは行いません。

| 配布物 | 固定版 | サイズ（bytes） |
|---|---|---:|
| CPUランタイム Linux x64 | 1.23.2 | 8,214,849 |
| CPUランタイム Linux arm64 | 1.23.2 | 7,313,378 |
| Core wheel Linux x64 | 0.17.0 | 1,820,106 |
| Core wheel Linux arm64 | 0.17.0 | 1,836,906 |
| ずんだもんモデル `0.vvm` | 0.17.0 | 59,308,488 |
| Open JTalk UTF-8標準辞書 | 1.11 | 23,643,819 |

SHA-256の固定値は [voice_assets.py](../scripts/voice_assets.py) にあります。2026-10-19、GitHub配布5件は次のRelease APIのdigestとsizeを確認しました。Core・ランタイムの4配布物は実ダウンロードした内容とも一致し、モデルは開発環境の実ファイルとも一致しました。

- [VOICEVOX Core 0.17.0](https://api.github.com/repos/VOICEVOX/voicevox_core/releases/tags/0.17.0)
- [VOICEVOX CPUランタイム 1.23.2](https://api.github.com/repos/VOICEVOX/onnxruntime-builder/releases/tags/voicevox_onnxruntime-1.23.2)
- [VOICEVOX VVM 0.17.0](https://api.github.com/repos/VOICEVOX/voicevox_vvm/releases/tags/0.17.0)

標準辞書は、[SourceForgeのOpen JTalk配布](https://sourceforge.net/projects/open-jtalk/files/Dictionary/open_jtalk_dic-1.11/)をHTTPSで実取得してサイズとSHA-256を計算しました。独立した配布者署名を検証したものではありません。pyopenjtalk-plusの拡張辞書は、従来どおり `setup-dictionaries.py` の固定SHA-256で検証します。

## 検証に失敗した場合

スクリプトは導入を停止します。失敗した配布物の `.part` を展開せず、既存モデルや導入済みライブラリへ置き換えません。通信が途中で切れた可能性もあるため、一度再取得して確認してください。繰り返し失敗する場合は、配布元とこのリポジトリの固定情報を確認します。照合を無効にして導入を続ける必要はありません。

取得はHTTPS、転送先もHTTPSに限定します。curlへ正確なサイズ上限を渡し、検証も最大で期待サイズ＋1バイトだけを読みます。Content-Lengthがない場合のダウンロード中の上限適用はcurlの版に依存します。その場合も、導入前の正確なサイズ・ハッシュ照合は省略しません。

## 対象外と既存環境

通常のBot更新では、導入済みVOICEVOXを再取得・再インストールしません。既存のインストール済みマーカーの扱いも変えないため、過去に導入したファイルを今回さかのぼって検証するものではありません。署名検証、OS・ホストの検査、第三者が書き換えられる実行環境の隔離も対象外です。

固定値を更新する場合は、配布元の変更内容・正確なURL・サイズとハッシュを確認して、コード変更としてレビューします。自動的に新しいハッシュを採用する処理はありません。
