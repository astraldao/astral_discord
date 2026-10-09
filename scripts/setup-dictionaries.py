"""Install only the pinned Japanese dictionary data; no pip or ML models."""
from pathlib import Path, PurePosixPath
import hashlib
import os
import shutil
import subprocess
import tempfile
import zipfile

URL = 'https://files.pythonhosted.org/packages/81/37/aa7b83620b5aadd7f47c42d0f04a2cad535e7fece52cc0c2387b97db3e85/pyopenjtalk_plus-0.4.1.post9-cp312-cp312-manylinux_2_24_x86_64.manylinux_2_28_x86_64.whl'
SHA256 = '856b1ee7be326015490c23fc55046688492e2d99554852e476a24a10c8e77ba0'

def install(wheel, destination):
    with zipfile.ZipFile(wheel) as archive:
        count = 0
        for item in archive.infolist():
            path = PurePosixPath(item.filename)
            if path.parts[:2] != ('pyopenjtalk', 'dictionary'):
                continue
            if path.is_absolute() or '..' in path.parts:
                raise RuntimeError('Invalid dictionary path')
            target = destination.joinpath(*path.parts[2:])
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(item) as source, target.open('wb') as output:
                    shutil.copyfileobj(source, output)
                count += 1
        if count < 5 or not (destination/'sys.dic').is_file() or not (destination/'matrix.bin').is_file():
            raise RuntimeError('Incomplete Japanese dictionary')

def main():
    root = Path(os.environ.get('VOICEVOX_ROOT', 'voicevox')).resolve()/'dict'
    destination = root/'japanese-plus'
    if (destination/'.ready-post9').is_file() and (destination/'sys.dic').is_file():
        print('Japanese dictionary is ready.')
        return
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.dictionary-', dir=root) as temporary:
        temp = Path(temporary)
        wheel = temp/'dictionary.whl'
        print('Downloading Japanese dictionary data...', flush=True)
        subprocess.run(['curl', '-fL', '--retry', '2', '--connect-timeout', '15', '--max-time', '300', '--speed-time', '45', '--speed-limit', '1024', URL, '-o', str(wheel)], check=True, timeout=950)
        digest = hashlib.sha256()
        with wheel.open('rb') as source:
            for chunk in iter(lambda: source.read(1024*1024), b''):
                digest.update(chunk)
        if digest.hexdigest() != SHA256:
            raise RuntimeError('Dictionary checksum mismatch')
        staged = temp/'japanese-plus'
        staged.mkdir()
        install(wheel, staged)
        (staged/'.ready-post9').touch()
        if destination.exists():
            shutil.rmtree(destination)
        staged.rename(destination)
    print('Japanese dictionary installed.')

if __name__ == '__main__':
    main()
