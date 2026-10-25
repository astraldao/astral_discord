import {randomInt} from 'node:crypto';
import {rollReply} from './roll-ui.js';
import {requestSource,rollWords,declaredRoll} from './roll-intent.js';
export {rollDice,rollSaize} from './roll-ui.js';
import {PermissionFlagsBits as P,GatewayIntentBits,ApplicationFlagsBitField} from 'discord.js';
export function saizeRequest(content){
  const source=requestSource(content)?.replace(/<@!?\d{17,20}>/g,' ').trim();
  const match=source?.match(/^(?:(?:じゃあ|では|次は|今回は|ちょっと|もう一度)\s*)?(!?)サイゼロール(.*)$/u);
  if(!match||!rollWords(match[2],{saize:true}))return null;
  return match[1]==='!'?{kind:'saize',showMenu:true}:{kind:'saize'};
}
function chatRequest(content){return saizeRequest(content)??diceRequest(content);}
export function diceRequest(content){
  const source=requestSource(content);if(!source)return null;
  const matches=[...source.matchAll(/(?<![A-Za-z0-9_])([0-9]{1,7})[dD]([0-9]{1,7})(?:\s*([+-])\s*([0-9]{1,7}))?(?:(?![A-Za-z0-9_])|(?=(?:cm|km|kg|hp|mp|san|m|g)(?:[\s!。]|$)))/giu)];
  if(!matches.length)return null;
  let rest=source;for(const m of matches)rest=rest.replace(m[0],' ');
  if(!rollWords(rest)&&!declaredRoll(source,matches))return null;
  const rolls=matches.map(m=>({count:Number(m[1]),sides:Number(m[2]),modifier:m[3]?(m[3]==='-'?-1:1)*Number(m[4]):0}));
  if(rolls.length>5||rolls.some(r=>r.count<1||r.count>100||r.sides<2||r.sides>1000000||Math.abs(r.modifier)>1000000)||rolls.reduce((n,r)=>n+r.count,0)>200)return {error:'ダイスは1回1〜100個、面数2〜1000000、最大5式・合計200個、補正は±1000000までです。'};
  return {rolls};
}
// Full content is requested only when Discord reports it is already enabled.
// Otherwise ordinary mention messages remain usable without privileged intent.
export async function configureDiceContent(client,loadApplication){
  if(client.options.intents.has(GatewayIntentBits.MessageContent))return true;
  try{const app=await loadApplication(),flags=new ApplicationFlagsBitField(app.flags);if(flags.has(ApplicationFlagsBitField.Flags.GatewayMessageContent)||flags.has(ApplicationFlagsBitField.Flags.GatewayMessageContentLimited)){client.options.intents=client.options.intents.add(GatewayIntentBits.MessageContent).freeze();return true;}}catch{}
  return false;
}
export function createChatDice({guild,enabled=()=>true,now=()=>performance.now(),random=randomInt}={}){
  const users=new Map(),seen=new Map();let pending=0,global={tokens:8,at:now()};
  return {async onMessage(message){
    try{
      if(!enabled()||message.guildId!==guild.id||message.author?.bot||message.webhookId||message.system||typeof message.id!=='string'||!message.author?.id||message.partial)return;
      const originalContent=message.content;const request=chatRequest(originalContent);if(!request)return;
      const time=now();for(const [id,at] of seen)if(time-at>=60000)seen.delete(id);for(const [id,at] of users)if(time-at.seen>=60000)users.delete(id);
      const user=users.get(message.author.id)??{tokens:3,at:time,seen:time};
      const userTokens=Math.min(3,user.tokens+Math.max(0,time-user.at)/2000),globalTokens=Math.min(8,global.tokens+Math.max(0,time-global.at)/200);
      if(seen.has(message.id)||seen.size>=1000||users.size>=500&&!users.has(message.author.id)||userTokens<1||globalTokens<1||pending>=4)return;
      seen.set(message.id,time);users.set(message.author.id,{tokens:userTokens-1,at:time,seen:time});global={tokens:globalTokens-1,at:time};pending++;
      try{
        let [member,bot,channel]=await Promise.all([guild.members.fetch({user:message.author.id,force:true}),guild.members.fetchMe({force:true}),guild.channels.fetch(message.channelId,{force:true})]);
        const allowed=()=>enabled()&&member&&!member.user?.bot&&!member.pending&&channel?.guildId===guild.id&&channel.isTextBased?.()&&!channel.archived&&!channel.locked&&channel.permissionsFor(member)?.has(P.ViewChannel)&&channel.permissionsFor(bot)?.has([P.ViewChannel,P.ReadMessageHistory,channel.isThread?.()?P.SendMessagesInThreads:P.SendMessages]);
        if(!allowed())return;
        const current=await channel.messages.fetch({message:message.id,force:true,cache:false});
        [member,bot,channel]=await Promise.all([guild.members.fetch({user:message.author.id,force:true}),guild.members.fetchMe({force:true}),guild.channels.fetch(message.channelId,{force:true})]);
        if(!allowed()||current.author?.id!==message.author.id||current.content!==originalContent||current.webhookId||current.author.bot)return;
        const latest=chatRequest(current.content);if(!latest)return;
        await current.reply({...rollReply(latest,random,{embed:channel.permissionsFor(bot)?.has(P.EmbedLinks)===true}),allowedMentions:{parse:[],repliedUser:false},failIfNotExists:true,nonce:message.id,enforceNonce:true});
      }finally{pending--;}
    }catch{/* No retries: Discord may have accepted a reply despite a failed request. */}
  }};
}
