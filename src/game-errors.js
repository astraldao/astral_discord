// Only deliberate local validation messages may be rendered; SDK and native errors stay private.
export class GameError extends Error {
  constructor(message){super(message);this.name='GameError';}
}
export const gameErrorFallback='操作を完了できませんでした。結果が反映済みの場合があるため、現在の権限や状態・履歴を確認して、画面を開き直してください。';
export const gameErrorMessage=error=>error instanceof GameError&&typeof error.message==='string'&&error.message?error.message:gameErrorFallback;
