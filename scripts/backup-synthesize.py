"""Warm local VOICEVOX worker. Bounded JSON lines in, framed WAV out; no text logs."""
import json
import os
import sys
import time
from synthesize import create_synthesizer
from backup_render import prepare_renderer

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

def warmup(synth, on_progress=lambda _: None):
    on_progress('warmup-query')
    query=query_for(synth,'テストなのだ')
    renderer, chunks = prepare_renderer(synth, query, on_prepare=on_progress)
    for index,(_,wav) in enumerate(chunks):
        frame({'type':'warmup','part':index},wav)
    return renderer,len(chunks)

def main():
    sequence=0
    def startup(step):
        nonlocal sequence
        sequence+=1
        frame({'type':'startup','sequence':sequence,'step':step,'warmupCpuMs':round(time.process_time()*1000)})
    startup('worker')
    threads=int(os.environ.get('VOICEVOX_BACKUP_THREADS','2'))
    if not 1<=threads<=4: raise ValueError('Invalid thread count')
    synth=create_synthesizer(threads,on_progress=startup)
    renderer,parts=warmup(synth,startup)
    frame({'type':'ready','protocol':3,'engine':renderer.mode,'threads':threads,'warmupParts':parts,'warmupCpuMs':round(time.process_time()*1000)})
    while True:
        line=sys.stdin.buffer.readline(4097)
        if not line: return
        if len(line)>4096 or not line.endswith(b'\n'): raise ValueError('Request too large')
        request=json.loads(line)
        token=request.get('id')
        if not isinstance(token,int) or token<1: raise ValueError('Invalid request')
        text=request.get('text')
        if not isinstance(text,str) or not 1<=len(text)<=53: raise ValueError('Invalid length')
        cpu_began=time.process_time()
        def cpu_ms():
            return max(0,round((time.process_time()-cpu_began)*1000))
        try:
            frame({'id':token,'type':'progress','stage':'query'})
            query=query_for(synth,text)
            if request.get('stream'):
                # Request progress is announced before each native call.
                index=0
                def progress(data):
                    frame({'id':token,'type':'progress','stage':'synthesis','part':index,**data})
                for _,wav in renderer.chunks(query,progress):
                    if len(wav)>4*1024*1024: raise ValueError('Audio too large')
                    frame({'id':token,'part':index,'synthesisCpuMs':cpu_ms()},wav)
                    index+=1
                frame({'id':token,'end':True,'synthesisCpuMs':cpu_ms()})
            else:
                frame({'id':token,'type':'progress','stage':'synthesis','part':0})
                wav=synth.synthesis(query,3)
                if len(wav)>4*1024*1024: raise ValueError('Audio too large')
                frame({'id':token,'synthesisCpuMs':cpu_ms()},wav)
        except Exception:
            frame({'id':token,'error':True,'synthesisCpuMs':cpu_ms()})
        finally:
            # Do not keep the last post or its query/audio while waiting for the next input.
            text=query=wav=request=None
            line=b''

if __name__=='__main__':
    try: main()
    except Exception:
        print('Backup VOICEVOX worker failed.',file=sys.stderr)
        sys.exit(1)
