import {ActionRowBuilder,ButtonBuilder,ButtonStyle,ChannelType,PermissionFlagsBits as P,MessageFlags} from 'discord.js';
import {randomUUID} from 'node:crypto';
import {backupText} from './backup-text.js';
import {createPersistentVoice} from './persistent-voice.js';
import {connectBackupAudio} from './backup-audio.js';
import {streamBackupSpeech} from './backup-playback.js';
import {payload} from './ui.js';
const guide=()=>new ButtonBuilder().setLabel('設定・困ったとき').setStyle(ButtonStyle.Link).setURL('https://github.com/astraldao/astral_discord/blob/main/docs/BACKUP_VOICE.md');
const button=(action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`read:${action}`).setLabel(label).setStyle(style);
const refresh=()=>button('status','状態を更新');
export function backupReaderScreen(s,enabled,{details=false}={}){
  if(!enabled)return payload('バックアップ読み上げ','**まだ有効になっていません**\n管理者に読み上げの有効化を依頼してください。設定手順は下のリンクから確認できます。',{state:'warning',components:[new ActionRowBuilder().addComponents(refresh(),guide())]});
  if(!s)return payload('バックアップ読み上げ','**停止中**\n1. 聞きたいVCに参加する\n2. 読み上げたいテキストチャンネルで「このチャンネルで開始」を押す\n\n開始後の投稿を、本文50文字＋「以下略」で順番に読みます。',{components:[new ActionRowBuilder().addComponents(button('start','このチャンネルで開始',ButtonStyle.Primary),refresh(),guide())]});
  const m=s.metrics;
  const phase=!s.ready?'接続と音声を準備しています':s.phase==='playing'?'読み上げ中':s.phase==='processing'?'次の音声を準備しています':'投稿を待っています';
  const parts=m.lastParts,detail=details&&parts?`\n内訳：順番待ち ${parts.queuedMs}ms · 権限確認 ${parts.accessMs}ms · 先頭合成 ${parts.firstAudioMs}ms · 再生準備 ${parts.playerMs}ms\n権限確認と合成は並行するため、内訳の単純な合計にはなりません。`:'';
  return payload('バックアップ読み上げ',`**${phase}**\n読む場所 <#${s.textId}>\n聞く場所 ${s.voiceId?`<#${s.voiceId}>`:'確認中'}\n\n${s.ready?'本文50文字を超えると「以下略」を付けます。投稿順に最後まで読み上げます。':'準備完了後の新しい投稿から読みます。準備中も停止できます。'}\n**待ち** ${s.queue.length}件 / 8件 · **再生開始** ${m.started}件\n**直近の開始待ち** ${m.lastMs===null?'未計測':`${m.lastMs}ms`} · 300ms超過 ${m.overBudget}件${detail}\n**読み飛ばし** ${m.dropped}件（待ち行列上限）\n\nVOICEVOX:ずんだもん\n開始待ちはBotの受信から再生開始までで、順番待ちを含みます。Discordで聞こえるまでの通信時間は別にかかります。`,{components:[new ActionRowBuilder().addComponents(refresh(),button(`stop:${s.id}`,'読み上げを停止',ButtonStyle.Danger)),new ActionRowBuilder().addComponents(button(`details:${s.id}`,'遅延の内訳').setDisabled(!parts),guide())]});
}
export function createBackupReader({guild,enabled=false,worker=createPersistentVoice,speaker=connectBackupAudio,voiceBusy=()=>false,volume=()=>30,activity=()=>()=>{},now=()=>performance.now(),resolveTargets,authorize,canControl}={}){
  let session=null,running=null;
  const targets=resolveTargets??(async i=>{
    const [member,text]=await Promise.all([guild.members.fetch({user:i.user.id,force:true}),guild.channels.fetch(i.channelId,{force:true})]);
    const voice=member.voice.channel;
    if(!voice||voice.type!==ChannelType.GuildVoice)throw new Error('先に通常のVCへ参加してください。');
    const bot=await guild.members.fetchMe({force:true});
    if(![ChannelType.GuildText,ChannelType.GuildAnnouncement,ChannelType.GuildVoice].includes(text?.type)||!text.permissionsFor(member)?.has(P.ViewChannel)||!text.permissionsFor(bot)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks]))throw new Error('テキストチャンネルの閲覧・送信・埋め込み権限を確認してください。');
    if(!voice.permissionsFor(member)?.has(P.ViewChannel)||!voice.permissionsFor(bot)?.has([P.ViewChannel,P.Connect,P.Speak])||bot.voice.serverMute)throw new Error('VCの閲覧・接続・発言権限とサーバーミュートを確認してください。');
    return {text,voice};
  });
  const access=authorize??(async s=>{
    const [member,text,voice,bot]=await Promise.all([guild.members.fetch({user:s.owner,force:true}),guild.channels.fetch(s.textId,{force:true}),guild.channels.fetch(s.voiceId,{force:true}),guild.members.fetchMe({force:true})]);
    if(member.voice.channelId!==s.voiceId||!text?.permissionsFor(bot)?.has(P.ViewChannel)||!voice?.permissionsFor(bot)?.has([P.ViewChannel,P.Connect,P.Speak])||bot.voice.serverMute)throw new Error('VC・権限が変わったため読み上げを停止しました。');
    // Do not bridge a private text channel to listeners who cannot read it.
    const listeners=[...voice.members.values()].filter(m=>!m.user.bot);
    const members=await Promise.all(listeners.map(m=>m.id===member.id?member:guild.members.fetch({user:m.id,force:true})));
    if(!members.length||members.some(m=>!text.permissionsFor(m)?.has(P.ViewChannel)))throw new Error('VCの参加者全員がこのテキストチャンネルを閲覧できる必要があります。');
  });
  const control=canControl??(async(i,s)=>{
    const member=await guild.members.fetch({user:i.user.id,force:true}),text=await guild.channels.fetch(s.textId,{force:true});
    if(!text?.permissionsFor(member)?.has(P.ViewChannel)||i.user.id!==s.owner&&!member.permissions.has(P.Administrator))throw new Error('開始した本人か管理者が操作してください。');
  });
  async function stop(reason='読み上げを停止しました。'){
    const s=session;if(!s)return;session=null;s.abort.abort();s.queue.length=0;s.voice?.close();s.synth?.close();
    if(s.notice)await s.notice.edit(payload('バックアップ読み上げ',`${reason}\nVOICEVOX:ずんだもん`)).catch(()=>{});
  }
  function alive(s){s.abort.signal.throwIfAborted();if(session!==s)throw new Error('読み上げは停止しています。');}
  function sameSession(s){if(session!==s)throw new Error('読み上げの状態が変わりました。「状態を更新」から開き直してください。');}
  async function drain(s){
    while(session===s&&s.queue.length){const job=s.queue.shift(),finish=activity();
      try{
        alive(s);s.phase='processing';const queuedMs=Math.round(now()-job.received);
        await streamBackupSpeech({text:job.text,signal:s.abort.signal,synth:s.synth,voice:s.voice,authorize:async()=>{await access(s);alive(s);},volume,now,onStart:parts=>{
          alive(s);s.phase='playing';const ms=Math.round(now()-job.received);s.metrics.started++;s.metrics.lastMs=ms;
          s.metrics.lastParts={queuedMs,...parts};if(ms>300)s.metrics.overBudget++;
        }});
      }catch{if(session===s)await stop('音声・権限・VCの状態を確認できないため停止しました。/read start から開始し直してください。');}
      finally{if(session===s)s.phase='waiting';finish();}
    }
  }
  const kick=s=>{if(running)return;running=drain(s).finally(()=>{running=null;if(session?.queue.length)kick(session);});};
  async function error(i,e){const m=payload('バックアップ読み上げ',e.message,{state:'error',components:[new ActionRowBuilder().addComponents(refresh(),guide())]});if(i.deferred||i.replied)await i.editReply(m);else await i.reply({...m,flags:MessageFlags.Ephemeral});}
  return {get active(){return session!==null;},get state(){return session;},idle:()=>running??Promise.resolve(),close:()=>stop(),
    async handle(i){try{
      const click=i.customId?.match(/^read:(start|stop|status|details)(?::([a-f0-9]{12}))?$/);
      if(!i.deferred&&!i.replied){
        if(click&&['status','details'].includes(click[1])&&i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();
        else await i.deferReply({flags:MessageFlags.Ephemeral});
      }
      if(i.customId&&(!click||['stop','details'].includes(click[1])&&(!click[2]||click[2]!==session?.id)))throw new Error('この画面は終了しています。「状態を更新」から開き直してください。');
      const action=click?click[1]:i.options.getSubcommand();
      if(action==='stop'){if(session){const current=session;await control(i,current);sameSession(current);await stop();}await i.editReply(backupReaderScreen(null,enabled));return;}
      if(action==='status'||action==='details'){const current=session;if(current){await control(i,current);sameSession(current);}await i.editReply(backupReaderScreen(current,enabled,{details:action==='details'}));return;}
      if(action!=='start')throw new Error('読み上げ操作を確認してください。');
      if(!enabled){await i.editReply(backupReaderScreen(null,false));return;}
      if(session){const current=session;await control(i,current);sameSession(current);if(current.textId!==i.channelId)throw new Error('別のテキストチャンネルで読み上げ中です。/read stop で停止してから開始してください。');await i.editReply(backupReaderScreen(current,true));return;}
      if(voiceBusy())throw new Error('VC入室の音声処理が進行中です。終了後に開始してください。');
      // Reserve before any asynchronous lookup so another start cannot race a voice join.
      const s={id:randomUUID().replaceAll('-','').slice(0,12),owner:i.user.id,textId:i.channelId,voiceId:null,phase:'preparing',ready:false,abort:new AbortController(),queue:[],metrics:{started:0,lastMs:null,lastParts:null,overBudget:0,dropped:0}};session=s;
      try{
        const {text,voice}=await targets(i);alive(s);s.voiceId=voice.id;
        await access(s);alive(s);await i.editReply(backupReaderScreen(s,true));
        s.synth=worker();
        const connecting=Promise.resolve(speaker(voice,s.abort.signal)).then(v=>{if(session!==s){v.close();throw new Error('開始を取り消しました。');}s.voice=v;return v;});
        await Promise.all([s.synth.ready,connecting]);await access(s);alive(s);
        s.notice=await text.send(payload('バックアップ読み上げ',`このチャンネルの新しいテキストを <#${s.voiceId}> へ読み上げます。本文50文字＋「以下略」、投稿順に再生。停止は /read stop。\nVOICEVOX:ずんだもん`));
        alive(s);s.ready=true;s.phase='waiting';await i.editReply(backupReaderScreen(s,true));
      }catch(e){if(session===s)await stop();else if(s.notice)await s.notice.edit(payload('バックアップ読み上げ','開始を取り消しました。\nVOICEVOX:ずんだもん')).catch(()=>{});throw e;}
    }catch(e){await error(i,e);}},
    onMessage(message){
      const s=session;if(!s?.ready||message.guildId!==guild.id||message.channelId!==s.textId||message.author?.bot||message.webhookId||message.system)return;
      const text=backupText(message.cleanContent??message.content);if(!text)return;
      if(s.queue.length>=8){s.metrics.dropped++;return;}
      s.queue.push({text,received:now()});kick(s);
    },async onVoiceChange(before,after){
      const s=session;if(!s||after.guild.id!==guild.id)return;
      if(after.id===s.owner&&after.channelId!==s.voiceId){await stop('開始した人がVCを移動・退出したため停止しました。');return;}
      if(after.id===guild.members?.me?.id&&(after.channelId!==s.voiceId||after.serverMute)){await stop('BotのVC接続または発言権限が変わったため停止しました。');return;}
      if(before.channelId===s.voiceId||after.channelId===s.voiceId){try{await access(s);}catch{if(session===s)await stop('VCの参加者または権限が変わったため停止しました。');}}
    },async revalidate(){const s=session;if(s?.ready)try{await access(s);}catch{if(session===s)await stop('閲覧・音声権限が変わったため停止しました。');}},
  };
}
