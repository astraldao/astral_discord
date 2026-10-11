import {ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,ChannelSelectMenuBuilder,ChannelType,ModalBuilder,TextInputBuilder,TextInputStyle,MessageFlags,AttachmentBuilder,escapeMarkdown,PermissionFlagsBits as P} from 'discord.js';
import {randomUUID} from 'node:crypto';
import {AdminSessions} from './admin.js';
import {canConfigure} from './commands.js';
import {payload,text} from './ui.js';
import {visibleCharacters,searchScenarios,iacharaUrl,characterRevision} from './trpg-store.js';
import {tableScreen} from './tables-ui.js';
import {backupBundles} from './backups.js';
import {createIacharaClient} from './iachara.js';
const row=(...x)=>new ActionRowBuilder().addComponents(...x);
const button=(s,a,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`trpg:${s.id}:${a}`).setLabel(label).setStyle(style);
const link=(label,url)=>new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);
const menu=(s,a,label,items)=>new StringSelectMenuBuilder().setCustomId(`trpg:${s.id}:${a}`).setPlaceholder(label).addOptions(items);
const input=(id,label,max,required=true,value='')=>{
  const field=new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setMaxLength(max).setRequired(required).setPlaceholder({name:'例：星の神話、エンドロール',url:label.includes('共有URL')?'https://iachara.com/view/…':'https://ccfolia.com/rooms/…',query:'名前の一部でも検索できます'}[id]??'入力してください');
  if(value)field.setValue(String(value).slice(0,max));
  return row(field);
};
function form(s,kind){
  if(kind==='table' || kind==='table-edit'){const t=s.tableDraft??(kind==='table-edit'?s.tableForm:null);s.tableModal={token:randomUUID().slice(0,12),id:s.tableEditId??null,revision:s.tableForm?JSON.stringify(s.tableForm):undefined};return new ModalBuilder().setCustomId(`trpg:${s.id}:submit-table:${s.tableModal.token}`).setTitle(kind==='table'?'卓セットを作成':'卓セットを編集').addComponents(input('name','卓名',100,true,t?.name),input('answer','伝助の回答用URL（任意）',250,false,t?.answerUrl));}
  const m=new ModalBuilder().setCustomId(`trpg:${s.id}:submit-${kind==='scenario-edit'?'scenario':kind}`).setTitle({scenario:'ベース卓を登録','scenario-edit':'ベース卓を修正',search:'シナリオ名で検索','pc-search':'PC名で検索',register:'いあきゃらの共有URLを登録'}[kind]);
  if(kind==='scenario' || kind==='scenario-edit')m.addComponents(input('name','シナリオ名（同名は上書き）',100,true,kind==='scenario-edit'?s.scenario?.name:''),input('url','ココフォリアのベース卓URL',250,true,kind==='scenario-edit'?s.scenario?.url:''));
  else if(kind==='search' || kind==='pc-search')m.addComponents(input('query',kind==='search'?'検索するシナリオ名':'検索するPC名',100,false,kind==='search'?s.query:s.pcQuery));
  else m.addComponents(input('url','共有URL（同じURLは控えを更新）',100,true,s.registrationUrl));
  return m;
}
export function trpgPanel(p){
  const shared=p.mode==='shared';
  const message=payload('✦  キャラシ',`いあきゃらの共有URLを登録すると、PC名・URL・TXTの控えを保存できます。\n\n**${shared?'共有':'秘匿'}モード**\n${shared?'PC名と共有URLはメンバーが閲覧できます。':'PC名と共有URLは登録した本人と管理者だけが閲覧できます。'}\nTXTの控えは、どちらのモードでも本人と管理者だけに表示します。`,{components:[row(new ButtonBuilder().setCustomId(`trpg:p:${p.id}:open`).setLabel('PC一覧を開く').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId(`trpg:p:${p.id}:register`).setLabel('共有URLを登録').setStyle(ButtonStyle.Secondary))]});
  return message;
}
export function createTrpgController({store,guild,iachara=createIacharaClient(),access=async i=>{const member=await guild.members.fetch({user:i.user.id,force:true});const channel=await guild.channels.fetch(i.channelId,{force:true});if(!channel?.permissionsFor(member)?.has(P.ViewChannel))throw new Error('このチャンネルの閲覧権限がありません。');return canConfigure(member.permissions);}}) {
  const sessions=new AdminSessions();const cooldown=new Map(),backupCooldown=new Map();
  const isAdmin=i=>access(i);
  const managementSession=s=>s.entry==='admin' && s.isAdmin;
  const requireAdmin=s=>{if(!managementSession(s))throw new Error('管理者専用の操作です。/管理 から開いてください。');};
  function screen(s,note=''){
    if(['home','install','scenarios','archives','tables','table','table-scenario','table-pcs','table-remove-pcs','delete-table'].includes(s.view) && !managementSession(s))throw new Error('管理者専用の画面です。');
    const d=store.metadata();let title='✦  卓・キャラシ',body='',components=[];
    const back=()=>row(button(s,'home','卓・キャラシのメニューへ'));
    const pagination=(page,pages)=>pages>1?[button(s,'prev','前のページ').setDisabled(page===0),button(s,'next','次のページ').setDisabled(page>=pages-1)]:[];
    if(s.view==='home'){
      body='**卓セット**\nシナリオ・伝助・参加PCを卓ごとにまとめます。\n\n**ベース卓**\nシナリオ名から、ココフォリアの卓を探せます。URLは管理者だけに表示します。\n\n**キャラシ**\nメンバー用の登録パネルを設置し、PCの控えを確認できます。';
      components=[row(button(s,'tables','卓セット',ButtonStyle.Primary)),row(button(s,'scenarios','ベース卓を探す',ButtonStyle.Primary),button(s,'form-scenario','ベース卓を登録')),row(button(s,'archives','PCの控えを確認'),button(s,'install','キャラシパネルを設置'))];
    } else if(s.view==='install'){
      title='✦  キャラシパネルを設置';
      body=`**公開範囲** ${s.mode==='shared'?'共有':'秘匿'}\n**設置先** ${s.channelId?`<#${s.channelId}>`:'チャンネルを選んでください'}\n\n**秘匿** · PC名・URLは本人と管理者だけ\n**共有** · PC名・URLをメンバーに表示\nTXTはどちらも本人と管理者だけに表示します。\n既存パネルの公開範囲は変更しません。`;
      components=[row(menu(s,'mode','PC名・URLの公開範囲',[{label:'秘匿 · 本人と管理者だけ',value:'secret',default:s.mode!=='shared'},{label:'共有 · メンバーに表示',value:'shared',default:s.mode==='shared'}])),row(new ChannelSelectMenuBuilder().setCustomId(`trpg:${s.id}:channel`).setPlaceholder('パネルを設置するチャンネル').addChannelTypes(ChannelType.GuildText)),row(button(s,'place','この内容で設置',ButtonStyle.Primary).setDisabled(!s.channelId)),back()];
    } else if(s.view==='scenarios'){
      title='✦  ベース卓';const items=searchScenarios(d.scenarios,s.query??'');const pages=Math.max(1,Math.ceil(items.length/20));s.page=Math.max(0,Math.min(s.page,pages-1));
      body=`${items.length}件 · ${s.page+1}/${pages}ページ${s.query?`\n検索：**${text(s.query)}**`:''}\n\n${s.scenario?`**${text(s.scenario.name)}**\n${s.scenario.url}`:items.length?'シナリオを選ぶと、ベース卓のURLが表示されます。':s.query?'該当するシナリオがありません。検索を解除するか、別の名前で検索してください。':'ベース卓は未登録です。「ベース卓を登録」から追加できます。'}`;
      const part=items.slice(s.page*20,s.page*20+20);
      if(part.length)components.push(row(menu(s,'scenario','ベース卓を選ぶ',part.map(x=>({label:x.name,value:x.id})))));
      if(s.scenario)components.push(row(link('ココフォリアで開く',s.scenario.url)));
      components.push(row(button(s,'form-search','名前で検索'),...(s.query?[button(s,'clear-search','検索を解除')]:[]),button(s,s.scenario?'form-scenario-edit':'form-scenario',s.scenario?'選択した卓を修正':'ベース卓を登録')));
      if(pages>1)components.push(row(...pagination(s.page,pages)));
      components.push(back());
    } else if(s.view==='archives'){
      title='✦  PCの控え';body=d.panels.length?'確認するキャラシパネルを選んでください。管理者は登録されたPCとTXTの控えを閲覧できます。':'キャラシパネルは未設置です。「キャラシパネルを設置」から作成してください。';
      const pages=Math.max(1,Math.ceil(d.panels.length/25));s.page=Math.max(0,Math.min(s.page,pages-1));
      if(d.panels.length)components.push(row(menu(s,'archive-panel','控えを確認するパネル',d.panels.slice(s.page*25,s.page*25+25).map(p=>({label:`${p.mode==='secret'?'秘匿':'共有'} · ${guild.channels.cache.get(p.channelId)?.name??p.channelId}`.slice(0,100),value:p.id})))));
      if(pages>1){body+=`\n\n${s.page+1}/${pages}ページ`;components.push(row(...pagination(s.page,pages)));}
      components.push(row(button(s,'backup-all','全PCの控えをZIPで保存'),button(s,'install','キャラシパネルを設置')),back());
    } else if(['tables','table','table-scenario','table-pcs','table-remove-pcs','delete-table'].includes(s.view)){
      const result=tableScreen(s,d);title=result.title;body=result.body;components=result.components;
    } else {
      const p=d.panels.find(x=>x.id===s.panelId);if(!p)throw new Error('パネルが見つかりません。');
      title='✦  PC一覧';
      if(s.view==='detail' || s.view==='preview' || s.view==='delete-character'){
        const c=store.character(s.characterId,s.userId,s.panelId,s.isAdmin);
        title=s.view==='preview'?'✦  TXTの控え':'✦  PCの控え';
        body=`**${text(c.name)}**\n${c.url}\n\n保存日時 <t:${Math.floor(c.updatedAt/1000)}:f>`;
        if(s.view==='delete-character'){
          title='✧  PC登録を解除';body=`**${text(c.name)}**\n${c.url}\n\nBotの登録とTXTの控えを削除し、卓セットの参加PCから外します。いあきゃらの元データは削除しません。\n必要なら、先にTXTをダウンロードしてください。`;components=[row(button(s,'download','TXTをダウンロード')),row(button(s,'confirm-delete-character','登録解除を確定',ButtonStyle.Danger),button(s,'detail','解除せず戻る'))];
        }else if(s.view==='preview'){
          const pages=Math.max(1,Math.ceil(c.txt.length/1400));s.page=Math.max(0,Math.min(s.page,pages-1));
          body+=`\n\n**TXT · ${s.page+1}/${pages}ページ**\n${escapeMarkdown(c.txt.slice(s.page*1400,(s.page+1)*1400)).replace(/@/g,'＠')}`;
          if(pages>1)components.push(row(...pagination(s.page,pages)));
          components.push(row(button(s,'download','TXTをダウンロード',ButtonStyle.Primary)),row(button(s,'detail','PCの控えへ'),button(s,'characters','PC一覧へ')));
        }else{
          components.push(row(link('いあきゃらで開く',c.url)),row(button(s,'preview','TXTを読む',ButtonStyle.Primary),button(s,'download','TXTをダウンロード')),row(button(s,'refresh','URLから控えを更新'),button(s,'delete-character','登録を解除',ButtonStyle.Danger)),row(button(s,'characters','PC一覧へ')));
        }
      }else{
        let items=visibleCharacters(d,s.panelId,s.userId,s.isAdmin);
        if(s.ownOnly)items=items.filter(c=>d.characters.some(x=>x.id===c.id && x.ownerId===s.userId));
        items=searchScenarios(items,s.pcQuery??'');
        const pages=Math.max(1,Math.ceil(items.length/10));s.page=Math.max(0,Math.min(s.page,pages-1));s.characterPage=s.page;
        const part=items.slice(s.page*10,s.page*10+10);
        const filtered=s.ownOnly || s.pcQuery;
        body=`${p.mode==='secret'?'秘匿':'共有'}モード · ${s.ownOnly?'自分のPC':'閲覧できるPC'} ${items.length}件 · ${s.page+1}/${pages}ページ${s.pcQuery?`\n検索：**${text(s.pcQuery)}**`:''}\n\n${part.map(c=>`**${text(c.name)}**\n${c.url}`).join('\n\n')||(filtered?'条件に合うPCがありません。条件を解除するか、新しい共有URLを登録してください。':'キャラシは未登録です。「共有URLを登録」から追加できます。')}\n\nTXTは本人と管理者だけが閲覧できます。`;
        const own=part.filter(c=>d.characters.some(x=>x.id===c.id && (x.ownerId===s.userId || s.isAdmin)));
        if(own.length)components.push(row(menu(s,'character','TXTの控えを確認するPC',own.map(c=>({label:c.name,value:c.id})))));
        components.push(row(button(s,'form-register','共有URLを登録',ButtonStyle.Primary),button(s,'characters','一覧を更新'),button(s,'form-pc-search','PC名で検索'),button(s,'backup-panel',s.isAdmin?'このパネルの控えをZIPで保存':'自分の控えをZIPで保存')));
        components.push(row(button(s,'mine',s.ownOnly?'すべてのPCを表示':'自分のPCだけ表示'),...(filtered?[button(s,'clear-pc-filter','条件を解除')]:[]),...pagination(s.page,pages)));
        if(managementSession(s))components.push(row(button(s,'archives','パネル一覧へ')));
      }
    }
    const message=payload(title,(note?`${note}\n\n`:'')+body,{components});message.attachments=[];
    return message;
  }
  async function fetchSave(s,url,owner=s.userId,i,expectedId){url=iacharaUrl(url);const time=Date.now();const wait=Math.ceil(((cooldown.get(s.userId)??0)-time)/1000);if(wait>0)throw new Error(`次の更新まであと${wait}秒です。保存済みのTXTは閲覧できます。`);if(cooldown.size>1000)for(const [id,end] of cooldown)if(end<=time)cooldown.delete(id);cooldown.set(s.userId,time+30000);await i.editReply({...payload('✦  キャラシを取得中','いあきゃらから最新のデータを取得しています。保存済みの控えは、取得に成功してから更新します。'),attachments:[]});const result=await iachara.fetchCharacter(url);sessions.get(s.id,s.userId);s.isAdmin=await isAdmin(i);sessions.get(s.id,s.userId);if(owner!==s.userId && !s.isAdmin)throw new Error('管理者権限が変更されたため更新を中止しました。');s.characterId=await store.saveCharacter(s.panelId,owner,url,result,expectedId);s.view='detail';s.page=0;}
  return {sessions,async refreshPanels(){
    let updated=0,failed=0;
    for(const p of store.metadata().panels){
      if(!p.messageId)continue;
      try{const channel=await guild.channels.fetch(p.channelId);const message=await channel.messages.fetch(p.messageId);await message.edit(trpgPanel(p));updated++;}
      catch{failed++;}
    }
    return {updated,failed};
  },async open(i){await i.deferReply({flags:MessageFlags.Ephemeral});if(!await isAdmin(i))throw new Error('管理者専用です。');const s=sessions.create(i.user.id);s.entry='admin';s.isAdmin=true;s.originChannelId=i.channelId;s.view='home';await i.editReply(screen(s));},async handle(i){let s,locked=false;
    try {
      const parts=i.customId.split(':');
      if(parts[1]==='p'){
        const p=store.metadata().panels.find(x=>x.id===parts[2]);const direct=parts[3]==='register';
        if(!p || p.channelId!==i.channelId || p.messageId!==i.message?.id || !['open','register'].includes(parts[3]))throw new Error('このパネルは利用できません。');
        if(!direct)await i.deferReply({flags:MessageFlags.Ephemeral});
        const admin=await isAdmin(i);s=sessions.create(i.user.id);
        Object.assign(s,{entry:'panel',isAdmin:admin,originChannelId:i.channelId,view:'characters',panelId:p.id});
        if(direct)await i.showModal(form(s,'register'));else await i.editReply(screen(s));
        return;
      }
      s=sessions.get(parts[1],i.user.id);if(s.originChannelId && s.originChannelId!==i.channelId)throw new Error('元のチャンネルから操作してください。');const action=parts[2];if(s.busy)throw new Error('前の操作を処理中です。');s.busy=true;locked=true;
      if(action.startsWith('form-')){s.isAdmin=await isAdmin(i);const kind=action.slice(5);if(!['register','pc-search'].includes(kind))requireAdmin(s);if(['register','pc-search'].includes(kind) && !s.panelId)throw new Error('パネルから開いてください。');if(kind==='table'){if(s.tableEditId)delete s.tableDraft;s.tableForm=null;s.tableEditId=null;}if(kind==='table-edit'){s.tableForm=store.table(s.tableId);s.tableEditId=s.tableId;}await i.showModal(form(s,kind));return;}
      // Always create a private response, including forged/public component requests.
      if(i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});s.isAdmin=await isAdmin(i);sessions.get(s.id,s.userId);let note='';
      if(['home','scenarios','archives','install','tables'].includes(action)){requireAdmin(s);s.view=action;s.page=0;s.mode??='secret';delete s.deleteCharacter;delete s.deleteTable;}
      else if(action==='mode'){requireAdmin(s);if(!['secret','shared'].includes(i.values[0]))throw new Error('公開範囲を選択してください。');s.mode=i.values[0];}
      else if(action==='channel'){requireAdmin(s);s.channelId=i.values[0];}
      else if(action==='place'){requireAdmin(s);const channel=await guild.channels.fetch(s.channelId);if(channel?.type!==ChannelType.GuildText || !channel.permissionsFor(guild.members.me)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks]))throw new Error('設置先とBotの閲覧・送信・埋め込み権限を確認してください。');const id=await store.addPanel(channel.id,s.mode);const p=store.metadata().panels.find(x=>x.id===id);let message;try{message=await channel.send(trpgPanel(p));await store.update(d=>{d.panels.find(x=>x.id===id).messageId=message.id;});}catch(e){if(message)await message.delete().catch(()=>{});await store.update(d=>{d.panels=d.panels.filter(x=>x.id!==id);});throw e;}note='✓ キャラシパネルを設置しました。';s.view='home';}
      else if(action==='submit-scenario'){requireAdmin(s);await store.scenario(i.fields.getTextInputValue('name'),i.fields.getTextInputValue('url'));s.view='scenarios';s.query='';s.scenario=null;note='✓ ベース卓を登録しました。';}
      else if(action==='clear-search'){requireAdmin(s);s.query='';s.scenario=null;s.page=0;s.view='scenarios';}
      else if(action==='submit-search'){requireAdmin(s);s.query=i.fields.getTextInputValue('query');s.view='scenarios';s.page=0;s.scenario=null;}
      else if(action==='scenario'){requireAdmin(s);s.scenario=store.metadata().scenarios.find(x=>x.id===i.values[0]);if(!s.scenario)throw new Error('シナリオが見つかりません。');}
      else if(action==='archive-panel'){requireAdmin(s);s.panelId=i.values[0];s.view='characters';s.page=0;s.characterPage=0;s.pcQuery='';s.ownOnly=false;s.registrationUrl='';}
      else if(action==='submit-pc-search'){if(!s.panelId)throw new Error('パネルから開いてください。');s.pcQuery=i.fields.getTextInputValue('query').trim().slice(0,100);s.view='characters';s.page=0;}
      else if(action==='mine'){if(!s.panelId)throw new Error('パネルから開いてください。');s.ownOnly=!s.ownOnly;s.view='characters';s.page=0;}
      else if(action==='clear-pc-filter'){s.pcQuery='';s.ownOnly=false;s.view='characters';s.page=0;}
      else if(action==='submit-register'){s.registrationUrl=i.fields.getTextInputValue('url').trim().slice(0,100);await fetchSave(s,s.registrationUrl,s.userId,i);note='✓ PC名・共有URL・TXTを保存しました。';}
      else if(action==='character'){store.character(i.values[0],s.userId,s.panelId,s.isAdmin);s.characterId=i.values[0];s.view='detail';s.page=0;}
      else if(action==='characters'){delete s.deleteCharacter;s.view='characters';s.page=s.characterPage??0;}
      else if(action==='refresh'){const c=store.character(s.characterId,s.userId,s.panelId,s.isAdmin);await fetchSave(s,c.url,c.ownerId,i,c.id);note='✓ 最新のキャラデータを保存しました。';}
      else if(action==='detail'){delete s.deleteCharacter;store.character(s.characterId,s.userId,s.panelId,s.isAdmin);s.view='detail';s.page=0;}
      else if(action==='preview'){store.character(s.characterId,s.userId,s.panelId,s.isAdmin);s.view='preview';s.page=0;}
      else if(action==='download'){const c=store.character(s.characterId,s.userId,s.panelId,s.isAdmin);await i.editReply({...screen(s),files:[new AttachmentBuilder(Buffer.from(c.txt,'utf8'),{name:`character-${c.id}.txt`})]});return;}
      else if(action==='submit-table'){
        requireAdmin(s);if(!s.tableModal || parts[3]!==s.tableModal.token)throw new Error('最新の入力フォームから操作してください。');s.tableDraft={name:i.fields.getTextInputValue('name').slice(0,100),answerUrl:i.fields.getTextInputValue('answer').slice(0,250)};
        s.tableId=await store.saveTable(s.tableModal.id,s.tableDraft.name,s.tableDraft.answerUrl,s.tableModal.revision);delete s.tableDraft;delete s.tableModal;s.tableEditId=null;s.view='table';s.page=0;note='✓ 卓セットを保存しました。';
      }
      else if(action==='table-select'){requireAdmin(s);store.table(i.values[0]);s.tableId=i.values[0];delete s.tableDraft;s.view='table';s.page=0;}
      else if(['table','table-scenario','table-pcs','table-remove-pcs'].includes(action)){requireAdmin(s);store.table(s.tableId);delete s.deleteTable;s.view=action;s.page=0;}
      else if(action==='table-set-scenario'){requireAdmin(s);await store.setTableScenario(s.tableId,i.values[0]);s.view='table';s.page=0;note='✓ シナリオを設定しました。';}
      else if(action==='table-add-characters' || action==='table-remove-characters'){requireAdmin(s);await store.changeTableCharacters(s.tableId,i.values,action==='table-remove-characters');note=action==='table-add-characters'?'✓ 参加PCを追加しました。':'✓ 卓セットからPCを外しました。登録・控えは保持しています。';}
      else if(action==='delete-table'){requireAdmin(s);s.deleteTable=JSON.stringify(store.table(s.tableId));s.view='delete-table';}
      else if(action==='confirm-delete-table'){requireAdmin(s);if(s.view!=='delete-table' || !s.deleteTable)throw new Error('卓セットの削除確認から操作してください。');await store.removeTable(s.tableId,s.deleteTable);delete s.deleteTable;s.view='tables';s.page=0;note='✓ 卓セットを削除しました。';}
      else if(action==='delete-character'){const c=store.character(s.characterId,s.userId,s.panelId,s.isAdmin);s.deleteCharacter={id:c.id,revision:characterRevision(c)};s.view='delete-character';}
      else if(action==='confirm-delete-character'){
        if(s.view!=='delete-character' || !s.deleteCharacter || s.deleteCharacter.id!==s.characterId)throw new Error('登録解除の確認画面から操作してください。');
        await store.removeCharacter(s.characterId,s.userId,s.panelId,s.isAdmin,s.deleteCharacter.revision);delete s.deleteCharacter;s.characterId=null;s.view='characters';s.page=s.characterPage??0;note='✓ PC登録と控えを削除しました。';
      }
      else if(action==='backup-panel' || action==='backup-all'){
        if(action==='backup-all')requireAdmin(s);
        const scope=action==='backup-all'?null:s.panelId;
        if(action==='backup-panel' && !scope)throw new Error('パネルから開いてください。');
        if((backupCooldown.get(s.userId)??0)>Date.now())throw new Error('ZIPの再取得は10秒ほどお待ちください。');
        const files=backupBundles(store.backupCharacters(s.userId,scope,s.isAdmin));
        if(backupCooldown.size>=200)for(const [id,end] of backupCooldown)if(end<=Date.now())backupCooldown.delete(id);
        backupCooldown.set(s.userId,Date.now()+10000);
        await i.editReply({...screen(s,'✓ 控えをZIPにまとめました。ダウンロードして保管してください。'),files:files.map(f=>new AttachmentBuilder(f.data,{name:f.name}))});return;
      }
      else if(action==='prev' || action==='next')s.page+=action==='prev'?-1:1;
      else throw new Error('不明な操作です。');
      await i.editReply(screen(s,note));
    }catch(e){
      const components=[];
      // Recovery buttons carry no stored data. Every click still rechecks access.
      if(s && locked){
        if(s.entry==='admin' && ['tables','table','table-scenario','table-pcs','table-remove-pcs','delete-table'].includes(s.view))components.push(row(button(s,'tables','卓セット一覧へ'),button(s,s.tableEditId?'form-table-edit':'form-table','入力をやり直す')));
        else if(s.panelId)components.push(row(button(s,'characters','PC一覧へ'),button(s,'form-register','共有URLを入力し直す')));
        else if(s.entry==='admin')components.push(row(button(s,'home','卓・キャラシのメニューへ')));
      }
      const error=payload('✧  卓・キャラシ',`操作できませんでした：${text(e.message)}\n既存の控えは保持しています。`,{state:'error',components});error.attachments=[];if(i.deferred || i.replied)await i.editReply(error);else await i.reply({...error,flags:MessageFlags.Ephemeral});}finally{if(locked)s.busy=false;}
  }};
}
