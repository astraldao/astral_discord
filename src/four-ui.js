import {ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,MessageFlags,PermissionFlagsBits as P} from 'discord.js';
import {GameSessions} from './game-sessions.js';
import {themed} from './ui.js';
import {newFour,playFour} from './four.js';
import {fourImage,fourAlt} from './four-art.js';
import {gameImage,editGameImage} from './game-images.js';
const {payload}=themed('game','🟡');
const row=(...c)=>new ActionRowBuilder().addComponents(...c);
const button=(s,a,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`four:${s.id}:${s.turn}:${a}`).setLabel(label).setStyle(style);
const home=()=>new ButtonBuilder().setCustomId('game:open').setLabel('ゲーム選択へ').setStyle(ButtonStyle.Secondary);
const results={win:'あなたの勝ち',lose:'Botの勝ち',draw:'引き分け'};
export function fourScreen(s,{retained}={}){
  const g=s.game;if(g.phase==='ready')return {...payload('✦  4目並べ','縦・横・斜めに **4つ** 並べたら勝ち。\n選んだ列の一番下の空きにコマを置きます。\n\n**先攻・後攻を選ぶ**\nいつでも無料 · チップ不要',{components:[row(button(s,'user','先攻で始める',ButtonStyle.Primary),button(s,'bot','後攻で始める')),row(home())]}),attachments:[]};
  const done=g.phase==='done',components=[];
  if(!done){
    const choices=Array.from({length:7},(_,c)=>c).filter(c=>g.board[c]===0).map(c=>({value:String(c),label:`${c+1}列目`,description:`空き ${Array.from({length:6},(_,r)=>g.board[r*7+c]).filter(v=>v===0).length}マス · 選ぶとコマを置きます`}));
    components.push(row(new StringSelectMenuBuilder().setCustomId(`four:${s.id}:${s.turn}:column`).setPlaceholder('コマを置く列を選ぶ（左から1〜7）').setMinValues(1).setMaxValues(1).addOptions(...choices)));
  }
  components.push(row(button(s,'again',done?'もう一度遊ぶ':'やり直す',done?ButtonStyle.Primary:ButtonStyle.Secondary),button(s,'rules','遊び方'),home()));
  const m=payload('✦  4目並べ',`**${done?results[g.result]:'あなたの番 · 列を選ぶ'}**\n🟡 あなた · 🟣 Bot\n\n${g.lastUser!==undefined?`あなた ${g.lastUser+1}列目${g.lastBot!==undefined?` → Bot ${g.lastBot+1}列目`:''}\n`:g.lastBot!==undefined?`Bot ${g.lastBot+1}列目\n`:''}左から1〜7列 · 下から積み上がります。${done?'':'\n満杯の列は選択欄から除いています。'}\n\nいつでも無料 · チップ不要`,{state:done&&g.result==='win'?'success':'normal',components});
  return gameImage(m,{name:'four.png',description:fourAlt(g),render:()=>fourImage(g),retained});
}
export function createFourController({guild,now=()=>Date.now(),random,access=async i=>{const member=await guild.members.fetch({user:i.user.id,force:true}),channel=await guild.channels.fetch(i.channelId,{force:true});if(!channel?.permissionsFor(member)?.has(P.ViewChannel))throw new Error('このチャンネルでは遊べません。');}}={}){
  const sessions=new GameSessions(now,s=>s.game?.phase==='playing');
  const get=(id,i)=>{const s=sessions.get(id,i.user.id);if(s.channelId!==i.channelId)throw new Error('元のチャンネルから操作してください。');return s;};
  async function ack(i,separate=false){if(i.deferred||i.replied)return false;if(!separate&&i.message?.flags?.has(MessageFlags.Ephemeral)){await i.deferUpdate();return true;}await i.deferReply({flags:MessageFlags.Ephemeral});return false;}
  const send=(i,s,reuse)=>editGameImage(i,s,{key:s.game.phase==='ready'?null:JSON.stringify([s.game.board,s.game.winning]),name:'four.png',reuse,build:retained=>fourScreen(s,{retained})});
  async function error(i,e){const m={...payload('✦  4目並べ',e.message,{state:'error',components:[row(home())]}),attachments:[]};if(i.deferred||i.replied)await i.editReply(m);else await i.reply({...m,flags:MessageFlags.Ephemeral});}
  async function open(i){let s,locked=false;try{const reuse=await ack(i);await access(i);if([...sessions.sessions.values()].some(x=>x.userId===i.user.id&&x.busy))throw new Error('前の操作を処理中です。');s=[...sessions.sessions.values()].find(x=>x.userId===i.user.id&&x.channelId===i.channelId&&x.expires>now());if(!s){s=sessions.create(i.user.id);Object.assign(s,{channelId:i.channelId,game:{phase:'ready'},turn:0});}s.busy=true;locked=true;await send(i,s,reuse);}catch(e){await error(i,e);}finally{if(locked)s.busy=false;}}
  async function handle(i){let s,locked=false;try{const [,id,turn,action]=i.customId.split(':');s=get(id,i);if(s.busy)throw new Error('前の操作を処理中です。');s.busy=true;locked=true;const reuse=await ack(i,action==='rules');await access(i);get(id,i);
    if(action==='rules'){await i.editReply({...payload('✦  4目並べの遊び方','あなたとBotが交互にコマを落とします。縦・横・斜めに4つ並べれば勝ち。満杯の列には置けません。盤が埋まると引き分けです。\n\n列は左から1〜7。Botは3手先まで読んで手を選びます。途中でゲーム選択へ戻っても、開き直すと続きから遊べます。チップの消費・報酬はありません。',{components:[row(button(s,'resume','ゲームに戻る',ButtonStyle.Primary),home())]}),attachments:[]});return;}
    if(action==='resume'){await send(i,s,reuse);return;}
    if(String(s.turn)!==turn)throw new Error('最新の画面から操作してください。');
    let game;if(action==='again')game={phase:'ready'};else if(['user','bot'].includes(action)){if(s.game.phase!=='ready')throw new Error('勝負を開き直してください。');game=newFour(action,random);}else if(action==='column'){if(i.values?.length!==1||typeof i.values[0]!=='string'||!/^[0-6]$/u.test(i.values[0]))throw new Error('選択欄から列を1つ選んでください。');game=playFour(s.game,Number(i.values[0]),random);}else if(/^col-[0-6]$/.test(action))game=playFour(s.game,Number(action.slice(4)),random);else throw new Error('列を選んでください。');
    await access(i);get(id,i);s.game=game;s.turn++;s.expires=now()+600000;await send(i,s,reuse);
  }catch(e){await error(i,e);}finally{if(locked)s.busy=false;}}
  return {sessions,open,handle};
}
