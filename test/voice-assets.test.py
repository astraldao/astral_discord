import hashlib
import io
import os
import shutil
import tarfile
import zipfile
import importlib.util
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('voice_assets', ROOT/'scripts/voice_assets.py')
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)

class AssetsTest(unittest.TestCase):
    def test_pin_manifest(self):
        self.assertEqual(set(assets.ASSETS), {'runtime-x64', 'runtime-arm64', 'core-x64', 'core-arm64', 'model', 'dictionary'})
        for size, digest in assets.ASSETS.values():
            self.assertIsInstance(size, int)
            self.assertTrue(0 < size < 64*1024*1024)
            self.assertTrue(re.fullmatch('[a-f0-9]{64}', digest))

    def test_exact_bytes_and_rejections(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root)/'download.part'
            raw = bytes(range(256))*1025
            digest = hashlib.sha256(raw).hexdigest()
            path.write_bytes(raw)
            assets.verify(path, len(raw), digest)
            for changed in (raw[:-1], raw+b'x', b'x'+raw[1:]):
                path.write_bytes(changed)
                with self.assertRaises(ValueError):
                    assets.verify(path, len(raw), digest)
            with self.assertRaises(ValueError):
                assets.verify(root, len(raw), digest)
            link = Path(root)/'link'
            link.symlink_to(path)
            with self.assertRaises(ValueError):
                assets.verify(link, len(raw), digest)

    def test_cli_fails_closed_without_reflecting_paths_or_input(self):
        secret = 'PRIVATE_FILE_PATH_DO_NOT_PRINT'
        for args in ([], ['size'], ['size', 'unknown'], ['size', 'model', secret], ['verify', 'model'], ['verify', 'model', secret], ['other', 'model', secret]):
            result = subprocess.run([sys.executable, str(ROOT/'scripts/voice_assets.py'), *args], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn(secret, result.stdout+result.stderr)
            self.assertNotIn('Traceback', result.stderr)
        for key, (size, _) in assets.ASSETS.items():
            result = subprocess.run([sys.executable, str(ROOT/'scripts/voice_assets.py'), 'size', key], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout.strip(), str(size))


    def test_setup_verifies_before_extracting_marking_or_replacing(self):
        # Only this isolated fixture uses synthetic pins and no network/native code.
        def tar_bytes(name, data):
            buffer = io.BytesIO()
            with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
                info = tarfile.TarInfo(name);info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
            return buffer.getvalue()

        def zip_bytes(files):
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, 'w') as archive:
                for name, data in files.items():archive.writestr(name, data)
            return buffer.getvalue()

        files = {
            'dictionary': tar_bytes('open_jtalk_dic_utf_8-1.11/sys.dic', b'fixture dictionary'),
            'model': zip_bytes({'manifest.json': '{}'}),
        }
        for arch in ['x64', 'arm64']:
            files['runtime-'+arch] = tar_bytes('runtime/lib/libtest.so', ('fixture runtime '+arch).encode())
            files['core-'+arch] = zip_bytes({'voicevox_core/__init__.py': 'ARCH = '+repr(arch), 'voicevox_core-0.17.0.dist-info/METADATA': 'Name: voicevox_core\nVersion: 0.17.0\n'})
        for arch, corrupt in [('x64', None), ('arm64', None), *[('x64', key) for key in ['runtime', 'dictionary', 'model', 'core']]]:
            with self.subTest(arch=arch, corrupt=corrupt), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary);(root/'scripts').mkdir();(root/'bin').mkdir();(root/'fixtures').mkdir()
                shutil.copy(ROOT/'setup-voicevox.sh', root/'setup-voicevox.sh')
                (root/'scripts/setup-dictionaries.py').write_text("print('fixture Japanese dictionary ready')\n")
                pins = {}
                for key, raw in files.items():
                    (root/'fixtures'/key).write_bytes(raw)
                    pins[key] = (len(raw), hashlib.sha256(raw).hexdigest())
                source = (ROOT/'scripts/voice_assets.py').read_text()
                start = source.index('ASSETS = {');end = source.index('\n\n\ndef verify', start)
                (root/'scripts/voice_assets.py').write_text(source[:start]+'ASSETS = '+repr(pins)+source[end:])
                curl = root/'bin/curl'
                curl.write_text('#!'+sys.executable+'\n'+r"""
import os,sys
from pathlib import Path
args=sys.argv[1:];url=args[args.index('-o')-1];target=Path(args[args.index('-o')+1])
key='runtime' if 'onnxruntime' in url else 'dictionary' if 'sourceforge' in url else 'model' if url.endswith('/0.vvm') else 'core'
arch='arm64' if '-arm64-' in url or '_aarch64.whl' in url else 'x64'
name=key+'-'+arch if key in {'runtime','core'} else key
raw=(Path(os.environ['ASTRAL_TEST_ROOT'])/'fixtures'/name).read_bytes()
if os.environ.get('ASTRAL_TEST_CORRUPT')==key:raw=bytes([raw[0]^1])+raw[1:]
assert args[args.index('--max-filesize')+1]==str(len(raw))
assert args[args.index('--proto')+1]=='=https'
assert args[args.index('--proto-redir')+1]=='=https'
target.write_bytes(raw)
""")
                curl.chmod(0o700)
                uname = root/'bin/uname';uname.write_text('#!/bin/sh\necho '+('aarch64' if arch=='arm64' else 'x86_64')+'\n');uname.chmod(0o700)
                # A failed new model must leave the existing target untouched.
                model = root/'voicevox/models/vvms/0.vvm';model.parent.mkdir(parents=True);model.write_bytes(b'old model')
                env = {**os.environ, 'PATH': str(root/'bin')+os.pathsep+os.environ['PATH'], 'ASTRAL_TEST_ROOT': str(root), 'ASTRAL_TEST_CORRUPT': corrupt or ''}
                result = subprocess.run(['sh', str(root/'setup-voicevox.sh')], cwd=root, env=env, capture_output=True, text=True, timeout=30)
                if corrupt is None:
                    self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
                    for marker in ['onnxruntime/.installed-1.23.2', 'dict/.installed-1.11', 'models/.installed-0.17.0']:
                        self.assertTrue((root/'voicevox'/marker).is_file())
                    self.assertEqual(model.read_bytes(), files['model'])
                    self.assertEqual(list((root/'voicevox/.downloads').iterdir()), [])
                else:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('検証できません', result.stderr)
                    target = {'runtime': 'onnxruntime/.installed-1.23.2', 'dictionary': 'dict/.installed-1.11', 'model': 'models/.installed-0.17.0', 'core': 'missing'}[corrupt]
                    self.assertFalse((root/'voicevox'/target).exists())
                    if corrupt == 'runtime':self.assertFalse((root/'voicevox/onnxruntime/lib/libtest.so').exists())
                    if corrupt == 'dictionary':self.assertFalse((root/'voicevox/dict/open_jtalk_dic_utf_8-1.11/sys.dic').exists())
                    if corrupt in {'runtime', 'dictionary', 'model'}:self.assertEqual(model.read_bytes(), b'old model')
                    if corrupt == 'core':self.assertFalse(list((root/'.voicevox-venv').glob('lib/python*/site-packages/voicevox_core')))

if __name__ == '__main__':
    unittest.main()
