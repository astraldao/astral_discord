import {randomInt,randomUUID} from 'node:crypto';
import {ActionRowBuilder,ButtonBuilder,ButtonStyle,UserSelectMenuBuilder,ModalBuilder,TextInputBuilder,TextInputStyle,MessageFlags,PermissionFlagsBits as P} from 'discord.js';
import {AdminSessions} from './admin.js';
import {payload,text} from './ui.js';
import {MAX_CHIPS} from './game-wallets.js';
const row=(...items)=>new ActionRowBuilder().addComponents(...items);
const button=(prefix,s,action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`${prefix}:${s.id}:${s.turn}:${action}`).setLabel(label).setStyle(style);
const home=()=>new ButtonBuilder().setCustomId('game:open').setLabel('ゲーム選択へ').setStyle(ButtonStyle.Secondary);
const number=n=>n.toLocaleString('ja-JP');
export function transferScreen(s,balance,note=''){
  const to=s.target?`<@${s.target}>`:null;let description,components;
  if(s.view==='done'){description=`**${number(s.amount)}チップを渡しました**\n相手 ${to}\n残高 ${number(balance)} チップ`;components=[row(button('chips',s,'restart','別の譲渡'),home())];}
  else if(s.view==='confirm'){description=`**${to} に ${number(s.amount)}チップを渡しますか？**\n${balance>=s.amount?`残高 ${number(balance)} → ${number(balance-s.amount)} チップ`:'残高が不足しています。枚数を変更してください。'}`;components=[row(button('chips',s,'confirm','この相手に渡す',ButtonStyle.Primary).setDisabled(balance<s.amount),button('chips',s,'back','内容を直す'),home())];}
  else{description=`**残高 ${number(balance)} チップ**\n${to?`相手 ${to}\n枚数を入力してください。`:'チップを渡す相手を選んでください。'}`;components=[row(new UserSelectMenuBuilder().setCustomId(`chips:${s.id}:${s.turn}:target`).setPlaceholder('渡す相手を選ぶ').setMinValues(1).setMaxValues(1)),row(button('chips',s,'amount','枚数を入力',ButtonStyle.Primary).setDisabled(!s.target),home())];}
  return {...payload('✦  チップを渡す',(note?`${note}\n\n`:'')+description,{state:s.view==='done'?'success':'normal',components}),attachments:[]};
}
export function workScreen(s,balance,note=''){
  let description,components;
  if(s.view==='done'){description=`**ニワトリを連れ戻しました！**\n${s.reward?`お礼 **+${s.reward}チップ**`:'チップが足りているので、今回はお手伝いだけ。'}\n残高 ${number(balance)} チップ`;components=[row(button('work',s,'again','もう一度お手伝い').setDisabled(balance>=10),home().setStyle(balance>=10?ButtonStyle.Primary:ButtonStyle.Secondary))];}
  else if(s.view==='claim'){description='**3羽とも確保！**\n最後まで卵を守り抜きました。お礼を受け取ってください。';components=[row(button('work',s,'claim','お礼を受け取る',ButtonStyle.Primary),home())];}
  else if(s.view==='ready'){description=`**残高 ${number(balance)} チップ**\n逃げたニワトリを3回捕まえる、無料のお手伝い。\nお礼は **5チップ**。\n30秒に1回・1時間で最大30チップ。`;components=[row(button('work',s,'start','ニワトリを探す',ButtonStyle.Primary).setDisabled(balance>=10),home())];}
  else{description=`**🐔 ぴよぴよ脱走劇**\n捕獲 ${s.caught}/3 · ニワトリを押して連れ戻そう。`;components=[row(...Array.from({length:5},(_,n)=>button('work',s,`pick-${n}`,n===s.target?'🐔':'🥚',ButtonStyle.Secondary))),row(home())];}
  return {...payload('✦  ニワトリのお手伝い',(note?`${note}\n\n`:'')+description,{state:s.view==='done'?'success':'normal',components}),attachments:[]};
}
export function createChipTools({guild,wallet,now=()=>Date.now(),random=randomInt,access=async i=>{const member=await guild.members.fetch({user:i.user.id,force:true}),channel=await guild.channels.fetch(i.channelId,{force:true});if(!channel?.permissionsFor(member)?.has(P.ViewChannel))throw new Error('このチャンネルでは操作できません。');},recipient=async(id,user)=>{if(!/^\d{17,20}$/.test(id)||id===user)throw new Error('自分以外のメンバーを選んでください。');const member=await guild.members.fetch({user:id,force:true});if(!member || member.user.bot)throw new Error('Bot以外のサーバーメンバーを選んでください。');return member;}}){
  const transfers=new AdminSessions(now),work=new AdminSessions(now);
  const get=(prefix,id,i)=>{let s;try{s=(prefix==='chips'?transfers:work).get(id,i.user.id);}catch{throw new Error('この画面は終了しています。/game から開き直してください。');}if(s.channelId!==i.channelId)throw new Error('元のチャンネルから操作してください。');return s;};
  const screen=(prefix,s,note)=>(prefix==='chips'?transferScreen:workScreen)(s,wallet.balance(s.userId),note);
  async function ack(i){if(i.deferred||i.replied)return;if(i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});}
  const chooseTarget=()=>{const n=random(5);if(!Number.isInteger(n)||n<0||n>4)throw new Error('ニワトリを見失いました。画面を開き直してください。');return n;};
  async function start(s,i,check){const target=chooseTarget(),ticketId=randomUUID();const ticket=await wallet.beginWork(s.userId,ticketId,check);Object.assign(s,{ticketId,target,caught:0,view:'playing',expires:ticket.expires});}
  async function open(i,prefix){await ack(i);await access(i);const sessions=prefix==='chips'?transfers:work;const other=[...sessions.sessions.values()].find(x=>x.userId===i.user.id&&x.expires>now());if(other?.busy)throw new Error('前の操作を処理中です。');if(prefix==='work'&&other&&other.channelId!==i.channelId&&['playing','claim'].includes(other.view))throw new Error('進行中のニワトリを元のチャンネルから捕まえてください。');let s=[...sessions.sessions.values()].find(x=>x.userId===i.user.id&&x.channelId===i.channelId&&x.expires>now());if(s?.busy)throw new Error('前の操作を処理中です。');if(!s){s=sessions.create(i.user.id);Object.assign(s,{channelId:i.channelId,turn:0,view:prefix==='chips'?'draft':'ready'});}await i.editReply(screen(prefix,s));}
  async function handle(i){let s,prefix,locked=false,authorized=false;try{
    const parts=i.customId.split(':');prefix=parts[0];if(!['chips','work'].includes(prefix))throw new Error('操作を確認してください。');if(parts[1]==='open'){await open(i,prefix);return;}
    const [,id,turn,action,token]=parts;s=get(prefix,id,i);if(s.busy)throw new Error('前の操作を処理中です。');s.busy=true;locked=true;
    if(action!=='amount')await ack(i);await access(i);get(prefix,id,i);authorized=true;
    const check=async()=>{authorized=false;await access(i);get(prefix,id,i);authorized=true;};
    if(String(s.turn)!==turn)throw new Error('画面を最新の状態に戻しました。もう一度選んでください。');
    let note='';
    if(prefix==='chips'){
      if(action==='target'){if(s.view!=='draft'||i.values?.length!==1)throw new Error('相手を選び直してください。');authorized=false;await recipient(i.values[0],s.userId);await access(i);get(prefix,id,i);authorized=true;s.target=i.values[0];s.amount=null;delete s.formToken;}
      else if(action==='amount'){if(s.view!=='draft'||!s.target)throw new Error('相手を先に選んでください。');authorized=false;await recipient(s.target,s.userId);await access(i);get(prefix,id,i);authorized=true;s.formToken=randomUUID().slice(0,12);const modal=new ModalBuilder().setCustomId(`chips:${s.id}:${s.turn}:amount-form:${s.formToken}`).setTitle('渡すチップの枚数').addComponents(row(new TextInputBuilder().setCustomId('amount').setLabel('チップの枚数').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(9).setPlaceholder('例：100')));if(s.amount)modal.components[0].components[0].setValue(String(s.amount));await i.showModal(modal);return;}
      else if(action==='amount-form'){if(s.view!=='draft'||!token||token!==s.formToken)throw new Error('最新の枚数入力から操作してください。');const value=i.fields.getTextInputValue('amount').trim();if(!/^[1-9]\d{0,8}$/.test(value)||Number(value)>MAX_CHIPS)throw new Error('枚数は1以上の整数で入力してください。');const amount=Number(value);if(wallet.balance(s.userId)<amount)throw new Error('チップが不足しています。');s.amount=amount;s.view='confirm';s.sendId=randomUUID();delete s.formToken;}
      else if(action==='back'){if(s.view!=='confirm')throw new Error('確認画面から操作してください。');s.view='draft';delete s.sendId;}
      else if(action==='restart'){if(s.view!=='done')throw new Error('この譲渡はまだ完了していません。');s.view='draft';s.target=null;s.amount=null;delete s.sendId;}
      else if(action==='confirm'){if(s.view!=='confirm'||!s.sendId)throw new Error('譲渡の確認画面から操作してください。');await wallet.transfer(s.userId,s.target,s.amount,s.sendId,async()=>{await check();authorized=false;authorized=false;await recipient(s.target,s.userId);await access(i);get(prefix,id,i);authorized=true;authorized=true;});s.view='done';}
      else throw new Error('操作を確認してください。');
    }else{
      if(action==='start'||action==='again'){if(!['ready','done'].includes(s.view))throw new Error('今のニワトリを先に捕まえてください。');await start(s,i,check);}
      else if(/^pick-[0-4]$/.test(action)){if(s.view!=='playing')throw new Error('ニワトリの画面から操作してください。');if(Number(action.slice(5))!==s.target)note='🥚 それは卵です。ニワトリは隣で堂々と逃げています。';else{const target=s.caught<2?chooseTarget():null;s.caught++;s.target=target;if(s.caught===3)s.view='claim';}}
      else if(action==='claim'){if(s.view!=='claim'||s.caught!==3)throw new Error('3回捕まえてから受け取ってください。');const result=await wallet.earnWork(s.userId,s.ticketId,check);s.reward=result.reward;s.view='done';}
      else throw new Error('操作を確認してください。');
    }
    s.turn++;await i.editReply(screen(prefix,s,note));
  }catch(e){let safe=false;if(authorized&&s){try{get(prefix,s.id,i);safe=true;}catch{}}const m=safe?screen(prefix,s,text(e.message)):{...payload('✦  チップ',text(e.message),{state:'error',components:[row(home())]}),attachments:[]};if(i.deferred||i.replied)await i.editReply(m);else await i.reply({...m,flags:MessageFlags.Ephemeral});}finally{if(locked)s.busy=false;}}
  return {transfers,work,openTransfer:i=>open(i,'chips'),openWork:i=>open(i,'work'),handle};
}
