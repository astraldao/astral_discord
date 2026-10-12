import {ActionRowBuilder,ButtonBuilder,ButtonStyle,MessageFlags,StringSelectMenuBuilder,AttachmentBuilder,PermissionFlagsBits as P} from 'discord.js';
import {AdminSessions} from './admin.js';
import {payload} from './ui.js';
import {randomUUID} from 'node:crypto';
import {GameWalletStore} from './game-wallets.js';
import {casinoKinds,bets} from './casino.js';
import {blackjackImage} from './blackjack-art.js';
import {newRound,play,handValue,cardName} from './blackjack.js';
const row=(...c)=>new ActionRowBuilder().addComponents(...c);
const button=(s,a,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`bj:${s.id}:${s.turn}:${a}`).setLabel(label).setStyle(style);
const startButton=()=>row(new ButtonBuilder().setCustomId('game:open').setLabel('ゲームを選ぶ').setStyle(ButtonStyle.Primary));
export function gameLobby(s,balance){
  const ongoing=s?.game.phase==='playing';
  const components=[row(new StringSelectMenuBuilder().setCustomId('game:select').setPlaceholder('ゲームを選ぶ').addOptions({label:'ブラックジャック',value:'blackjack',description:'ディーラーと21点を目指す · 共通チップ',emoji:'♠️'}, {label:'スロット',value:'slots',description:'3つの絵柄を揃える · 架空チップ',emoji:'🎰'}, {label:'ルーレット',value:'roulette',description:'赤か黒を予想する · 架空チップ',emoji:'🔴'}, {label:'ダイス',value:'dice',description:'2個の合計を予想する · 架空チップ',emoji:'🎲'}))];
  if(s)components.push(row(button(s,'resume',ongoing?'続きから遊ぶ':'前の結果を見る',ButtonStyle.Primary)));
  if(balance!==undefined)components.push(row(new ButtonBuilder().setCustomId('chips:open').setLabel('チップを渡す').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('work:open').setLabel('ニワトリを捕まえる').setStyle(balance<10?ButtonStyle.Primary:ButtonStyle.Secondary)));
  return payload('✦  PLAY ROOM',(balance===undefined?'':`**残高 ${balance.toLocaleString('ja-JP')} チップ**\n\n`)+(s?`**ブラックジャック · ${ongoing?'プレイ中':'ラウンド終了'}**\n${ongoing?'続きから遊ぶか、ゲームを選んでください。':'結果を確認するか、ゲームを選んでください。'}`:'遊ぶゲームを選んでください。'),{components});
}
const results={blackjack:'ブラックジャック！あなたの勝ち',win:'あなたの勝ち',lose:'ディーラーの勝ち',push:'引き分け',bust:'21を超えました · ディーラーの勝ち','dealer-bust':'ディーラーが21を超えました · あなたの勝ち',stopped:'ゲームを終了しました'};
const stats=s=>s.stats??{win:0,lose:0,draw:0};
function record(s){if(s.game.phase!=='done' || s.game.result==='stopped')return;s.stats??={win:0,lose:0,draw:0};s.stats[['blackjack','win','dealer-bust'].includes(s.game.result)?'win':s.game.result==='push'?'draw':'lose']++;}
export function blackjackRules(s){return payload('♠  ブラックジャックの遊び方','**目標**\n21を超えずにディーラーより高い点を目指します。\n\n**ヒット** · 1枚引く\n**スタンド** · 今の手で勝負する\n\nAは1か11、2〜10は数字どおり、J・Q・Kは10点。最初の2枚で21ならブラックジャックです。\n\n21になると自動で勝負へ進み、21を超えると負け。同点は引き分けです。ディーラーはAを11と数える場合も17以上で止まります。\n\nこの画面を開いてもゲームは進みません。\n\n掛けチップは開始時に引きます。通常勝利は2倍、最初のブラックジャックは2.5倍、引き分けは1倍を払い戻します。終了・期限切れ・再起動による中断は返金しません。\n\n最初は3,000チップで4ゲーム共通、残高は保存します。',{components:[row(button(s,'resume','ゲームに戻る',ButtonStyle.Primary))]});}
export function blackjackScreen(s,note=''){
  const g=s.game,active=g.phase==='playing',score=stats(s);

  const betRow=()=>row(new StringSelectMenuBuilder().setCustomId(`bj:${s.id}:${s.turn}:bet`).setPlaceholder('次の掛けチップを選ぶ').addOptions(bets.map(n=>({label:`${n}チップ`,value:String(n),default:n===(s.bet??10)}))));
  if(g.phase==='ready')return {...payload('♠  BLACKJACK',`**残高 ${(s.balance??0).toLocaleString('ja-JP')} チップ**\n${s.balance>=10?'掛けチップを選んで始めてください。':'無料のお手伝いでチップを獲得できます。'}`,{components:[...(s.balance>=10?[betRow()]:[]),row(s.balance>=10?button(s,'again','ゲームを始める',ButtonStyle.Primary).setDisabled(s.balance<s.bet):new ButtonBuilder().setCustomId('work:open').setLabel('ニワトリを捕まえる').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId('game:open').setLabel('ゲーム選択へ').setStyle(ButtonStyle.Secondary))],}),attachments:[]};
  const body=`${s.confirmStop?'**このラウンドを終了しますか？**\n掛けチップは返金されません。':active?'**あなたのターン**':`**${results[g.result]}**`}\nラウンド ${s.round??1} · ${score.win}勝 ${score.lose}敗 ${score.draw}分${s.balance===undefined?'':`\n残高 ${s.balance.toLocaleString('ja-JP')} · 掛け ${s.roundBet??10}${active?'':` → 払い戻し ${s.payout??0}`}`}`;
  const components=s.confirmStop?[row(button(s,'confirm-stop','終了する'),button(s,'resume','プレイを続ける',ButtonStyle.Primary))]:active?[row(button(s,'hit','1枚引く',ButtonStyle.Primary),button(s,'stand','この手で勝負')),row(button(s,'rules','遊び方'),button(s,'stop','終了する'))]:[row(button(s,'again','もう一度遊ぶ',ButtonStyle.Primary).setDisabled(s.balance!==undefined && s.balance<(s.bet??10)),button(s,'rules','遊び方'))];
  if(!active && s.balance!==undefined){components.unshift(betRow());if(s.balance<10)components.at(-1).addComponents(new ButtonBuilder().setCustomId('work:open').setLabel('ニワトリを捕まえる').setStyle(ButtonStyle.Secondary));}
  const message=payload('♠  BLACKJACK',(note?`${note}\n\n`:'')+body,{state:!active && ['blackjack','win','dealer-bust'].includes(g.result)?'success':'normal',components});message.embeds[0].setImage('attachment://blackjack.png');message.files=[new AttachmentBuilder(blackjackImage(g),{name:'blackjack.png',description:`ディーラー: ${active?cardName(g.dealer[0])+'・伏せたカード':g.dealer.map(cardName).join('・')}${active?'':` (${handValue(g.dealer).total}点)`}。あなた: ${g.player.map(cardName).join('・')} (${handValue(g.player).total}点)`})];message.attachments=[];message.components.at(-1).addComponents(new ButtonBuilder().setCustomId('game:open').setLabel('ゲーム選択へ').setStyle(ButtonStyle.Secondary));return message;
}
export function createBlackjackController({guild,now=()=>Date.now(),deal=newRound,openCasino,openWork,wallet=new GameWalletStore(null,{now}),access=async i=>{const member=await guild.members.fetch({user:i.user.id,force:true}),channel=await guild.channels.fetch(i.channelId,{force:true});if(!channel?.permissionsFor(member)?.has(P.ViewChannel))throw new Error('このチャンネルではゲームを操作できません。');}}){
  const sessions=new AdminSessions(now);
  const screen=(s,note)=>{s.balance=wallet.balance(s.userId);return blackjackScreen(s,note);};
  async function begin(s,i,check){const game=deal(),roundId=randomUUID(),expires=now()+600000;const settled=await wallet.beginBlackjack(s.userId,roundId,s.bet,game.phase==='done'?game.result:null,expires,check??(async()=>{await access(i);get(s.id,s.userId);}));Object.assign(s,{game,roundId,expires,roundBet:s.bet,payout:settled.payout,balance:settled.balance});record(s);}
  const get=(id,user)=>{try{return sessions.get(id,user);}catch{throw new Error('この画面は終了しています。下のボタンか /game から開き直せます。');}};
  async function acknowledge(i){if(i.deferred || i.replied)return;if(i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});}
  const current=i=>[...sessions.sessions.values()].find(x=>x.userId===i.user.id && x.channelId===i.channelId && x.expires>now());
  async function lobby(i){await acknowledge(i);await access(i);await i.editReply({...gameLobby(current(i),wallet.balance(i.user.id)),attachments:[]});}
  async function open(i){await acknowledge(i);await access(i);let s=current(i);if(s){if(s.busy)throw new Error('前の操作を処理中です。');await i.editReply(screen(s,'続きのゲームを開きました。'));return;}if(wallet.hasActiveBlackjack(i.user.id))throw new Error('進行中のブラックジャックを元のチャンネルで終了してください。');s=sessions.create(i.user.id);Object.assign(s,{channelId:i.channelId,game:{phase:'ready'},bet:10,turn:0,round:1,stats:{win:0,lose:0,draw:0},busy:true});try{if(wallet.balance(s.userId)>=s.bet)await begin(s,i);await i.editReply(screen(s));}finally{s.busy=false;}}
  return {sessions,wallet,open,lobby,async handle(i){let s,locked=false,authorized=false;
    try{
      if(i.customId==='game:open'){await lobby(i);return;}
      if(i.customId==='game:select'){if(i.values?.length!==1 || !['blackjack',...casinoKinds].includes(i.values[0]))throw new Error('ゲームを選び直してください。');if(i.values[0]==='blackjack')await open(i);else if(openCasino)await openCasino(i,i.values[0]);else throw new Error('このゲームは準備中です。');return;}
      if(i.customId==='bj:new'){await open(i);return;}
      const [,id,turn,action]=i.customId.split(':');s=get(id,i.user.id);if(s.channelId!==i.channelId)throw new Error('ゲームを始めたチャンネルから操作してください。');if(s.busy)throw new Error('前の操作を処理中です。');s.busy=true;locked=true;
      if(action==='rules' || !i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferReply({flags:MessageFlags.Ephemeral});else await i.deferUpdate();
      await access(i);get(s.id,s.userId);authorized=true;
      const commitCheck=async()=>{authorized=false;await access(i);get(s.id,s.userId);authorized=true;};
      if(action==='rules'){await i.editReply(blackjackRules(s));return;}
      if(action==='resume'){if(s.confirmStop){s.confirmStop=false;s.turn++;}await i.editReply(screen(s));return;}
      if(String(s.turn)!==turn)throw new Error('画面を最新の状態に戻しました。ボタンから続けてください。');
      if(action==='again'){if(!['done','ready'].includes(s.game.phase))throw new Error('今のラウンドを終えてから操作してください。');await begin(s,i,commitCheck);s.round=(s.round??1)+1;}
      else if(action==='bet'){if(s.game.phase==='playing' || i.values?.length!==1 || !bets.some(n=>String(n)===i.values[0]))throw new Error('勝負が終わってから10・50・100チップを選んでください。');s.bet=Number(i.values[0]);}
      else if(['refill','confirm-refill'].includes(action)){if(openWork){await openWork(i);return;}throw new Error('無料のお手伝いからチップを獲得してください。');}
      else if(action==='stop'){if(s.game.phase!=='playing')throw new Error('このラウンドは終了しています。');s.confirmStop=true;}
      else if(action==='confirm-stop'){if(!s.confirmStop)throw new Error('終了の確認画面から操作してください。');const game=structuredClone(s.game);play(game,'stop');const settled=await wallet.finishBlackjack(s.userId,s.roundId,game.result,commitCheck);s.game=game;s.payout=settled.payout;s.confirmStop=false;}
      else{if(s.confirmStop)throw new Error('終了するか、プレイを続けるか選んでください。');wallet.assertBlackjack(s.userId,s.roundId);const game=structuredClone(s.game);play(game,action);if(game.phase==='done'){const settled=await wallet.finishBlackjack(s.userId,s.roundId,game.result,commitCheck);s.payout=settled.payout;}s.game=game;record(s);}
      s.turn++;await i.editReply(screen(s));
    }catch(e){let valid=false;if(authorized){try{get(s.id,s.userId);valid=true;}catch{}}const message=valid?screen(s,e.message):payload('♠  BLACKJACK',e.message,{state:'error',components:[startButton()]});if(!valid)message.attachments=[];if(i.deferred || i.replied)await i.editReply(message);else await i.reply({...message,flags:MessageFlags.Ephemeral});}
    finally{if(locked)s.busy=false;}
  }};
}
