import {actionPicker} from './compact-controls.js';
import {safeDiceJudgeState,diceJudgeSummary} from './beatapi-dice.js';
import {stat,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {ActionRowBuilder,ButtonBuilder,ButtonStyle,PermissionFlagsBits as P,ChannelType} from 'discord.js';
import {themed} from './ui.js';
import {systemCapacity,capacitySummary} from './system-capacity.js';
import {safeBackupFailure,backupFailureSummary} from './backup-fault.js';
const {payload}=themed('admin');
const exists=async(path,kind)=>{try{const s=await stat(path);return kind==='file'?s.isFile():s.isDirectory();}catch{return false;}};
export async function voiceComponents(root=process.cwd(),env=process.env){
  const base=resolve(root,env.VOICEVOX_ROOT||'voicevox');
  const python=env.VOICEVOX_PYTHON || join(root,'.voicevox-venv/bin/python');
  let libraries=[];try{libraries=await readdir(join(base,'onnxruntime/lib'));}catch{}
  const enhanced=join(base,'dict/japanese-plus'),fallback=join(base,'dict/open_jtalk_dic_utf_8-1.11');
  const dictionary=env.VOICEVOX_DICTIONARY?resolve(root,env.VOICEVOX_DICTIONARY):await exists(join(enhanced,'sys.dic'),'file')?enhanced:fallback;
  return {python:await exists(resolve(root,python),'file'),runtime:libraries.some(n=>/^libvoicevox_onnxruntime.*\.(so(?:\.\d+)*|dylib)$/.test(n)),model:await exists(join(base,'models/vvms/0.vvm'),'file'),dictionary:await exists(join(dictionary,'sys.dic'),'file')};
}
export function createDiagnostics({settings,guild,version,pendingCount,components=()=>voiceComponents(),backupState=()=>({enabled:false,active:false}),diceState=()=>null,capacity=systemCapacity}){
  return async()=>{
    const c=settings.get(),[voice,spec]=await Promise.all([components(),capacity()]);await guild.channels.fetch();const bot=await guild.members.fetchMe();
    const ids=[...(c.lobbyId?[c.lobbyId]:[]),...c.targetIds];
    const channels=ids.map(id=>{
      const channel=guild.channels.cache.get(id),lobby=id===c.lobbyId;
      if(channel?.type!==ChannelType.GuildVoice)return {id,lobby,status:'VCが見つかりません'};
      const permissions=channel.permissionsFor(bot),requirements=[[P.ViewChannel,'閲覧'],[P.Connect,'接続'],[P.MoveMembers,'メンバー移動'],[P.SendMessages,'送信'],[P.EmbedLinks,'埋め込み'],...(lobby?[[P.ReadMessageHistory,'履歴']]:c.voice?[[P.Speak,'発言']]:[])];
      const missing=requirements.filter(([bit])=>!permissions?.has(bit)).map(([,name])=>name);
      return {id,lobby,status:missing.length?`不足：${missing.join('・')}`:'必要な権限あり'};
    });
    // A whitelist, never environment variables, raw exceptions, TXT or email.
    const backup=backupState(),dice=diceState(),judge=safeDiceJudgeState(dice?.judge),lastFailure=safeBackupFailure(backup.lastFailure);
    return {checkedAt:Date.now(),version,node:process.version,uptime:Math.floor(process.uptime()/60),pending:pendingCount(),...(dice?{dice:{enabled:dice.enabled===true,fullContent:dice.fullContent===true,...(judge?{judge}:{})}}:{}),voiceEnabled:c.voice,voice,channels,capacity:spec,backup:{enabled:backup.enabled===true,active:backup.active===true,...(lastFailure?{lastFailure}:{})}};
  };
}
export const diagnosticTabs={overview:'概要',audio:'音声・読み上げ',dice:'ダイス・Jev',channels:'VC・権限',capacity:'実行環境'};
const voiceLabels={python:'Python実行ファイル',runtime:'音声ランタイム',model:'ずんだもんモデル',dictionary:'日本語辞書'};
export function diagnosticActions(s){
  if(s.view==='diagnostics')return [...Object.entries(diagnosticTabs).map(([tab,label])=>({value:`diagnostics-tab-${tab}`,label,description:tab==='overview'?'確認したい項目と全体の状態':`${label}の詳細を見る`,default:tab===(s.diagnosticTab??'overview')})),{value:'open-jev',label:'Jevを試す',description:'実際にAPIへ接続・モデルと応答時間を確認'},{value:'diagnostics-help',label:'対処の手順',description:'確認結果から次の操作を探す'},{value:'open-security',label:'脆弱性診断',description:'依存パッケージの診断画面を開く'}];
  if(s.view==='diagnostics-help')return [{value:'nav-vc',label:'VC設定',description:'ロビーと行き先を確認する'},{value:'nav-audio',label:'音声設定',description:'参加告知・音量・導入手順'},{value:'open-runtime',label:'ENV・起動設定',description:'読み上げの有効化・スレッド数'}];
  return [];
}
export function diagnosticsScreen(s){
  const d=s.diagnostics;if(!d)throw new Error('診断を開き直してください。');
  const tab=Object.hasOwn(diagnosticTabs,s.diagnosticTab)?s.diagnosticTab:'overview',missing=Object.keys(voiceLabels).filter(key=>!d.voice[key]),channels=d.channels.filter(c=>c.status!=='必要な権限あり'),judge=safeDiceJudgeState(d.dice?.judge);
  const issues=[...(!d.channels.length?['VCが未設定です']:channels.length?[`VC・権限 ${channels.length}件を確認してください`]:[]),...(missing.length&&(d.voiceEnabled||d.backup?.enabled)?[`音声の構成要素 ${missing.length}項目が未確認です`]:[]),...(d.backup?.lastFailure?['読み上げの直前の停止理由を確認できます']:[]),...(['configuration-error','no-credits','http-error','invalid-response','timeout'].includes(judge?.last)?['Jevの直前の状態を確認してください']:[])];
  const pages=tab==='channels'?Math.max(1,Math.ceil(d.channels.length/5)):1;s.page=Math.max(0,Math.min(s.page??0,pages-1));
  let body=`${d.checkedAt?`確認 <t:${Math.floor(d.checkedAt/1000)}:R> · `:''}Bot v${d.version}\n\n`,state='normal';
  if(tab==='overview'){
    state=issues.length?'warning':'normal';body+=`**${issues.length?`確認したい項目 ${issues.length}件`:'確認した範囲に不足はありません'}**\n${issues.map(x=>`• ${x}`).join('\n')||'ファイルと権限の確認結果です。接続・再生は利用時に確認してください。'}\n\n**音声告知** ${d.voiceEnabled?'ON':'OFF'} · 構成要素 ${4-missing.length}/4確認\n${d.backup?`**読み上げ** 起動設定 ${d.backup.enabled?'ON':'OFF'} · ${d.backup.active?'使用中':'停止中'}\n`:''}${d.dice?`**ダイス** ${d.dice.enabled?'ON':'OFF'} · ${d.dice.fullContent?'通常投稿に対応':'Botメンション付き投稿に対応'}\n`:''}${judge?`**Jev** ${!judge.configured?'未有効':judge.lastModel?`直前 ${judge.lastModel}`:`${judge.model} · 接続未確認`}\n`:''}**VC** ${d.channels.length}件 · 権限確認 ${d.channels.length-channels.length}件\n\n${d.capacity?`${capacitySummary(d.capacity)}\n\n`:''}詳しい結果は選択欄で切り替えられます。`;
  }else if(tab==='audio'){
    body+=`**音声告知** ${d.voiceEnabled?'ON':'OFF'}\n${Object.entries(voiceLabels).map(([key,label])=>`${d.voice[key]?'✓':'?'} ${label} · ${d.voice[key]?'確認済み':'未確認・不足'}`).join('\n')}\n\n${d.backup?`**バックアップ読み上げ**\n起動設定 ${d.backup.enabled?'ON':'OFF'} · ${d.backup.active?'使用中':'停止中'}\n${d.backup.enabled?'VCに参加し、読みたいチャンネルで /menu → 読み上げ → 開始。':'有効化は音声設定の手順から確認できます。'}\n\n`:''}${d.backup?.lastFailure?`**直前の停止**\n${backupFailureSummary(d.backup.lastFailure)}\n\n`:''}ファイルの存在の確認結果です。PythonをPATHから使う場合は未確認と表示されます。合成・変換の処理速度は「速度を測る」から確認できます。VC接続・再生試験は含みません。`;state=d.backup?.lastFailure?'warning':'normal';
  }else if(tab==='dice'){
    body+=d.dice?`**チャットダイス** ${d.dice.enabled?'ON':'OFF'}\n${d.dice.fullContent?'通常投稿に対応しています。':'Botメンション付き投稿に対応。通常投稿を使うにはPortalでMessage Content Intentを有効にして再起動します。'}\n\n${judge?diceJudgeSummary(judge):'Jevの状態は未確認です。'}\n\n接続試験は選択欄の「Jevを試す」から開けます。`:'ダイスの状態は未確認です。';
  }else if(tab==='channels'){
    body+=`**設定済みVC ${d.channels.length}件** · ${s.page+1}/${pages}ページ\n必要な権限あり ${d.channels.length-channels.length}件 · 要確認 ${channels.length}件\n\n${d.channels.slice(s.page*5,s.page*5+5).map(c=>`**${c.lobby?'ロビー':'入室先'}** <#${c.id}>\n${c.status}`).join('\n\n')||'VC設定でロビーと入室先を登録してください。'}\n\n設定済みVCの権限を確認しています。VCへの接続試験は行いません。`;
  }else body+=`**実行環境**\n${capacitySummary(d.capacity)}\n\n**Node** ${d.node}\n**稼働時間** ${d.uptime}分\n**入室予約** ${d.pending}件\n\n値は診断した時点の内容です。速度の実測は「速度を測る」から確認できます。`;
  const b=(action,label)=>new ButtonBuilder().setCustomId(`admin:${s.id}:${action}`).setLabel(label).setStyle(ButtonStyle.Secondary);
  return payload(`動作診断 / ${diagnosticTabs[tab]}`,body,{state,components:[
    actionPicker(`admin:${s.id}:diagnostics-action`,diagnosticActions({...s,view:'diagnostics',diagnosticTab:tab}),'表示・対処を選ぶ'),
    ...(pages>1?[new ActionRowBuilder().addComponents(b('diagnostics-prev','前のページ').setDisabled(s.page===0),b('diagnostics-next','次のページ').setDisabled(s.page===pages-1))]:[]),
    new ActionRowBuilder().addComponents(b('diagnose','診断を更新').setStyle(tab==='audio'?ButtonStyle.Secondary:ButtonStyle.Primary),b('measure-voice','速度を測る').setStyle(tab==='audio'?ButtonStyle.Primary:ButtonStyle.Secondary)),
    new ActionRowBuilder().addComponents(b('nav-category-operations','運用・管理へ')),
  ]});
}

export function diagnosticsHelpScreen(s){
  const d=s.diagnostics;if(!d)throw new Error('診断を更新してから対処の手順を開いてください。');
  const missing=['python','runtime','model','dictionary'].filter(key=>!d.voice[key]),channels=d.channels.filter(c=>c.status!=='必要な権限あり');
  const findings=[];
  if(!d.channels.length)findings.push('**1. VC設定をはじめる**\nロビーと入室先を登録してから、動作診断を更新してください。');
  if(channels.length)findings.push(`**VC・権限の確認 ${channels.length}件**\nVC設定で削除済みのチャンネルを選び直し、Botの閲覧・接続・移動・送信・発言権限を確認してください。`);
  if(missing.length)findings.push(`**音声の構成要素が${missing.length}項目未確認**\n音声設定の導入手順を確認してください。PythonをPATHから使う場合など、未確認だけで故障とは断定できません。`);
  if(d.backup?.lastFailure)findings.push('**読み上げの停止を確認**\n音声設定・起動設定と処理速度の測定を確認してください。停止理由は動作診断に表示しています。');
  if(d.dice?.enabled&&!d.dice.fullContent)findings.push('**ダイスが通常投稿に反応しない場合**\nBotをメンションして試してください。通常投稿へ対応するには、Developer PortalでMessage Content Intentを有効化し、Botを再起動してください。設定を確認から返信のON/OFFも変更できます。');
  if(!findings.length)findings.push('**確認項目に不足は見つかりませんでした**\n音声が遅い場合は処理速度を測定し、確認後に動作診断を更新してください。ファイルや権限の確認だけで実際の接続や再生を保証するものではありません。');
  const b=(a,label)=>new ButtonBuilder().setCustomId(`admin:${s.id}:${a}`).setLabel(label).setStyle(ButtonStyle.Secondary);
  return payload('動作診断 / 対処の手順',findings.join('\n\n')+'\n\n必要な設定を選択欄から開き、内容を確認してください。',{components:[
    new ActionRowBuilder().addComponents(b('measure-voice','速度を測る').setStyle(ButtonStyle.Primary),b('diagnose','診断を更新')),
    actionPicker(`admin:${s.id}:diagnostics-action`,diagnosticActions({...s,view:'diagnostics-help'}),'確認したい設定を選ぶ'),
    new ActionRowBuilder().addComponents(b('nav-diagnostics','診断へ戻る')),
  ]});
}
