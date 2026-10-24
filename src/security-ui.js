import {ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder} from 'discord.js';
import {payload,text,menuHomeButton} from './ui.js';
const labels={critical:'緊急',high:'高',moderate:'中',low:'低',unknown:'未確認'};
export const securityScopes={all:'すべて',runtime:'実行用',dev:'開発用'};
export function securityFindings(s){const scope=s.securityScope??'all';return (s.security?.findings??[]).flatMap(f=>{const packages=f.packages.filter(p=>scope==='all'||scope==='dev'&&p.dev||scope==='runtime'&&!p.dev);return packages.length?[{...f,packages,fixed:f.fixed.filter(v=>packages.some(p=>p.name===v.name))}]:[];});}
export function securityReport(data){
  if(data?.status!=='complete')throw new Error('完了した診断からレポートを保存してください。');
  const result={format:1,source:'OSV',scope:'all',checkedAt:data.checkedAt,version:data.version,lockHash:data.lockHash,packageCount:data.packageCount,runtimeCount:data.runtimeCount,devCount:data.devCount,skipped:data.skipped,detailMissing:data.detailMissing,limitations:['npm lockfile only','Not an integrity check or guarantee of safety'],findings:data.findings.map(f=>({id:f.id,severity:f.severity,detail:f.detail,packages:f.packages.map(p=>({name:p.name,version:p.version,dev:p.dev,direct:p.direct})),fixed:f.fixed.map(v=>({name:v.name,version:v.version}))}))};
  const bytes=Buffer.from(JSON.stringify(result,null,2));if(bytes.length>512*1024)throw new Error('レポートが512KiBを超えています。画面の勧告リンクから確認してください。');return bytes;
}
const row=(...c)=>new ActionRowBuilder().addComponents(...c);
export function securityScreen(s){
  const d=s.security,findings=securityFindings(s),button=(action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`admin:${s.id}:${action}`).setLabel(label).setStyle(style);
  let body='**依存パッケージの既知の脆弱性を確認します**\n実行中の版のpackage-lock.jsonに記載された、公式npmレジストリ由来のパッケージ（開発用・間接依存を含む）が対象です。\n\n「診断を開始」で、対象のパッケージ名とバージョンだけをOSVへ送信します。サーバーID・投稿・ENV・トークンは送りません。';
  let state='normal',pages=1;
  if(d){
    body=`**${d.status==='complete'?'診断結果':'診断できませんでした（未確認）'}**\n確認 <t:${Math.floor(d.checkedAt/1000)}:f> · <t:${Math.floor(d.checkedAt/1000)}:R>\n`;
    if(d.version)body+=`Bot v${text(d.version)} · ロック ${d.lockHash.slice(0,12)}\n対象 ${d.packageCount}種類（実行用 ${d.runtimeCount}・開発用 ${d.devCount}）\n`;
    if(d.status!=='complete'){
      state='warning';body+=`\n${{LOCK_UNAVAILABLE:'実行中の版の依存情報を読み取れませんでした。',LOOKUP_TIMEOUT:'公開データベースへの照会が時間内に完了しませんでした。',LOOKUP_UNAVAILABLE:'公開データベースの応答を確認できませんでした。'}[d.code]??'診断を完了できませんでした。'}\n該当なしとは判定していません。少し待ってから再診断してください。`;
    }else{
      body+=`表示：${securityScopes[s.securityScope??'all']} · ${findings.length}件 / 全${d.findings.length}件\n`;
      const counts=Object.keys(labels).map(key=>`${labels[key]} ${findings.filter(f=>f.severity===key).length}`).join(' · ');
      body+=`\n**既知の勧告 ${d.findings.length}件**\n${counts}\n`;
      if(!findings.length){state=d.findings.length||d.skipped?'warning':'success';body+=d.findings.length?'\nこの絞り込みに該当する勧告はありません。全件の結果は残しています。':'\n照会対象に該当する既知の勧告は見つかりませんでした。';}
      else{
        state='warning';pages=Math.ceil(findings.length/3);s.page=Math.max(0,Math.min(s.page??0,pages-1));body+=`\n${s.page+1}/${pages}ページ\n`;
        for(const f of findings.slice(s.page*3,s.page*3+3)){
          const packages=f.packages.slice(0,2).map(p=>`${text(p.name)} ${text(p.version)}（${p.dev?'開発用':'実行用'}・${p.direct?'直接':'間接'}）`).join('\n');
          body+=`\n**[${f.id}](https://osv.dev/vulnerability/${encodeURIComponent(f.id)}) · ${labels[f.severity]}**\n${packages}${f.packages.length>2?`\nほか${f.packages.length-2}種類`:''}\n`;
          if(f.fixed.length)body+=`修正版の候補：${f.fixed.slice(0,2).map(v=>`${text(v.name)} ${text(v.version)}`).join('・')}\n`;
        }
        body+='\n修正版の候補は勧告の記載です。互換性やこのBotへの適用可否は更新内容で確認してください。';
      }
      if(d.detailMissing)body+=`\n深刻度・修正版などの詳細は${d.detailMissing}件が未確認です。勧告リンクから確認できます。`;
    }
    if(d.skipped)body+=`\n対象外 ${d.skipped}エントリ（独自レジストリ・git・ローカル依存など）。全依存の安全性を確認した結果ではありません。`;
  }
  body+='\n\n**対象と更新方法**\n情報源はOSV。OS・Node本体・Python/VOICEVOX・改変された実ファイル・Bot独自コードは診断対象外です。登録の遅れや未公開の問題もあるため、安全性を保証する診断ではありません。\n結果は最大5分間再利用します。修正は「バージョン管理」から確認できます。';
  return {...payload('脆弱性診断',body,{state,components:[...(d?.status==='complete'?[row(new StringSelectMenuBuilder().setCustomId(`admin:${s.id}:security-scope`).setPlaceholder('勧告の対象を絞り込む').addOptions(...Object.entries(securityScopes).map(([value,label])=>({value,label,default:value===(s.securityScope??'all')}))))]:[]),row(button('security-run',d?'再診断する':'診断を開始',ButtonStyle.Primary),...(pages>1?[button('security-prev','前のページ').setDisabled(s.page===0),button('security-next','次のページ').setDisabled(s.page===pages-1)]:[])),...(d?.status==='complete'?[row(button('security-export','全件JSONを保存'))]:[]),row(button('open-updates','バージョン管理'),button('nav-category-operations','運用・管理へ'),menuHomeButton())]}),attachments:[]};
}
