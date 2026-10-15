import {createPersistentVoice} from '../src/persistent-voice.js';
import {backupText} from '../src/backup-text.js';
const worker=createPersistentVoice();
try{
  const warm=performance.now();await worker.ready;const warmupMs=Math.round(performance.now()-warm),samples=[];
  const phrases=['こんにちは。今日はよろしくお願いします。','次のセッションは午後八時から開始する予定です。','この文章は文字数を確認するために用意したバックアップ読み上げシステムのテスト文章です。続きは以下略になります。'];
  for(let n=0;n<12;n++){
    const text=backupText(phrases[n%phrases.length]),start=performance.now();let first=null;await worker.stream(text,undefined,()=>{if(first===null)first=Math.round(performance.now()-start);});samples.push(first);
  }
  const sorted=[...samples].sort((a,b)=>a-b);
  console.log(JSON.stringify({warmupMs,firstAudioSynthesisMs:samples,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.ceil(sorted.length*.95)-1],over300:samples.filter(n=>n>300).length},null,2));
  console.log('合成のみの計測です。権限確認・順番待ち・Discordで聞こえるまでの通信遅延は含みません。300msを保証する値ではありません。');
}catch(error){console.error(error.message);process.exitCode=1;}finally{worker.close();}
