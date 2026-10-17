import test from 'node:test';
import assert from 'node:assert/strict';
import {announcementText,gentlePcm,synthesize,wavPcm} from '../src/speech.js';
function wave(frames=3000) {
  const b=Buffer.alloc(44+frames*4);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(192000,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(frames*4,40);for(let i=44;i<b.length;i+=2)b.writeInt16LE(30000,i);return b;
}
test('announces names with bounded text and ignores emoji/URLs',()=>{
  assert.equal(announcementText('あすとらる'),'あすとらるさんが、まもなく参加するのだ。');
  assert.equal(announcementText('✨'),'新しい方が、まもなく参加するのだ。');
  assert.ok(!announcementText('abc https://example.com').includes('https'));
  assert.ok(announcementText('a'.repeat(1000)).length<60);
});
test('attenuates without normalization and fades endpoints with a hard peak cap',()=>{
  const pcm=gentlePcm(wave(),30);assert.equal(pcm.readInt16LE(0),0);assert.equal(pcm.readInt16LE(pcm.length-2),0);
  assert.equal(pcm.readInt16LE(1500*4),9000);
  assert.equal(gentlePcm(wave(),60).readInt16LE(1500*4),10000);
});
test('rejects malformed, unsupported, and excessive WAV audio',()=>{
  assert.throws(()=>gentlePcm(Buffer.from('bad')));
  const b=wave();b.writeUInt32LE(24000,24);assert.throws(()=>gentlePcm(b));
  assert.throws(()=>gentlePcm(wave(),100));
});
test('cancelled requests do not spawn local synthesizer',async()=>{
  const controller=new AbortController();controller.abort();await assert.rejects(synthesize('test',controller.signal));
});

test('WAV inspection returns a bounded PCM view without changing samples or copying the full audio',()=>{
  const wav=wave(),before=Buffer.from(wav),pcm=wavPcm(wav);assert.equal(pcm.buffer,wav.buffer);assert.equal(pcm.byteOffset,wav.byteOffset+44);assert.equal(pcm.length,wav.length-44);assert.deepEqual(wav,before);assert.equal(pcm.readInt16LE(0),30000);
  const truncated=Buffer.from(wav);truncated.writeUInt32LE(wav.length,40);assert.throws(()=>wavPcm(truncated));const unsupported=Buffer.from(wav);unsupported.writeUInt16LE(1,22);assert.throws(()=>wavPcm(unsupported));
});
