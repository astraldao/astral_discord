import {ActionRowBuilder,ButtonBuilder,ButtonStyle,MessageFlags,StringSelectMenuBuilder,AttachmentBuilder,PermissionFlagsBits as P} from 'discord.js';
import {AdminSessions} from './admin.js';
import {payload} from './ui.js';
import {blackjackImage} from './blackjack-art.js';
import {newRound,play,handValue,cardName} from './blackjack.js';
const row=(...c)=>new ActionRowBuilder().addComponents(...c);
const button=(s,a,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`bj:${s.id}:${s.turn}:${a}`).setLabel(label).setStyle(style);
const startButton=()=>row(new ButtonBuilder().setCustomId('game:open').setLabel('ゲームを選ぶ').setStyle(ButtonStyle.Primary));
export function gameLobby(s){
  const ongoing=s?.game.phase==='playing';
  const components=[row(new StringSelectMenuBuilder().setCustomId('game:select').setPlaceholder('ゲームを選ぶ').addOptions({label:'ブラックジャック',value:'blackjack',description:'ディーラーと21点を目指すカードゲーム',emoji:'♠️'}))];
  if(s)components.push(row(button(s,'resume',ongoing?'続きから遊ぶ':'前の結果を見る',ButtonStyle.Primary)));
  return payload('✦  PLAY ROOM',s?`**ブラックジャック · ${ongoing?'プレイ中':'ラウンド終了'}**\n${ongoing?'続きから遊ぶか、ゲームを選んでください。':'結果を確認するか、ゲームを選んでください。'}`:'遊ぶゲームを選んでください。',{components});
}
const results={blackjack:'ブラックジャック！あなたの勝ち',win:'あなたの勝ち',lose:'ディーラーの勝ち',push:'引き分け',bust:'21を超えました · ディーラーの勝ち','dealer-bust':'ディーラーが21を超えました · あなたの勝ち',stopped:'ゲームを終了しました'};
const stats=s=>s.stats??{win:0,lose:0,draw:0};
function record(s){if(s.game.phase!=='done' || s.game.result==='stopped')return;s.stats??={win:0,lose:0,draw:0};s.stats[['blackjack','win','dealer-bust'].includes(s.game.result)?'win':s.game.result==='push'?'draw':'lose']++;}
export function blackjackRules(s){return payload('♠  ブラックジャックの遊び方','**目標**\n21を超えずにディーラーより高い点を目指します。\n\n**ヒット** · 1枚引く\n**スタンド** · 今の手で勝負する\n\nAは1か11、2〜10は数字どおり、J・Q・Kは10点。最初の2枚で21ならブラックジャックです。\n\n21になると自動で勝負へ進み、21を超えると負け。同点は引き分けです。ディーラーはAを11と数える場合も17以上で止まります。\n\nこの画面を開いてもゲームは進みません。',{components:[row(button(s,'resume','ゲームに戻る',ButtonStyle.Primary))]});}
export function blackjackScreen(s,note=''){
  const g=s.game,active=g.phase==='playing',score=stats(s);
  const body=`${s.confirmStop?'**このラウンドを終了しますか？**':active?'**あなたのターン**':`**${results[g.result]}**`}\nラウンド ${s.round??1} · ${score.win}勝 ${score.lose}敗 ${score.draw}分`;
  const components=s.confirmStop?[row(button(s,'confirm-stop','終了する'),button(s,'resume','プレイを続ける',ButtonStyle.Primary))]:active?[row(button(s,'hit','1枚引く',ButtonStyle.Primary),button(s,'stand','この手で勝負')),row(button(s,'rules','遊び方'),button(s,'stop','終了する'))]:[row(button(s,'again','もう一度遊ぶ',ButtonStyle.Primary),button(s,'rules','遊び方'))];
  const message=payload('♠  BLACKJACK',(note?`${note}\n\n`:'')+body,{state:!active && ['blackjack','win','dealer-bust'].includes(g.result)?'success':'normal',components});message.embeds[0].setImage('attachment://blackjack.png');message.files=[new AttachmentBuilder(blackjackImage(g),{name:'blackjack.png',description:`ディーラー: ${active?cardName(g.dealer[0])+'・伏せたカード':g.dealer.map(cardName).join('・')}${active?'':` (${handValue(g.dealer).total}点)`}。あなた: ${g.player.map(cardName).join('・')} (${handValue(g.player).total}点)`})];message.attachments=[];message.components.at(-1).addComponents(new ButtonBuilder().setCustomId('game:open').setLabel('ゲーム選択へ').setStyle(ButtonStyle.Secondary));return message;
}
export function createBlackjackController({guild,now=()=>Date.now(),deal=newRound,access=async i=>{const member=await guild.members.fetch({user:i.user.id,force:true}),channel=await guild.channels.fetch(i.channelId,{force:true});if(!channel?.permissionsFor(member)?.has(P.ViewChannel))throw new Error('このチャンネルではゲームを操作できません。');}}){
  const sessions=new AdminSessions(now);
  const get=(id,user)=>{try{return sessions.get(id,user);}catch{throw new Error('この画面は終了しています。下のボタンか /game から開き直せます。');}};
  async function acknowledge(i){if(i.deferred || i.replied)return;if(i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});}
  const current=i=>[...sessions.sessions.values()].find(x=>x.userId===i.user.id && x.channelId===i.channelId && x.expires>now());
  async function lobby(i){await acknowledge(i);await access(i);await i.editReply({...gameLobby(current(i)),attachments:[]});}
  async function open(i){await acknowledge(i);await access(i);let s=current(i);if(s){if(s.busy)throw new Error('前の操作を処理中です。');await i.editReply(blackjackScreen(s,'続きのゲームを開きました。'));return;}s=sessions.create(i.user.id);s.channelId=i.channelId;s.game=deal();s.turn=0;s.round=1;s.stats={win:0,lose:0,draw:0};record(s);await i.editReply(blackjackScreen(s));}
  return {sessions,open,lobby,async handle(i){let s,locked=false,authorized=false;
    try{
      if(i.customId==='game:open'){await lobby(i);return;}
      if(i.customId==='game:select'){if(i.values?.length!==1 || i.values[0]!=='blackjack')throw new Error('ゲームを選び直してください。');await open(i);return;}
      if(i.customId==='bj:new'){await open(i);return;}
      const [,id,turn,action]=i.customId.split(':');s=get(id,i.user.id);if(s.channelId!==i.channelId)throw new Error('ゲームを始めたチャンネルから操作してください。');if(s.busy)throw new Error('前の操作を処理中です。');s.busy=true;locked=true;
      if(action==='rules' || !i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferReply({flags:MessageFlags.Ephemeral});else await i.deferUpdate();
      await access(i);get(s.id,s.userId);authorized=true;
      if(action==='rules'){await i.editReply(blackjackRules(s));return;}
      if(action==='resume'){if(s.confirmStop){s.confirmStop=false;s.turn++;}await i.editReply(blackjackScreen(s));return;}
      if(String(s.turn)!==turn)throw new Error('画面を最新の状態に戻しました。ボタンから続けてください。');
      if(action==='again'){if(s.game.phase!=='done')throw new Error('今のラウンドを終えてから操作してください。');s.game=deal();s.round=(s.round??1)+1;s.expires=now()+600000;record(s);}
      else if(action==='stop'){if(s.game.phase!=='playing')throw new Error('このラウンドは終了しています。');s.confirmStop=true;}
      else if(action==='confirm-stop'){if(!s.confirmStop)throw new Error('終了の確認画面から操作してください。');play(s.game,'stop');s.confirmStop=false;}
      else{if(s.confirmStop)throw new Error('終了するか、プレイを続けるか選んでください。');play(s.game,action);record(s);}
      s.turn++;await i.editReply(blackjackScreen(s));
    }catch(e){let valid=false;if(authorized){try{get(s.id,s.userId);valid=true;}catch{}}const message=valid?blackjackScreen(s,e.message):payload('♠  BLACKJACK',e.message,{state:'error',components:[startButton()]});if(!valid)message.attachments=[];if(i.deferred || i.replied)await i.editReply(message);else await i.reply({...message,flags:MessageFlags.Ephemeral});}
    finally{if(locked)s.busy=false;}
  }};
}
