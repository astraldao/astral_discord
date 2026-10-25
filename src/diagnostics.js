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
export function diagnosticActions(s){
  if(s.view==='diagnostics')return [{value:'diagnostics-help',label:'対処の手順',description:'確認結果から次の操作を探す'},{value:'open-security',label:'脆弱性診断',description:'依存パッケージの診断画面を開く'}];
  if(s.view==='diagnostics-help')return [{value:'nav-vc',label:'VC設定',description:'ロビーと行き先を確認する'},{value:'nav-audio',label:'音声設定',description:'参加告知・音量・導入手順'},{value:'open-runtime',label:'ENV・起動設定',description:'読み上げの有効化・スレッド数'}];
  return [];
}
export function diagnosticsScreen(s){
  const d=s.diagnostics;if(!d)throw new Error('診断を開き直してください。');
  const pages=Math.max(1,Math.ceil(d.channels.length/15));s.page=Math.max(0,Math.min(s.page,pages-1));
  const badge=x=>x?'確認できました':'未確認・不足';
  const backup=d.backup?`\n\n**バックアップ読み上げ**\n起動設定 ${d.backup.enabled?'ON':'OFF'} · ${d.backup.active?'使用中':'停止中'}\n${d.backup.enabled?'使うときはVCに参加し、読みたいチャンネルで /menu → 読み上げ → 開始。':'有効化の手順は「音声設定」から確認できます。'}`:'';
  const dice=d.dice?`\n\n**チャットダイス** ${d.dice.enabled?'ON':'OFF'} · ${d.dice.fullContent?'通常投稿に対応':'Botメンション付き投稿に対応'}\n${!d.dice.fullContent?'通常投稿への対応には、PortalでMessage Content Intentを有効化後にBotを再起動します。':''}${d.dice.judge?`\n${diceJudgeSummary(d.dice.judge)}`:''}`:'';
  const body=`${d.checkedAt?`確認 <t:${Math.floor(d.checkedAt/1000)}:R>\n`:''}**Bot** v${d.version} · Node ${d.node}\n**稼働時間** ${d.uptime}分 · **入室予約** ${d.pending}件\n\n${d.capacity?`**実行環境**\n${capacitySummary(d.capacity)}\n\n`:''}**音声告知** ${d.voiceEnabled?'ON':'OFF'}\nPython実行ファイル · ${badge(d.voice.python)}\n音声ランタイム · ${badge(d.voice.runtime)}\nずんだもんモデル · ${badge(d.voice.model)}\n日本語辞書 · ${badge(d.voice.dictionary)}${backup}${dice}${d.backup?.lastFailure?`\n\n**読み上げの直前の停止**\n${backupFailureSummary(d.backup.lastFailure)}`:''}\n\n**設定済みVC** ${d.channels.length}件 · ${s.page+1}/${pages}ページ\n${d.channels.slice(s.page*15,s.page*15+15).map(c=>`${c.lobby?'ロビー':'入室先'} <#${c.id}> · ${c.status}`).join('\n')||'未設定'}\n\nファイルの存在と権限の確認結果です。処理速度の測定は下のボタンから実行できます。VCの接続試験は行いません。PythonをPATHから使う構成は未確認と表示されます。`;
  const button=(a,label)=>new ButtonBuilder().setCustomId(`admin:${s.id}:${a}`).setLabel(label).setStyle(ButtonStyle.Secondary);
  return payload('✦  動作診断',body,{components:[
    new ActionRowBuilder().addComponents(button('diagnose','診断を更新'),button('measure-voice','速度を測る').setStyle(ButtonStyle.Primary)),
    ...(pages>1?[new ActionRowBuilder().addComponents(button('diagnostics-prev','前のページ').setDisabled(s.page===0),button('diagnostics-next','次のページ').setDisabled(s.page===pages-1))]:[]),
    actionPicker(`admin:${s.id}:diagnostics-action`,diagnosticActions({...s,view:'diagnostics'}),'対処・関連する診断を選ぶ'),
    new ActionRowBuilder().addComponents(button('nav-category-operations','運用・管理へ')),
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
