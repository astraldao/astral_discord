import {ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder} from 'discord.js';
import {text} from './ui.js';
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
export function tableScreen(s,d){
  let title='✦  卓セット',body='',components=[];
  if(s.view==='tables'){
    const n=nav(s,d.tables,20);body=n.label+'\n\nシナリオ・伝助・参加PCを、卓ごとにまとめます。内容は管理者だけに表示します。';
    if(n.part.length)components.push(row(menu(s,'table-select','確認する卓を選ぶ',n.part.map(t=>({label:t.name,value:t.id})))));
    else body+='\n\n卓セットは未登録です。';
    components.push(row(button(s,'form-table','卓セットを作成',ButtonStyle.Primary)),...n.buttons,row(button(s,'home','卓・キャラシのメニューへ')));
  }else{
    const t=d.tables.find(x=>x.id===s.tableId);if(!t)throw new Error('卓セットが見つかりません。');
    const scenario=d.scenarios.find(x=>x.id===t.scenarioId),pcs=d.characters.filter(c=>t.characterIds.includes(c.id));
    body=`**${text(t.name)}**`;
    if(s.view==='delete-table'){
      title='✧  卓セットを削除';body+='\n\nこの卓のまとめを削除します。ベース卓・伝助イベント・PC登録とTXTの控えは保持します。';
      components=[row(button(s,'confirm-delete-table','卓セットの削除を確定',ButtonStyle.Danger),button(s,'table','削除せず戻る'))];
    }else if(s.view==='table'){
      body+=`\n\n**シナリオ**\n${scenario?`${text(scenario.name)}\n${scenario.url}`:'未選択'}\n\n**伝助**\n${t.answerUrl||'未登録'}\n\n**参加PC** ${pcs.length}件\n${pcs.slice(0,5).map(c=>`**${text(c.name)}**\n${c.url}`).join('\n\n')||'未登録'}${pcs.length>5?`\nほか ${pcs.length-5}件 · 「参加PCを確認・外す」で確認`:''}`;
      const links=[...(scenario?[link('ベース卓を開く',scenario.url)]:[]),...(t.answerUrl?[link('伝助を開く',t.answerUrl)]:[])];if(links.length)components.push(row(...links));
      components.push(row(button(s,'table-scenario','シナリオを選ぶ',ButtonStyle.Primary),button(s,'table-pcs','参加PCを追加')),row(button(s,'table-remove-pcs','参加PCを確認・外す'),button(s,'form-table-edit','卓名・伝助を編集')),row(button(s,'delete-table','卓セットを削除',ButtonStyle.Danger),button(s,'tables','卓セット一覧へ')));
    }else if(s.view==='table-scenario'){
      title='✦  シナリオを選択';const n=nav(s,d.scenarios,25);body+=`\n\n${n.label}\nベース卓の登録から選んでください。`;
      if(n.part.length)components.push(row(menu(s,'table-set-scenario','シナリオを選ぶ',n.part.map(x=>({label:x.name,value:x.id})))));
      else body+='\n\n先にベース卓を登録してください。';
      components.push(...n.buttons,row(button(s,'table','卓セットへ')));
    }else{
      const removing=s.view==='table-remove-pcs',items=removing?pcs:d.characters.filter(c=>!t.characterIds.includes(c.id));const n=nav(s,items,20);
      title=removing?'✦  参加PCを確認・外す':'✦  参加PCを追加';body+=`\n\n${n.label}\n\n`+(removing?n.part.map(c=>`**${text(c.name)}**\n${c.url}`).join('\n\n'):'登録済みのPCから選んでください。複数選択できます。');
      if(n.part.length)components.push(row(menu(s,removing?'table-remove-characters':'table-add-characters',removing?'卓セットから外すPC（登録・控えは保持）':'追加する参加PC',n.part.map(c=>({label:c.name,value:c.id})),true)));
      else body+='\n\n対象のPCはありません。';
      components.push(...n.buttons,row(button(s,'table','卓セットへ')));
    }
  }
  return {title,body,components};
}
