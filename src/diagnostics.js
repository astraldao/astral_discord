import {stat,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {ActionRowBuilder,ButtonBuilder,ButtonStyle,PermissionFlagsBits as P,ChannelType} from 'discord.js';
import {payload,menuHomeButton} from './ui.js';
import {systemCapacity,capacitySummary} from './system-capacity.js';
import {safeBackupFailure,backupFailureSummary} from './backup-fault.js';
const exists=async(path,kind)=>{try{const s=await stat(path);return kind==='file'?s.isFile():s.isDirectory();}catch{return false;}};
export async function voiceComponents(root=process.cwd(),env=process.env){
  const base=resolve(root,env.VOICEVOX_ROOT||'voicevox');
  const python=env.VOICEVOX_PYTHON || join(root,'.voicevox-venv/bin/python');
  let libraries=[];try{libraries=await readdir(join(base,'onnxruntime/lib'));}catch{}
  const enhanced=join(base,'dict/japanese-plus'),fallback=join(base,'dict/open_jtalk_dic_utf_8-1.11');
  const dictionary=env.VOICEVOX_DICTIONARY?resolve(root,env.VOICEVOX_DICTIONARY):await exists(join(enhanced,'sys.dic'),'file')?enhanced:fallback;
  return {python:await exists(resolve(root,python),'file'),runtime:libraries.some(n=>/^libvoicevox_onnxruntime.*\.(so(?:\.\d+)*|dylib)$/.test(n)),model:await exists(join(base,'models/vvms/0.vvm'),'file'),dictionary:await exists(join(dictionary,'sys.dic'),'file')};
}
export function createDiagnostics({settings,guild,version,pendingCount,components=()=>voiceComponents(),backupState=()=>({enabled:false,active:false}),capacity=systemCapacity}){
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
    const backup=backupState(),lastFailure=safeBackupFailure(backup.lastFailure);
    return {checkedAt:Date.now(),version,node:process.version,uptime:Math.floor(process.uptime()/60),pending:pendingCount(),voiceEnabled:c.voice,voice,channels,capacity:spec,backup:{enabled:backup.enabled===true,active:backup.active===true,...(lastFailure?{lastFailure}:{})}};
  };
}
export function diagnosticsScreen(s){
  const d=s.diagnostics;if(!d)throw new Error('診断を開き直してください。');
  const pages=Math.max(1,Math.ceil(d.channels.length/15));s.page=Math.max(0,Math.min(s.page,pages-1));
  const badge=x=>x?'確認できました':'未確認・不足';
  const backup=d.backup?`\n\n**バックアップ読み上げ**\n起動設定 ${d.backup.enabled?'ON':'OFF'} · ${d.backup.active?'使用中':'停止中'}\n${d.backup.enabled?'使うときはVCに参加し、読みたいチャンネルで /menu → 読み上げ → 開始。':'有効化の手順は「音声設定」から確認できます。'}`:'';
  const body=`${d.checkedAt?`確認 <t:${Math.floor(d.checkedAt/1000)}:R>\n`:''}**Bot** v${d.version} · Node ${d.node}\n**稼働時間** ${d.uptime}分 · **入室予約** ${d.pending}件\n\n${d.capacity?`**実行環境**\n${capacitySummary(d.capacity)}\n\n`:''}**音声告知** ${d.voiceEnabled?'ON':'OFF'}\nPython実行ファイル · ${badge(d.voice.python)}\n音声ランタイム · ${badge(d.voice.runtime)}\nずんだもんモデル · ${badge(d.voice.model)}\n日本語辞書 · ${badge(d.voice.dictionary)}${backup}${d.backup?.lastFailure?`\n\n**読み上げの直前の停止**\n${backupFailureSummary(d.backup.lastFailure)}`:''}\n\n**設定済みVC** ${d.channels.length}件 · ${s.page+1}/${pages}ページ\n${d.channels.slice(s.page*15,s.page*15+15).map(c=>`${c.lobby?'ロビー':'入室先'} <#${c.id}> · ${c.status}`).join('\n')||'未設定'}\n\nファイルの存在と権限の確認結果です。処理速度の測定は下のボタンから実行できます。VCの接続試験は行いません。PythonをPATHから使う構成は未確認と表示されます。`;
  const button=(a,label)=>new ButtonBuilder().setCustomId(`admin:${s.id}:${a}`).setLabel(label).setStyle(ButtonStyle.Secondary);
  return payload('✦  動作診断',body,{components:[new ActionRowBuilder().addComponents(button('diagnose','診断を更新'),button('measure-voice','処理速度を測る').setStyle(ButtonStyle.Primary),...(pages>1?[button('diagnostics-prev','前のページ').setDisabled(s.page===0),button('diagnostics-next','次のページ').setDisabled(s.page===pages-1)]:[])),new ActionRowBuilder().addComponents(button('diagnostics-help','対処の手順'),button('open-security','脆弱性診断'),button('nav-category-operations','運用・管理へ'),button('home','管理メニューへ'),menuHomeButton())]});
}

export function diagnosticsHelpScreen(s){
  const d=s.diagnostics;if(!d)throw new Error('診断を更新してから対処の手順を開いてください。');
  const missing=['python','runtime','model','dictionary'].filter(key=>!d.voice[key]),channels=d.channels.filter(c=>c.status!=='必要な権限あり');
  const findings=[];
  if(!d.channels.length)findings.push('**1. VC設定をはじめる**\nロビーと入室先を登録してから、動作診断を更新してください。');
  if(channels.length)findings.push(`**VC・権限の確認 ${channels.length}件**\nVC設定で削除済みのチャンネルを選び直し、Botの閲覧・接続・移動・送信・発言権限を確認してください。`);
  if(missing.length)findings.push(`**音声の構成要素が${missing.length}項目未確認**\n音声設定の導入手順を確認してください。PythonをPATHから使う場合など、未確認だけで故障とは断定できません。`);
  if(d.backup?.lastFailure)findings.push('**読み上げの停止を確認**\n音声設定・起動設定と処理速度の測定を確認してください。停止理由は動作診断に表示しています。');
  if(!findings.length)findings.push('**確認項目に不足は見つかりませんでした**\n音声が遅い場合は処理速度を測定し、確認後に動作診断を更新してください。ファイルや権限の確認だけで実際の接続や再生を保証するものではありません。');
  const b=(a,label)=>new ButtonBuilder().setCustomId(`admin:${s.id}:${a}`).setLabel(label).setStyle(ButtonStyle.Secondary);
  return payload('動作診断 / 対処の手順',findings.join('\n\n')+'\n\nこの画面では設定変更や再起動を実行しません。必要な設定を開いて内容を確認してください。',{components:[new ActionRowBuilder().addComponents(b('nav-vc','VC設定'),b('nav-audio','音声設定'),b('open-runtime','ENV・起動設定')),new ActionRowBuilder().addComponents(b('measure-voice','処理速度を測る'),b('diagnose','診断を更新')),new ActionRowBuilder().addComponents(b('nav-category-operations','運用・管理へ'),b('home','管理メニューへ'),menuHomeButton())]});
}
