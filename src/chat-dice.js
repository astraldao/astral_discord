import {randomInt} from 'node:crypto';
import {PermissionFlagsBits as P,GatewayIntentBits,ApplicationFlagsBitField} from 'discord.js';
// Deliberately conservative intent rules, not language understanding. No text is
// retained or sent to an external service. Ambiguous prose is left alone.
function requestSource(content){
  if(typeof content!=='string'||content.length>1000)return null;
  let source=content.normalize('NFKC').replace(/```[\s\S]*?(?:```|$)|`[^`]*(?:`|$)|\|\|[\s\S]*?(?:\|\||$)/g,' ').split('\n').filter(line=>!/^\s*>/.test(line)).join(' ').replace(/https?:\/\/\S+/g,' ').trim();
  if(/[?？]/u.test(source)){if(/(?:振って|ロールして)(?:くれる|もらえる)[?？]$/u.test(source)&&[...source.matchAll(/[?？]/gu)].length===1)source=source.slice(0,-1);else return null;}
  if(/[「」『』"“”]/u.test(source))return null;
  if(!source||/[?？]/u.test(source)||/(?:ない|ません|なかった|なくて|なければ|振らな|振りませ|振るな|振らず|振らなく|ロールしな|回さな|しない|しなく|不要|禁止|やめ|例|説明|ルール|期待値|平均|確率|意味|とは|って何|場合|なら|仮に|と言|とい[うわ]|らしい|そうです|でした|振った|振りました|振っても|できる|可能|コード|not\b|don't\b|example\b|what\b|how\b)/iu.test(source))return null;
  return source;
}
export function saizeRequest(content){
  const source=requestSource(content)?.replace(/<@!?\d{17,20}>/g,' ').trim();
  if(!source||!/^(?:(?:じゃあ|では|次は|今回は|ちょっと|もう一度)\s*)?サイゼロール(?:\s*を?\s*(?:お願い(?:します)?|よろしく(?:お願いします)?|(?:して|振って|回して)(?:ください|くれる|もらえる)?|する|します))?[!！。、\s]*$/u.test(source))return null;
  return {kind:'saize'};
}
export function rollSaize(random=randomInt){
  const first=random(1,4),second=random(1,5),last=random(1,11),digit=last===10?0:last,code=`${first}${second}0${digit}`;
  return `🎲 **サイゼロール → ${code}**\n(1D3)(1D4)0(1D10) → (${first})(${second})0(${last})${last===10?' → 末尾の10を0に変換':''}\n※ 実在するメニュー番号とは限りません。`;
}
function chatRequest(content){return saizeRequest(content)??diceRequest(content);}
export function diceRequest(content){
  const source=requestSource(content);if(!source)return null;
  const matches=[...source.matchAll(/(?<![A-Za-z0-9_])([0-9]{1,7})[dD]([0-9]{1,7})(?:\s*([+-])\s*([0-9]{1,7}))?(?![A-Za-z0-9_])/gu)];
  if(!matches.length)return null;
  let rest=source;for(const m of matches)rest=rest.replace(m[0],' ');
  rest=rest.replace(/<@!?\d{17,20}>/g,' ').replace(/[\s,、。!！:：・/\[\]()「」『』]+/g,' ').trim();
  const bare=!rest;
  const request=/^(?:(?:ダイス|サイコロ|ロール|判定|ダメージ|回復|幸運|SAN|技能|目星|聞き耳|図書館|アイデア|知識|回避|応急手当|説得|信用|心理学|隠密|探索|命中|攻撃|チェック|sanチェック|SANチェック|正気度|成功判定|を|で|の|に|は|じゃあ|では|次は|今回は|ちょっと|もう一度|お願い|お願いします|振って|振ってください|振る|振ります|ロールして|くれる|もらえる|結果|教えて|出して|よろしく|ください|して|する|します|roll|please)\s*)+$/iu.test(rest);
  if(!bare&&!request)return null;
  const rolls=matches.map(m=>({count:Number(m[1]),sides:Number(m[2]),modifier:m[3]?(m[3]==='-'?-1:1)*Number(m[4]):0}));
  if(rolls.length>5||rolls.some(r=>r.count<1||r.count>100||r.sides<2||r.sides>1000000||Math.abs(r.modifier)>1000000)||rolls.reduce((n,r)=>n+r.count,0)>200)return {error:'ダイスは1回1〜100個、面数2〜1000000、最大5式・合計200個、補正は±1000000までです。'};
  return {rolls};
}
export function rollDice(request,random=randomInt){
  if(!request||request.error||!Array.isArray(request.rolls))throw new Error('invalid dice request');
  if(request.rolls.length<1||request.rolls.length>5||request.rolls.some(r=>!Number.isInteger(r.count)||r.count<1||r.count>100||!Number.isInteger(r.sides)||r.sides<2||r.sides>1000000||!Number.isInteger(r.modifier)||Math.abs(r.modifier)>1000000)||request.rolls.reduce((n,r)=>n+r.count,0)>200)throw new Error('invalid dice request');
  const lines=request.rolls.map(r=>{const values=Array.from({length:r.count},()=>random(1,r.sides+1)),sum=values.reduce((a,b)=>a+b,0)+r.modifier,label=`${r.count}D${r.sides}${r.modifier?`${r.modifier>0?'+':''}${r.modifier}`:''}`;return `**${label} → ${sum}**${r.count>1?`\n内訳：${values.slice(0,20).join(', ')}${values.length>20?` …（残り${values.length-20}個）`:''}`:''}`;});
  return `🎲 ${lines.join('\n\n')}`;
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
        await current.reply({content:latest.kind==='saize'?rollSaize(random):latest.error??rollDice(latest,random),allowedMentions:{parse:[],repliedUser:false},failIfNotExists:true,nonce:message.id,enforceNonce:true});
      }finally{pending--;}
    }catch{/* No retries: Discord may have accepted a reply despite a failed request. */}
  }};
}
