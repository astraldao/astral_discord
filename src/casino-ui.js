import {ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,AttachmentBuilder,MessageFlags,PermissionFlagsBits as P} from 'discord.js';
import {AdminSessions} from './admin.js';
import {payload} from './ui.js';
import {casinoKinds,bets,casinoRound} from './casino.js';
import {casinoImage} from './casino-art.js';
export const casinoNames={slots:'スロット',roulette:'ルーレット',dice:'ダイス'};
const row=(...items)=>new ActionRowBuilder().addComponents(...items);
const button=(s,action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`casino:${s.id}:${s.turn}:${action}`).setLabel(label).setStyle(style);
const home=()=>new ButtonBuilder().setCustomId('game:open').setLabel('ゲーム選択へ').setStyle(ButtonStyle.Secondary);
const labels={spin:'スピン',red:'赤',black:'黒',low:'7未満',seven:'ちょうど7',high:'7超え'};
const symbols=['★','♥','♦','♣','♠','7'];
const format=n=>n.toLocaleString('ja-JP');
const signed=n=>`${n>0?'+':''}${format(n)}`;
const instructions={slots:'同じ絵柄が3つで20倍、2つで掛けチップが戻ります。',roulette:'赤か黒を選択。当たれば2倍。0はどちらも外れです。',dice:'2個の合計を予想。7未満・7超えは2倍、ちょうど7は5倍。'};
function resultText(r){if(!r)return '掛けチップを選んで遊んでください。';const outcome=r.kind==='slots'?r.outcome==='triple'?'3つ揃いました！':r.outcome==='pair'?'2つ揃いました':'今回は揃いませんでした':r.kind==='roulette'?`${r.values[0]} · ${r.outcome==='red'?'赤':r.outcome==='black'?'黒':'緑'}`:`合計 ${r.values[0]+r.values[1]}`;return `**${outcome}**\n${r.kind==='slots'?'':`予想 ${labels[r.choice]} · `}掛け ${format(r.bet)} → 払い戻し ${format(r.payout)} · **${signed(r.delta)}**`;}
export function casinoScreen(s,note=''){
  const r=s.results[s.kind];
  const components=s.confirmRefill?[row(button(s,'confirm-refill','1,000チップで再開',ButtonStyle.Primary),button(s,'resume','戻る'))]:[
    row(new StringSelectMenuBuilder().setCustomId(`casino:${s.id}:${s.turn}:bet`).setPlaceholder('掛けチップを選ぶ').addOptions(bets.map(n=>({label:`${n}チップ`,value:String(n),default:n===s.bet})))),
    row(...(s.kind==='slots'?['spin']:s.kind==='roulette'?['red','black']:['low','seven','high']).map((action,n)=>button(s,action,labels[action],n===0?ButtonStyle.Primary:ButtonStyle.Secondary).setDisabled(s.balance<s.bet))),
    row(button(s,'rules','遊び方'),...(s.balance<10?[button(s,'refill','チップを補充')]:[]),home())
  ];
  if(s.confirmRefill)components[0].addComponents(home());
  const description=s.confirmRefill?'**チップを補充しますか？**\n架空チップの残高を1,000に戻します。':`${note?`${note}\n\n`:''}**残高 ${format(s.balance)} チップ**${s.balance<10?'\n「チップを補充」から再開できます。':s.balance<s.bet?'\n残高以内の掛けチップに変更してください。':''}\n\n${resultText(r)}`;
  const m=payload(`✦  ${casinoNames[s.kind]}`,description,{state:r?.delta>0?'success':'normal',components});
  if(!s.confirmRefill){m.embeds[0].setImage('attachment://casino.png');m.files=[new AttachmentBuilder(casinoImage(s.kind,r),{name:'casino.png',description:r?r.kind==='slots'?`スロット: ${r.values.map(n=>symbols[n]).join('・')}`:r.kind==='dice'?`ダイス: ${r.values.join('と')}。合計 ${r.values[0]+r.values[1]}`:`ルーレット: ${r.values[0]}、${r.outcome==='red'?'赤':r.outcome==='black'?'黒':'緑'}`:'抽選前のゲーム画面'})];}
  m.attachments=[];return m;
}
export function casinoRules(s){return payload(`✦  ${casinoNames[s.kind]}の遊び方`,`${instructions[s.kind]}\n\n**払い戻しは掛けチップを含む合計**です。例えば10チップで2倍なら20が戻り、残高は10増えます。\n\n${s.kind==='slots'?'6種類の絵柄から3つを独立に抽選します。':s.kind==='roulette'?'0〜36の37個から同じ確率で抽選します。':'1〜6のサイコロ2個を独立に振ります。'}\n\n最初は1,000チップ。3ゲームで共通です。10未満になったら補充できます。現金・購入・換金のない架空チップで、Botの再起動やゲーム画面の期限切れでリセットされます。`,{components:[row(button(s,'resume','ゲームに戻る',ButtonStyle.Primary),home())]});}
export function createCasinoController({guild,now=()=>Date.now(),random,access=async i=>{const member=await guild.members.fetch({user:i.user.id,force:true}),channel=await guild.channels.fetch(i.channelId,{force:true});if(!channel?.permissionsFor(member)?.has(P.ViewChannel))throw new Error('このチャンネルではゲームを操作できません。');}}){
  const sessions=new AdminSessions(now);
  const get=(id,i)=>{let s;try{s=sessions.get(id,i.user.id);}catch{throw new Error('この画面は終了しています。ゲーム選択から開き直してください。');}if(s.channelId!==i.channelId)throw new Error('ゲームを始めたチャンネルから操作してください。');return s;};
  async function acknowledge(i,separate=false){if(i.deferred || i.replied)return;if(!separate && i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});}
  const error=async(i,e,s)=>{const m=s?casinoScreen(s,e.message):payload('✦  GAME',e.message,{state:'error',components:[row(home())]});m.attachments=[];if(i.deferred || i.replied)await i.editReply(m);else await i.reply({...m,flags:MessageFlags.Ephemeral});};
  async function open(i,kind){let s,locked=false,authorized=false;try{
    if(!casinoKinds.includes(kind))throw new Error('ゲームを選び直してください。');await acknowledge(i);await access(i);
    s=[...sessions.sessions.values()].find(x=>x.userId===i.user.id && x.channelId===i.channelId && x.expires>now());
    if(s?.busy)throw new Error('前の操作を処理中です。');
    if(!s){s=sessions.create(i.user.id);Object.assign(s,{channelId:i.channelId,balance:1000,bet:10,results:{},turn:0,rounds:0});}
    s.busy=true;locked=true;authorized=true;s.kind=kind;s.confirmRefill=false;s.turn++;s.expires=now()+600000;await i.editReply(casinoScreen(s));
  }catch(e){await error(i,e,authorized?s:undefined);}finally{if(locked)s.busy=false;}}
  async function handle(i){let s,locked=false,authorized=false;try{
    const [,id,turn,action]=i.customId.split(':');s=get(id,i);if(s.busy)throw new Error('前の操作を処理中です。');s.busy=true;locked=true;
    await acknowledge(i,action==='rules');await access(i);get(id,i);authorized=true;
    if(action==='rules'){await i.editReply(casinoRules(s));return;}
    if(action==='resume'){if(s.confirmRefill){s.confirmRefill=false;s.turn++;}await i.editReply(casinoScreen(s));return;}
    if(String(s.turn)!==turn)throw new Error('画面を最新の状態に戻しました。もう一度選んでください。');
    if(action==='refill'){if(s.balance>=10)throw new Error('チップは10未満になってから補充できます。');s.confirmRefill=true;}
    else if(action==='confirm-refill'){if(!s.confirmRefill || s.balance>=10)throw new Error('補充の確認画面から操作してください。');s.balance=1000;s.results={};s.confirmRefill=false;}
    else{
      if(s.confirmRefill)throw new Error('補充するか、戻るかを選んでください。');
      if(action==='bet'){if(i.values?.length!==1 || !bets.some(n=>String(n)===i.values[0]))throw new Error('10・50・100チップから選んでください。');s.bet=Number(i.values[0]);}
      else{const r=casinoRound({kind:s.kind,choice:action,bet:s.bet,balance:s.balance},random);s.results[s.kind]=r;s.balance=r.balance;s.rounds++;}
    }
    s.turn++;s.expires=now()+600000;await i.editReply(casinoScreen(s));
  }catch(e){let safe=false;if(authorized){try{get(s.id,i);safe=true;}catch{}}await error(i,e,safe?s:undefined);}finally{if(locked)s.busy=false;}}
  return {sessions,open,handle};
}
