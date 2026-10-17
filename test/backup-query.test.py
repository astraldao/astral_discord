import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace as N
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'scripts'))
spec=importlib.util.spec_from_file_location('backup',Path(__file__).resolve().parent.parent/'scripts/backup-synthesize.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
from backup_render import packed_queries,FeatureRenderer,prepare_renderer,MAX_FRAMES
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
            def create(threads):cpu[0]+=.100;return Synth()
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
            renderer,chunks=prepare_renderer(synth,self.query(),version)
            self.assertEqual(renderer.mode,'packed');self.assertTrue(chunks)
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

if __name__=='__main__': unittest.main()
