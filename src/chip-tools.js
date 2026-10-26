import {randomInt,randomUUID} from 'node:crypto';
import {ActionRowBuilder,ButtonBuilder,ButtonStyle,UserSelectMenuBuilder,ModalBuilder,TextInputBuilder,TextInputStyle,MessageFlags,PermissionFlagsBits as P} from 'discord.js';
import {GameSessions} from './game-sessions.js';
import {themed,text} from './ui.js';
import {MAX_CHIPS} from './game-wallets.js';
const {payload}=themed('game','🪙');
const row=(...items)=>new ActionRowBuilder().addComponents(...items);
const button=(prefix,s,action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`${prefix}:${s.id}:${s.turn}:${action}`).setLabel(label).setStyle(style);
const home=()=>new ButtonBuilder().setCustomId('game:open').setLabel('ゲーム選択へ').setStyle(ButtonStyle.Secondary);
const number=n=>n.toLocaleString('ja-JP');
export function transferScreen(s,balance,note=''){
  const to=s.target?`<@${s.target}>`:null;let description,components;
  if(s.view==='done'){description=`**${number(s.amount)}チップを渡しました**\n相手 ${to}\n残高 ${number(balance)} チップ`;components=[row(button('chips',s,'restart','別の譲渡'),home())];}
  else if(s.view==='confirm'){description=`**3 · この内容で渡しますか？**\n相手 ${to} · **${number(s.amount)}チップ**\n${balance>=s.amount?`残高 ${number(balance)} → ${number(balance-s.amount)} チップ`:'残高が不足しています。枚数を変更してください。'}\n確定するまでチップは移動しません。`;components=[row(button('chips',s,'confirm','この相手に渡す',ButtonStyle.Primary).setDisabled(balance<s.amount),button('chips',s,'back','内容を直す'),home())];}
  else{description=`**残高 ${number(balance)} チップ**\n${to?`**2 · 枚数を入力する**\n相手 ${to}${s.amountDraft!==undefined?'\n前の入力を保持しています。「枚数を入力」で修正できます。':s.amount?`\n入力済み ${number(s.amount)}チップ`:''}`:'**1 · 相手を選ぶ**\n相手と枚数を確認してから確定します。'}`;components=[row(new UserSelectMenuBuilder().setCustomId(`chips:${s.id}:${s.turn}:target`).setPlaceholder('渡す相手を選ぶ').setMinValues(1).setMaxValues(1)),row(button('chips',s,'amount','枚数を入力',ButtonStyle.Primary).setDisabled(!s.target),home())];}
  return {...payload('✦  チップを渡す',(note?`${note}\n\n`:'')+description,{state:s.view==='done'?'success':note||s.view==='confirm'?'warning':'normal',components}),attachments:[]};
}
const animals=[{emoji:'🐔',name:'ニワトリ'},{emoji:'🐤',name:'ひよこ'},{emoji:'🦆',name:'アヒル'},{emoji:'🐇',name:'ウサギ'},{emoji:'🐈',name:'ネコ'}];
const sequenceText=s=>s.sequence.map(n=>animals[n].emoji).join(' → ');
export function workScreen(s,balance,note=''){
  let description,components;const score=`成功 ${s.caught??0}/${s.length??3} · 自己ベスト ${s.best??0}個`;
  if(s.view==='done'){description=`**${s.failed?'あれ？別の仲間でした。':'全員、おかえり！'}**\n${score}\n\n${s.failed?`正しい順番\n${sequenceText(s)}`:s.reward?`お礼 **+${s.reward}チップ**`:({solvent:'今回はチップの追加なし。',blackjack:'勝負中のため、お礼は今回なし。',limit:'この1時間のお礼は受け取り済み。',cooldown:'お礼の受け取りは30秒ごとです。'}[s.rewardReason]??'今回はお手伝いだけ。')}\n\n残高 ${number(balance)} チップ`;components=[row(button('work',s,'again','もう一度',ButtonStyle.Primary),button('work',s,'difficulty','難易度を変える'),home())];}
  else if(s.view==='claim'){description=`**全員捕まえました！**\n${score}`;components=[row(button('work',s,'claim','結果を確定',ButtonStyle.Primary),home())];}
  else if(s.view==='ready'){description=`逃げた仲間の順番を覚えて、同じ順番で捕まえよう。\n\n**いつでも無料** · 自己ベスト ${s.best??0}個\nチップ不足時のお礼は5枚。受け取りは30秒ごと・1時間で最大30枚。`;components=[row(button('work',s,'start-3','かんたん · 3個',ButtonStyle.Primary),button('work',s,'start-5','ふつう · 5個'),button('work',s,'start-7','むずかしい · 7個')),row(home())];}
  else if(s.view==='watch'){description=`**逃げた順番を覚えよう**\n\n${sequenceText(s)}\n\n「覚えた」を押すと順番を隠します。`;components=[row(button('work',s,'remember','覚えた',ButtonStyle.Primary),button('work',s,'cancel','難易度を選び直す'),home())];}
  else{description=`**${s.caught+1}番目に逃げたのは？**\n成功 ${s.caught}/${s.length}\n\n覚えた順番で、仲間を選んでください。`;components=[row(...animals.slice(0,3).map((a,n)=>button('work',s,`pick-${n}`,a.name).setEmoji(a.emoji))),row(...animals.slice(3).map((a,n)=>button('work',s,`pick-${n+3}`,a.name).setEmoji(a.emoji))),row(button('work',s,'cancel','難易度を選び直す'),home())];}
  return {...payload('🐔  ぴよぴよ脱走劇',(note?`${note}\n\n`:'')+description,{state:s.view==='done'?(s.failed?'error':'success'):'normal',components,icon:'🐔'}),attachments:[]};
}
export function createChipTools({guild,wallet,now=()=>Date.now(),random=randomInt,access=async i=>{const member=await guild.members.fetch({user:i.user.id,force:true}),channel=await guild.channels.fetch(i.channelId,{force:true});if(!channel?.permissionsFor(member)?.has(P.ViewChannel))throw new Error('このチャンネルでは操作できません。');},recipient=async(id,user)=>{if(!/^\d{17,20}$/.test(id)||id===user)throw new Error('自分以外のメンバーを選んでください。');const member=await guild.members.fetch({user:id,force:true});if(!member || member.user.bot)throw new Error('Bot以外のサーバーメンバーを選んでください。');return member;}}){
  const transfers=new GameSessions(now),work=new GameSessions(now,s=>['watch','playing','claim'].includes(s.view));
  const get=(prefix,id,i)=>{let s;try{s=(prefix==='chips'?transfers:work).get(id,i.user.id);}catch{throw new Error('この画面は終了しています。/menu → ゲーム から開き直してください。');}if(s.channelId!==i.channelId)throw new Error('元のチャンネルから操作してください。');return s;};
  const screen=(prefix,s,note)=>(prefix==='chips'?transferScreen:workScreen)(s,wallet.balance(s.userId),note);
  async function ack(i){if(i.deferred||i.replied)return;if(i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});}
  const chooseTarget=()=>{const n=random(5);if(!Number.isInteger(n)||n<0||n>4)throw new Error('ニワトリを見失いました。画面を開き直してください。');return n;};
  async function start(s,i,check,length){if(![3,5,7].includes(length))throw new Error('難易度を選び直してください。');const sequence=Array.from({length},()=>chooseTarget()),ticketId=randomUUID();const ticket=await wallet.beginWork(s.userId,ticketId,check);Object.assign(s,{ticketId,sequence,length,caught:0,failed:false,reward:0,rewardReason:null,best:wallet.memoryBest(s.userId),view:'watch',expires:ticket.expires});}
  async function complete(s,check){const result=await wallet.earnWork(s.userId,s.ticketId,check,{score:s.caught});Object.assign(s,{reward:result.reward,rewardReason:result.reason,best:result.best,view:'done'});}
  async function open(i,prefix){await ack(i);await access(i);const sessions=prefix==='chips'?transfers:work;const other=[...sessions.sessions.values()].find(x=>x.userId===i.user.id&&x.expires>now());if(other?.busy)throw new Error('前の操作を処理中です。');if(prefix==='work'&&other&&other.channelId!==i.channelId&&['watch','playing','claim'].includes(other.view))throw new Error('進行中のニワトリを元のチャンネルから捕まえてください。');let s=[...sessions.sessions.values()].find(x=>x.userId===i.user.id&&x.channelId===i.channelId&&x.expires>now());if(s?.busy)throw new Error('前の操作を処理中です。');if(!s){s=sessions.create(i.user.id);Object.assign(s,{channelId:i.channelId,turn:0,view:prefix==='chips'?'draft':'ready',best:prefix==='work'?wallet.memoryBest(i.user.id):undefined});}await i.editReply(screen(prefix,s));}
  async function handle(i){let s,prefix,locked=false,authorized=false;try{
    const parts=i.customId.split(':');prefix=parts[0];if(!['chips','work'].includes(prefix))throw new Error('操作を確認してください。');if(parts[1]==='open'){await open(i,prefix);return;}
    const [,id,turn,action,token]=parts;s=get(prefix,id,i);if(s.busy)throw new Error('前の操作を処理中です。');s.busy=true;locked=true;
    if(action!=='amount')await ack(i);await access(i);get(prefix,id,i);authorized=true;
    const check=async()=>{authorized=false;await access(i);get(prefix,id,i);authorized=true;};
    if(String(s.turn)!==turn)throw new Error('画面を最新の状態に戻しました。もう一度選んでください。');
    let note='';
    if(prefix==='chips'){
      if(action==='target'){if(s.view!=='draft'||i.values?.length!==1)throw new Error('相手を選び直してください。');authorized=false;await recipient(i.values[0],s.userId);await access(i);get(prefix,id,i);authorized=true;if(s.target!==i.values[0]){s.amount=null;delete s.amountDraft;}s.target=i.values[0];delete s.formToken;}
      else if(action==='amount'){if(s.view!=='draft'||!s.target)throw new Error('相手を先に選んでください。');authorized=false;await recipient(s.target,s.userId);await access(i);get(prefix,id,i);authorized=true;s.formToken=randomUUID().slice(0,12);const modal=new ModalBuilder().setCustomId(`chips:${s.id}:${s.turn}:amount-form:${s.formToken}`).setTitle('渡すチップの枚数').addComponents(row(new TextInputBuilder().setCustomId('amount').setLabel('チップの枚数').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(9).setPlaceholder('例：100')));const draft=s.amountDraft??(s.amount?String(s.amount):'');if(draft)modal.components[0].components[0].setValue(draft);await i.showModal(modal);return;}
      else if(action==='amount-form'){if(s.view!=='draft'||!token||token!==s.formToken)throw new Error('最新の枚数入力から操作してください。');const value=i.fields.getTextInputValue('amount').trim();s.amountDraft=value.slice(0,9);if(!/^[1-9]\d{0,8}$/.test(value)||Number(value)>MAX_CHIPS)throw new Error('枚数は1以上の整数で入力してください。');const amount=Number(value);if(wallet.balance(s.userId)<amount)throw new Error('チップが不足しています。');s.amount=amount;delete s.amountDraft;s.view='confirm';s.sendId=randomUUID();delete s.formToken;}
      else if(action==='back'){if(s.view!=='confirm')throw new Error('確認画面から操作してください。');s.view='draft';delete s.sendId;}
      else if(action==='restart'){if(s.view!=='done')throw new Error('この譲渡はまだ完了していません。');s.view='draft';s.target=null;s.amount=null;delete s.amountDraft;delete s.sendId;}
      else if(action==='confirm'){if(s.view!=='confirm'||!s.sendId)throw new Error('譲渡の確認画面から操作してください。');await wallet.transfer(s.userId,s.target,s.amount,s.sendId,async()=>{await check();authorized=false;await recipient(s.target,s.userId);await access(i);get(prefix,id,i);authorized=true;});s.view='done';}
      else throw new Error('操作を確認してください。');
    }else{
      if(action==='start'||action==='again'||/^start-[357]$/.test(action)){if(!['ready','done'].includes(s.view))throw new Error('今のゲームを先に終えてください。');const length=action==='again'?(s.length??3):action==='start'?3:Number(action.slice(6));await start(s,i,check,length);}
      else if(action==='difficulty'){if(s.view!=='done')throw new Error('ゲームを終えてから選んでください。');s.view='ready';}
      else if(action==='cancel'){if(!['watch','playing'].includes(s.view))throw new Error('進行中のゲームから操作してください。');const result=await wallet.failWork(s.userId,s.ticketId,s.caught??0,check);s.best=result.best;s.view='ready';delete s.ticketId;delete s.sequence;s.caught=0;s.reward=0;s.failed=false;note='ゲームを終了しました。難易度を選んで始められます。';}
      else if(action==='remember'){if(s.view!=='watch')throw new Error('順番を覚える画面から操作してください。');s.view='playing';}
      else if(/^pick-[0-4]$/.test(action)){if(s.view!=='playing')throw new Error('回答の画面から操作してください。');if(Number(action.slice(5))!==s.sequence[s.caught]){const result=await wallet.failWork(s.userId,s.ticketId,s.caught,check);s.best=result.best;s.failed=true;s.reward=0;s.view='done';}else{s.caught++;if(s.caught===s.length){s.view='claim';await complete(s,check);}}}
      else if(action==='claim'){if(s.view!=='claim'||s.caught!==s.length)throw new Error('全員捕まえてから確定してください。');await complete(s,check);}
      else throw new Error('操作を確認してください。');
    }
    s.turn++;await i.editReply(screen(prefix,s,note));
  }catch(e){let safe=false;if(authorized&&s){try{get(prefix,s.id,i);safe=true;}catch{}}const m=safe?screen(prefix,s,text(e.message)):{...payload('✦  チップ',text(e.message),{state:'error',components:[row(home())]}),attachments:[]};if(i.deferred||i.replied)await i.editReply(m);else await i.reply({...m,flags:MessageFlags.Ephemeral});}finally{if(locked)s.busy=false;}}
  return {transfers,work,openTransfer:i=>open(i,'chips'),openWork:i=>open(i,'work'),handle};
}
