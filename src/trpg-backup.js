import {ActionRowBuilder,ButtonBuilder,ButtonStyle,AttachmentBuilder} from 'discord.js';
import {randomUUID} from 'node:crypto';
import {themed,menuHomeButton} from './ui.js';
import {prepareBackups,MAX_ZIP} from './backups.js';
const {payload}=themed('trpg');
const row=(...items)=>new ActionRowBuilder().addComponents(...items);
const button=(s,action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`trpg:${s.id}:${action}`).setLabel(label).setStyle(style);
const size=bytes=>bytes<1024*1024?`${Math.max(1,Math.ceil(bytes/1024))} KiB`:`${(bytes/1024/1024).toFixed(1)} MiB`;
function uploadLimit(i){
  if(i.attachmentSizeLimit===undefined)return MAX_ZIP;
  if(!Number.isSafeInteger(i.attachmentSizeLimit)||i.attachmentSizeLimit<1)throw new Error('ファイルの送信上限を確認できません。画面を開き直してください。');
  return Math.min(MAX_ZIP,i.attachmentSizeLimit);
}
export function backupScreen(s,attached=false){
  const b=s.backup,p=b.parts[b.page],part=n=>`backup-part:${b.token}:${n}`;
  const scope=b.scope===null?'全PCの控え':b.admin?'このパネルの全PCの控え':'自分のPCの控え';
  const description=`**${scope} · ${b.totalCount}PC**\nZIP **${b.page+1} / ${b.parts.length}** · このZIP **${p.count}PC / ${size(p.bytes)}**\n\n${attached?'添付のZIPを端末へ保存してください。':'「このZIPを取得」でファイルを表示できます。'}${b.parts.length>1?'\nすべての控えを保存するには、順番に各ZIPを取得してください。切り替えると添付が置き換わるため、先に端末へ保存してください。':''}`;
  return {...payload('✦  PCの控えを保存',description,{components:[row(...(b.parts.length>1?[button(s,part(Math.max(0,b.page-1)),'前のZIP').setDisabled(b.page===0)]:[]),button(s,part(b.page),attached?'このZIPを再取得':'このZIPを取得',attached?ButtonStyle.Secondary:ButtonStyle.Primary),...(b.parts.length>1?[button(s,part(b.page+1),'次のZIP',attached?ButtonStyle.Primary:ButtonStyle.Secondary).setDisabled(b.page===b.parts.length-1)]:[])),row(button(s,`backup-return:${b.token}`,b.scope===null?'パネル一覧へ':'PC一覧へ'),menuHomeButton())]}),attachments:[]};
}
export function createTrpgBackups({store,authorize,now=()=>Date.now()}){
  const cooldown=new Map();let transferring=false;
  async function check(i,s,b){
    await authorize(i,s);
    if(s.backup!==b||s.view!=='backup')throw new Error('最新の控えの画面から操作してください。');
    if(b.admin&&!s.isAdmin || b.scope===null&&(s.entry!=='admin'||!s.isAdmin))throw new Error('管理者権限が変更されたため取得を中止しました。');
  }
  function prepare(s,b){return prepareBackups(store.backupCharacters(s.userId,b.scope,b.admin),b.maxBytes);}
  async function transfer(i,s,b,page,starting=false){
    if(transferring)throw new Error('別の控えを送信中です。少し待ってから取得してください。');
    transferring=true;
    try{
      await check(i,s,b);
      if(uploadLimit(i)<b.parts[page].bytes)throw new Error('送信上限が変わりました。最新の控えでZIPを作り直してください。');
      const prepared=prepare(s,b);
      if(prepared.plan.signature!==b.signature)throw new Error('控えが更新・変更されました。最新の控えでZIPを作り直してください。');
      const file=await prepared.partAsync(page);
      await check(i,s,b);
      // Changes committed while permissions were being fetched cannot slip into
      // a multipart download or expose a backup that has since been removed.
      if(prepare(s,b).plan.signature!==b.signature)throw new Error('控えが更新・変更されました。最新の控えでZIPを作り直してください。');
      if(starting){if(cooldown.size>=200)for(const [id,end] of cooldown)if(end<=now())cooldown.delete(id);cooldown.set(s.userId,now()+10000);}
      b.page=page;b.token=randomUUID().slice(0,12);
      await i.editReply({...backupScreen(s,true),files:[new AttachmentBuilder(file.data,{name:file.name})]});
    }finally{transferring=false;}
  }
  return {
    async start(i,s,all=false){
      await authorize(i,s);
      if(all&&(s.entry!=='admin'||!s.isAdmin))throw new Error('管理者専用の操作です。/admin から開いてください。');
      const scope=all?null:s.panelId;if(!all&&!scope)throw new Error('パネルから開いてください。');
      if((cooldown.get(s.userId)??0)>now())throw new Error('ZIPの作り直しは10秒ほどお待ちください。');
      if(transferring)throw new Error('別の控えを送信中です。少し待ってから取得してください。');
      const maxBytes=uploadLimit(i),admin=!!s.isAdmin,prepared=prepareBackups(store.backupCharacters(s.userId,scope,admin),maxBytes);
      // Keep only scope, counts, sizes and a digest. TXT, ZIP buffers and the
      // encoder closure stay local to this operation, outside the session.
      const b={...prepared.plan,scope,admin,page:0,token:randomUUID().slice(0,12),returnPage:all?s.page:(s.characterPage??s.page??0)};
      s.backup=b;s.view='backup';await transfer(i,s,b,0,true);
    },
    async download(i,s,token,page){
      const b=s.backup;
      if(s.view!=='backup'||!b||b.token!==token||!/^\d{1,3}$/.test(page??''))throw new Error('最新の控えの画面からZIPを選んでください。');
      const index=Number(page);if(index>=b.parts.length)throw new Error('ZIPを選び直してください。');
      await transfer(i,s,b,index);
    },
    back(s,token){const b=s.backup;if(s.view!=='backup'||!b||b.token!==token)throw new Error('最新の控えの画面から戻ってください。');s.view=b.scope===null?'archives':'characters';s.page=b.returnPage;delete s.backup;},
  };
}
