import {ActionRowBuilder,ButtonBuilder,ButtonStyle} from 'discord.js';
import {themed,text,menuHomeButton} from './ui.js';
import {actionPicker} from './compact-controls.js';
const {payload}=themed('admin');
const labels={critical:'緊急',high:'高',moderate:'中',low:'低',unknown:'未確認'};
export const securityScopes={all:'すべて',runtime:'実行用',dev:'開発用'};
export function securityFindings(s){const scope=s.securityScope??'all';return (s.security?.findings??[]).flatMap(f=>{const packages=f.packages.filter(p=>scope==='all'||scope==='dev'&&p.dev||scope==='runtime'&&!p.dev);return packages.length?[{...f,packages,fixed:f.fixed.filter(v=>packages.some(p=>p.name===v.name))}]:[];});}
export function securityReport(data){
  if(data?.status!=='complete')throw new Error('完了した診断からレポートを保存してください。');
  const result={format:1,source:'OSV',scope:'all',checkedAt:data.checkedAt,version:data.version,lockHash:data.lockHash,packageCount:data.packageCount,runtimeCount:data.runtimeCount,devCount:data.devCount,skipped:data.skipped,detailMissing:data.detailMissing,limitations:['npm lockfile only','Not an integrity check or guarantee of safety'],findings:data.findings.map(f=>({id:f.id,severity:f.severity,detail:f.detail,packages:f.packages.map(p=>({name:p.name,version:p.version,dev:p.dev,direct:p.direct})),fixed:f.fixed.map(v=>({name:v.name,version:v.version}))}))};
  const bytes=Buffer.from(JSON.stringify(result,null,2));if(bytes.length>512*1024)throw new Error('レポートが512KiBを超えています。画面の勧告リンクから確認してください。');return bytes;
}
const row=(...c)=>new ActionRowBuilder().addComponents(...c);
const scope=s=>Object.hasOwn(securityScopes,s.securityScope)?s.securityScope:'all';
export function securityActions(s){
  if(s.view!=='security')return [];
  const complete=s.security?.status==='complete',findings=securityFindings(s),page=Math.max(0,Math.min(s.page??0,Math.max(0,Math.ceil(findings.length/3)-1)));
  return [{value:'security-summary',label:'結果の一覧',description:'確認時点の結果と深刻度を確認',default:!s.securityDetail&&s.securityView!=='help'},
    ...(complete?Object.entries(securityScopes).map(([value,label])=>({value:`security-filter-${value}`,label:`対象：${label}`,description:`取得済みの結果を${label}で絞り込む`})) : []),
    ...(complete?findings.slice(page*3,page*3+3).map((f,n)=>({value:`security-finding-${page*3+n}`,label:`詳しく：${f.id}`.slice(0,100),description:`${labels[f.severity]} · 対象${f.packages.length}種類・修正版候補${f.fixed.length}件`})) : []),
    {value:'security-help',label:'対象・送信内容・注意点',description:'OSVへの送信内容と診断の範囲',default:s.securityView==='help'},
    ...(complete?[{value:'security-export',label:'全件JSONを保存',description:'絞り込み前の全結果を本人だけに添付'}]:[])];
}
const limitations='**対象と送信内容**\n公式npmレジストリ由来のパッケージ名と正確なバージョンだけをOSVへ送信します。開発用・間接依存も含みます。サーバーID・投稿・ENV・トークンは送りません。\n\n**診断の範囲**\n実行中の版のpackage-lock.jsonが対象です。OS・Node本体・Python/VOICEVOX・実ファイルの改変・Bot独自コードは対象外です。未公開の問題や登録の遅れもあり、安全性を保証する診断ではありません。\n\n**結果の更新**\n成功した結果は最大5分、失敗は30秒間再利用します。画面の操作期限は10分です。表示の切り替えだけでは再照会せず、自動修正・更新も行いません。';
export function securityScreen(s){
  const d=s.security,findings=securityFindings(s),detail=s.securityDetail&&findings.find(f=>f.id===s.securityDetail),help=s.securityView==='help',button=(action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`admin:${s.id}:${action}`).setLabel(label).setStyle(style);
  let body='',state='normal',pages=1,fields=[];
  if(help)body=limitations;
  else if(detail){
    state='warning';const entries=[...detail.packages.map(p=>`**対象** ${text(p.name)} ${text(p.version)}\n${p.dev?'開発用':'実行用'} · ${p.direct?'直接':'間接'}依存`),...detail.fixed.map(v=>`**修正版候補** ${text(v.name)} ${text(v.version)}`)];
    pages=Math.max(1,Math.ceil(entries.length/5));s.securityDetailPage=Math.max(0,Math.min(s.securityDetailPage??0,pages-1));
    body=`**[${detail.id}](https://osv.dev/vulnerability/${encodeURIComponent(detail.id)}) · 深刻度 ${labels[detail.severity]}**\n確認 <t:${Math.floor(d.checkedAt/1000)}:R> · 表示対象：${securityScopes[scope(s)]} · 対象 ${detail.packages.length}種類 · 修正版候補 ${detail.fixed.length}件\n${s.securityDetailPage+1}/${pages}ページ\n\n${entries.slice(s.securityDetailPage*5,s.securityDetailPage*5+5).join('\n\n')}\n\n${detail.fixed.length?'候補は勧告の記載です。互換性・適用可否は更新内容で確認してください。':'修正版の候補は未確認です。勧告リンクから確認してください。'}`;
  }else if(!d)body='**診断はまだ実行していません**\n実行中の版のnpm依存に該当する既知の脆弱性を確認します。\n「診断を開始」で、対象のパッケージ名とバージョンだけをOSVへ送信します。投稿・ENV・トークンは送りません。';
  else{
    body=`**${d.status==='complete'?(d.findings.length?`既知の勧告 ${d.findings.length}件`:'照会対象に既知の勧告は見つかりませんでした'):'診断できませんでした（未確認）'}**\n確認 <t:${Math.floor(d.checkedAt/1000)}:f> · <t:${Math.floor(d.checkedAt/1000)}:R>\n`;
    if(d.version)body+=`Bot v${text(d.version)} · ロック ${d.lockHash.slice(0,12)}\n対象 ${d.packageCount}種類（実行用 ${d.runtimeCount}・開発用 ${d.devCount}）\n`;
    if(d.status!=='complete'){
      state='warning';body+=`\n${{LOCK_UNAVAILABLE:'実行中の版の依存情報を読み取れませんでした。',LOOKUP_TIMEOUT:'公開データベースへの照会が時間内に完了しませんでした。',LOOKUP_UNAVAILABLE:'公開データベースの応答を確認できませんでした。'}[d.code]??'診断を完了できませんでした。'}\n該当なしとは判定していません。少し待ってから再診断してください。`;
    }else{
      state=d.findings.length||d.skipped||d.detailMissing?'warning':'success';pages=Math.max(1,Math.ceil(findings.length/3));s.page=Math.max(0,Math.min(s.page??0,pages-1));
      body+=`\n表示：${securityScopes[scope(s)]} · ${findings.length}件 / 全${d.findings.length}件\n${Object.keys(labels).map(key=>`${labels[key]} ${findings.filter(f=>f.severity===key).length}`).join(' · ')}\n`;
      if(!findings.length&&d.findings.length)body+='この絞り込みに該当する勧告はありません。全件の結果は残しています。\n';
      if(findings.length){body+=`${s.page+1}/${pages}ページ · 選択欄の「詳しく」から全対象・修正版候補を確認できます。\n`;fields=findings.slice(s.page*3,s.page*3+3).map(f=>({name:`${f.id} · ${labels[f.severity]}`,value:`${f.packages.slice(0,2).map(p=>`${text(p.name)} ${text(p.version)}（${p.dev?'開発用':'実行用'}・${p.direct?'直接':'間接'}）`).join('\n')}${f.packages.length>2?`\nほか${f.packages.length-2}種類`:''}\n修正版候補 ${f.fixed.length}件 · [勧告を開く](https://osv.dev/vulnerability/${encodeURIComponent(f.id)})`}));}
      if(d.detailMissing)body+=`\n詳細 ${d.detailMissing}件が未確認です。勧告リンクから確認してください。`;
    }
  }
  if(!help){if(d?.skipped)body+=`\n対象外 ${d.skipped}エントリ。全依存を確認した結果ではありません。`;body+='\n\nOSVの既知情報を確認する診断です。安全性は保証しません。対象・注意点は選択欄から確認できます。';}
  const page=detail?s.securityDetailPage:s.page;s.securityUiRevision=(s.securityUiRevision??0)+1;
  const m=payload(help?'脆弱性診断 / 対象・注意点':detail?'脆弱性診断 / 勧告の詳細':'脆弱性診断',body,{state,components:[
    actionPicker(`admin:${s.id}:security-action:${s.securityUiRevision}`,securityActions({...s,view:'security'}),'対象・詳細・保存を選ぶ'),
    row(button('security-run',d?'再診断する':'診断を開始',ButtonStyle.Primary),...(!help&&pages>1?[button('security-prev','前のページ').setDisabled(page===0),button('security-next','次のページ').setDisabled(page===pages-1)]:[])),
    row(button('open-updates','バージョン管理'),button('nav-category-operations','運用・管理へ'),menuHomeButton())]});
  if(fields.length)m.embeds[0].addFields(...fields);return {...m,attachments:[]};
}
