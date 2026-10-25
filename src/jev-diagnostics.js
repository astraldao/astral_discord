import {ActionRowBuilder,ButtonBuilder,ButtonStyle} from 'discord.js';
import {beatApiDiceModels,beatApiDiceSample,beatApiDiceThreshold,safeDiceJudgeState} from './beatapi-dice.js';
import {themed} from './ui.js';
const {payload}=themed('admin');
const failures={disabled:'APIキーが未設定です。ホスティング側のBEATAPI_API_KEYを設定し、プロセス全体を再起動してください。','configuration-error':'起動設定のモデル名を確認してください。jev-1.14-free または jev-1.14 に対応しています。','rate-limit':'APIの回数制限です。待機後にもう一度試してください。','no-credits':'有料版の残高が不足しています。BeatAPIの残高を確認してください。','http-error':'APIがエラーを返しました。キー・モデルの利用権限を確認してください。','invalid-response':'通信または応答の形式を確認できませんでした。接続先の稼働状況を確認してください。',timeout:'3秒以内に応答を確認できませんでした。自動再送はしません。',busy:'チャットの判定処理が混雑しています。少し待って試してください。',cooldown:'APIへの送信を待機中です。待機後にもう一度試してください。','test-cooldown':'接続試験は10秒に1回です。少し待って試してください。',cancelled:'権限または画面の状態が変わったため、送信を中止しました。'};
export function safeJevProbe(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const status=['allow','deny','uncertain'].includes(raw.status)||Object.hasOwn(failures,raw.status)?raw.status:'invalid-response';
  const finite=(n,max)=>Number.isFinite(n)&&n>=0&&n<=max;
  return {status,model:beatApiDiceModels.includes(raw.model)?raw.model:null,score:finite(raw.score,1)?raw.score:null,attempts:Array.isArray(raw.attempts)?raw.attempts.slice(0,2).filter(m=>beatApiDiceModels.includes(m)):[],elapsedMs:finite(raw.elapsedMs,3600000)?Math.round(raw.elapsedMs):null,checkedAt:finite(raw.checkedAt,8640000000000000)?Math.floor(raw.checkedAt):null,retryAfterSeconds:Number.isInteger(raw.retryAfterSeconds)&&finite(raw.retryAfterSeconds,600)?raw.retryAfterSeconds:0};
}
export function jevDiagnosticsScreen(s){
  const config=safeDiceJudgeState(s.jevConfig),r=safeJevProbe(s.jevResult),success=r&&['allow','deny','uncertain'].includes(r.status)&&r.model&&r.score!==null;
  const setup=!config?.configured?(config?.last==='configuration-error'?failures['configuration-error']:failures.disabled):`設定モデル **${config.model}**\n${config.fallback?'無料版の429時だけ有料版へ切り替えます。有料版の利用には料金が発生します。':config.model==='jev-1.14'?'この設定は有料版を使います。料金が発生します。':'無料版のみを使います。'}`;
  const result=!r?'**まだ試験していません**':`${r.checkedAt?`確認 <t:${Math.floor(r.checkedAt/1000)}:R>\n`:''}**${success?'接続成功 · Jevから応答を受信':'試験を完了できませんでした'}**\n${r.model?`使用モデル **${r.model}**\n`:''}${r.attempts.length===2?'無料版の回数制限 → 有料版へ切り替え\n':''}${r.elapsedMs!==null?`所要時間 **${r.elapsedMs.toLocaleString('ja-JP')}ms**${r.attempts.length?'（通信・判定を含む）':''}\n`:''}${success?`判定値 **${r.score.toFixed(4)}** · 閾値 ${beatApiDiceThreshold.toFixed(2)}\nチャットなら **${r.status==='allow'?'返信する判定':'見送る判定'}** です。`:failures[r.status]??failures['invalid-response']}${r.retryAfterSeconds?`\n待機の目安 **${r.retryAfterSeconds}秒**`:''}`;
  const b=(action,label)=>new ButtonBuilder().setCustomId(`admin:${s.id}:${action}`).setLabel(label).setStyle(ButtonStyle.Secondary);
  return payload('Jev / 接続試験',`${result}\n\n**送信する固定の例文**\n「${beatApiDiceSample}」\n\n${setup}\n\n「Jevを試す」でBeatAPIへ実際に送信します。チャット本文・履歴は送らず、ダイスの抽選・投稿もしません。通常の明確な依頼はJevを使わず、曖昧な短文だけをJevへ送ります。`,{...(r?{state:success?'success':'warning'}:{}),components:[new ActionRowBuilder().addComponents(b(`jev-run:${s.jevToken}`,r?'もう一度試す':'Jevを試す').setStyle(ButtonStyle.Primary).setDisabled(!config?.configured),b('nav-diagnostics','診断へ戻る'))]});
}
