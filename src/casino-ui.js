import {ActionRowBuilder,ButtonBuilder,ButtonStyle,MessageFlags,PermissionFlagsBits as P} from 'discord.js';
import {wagerRow,wagerChoice,chipDelta} from './game-ui.js';
import {GameSessions} from './game-sessions.js';
import {payload} from './ui.js';
import {casinoKinds,casinoChoices,winningPayout,drawRank,rankName,animals,casinoNames} from './casino.js';
import {GameWalletStore} from './game-wallets.js';
import {gameImage,editGameImage,casinoImageKey} from './game-images.js';
import {casinoImage} from './casino-art.js';
export {casinoNames} from './casino.js';
const row=(...items)=>new ActionRowBuilder().addComponents(...items);
const button=(s,action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`casino:${s.id}:${s.turn}:${action}`).setLabel(label).setStyle(style);
const home=()=>new ButtonBuilder().setCustomId('game:open').setLabel('ゲーム選択へ').setStyle(ButtonStyle.Secondary);
const labels={spin:'スピン',red:'赤',black:'黒',odd:'奇数',even:'偶数',lower:'1〜18',upper:'19〜36',low:'7未満',seven:'ちょうど7',high:'7超え',higher:'高い',same:'同じ',...Object.fromEntries(animals.map((n,i)=>[`animal${i}`,n]))};
const label=(kind,choice)=>kind==='highlow'&&choice==='lower'?'低い':labels[choice];
const symbols=['★','♥','♦','♣','♠','7'];
const format=n=>n.toLocaleString('ja-JP');
const signed=chipDelta;
const instructions={slots:'同じ絵柄が3つで20倍、2つで1倍。それ以外は0です。\n6種類の絵柄を1つずつ独立に抽選します。',roulette:'赤・黒・奇数・偶数・1〜18・19〜36のどれかを予想。当たれば2倍。0はすべての予想で外れです。\n0〜36の37個から同じ確率で抽選します。',dice:'サイコロ2個の合計を予想。7未満・7超えは2.3倍、ちょうど7は5.8倍。\n1〜6を独立に抽選します。',highlow:'次のカードが基準より高い・同じ・低いかを予想します。\n**A=1、J=11、Q=12、K=13**。1〜13を毎回同じ確率で抽選し、同じ数字も出ます。次の基準は今回出たカードです。\n払い戻しは当たりやすさに応じて変化し、各ボタンに合計枚数を表示。端数は切り捨てます。当たる可能性がない選択はできません。',race:'4匹の中から1着になる動物を選びます。当たれば3.9倍。\n全24通りの着順を同じ確率で抽選するため、どの動物も1着の確率は25%です。1人で遊ぶレースです。'};
function resultText(r){
  if(!r)return '';
  const outcome=r.kind==='slots'?r.outcome==='triple'?'3つ揃いました！':r.outcome==='pair'?'2つ揃いました':'今回は揃いませんでした':r.kind==='roulette'?`${r.values[0]} · ${r.outcome==='red'?'赤':r.outcome==='black'?'黒':'緑'}`:r.kind==='dice'?`合計 ${r.values[0]+r.values[1]}`:r.kind==='highlow'?`${rankName(r.values[0])} → ${rankName(r.values[1])} · ${label('highlow',r.outcome)}`:r.values.map((n,i)=>`${i+1}着 ${animals[n]}`).join(' · ');
  return `**${outcome}**\n${r.kind==='slots'?'':`予想 ${label(r.kind,r.choice)} · `}掛け ${format(r.bet)} → 払い戻し ${format(r.payout)} · **${signed(r.delta)}**`;
}
export function casinoScreen(s,note='',{retained}={}){
  const r=s.results[s.kind],choices=casinoChoices(s.kind);
  const components=[wagerRow('casino',s,s.balance)];
  for(let start=0;start<choices.length;start+=['roulette','race'].includes(s.kind)?2:5){
    const group=choices.slice(start,start+(['roulette','race'].includes(s.kind)?2:5));
    components.push(row(...group.map(action=>{const payout=winningPayout(s.kind,action,s.bet,s.card);return button(s,action,s.kind==='slots'?`${s.bet}枚でスピン`:`${label(s.kind,action)}｜${format(payout)}枚`,s.kind==='slots'?ButtonStyle.Primary:ButtonStyle.Secondary).setDisabled(s.balance<s.bet||!payout);}))); 
  }
  components.push(row(button(s,'rules','遊び方・配当'),...(s.balance<s.bet?[button(s,'refresh','残高を更新')]:[]),...(s.balance<10?[new ButtonBuilder().setCustomId('work:open').setLabel('ニワトリを捕まえる').setStyle(ButtonStyle.Secondary)]:[]),home()));
  const prompt=s.kind==='highlow'?`**基準カード ${rankName(s.card)}** · 次の大小を予想`:s.kind==='race'?'1着になる動物を選ぶ':s.kind==='slots'?'絵柄を揃える':'予想を選ぶ';
  const description=`${note?`${note}\n\n`:''}**残高 ${format(s.balance)} チップ**${s.balance<10?'\n無料のお手伝いでチップを獲得できます。':s.balance<s.bet?'\n残高以内の掛けチップに変更してください。':''}\n\n${prompt}\n${format(s.bet)}チップで開始${s.kind==='slots'?' · 3つ一致20倍 / 2つ一致1倍':' · ボタンの枚数は当選時の払い戻し'}${r?`\n\n${resultText(r)}`:''}`;
  const m=payload(`✦  ${casinoNames[s.kind]}`,description,{state:r?.delta>0?'success':'normal',components});
  const alt=r?r.kind==='slots'?`スロット: ${r.values.map(n=>symbols[n]).join('・')}`:r.kind==='dice'?`ダイス: ${r.values.join('と')}。合計 ${r.values[0]+r.values[1]}`:r.kind==='highlow'?`前のカード${rankName(r.values[0])}、次の基準${rankName(s.card)}`:r.kind==='race'?r.values.map((n,i)=>`${i+1}着${animals[n]}`).join('、'):`ルーレット: ${r.values[0]}、${r.outcome==='red'?'赤':r.outcome==='black'?'黒':'緑'}`:s.kind==='highlow'?`基準カード${rankName(s.card)}。次のカードは未抽選です。`:s.kind==='race'?'ウサギ、ネコ、ニワトリ、カメがスタート前に並んでいます。':'抽選前のゲーム画面';
  return gameImage(m,{name:'casino.png',description:alt,render:()=>casinoImage(s.kind,r,{card:s.card}),retained});
}
export function casinoRules(s){return payload(`✦  ${casinoNames[s.kind]}の遊び方`,`${instructions[s.kind]}\n\n**払い戻しは掛けチップを含む合計**です。例えば10チップで2倍なら20が戻り、残高は10増えます。\n\n初期残高は3,000チップ。全ゲームで共通し、再起動後も保持されます。画面を開くだけではチップを消費しません。`,{components:[row(button(s,'resume','ゲームに戻る',ButtonStyle.Primary),home())]});}
export function createCasinoController({guild,now=()=>Date.now(),random,openWork,wallet=new GameWalletStore(null,{now}),access=async i=>{const member=await guild.members.fetch({user:i.user.id,force:true}),channel=await guild.channels.fetch(i.channelId,{force:true});if(!channel?.permissionsFor(member)?.has(P.ViewChannel))throw new Error('このチャンネルではゲームを操作できません。');}}){
  const sessions=new GameSessions(now);
  const screen=(s,note,retained)=>{s.balance=wallet.balance(s.userId);return casinoScreen(s,note,{retained});};
  const send=(s,i,note,reuse)=>editGameImage(i,s,{key:casinoImageKey(s),name:'casino.png',reuse,build:retained=>screen(s,note,retained)});
  const get=(id,i)=>{let s;try{s=sessions.get(id,i.user.id);}catch{throw new Error('この画面は終了しています。ゲーム選択から開き直してください。');}if(s.channelId!==i.channelId)throw new Error('ゲームを始めたチャンネルから操作してください。');return s;};
  async function acknowledge(i,separate=false){if(i.deferred||i.replied)return false;if(!separate&&i.message?.flags?.has(MessageFlags.Ephemeral)){await i.deferUpdate();return true;}await i.deferReply({flags:MessageFlags.Ephemeral});return false;}
  const error=async(i,e,s,reuse)=>{if(s){await send(s,i,e.message,reuse);return;}const m=payload('✦  GAME',e.message,{state:'error',components:[row(home())]});m.attachments=[];if(i.deferred||i.replied)await i.editReply(m);else await i.reply({...m,flags:MessageFlags.Ephemeral});};
  async function open(i,kind){let s,locked=false,authorized=false,reuse=false;try{
    if(!casinoKinds.includes(kind))throw new Error('ゲームを選び直してください。');reuse=await acknowledge(i);await access(i);
    s=[...sessions.sessions.values()].find(x=>x.userId===i.user.id && x.channelId===i.channelId && x.expires>now());
    if([...sessions.sessions.values()].some(x=>x.userId===i.user.id&&x.busy))throw new Error('前の操作を処理中です。');
    const card=kind==='highlow'&&s?.card===undefined?drawRank(random):s?.card;
    if(!s){s=sessions.create(i.user.id);Object.assign(s,{channelId:i.channelId,balance:wallet.balance(i.user.id),bet:10,results:{},turn:0,rounds:0});}
    s.busy=true;locked=true;authorized=true;if(card!==undefined)s.card=card;s.kind=kind;s.turn++;s.expires=now()+600000;await send(s,i,undefined,reuse);
  }catch(e){await error(i,e,authorized?s:undefined,reuse);}finally{if(locked)s.busy=false;}}
  async function handle(i){let s,locked=false,authorized=false,reuse=false;try{
    const [,id,turn,action]=i.customId.split(':');s=get(id,i);if(s.busy)throw new Error('前の操作を処理中です。');s.busy=true;locked=true;
    reuse=await acknowledge(i,action==='rules');await access(i);get(id,i);authorized=true;
    const commitCheck=async()=>{authorized=false;await access(i);get(id,i);authorized=true;};
    if(action==='rules'){await i.editReply(casinoRules(s));return;}
    if(action==='resume'||action==='refresh'){await send(s,i,undefined,reuse);return;}
    s.balance=wallet.balance(s.userId);
    if(String(s.turn)!==turn)throw new Error('画面を最新の状態に戻しました。もう一度選んでください。');
    if(['refill','confirm-refill'].includes(action)){if(openWork){await openWork(i);return;}throw new Error('無料のお手伝いからチップを獲得してください。');}
    else{
      if(action==='bet'||action.startsWith('bet-')){s.bet=wagerChoice(action,i.values);}
      else{const r=await wallet.playCasino(s.userId,{kind:s.kind,choice:action,bet:s.bet,card:s.card},random,commitCheck);s.results[s.kind]=r;if(s.kind==='highlow')s.card=r.values[1];s.balance=r.balance;s.rounds++;}
    }
    s.turn++;s.expires=now()+600000;await send(s,i,undefined,reuse);
  }catch(e){let safe=false;if(authorized){try{get(s.id,i);safe=true;}catch{}}await error(i,e,safe?s:undefined,reuse);}finally{if(locked)s.busy=false;}}
  return {sessions,wallet,open,handle,current:i=>[...sessions.sessions.values()].find(x=>x.userId===i.user.id&&x.channelId===i.channelId&&x.expires>now())};
}
