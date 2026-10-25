import {randomInt} from 'node:crypto';
import {rollReply} from './roll-ui.js';
import {routeDiceMessage} from './roll-route.js';
export {diceRequest,saizeRequest} from './dice-request.js';
export {rollDice,rollSaize} from './roll-ui.js';
import {PermissionFlagsBits as P,GatewayIntentBits,ApplicationFlagsBitField} from 'discord.js';
// Full content is requested only when Discord reports it is already enabled.
// Otherwise ordinary mention messages remain usable without privileged intent.
export async function configureDiceContent(client,loadApplication){
  if(client.options.intents.has(GatewayIntentBits.MessageContent))return true;
  try{const app=await loadApplication(),flags=new ApplicationFlagsBitField(app.flags);if(flags.has(ApplicationFlagsBitField.Flags.GatewayMessageContent)||flags.has(ApplicationFlagsBitField.Flags.GatewayMessageContentLimited)){client.options.intents=client.options.intents.add(GatewayIntentBits.MessageContent).freeze();return true;}}catch{}
  return false;
}
export function createChatDice({guild,enabled=()=>true,now=()=>performance.now(),random=randomInt,judge=null}={}){
  const users=new Map(),seen=new Map();let pending=0,global={tokens:8,at:now()};
  return {async onMessage(message){
    try{
      if(!enabled()||message.guildId!==guild.id||message.author?.bot||message.webhookId||message.system||typeof message.id!=='string'||!message.author?.id||message.partial)return;
      const originalContent=message.content;const route=routeDiceMessage(originalContent);if(!route||route.kind==='judge'&&typeof judge!=='function')return;
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
        if(!allowed()||current.author?.id!==message.author.id||current.content!==originalContent||current.webhookId||current.author.bot||current.system||current.partial)return;
        const latest=routeDiceMessage(current.content);if(!latest)return;
        let target=current;
        if(latest.kind==='judge'){
          const beforeRequest=async()=>{
            [member,bot,channel]=await Promise.all([guild.members.fetch({user:message.author.id,force:true}),guild.members.fetchMe({force:true}),guild.channels.fetch(message.channelId,{force:true})]);
            if(!allowed())return false;
            target=await channel.messages.fetch({message:message.id,force:true,cache:false});
            [member,bot,channel]=await Promise.all([guild.members.fetch({user:message.author.id,force:true}),guild.members.fetchMe({force:true}),guild.channels.fetch(message.channelId,{force:true})]);
            return Boolean(allowed()&&target.author?.id===message.author.id&&target.content===originalContent&&!target.webhookId&&!target.author.bot&&!target.system&&!target.partial);
          };
          if(typeof judge!=='function'||await judge(latest.text,{beforeRequest})!==true||!await beforeRequest())return;
        }
        await target.reply({...rollReply(latest.request,random,{embed:channel.permissionsFor(bot)?.has(P.EmbedLinks)===true}),allowedMentions:{parse:[],repliedUser:false},failIfNotExists:true,nonce:message.id,enforceNonce:true});
      }finally{pending--;}
    }catch{/* No retries: Discord may have accepted a reply despite a failed request. */}
  }};
}
