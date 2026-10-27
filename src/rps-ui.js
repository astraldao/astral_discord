import {GameError,gameErrorMessage} from './game-errors.js';
import {ActionRowBuilder,ButtonBuilder,ButtonStyle,MessageFlags,PermissionFlagsBits as P} from 'discord.js';
import {GameSessions} from './game-sessions.js';
import {themed} from './ui.js';
import {newRps,playRps,rpsChoices,rpsNames,rpsEmoji} from './rps.js';
const {payload}=themed('game','✊');
const row=(...c)=>new ActionRowBuilder().addComponents(...c);
const button=(s,a,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`rps:${s.id}:${s.turn}:${a}`).setLabel(label).setStyle(style);
const home=()=>new ButtonBuilder().setCustomId('game:open').setLabel('ゲーム選択へ').setStyle(ButtonStyle.Secondary);
const results={win:'あなたの勝ち',lose:'Botの勝ち',draw:'あいこ'};
export function rpsScreen(s,note=''){
  const g=s.game,done=g.phase==='done',last=g.rounds.at(-1);
  const body=`${note?`${note}\n\n`:''}**${done?g.result==='draw'?'引き分け':results[g.result]:`第${g.rounds.length+1}ラウンド · 手を選ぶ`}**\nあなた **${g.wins}** — **${g.losses}** Bot\n\n${last?`${rpsEmoji[last.choice]} **${rpsNames[last.choice]}**　対　${rpsEmoji[last.bot]} **${rpsNames[last.bot]}**\n${results[last.result]}\n\n`:''}最大3回、先に2勝で決着。あいこも1回に数えます。\nチップ不要 · いつでも無料`;
  const m=payload('✊  じゃんけん',body,{state:done&&g.result==='win'?'success':'normal',components:[row(...(done?[button(s,'again','もう一度遊ぶ',ButtonStyle.Primary)]:rpsChoices.map(c=>button(s,c,rpsNames[c],ButtonStyle.Primary).setEmoji(rpsEmoji[c])))),row(button(s,'rules','遊び方'),home())]});
  if(g.rounds.length)m.embeds[0].addFields({name:'今回の勝負',value:g.rounds.map((r,i)=>`${i+1}回目　${rpsEmoji[r.choice]} 対 ${rpsEmoji[r.bot]} · ${results[r.result]}`).join('\n')});
  return {...m,attachments:[]};
}
export function createRpsController({guild,now=()=>Date.now(),random,access=async i=>{const member=await guild.members.fetch({user:i.user.id,force:true}),channel=await guild.channels.fetch(i.channelId,{force:true});if(!channel?.permissionsFor(member)?.has(P.ViewChannel))throw new GameError('このチャンネルではゲームを操作できません。');}}={}){
  const sessions=new GameSessions(now,s=>s.game?.phase==='playing');
  const get=(id,i)=>{const s=sessions.get(id,i.user.id);if(s.channelId!==i.channelId)throw new GameError('ゲームを始めたチャンネルから操作してください。');return s;};
  async function ack(i,separate=false){if(i.deferred||i.replied)return;if(!separate&&i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});}
  async function error(i,e){const m={...payload('✊  じゃんけん',gameErrorMessage(e),{state:'error',components:[row(home())]}),attachments:[]};if(i.deferred||i.replied)await i.editReply(m);else await i.reply({...m,flags:MessageFlags.Ephemeral});}
  async function open(i){let s,locked=false;try{
    await ack(i);await access(i);
    if([...sessions.sessions.values()].some(x=>x.userId===i.user.id&&x.busy))throw new GameError('前の操作を処理中です。');
    s=[...sessions.sessions.values()].find(x=>x.userId===i.user.id&&x.channelId===i.channelId&&x.expires>now());
    if(!s){s=sessions.create(i.user.id);Object.assign(s,{channelId:i.channelId,game:newRps(),turn:0});}
    s.busy=true;locked=true;await i.editReply(rpsScreen(s));
  }catch(e){await error(i,e);}finally{if(locked)s.busy=false;}}
  async function handle(i){let s,locked=false;try{
    const [,id,turn,action]=i.customId.split(':');s=get(id,i);if(s.busy)throw new GameError('前の操作を処理中です。');s.busy=true;locked=true;
    await ack(i,action==='rules');await access(i);get(id,i);
    if(action==='rules'){await i.editReply({...payload('✊  じゃんけんの遊び方','Botと最大3回のじゃんけん。先に2勝した側の勝ちです。3回終えて同じ勝数なら引き分け。あいこも1回として数えます。\n\nグーはチョキ、チョキはパー、パーはグーに勝ちます。Botの手は毎回3種類から等確率で抽選。チップの消費・報酬はありません。',{components:[row(button(s,'resume','ゲームに戻る',ButtonStyle.Primary),home())]}),attachments:[]});return;}
    if(action==='resume'){await i.editReply(rpsScreen(s));return;}
    if(String(s.turn)!==turn){await i.editReply(rpsScreen(s,'最新の状態に戻しました。手を選んでください。'));return;}
    let next;if(action==='again'){if(s.game.phase!=='done')throw new GameError('今回の勝負が終わってから始めてください。');next=newRps();}else next=playRps(s.game,action,random);
    // Revalidate after computation, before publishing the new private state.
    await access(i);get(id,i);s.game=next;s.turn++;s.expires=now()+600000;await i.editReply(rpsScreen(s));
  }catch(e){await error(i,e);}finally{if(locked)s.busy=false;}}
  return {sessions,open,handle};
}
