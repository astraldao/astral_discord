import {createHash} from 'node:crypto';
import {actionPicker} from './compact-controls.js';
import {ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder} from 'discord.js';
import {text} from './ui.js';
import {searchScenarios} from './trpg-store.js';
const row=(...c)=>new ActionRowBuilder().addComponents(...c);
const button=(s,a,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`trpg:${s.id}:${a}`).setLabel(label).setStyle(style);
const menu=(s,a,label,items,multiple=false)=>{
  const m=new StringSelectMenuBuilder().setCustomId(`trpg:${s.id}:${a}`).setPlaceholder(label).addOptions(items);
  if(multiple)m.setMinValues(1).setMaxValues(Math.min(25,items.length));return m;
};
const link=(label,url)=>new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);
const nav=(s,items,size)=>{
  const pages=Math.max(1,Math.ceil(items.length/size));s.page=Math.max(0,Math.min(s.page,pages-1));
  return {part:items.slice(s.page*size,s.page*size+size),label:`${items.length}件 · ${s.page+1}/${pages}ページ`,buttons:pages>1?[row(button(s,'prev','前のページ').setDisabled(s.page===0),button(s,'next','次のページ').setDisabled(s.page===pages-1))]:[]};
};
export const tableActionKey=t=>createHash('sha256').update(JSON.stringify(t)).digest('hex');
export function tableActions(t){
  return [
    ...(t.characterIds.length?[{value:'table-remove-pcs',label:'参加PCを確認・外す',description:'PC登録・TXTの控えは保持する'}]:[]),
    {value:'form-table-edit',label:'卓名・伝助を編集',description:'入力フォームで修正する'},
    {value:'form-table-copy',label:'この卓を複製',description:'元の卓を残して複製名を入力する'},
    {value:'delete-table',label:'卓セットを削除…',description:'次の画面で削除を確認する'},
  ];
}
export function tableScreen(s,d){
  let title='✦  卓セット',body='',components=[];
  if(s.view==='tables'){
    const filter=s.tableFilter??'active';const found=searchScenarios(d.tables,s.tableQuery??'');const items=found.filter(t=>s.tableQuery || filter==='all' || (filter==='completed'?!!t.completed:!t.completed)).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned));const n=nav(s,items,20);
    components.push(row(menu(s,'table-filter','表示する卓',[{label:'進行中',value:'active',default:filter==='active'},{label:'完了',value:'completed',default:filter==='completed'},{label:'すべて',value:'all',default:filter==='all'}])));s.tableListPage=s.page;body=n.label+(s.tableQuery?`\n検索：**${text(s.tableQuery)}**`:'')+`\n\n${s.tableQuery?'すべての卓から検索しています。':filter==='completed'?'完了した卓を表示しています。':filter==='all'?'進行中・完了した卓を表示しています。':'進行中の卓を表示しています。'}固定した卓は先頭に表示します。内容は管理者だけに表示します。`;
    if(n.part.length)components.push(row(menu(s,'table-select','確認する卓を選ぶ',n.part.map(t=>({label:`${t.pinned?'★ ':''}${t.name}`.slice(0,100),value:t.id,description:`${t.completed?'完了':'進行中'} · ${d.scenarios.find(x=>x.id===t.scenarioId)?.name??'シナリオ未選択'} · PC ${t.characterIds.length}件`.slice(0,100)})))));
    else body+=s.tableQuery?'\n\n該当する卓がありません。検索を解除するか、別の名前で検索してください。':d.tables.length?'\n\nこの表示条件に合う卓はありません。「すべて」に切り替えるか、新しい卓を作成してください。':'\n\n卓セットは未登録です。';
    components.push(row(button(s,'form-table','卓セットを作成',ButtonStyle.Primary),button(s,'form-table-search','卓名で検索'),...(s.tableQuery?[button(s,'clear-table-search','検索を解除')]:[])),...n.buttons,row(button(s,'home','卓・キャラシのメニューへ')));
  }else{
    const t=d.tables.find(x=>x.id===s.tableId);if(!t)throw new Error('卓セットが見つかりません。');
    const scenario=d.scenarios.find(x=>x.id===t.scenarioId),pcs=d.characters.filter(c=>t.characterIds.includes(c.id));
    s.tableStateRevision=JSON.stringify(t);body=`**${text(t.name)}**\n${t.completed?'完了':'進行中'}${t.pinned?' · ★ 固定中':''}`;
    if(s.view==='delete-table'){
      title='✧  卓セットを削除';body+='\n\nこの卓のまとめを削除します。ベース卓・伝助イベント・PC登録とTXTの控えは保持します。';
      components=[row(button(s,'confirm-delete-table','卓セットの削除を確定',ButtonStyle.Danger),button(s,'table','削除せず戻る'))];
    }else if(s.view==='table'){
      const next=t.completed?null:!scenario?'「シナリオを選ぶ」でベース卓を設定してください。':!pcs.length?'「参加PCを追加」で、この卓のPCを選んでください。':!t.answerUrl?'日程調整を使う場合は「卓名・伝助を編集」で回答URLを登録できます。':null;
      if(next)body+=`\n\n**次の操作**\n${next}`;
      body+=`\n\n**シナリオ**\n${scenario?`${text(scenario.name)}\n${scenario.url}`:'未選択'}\n\n**伝助**\n${t.answerUrl||'未登録'}\n\n**参加PC** ${pcs.length}件\n${pcs.slice(0,5).map(c=>`**${text(c.name)}**\n${c.url}`).join('\n\n')||'未登録'}${pcs.length>5?`\nほか ${pcs.length-5}件 · 「参加PCを確認・外す」で確認`:''}`;
      const links=[...(scenario?[link('ベース卓を開く',scenario.url)]:[]),...(t.answerUrl?[link('伝助を開く',t.answerUrl)]:[])];if(links.length)components.push(row(...links));
      components.push(row(button(s,'table-scenario',scenario?'シナリオを変更':'シナリオを選ぶ',scenario?ButtonStyle.Secondary:ButtonStyle.Primary),button(s,'table-pcs','参加PCを追加',scenario&&!pcs.length?ButtonStyle.Primary:ButtonStyle.Secondary)),actionPicker(`trpg:${s.id}:table-actions:${tableActionKey(t)}`,tableActions(t),'確認・編集・その他の操作'),row(button(s,t.pinned?'unpin-table':'pin-table',t.pinned?'固定を解除':'この卓を固定'),button(s,t.completed?'reopen-table':'complete-table',t.completed?'進行中に戻す':'完了にする')),row(button(s,'tables','卓セット一覧へ')));
    }else if(s.view==='table-scenario'){
      title='✦  シナリオを選択';const n=nav(s,searchScenarios(d.scenarios,s.tableScenarioQuery??''),25);body+=`\n\n${n.label}${s.tableScenarioQuery?`\n検索：**${text(s.tableScenarioQuery)}**`:''}\n現在：**${scenario?text(scenario.name):'未選択'}**\nベース卓の登録から選んでください。`;
      if(n.part.length)components.push(row(menu(s,'table-set-scenario','シナリオを選ぶ',n.part.map(x=>({label:x.name,value:x.id,default:x.id===t.scenarioId})))));
      else body+=s.tableScenarioQuery?'\n\n条件に合うシナリオがありません。':'\n\n先にベース卓を登録してください。';
      components.push(row(button(s,'form-table-scenario-search','名前で検索'),...(s.tableScenarioQuery?[button(s,'clear-table-scenario-search','検索を解除')]:[])),...n.buttons,row(button(s,'table','卓セットへ')));
    }else{
      const removing=s.view==='table-remove-pcs',query=removing?s.tableRemoveQuery:s.tableAddQuery,items=searchScenarios(removing?pcs:d.characters.filter(c=>!t.characterIds.includes(c.id)),query??'');const n=nav(s,items,20);
      title=removing?'✦  参加PCを確認・外す':'✦  参加PCを追加';body+=`\n\n${n.label}${query?`\n検索：**${text(query)}**`:''}\n\n`+(removing?n.part.map(c=>`**${text(c.name)}**\n${c.url}`).join('\n\n'):'登録済みのPCから選んでください。複数選択できます。');
      if(n.part.length){
        const options=n.part.map(c=>({label:c.name,value:c.id,description:c.url}));
        if(removing)components.push(row(menu(s,'table-character','TXTの控えを確認するPC',options)));
        components.push(row(menu(s,removing?'table-remove-characters':'table-add-characters',removing?'卓セットから外すPC（登録・控えは保持）':'追加する参加PC',options,true)));
      }
      else body+=query?'\n\n条件に合うPCがありません。検索を解除するか、別のPC名で検索してください。':removing?'\n\n参加PCは未登録です。「卓セットへ」から参加PCを追加できます。':'\n\n追加できるPCがありません。キャラシパネルでPCを登録するか、参加済みのPCを確認してください。';
      components.push(row(button(s,'form-table-pc-search','PC名で検索'),...(query?[button(s,'clear-table-pc-search','検索を解除')]:[])),...n.buttons,row(button(s,'table','卓セットへ')));
    }
  }
  return {title,body,components};
}
