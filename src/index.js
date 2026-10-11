import {Client, GatewayIntentBits, PermissionFlagsBits as P, ActionRowBuilder,
  StringSelectMenuBuilder, MessageFlags} from 'discord.js';
import {setTimeout as delay} from 'node:timers/promises';
import {SerialQueue, canEnter} from './queue.js';
import {connectSpeech} from './audio.js';
import {synthesize,gentlePcm} from './speech.js';

import {SettingsStore} from './settings.js';
import {commands} from './commands.js';
import {createAdminController} from './admin.js';
import {createPanelRefresher} from './panel.js';
import {InteractionLimits} from './limits.js';
import {createDensukeController} from './densuke-ui.js';
import {TrpgStore} from './trpg-store.js';
import {createTrpgController} from './trpg-ui.js';
import {text,payload,openButton,cancelButton,countdownCard,choiceNavigation,waitingCard} from './ui.js';
const env=process.env;
if(!/^\d{17,20}$/.test(env.GUILD_ID || '')) throw new Error('GUILD_IDにDiscordサーバーのIDを設定してください。');
if(!env.DISCORD_TOKEN || env.DISCORD_TOKEN.startsWith('put_')) throw new Error('DISCORD_TOKENを設定してください。');
const settings=new SettingsStore('data/settings.json',{version:1,lobbyId:null,targetIds:[],seconds:5,voice:true,enforce:true,panel:null});
await settings.load();
const trpgStore=await new TrpgStore('data/trpg.json').load();
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates]});
const queue=new SerialQueue(), pending=new Map(),grants=new Map();
const limits=new InteractionLimits();
let guild,admin,densuke,trpg,refreshPanel,ready=false,stopping=false,revision=0;
const quiet=async operation=>{try{await operation();}catch{}};
const updateJob=(job,message)=>job.updates=(job.updates??Promise.resolve()).then(()=>quiet(()=>job.interaction.editReply(message)));
const status=(job,title,description,components=[],state='normal')=>updateJob(job,payload(title,description,{components,state}));
const cancelJob=(job,reason)=>{
  job.abort.abort(new EntryError(reason));
  if(!job.started && pending.get(job.userId)===job)pending.delete(job.userId);
};
const configured=()=>{const c=settings.get();if(!c.lobbyId || !c.targetIds.length)throw new EntryError('管理者が /管理 の「VC設定」でロビーと行き先を設定してください。');return c;};
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
  job.started=true;
  let audio, notice,phase='validation';
  try {
    const c=job.config;
    let {member, channel} = await validate(job);
    await status(job,'✧  入室準備',`**${text(channel.name)}** に参加を予告します。`,[cancelButton(job)]);
    if (c.voice) {
      await status(job,'✧  音声を準備',`ずんだもんが **${text(member.displayName)}** さんの参加をお知らせします。`,[cancelButton(job)]);
      phase='synthesis';
      const wav=await synthesize(member.displayName,job.abort.signal,c.words??[]);
      await validate(job);
      phase='connection';
      audio=await connectSpeech(channel,gentlePcm(wav,c.volume??30),job.abort.signal);
      await status(job,'✧  参加をお知らせ中',`**${text(channel.name)}** に音声で参加を予告しています。\n読み上げが終わるとカウントダウンが始まります。`,[cancelButton(job)]);
      phase='playback';
      await audio.start();
    }
    ({member, channel} = await validate(job));
    phase='notice';
    const announcement=payload('✦  参加予告',`**${text(member.displayName)}** さんが **${c.seconds}秒後** に参加します。`);
    announcement.embeds[0].setThumbnail(member.displayAvatarURL());
    if(c.voice)announcement.embeds[0].setFooter({text:'VOICEVOX:ずんだもん'});
    notice = await channel.send(announcement);
    const deadline = performance.now() + c.seconds*1000;
    for (let remaining = c.seconds; remaining > 0; remaining--) {
      await validate(job);
      if (audio && !audio.healthy()) throw new EntryError('音声接続が切れたため中止しました。');
      await updateJob(job,{...countdownCard(channel.name,remaining,c.seconds),components:[cancelButton(job)]});
      await delay(Math.max(0, deadline - (remaining - 1) * 1000 - performance.now()), undefined, {signal: job.abort.signal});
    }
    ({member, channel} = await validate(job));
    if (audio && !audio.healthy()) throw new EntryError('音声接続が切れたため中止しました。');
    job.abort.signal.throwIfAborted();
    phase='move';
    job.moving = true;
    const grant = {channelId: channel.id}; grants.set(member.id, grant);
    try {await member.voice.setChannel(channel, '入室予告が完了');}
    catch (error) {if (grants.get(member.id) === grant) grants.delete(member.id); throw error;}
    setTimeout(() => {if (grants.get(member.id) === grant) grants.delete(member.id);}, 10000).unref();
    const completed=payload('✦  入室しました',`**${text(member.displayName)}** さん、ようこそ。`,{state:'success'});
    if(c.voice)completed.embeds[0].setFooter({text:'VOICEVOX:ずんだもん'});
    await quiet(() => notice.edit(completed));
    await status(job,'✦  入室しました',`**${text(channel.name)}** で、よいひとときを。`,[],'success');
  } catch (error) {
    if (notice) {
      const cancelled=payload('✧  入室取り消し','この参加予告は取り消されました。',{state:'error'});
      if(job.config.voice)cancelled.embeds[0].setFooter({text:'VOICEVOX:ずんだもん'});
      await quiet(()=>notice.edit(cancelled));
    }
    const failures={synthesis:'音声を生成できませんでした。管理者にVOICEVOXのセットアップ確認をお願いしてください。',connection:'VCに接続できませんでした。Botの接続権限や音声接続を確認してください。',playback:'音声を再生できませんでした。Botの発言権限・サーバーミュートを確認してください。',notice:'参加予告を送信できませんでした。Botの送信・埋め込み権限を確認してください。',move:'VCへ移動できませんでした。空き状況とBotのメンバー移動権限を確認してください。'};
    await status(job,'✧  入室を中止',job.abort.signal.aborted ? job.abort.signal.reason?.message??'入室をキャンセルしました。' : error instanceof EntryError ? error.message : failures[phase]??'行き先や権限を確認して、もう一度選んでください。',[openButton()],'error');
    if(!job.abort.signal.aborted)console.error('入室処理:',phase,error.code ?? error.name);
  } finally {
    audio?.close();
    if (pending.get(job.userId) === job) pending.delete(job.userId);
  }
}
async function choose(interaction,page=0) {
  const existing=pending.get(interaction.user.id);
  if(existing && !existing.abort.signal.aborted){
    await interaction.editReply(payload('✧  入室予約があります','予約の進行状況は、最初の予約メッセージで確認できます。変更したい場合は先にキャンセルしてください。',{components:[cancelButton(existing)]}));return;
  }
  const c=configured();
  const member = await guild.members.fetch(interaction.user.id);
  if (member.voice.channelId !== c.lobbyId) throw new EntryError('先にロビーVCに参加してください。');
  await guild.channels.fetch();
  const choices = [...guild.channels.cache.values()].filter(channel => canEnter(channel, member, guild.members.me, c.lobbyId, c.targetIds)
    && (!c.voice || channel.permissionsFor(guild.members.me).has(P.Speak))).sort((a,b) => a.rawPosition - b.rawPosition);
  if (!choices.length) throw new EntryError('現在入室できるVCがありません。');
  if (choices.length > 125) throw new EntryError('対象カテゴリのVCを125個以下にしてください。');
  const pages=Math.ceil(choices.length/25);
  page=Math.max(0,Math.min(Number.isInteger(page)?page:0,pages-1));
  const menu=new StringSelectMenuBuilder().setCustomId(`vc:select:${page}`).setPlaceholder('入室するVCを選ぶ')
    .addOptions(choices.slice(page*25,page*25+25).map(channel=>({label:channel.name.slice(0,100),value:channel.id,
      description:`${channel.members.filter(m=>!m.user.bot).size}${channel.userLimit?` / ${channel.userLimit}`:''}人 · ${channel.parent?.name??'カテゴリなし'}`.slice(0,100)})));
  await interaction.editReply(payload('✦  行き先を選択',`入室できるVC **${choices.length}件**${pages>1?` · ${page+1} / ${pages}ページ`:''}\n選ぶと参加予告が始まります。待機中はキャンセルできます。`,{components:[new ActionRowBuilder().addComponents(menu),choiceNavigation(page,pages)]}));
}
function settingsChanged() {
  revision++;
  for(const job of pending.values())if(!job.moving){
    cancelJob(job,'設定が変更されたため予約を取り消しました。行き先を選び直してください。');
    if(!job.started)void status(job,'✧  予約を取り消しました',job.abort.signal.reason.message,[openButton()]);
  }
}
client.once('clientReady', async () => {
  try {
    guild = await client.guilds.fetch(env.GUILD_ID);
    await guild.channels.fetch(); await guild.members.fetchMe();
    refreshPanel=createPanelRefresher({settings,guild});
    for(const command of commands()) await guild.commands.create(command.toJSON());
    for(const old of (await guild.commands.fetch()).values())if(['vc-panel','vc設定'].includes(old.name))await old.delete();
    densuke=createDensukeController({email:env.DENSUKE_EMAIL,settings});
    trpg=createTrpgController({store:trpgStore,guild});
    admin=createAdminController({settings,guild,refreshPanel,changed:settingsChanged,pendingCount:()=>[...pending.values()].filter(job=>!job.moving && !job.abort.signal.aborted).length,openDensuke:i=>densuke.open(i),openTrpg:i=>trpg.open(i)});
    client.user.setActivity('✦ /vc で次の会話へ');
    ready = true; console.log(`準備完了: ${client.user.tag} / 通知音 ${settings.get().voice ? 'ON' : 'OFF'}`);
  } catch (error) {console.error('初期設定:', error instanceof EntryError ? error.message : error.code ?? error.name); client.destroy(); process.exitCode = 1;}
});
client.on('interactionCreate', async interaction => {
  if (!ready || interaction.guildId !== env.GUILD_ID) return;
  const command = interaction.isChatInputCommand() && ['vc','管理'].includes(interaction.commandName);
  const component = (interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith('vc:');
  const adminComponent=(interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) && /^(admin|densuke|trpg):/.test(interaction.customId);
  if (!command && !component && !adminComponent) return;
  try {
    const cancellation=interaction.isButton() && interaction.customId.startsWith('vc:cancel:');
    if(!cancellation) {
      const wait=limits.consume(interaction.user.id,component && interaction.isStringSelectMenu());
      if(wait) {
        await quiet(()=>interaction.reply({...payload('✧  少しお待ちください',`操作が続いています。**${wait}秒後** にもう一度お試しください。入室予約はキャンセルできます。`),flags:MessageFlags.Ephemeral}));
        return;
      }
    }
    if(adminComponent || (command && interaction.commandName==='管理')) {
      if(stopping)throw new EntryError('Botを終了しています。');
      if(adminComponent && interaction.customId.startsWith('trpg:'))await trpg.handle(interaction);else if(adminComponent && interaction.customId.startsWith('densuke:'))await densuke.handle(interaction);else await admin.handle(interaction);return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('vc:cancel:')) {
      const job = pending.get(interaction.user.id);
      if (!job || interaction.customId !== `vc:cancel:${job.interaction.id}` || job.moving) return interaction.reply({...payload('✧  予約終了','この予約は終了済み、または移動を開始しています。'),flags:MessageFlags.Ephemeral});
      await interaction.deferUpdate();
      cancelJob(job,'入室をキャンセルしました。');
      await job.updates;
      await interaction.editReply(payload('✧  キャンセル','入室予約を取り消しました。行き先を選び直せます。',{components:[openButton()]})); return;
    }
    if (interaction.isStringSelectMenu() || (interaction.isButton() && interaction.customId.startsWith('vc:page:'))) await interaction.deferUpdate();
    else await interaction.deferReply({flags: MessageFlags.Ephemeral});
    if (stopping) throw new EntryError('Botを終了しています。');
    if (!interaction.isStringSelectMenu()) {await choose(interaction,interaction.customId?.startsWith('vc:page:')?Number(interaction.customId.split(':')[2]):0); return;}
    if (pending.has(interaction.user.id)) throw new EntryError('すでに入室待ちです。先にキャンセルしてください。');
    if (queue.size >= 20) throw new EntryError('入室待ちが多いため、少し後でお試しください。');
    const job = {userId:interaction.user.id, channelId:interaction.values[0], interaction, abort:new AbortController(), moving:false,revision,config:configured()};
    await validate(job);
    if (pending.has(job.userId)) throw new EntryError('すでに入室待ちです。');
    if(queue.size>=20)throw new EntryError('入室待ちが多いため、少し後でお試しください。');
    job.channelName=guild.channels.cache.get(job.channelId)?.name??'選択したVC';
    pending.set(job.userId,job);
    void queue.add(()=>run(job),{signal:job.abort.signal,onPosition:ahead=>{
      if(job.started || job.abort.signal.aborted)return;
      void updateJob(job,{...waitingCard(job.channelName,ahead,job.config.seconds),components:[cancelButton(job)]});
    }}).catch(error=>{if(!job.abort.signal.aborted)console.error('キュー:',error.name);})
      .finally(()=>{if(pending.get(job.userId)===job)pending.delete(job.userId);});
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
  if (job && !job.moving && after.channelId !== c.lobbyId) {
    cancelJob(job,'ロビーから退出したため予約を取り消しました。');
    if(!job.started)void status(job,'✧  予約を取り消しました',job.abort.signal.reason.message,[openButton()]);
  }
  if (c.enforce && c.lobbyId && c.targetIds.includes(after.channelId) && after.channelId !== c.lobbyId) {
    after.setChannel(c.lobbyId,'予告付き入室にはロビーをご利用ください').catch(error => console.error('ロビー移動:',error.code ?? error.name));
  }
});
client.on('error',error => console.error('Discord接続:',error.code ?? error.name));
for (const signal of ['SIGTERM','SIGINT']) process.once(signal,() => {
  stopping = true; for (const job of pending.values()) job.abort.abort(); client.destroy();
});
client.login(env.DISCORD_TOKEN).catch(error => {console.error('ログイン:',error.code ?? error.name);process.exitCode=1;});
