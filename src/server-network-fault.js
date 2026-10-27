import {ServerNetworkError} from './server-network-store.js';
const fields={guild:'サーバー情報',roles:'ロール',channels:'チャンネル',emojis:'絵文字',stickers:'スタンプ',sounds:'サウンドボード',automod:'AutoMod',onboarding:'オンボーディング',welcome:'ウェルカム画面',snapshot:'構成の組み立て',bot:'Botの参加・権限',member:'実行者の参加・権限',overwrite:'個別権限の対象メンバー',origin:'操作元チャンネル'};
const phases=Object.fromEntries(['main','sub'].flatMap(side=>Object.entries(fields).map(([key,label])=>[`${side}-${key}`,`${side==='main'?'メイン':'サブ'}の${label}`])));
const knownCodes=new Set([10003,10004,10007,10069,50001,50013,50035,10062,40060]);
const httpCodes=new Set([401,403,404,408,429,500,502,503,504]);
const connections=new Set(['ECONNRESET','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_SOCKET','ABORT_ERR']);
export function safeNetworkCode(e){if(knownCodes.has(e?.code))return `DISCORD_${e.code}`;if(httpCodes.has(e?.status))return `HTTP_${e.status}`;if(connections.has(e?.code))return e.code;if(e?.name==='AbortError'||e?.name==='TimeoutError')return 'TIMEOUT';return 'UNKNOWN';}
export class NetworkReadError extends ServerNetworkError {
 constructor(phase,error){const p=Object.hasOwn(phases,phase)?phase:'unknown',code=safeNetworkCode(error),label=phases[p]??'設定';
 const hint=error?.code===10004?'Botの招待先とサーバーIDを確認してください。':error?.code===10007?'実行者または対象メンバーの参加状況を確認してください。':[50001,50013].includes(error?.code)||[401,403].includes(error?.status)?'Botの参加状況と管理者権限を確認してください。':error?.code===10003?'対象チャンネルの存在と閲覧権限を確認してください。':error?.status===429?'Discordの制限中です。少し待ってから確認し直してください。':'通信状態とDiscord側の設定を確認してから、確認し直してください。';
 super(`${label}を取得できませんでした。${hint}\n診断コード：${p} / ${code}`);this.phase=p;this.safeCode=code;
 }
}
export async function networkRead(phase,operation){try{return await operation();}catch(e){if(e instanceof ServerNetworkError)throw e;throw new NetworkReadError(phase,e);}}
// Discord reports an unconfigured welcome screen with this exact code. Missing access is never an empty setting.
export const readWelcome=(guild,side)=>networkRead(`${side}-welcome`,async()=>{try{return await guild.fetchWelcomeScreen();}catch(e){if(e?.code===10069)return null;throw e;}});
export function networkDiagnostic(stage,error){return {stage:['open','copy-preview','copy-apply','interaction'].includes(stage)?stage:'interaction',phase:error instanceof NetworkReadError?error.phase:error instanceof ServerNetworkError?'validation':'unknown',code:error instanceof NetworkReadError?error.safeCode:safeNetworkCode(error),...(stage==='copy-preview'?{outcome:'not-started'}:{})};}
