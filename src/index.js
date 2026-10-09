import {Client, GatewayIntentBits, ChannelType, PermissionFlagsBits as P, ActionRowBuilder,
  StringSelectMenuBuilder, MessageFlags} from 'discord.js';
import {setTimeout as delay} from 'node:timers/promises';
import {SerialQueue, canEnter} from './queue.js';
import {connectSpeech} from './audio.js';
import {synthesize,gentlePcm} from './speech.js';

import {SettingsStore} from './settings.js';
import {commands} from './commands.js';
import {mentions,text,payload,panel,openButton,cancelButton,countdownCard} from './ui.js';
const env=process.env;
if(!/^\d{17,20}$/.test(env.GUILD_ID || '')) throw new Error('GUILD_IDにDiscordサーバーのIDを設定してください。');
if(!env.DISCORD_TOKEN || env.DISCORD_TOKEN.startsWith('put_')) throw new Error('DISCORD_TOKENを設定してください。');
const settings=new SettingsStore('data/settings.json',{version:1,lobbyId:null,targetIds:[],seconds:5,voice:true,enforce:true,panel:null});
await settings.load();
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates]});
const queue=new SerialQueue(), pending=new Map(),grants=new Map();
let guild,ready=false,stopping=false,revision=0;
const quiet=async operation=>{try{await operation();}catch{}};
const status=(job,title,description,components=[],state='normal')=>quiet(()=>job.interaction.editReply(payload(title,description,{components,state})));
const configured=()=>{const c=settings.get();if(!c.lobbyId || !c.targetIds.length)throw new EntryError('管理者が /vc設定 でロビーと行き先を設定してください。');return c;};
class EntryError extends Error {}

async function validate(job) {
  job.abort.signal.throwIfAborted();
  if(job.revision !== revision) throw new EntryError('設定が変更されたため中止しました。');
  const c=configured();
  const member = await guild.members.fetch({user: job.userId, force: true});
  const channel = await guild.channels.fetch(job.channelId);
  job.abort.signal.throwIfAborted();
  if(job.revision !== revision) throw new EntryError('設定が変更されたため中止しました。');
  if (member.voice.channelId !== c.lobbyId) throw new EntryError('ロビー退出により中止しました。');
  if (!canEnter(channel, member, guild.members.me, c.lobbyId, c.targetIds)) throw new EntryError('行き先の登録・閲覧権限・Bot権限・空き状況を確認してください。');
  if (c.voice && !channel.permissionsFor(guild.members.me).has(P.Speak)) throw new EntryError('Botの発言権限がありません。');
  return {member, channel};
}
async function run(job) {
  let audio, notice;
  try {
    const c=job.config;
    let {member, channel} = await validate(job);
    await status(job,'✧  入室準備',`**${text(channel.name)}** に参加を予告します。`,[cancelButton(job)]);
    if (c.voice) {
      await status(job,'✧  音声を準備',`ずんだもんが **${text(member.displayName)}** さんの参加をお知らせします。`,[cancelButton(job)]);
      const wav=await synthesize(member.displayName,job.abort.signal,c.words??[]);
      await validate(job);
      audio=await connectSpeech(channel,gentlePcm(wav,c.volume??30),job.abort.signal);
      await audio.start();
    }
    ({member, channel} = await validate(job));
    const announcement=payload('✦  参加予告',`**${text(member.displayName)}** さんが **${c.seconds}秒後** に参加します。`);
    announcement.embeds[0].setThumbnail(member.displayAvatarURL());
    if(c.voice)announcement.embeds[0].setFooter({text:'VOICEVOX:ずんだもん'});
    notice = await channel.send(announcement);
    const deadline = performance.now() + c.seconds*1000;
    for (let remaining = c.seconds; remaining > 0; remaining--) {
      await validate(job);
      if (audio && !audio.healthy()) throw new EntryError('音声接続が切れたため中止しました。');
      await quiet(()=>job.interaction.editReply({...countdownCard(channel.name,remaining,c.seconds),components:[cancelButton(job)]}));
      await delay(Math.max(0, deadline - (remaining - 1) * 1000 - performance.now()), undefined, {signal: job.abort.signal});
    }
    ({member, channel} = await validate(job));
    if (audio && !audio.healthy()) throw new EntryError('音声接続が切れたため中止しました。');
    job.abort.signal.throwIfAborted();
    job.moving = true;
    const grant = {channelId: channel.id}; grants.set(member.id, grant);
    try {await member.voice.setChannel(channel, '入室予告が完了');}
    catch (error) {if (grants.get(member.id) === grant) grants.delete(member.id); throw error;}
    setTimeout(() => {if (grants.get(member.id) === grant) grants.delete(member.id);}, 10000).unref();
    await quiet(() => notice.edit(payload('✦  入室しました',`**${text(member.displayName)}** さん、ようこそ。`,{state:'success'})));
    await status(job,'✦  入室しました',`**${text(channel.name)}** で、よいひとときを。`,[],'success');
  } catch (error) {
    if (notice) await quiet(() => notice.edit(payload('✧  入室取り消し','この参加予告は取り消されました。',{state:'error'})));
    await status(job,'✧  入室を中止',job.abort.signal.aborted ? '入室をキャンセルしました。' : error instanceof EntryError ? error.message : '処理に失敗しました。ローカルVOICEVOXのセットアップ・Bot権限・音声接続を確認してください。');
    console.error('入室処理:', error.code ?? error.name);
  } finally {
    audio?.close();
    if (pending.get(job.userId) === job) pending.delete(job.userId);
  }
}
async function choose(interaction) {
  const c=configured();
  const member = await guild.members.fetch(interaction.user.id);
  if (member.voice.channelId !== c.lobbyId) throw new EntryError('先にロビーVCに参加してください。');
  await guild.channels.fetch();
  const choices = [...guild.channels.cache.values()].filter(channel => canEnter(channel, member, guild.members.me, c.lobbyId, c.targetIds)
    && (!c.voice || channel.permissionsFor(guild.members.me).has(P.Speak))).sort((a,b) => a.rawPosition - b.rawPosition);
  if (!choices.length) throw new EntryError('現在入室できるVCがありません。');
  if (choices.length > 125) throw new EntryError('対象カテゴリのVCを125個以下にしてください。');
  const rows = [];
  for (let i=0; i<choices.length; i+=25) rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`vc:select:${i}`).setPlaceholder('移動先を選択')
    .addOptions(choices.slice(i,i+25).map(c => ({label: c.name.slice(0,100), value: c.id,description:`${c.members.filter(m=>!m.user.bot).size}人が参加中`})))));
  await interaction.editReply(payload('✦  行き先を選択','入室できるVCだけを表示しています。\n選択すると、参加予告の順番待ちに入ります。',{components:rows}));
}
async function refreshPanel(create=false) {
  const c=settings.get();
  if(!c.lobbyId) throw new EntryError('先に /vc設定 ロビー を設定してください。');
  const lobby=await guild.channels.fetch(c.lobbyId);
  if(!lobby || lobby.type!==ChannelType.GuildVoice) throw new EntryError('ロビーVCが見つかりません。再設定してください。');
  if(c.panel?.channelId===c.lobbyId) {
    try {const message=await lobby.messages.fetch(c.panel.messageId);await message.edit(panel(c));return;}
    catch(error) {if(error.code!==10008)throw error;}
  }
  if(create) {
    const message=await lobby.send(panel(c));
    await settings.update(next=>{next.panel={channelId:c.lobbyId,messageId:message.id};});
  }
}
function configurationCard(c) {
  const destinations=c.targetIds.length ? c.targetIds.slice(0,25).map(id=>`<#${id}>`).join('\n')+(c.targetIds.length>25?`\nほか ${c.targetIds.length-25}件`:''):'未設定';
  return payload('✦  ロビー設定',`**ロビー**\n${c.lobbyId?`<#${c.lobbyId}>`:'未設定'}\n\n**行き先 · ${c.targetIds.length}件**\n${destinations}\n\n**待機** ${c.seconds}秒　 **ずんだもん** ${c.voice?'ON':'OFF'}\n**音量** ${c.volume??30}%\n**直接入室** ${c.enforce?'検出後ロビーへ戻す':'許可'}\n\n設定は自動保存されます。`);
}
async function configure(interaction) {
  if(!interaction.memberPermissions.has(P.ManageGuild))throw new EntryError('設定変更には「サーバー管理」権限が必要です。');
  const action=interaction.options.getSubcommand();
  if(action==='一覧'){await interaction.editReply(configurationCard(settings.get()));return;}
  if(action==='辞書一覧') {
    const words=settings.get().words??[];
    const description=words.length ? words.slice(0,25).map(w=>`**${text(w.surface)}** → ${text(w.reading)}`).join('\n')+(words.length>25?`\nほか ${words.length-25}件`:'') : '読み方はまだ登録されていません。';
    await interaction.editReply(payload(`✦  読み方辞書 · ${words.length}件`,description));return;
  }
  if(action==='パネル設置'){await refreshPanel(true);await interaction.editReply(payload('✦  パネルを設置','ロビーVCのチャットに入室パネルを設置・更新しました。',{state:'success'}));return;}
  const channel=interaction.options.getChannel('チャンネル');
  if(channel) {
    if(channel.type!==ChannelType.GuildVoice)throw new EntryError('通常のVCを指定してください。');
    if(action!=='行き先削除') {
      const required=[P.ViewChannel,P.Connect,P.MoveMembers,P.SendMessages,P.EmbedLinks];
      if(!channel.permissionsFor(guild.members.me)?.has(required))throw new EntryError('そのVCでBotの閲覧・接続・移動・送信・埋め込み権限が不足しています。');
      if(action==='ロビー' && !channel.permissionsFor(guild.members.me).has(P.ReadMessageHistory))throw new EntryError('パネル更新のため「メッセージ履歴を読む」権限も付けてください。');
    }
  }
  await settings.update(c=>{
    if(action==='ロビー') {
      if(c.targetIds.includes(channel.id))throw new EntryError('行き先から削除してからロビーに設定してください。');
      c.lobbyId=channel.id;
    } else if(action==='行き先追加') {
      if(channel.id===c.lobbyId)throw new EntryError('ロビーを行き先にはできません。');
      if(c.targetIds.includes(channel.id))throw new EntryError('そのVCはすでに候補に登録されています。');
      if(c.targetIds.length>=125)throw new EntryError('行き先は125件までです。');
      c.targetIds.push(channel.id);
    } else if(action==='行き先削除') {
      if(!c.targetIds.includes(channel.id))throw new EntryError('そのVCは候補に登録されていません。');
      c.targetIds=c.targetIds.filter(id=>id!==channel.id);
    } else if(action==='待機秒数')c.seconds=interaction.options.getInteger('秒');
    else if(action==='通知音')c.voice=interaction.options.getBoolean('有効');
    else if(action==='音量')c.volume=interaction.options.getInteger('パーセント');
    else if(action==='直接入室')c.enforce=!interaction.options.getBoolean('許可');
    else if(action==='辞書登録' || action==='辞書削除') {
      const surface=interaction.options.getString('単語').normalize('NFKC').trim();
      if(!surface || !/^[\p{L}\p{N} ー]+$/u.test(surface))throw new EntryError('単語は文字・数字・空白で指定してください。');
      c.words=(c.words??[]).filter(w=>w.surface.toLowerCase()!==surface.toLowerCase());
      if(action==='辞書登録') {
        const reading=interaction.options.getString('読み').normalize('NFKC').trim().replace(/[ぁ-ゖ]/g,ch=>String.fromCharCode(ch.charCodeAt(0)+0x60));
        if(!/^[ァ-ヴー]+$/.test(reading))throw new EntryError('読みはひらがな・カタカナ・長音で指定してください。');
        if(c.words.length>=100)throw new EntryError('読み方の登録は100件までです。');
        c.words.push({surface,reading});
      }
    }
    else throw new EntryError('不明な設定操作です。');
  });
  revision++;
  for(const job of pending.values())if(!job.moving)job.abort.abort();
  let note='';
  try {await refreshPanel();}catch{note='\nパネルを更新できませんでした。設定は保存済みです。 /vc設定 パネル設置 で再設置してください。';}
  await interaction.editReply(payload('✦  設定を保存',`**${action}** を更新しました。\n再起動は不要です。${note}`,{state:'success'}));
}
client.once('clientReady', async () => {
  try {
    guild = await client.guilds.fetch(env.GUILD_ID);
    await guild.channels.fetch(); await guild.members.fetchMe();
    for(const command of commands()) await guild.commands.create(command.toJSON());
    const old=(await guild.commands.fetch()).find(x=>x.name==='vc-panel');if(old)await old.delete();
    client.user.setActivity('✦ /vc で次の会話へ');
    ready = true; console.log(`準備完了: ${client.user.tag} / 通知音 ${settings.get().voice ? 'ON' : 'OFF'}`);
  } catch (error) {console.error('初期設定:', error instanceof EntryError ? error.message : error.code ?? error.name); client.destroy(); process.exitCode = 1;}
});
client.on('interactionCreate', async interaction => {
  if (!ready || interaction.guildId !== env.GUILD_ID) return;
  const command = interaction.isChatInputCommand() && ['vc','vc設定'].includes(interaction.commandName);
  const component = (interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith('vc:');
  if (!command && !component) return;
  try {
    if (interaction.isButton() && interaction.customId.startsWith('vc:cancel:')) {
      const job = pending.get(interaction.user.id);
      if (!job || interaction.customId !== `vc:cancel:${job.interaction.id}` || job.moving) return interaction.reply({...payload('✧  予約終了','この予約は終了済み、または移動を開始しています。'),flags:MessageFlags.Ephemeral});
      job.abort.abort(); await interaction.update(payload('✧  キャンセル','入室予約を取り消しました。')); return;
    }
    if (interaction.isStringSelectMenu()) await interaction.deferUpdate();
    else await interaction.deferReply({flags: MessageFlags.Ephemeral});
    if (stopping) throw new EntryError('Botを終了しています。');
    if(command && interaction.commandName==='vc設定'){await configure(interaction);return;}
    if (!interaction.isStringSelectMenu()) {await choose(interaction); return;}
    if (pending.has(interaction.user.id)) throw new EntryError('すでに入室待ちです。先にキャンセルしてください。');
    if (queue.size >= 20) throw new EntryError('入室待ちが多いため、少し後でお試しください。');
    const job = {userId:interaction.user.id, channelId:interaction.values[0], interaction, abort:new AbortController(), moving:false,revision,config:configured()};
    await validate(job);
    if (pending.has(job.userId)) throw new EntryError('すでに入室待ちです。');
    pending.set(job.userId,job);
    await status(job,'✧  入室待ち',`順番に参加を予告します。\n告知完了から **${job.config.seconds}秒** 後に入室します。`,[cancelButton(job)]);
    void queue.add(() => run(job)).catch(error => console.error('キュー:',error.name));
  } catch (error) {
    const content = error instanceof EntryError ? error.message : '操作に失敗しました。設定や権限を確認してください。';
    if (interaction.deferred || interaction.replied) await quiet(() => interaction.editReply(payload('✧  確認してください',content,{state:'error'})));
    else await quiet(() => interaction.reply({...payload('✧  確認してください',content,{state:'error'}),flags:MessageFlags.Ephemeral}));
    console.error('操作:',error.code ?? error.name);
  }
});
client.on('voiceStateUpdate',(before,after) => {
  if (!ready || after.guild.id !== guild.id || after.member?.user.bot || before.channelId === after.channelId) return;
  const c=settings.get();
  const grant = grants.get(after.id);
  if (grant?.channelId === after.channelId) {grants.delete(after.id); return;}
  const job = pending.get(after.id);
  if (job && !job.moving && after.channelId !== c.lobbyId) job.abort.abort();
  if (c.enforce && c.lobbyId && c.targetIds.includes(after.channelId) && after.channelId !== c.lobbyId) {
    after.setChannel(c.lobbyId,'予告付き入室にはロビーをご利用ください').catch(error => console.error('ロビー移動:',error.code ?? error.name));
  }
});
client.on('error',error => console.error('Discord接続:',error.code ?? error.name));
for (const signal of ['SIGTERM','SIGINT']) process.once(signal,() => {
  stopping = true; for (const job of pending.values()) job.abort.abort(); client.destroy();
});
client.login(env.DISCORD_TOKEN).catch(error => {console.error('ログイン:',error.code ?? error.name);process.exitCode=1;});
