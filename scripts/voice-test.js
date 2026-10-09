import {mkdir,writeFile} from 'node:fs/promises';
import {synthesize,gentlePcm} from '../src/speech.js';
const before=process.memoryUsage().rss;
try {
  const start=performance.now(),wav=await synthesize('テスト',AbortSignal.timeout(65000));
  const pcm=gentlePcm(wav,30),output=Buffer.alloc(44+pcm.length);
  output.write('RIFF');output.writeUInt32LE(36+pcm.length,4);output.write('WAVEfmt ',8);output.writeUInt32LE(16,16);
  output.writeUInt16LE(1,20);output.writeUInt16LE(2,22);output.writeUInt32LE(48000,24);output.writeUInt32LE(192000,28);output.writeUInt16LE(4,32);output.writeUInt16LE(16,34);output.write('data',36);output.writeUInt32LE(pcm.length,40);pcm.copy(output,44);
  await mkdir('data',{recursive:true});await writeFile('data/voice-test.wav',output);
  console.log(`音声生成成功: ${Math.round(performance.now()-start)}ms / data/voice-test.wav`);
  console.log(`Node RSS: ${Math.round(before/1048576)} -> ${Math.round(process.memoryUsage().rss/1048576)}MiB`);
  console.log('これはPythonを含む最大メモリではありません。Quaxlyのメモリグラフで合成中のピークも確認してください。');
} catch(error) {console.error('音声テスト失敗:',error.message);process.exitCode=1;}
