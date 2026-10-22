import {createVoiceBenchmark} from './voice-benchmark.js';
import {createBenchmarkController} from './voice-benchmark-ui.js';
import {createRestartController} from './restart-ui.js';
import {RuntimeEnvStore} from './runtime-env.js';
import {createRuntimeEnvController} from './runtime-env-ui.js';
import {createBackupReader} from './backup-reader.js';
import {createBannerController} from './banner-ui.js';
import {createMainMenu} from './main-menu.js';
import {lobbyEntryGuide} from './vc-entry-ui.js';
import {createUpdateClient} from './update-client.js';
import {createVersionController} from './version-ui.js';
import {createUpdateCapacity} from './update-capacity.js';
import {Client, GatewayIntentBits, PermissionFlagsBits as P, ActionRowBuilder,
  StringSelectMenuBuilder, MessageFlags} from 'discord.js';
import {setTimeout as delay} from 'node:timers/promises';
import {createUpdateLifecycle,updateBusy} from './update-lifecycle.js';
import {SerialQueue, canEnter} from './queue.js';
import {connectSpeech} from './audio.js';
import {synthesize,gentlePcm} from './speech.js';

import {SettingsStore} from './settings.js';
import {registerCommands} from './commands.js';
import {readFile} from 'node:fs/promises';
import {createSecurityScan} from './security-scan.js';
import {createDiagnostics} from './diagnostics.js';
import {createAdminController} from './admin.js';
import {createPanelRefresher} from './panel.js';
import {createResourcePresence,updateProfileVersion} from './resource-presence.js';
import {InteractionLimits} from './limits.js';
import {createDensukeController} from './densuke-ui.js';
import {PersonalReadingsStore} from './personal-readings.js';
import {createForumTagsController} from './forum-tags.js';
import {createChipTools} from './chip-tools.js';
import {GameWalletStore} from './game-wallets.js';
import {ScheduleStore} from './schedule-store.js';
import {createScheduleController} from './schedule-ui.js';
import {createSharedScheduleController} from './shared-schedule-ui.js';
import {interactionRoute,createInteractionHandlers} from './interaction-routing.js';
import {createFourController} from './four-ui.js';
import {createChipAccountController} from './chip-account-ui.js';
import {createRpsController} from './rps-ui.js';
import {createCasinoController} from './casino-ui.js';
import {createBlackjackController} from './blackjack-ui.js';
import {createProfileController} from './profile-ui.js';
import {TrpgStore} from './trpg-store.js';
import {createTrpgController} from './trpg-ui.js';
import {text,payload,openButton,cancelButton,countdownCard,choiceNavigation,waitingCard,setBotIconProvider,personalReadingButton,menuHomeButton} from './ui.js';
const env=process.env;
if(!/^\d{17,20}$/.test(env.GUILD_ID || '')) throw new Error('GUILD_IDにDiscordサーバーのIDを設定してください。');
if(!env.DISCORD_TOKEN || env.DISCORD_TOKEN.startsWith('put_')) throw new Error('DISCORD_TOKENを設定してください。');
const runtimeEnv=await new RuntimeEnvStore('data/runtime-env.json',{base:env}).load();
runtimeEnv.apply(env);
const settings=new SettingsStore('data/settings.json',{version:1,lobbyId:null,targetIds:[],seconds:5,voice:true,enforce:true,panel:null});
await settings.load();
const personalReadings=await new PersonalReadingsStore('data/personal-readings.json').load();
const trpgStore=await new TrpgStore('data/trpg.json').load();
const scheduleStore=await new ScheduleStore('data/schedules.json').load();
const gameWallets=await new GameWalletStore('data/game-wallets.json').load();
const backupEnabled=env.ASTRAL_BACKUP_TTS==='1';
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates,...(backupEnabled?[GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent]:[])],presence:{status:env.ASTRAL_UPDATING==='1'||env.ASTRAL_RESTARTING==='1'?'dnd':'idle'}});
const botVersion=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version;
const resourcePresence=createResourcePresence(client,{version:botVersion,updating:env.ASTRAL_UPDATING==='1',restarting:env.ASTRAL_RESTARTING==='1'});
setBotIconProvider(()=>client.user?.displayAvatarURL({extension:'png',size:64}));
const updateClient=createUpdateClient({version:botVersion});
const versions=createVersionController({updater:updateClient,estimateCapacity:createUpdateCapacity(),access:async i=>(await guild.members.fetch({user:i.user.id,force:true})).permissions.has(P.Administrator),beforeStart:async()=>{if(voiceProbe?.busy)throw new EntryError('処理速度を測定中です。中断または完了後に更新してください。');if(backupReader?.active)throw new EntryError('バックアップ読み上げ中です。/menu の「操作」で「読み上げを停止」を選んでから更新してください。');}});
const queue=new SerialQueue(), pending=new Map(),grants=new Map();
const limits=new InteractionLimits();
let guild,voiceProbe,speedMeasurements,restarts,runtimeSettings,mainMenu,backupReader,banner,admin,densuke,trpg,profile,blackjack,casino,rps,four,schedule,sharedSchedules,interactionHandlers,chipAccount,chipTools,forumTags,refreshPanel,ready=false,stopping=false,revision=0;
const quiet=async operation=>{try{await operation();}catch{}};
const updateJob=(job,message)=>job.updates=(job.updates??Promise.resolve()).then(()=>quiet(()=>job.interaction.editReply(message)));
const status=(job,title,description,components=[],state='normal')=>updateJob(job,payload(title,description,{components,state}));
const cancelJob=(job,reason)=>{
  job.abort.abort(new EntryError(reason));
  if(!job.started && pending.get(job.userId)===job)pending.delete(job.userId);
};
const configured=()=>{const c=settings.get();if(!c.lobbyId || !c.targetIds.length)throw new EntryError('管理者が /admin の「VC設定」でロビーと行き先を設定してください。');return c;};
class EntryError extends Error {}

async function validate(job) {
  if(voiceProbe?.busy)throw new EntryError('処理速度を測定中です。完了または中断後に入室してください。');
  job.abort.signal.throwIfAborted();
  if(job.revision !== revision) throw new EntryError('設定が変更されたため中止しました。');
  const c=configured();
  if(c.voice&&backupReader?.active)throw new EntryError('バックアップ読み上げ中です。/menu の「操作」で「読み上げを停止」を選んでから入室してください。');
  const member = await guild.members.fetch({user: job.userId, force: true});
  const channel = await guild.channels.fetch(job.channelId);
  job.abort.signal.throwIfAborted();
  if(job.revision !== revision) throw new EntryError('設定が変更されたため中止しました。');
  if(c.voice&&backupReader?.active)throw new EntryError('バックアップ読み上げ中です。/menu の「操作」で「読み上げを停止」を選んでから入室してください。');
  if (member.voice.channelId !== c.lobbyId) throw new EntryError('ロビー退出により中止しました。');
  if (!canEnter(channel, member, guild.members.me, c.lobbyId, c.targetIds)) throw new EntryError('行き先の登録・閲覧権限・Bot権限・空き状況を確認してください。');
  if (c.voice && !channel.permissionsFor(guild.members.me).has(P.Speak)) throw new EntryError('Botの発言権限がありません。');
  return {member, channel};
}
async function run(job) {
  job.started=true;const finishActivity=resourcePresence.activity();
  let audio, notice,phase='validation';
  try {
    const c=job.config;
    let {member, channel} = await validate(job);
    await status(job,'✧  入室準備',`**${text(channel.name)}** に参加を予告します。`,[cancelButton(job)]);
    if (c.voice) {
      await status(job,'✧  音声を準備',`ずんだもんが **${text(member.displayName)}** さんの参加をお知らせします。`,[cancelButton(job)]);
      phase='synthesis';
      const wav=await synthesize(member.displayName,job.abort.signal,c.words??[],personalReadings.get(member.id));
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
    if(c.voice)announcement.embeds[0].setDescription(announcement.embeds[0].data.description+'\n\nVOICEVOX:ずんだもん');
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
    if(c.voice)completed.embeds[0].setDescription(completed.embeds[0].data.description+'\n\nVOICEVOX:ずんだもん');
    await quiet(() => notice.edit(completed));
    await status(job,'✦  入室しました',`**${text(channel.name)}** に移動しました。`,[],'success');
  } catch (error) {
    if (notice) {
      const cancelled=payload('✧  入室取り消し','この参加予告は取り消されました。',{state:'error'});
      if(job.config.voice)cancelled.embeds[0].setDescription(cancelled.embeds[0].data.description+'\n\nVOICEVOX:ずんだもん');
      await quiet(()=>notice.edit(cancelled));
    }
    const failures={synthesis:'音声を生成できませんでした。管理者にVOICEVOXのセットアップ確認をお願いしてください。',connection:'VCに接続できませんでした。Botの接続権限や音声接続を確認してください。',playback:'音声を再生できませんでした。Botの発言権限・サーバーミュートを確認してください。',notice:'参加予告を送信できませんでした。Botの送信・埋め込み権限を確認してください。',move:'VCへ移動できませんでした。空き状況とBotのメンバー移動権限を確認してください。'};
    await status(job,'✧  入室を中止',job.abort.signal.aborted ? job.abort.signal.reason?.message??'入室をキャンセルしました。' : error instanceof EntryError ? error.message : failures[phase]??'行き先や権限を確認して、もう一度選んでください。',[openButton()],'error');
    if(!job.abort.signal.aborted)console.error('入室処理:',phase,error.code ?? error.name);
  } finally {
    try{audio?.close();}finally{finishActivity();if(pending.get(job.userId)===job)pending.delete(job.userId);}
  }
}
async function choose(interaction,page=0) {
  const existing=pending.get(interaction.user.id);
  if(existing && !existing.abort.signal.aborted){
    await interaction.editReply(payload('✧  入室予約があります','予約の進行状況は、最初の予約メッセージで確認できます。変更したい場合は先にキャンセルしてください。',{components:[cancelButton(existing),new ActionRowBuilder().addComponents(menuHomeButton())]}));return;
  }
  const c=configured();
  if(c.voice&&backupReader?.active)throw new EntryError('バックアップ読み上げ中です。/menu の「操作」で「読み上げを停止」を選んでから入室してください。');
  const member = await guild.members.fetch({user:interaction.user.id,force:true});
  if(c.voice&&backupReader?.active)throw new EntryError('バックアップ読み上げ中です。/menu の「操作」で「読み上げを停止」を選んでから入室してください。');
  if(member.voice.channelId!==c.lobbyId){await interaction.editReply(await lobbyEntryGuide({guild,member,lobbyId:c.lobbyId}));return;}
  await guild.channels.fetch();
  const choices = [...guild.channels.cache.values()].filter(channel => canEnter(channel, member, guild.members.me, c.lobbyId, c.targetIds)
    && (!c.voice || channel.permissionsFor(guild.members.me).has(P.Speak))).sort((a,b) => a.rawPosition - b.rawPosition);
  if (!choices.length) throw new EntryError('現在入室できるVCがありません。');
  if (choices.length > 125) throw new EntryError('入室先VCの数を125個以下にしてください。');
  const pages=Math.ceil(choices.length/25);
  page=Math.max(0,Math.min(Number.isInteger(page)?page:0,pages-1));
  const menu=new StringSelectMenuBuilder().setCustomId(`vc:select:${page}`).setPlaceholder('入室するVCを選ぶ')
    .addOptions(choices.slice(page*25,page*25+25).map(channel=>({label:channel.name.slice(0,100),value:channel.id,
      description:`${channel.members.filter(m=>!m.user.bot).size}${channel.userLimit?` / ${channel.userLimit}`:''}人 · ${channel.parent?.name??'カテゴリなし'}`.slice(0,100)})));
  await interaction.editReply(payload('✦  入室先を選択',`入室できるVC **${choices.length}件**${pages>1?` · ${page+1}/${pages}ページ`:''}\n\n選ぶと参加予告が始まります。告知の終了から **${c.seconds}秒後** に入室します。`,{components:[new ActionRowBuilder().addComponents(menu),choiceNavigation(page,pages),personalReadingButton().addComponents(menuHomeButton())]}));
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
    voiceProbe=createVoiceBenchmark({version:botVersion,onDiagnostic:info=>console.warn('速度測定の操作:',`v${botVersion}`,JSON.stringify(info)),canStart:()=>{if(backupReader?.active||pending.size||queue.size||resourcePresence.activeCount>1)throw new EntryError('読み上げ・VC入室・別の操作が進行中です。終了後に測定してください。');},activity:()=>resourcePresence.activity()});
    speedMeasurements=createBenchmarkController({guild,probe:voiceProbe,onDiagnostic:info=>console.warn('速度測定の操作:',`v${botVersion}`,JSON.stringify(info))});
    backupReader=createBackupReader({guild,enabled:backupEnabled,voiceBusy:()=>voiceProbe.busy||pending.size>0||queue.size>0||resourcePresence.activeCount>1,volume:()=>settings.get().volume??30,activity:()=>resourcePresence.activity(),onDiagnostic:failure=>console.warn('読み上げ停止:',failure.code,`v${botVersion}`,JSON.stringify(failure.info??{}))});
    const bannerState=user=>({key:user.banner??null,url:user.bannerURL({extension:'png',size:1024})??null});
    banner=createBannerController({guild,current:async()=>{try{return bannerState(await client.user.fetch(true));}catch{throw new EntryError('現在のバナーを取得できませんでした。少し待ってから「現在を確認」を押してください。');}},update:async image=>{try{return bannerState(await client.user.setBanner(image));}catch{throw new EntryError('バナーの反映を確認できませんでした。「現在を確認」で状態を確認してからお試しください。');}}});
    refreshPanel=createPanelRefresher({settings,guild});
    await registerCommands(guild);
    densuke=createDensukeController({email:env.DENSUKE_EMAIL,settings,guild});
    forumTags=createForumTagsController({guild});
    schedule=createScheduleController({guild,store:scheduleStore});
    sharedSchedules=createSharedScheduleController({guild,store:scheduleStore,openCalendar:(i,id)=>schedule.openShared(i,id)});
    chipAccount=createChipAccountController({guild,wallet:gameWallets});
    four=createFourController({guild});
    rps=createRpsController({guild});
    chipTools=createChipTools({guild,wallet:gameWallets});
    casino=createCasinoController({guild,wallet:gameWallets,openWork:i=>chipTools.openWork(i)});
    blackjack=createBlackjackController({guild,wallet:gameWallets,openCasual:i=>rps.open(i),openFour:i=>four.open(i),openWork:i=>chipTools.openWork(i),openCasino:(i,kind)=>casino.open(i,kind),casinoCurrent:i=>casino.current(i)});
    profile=createProfileController({store:personalReadings,guild,words:()=>settings.get().words});
    mainMenu=createMainMenu({guild,openVc:i=>choose(i),openRead:(i,action)=>backupReader.handle(i,action),openGame:i=>blackjack.lobby(i),openProfile:i=>profile.open(i),openWallet:i=>chipAccount.openSelf(i),openCalendar:i=>sharedSchedules.open(i)});
    trpg=createTrpgController({store:trpgStore,guild});
    restarts=createRestartController({guild,store:runtimeEnv,rpc:updateClient,supported:env.ASTRAL_RESTART_PROTOCOL==='1'&&process.connected,beforeStart:()=>{if(updateBusy({active:Math.max(0,resourcePresence.activeCount-1)+(backupReader?.active?1:0),pending:pending.size,accounts:gameWallets.accounts.values(),sessions:[blackjack?.sessions,rps?.sessions,four?.sessions,chipTools?.work]}))throw new EntryError('読み上げ・VC入室・ゲームなどが進行中です。終了後に再起動してください。');}});
    runtimeSettings=createRuntimeEnvController({guild,store:runtimeEnv});
    admin=createAdminController({settings,guild,securityScan:createSecurityScan(),refreshPanel,changed:settingsChanged,pendingCount:()=>[...pending.values()].filter(job=>!job.moving && !job.abort.signal.aborted).length,openDensuke:i=>densuke.open(i),openTrpg:i=>trpg.open(i),openForum:i=>forumTags.open(i),openChips:i=>chipAccount.openAdmin(i),openSchedule:i=>schedule.openAdmin(i),openUpdates:i=>versions.open(i),openBanner:i=>banner.open(i),openRuntime:i=>runtimeSettings.open(i),openRestart:i=>restarts.open(i),openPerformance:i=>speedMeasurements.open(i),diagnose:createDiagnostics({settings,guild,version:botVersion,pendingCount:()=>pending.size,backupState:()=>({enabled:backupEnabled,active:backupReader.active,lastFailure:backupReader.lastFailure})})});
    interactionHandlers=createInteractionHandlers({mainMenu,backupReader,speedMeasurements,restarts,runtimeSettings,banner,versions,admin,densuke,trpg,profile,forumTags,sharedSchedules,schedule,blackjack,casino,rps,four,chipAccount,chipTools});
    resourcePresence.start();
    void resourcePresence.track(()=>updateProfileVersion(client.application,botVersion)).then(updated=>{if(!updated)console.warn('プロフィールの説明が長いため、バージョンはステータスに表示しています。');}).catch(()=>console.warn('プロフィールのバージョンを更新できませんでした。ステータスには表示しています。'));
    ready = process.env.ASTRAL_SUPERVISED!=='1'; console.log(`準備完了: ${client.user.tag} / v${botVersion} / 通知音 ${settings.get().voice ? 'ON' : 'OFF'}`);
    await resourcePresence.track(()=>refreshPanel(false)).catch(()=>console.warn('入室パネルを更新できませんでした。/admin の「入室パネル」から更新してください。'));
    const schedulePanels=await resourcePresence.track(()=>schedule.refresh());
    if(schedulePanels.failed)console.warn(`予定表の更新に失敗: ${schedulePanels.failed}件。管理画面から投稿情報を確認してください。`);
    const panels=await resourcePresence.track(()=>trpg.refreshPanels());
    if(panels.failed)console.warn(`キャラシパネルの更新に失敗: ${panels.failed}件。設置先の権限・メッセージを確認してください。`);
    if(process.connected)process.send({type:'worker-ready'});
  } catch (error) {console.error('初期設定:', error instanceof EntryError ? error.message : error.code ?? error.name); resourcePresence.stop();client.destroy(); process.exitCode = 1;}
});
client.on('interactionCreate', async interaction => {
  if (!ready || interaction.guildId !== env.GUILD_ID) return;
  const route=interactionRoute(interaction);if(!route)return;
  const command=route.kind==='command',component=route.kind==='component'&&route.target==='vc';
  const menuComponent=route.kind==='component'&&route.target==='menu';
  const featureComponent=route.kind==='component'&&!['vc','menu'].includes(route.target);
  // Acknowledge performance buttons before presence updates and other bookkeeping.
  if(featureComponent&&route.target==='perf'&&!await speedMeasurements.acknowledge(interaction))return;
  let finishActivity=()=>{};
  try {
    const cancellation=interaction.isButton() && interaction.customId.startsWith('vc:cancel:');
    if(!cancellation) {
      const wait=limits.consume(interaction.user.id,component && interaction.isStringSelectMenu());
      if(wait) {
        const notice=payload('✧  少しお待ちください',`操作が続いています。**${wait}秒後** にもう一度お試しください。${pending.has(interaction.user.id)?'入室予約はキャンセルできます。':''}`);
        await quiet(()=>interaction.deferred||interaction.replied?interaction.editReply(notice):interaction.reply({...notice,flags:MessageFlags.Ephemeral}));
        return;
      }
    }
    finishActivity=resourcePresence.activity();
    speedMeasurements?.leave(interaction);
    if(route.target!=='vc'){
      if(stopping)throw new EntryError('Botを終了しています。');
      await interactionHandlers.get(route.target)(interaction);return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('vc:cancel:')) {
      const job = pending.get(interaction.user.id);
      if (!job || interaction.customId !== `vc:cancel:${job.interaction.id}` || job.moving) return interaction.reply({...payload('✦  キャンセルできません','この予約は終了済み、またはVCへの移動を開始しています。'),flags:MessageFlags.Ephemeral});
      await interaction.deferUpdate();
      cancelJob(job,'入室をキャンセルしました。');
      await job.updates;
      await interaction.editReply(payload('✦  入室をキャンセルしました','入室先を選び直せます。',{components:[openButton()]})); return;
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
    const components=menuComponent||(command&&interaction.commandName==='menu')?[new ActionRowBuilder().addComponents(menuHomeButton())]:featureComponent || (command && ['admin','game','read'].includes(interaction.commandName))?[]:[openButton(),personalReadingButton().addComponents(menuHomeButton())];
    if (interaction.deferred || interaction.replied) await quiet(() => interaction.editReply(payload('✧  確認してください',content,{state:'error',components})));
    else await quiet(() => interaction.reply({...payload('✧  確認してください',content,{state:'error',components}),flags:MessageFlags.Ephemeral}));
    const source=route.namespace;
    console.error('操作:',error.code ?? error.name,'機能:',source);
  }finally{finishActivity();}
});
client.on('messageCreate',message=>{if(ready&&!stopping)backupReader?.onMessage(message);});
client.on('channelUpdate',()=>{void backupReader?.revalidate();});
client.on('channelDelete',channel=>{void backupReader?.onChannelDelete(channel);});
client.on('guildMemberUpdate',()=>{void backupReader?.revalidate();});
client.on('roleUpdate',()=>{void backupReader?.revalidate();});
client.on('roleDelete',()=>{void backupReader?.revalidate();});
client.on('voiceStateUpdate',(before,after) => {
  void backupReader?.onVoiceChange(before,after);
  if (!ready || stopping || after.guild.id !== guild.id || after.member?.user.bot || before.channelId === after.channelId) return;
  const c=settings.get();
  const grant = grants.get(after.id);
  if (grant?.channelId === after.channelId) {grants.delete(after.id); return;}
  const job = pending.get(after.id);
  if (job && !job.moving && after.channelId !== c.lobbyId) {
    cancelJob(job,'ロビーから退出したため予約を取り消しました。');
    if(!job.started)void status(job,'✧  予約を取り消しました',job.abort.signal.reason.message,[openButton()]);
  }
  if (c.enforce && c.lobbyId && c.targetIds.includes(after.channelId) && after.channelId !== c.lobbyId) {
    resourcePresence.track(()=>after.setChannel(c.lobbyId,'予告付き入室にはロビーをご利用ください')).catch(error => console.error('ロビー移動:',error.code ?? error.name));
  }
});
client.on('error',error => console.error('Discord接続:',error.code ?? error.name));
const freeze=()=>{stopping=true;ready=false;resourcePresence.stop();banner?.close();voiceProbe?.close();void backupReader?.close();};
const drain=async()=>{await backupReader?.close();updateClient.close();await Promise.all([runtimeEnv.tail,settings.tail,personalReadings.tail,trpgStore.tail,scheduleStore.tail,gameWallets.tail]);await client.destroy();};
if(process.env.ASTRAL_SUPERVISED==='1' && process.connected){
  const lifecycle=createUpdateLifecycle({snapshot:()=>runtimeEnv.snapshot().running,accept:m=>m.runtimeRevision===undefined||m.runtimeRevision===runtimeEnv.snapshot().revision,busy:()=>updateBusy({active:resourcePresence.activeCount+(backupReader?.active?1:0),pending:pending.size,accounts:gameWallets.accounts.values(),sessions:[blackjack?.sessions,rps?.sessions,four?.sessions,chipTools?.work]}),freeze,drain,send:(m,done)=>process.send(m,done??(()=>{})),exit:code=>process.exit(code)});
  process.on('message',message=>{if(message?.type==='update-presence'){resourcePresence.setUpdating(message.updating);resourcePresence.setRestarting(!!message.restarting);return;}if(message?.type==='activate'&&!stopping)ready=true;else void lifecycle(message);});
}
for (const signal of ['SIGTERM','SIGINT']) process.once(signal,() => {
  freeze();for(const job of pending.values())job.abort.abort();
  const force=setTimeout(()=>process.exit(0),12000);force.unref();
  void (async()=>{while(resourcePresence.activeCount>0)await delay(50);await drain();process.exit(0);})().catch(()=>process.exit(1));
});
client.login(env.DISCORD_TOKEN).catch(error => {console.error('ログイン:',error.code ?? error.name);process.exitCode=1;});
