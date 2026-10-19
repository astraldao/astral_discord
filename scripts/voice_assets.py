"""Pinned checksums for new VOICEVOX downloads, verified before installation.

GitHub release asset sizes/digests were checked on 2026-10-19. These pins
authenticate bytes against this repository, not against a signing identity.
Existing installations are not retroactively verified by these archive pins.
"""
import hashlib
from pathlib import Path
import stat
import sys

ASSETS = {
    'runtime-x64': (8214849, '0860cfbd5a80201b1bf95cae13ca2db8dc01f32f5674cc8193146047a9212fdb'),
    'runtime-arm64': (7313378, '02cf370ce89c80b3ca7e0d7ab01f2bda89f9325975957e744e0cb684dd364901'),
    'core-x64': (1820106, '74891252a53749a679d327e5b52737bae2107d47ccda9abc3d69071d34792965'),
    'core-arm64': (1836906, '8ef5ab8166c870ed9aa7bdcbf2f8e06338fb99921d630e59304698c439f10067'),
    # Open JTalk dictionary: original SourceForge archive, independently fetched over HTTPS.
    'dictionary': (23643819, '33e9cd251bc41aa2bd7ca36f57abbf61eae3543ca25ca892ae345e394cb10549'),
    'model': (59308488, 'ecd35374d4182cd883cba5040376f7f888cc6ba248b1c2f4cea07cdb34bb1318'),
}


def verify(path, size, expected_sha256):
    """Read at most expected size + 1; reject truncation, excess and symlinks."""
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size != size:
        raise ValueError('音声配布ファイルの種類・サイズが一致しません。導入を中止します。')
    digest = hashlib.sha256()
    remaining = size
    with path.open('rb') as source:
        while remaining:
            chunk = source.read(min(65536, remaining))
            if not chunk:
                raise ValueError('音声配布ファイルが途中で切れています。導入を中止します。')
            remaining -= len(chunk)
            digest.update(chunk)
        if source.read(1):
            raise ValueError('音声配布ファイルが大きすぎます。導入を中止します。')
    if digest.hexdigest() != expected_sha256:
        raise ValueError('音声配布ファイルのSHA256が一致しません。導入を中止します。')


def main(args):
    if not args or (args[0] == 'size' and len(args) != 2) or (args[0] == 'verify' and len(args) != 3) or args[0] not in {'size', 'verify'} or args[1] not in ASSETS:
        raise ValueError('音声配布ファイルの検証指定が不正です。')
    size, digest = ASSETS[args[1]]
    if args[0] == 'size':
        print(size)
    else:
        verify(args[2], size, digest)
        print('音声配布ファイルのSHA256・サイズを確認しました。')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (OSError, ValueError):
        print('音声配布ファイルを検証できませんでした。導入を中止します。再取得しても続く場合は配布情報を確認してください。', file=sys.stderr)
        sys.exit(1)
