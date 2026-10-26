import {ActionRowBuilder,ButtonBuilder,ButtonStyle,PermissionFlagsBits as P,MessageFlags,StringSelectMenuBuilder} from 'discord.js';
import {AdminSessions} from './admin.js';
import {themed,acknowledgePrivate,adminFeatureButton,adminSectionButton,text} from './ui.js';
import {backupFailureSummary,backupWarmupSteps,backupInfo} from './backup-fault.js';
import {capacitySummary} from './system-capacity.js';
import {benchmarkErrorMessage} from './voice-benchmark.js';
import {benchmarkHistoryEntry,benchmarkReport,compareBenchmarks,benchmarkConditionLabels,benchmarkMetricLabels} from './voice-benchmark-history.js';
const {payload}=themed('admin');
class BenchmarkUiError extends Error {}
const row=(...c)=>new ActionRowBuilder().addComponents(...c);
const button=(s,a,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`perf:${s.id}:${s.turn}:${a}`).setLabel(label).setStyle(style);
const stages={warmup:'音声モデル準備',waiting:'音声待ち',query:'文章解析',synthesis:'分割合成',transfer:'音声受信',unknown:'音声待ち'};
const ms=value=>Number.isFinite(value)?`${value.toLocaleString('ja-JP')}ms`:'未計測';
export const benchmarkViews={summary:'概要',timings:'合成・変換',capacity:'CPU・実行環境',notes:'測定範囲・注意点'};
const measurementScope='測定履歴はメモリ内の直近5件です。Bot再起動で消えます。自動測定は行いません。\n合成は準備完了後の時間です。Discordの権限確認・通信・VCで聞こえるまでの時間は含みません。CPU制限は測定中のコンテナ全体の値で、CPU使用率ではありません。メモリは測定時点の値で、ピークではありません。\nCPU実行は全スレッドの合計です。経過との差には実行待ち・入出力等が含まれ、差だけでホストの混雑は断定できません。';
const hearingScope='Discordの権限確認・通信・VCで聞こえるまでの時間は含みません。';
function timingDetails(r){
  let body=`モデル準備${r.warmupMs===null&&Number.isFinite(r.warmupElapsedMs)?'経過':''} **${ms(r.warmupMs??r.warmupElapsedMs)}**\n先頭音声まで **${ms(r.firstAudioMs)}**\n${r.ok?'合成完了':'合成経過'} **${ms(r.synthesisMs)}** · 音声 ${Number.isFinite(r.audioMs)?(r.audioMs/1000).toFixed(2):'未計測'}秒 / ${r.parts??'未確認'}片\n最長の分割待ち **${ms(r.parts>=2?r.maxGapMs:null)}**\nOpus変換 **${ms(r.encodingMs)}**（先頭音声・最大1秒分）\n実時間比 **${Number.isFinite(r.realTimeFactor)?r.realTimeFactor.toFixed(2):'未計測'}**（1未満なら音声の長さより速く合成）`;
  const engine=r.info?.engine??r.failure?.info?.engine;if(engine)body+=`\n合成方式：${engine==='features'?'特徴量を共有して連続生成':'短い句をまとめて生成'}`;
  if(r.encoding?.backend==='worker-opusscript')body+=`\n\nOpus内訳：初期化 **${ms(r.encoding.warmupMs)}** · 変換 **${ms(r.encoding.processMs)}**\n読み上げでは接続時に初期化し、同じVC接続中は変換環境を再利用します。`;
  return body;
}
function cpuDetails(r){
  let body=`${capacitySummary(r.after??r.before)}\n合成スレッド ${r.info?.threads??r.failure?.info?.threads??'未確認'}${r.info?.configuredThreads&&r.info.configuredThreads!==r.info.threads?`（設定上限 ${r.info.configuredThreads}・CPUに合わせて制限）`:''} · 音声プロトコル ${r.info?.protocol??r.failure?.info?.protocol??'未確認'}\nCPU制限発生 **${r.throttledPercent===null||r.throttledPercent===undefined?'未確認':`${r.throttledPercent}%の期間`}** · 制限時間 ${ms(r.throttledMs)}`;
  const cpu={...r.failure?.info,...r.info},hasCpu=['warmupCpuMs','firstAudioCpuMs','synthesisCpuMs'].some(key=>Number.isFinite(cpu[key]));
  if(hasCpu)body+=`\n\nCPU実行：準備${cpu.warmupStep?'（最終記録）':''} **${ms(cpu.warmupCpuMs)}** · 先頭 **${ms(cpu.firstAudioCpuMs)}** · 合成 **${ms(cpu.synthesisCpuMs)}**`;
  if(hasCpu&&cpu.warmupStep)body+='\n準備CPUは最後に届いた記録で、停止時点のCPU時間ではありません。';
  const opus=Number.isFinite(r.encoding?.warmupCpuMs)||Number.isFinite(r.encoding?.processCpuMs);if(opus)body+=`\nOpus CPU：初期化 **${ms(r.encoding.warmupCpuMs)}** · 変換 **${ms(r.encoding.processCpuMs)}**`;
  if(hasCpu||opus)body+='\nCPU実行は処理に使ったCPU時間です。経過との差には実行待ち・入出力等を含みます。差だけでホストの混雑は断定できません。合成は全スレッドの合計なので、経過時間を超える場合があります。';
  return body+'\nCPU制限は測定中のコンテナ全体の値で、CPU使用率ではありません。メモリは測定時点の値で、ピークではありません。';
}
export function benchmarkScreen(s,state){
  const active=state.phase!=='idle',own=state.owner===s.id,r=!active&&state.result?benchmarkHistoryEntry(state.result):null,progress=backupInfo(state.info),confirm=active&&own&&s.cancelIntent,view=Object.hasOwn(benchmarkViews,s.resultView)?s.resultView:'summary';
  let body;
  if(active){
    body=`${confirm?'**測定は続いています。中断しますか？**\n中断する場合は「中断を確定」を押してください。確認は30秒間有効です。\n\n':''}**${{warming:'音声モデルを準備しています',synthesis:'固定文を合成しています',encoding:'音声変換を測定しています',cancelling:'測定を中断しています'}[state.phase]??'測定中です'}**\n${own?'約5秒ごとに進捗を更新します。「状態を更新」でも確認できます。中断は確認後に実行します。':'別の管理者が測定しています。完了後に状態を更新してください。'}\n経過 ${ms(state.elapsedMs)}`;
    if(progress?.stage)body+=`\n処理：${stages[progress.stage]??'未確認'} · 受信 ${progress.parts??0}片${progress.activePart!==undefined?` · ${progress.activePart+1}片目`:''}`;
    if(progress?.warmupStep&&Object.hasOwn(backupWarmupSteps,progress.warmupStep))body+=`\n準備箇所：${backupWarmupSteps[progress.warmupStep]} · この段階 ${ms(progress.warmupStepMs)}${progress.warmupCpuMs!==undefined?`\n準備CPU（最終記録） ${ms(progress.warmupCpuMs)}`:''}`;
  }else if(r){
    body=`**${r.cancelled?(r.cancelReason==='shutdown'?'Bot停止により測定を中断しました':r.cancelReason==='user'?'確認操作で測定を中断しました':'システム経由で測定が中断されました'):r.ok?'測定が完了しました':'測定中に停止しました'}**\n${Number.isFinite(r.measuredAt)?`測定 <t:${Math.floor(r.measuredAt/1000)}:R>`:'測定日時は未確認です'}\n\n`;
    if(view==='summary'){
      body+=`先頭音声まで **${ms(r.firstAudioMs)}**\n${r.ok?'合成完了':'合成経過'} **${ms(r.synthesisMs)}** · 音声 ${Number.isFinite(r.audioMs)?(r.audioMs/1000).toFixed(2):'未計測'}秒 / ${r.parts??'未確認'}片\n実時間比 **${Number.isFinite(r.realTimeFactor)?r.realTimeFactor.toFixed(2):'未計測'}**（1未満なら音声の長さより速く合成）`;
      if(r.ok&&r.realTimeFactor>=1)body+='\n\n合成が音声の長さより遅いため、連続投稿では順番待ちが増える可能性があります。接続時の準備と投稿後の開始待ちは分けて確認してください。測定時の負荷を含む結果です。';
      if(r.failure)body+=`\n\n${backupFailureSummary(r.failure)}`;
      body+='\n\n詳しい時間・CPU・測定条件は選択欄から確認できます。';
    }else if(view==='timings')body+=timingDetails(r);
    else if(view==='capacity')body+=cpuDetails(r);
    else body+=measurementScope;
    if(r.cancelled)body+=`\n\n中断時の経過 **${ms(r.elapsedMs)}**${r.info?.stage?` · ${stages[r.info.stage]??'未確認'}`:''}\n受信 ${r.parts??'未確認'}片${r.info?.activePart!==undefined?` · 処理中 ${r.info.activePart+1}片目`:''}\n中断元はコンソールの「速度測定の操作」で確認できます。`;
  }else body='**この環境の処理速度を測ります**\n固定文でモデル準備・先頭音声・合成完了・Opus変換を測ります。VCへの接続や音声送信は行いません。\n\n音声処理を終えてから開始してください。測定にはCPUを使い、測定後30秒は再実行できません。測定履歴は直近5件、再起動で消えます。自動測定は行いません。';
  if(view!=='notes'||!r)body+=`\n\n${hearingScope}`;body+='\nVOICEVOX:ずんだもん';
  return {...payload(r?`音声の処理速度 / ${benchmarkViews[view]}`:'音声の処理速度',body,{state:confirm||r?.failure||r?.cancelled||r?.ok&&r.realTimeFactor>=1?'warning':r?.ok?'success':'normal',components:[
    row(button(s,'start',active?'測定中':r?'もう一度測定':'測定を開始',ButtonStyle.Primary).setDisabled(active),button(s,'status','状態を更新'),button(s,'history',`測定履歴（${state.historyCount??0}/5）`).setDisabled(!state.historyCount)),
    ...(r?[row(new StringSelectMenuBuilder().setCustomId(`perf:${s.id}:${s.turn}:result-view`).setPlaceholder('測定結果の表示を切り替える').addOptions(Object.entries(benchmarkViews).map(([value,label])=>({value,label,default:value===view}))))]:active?[row(...(confirm?[button(s,'continue','測定を続ける'),button(s,'confirm-cancel','中断を確定',ButtonStyle.Danger)]:[button(s,'cancel','測定を中断',ButtonStyle.Danger).setDisabled(!own||state.phase==='cancelling')]))]:[]),
    row(adminFeatureButton('diagnose'),adminSectionButton('operations')),
  ]}),attachments:[]};
}

const resultStatus=r=>r.cancelled?'中断':r.ok?'完了':'停止';
const historyTime=r=>r.measuredAt===null?'日時未確認':new Date(r.measuredAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false});
const previousCompleted=(entries,selected)=>entries.slice(entries.indexOf(selected)+1).find(r=>r.ok&&!r.cancelled);
export function benchmarkHistoryScreen(s,entries){
  const selected=entries.find(r=>r.id===s.historyId),previous=selected?previousCompleted(entries,selected):null,comparison=selected&&previous?compareBenchmarks(selected,previous):null;
  let body='**測定履歴 · 直近5件**\nメモリ内だけに保持し、Bot再起動で消えます。自動測定は行いません。\n現在進行中の測定は「現在の測定へ」で確認できます。';
  if(selected){
    body+=`\n\n**選択した履歴 #${selected.id} · ${resultStatus(selected)}**\n${historyTime(selected)} JST · Bot v${selected.version}\n${capacitySummary(selected.after??selected.before)}\nモデル準備 **${ms(selected.warmupMs)}** · 先頭音声 **${ms(selected.firstAudioMs)}**\n合成 **${ms(selected.synthesisMs)}** · Opus **${ms(selected.encodingMs)}**\n実時間比 **${Number.isFinite(selected.realTimeFactor)?selected.realTimeFactor.toFixed(2):'未計測'}** · ${selected.parts??'未確認'}片`;
    if(selected.failure)body+=`\n停止理由 ${selected.failure.code}\n${selected.failure.message}`;
    if(comparison){
      body+=`\n\n**直前の完了測定 #${previous.id} との差**\n${historyTime(previous)} JST · Bot v${previous.version}\n`+Object.entries(comparison.metrics).map(([key,value])=>`${benchmarkMetricLabels[key]} ${value===null?'未計測':`${value>0?'+':''}${value.toLocaleString('ja-JP',{maximumFractionDigits:2})}${key==='realTimeFactor'?'':'ms'}`}`).join(' · ');
      if(comparison.different.length)body+='\n条件差：'+comparison.different.map(key=>benchmarkConditionLabels[key]).join('・');
      if(comparison.unknown.length)body+='\n条件未確認：'+comparison.unknown.map(key=>benchmarkConditionLabels[key]).join('・');
      body+='\n差は選択した履歴 − 比較元です。負値は測定値が小さいことを示します。単発の結果で、改善やホスト混雑は断定しません。';
    }else body+='\n\n比較は完了した測定と、その前の完了測定がある場合だけ表示します。';
  }else body+=entries.length?'\n\n選択した履歴は保持期間を過ぎています。「履歴を更新」か下の選択欄から選び直してください。':'\n\n測定履歴はまだありません。「現在の測定へ」から説明を確認して測定できます。';
  body+='\n\nJSONは選択した履歴と比較元の測定値だけです。本文・音声・アカウント/チャンネルID・ENVは含みません。測定値にDiscordの権限確認・通信・聴取までの時間は含みません。';
  return {...payload('音声の診断履歴',body,{components:[
    ...(entries.length?[row(new StringSelectMenuBuilder().setCustomId(`perf:${s.id}:${s.turn}:select-history`).setPlaceholder('確認する測定を選ぶ').addOptions(entries.map(r=>({label:`#${r.id} · ${historyTime(r)}`,description:`${resultStatus(r)} · Bot v${r.version}`,value:String(r.id),default:r.id===selected?.id}))))]:[]),
    row(button(s,'history','履歴を更新'),button(s,'report','選択したJSONを取得',ButtonStyle.Primary).setDisabled(!selected),button(s,'latest','現在の測定へ')),
    row(adminFeatureButton('diagnose'),adminSectionButton('operations')),
  ]}),attachments:[]};
}
export function createBenchmarkController({probe,guild,onDiagnostic=()=>{},now=Date.now,schedule=setInterval,cancel=clearInterval,access=async i=>{const [m,c]=await Promise.all([guild.members.fetch({user:i.user.id,force:true}),guild.channels.fetch(i.channelId,{force:true})]);if(!m.permissions.has(P.Administrator)||!c?.permissionsFor(m)?.has(P.ViewChannel))throw new BenchmarkUiError('処理速度の測定は現在の管理者権限と閲覧権限が必要です。');}}){
  const sessions=new AdminSessions(now);
  const get=(id,userId)=>{try{return sessions.get(id,userId);}catch{throw new BenchmarkUiError('この画面は終了しています。動作診断から開き直してください。');}};
  const check=async(i,s)=>{
    try{await access(i);}catch{throw new BenchmarkUiError('管理者権限とチャンネルの閲覧権限を確認できませんでした。権限を確認して動作診断から開き直してください。');}
    if(s){if(get(s.id,i.user.id)!==s)throw new BenchmarkUiError('元の有効な画面から操作してください。');if(s.channelId!==i.channelId)throw new BenchmarkUiError('元のチャンネルから操作してください。');}
  };
  const report=(stage,e,timing={})=>{try{onDiagnostic({stage,uiRevision:2,...(Number.isInteger(e?.code)&&e.code>=0&&e.code<=599999?{code:e.code}:{}),...timing});}catch{}};
  const acknowledge=async i=>{
    if(i.deferred||i.replied)return true;
    const began=now(),age=began-i.createdTimestamp,ageInfo=Number.isFinite(age)&&age>=0&&age<=3600000?{ageMs:Math.round(age)}:{};
    try{await acknowledgePrivate(i);const elapsed=Math.round(now()-began);if(elapsed>=1000)report('ack-slow',null,{...ageInfo,ackMs:Math.min(3600000,elapsed)});return true;}
    catch(e){report('ack',e,{...ageInfo,ackMs:Math.max(0,Math.min(3600000,Math.round(now()-began)))});return false;}
  };
  const history=()=>{const entries=probe.history?.()??[];return entries.slice(0,5).map(r=>benchmarkHistoryEntry(r)).filter(r=>r.id!==null);};
  const render=async(i,s,valid=()=>true)=>{
    const turn=s.turn,view=s.view,current=()=>valid()&&!s.hidden&&s.turn===turn&&s.view===view&&(!s.messageId||!i.message?.id||s.messageId===i.message.id);
    if(!current())return;await check(i,s);if(!current())return;
    const state=probe.snapshot();if(state.phase==='idle'||s.cancelIntent?.expires<=now())s.cancelIntent=null;
    const entries=history();await i.editReply(s.view==='history'?benchmarkHistoryScreen(s,entries):benchmarkScreen(s,{...state,historyCount:entries.length}));
  };
  const error=async(i,e)=>{
    // A rejected initial callback cannot be acknowledged again with the same token.
    if(e?.code===10062||e?.code===40060){report('reply',e);return;}
    try{const p={...payload('音声の処理速度',text(e instanceof BenchmarkUiError?e.message:benchmarkErrorMessage(e)??'操作を完了できませんでした。動作診断から開き直して、もう一度お試しください。'),{state:'error',components:[row(adminFeatureButton('diagnose'),adminSectionButton('operations'))]}),attachments:[]};if(i.deferred||i.replied)await i.editReply(p);else await i.reply({...p,flags:MessageFlags.Ephemeral});}catch(displayError){report('error',displayError);}
  };
  return {sessions,acknowledge,
    leave(i){if(i.customId?.startsWith('perf:'))return;for(const s of sessions.sessions.values())if(s.userId===i.user.id&&s.channelId===i.channelId&&s.messageId&&s.messageId===i.message?.id)s.hidden=true;},
    async open(i){
      if(!await acknowledge(i))return;
      try{await check(i);const previous=[...sessions.sessions.values()].find(s=>s.userId===i.user.id&&s.busy);if(previous&&previous.channelId!==i.channelId)throw new BenchmarkUiError('元のチャンネルで測定の状態を確認してください。');const s=previous??sessions.resume(i.user.id,i.channelId)??sessions.create(i.user.id);s.channelId=i.channelId;s.messageId=i.message?.id;s.hidden=false;s.turn??=0;await render(i,s);}catch(e){await error(i,e);}
    },
    async handle(i){
      if(!await acknowledge(i))return;
      let s,locked=false,measurement,timer,finished=false,refreshing=false,replyTurn;
      const stopProgress=()=>{finished=true;if(timer!==undefined)cancel(timer);timer=undefined;};
      try{
        const [,id,turn,action]=i.customId.split(':');s=get(id,i.user.id);await check(i,s);if(String(s.turn)!==turn)throw new BenchmarkUiError('古い画面です。動作診断から開き直してください。');
        if(action==='start'){
          if(s.busy)throw new BenchmarkUiError('測定中です。状態の更新か中断を選んでください。');
          s.busy=true;locked=true;s.cancelIntent=null;s.view='home';s.resultView='summary';s.turn++;measurement=probe.run(s.id);measurement.catch(()=>{});
          try{await render(i,s);}catch(e){report('progress',e);}
          timer=schedule(()=>{if(finished||refreshing||s.hidden)return;refreshing=true;void render(i,s,()=>!finished).catch(e=>{report('progress',e);if(timer!==undefined)cancel(timer);timer=undefined;}).finally(()=>refreshing=false);},5000);timer?.unref?.();
          await measurement;stopProgress();await render(i,s);
        }else if(action==='result-view'){
          const state=probe.snapshot();if(s.busy||s.view==='history'||state.phase!=='idle'||!state.result||i.values?.length!==1||!Object.hasOwn(benchmarkViews,i.values[0]))throw new BenchmarkUiError('完了した測定結果の選択欄から表示を選んでください。');s.resultView=i.values[0];s.turn++;await render(i,s);
        }else if(['history','select-history','latest','report'].includes(action)){
          const turn=s.turn;
          if(action==='latest'){s.view='home';s.cancelIntent=null;s.turn++;await render(i,s);return;}
          const entries=history();
          if(action==='history'){s.view='history';if(!entries.some(r=>r.id===s.historyId))s.historyId=entries[0]?.id;s.cancelIntent=null;s.turn++;await render(i,s);return;}
          if(s.view!=='history')throw new BenchmarkUiError('測定履歴の画面から操作してください。');
          if(action==='select-history'){
            const selected=entries.find(r=>String(r.id)===i.values?.[0]);if(!selected)throw new BenchmarkUiError('この履歴は保持期間を過ぎています。履歴を更新してください。');
            s.historyId=selected.id;s.turn++;await render(i,s);return;
          }
          const selected=entries.find(r=>r.id===s.historyId);if(!selected)throw new BenchmarkUiError('この履歴は保持期間を過ぎています。履歴を更新してください。');
          replyTurn=turn;const previous=previousCompleted(entries,selected),data=Buffer.from(JSON.stringify(benchmarkReport(selected,previous),null,2)+'\n');
          if(data.length>32768||Number.isFinite(i.attachmentSizeLimit)&&data.length>i.attachmentSizeLimit)throw new BenchmarkUiError('この操作ではレポートを添付できません。画面の測定値を確認してください。');
          await check(i,s);
          if(s.turn!==turn||s.view!=='history'||s.historyId!==selected.id||s.hidden||!history().some(r=>r.id===selected.id)||previous&&!history().some(r=>r.id===previous.id))throw new BenchmarkUiError('履歴の画面が変わりました。最新の履歴から取得してください。');
          s.turn++;replyTurn=s.turn;await i.editReply({...benchmarkHistoryScreen(s,history()),files:[{attachment:data,name:`astral-voice-measurement-${selected.id}.json`}]});
        }else if(['status','cancel','confirm-cancel','continue'].includes(action)){
          if(action==='cancel'||action==='confirm-cancel'){
            const state=probe.snapshot();
            if(state.phase==='idle'){s.cancelIntent=null;s.turn++;await render(i,s);return;}
            if(state.owner!==s.id)throw new BenchmarkUiError('測定を開始した画面から操作してください。');
            if(action==='cancel'){s.cancelIntent={expires:now()+30000};report('cancel-prompt');}
            else{
              if(!s.cancelIntent||s.cancelIntent.expires<=now()){s.cancelIntent=null;throw new BenchmarkUiError('中断の確認が期限切れです。もう一度「測定を中断」から確認してください。');}
              s.cancelIntent=null;report('cancel-confirmed');probe.cancel(s.id,'confirmed-user');
            }
          }else if(action==='continue')s.cancelIntent=null;
          s.turn++;await render(i,s);
        }else throw new BenchmarkUiError('操作を確認してください。');
      }catch(e){if(measurement)await measurement.catch(()=>{});if(!s?.hidden&&(replyTurn===undefined||s.turn===replyTurn))await error(i,e);}finally{stopProgress();if(locked)s.busy=false;}
    },
  };
}
