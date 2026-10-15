import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace as N
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'scripts'))
spec=importlib.util.spec_from_file_location('backup',Path(__file__).resolve().parent.parent/'scripts/backup-synthesize.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
class SegmentQueries(unittest.TestCase):
    def test_preserves_every_mora_and_phrase_pause_without_mutating_query(self):
        first=N(moras=list(range(9)),accent=5,pause_mora='pause',is_interrogative=True)
        last=N(moras=[9,10],accent=1,pause_mora=None,is_interrogative=False)
        query=N(accent_phrases=[first,last],pre_phoneme_length=.25,post_phoneme_length=.25)
        pieces=list(module.segment_queries(query))
        self.assertEqual([len(q.accent_phrases[0].moras) for q in pieces],[2,3,4,2])
        self.assertEqual([m for q in pieces for p in q.accent_phrases for m in p.moras],list(range(11)))
        self.assertIsNone(pieces[0].accent_phrases[0].pause_mora)
        self.assertEqual(pieces[2].accent_phrases[0].pause_mora,'pause')
        self.assertFalse(pieces[0].accent_phrases[0].is_interrogative)
        self.assertTrue(pieces[2].accent_phrases[0].is_interrogative)
        self.assertTrue(all(1<=q.accent_phrases[0].accent<=len(q.accent_phrases[0].moras) for q in pieces))
        self.assertEqual(query.accent_phrases[0].moras,list(range(9)))
        self.assertEqual(pieces[0].pre_phoneme_length,.02)
        self.assertTrue(all(q.pre_phoneme_length==0 for q in pieces[1:]))
if __name__=='__main__': unittest.main()
