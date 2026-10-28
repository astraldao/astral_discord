import {safeNetworkCode} from './server-network-codes.js';
export {safeNetworkCode} from './server-network-codes.js';
import {ServerNetworkError} from './server-network-store.js';
import {copyStepInfo} from './server-copy-steps.js';
const fields={guild:'サーバー情報',roles:'ロール',channels:'チャンネル',emojis:'絵文字',stickers:'スタンプ',sounds:'サウンドボード',automod:'AutoMod',onboarding:'オンボーディング',welcome:'ウェルカム画面',snapshot:'構成の組み立て',bot:'Botの参加・権限',member:'実行者の参加・権限',overwrite:'個別権限の対象メンバー',origin:'操作元チャンネル'};
const phases=Object.fromEntries(['main','sub'].flatMap(side=>Object.entries(fields).map(([key,label])=>[`${side}-${key}`,`${side==='main'?'メイン':'サブ'}の${label}`])));
export class NetworkReadError extends ServerNetworkError {
 constructor(phase,error){const p=Object.hasOwn(phases,phase)?phase:'unknown',code=safeNetworkCode(error),label=phases[p]??'設定';
 const hint=code==='HTTP_403_NON_JSON'?'JSON形式ではない403応答です。Discordの詳細エラー番号はありません。ホストからDiscordへの通信経路やDiscord側の制限を確認してください。これだけで権限・2FA不足とは断定できません。':code==='HTTP_403'?'HTTP 403で拒否されましたが、詳細なDiscordエラー番号を取得できません。権限不足とは断定できません。通信経路とDiscord側の制限も確認してください。':code==='DISCORD_10004'?'Botの招待先とサーバーIDを確認してください。':code==='DISCORD_10007'?'実行者または対象メンバーの参加状況を確認してください。':['DISCORD_50001','DISCORD_50013'].includes(code)||[401,403].includes(error?.status)?'Botの参加状況と管理者権限を確認してください。':code==='DISCORD_10003'?'対象チャンネルの存在と閲覧権限を確認してください。':error?.status===429?'Discordの制限中です。少し待ってから確認し直してください。':'通信状態とDiscord側の設定を確認してから、確認し直してください。';
 super(`${label}を取得できませんでした。${hint}\n診断コード：${p} / ${code}`);this.phase=p;this.safeCode=code;
 }
}
export async function networkRead(phase,operation){try{return await operation();}catch(e){if(e instanceof ServerNetworkError)throw e;throw new NetworkReadError(phase,e);}}
export class NetworkWriteError extends ServerNetworkError {
 constructor(operation,error){const step=copyStepInfo(operation),code=safeNetworkCode(error),hint=code==='HTTP_403_NON_JSON'?'JSON形式ではない403応答です。Discordの詳細エラー番号はありません。ホストからDiscordへの通信経路やDiscord側の制限を確認してください。これだけで権限・2FA不足とは断定できません。':code==='HTTP_403'?'HTTP 403で拒否されましたが、詳細なDiscordエラー番号を取得できません。権限不足とは断定できません。'+(step.key==='reset-automod'?'サブのDiscord設定で対象AutoModを手動削除し、「AutoModの結果を確認」から再確認できます。':'通信経路とDiscord側の制限も確認してください。'):code==='DISCORD_40006'?'Discordがこの機能を一時停止しています。制限が解消するまで処理記録を保持してください。':code==='DISCORD_20001'?'この操作はBotから利用できません。Discordの仕様を確認してください。':code==='DISCORD_40333'?'Discord側の通信制限です。ホストからDiscordへの接続を確認してください。':code==='DISCORD_60003'?'Discordが二要素認証を要求しました。サーバーの安全設定とBot所有者の認証設定を確認してください。':code==='DISCORD_50074'?'コミュニティの必須チャンネル参照を確認してください。':['DISCORD_350000','DISCORD_350001'].includes(code)?'オンボーディングの既定チャンネル数・投稿権限などの条件を確認してください。':code==='DISCORD_50026'?'Botの招待時のスコープを確認してください。':error?.status===403||['DISCORD_50001','DISCORD_50013'].includes(code)?'Discordが操作を拒否しました。Botの管理権限・ロール階層・操作対象の制約を確認してください。':'処理記録とDiscord側の状態を確認してください。';
 super(`${step.label}処理で停止しました。${hint}\n診断コード：${step.phase} / ${code}\n削除済みの構成は元に戻せません。自動で再実行しません。`);this.phase=step.phase;this.safeCode=code;this.step=step.key;
 }
}
export async function networkWrite(step,operation){try{return await operation();}catch(e){throw new NetworkWriteError(step,e);}}
// Discord reports an unconfigured welcome screen with this exact code. Missing access is never an empty setting.
export const readWelcome=(guild,side)=>networkRead(`${side}-welcome`,async()=>{try{return await guild.fetchWelcomeScreen();}catch(e){if(e?.code===10069)return null;throw e;}});
export function networkDiagnostic(stage,error){const known=error instanceof NetworkReadError||error instanceof NetworkWriteError;return {stage:['open','copy-preview','copy-apply','interaction'].includes(stage)?stage:'interaction',phase:known?error.phase:error instanceof ServerNetworkError?'validation':'unknown',code:known?error.safeCode:safeNetworkCode(error),...(stage==='copy-preview'?{outcome:'not-started'}:{})};}
