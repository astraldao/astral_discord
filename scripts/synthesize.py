"""One-shot local VOICEVOX synthesis; WAV on stdout, diagnostics on stderr."""
import json
import os
from pathlib import Path
import sys
import subprocess

def main():
    from voicevox_core.blocking import Onnxruntime, OpenJtalk, Synthesizer, VoiceModelFile
    root=Path(os.environ.get('VOICEVOX_ROOT','voicevox')).resolve()
    runtime=root/'onnxruntime'/'lib'/Onnxruntime.LIB_RECOMMENDED_VERSIONED_FILENAME
    enhanced=root/'dict'/'japanese-plus'
    archive=Path(__file__).resolve().parent.parent/'dictionaries'/'japanese-plus.tar.gz'
    if archive.exists() and not (enhanced/'.ready-post9').exists():
        (root/'dict').mkdir(parents=True,exist_ok=True)
        subprocess.run(['tar','--no-same-owner','-xzf',str(archive),'-C',str(root/'dict')],check=True,timeout=30,stdout=subprocess.DEVNULL)
        (enhanced/'.ready-post9').touch()
    dictionary=Path(os.environ.get('VOICEVOX_DICTIONARY',str(enhanced if (enhanced/'sys.dic').exists() else root/'dict'/'open_jtalk_dic_utf_8-1.11')))
    model=root/'models'/'vvms'/'0.vvm'
    for path in [runtime,dictionary,model]:
        if not path.exists(): raise RuntimeError(f'VOICEVOX component missing: {path}')
    request=json.loads(sys.stdin.read(4096))
    text=request['text']
    if not isinstance(text,str) or len(text)>100:raise ValueError('Invalid announcement length')
    synth=Synthesizer(Onnxruntime.load_once(filename=str(runtime)),OpenJtalk(str(dictionary)),acceleration_mode='CPU',cpu_num_threads=1)
    with VoiceModelFile.open(str(model)) as voice:
        if not any(meta.name=='ずんだもん' and any(style.id==3 for style in meta.styles) for meta in voice.metas):
            raise RuntimeError('Model does not contain VOICEVOX:ずんだもん style 3')
        synth.load_voice_model(voice)
    query=synth.create_audio_query(text,3)
    query.speed_scale=0.95
    query.intonation_scale=0.85
    query.volume_scale=1.0
    query.pre_phoneme_length=0.25
    query.post_phoneme_length=0.25
    query.output_sampling_rate=48000
    query.output_stereo=True
    sys.stdout.buffer.write(synth.synthesis(query,3))

if __name__=='__main__':
    try:main()
    except Exception as error:
        print(f'{type(error).__name__}: {error}',file=sys.stderr)
        sys.exit(1)
