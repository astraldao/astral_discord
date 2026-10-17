// Only these fixed messages may leave the audio pipeline. Never expose raw errors or text.
const messages={
  ACCESS:'テキスト・VCの権限を確認できませんでした。Botの閲覧・接続・発言権限を確認してください。',
  AUDIENCE:'VCの参加者全員が読み上げ元のテキストチャンネルを閲覧できる必要があります。',
  OWNER:'開始した人が元のVCにいないため停止しました。聞きたいVCに参加して開始し直してください。',
  CONNECTION:'音声接続が切れたか、発言できない状態です。接続・発言権限とサーバーミュートを確認してください。',
  SYNTHESIS:'音声を合成できませんでした。動作診断でVOICEVOXの実行環境を確認してください。',
  SYNTHESIS_WARMUP_TIMEOUT:'分割音声の準備が90秒以内に完了しませんでした。CPU割当・負荷とVOICEVOX環境を確認してください。',
  SYNTHESIS_START_TIMEOUT:'先頭音声が30秒以内に届きませんでした。QuaxlyのCPU負荷・割当と合成スレッド数を確認してください。',
  SYNTHESIS_TIMEOUT:'合成途中の音声が15秒間届きませんでした。CPU負荷と合成スレッド数を確認してください。',
  SYNTHESIS_LIMIT:'文章全体の音声合成が60秒を超えたため停止しました。CPU負荷・割当を確認してください。',
  SYNTHESIS_EXIT:'VOICEVOXの音声プロセスが終了しました。Quaxlyのメモリ・CPUと音声環境を確認してください。',
  SYNTHESIS_PROTOCOL:'VOICEVOXの音声データを確認できませんでした。音声環境と実行バージョンを確認してください。',
  PLAYBACK:'音声の再生を完了できませんでした。音声接続とCPU負荷を確認してください。',
  ENCODING:'Opus変換を完了できませんでした。音声エンコーダとCPU負荷を確認してください。',
};
class BackupFault extends Error{constructor(code){super(messages[code]);this.name='BackupFault';this.code=code;}}
export function backupInfo(value){
  const info={};if(!value||typeof value!=='object')return info;
  if(['features','packed'].includes(value.engine))info.engine=value.engine;
  if(['warmup','waiting','query','synthesis','transfer','unknown'].includes(value.stage))info.stage=value.stage;
  for(const [key,max] of [['parts',256],['activePart',256],['moras',12],['elapsedMs',3600000],['idleMs',3600000],['warmupCpuMs',3600000],['synthesisCpuMs',3600000],['firstAudioCpuMs',3600000],['threads',4],['configuredThreads',4],['protocol',3],['frameStart',3750],['frameEnd',3750],['framesTotal',3750],['framesDone',3750],['warmupParts',256]])if(Number.isInteger(value[key])&&value[key]>=0&&value[key]<=max)info[key]=value[key];
  return info;
}
export function backupFault(error,code,info){const fault=error instanceof BackupFault?error:new BackupFault(Object.hasOwn(messages,code)?code:'PLAYBACK');if(info)fault.info={...backupInfo(info),...backupInfo(fault.info)};return fault;}
export const backupFailure=error=>{const fault=backupFault(error,'PLAYBACK');return {code:fault.code,message:fault.message,...(fault.info?{info:backupInfo(fault.info)}:{})};};
export const safeBackupFailure=value=>value&&Object.hasOwn(messages,value.code)?backupFailure(backupFault(null,value.code,value.info)):null;
export function backupFailureSummary(failure){
  const info=backupInfo(failure.info),stage={warmup:'音声モデル準備',waiting:'音声待ち',query:'文章解析',synthesis:'分割合成',transfer:'音声受信',unknown:'旧音声プロトコル'}[info.stage];
  return `**停止理由 · ${failure.code}**\n${failure.message}${stage?`\n処理：${stage} · 音声受信 ${info.parts??info.warmupParts??0}片${info.activePart!==undefined?` · 対象 ${info.activePart+1}片目`:''}${info.threads?` · ${info.threads}スレッド`:''}${info.framesTotal!==undefined?` · フレーム ${info.framesDone??0}/${info.framesTotal}`:''}\n経過 ${info.elapsedMs??0}ms${info.idleMs!==undefined?` · 最終音声から ${info.idleMs}ms`:''}`:''}`;
}
