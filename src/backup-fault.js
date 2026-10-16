// Only these fixed messages may leave the audio pipeline. Never expose raw errors or text.
const messages={
  ACCESS:'テキスト・VCの権限を確認できませんでした。Botの閲覧・接続・発言権限を確認してください。',
  AUDIENCE:'VCの参加者全員が読み上げ元のテキストチャンネルを閲覧できる必要があります。',
  OWNER:'開始した人が元のVCにいないため停止しました。聞きたいVCに参加して開始し直してください。',
  CONNECTION:'音声接続が切れたか、発言できない状態です。接続・発言権限とサーバーミュートを確認してください。',
  SYNTHESIS:'音声を合成できませんでした。動作診断でVOICEVOXの実行環境を確認してください。',
  SYNTHESIS_TIMEOUT:'音声合成が15秒以内に完了しませんでした。CPU負荷と合成スレッド数を確認してください。',
  SYNTHESIS_EXIT:'VOICEVOXの音声プロセスが終了しました。Quaxlyのメモリ・CPUと音声環境を確認してください。',
  SYNTHESIS_PROTOCOL:'VOICEVOXの音声データを確認できませんでした。音声環境と実行バージョンを確認してください。',
  PLAYBACK:'音声の再生を完了できませんでした。音声接続とCPU負荷を確認してください。',
};
class BackupFault extends Error{constructor(code){super(messages[code]);this.name='BackupFault';this.code=code;}}
export function backupFault(error,code){return error instanceof BackupFault?error:new BackupFault(Object.hasOwn(messages,code)?code:'PLAYBACK');}
export const backupFailure=error=>{const fault=backupFault(error,'PLAYBACK');return {code:fault.code,message:fault.message};};
