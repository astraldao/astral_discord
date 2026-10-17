"""Bounded synthesis adapters. Core 0.17's hidden renderer stays isolated here."""
import copy
import io
import time
import wave

MAX_FRAMES = 3750  # 40 seconds at the native 93.75 Hz; PCM remains below 8 MiB.
FIRST_FRAMES = 12
MAX_CHUNK_FRAMES = 192


def packed_queries(query):
    """Keep pronunciation/pauses, but combine short accent phrases in later chunks."""
    index, phrases, used = 0, [], 0
    for phrase in query.accent_phrases:
        offset = 0
        while offset < len(phrase.moras):
            capacity = 2 if index == 0 else 12
            length = min(capacity - used, len(phrase.moras) - offset)
            piece = copy.copy(phrase)
            piece.moras = copy.deepcopy(phrase.moras[offset:offset + length])
            piece.accent = max(1, min(length, phrase.accent - offset))
            last = offset + length == len(phrase.moras)
            piece.pause_mora = copy.deepcopy(phrase.pause_mora) if last else None
            piece.is_interrogative = phrase.is_interrogative if last else False
            phrases.append(piece)
            offset += length
            used += length
            if used == capacity:
                part = copy.copy(query)
                part.accent_phrases = phrases
                part.pre_phoneme_length = .02 if index == 0 else 0
                part.post_phoneme_length = 0
                yield part
                index, phrases, used = index + 1, [], 0
    if phrases:
        part = copy.copy(query)
        part.accent_phrases = phrases
        part.pre_phoneme_length = .02 if index == 0 else 0
        part.post_phoneme_length = 0
        yield part


def checked_wav(wav):
    if not isinstance(wav, bytes) or not 44 < len(wav) <= 4 * 1024 * 1024:
        raise ValueError('Invalid audio')
    with wave.open(io.BytesIO(wav), 'rb') as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate(), source.getcomptype()) != (2, 2, 48000, 'NONE'):
            raise ValueError('Invalid audio format')
        pcm = source.readframes(source.getnframes())
        if len(pcm) != source.getnframes() * 4 or not pcm:
            raise ValueError('Incomplete audio')
    return wav


class PackedRenderer:
    mode = 'packed'

    def __init__(self, synth):
        self.synth = synth

    def chunks(self, query, on_progress=lambda _: None):
        for part in packed_queries(query):
            progress = {'moras': sum(len(p.moras) for p in part.accent_phrases)}
            on_progress(progress)
            yield progress, checked_wav(self.synth.synthesis(part, 3))


class FeatureRenderer:
    mode = 'features'

    def __init__(self, synth, clock=time.monotonic):
        self.precompute = getattr(synth, '_Synthesizer__precompute_render')
        self.render = getattr(synth, '_Synthesizer__render')
        if not callable(self.precompute) or not callable(self.render):
            raise ValueError('Unavailable renderer')
        self.clock = clock

    def chunks(self, query, on_progress=lambda _: None):
        if not any(p.moras for p in query.accent_phrases):
            return
        feature = self.precompute(query, 3)
        count = feature.frame_length
        if type(count) is not int or not 1 <= count <= MAX_FRAMES or feature.frame_rate != 93.75:
            raise ValueError('Invalid feature dimensions')
        start, part, previous_rate = 0, 0, None
        while start < count:
            size = FIRST_FRAMES if part == 0 else 48 if part == 1 else MAX_CHUNK_FRAMES
            # Target <10 seconds per native call on slow hosts; the Node hard deadline stays 15s.
            if part and previous_rate and previous_rate > 0:
                size = min(size, max(16, int(10 / previous_rate)))
            stop = min(count, start + size)
            progress = {'frameStart': start, 'frameEnd': stop, 'frames': count}
            on_progress(progress)
            began = self.clock()
            pcm = self.render(feature, start, stop)
            elapsed = max(0, self.clock() - began)
            if not isinstance(pcm, bytes) or len(pcm) != (stop - start) * 2048:
                raise ValueError('Invalid rendered audio')
            previous_rate = elapsed / (stop - start)
            output = io.BytesIO()
            with wave.open(output, 'wb') as target:
                target.setnchannels(2)
                target.setsampwidth(2)
                target.setframerate(48000)
                target.writeframes(pcm)
            yield progress, checked_wav(output.getvalue())
            start, part = stop, part + 1


def prepare_renderer(synth, query, version=None, on_prepare=lambda _: None):
    if version is None:
        try:
            from voicevox_core import __version__
            version = __version__
        except ImportError:
            version = ''
    if version == '0.17.0':
        try:
            renderer = FeatureRenderer(synth)
            on_prepare('warmup-features')
            warmup = list(renderer.chunks(query))
            if not warmup or sum(len(wav) for _, wav in warmup) > 8 * 1024 * 1024:
                raise ValueError('Invalid warmup')
            return renderer, warmup
        except Exception:
            # No data has been emitted. Do not change adapters partway through a channel post.
            pass
    renderer = PackedRenderer(synth)
    on_prepare('warmup-packed')
    warmup = list(renderer.chunks(query))
    if not warmup or sum(len(wav) for _, wav in warmup) > 8 * 1024 * 1024:
        raise ValueError('Invalid warmup')
    return renderer, warmup
