import {ActionRowBuilder,ButtonBuilder,ButtonStyle,ChannelType,PermissionFlagsBits as P,MessageFlags} from 'discord.js';
import {backupText} from './backup-text.js';
import {createPersistentVoice} from './persistent-voice.js';
import {connectBackupAudio} from './backup-audio.js';
import {gentlePcm} from './speech.js';
import {payload} from './ui.js';
export function backupReaderScreen(s,enabled){
  if(!enabled)return payload('バックアップ読み上げ','利用前にMessage Content Intentを有効にし、ASTRAL_BACKUP_TTS=1で再起動してください。セットアップ手順はREADMEにあります。',{state:'warning'});
  if(!s)return payload('バックアップ読み上げ','**停止中**\n参加中のVCで聞くには、読み上げたいテキストチャンネルで `/read start` を実行してください。');
  const m=s.metrics;
  return payload('バックアップ読み上げ',`**${s.ready?'読み上げ中':'音声を準備中'}**\nテキスト <#${s.textId}> → VC <#${s.voiceId}>\n\n本文50文字を超えると「以下略」を付けます。投稿順に最後まで読み上げます。\n**待ち** ${s.queue.length}件 · **再生開始** ${m.started}件\n**Bot内の開始待ち** ${m.lastMs===null?'未計測':`${m.lastMs}ms`} · 300ms超過 ${m.overBudget}件\n**読み飛ばし** ${m.dropped}件（待ち行列上限）\n\nVOICEVOX:ずんだもん\n開始待ちは順番待ちを含みます。Discord側で聞こえるまでの時間は別途通信の影響を受けます。`,{components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('read:stop').setLabel('読み上げを停止').setStyle(ButtonStyle.Danger))]});
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
    const [member,text,voice]=await Promise.all([guild.members.fetch({user:s.owner,force:true}),guild.channels.fetch(s.textId,{force:true}),guild.channels.fetch(s.voiceId,{force:true})]);
    if(member.voice.channelId!==s.voiceId||!text?.permissionsFor(guild.members.me)?.has(P.ViewChannel)||!voice?.permissionsFor(guild.members.me)?.has([P.ViewChannel,P.Connect,P.Speak])||guild.members.me.voice.serverMute)throw new Error('VC・権限が変わったため読み上げを停止しました。');
    // Do not bridge a private text channel to listeners who cannot read it.
    const listeners=[...voice.members.values()].filter(m=>!m.user.bot);
    const members=await Promise.all(listeners.map(m=>guild.members.fetch({user:m.id,force:true})));
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
  async function drain(s){
    while(session===s&&s.queue.length){const job=s.queue.shift(),finish=activity();
      try{
        await access(s);alive(s);if(!s.voice.healthy())throw new Error('音声接続が切れました。');
        let playback=Promise.resolve(),began=false;
        await s.synth.stream(job.text,s.abort.signal,wav=>{
          alive(s);const pcm=gentlePcm(wav,volume(),{fadeMs:3});
          playback=playback.then(async()=>{alive(s);if(!s.voice.healthy())throw new Error('音声接続が切れました。');await s.voice.play(pcm,{signal:s.abort.signal,onStart:()=>{if(began)return;began=true;const ms=Math.round(now()-job.received);s.metrics.started++;s.metrics.lastMs=ms;if(ms>300)s.metrics.overBudget++;}});});
          playback.catch(()=>{});
        });
        await playback;
      }catch{if(session===s)await stop('音声・権限・VCの状態を確認できないため停止しました。/read start から開始し直してください。');}
      finally{finish();}
    }
  }
  const kick=s=>{if(running)return;running=drain(s).finally(()=>{running=null;if(session?.queue.length)kick(session);});};
  async function error(i,e){const m=payload('バックアップ読み上げ',e.message,{state:'error'});if(i.deferred||i.replied)await i.editReply(m);else await i.reply({...m,flags:MessageFlags.Ephemeral});}
  return {get active(){return session!==null;},get state(){return session;},idle:()=>running??Promise.resolve(),close:()=>stop(),
    async handle(i){try{
      if(!i.deferred&&!i.replied)await i.deferReply({flags:MessageFlags.Ephemeral});
      const action=i.customId==='read:stop'?'stop':i.options.getSubcommand();
      if(action==='stop'){if(session){await control(i,session);await stop();}await i.editReply(payload('バックアップ読み上げ','読み上げを停止しました。'));return;}
      if(action==='status'){if(session)await control(i,session);await i.editReply(backupReaderScreen(session,enabled));return;}
      if(action!=='start')throw new Error('読み上げ操作を確認してください。');
      if(!enabled){await i.editReply(backupReaderScreen(null,false));return;}
      if(session){await control(i,session);if(session.textId!==i.channelId)throw new Error('別のテキストチャンネルで読み上げ中です。/read stop で停止してから開始してください。');await i.editReply(backupReaderScreen(session,true));return;}
      if(voiceBusy())throw new Error('VC入室の音声処理が進行中です。終了後に開始してください。');
      // Reserve before any asynchronous lookup so another start cannot race a voice join.
      const s={owner:i.user.id,textId:i.channelId,voiceId:null,ready:false,abort:new AbortController(),queue:[],metrics:{started:0,lastMs:null,overBudget:0,dropped:0}};session=s;
      try{
        const {text,voice}=await targets(i);alive(s);s.voiceId=voice.id;
        await access(s);alive(s);await i.editReply(payload('バックアップ読み上げ','ずんだもんとVC接続を準備しています。準備完了後の投稿から読み上げます。'));
        s.synth=worker();
        const connecting=Promise.resolve(speaker(voice,s.abort.signal)).then(v=>{if(session!==s){v.close();throw new Error('開始を取り消しました。');}s.voice=v;return v;});
        await Promise.all([s.synth.ready,connecting]);await access(s);alive(s);
        s.notice=await text.send(payload('バックアップ読み上げ',`このチャンネルの新しいテキストを <#${s.voiceId}> へ読み上げます。本文50文字＋「以下略」、投稿順に再生。停止は /read stop。\nVOICEVOX:ずんだもん`));
        alive(s);s.ready=true;await i.editReply(backupReaderScreen(s,true));
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
