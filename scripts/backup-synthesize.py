"""Warm local VOICEVOX worker. Bounded JSON lines in, framed WAV out; no text logs."""
import json
import copy
import os
import sys
from synthesize import create_synthesizer

def frame(data, wav=b''):
    sys.stdout.buffer.write(json.dumps({**data,'bytes':len(wav)}).encode()+b'\n'+wav)
    sys.stdout.buffer.flush()

def query_for(synth, text):
    query=synth.create_audio_query(text,3)
    query.speed_scale=1.1
    query.intonation_scale=0.85
    query.volume_scale=1.0
    query.pre_phoneme_length=0.02
    query.post_phoneme_length=0.02
    query.output_sampling_rate=48000
    query.output_stereo=True
    return query

def segment_queries(query):
    index=0
    for phrase in query.accent_phrases:
        offset=0
        while offset<len(phrase.moras):
            length=2 if index==0 else 3 if index==1 else 6 if index==2 else 12
            piece=copy.deepcopy(phrase)
            piece.moras=piece.moras[offset:offset+length]
            piece.accent=max(1,min(len(piece.moras),phrase.accent-offset))
            last=offset+length>=len(phrase.moras)
            if not last: piece.pause_mora=None;piece.is_interrogative=False
            part=copy.deepcopy(query)
            part.accent_phrases=[piece]
            part.pre_phoneme_length=0.02 if index==0 else 0
            part.post_phoneme_length=0
            yield part
            index+=1;offset+=length

def main():
    threads=int(os.environ.get('VOICEVOX_BACKUP_THREADS','2'))
    if not 1<=threads<=4: raise ValueError('Invalid thread count')
    synth=create_synthesizer(threads)
    synth.synthesis(query_for(synth,'テスト'),3)  # Load inference kernels before accepting channel messages.
    frame({'type':'ready'})
    while True:
        line=sys.stdin.buffer.readline(4097)
        if not line: return
        if len(line)>4096 or not line.endswith(b'\n'): raise ValueError('Request too large')
        request=json.loads(line)
        token=request.get('id')
        if not isinstance(token,int) or token<1: raise ValueError('Invalid request')
        text=request.get('text')
        if not isinstance(text,str) or not 1<=len(text)<=53: raise ValueError('Invalid length')
        try:
            query=query_for(synth,text)
            if request.get('stream'):
                for index,part in enumerate(segment_queries(query)):
                    wav=synth.synthesis(part,3)
                    if len(wav)>4*1024*1024: raise ValueError('Audio too large')
                    frame({'id':token,'part':index},wav)
                frame({'id':token,'end':True})
            else:
                wav=synth.synthesis(query,3)
                if len(wav)>4*1024*1024: raise ValueError('Audio too large')
                frame({'id':token},wav)
        except Exception:
            frame({'id':token,'error':True})

if __name__=='__main__':
    try: main()
    except Exception:
        print('Backup VOICEVOX worker failed.',file=sys.stderr)
        sys.exit(1)
