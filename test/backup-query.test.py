import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace as N
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'scripts'))
spec=importlib.util.spec_from_file_location('backup',Path(__file__).resolve().parent.parent/'scripts/backup-synthesize.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
from backup_render import packed_queries,FeatureRenderer,prepare_renderer,MAX_FRAMES,next_render_frames
import io
import wave

def wav_bytes(frames=480):
    target=io.BytesIO()
    with wave.open(target,'wb') as w:
        w.setnchannels(2);w.setsampwidth(2);w.setframerate(48000);w.writeframes(b'\0'*(frames*4))
    return target.getvalue()

class SegmentQueries(unittest.TestCase):
    def test_preserves_every_mora_and_phrase_pause_without_mutating_query(self):
        first=N(moras=list(range(9)),accent=5,pause_mora='pause',is_interrogative=True)
        last=N(moras=[9,10],accent=1,pause_mora=None,is_interrogative=False)
        query=N(accent_phrases=[first,last],pre_phoneme_length=.25,post_phoneme_length=.25)
        pieces=list(packed_queries(query))
        self.assertEqual([sum(len(p.moras) for p in q.accent_phrases) for q in pieces],[2,9])
        self.assertEqual([m for q in pieces for p in q.accent_phrases for m in p.moras],list(range(11)))
        self.assertIsNone(pieces[0].accent_phrases[0].pause_mora)
        self.assertEqual(pieces[1].accent_phrases[0].pause_mora,'pause')
        self.assertFalse(pieces[0].accent_phrases[0].is_interrogative)
        self.assertTrue(pieces[1].accent_phrases[0].is_interrogative)
        self.assertTrue(all(1<=q.accent_phrases[0].accent<=len(q.accent_phrases[0].moras) for q in pieces))
        self.assertEqual(query.accent_phrases[0].moras,list(range(9)))
        self.assertEqual(pieces[0].pre_phoneme_length,.02)
        self.assertTrue(all(q.pre_phoneme_length==0 for q in pieces[1:]))
class WorkerProtocol(unittest.TestCase):
    def test_warmup_exercises_split_queries_and_progress_precedes_native_calls(self):
        import io
        import json
        events=[];cpu=[.125]
        class Synth:
            def create_audio_query(self,text,style):
                cpu[0]+=.010
                events.append(('query',text))
                return N(accent_phrases=[N(moras=list(range(6)),accent=3,pause_mora=None,is_interrogative=False)])
            def synthesis(self,query,style):
                cpu[0]+=.020
                events.append(('synthesis',len(query.accent_phrases[0].moras)))
                return wav_bytes()
        old_frame,old_create,old_stdin,old_cpu=module.frame,module.create_synthesizer,module.sys.stdin,module.time.process_time
        try:
            module.frame=lambda data,wav=b'': events.append(('frame',data))
            def create(threads,on_progress=lambda _: None):cpu[0]+=.100;return Synth()
            module.create_synthesizer=create
            module.time.process_time=lambda:cpu[0]
            module.sys.stdin=N(buffer=io.BytesIO(''.join(json.dumps({'id':n,'text':'固定文','stream':True})+'\n' for n in [1,2]).encode()))
            module.main()
        finally:
            module.frame,module.create_synthesizer,module.sys.stdin,module.time.process_time=old_frame,old_create,old_stdin,old_cpu
        ready=next(n for n,e in enumerate(events) if e[0]=='frame' and e[1].get('type')=='ready')
        warm=[e for e in events[:ready] if e[0]=='frame' and e[1].get('type')=='warmup']
        self.assertEqual([e[1]['part'] for e in warm],[0,1])
        self.assertEqual(events[ready][1]['protocol'],3)
        self.assertEqual(events[ready][1]['engine'],'packed')
        self.assertEqual(events[ready][1]['warmupParts'],2)
        self.assertEqual(events[ready][1]['warmupCpuMs'],275)
        startup=[e[1] for e in events[:ready] if e[0]=='frame' and e[1].get('type')=='startup']
        self.assertEqual([e['sequence'] for e in startup],[1,2,3])
        self.assertEqual([e['step'] for e in startup],['worker','warmup-query','warmup-packed'])
        self.assertEqual([e['warmupCpuMs'] for e in startup],[125,225,235])
        self.assertEqual([e[1] for e in events[:ready] if e[0]=='synthesis'],[2,4])
        later=events[ready+1:]
        for n,e in enumerate(later):
            if e[0]=='synthesis':
                self.assertEqual(later[n-1][0],'frame')
                self.assertEqual(later[n-1][1]['stage'],'synthesis')
        self.assertTrue(all('text' not in e[1] for e in events if e[0]=='frame'))
        for token in [1,2]:
            metrics=[e[1]['synthesisCpuMs'] for e in later if e[0]=='frame' and e[1].get('id')==token and 'synthesisCpuMs' in e[1]]
            self.assertEqual(metrics,[30,50,50])

class RenderAdapters(unittest.TestCase):
    @staticmethod
    def query():
        return N(accent_phrases=[N(moras=[N(text=str(n)) for n in range(40)],accent=5,pause_mora=None,is_interrogative=False)],pre_phoneme_length=.02,post_phoneme_length=.02,output_sampling_rate=48000,output_stereo=True)

    def synth(self,count=400,rate=93.75):
        self.calls=[]
        owner=self
        class Synth:
            def _Synthesizer__precompute_render(self,q,style):
                owner.calls.append(('prepare',q,style));return N(frame_length=count,frame_rate=rate)
            def _Synthesizer__render(self,feature,start,stop):
                owner.calls.append(('render',start,stop));return b''.join(bytes([n%256,0])*1024 for n in range(start,stop))
            def synthesis(self,q,style):
                owner.calls.append(('fallback',sum(len(p.moras) for p in q.accent_phrases)));return wav_bytes()
        return Synth()

    def test_shared_features_preserve_every_frame_and_fixed_wav_format(self):
        synth=self.synth();events=[]
        chunks=list(FeatureRenderer(synth,lambda:0).chunks(self.query(),lambda p:events.append(dict(p))))
        self.assertEqual([(p['frameStart'],p['frameEnd']) for p,_ in chunks],[(0,12),(12,60),(60,252),(252,400)])
        self.assertEqual(len([c for c in self.calls if c[0]=='prepare']),1)
        pcm=[]
        for progress,data in chunks:
            with wave.open(io.BytesIO(data)) as source:
                self.assertEqual((source.getnchannels(),source.getsampwidth(),source.getframerate()),(2,2,48000))
                pcm.append(source.readframes(source.getnframes()))
        self.assertEqual(b''.join(pcm),b''.join(bytes([n%256,0])*1024 for n in range(400)))
        self.assertEqual(events,[p for p,_ in chunks])

    def test_progress_precedes_native_rendering(self):
        synth=self.synth(24);events=[];original=synth._Synthesizer__render
        def render(a,start,stop):events.append(('render',start));return original(a,start,stop)
        synth._Synthesizer__render=render
        list(FeatureRenderer(synth).chunks(self.query(),lambda p:events.append(('progress',p['frameStart']))))
        self.assertEqual(events,[('progress',0),('render',0),('progress',12),('render',12)])

    def test_adaptive_windows_reduce_the_next_call_on_a_slow_host(self):
        synth=self.synth(400);time=[0.]
        original=synth._Synthesizer__render
        def render(a,start,stop):time[0]+=(stop-start)*.3;return original(a,start,stop)
        synth._Synthesizer__render=render
        chunks=list(FeatureRenderer(synth,lambda:time[0]).chunks(self.query()))
        self.assertEqual(chunks[0][0]['frameEnd'],12)
        self.assertTrue(all(p['frameEnd']-p['frameStart']<=33 for p,_ in chunks[1:]))
        self.assertEqual(chunks[-1][0]['frameEnd'],400)

    def test_short_remainders_are_generated_before_long_chunks_without_extra_native_calls(self):
        for count,expected in [(335,[12,131,192]),(645,[12,57,192,192,192]),(400,[12,48,192,148]),(25,[12,13])]:
            chunks=list(FeatureRenderer(self.synth(count),lambda:0).chunks(self.query()))
            self.assertEqual([p['frameEnd']-p['frameStart'] for p,_ in chunks],expected)
            self.assertEqual(chunks[-1][0]['frameEnd'],count)

    def test_all_lengths_use_minimum_bounded_calls_without_a_startup_constraint_and_preserve_the_first_chunk(self):
        for count in range(1,MAX_FRAMES+1):
            left=count;plan=[]
            while left:
                size=next_render_frames(left,len(plan),0)
                self.assertTrue(1<=size<=min(left,192));plan.append(size);left-=size
            self.assertEqual(plan[0],min(count,12))
            self.assertEqual(len(plan),1+(max(0,count-12)+191)//192)
            self.assertEqual(sum(plan),count)
            self.assertTrue(all(n>=48 for n in plan[1:-1]))

    def test_startup_ramp_is_preserved_when_merging_predicts_a_longer_audible_pause(self):
        # 8ms per input frame including Core's 28-frame context; first call is 40 frames.
        measured_rate=.008*40/12
        self.assertEqual(next_render_frames(737,1,measured_rate),48)
        self.assertEqual(next_render_frames(323,1,measured_rate),131)
        self.assertEqual(next_render_frames(633,1,measured_rate),57)
        self.assertEqual(next_render_frames(689,2,measured_rate),192)
        synth=self.synth(749);clock=[0.];original=synth._Synthesizer__render
        def render(a,start,stop):clock[0]+=.008*(stop-start+28);return original(a,start,stop)
        synth._Synthesizer__render=render
        chunks=list(FeatureRenderer(synth,lambda:clock[0]).chunks(self.query()))
        self.assertEqual([p['frameEnd']-p['frameStart'] for p,_ in chunks],[12,48,192,192,192,113])

    def test_invalid_feature_dimensions_and_incomplete_pcm_are_rejected(self):
        for count,rate in [(0,93.75),(MAX_FRAMES+1,93.75),(3.5,93.75),(24,80)]:
            with self.subTest(count=count,rate=rate):
                with self.assertRaises(ValueError):list(FeatureRenderer(self.synth(count,rate)).chunks(self.query()))
        synth=self.synth(24);synth._Synthesizer__render=lambda *args:b'partial'
        with self.assertRaises(ValueError):list(FeatureRenderer(synth).chunks(self.query()))

    def test_an_incompatible_or_failed_warmup_falls_back_before_emitting_audio(self):
        for version,bad in [('0.18.0',False),('0.17.0',True),('0.17.0','missing')]:
            synth=self.synth(24)
            if bad:synth._Synthesizer__render=None if bad=='missing' else lambda *args:b'partial'
            stages=[]
            renderer,chunks=prepare_renderer(synth,self.query(),version,on_prepare=stages.append)
            self.assertEqual(renderer.mode,'packed');self.assertTrue(chunks)
            self.assertEqual(stages,['warmup-features','warmup-packed'] if bad is True else ['warmup-packed'])
        renderer,chunks=prepare_renderer(self.synth(24),self.query(),'0.17.0')
        self.assertEqual(renderer.mode,'features');self.assertEqual(len(chunks),2)

    def test_late_native_failure_does_not_restart_a_partly_emitted_post_with_the_fallback(self):
        synth=self.synth(24);original=synth._Synthesizer__render
        def render(a,start,stop):return original(a,start,stop) if start==0 else b'partial'
        synth._Synthesizer__render=render
        chunks=FeatureRenderer(synth).chunks(self.query());next(chunks)
        with self.assertRaises(ValueError):next(chunks)
        self.assertFalse(any(c[0]=='fallback' for c in self.calls))

    def test_maximum_length_remains_within_existing_byte_and_part_limits_even_at_minimum_window(self):
        synth=self.synth(MAX_FRAMES);clock=[0.];original=synth._Synthesizer__render
        def render(a,start,stop):clock[0]+=10*(stop-start);return original(a,start,stop)
        synth._Synthesizer__render=render
        chunks=list(FeatureRenderer(synth,lambda:clock[0]).chunks(self.query()))
        self.assertLessEqual(len(chunks),256);self.assertLessEqual(sum(len(wav) for _,wav in chunks),8*1024*1024)
        self.assertEqual(chunks[-1][0]['frameEnd'],MAX_FRAMES)

    def test_packing_does_not_alias_moras_or_drop_phrase_boundaries(self):
        query=self.query();parts=list(packed_queries(query));self.assertEqual([sum(len(p.moras) for p in q.accent_phrases) for q in parts],[2,12,12,12,2])
        self.assertEqual([m.text for q in parts for p in q.accent_phrases for m in p.moras],[str(n) for n in range(40)])
        parts[0].accent_phrases[0].moras[0].text='changed';self.assertEqual(query.accent_phrases[0].moras[0].text,'0')

    def test_punctuation_only_queries_do_not_render_silence(self):
        query=N(accent_phrases=[])
        self.assertEqual(list(FeatureRenderer(self.synth()).chunks(query)),[])
        self.assertEqual(list(packed_queries(query)),[])

class ModelStartup(unittest.TestCase):
    def test_checkpoints_precede_expensive_model_calls_and_identify_a_failing_load(self):
        import os
        from tempfile import TemporaryDirectory
        from types import ModuleType
        from unittest.mock import patch
        from synthesize import create_synthesizer
        for fail in [False,True]:
            events=[]
            class Runtime:
                LIB_RECOMMENDED_VERSIONED_FILENAME='fixed.so'
                @staticmethod
                def load_once(**kwargs):events.append(('call','runtime'));return object()
            def analyzer(path):events.append(('call','analyzer'));return object()
            class Synth:
                def __init__(self,*args,**kwargs):
                    self.options=kwargs;events.append(('call','synthesizer'))
                def load_voice_model(self,voice):
                    events.append(('call','model-load'))
                    if fail:raise RuntimeError('Fixture model failure')
            class Model:
                metas=[N(name='ずんだもん',styles=[N(id=3)])]
                @staticmethod
                def open(path):events.append(('call','model-open'));return Model()
                def __enter__(self):return self
                def __exit__(self,*args):pass
            parent=ModuleType('voicevox_core');parent.__path__=[]
            blocking=ModuleType('voicevox_core.blocking')
            blocking.Onnxruntime=Runtime;blocking.OpenJtalk=analyzer;blocking.Synthesizer=Synth;blocking.VoiceModelFile=Model
            with TemporaryDirectory() as directory:
                root=Path(directory);dictionary=root/'dict'/'japanese-plus'
                for path in [root/'onnxruntime'/'lib'/'fixed.so',dictionary/'sys.dic',dictionary/'.ready-post9',root/'models'/'vvms'/'0.vvm']:
                    path.parent.mkdir(parents=True,exist_ok=True);path.touch()
                with patch.dict(sys.modules,{'voicevox_core':parent,'voicevox_core.blocking':blocking}),patch.dict(os.environ,{'VOICEVOX_ROOT':str(root),'VOICEVOX_DICTIONARY':str(dictionary)}):
                    def progress(step):events.append(('step',step))
                    if fail:
                        with self.assertRaises(RuntimeError):create_synthesizer(1,on_progress=progress)
                    else:
                        result=create_synthesizer(1,on_progress=progress)
                        self.assertEqual(result.options,{'acceleration_mode':'CPU','cpu_num_threads':1})
            self.assertEqual([value for kind,value in events if kind=='step'],['core-import','dictionary','runtime','analyzer','synthesizer','model-open','model-load'])
            for step in ['runtime','analyzer','synthesizer','model-open','model-load']:
                self.assertEqual(events[events.index(('call',step))-1],('step',step))
            self.assertEqual(events[-1],('call','model-load'))

if __name__=='__main__': unittest.main()
