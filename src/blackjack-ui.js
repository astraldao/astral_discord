import {ActionRowBuilder,ButtonBuilder,ButtonStyle,MessageFlags,PermissionFlagsBits as P} from 'discord.js';
import {AdminSessions} from './admin.js';
import {payload} from './ui.js';
import {newRound,play,handValue,cardName} from './blackjack.js';
const row=(...c)=>new ActionRowBuilder().addComponents(...c);
const button=(s,a,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`bj:${s.id}:${s.turn}:${a}`).setLabel(label).setStyle(style);
const startButton=()=>row(new ButtonBuilder().setCustomId('bj:new').setLabel('ブラックジャックを開く').setStyle(ButtonStyle.Primary));
const results={blackjack:'ブラックジャック！あなたの勝ち',win:'あなたの勝ち',lose:'ディーラーの勝ち',push:'引き分け',bust:'21を超えました · ディーラーの勝ち','dealer-bust':'ディーラーが21を超えました · あなたの勝ち',stopped:'ゲームを終了しました'};
const stats=s=>s.stats??{win:0,lose:0,draw:0};
function record(s){if(s.game.phase!=='done' || s.game.result==='stopped')return;s.stats??={win:0,lose:0,draw:0};s.stats[['blackjack','win','dealer-bust'].includes(s.game.result)?'win':s.game.result==='push'?'draw':'lose']++;}
export function blackjackRules(s){return payload('♠  ブラックジャックの遊び方','**目標**\n21を超えずにディーラーより高い点を目指します。\n\n**ヒット** · 1枚引く\n**スタンド** · 今の手で勝負する\n\nAは1か11、2〜10は数字どおり、J・Q・Kは10点。最初の2枚で21ならブラックジャックです。\n\n21になると自動で勝負へ進み、21を超えると負け。同点は引き分けです。ディーラーはAを11と数える場合も17以上で止まります。\n\nこの画面を開いてもゲームは進みません。',{components:[row(button(s,'resume','ゲームに戻る',ButtonStyle.Primary))]});}
export function blackjackScreen(s,note=''){
  const g=s.game,active=g.phase==='playing',p=handValue(g.player),d=handValue(g.dealer),score=stats(s);
  const dealer=active?`${cardName(g.dealer[0])}　▧\n2枚目は勝負まで伏せています`:`${g.dealer.map(cardName).join('　')}\n**${d.total}点**`;
  const body=`**ROUND ${s.round??1}** · ${score.win}勝 ${score.lose}敗 ${score.draw}分\n\n**ディーラー**\n${dealer}\n\n**あなた**\n${g.player.map(cardName).join('　')}\n**${p.total}点**${p.soft?' · Aは11点として計算':''}\n\n${s.confirmStop?'**このラウンドを終了しますか？**\n対戦記録には数えません。':active?'1枚引くか、今の手で勝負するか選んでください。':`**${results[g.result]}**`}`;
  const components=s.confirmStop?[row(button(s,'confirm-stop','終了する'),button(s,'resume','プレイを続ける',ButtonStyle.Primary))]:active?[row(button(s,'hit','ヒット · 1枚引く',ButtonStyle.Primary),button(s,'stand','スタンド · この手で勝負',ButtonStyle.Primary)),row(button(s,'rules','遊び方'),button(s,'stop','終了する'))]:[row(button(s,'again','もう一度遊ぶ',ButtonStyle.Primary),button(s,'rules','遊び方'))];
  return payload('♠  BLACKJACK',(note?`${note}\n\n`:'')+body,{state:!active && ['blackjack','win','dealer-bust'].includes(g.result)?'success':'normal',components});
}
export function createBlackjackController({guild,now=()=>Date.now(),deal=newRound,access=async i=>{const member=await guild.members.fetch({user:i.user.id,force:true}),channel=await guild.channels.fetch(i.channelId,{force:true});if(!channel?.permissionsFor(member)?.has(P.ViewChannel))throw new Error('このチャンネルではゲームを操作できません。');}}){
  const sessions=new AdminSessions(now);
  const get=(id,user)=>{try{return sessions.get(id,user);}catch{throw new Error('この画面は終了しています。下のボタンか /game blackjack から開き直せます。');}};
  async function open(i){await i.deferReply({flags:MessageFlags.Ephemeral});await access(i);let s=[...sessions.sessions.values()].find(x=>x.userId===i.user.id && x.channelId===i.channelId && x.expires>now());if(s){if(s.busy)throw new Error('前の操作を処理中です。');await i.editReply(blackjackScreen(s,'続きのゲームを開きました。'));return;}s=sessions.create(i.user.id);s.channelId=i.channelId;s.game=deal();s.turn=0;s.round=1;s.stats={win:0,lose:0,draw:0};record(s);await i.editReply(blackjackScreen(s));}
  return {sessions,open,async handle(i){let s,locked=false,authorized=false;
    try{
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
    }catch(e){let valid=false;if(authorized){try{get(s.id,s.userId);valid=true;}catch{}}const message=valid?blackjackScreen(s,e.message):payload('♠  BLACKJACK',e.message,{state:'error',components:[startButton()]});if(i.deferred || i.replied)await i.editReply(message);else await i.reply({...message,flags:MessageFlags.Ephemeral});}
    finally{if(locked)s.busy=false;}
  }};
}
