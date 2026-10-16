import {ActionRowBuilder,ButtonBuilder,ButtonStyle,PermissionFlagsBits as P,MessageFlags} from 'discord.js';
import {AdminSessions} from './admin.js';
import {payload,acknowledgePrivate,adminFeatureButton,adminSectionButton,text} from './ui.js';
import {backupFailureSummary} from './backup-fault.js';
import {capacitySummary} from './system-capacity.js';
const row=(...c)=>new ActionRowBuilder().addComponents(...c);
const button=(s,a,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`perf:${s.id}:${s.turn}:${a}`).setLabel(label).setStyle(style);
const ms=value=>Number.isFinite(value)?`${value.toLocaleString('ja-JP')}ms`:'未計測';
export function benchmarkScreen(s,state){
  const active=state.phase!=='idle',own=state.owner===s.id,r=state.result;
  let body=active?`**${{warming:'音声モデルを準備しています',synthesis:'固定文を合成しています',encoding:'音声変換を測定しています',cancelling:'測定を中断しています'}[state.phase]??'測定中です'}**\n${own?'「状態を更新」で進捗を確認できます。中断すると音声プロセスを終了します。':'別の管理者が測定しています。完了後に状態を更新してください。'}\n経過 ${ms(state.elapsedMs)}`:r?`**${r.cancelled?(r.cancelReason==='shutdown'?'Bot停止により測定を中断しました':r.cancelReason==='user'?'操作により測定を中断しました':'測定を中断しました'):r.ok?'測定が完了しました':'測定中に停止しました'}**\n測定 <t:${Math.floor(r.measuredAt/1000)}:R>\n\n${capacitySummary(r.after??r.before)}\n合成スレッド ${r.info?.threads??r.failure?.info?.threads??'未確認'} · 音声プロトコル ${r.info?.protocol??r.failure?.info?.protocol??'未確認'}\n\nモデル準備 **${ms(r.warmupMs)}**\n先頭音声まで **${ms(r.firstAudioMs)}**\n合成完了 **${ms(r.synthesisMs)}** · 音声 ${Number.isFinite(r.audioMs)?(r.audioMs/1000).toFixed(2):'未計測'}秒 / ${r.parts}片\n最長の分割待ち **${ms(r.parts>=2?r.maxGapMs:null)}**\nOpus変換 **${ms(r.encodingMs)}**（先頭音声・最大1秒分）\n実時間比 **${Number.isFinite(r.realTimeFactor)?r.realTimeFactor.toFixed(2):'未計測'}**（1未満なら音声の長さより速く合成）\nCPU制限発生 **${r.throttledPercent===null||r.throttledPercent===undefined?'未確認':`${r.throttledPercent}%の期間`}** · 制限時間 ${ms(r.throttledMs)}`:'**この環境の処理速度を測ります**\n固定のテスト文で、モデル準備・先頭音声・合成完了・Opus変換を測ります。\nVCへの接続や音声送信は行いません。\n\nCPUを使用するため、読み上げ・VC入室などの音声処理を終えてから開始してください。測定後30秒は再実行できません。';
  if(active&&state.info?.stage)body+=`\n処理：${{warmup:'音声モデル準備',waiting:'音声待ち',query:'文章解析',synthesis:'分割合成',transfer:'音声受信',unknown:'音声待ち'}[state.info.stage]} · 受信 ${state.info.parts??0}片${state.info.activePart!==undefined?` · ${state.info.activePart+1}片目`:''}`;
  if(r?.cancelled)body+=`\n\n中断時の経過 **${ms(r.elapsedMs)}**${r.info?.stage==='warmup'?' · 音声モデル準備中':''}\n中断操作をしていない場合は、Botの停止・再起動状況を確認してください。`;
  if(r?.failure)body+=`\n\n${backupFailureSummary(r.failure)}`;
  if(r?.ok&&r.realTimeFactor>=1)body+='\n\n合成が音声の長さより遅いため、連続投稿では順番待ちが増える可能性があります。CPU割当・負荷と合成スレッド数を確認してください。';
  body+='\n\n合成は準備完了後の時間です。Discordの権限確認・通信・VCで聞こえるまでの時間は含みません。CPU制限は測定中のコンテナ全体の値で、CPU使用率ではありません。メモリは測定時点の値で、ピークではありません。\nVOICEVOX:ずんだもん';
  return {...payload('音声の処理速度',body,{state:r?.failure?'warning':r?.ok?'success':'normal',components:[row(...(active?[button(s,'status','状態を更新',ButtonStyle.Primary),button(s,'cancel','測定を中断').setDisabled(!own||state.phase==='cancelling')]:[button(s,'start',r?'もう一度測定':'測定を開始',ButtonStyle.Primary),button(s,'status','状態を更新')])),row(adminFeatureButton('diagnose'),adminSectionButton('operations'))]}),attachments:[]};
}
export function createBenchmarkController({probe,guild,onDiagnostic=()=>{},access=async i=>{const [m,c]=await Promise.all([guild.members.fetch({user:i.user.id,force:true}),guild.channels.fetch(i.channelId,{force:true})]);if(!m.permissions.has(P.Administrator)||!c?.permissionsFor(m)?.has(P.ViewChannel))throw new Error('処理速度の測定は現在の管理者権限と閲覧権限が必要です。');}}){
  const sessions=new AdminSessions();
  const check=async(i,s)=>{await access(i);if(s){sessions.get(s.id,i.user.id);if(s.channelId!==i.channelId)throw new Error('元のチャンネルから操作してください。');}};
  const report=(stage,e)=>{try{onDiagnostic({stage,...(Number.isInteger(e?.code)&&e.code>=0&&e.code<=599999?{code:e.code}:{})});}catch{}};
  const render=async(i,s)=>{if(s.hidden)return;await check(i,s);if(!s.hidden)await i.editReply(benchmarkScreen(s,probe.snapshot()));};
  const error=async(i,e)=>{try{const p={...payload('音声の処理速度',text(e.message),{state:'error',components:[row(adminFeatureButton('diagnose'),adminSectionButton('operations'))]}),attachments:[]};if(i.deferred||i.replied)await i.editReply(p);else await i.reply({...p,flags:MessageFlags.Ephemeral});}catch(displayError){report('error',displayError);}};
  return {sessions,leave(i){if(i.customId?.startsWith('perf:'))return;for(const s of sessions.sessions.values())if(s.userId===i.user.id&&s.channelId===i.channelId&&s.messageId&&s.messageId===i.message?.id)s.hidden=true;},async open(i){try{await acknowledgePrivate(i);await check(i);const previous=[...sessions.sessions.values()].find(s=>s.userId===i.user.id&&s.busy);if(previous&&previous.channelId!==i.channelId)throw new Error('元のチャンネルで測定の状態を確認してください。');const s=previous??sessions.resume(i.user.id,i.channelId)??sessions.create(i.user.id);s.channelId=i.channelId;s.messageId=i.message?.id;s.hidden=false;s.turn??=0;await check(i,s);await i.editReply(benchmarkScreen(s,probe.snapshot()));}catch(e){await error(i,e);}},async handle(i){let s,locked=false,measurement;try{
    await acknowledgePrivate(i);const [,id,turn,action]=i.customId.split(':');s=sessions.get(id,i.user.id);await check(i,s);if(String(s.turn)!==turn)throw new Error('古い画面です。動作診断から開き直してください。');
    if(action==='start'){
      if(s.busy)throw new Error('測定中です。状態の更新か中断を選んでください。');s.busy=true;locked=true;s.turn++;measurement=probe.run(s.id);measurement.catch(()=>{});
      // A Discord reply is separate from the fixed-text measurement. Preserve the result even if the reply fails.
      try{await render(i,s);}catch(e){report('progress',e);}await measurement;await render(i,s);
    }else if(action==='status'||action==='cancel'){
      if(action==='cancel')probe.cancel(s.id);s.turn++;await check(i,s);await i.editReply(benchmarkScreen(s,probe.snapshot()));
    }else throw new Error('操作を確認してください。');
  }catch(e){if(measurement)await measurement.catch(()=>{});if(!s?.hidden)await error(i,e);}finally{if(locked)s.busy=false;}}};
}
