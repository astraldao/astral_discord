import {ActionRowBuilder,ButtonBuilder,ButtonStyle,MessageFlags,PermissionFlagsBits as P} from 'discord.js';
import {AdminSessions} from './admin.js';
import {payload} from './ui.js';
import {newRound,play,handValue,cardName} from './blackjack.js';
const row=(...c)=>new ActionRowBuilder().addComponents(...c);
const button=(s,a,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`bj:${s.id}:${s.turn}:${a}`).setLabel(label).setStyle(style);
const results={blackjack:'ブラックジャック！あなたの勝ち',win:'あなたの勝ち',lose:'ディーラーの勝ち',push:'引き分け',bust:'21を超えました · ディーラーの勝ち','dealer-bust':'ディーラーが21を超えました · あなたの勝ち',stopped:'ゲームを終了しました'};
export function blackjackScreen(s,note=''){
  const g=s.game,active=g.phase==='playing',p=handValue(g.player),d=handValue(g.dealer);
  const dealer=active?`${cardName(g.dealer[0])}　▧`:`${g.dealer.map(cardName).join('　')}\n**${d.total}**`;
  const body=`**ディーラー**\n${dealer}\n\n**あなた**\n${g.player.map(cardName).join('　')}\n**${p.total}**${p.soft?' · Aを11として計算':''}\n\n${active?'21を超えずに、ディーラーより高い点を目指します。\nヒット：1枚引く · スタンド：この手で勝負':`**${results[g.result]}**`}\n\nAは1か11、絵札は10。ディーラーは17以上で止まります。`;
  const components=active?[row(button(s,'hit','＋ ヒット',ButtonStyle.Primary),button(s,'stand','スタンド · 勝負',ButtonStyle.Primary)),row(button(s,'stop','ゲームを終了'))]:[row(button(s,'again','もう一度遊ぶ',ButtonStyle.Primary))];
  return payload('♠  BLACKJACK',(note?`${note}\n\n`:'')+body,{state:!active && ['blackjack','win','dealer-bust'].includes(g.result)?'success':'normal',components});
}
export function createBlackjackController({guild,now=()=>Date.now(),deal=newRound,access=async i=>{const member=await guild.members.fetch({user:i.user.id,force:true}),channel=await guild.channels.fetch(i.channelId,{force:true});if(!channel?.permissionsFor(member)?.has(P.ViewChannel))throw new Error('このチャンネルではゲームを操作できません。');}}){
  const sessions=new AdminSessions(now);
  const get=(id,user)=>{try{return sessions.get(id,user);}catch{throw new Error('このゲームは終了しています。/ゲーム ブラックジャック から始めてください。');}};
  return {sessions,async open(i){await i.deferReply({flags:MessageFlags.Ephemeral});await access(i);const s=sessions.create(i.user.id);s.channelId=i.channelId;s.game=deal();s.turn=0;await i.editReply(blackjackScreen(s));},async handle(i){let s,locked=false,authorized=false;
    try{
      const [,id,turn,action]=i.customId.split(':');s=get(id,i.user.id);if(s.channelId!==i.channelId)throw new Error('ゲームを始めたチャンネルから操作してください。');if(s.busy)throw new Error('前の操作を処理中です。');s.busy=true;locked=true;
      // Public or forged messages must always receive a private reply.
      if(i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});
      await access(i);get(s.id,s.userId);authorized=true;if(String(s.turn)!==turn)throw new Error('古いボタンです。最新のゲーム画面から操作してください。');
      if(action==='again'){if(s.game.phase!=='done')throw new Error('今のラウンドを終えてから操作してください。');s.game=deal();s.expires=now()+600000;}
      else play(s.game,action);
      s.turn++;await i.editReply(blackjackScreen(s));
    }catch(e){let valid=false;if(authorized){try{get(s.id,s.userId);valid=true;}catch{}}const message=valid?blackjackScreen(s,e.message):payload('♠  BLACKJACK',e.message,{state:'error'});if(i.deferred || i.replied)await i.editReply(message);else await i.reply({...message,flags:MessageFlags.Ephemeral});}
    finally{if(locked)s.busy=false;}
  }};
}
