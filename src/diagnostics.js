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
    return {version,node:process.version,uptime:Math.floor(process.uptime()/60),pending:pendingCount(),voiceEnabled:c.voice,voice,channels,capacity:spec,backup:{enabled:backup.enabled===true,active:backup.active===true,...(lastFailure?{lastFailure}:{})}};
  };
}
export function diagnosticsScreen(s){
  const d=s.diagnostics;if(!d)throw new Error('診断を開き直してください。');
  const pages=Math.max(1,Math.ceil(d.channels.length/15));s.page=Math.max(0,Math.min(s.page,pages-1));
  const badge=x=>x?'確認できました':'未確認・不足';
  const backup=d.backup?`\n\n**バックアップ読み上げ**\n起動設定 ${d.backup.enabled?'ON':'OFF'} · ${d.backup.active?'使用中':'停止中'}\n${d.backup.enabled?'使うときはVCに参加し、読みたいチャンネルで /menu → 読み上げ → 開始。':'有効化の手順は「音声設定」から確認できます。'}`:'';
  const body=`**Bot** v${d.version} · Node ${d.node}\n**稼働時間** ${d.uptime}分 · **入室予約** ${d.pending}件\n\n${d.capacity?`**実行環境**\n${capacitySummary(d.capacity)}\n\n`:''}**音声告知** ${d.voiceEnabled?'ON':'OFF'}\nPython実行ファイル · ${badge(d.voice.python)}\n音声ランタイム · ${badge(d.voice.runtime)}\nずんだもんモデル · ${badge(d.voice.model)}\n日本語辞書 · ${badge(d.voice.dictionary)}${backup}${d.backup?.lastFailure?`\n\n**読み上げの直前の停止**\n${backupFailureSummary(d.backup.lastFailure)}`:''}\n\n**設定済みVC** ${d.channels.length}件 · ${s.page+1}/${pages}ページ\n${d.channels.slice(s.page*15,s.page*15+15).map(c=>`${c.lobby?'ロビー':'入室先'} <#${c.id}> · ${c.status}`).join('\n')||'未設定'}\n\nファイルの存在と権限の確認結果です。処理速度の測定は下のボタンから実行できます。VCの接続試験は行いません。PythonをPATHから使う構成は未確認と表示されます。`;
  const button=(a,label)=>new ButtonBuilder().setCustomId(`admin:${s.id}:${a}`).setLabel(label).setStyle(ButtonStyle.Secondary);
  return payload('✦  動作診断',body,{components:[new ActionRowBuilder().addComponents(button('diagnose','診断を更新'),button('measure-voice','処理速度を測る').setStyle(ButtonStyle.Primary),...(pages>1?[button('diagnostics-prev','前のページ').setDisabled(s.page===0),button('diagnostics-next','次のページ').setDisabled(s.page===pages-1)]:[])),new ActionRowBuilder().addComponents(button('nav-category-operations','運用・管理へ'),button('home','管理メニューへ'),menuHomeButton())]});
}
