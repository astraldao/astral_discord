#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Python 3.10以上が必要です。このNode.jsイメージでPythonを使えるかホストに確認してください。' >&2
  exit 1
fi
python3 -c 'import sys; assert sys.version_info >= (3,10), "Python 3.10以上が必要です"'
case "$(uname -m)" in
  x86_64) vv_arch=x64; vv_wheel=manylinux_2_34_x86_64 ;;
  aarch64) vv_arch=arm64; vv_wheel=manylinux_2_34_aarch64 ;;
  *) echo 'このセットアップはLinux x64/arm64向けです。' >&2; exit 1 ;;
esac
for vv_tool in curl tar; do
  command -v "$vv_tool" >/dev/null 2>&1 || { echo "必要なコマンドがありません: $vv_tool" >&2; exit 1; }
done
python3 scripts/setup-dictionaries.py
vv_version=0.17.0
mkdir -p voicevox/onnxruntime voicevox/dict voicevox/models/vvms voicevox/.downloads
fetch() {
  echo "取得中: $1"
  vv_max_bytes=$(python3 scripts/voice_assets.py size "$4")
  if ! curl -fL --proto "=https" --proto-redir "=https" --max-filesize "$vv_max_bytes" --retry 2 --retry-delay 2 --connect-timeout 15 --max-time 300 --speed-time 45 --speed-limit 1024 "$2" -o "$3.part"; then
    echo "ダウンロード失敗: $1。HTTPS接続と上のエラーを確認してください。" >&2
    exit 1
  fi
  python3 scripts/voice_assets.py verify "$4" "$3.part"
  mv "$3.part" "$3"
}
echo 'VOICEVOX Core・音声モデルの利用条件: https://github.com/VOICEVOX/voicevox_core/blob/0.17.0/docs/guide/user/usage.md'
echo 'ここでは入力を待ちません。公式配布ファイルを直接取得します。'
if [ ! -f voicevox/onnxruntime/.installed-1.23.2 ]; then
  fetch 'CPUランタイム 1.23.2' "https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-1.23.2/voicevox_onnxruntime-linux-$vv_arch-1.23.2.tgz" voicevox/.downloads/runtime.tgz "runtime-$vv_arch"
  tar --no-same-owner -xzf voicevox/.downloads/runtime.tgz -C voicevox/onnxruntime --strip-components=1
  touch voicevox/onnxruntime/.installed-1.23.2
fi
if [ ! -f voicevox/dict/.installed-1.11 ]; then
  fetch '日本語辞書 1.11' 'https://downloads.sourceforge.net/open-jtalk/open_jtalk_dic_utf_8-1.11.tar.gz' voicevox/.downloads/dict.tgz dictionary
  tar --no-same-owner -xzf voicevox/.downloads/dict.tgz -C voicevox/dict
  touch voicevox/dict/.installed-1.11
fi
if [ ! -f voicevox/models/.installed-0.17.0 ]; then
  fetch 'ずんだもん音声モデル 0.17.0' "https://github.com/VOICEVOX/voicevox_vvm/releases/download/$vv_version/0.vvm" voicevox/models/vvms/0.vvm model
  python3 -c 'import zipfile; zipfile.ZipFile("voicevox/models/vvms/0.vvm").testzip() is None or exit(1)'
  touch voicevox/models/.installed-0.17.0
fi
echo 'Python環境を準備中'
if [ ! -x .voicevox-venv/bin/python ]; then
  if ! python3 -m venv --without-pip .voicevox-venv; then
    echo 'Pythonのvenvが利用できません。ホストにpython3-venv対応を確認してください。' >&2
    exit 1
  fi
fi
if ! .voicevox-venv/bin/python -c 'import voicevox_core; from importlib.metadata import version; assert version("voicevox_core")=="0.17.0"' 2>/dev/null; then
  vv_filename="voicevox_core-$vv_version-cp310-abi3-$vv_wheel.whl"
  fetch 'Python音声ライブラリ 0.17.0' "https://github.com/VOICEVOX/voicevox_core/releases/download/$vv_version/$vv_filename" "voicevox/.downloads/$vv_filename" "core-$vv_arch"
  # This pinned wheel has no third-party Python dependencies or .data files.
  # Unpack it into this private venv with Python's standard library; pip is not needed.
  .voicevox-venv/bin/python - "voicevox/.downloads/$vv_filename" <<'PY'
from email.parser import Parser
from pathlib import Path, PurePosixPath
import sys, sysconfig, zipfile
destination = Path(sysconfig.get_path('platlib')).resolve()
if Path(sys.prefix).resolve() == Path(sys.base_prefix).resolve():
    raise RuntimeError('Refusing to install outside the private virtual environment')
with zipfile.ZipFile(sys.argv[1]) as archive:
    metadata = Parser().parsestr(archive.read('voicevox_core-0.17.0.dist-info/METADATA').decode())
    if metadata['Version'] != '0.17.0' or metadata.get_all('Requires-Dist'):
        raise RuntimeError('Unexpected VOICEVOX wheel version or dependencies')
    for item in archive.infolist():
        path = PurePosixPath(item.filename)
        if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] not in {'voicevox_core', 'voicevox_core-0.17.0.dist-info'}:
            raise RuntimeError('Unexpected wheel layout')
        target = destination.joinpath(*path.parts)
        if not target.resolve().is_relative_to(destination):
            raise RuntimeError('Wheel destination escapes private environment')
    archive.extractall(destination)
print('VOICEVOX Core 0.17.0 installed without pip')
PY
  .voicevox-venv/bin/python -c 'import voicevox_core; from importlib.metadata import version; assert version("voicevox_core")=="0.17.0"'
fi
python3 - <<'PY'
from pathlib import Path
for f in Path('voicevox/.downloads').iterdir():
    if f.is_file(): f.unlink()
PY
echo 'VOICEVOX local components installed. Next: npm run voice-test'
