import {ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,MessageFlags,ChannelType,PermissionFlagsBits as P} from 'discord.js';
import {GameSessions} from './game-sessions.js';
import {payload,menuHomeButton} from './ui.js';
import {ScheduleError} from './schedule-errors.js';

const failure=message=>new ScheduleError(message);
const row=(...items)=>new ActionRowBuilder().addComponents(...items);
const button=(s,action,label)=>new ButtonBuilder().setCustomId(`calendars:${s.id}:${s.turn}:${action}`).setLabel(label).setStyle(ButtonStyle.Secondary);
export async function sharedScheduleAccess(guild,i){
  let member,channel,bot;
  try{[member,channel,bot]=await Promise.all([guild.members.fetch({user:i.user.id,force:true}),guild.channels.fetch(i.channelId,{force:true}),guild.members.fetchMe({force:true})]);}
  catch{throw failure('このチャンネルの権限を確認できませんでした。少し待ってからメニューを開き直してください。');}
  if(channel?.type!==ChannelType.GuildText||(channel.guildId??channel.guild?.id)!==guild.id)throw failure('予定表が共有されているテキストチャンネルで開いてください。');
  if(!channel.permissionsFor(member)?.has([P.ViewChannel,P.ReadMessageHistory]))throw failure('このチャンネルの閲覧・メッセージ履歴の権限を確認してください。');
  if(!channel.permissionsFor(bot)?.has([P.ViewChannel,P.ReadMessageHistory]))throw failure('Botにこのチャンネルの閲覧・メッセージ履歴の権限が必要です。');
  return {channel,bot};
}
export async function sharedScheduleMessage(channel,bot,publication){
  let message;try{message=await channel.messages.fetch({message:publication.messageId,force:true,cache:false});}
  catch{throw failure('元の共有投稿を確認できませんでした。管理者に投稿の復旧を依頼してください。');}
  if(message.author?.id!==bot.id||!message.components?.some(r=>r.components.some(b=>b.customId===`schedule:panel:${publication.id}`)))throw failure('元の予定表の投稿を確認できませんでした。管理者に投稿の復旧を依頼してください。');
  return message;
}

// List only verified publications in the invoking channel, never server-wide data.
export function createSharedScheduleController({guild,store,openCalendar,now=()=>Date.now(),access=i=>sharedScheduleAccess(guild,i)}={}){
  const sessions=new GameSessions(now),scans=new Map();
  const get=(id,i)=>{const s=sessions.get(id,i.user.id);if(s.channelId!==i.channelId)throw failure('元のチャンネルから操作してください。');return s;};
  const current=s=>s.publications.flatMap(id=>{
    try{const p=store.publication(id);if(p.status!=='ready'||p.channelId!==s.channelId)return [];const c=store.metadata().find(c=>c.id===p.calendarId);return c?[{...p,title:c.title,count:c.count}]:[];}catch{return [];}
  });
  function screen(s,note=''){
    const all=current(s),count=Math.max(1,Math.ceil(all.length/10));s.page=Math.max(0,Math.min(count-1,s.page));const items=all.slice(s.page*10,(s.page+1)*10);
    return {...payload('📅  このチャンネルの予定表',`${note?`${note}\n\n`:''}${all.length?`共有予定表 **${all.length}件**。選ぶとカレンダーを開けます。`:'確認できる共有予定表がありません。管理者にこのチャンネルへの共有・投稿の復旧を依頼してください。'}\n\nこのチャンネルで確認できる投稿だけを表示します。編集は管理者の /admin から行います。${count>1?`\n${s.page+1}/${count}ページ`:''}`,{components:[
      ...(items.length?[row(new StringSelectMenuBuilder().setCustomId(`calendars:${s.id}:${s.turn}:select`).setPlaceholder('共有予定表を選ぶ').addOptions(...items.map(p=>({label:p.title,value:p.id,description:`予定 ${p.count}件 · ${p.month}の共有投稿`}))))]:[]),
      ...(count>1?[row(button(s,'prev','前へ').setDisabled(s.page===0),button(s,'next','次へ').setDisabled(s.page===count-1))]:[]),
      row(button(s,'refresh','共有投稿を確認'),menuHomeButton()),
    ]}),attachments:[]};
  }
  async function ack(i){if(i.deferred||i.replied)return;if(i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});}
  async function error(i,error){
    const m={...payload('📅  共有予定表',error instanceof ScheduleError?error.message:'予定表を開けませんでした。閲覧権限を確認してメニューから開き直してください。',{state:'warning',components:[row(menuHomeButton())]}),attachments:[]};
    if(i.deferred||i.replied)await i.editReply(m);else await i.reply({...m,flags:MessageFlags.Ephemeral});
  }
  function scan(channel,bot){
    if(scans.has(channel.id))return scans.get(channel.id);
    if(scans.size>=4)throw failure('共有投稿を確認中です。少し待ってから開き直してください。');
    const job=Promise.resolve().then(async()=>{
      const calendars=store.metadata().map(c=>c.publications.filter(p=>p.channelId===channel.id&&p.status==='ready')).filter(items=>items.length),found=[];
      for(let at=0;at<calendars.length;at+=3){
        const batch=await Promise.all(calendars.slice(at,at+3).map(async publications=>{
          for(const p of publications){try{await sharedScheduleMessage(channel,bot,p);return p.id;}catch{}}
          return null;
        }));found.push(...batch.filter(Boolean));
      }
      return found;
    });
    scans.set(channel.id,job);void job.finally(()=>{if(scans.get(channel.id)===job)scans.delete(channel.id);}).catch(()=>{});return job;
  }
  return {sessions,async open(i){try{
    await ack(i);const {channel,bot}=await access(i);
    const s=sessions.create(i.user.id);Object.assign(s,{channelId:i.channelId,turn:0,page:0,publications:[],busy:true});
    try{s.publications=await scan(channel,bot);await access(i);get(s.id,i);await i.editReply(screen(s));}finally{s.busy=false;}
  }catch(e){await error(i,e);}},async handle(i){let s,locked=false;try{
    await ack(i);const [,id,turn,action]=i.customId.split(':');s=get(id,i);if(s.busy)throw failure('共有投稿を確認中です。少し待ってから操作してください。');s.busy=true;locked=true;
    const {channel,bot}=await access(i);get(id,i);if(String(s.turn)!==turn)throw failure('古い画面です。メニューの「予定表」から開き直してください。');
    if(action==='select'){
      const selected=i.values?.[0];if(i.values?.length!==1||!current(s).some(p=>p.id===selected))throw failure('共有予定表を選び直してください。');
      s.turn++;await openCalendar(i,selected);return;
    }
    if(action==='refresh')s.publications=await scan(channel,bot);
    else if(action==='prev'||action==='next')s.page+=action==='prev'?-1:1;
    else throw failure('予定表の一覧から操作してください。');
    await access(i);get(id,i);s.turn++;await i.editReply(screen(s));
  }catch(e){await error(i,e);}finally{if(locked)s.busy=false;}}};
}
