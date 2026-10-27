import {SharedBotResourceError} from './shared-bot-resources.js';
import {globalNetworkAdmin} from './server-network-access.js';
import {createChatDice,configureDiceContent} from './chat-dice.js';
import {createBenchmarkController} from './voice-benchmark-ui.js';
import {createRestartController} from './restart-ui.js';
import {createRuntimeEnvController} from './runtime-env-ui.js';
import {createBackupReader} from './backup-reader.js';
import {createImageWorkshop} from './image-workshop-ui.js';
import {createBannerController} from './banner-ui.js';
import {createMainMenu} from './main-menu.js';
import {lobbyEntryGuide} from './vc-entry-ui.js';
import {createVersionController} from './version-ui.js';
import {createUpdateCapacity} from './update-capacity.js';
import {GatewayIntentBits, PermissionFlagsBits as P, ActionRowBuilder,
  StringSelectMenuBuilder, MessageFlags} from 'discord.js';
import {setTimeout as delay} from 'node:timers/promises';
import {updateBusy} from './update-lifecycle.js';
import {canEnter} from './queue.js';
import {connectSpeech} from './audio.js';
import {synthesize,gentlePcm} from './speech.js';

import {SettingsStore} from './settings.js';
import {registerCommands} from './commands.js';
import {createSecurityScan} from './security-scan.js';
import {createDiagnostics} from './diagnostics.js';
import {createAdminController} from './admin.js';
import {createPanelRefresher} from './panel.js';
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
import {text,themed,themeForNamespace,polishMessage,openButton,cancelButton,countdownCard,choiceNavigation,waitingCard,personalReadingButton,menuHomeButton} from './ui.js';
const {payload}=themed('voice');
// Every interaction response passes through the shared button rules, including screens built outside payload().
function polishResponses(interaction){
  for(const method of ['reply','update','editReply','followUp']){
    const original=interaction[method];
    if(typeof original==='function')interaction[method]=options=>original.call(interaction,polishMessage(options));
  }
}
export async function createGuildRuntime({client,guild,root,env,runtimeEnv,resourcePresence,updateClient,diceJudge,voiceProbe,botVersion,network,globalBusy,voiceBusy,readingActive=()=>false,sharedResources}) {
const settings=new SettingsStore(`${root}/settings.json`,{version:1,lobbyId:null,targetIds:[],seconds:5,voice:true,enforce:true,panel:null});
await settings.load();
const personalReadings=await new PersonalReadingsStore(`${root}/personal-readings.json`).load();
const trpgStore=await new TrpgStore(`${root}/trpg.json`).load();
const scheduleStore=await new ScheduleStore(`${root}/schedules.json`).load();
const gameWallets=await new GameWalletStore(`${root}/game-wallets.json`).load();
const backupEnabled=env.ASTRAL_BACKUP_TTS==='1';
const globalAccess=i=>globalNetworkAdmin(client,env.GUILD_ID,guild,i);
const versions=createVersionController({updater:updateClient,estimateCapacity:createUpdateCapacity(),access:globalAccess,beforeStart:async()=>{if(voiceProbe.busy)throw new EntryError('処理速度を測定中です。中断または完了後に更新してください。');if(globalBusy())throw new EntryError('別サーバーを含む処理やゲームが進行中です。完了後に更新してください。');}});
const queue=sharedResources.entryQueue, pending=new Map(),grants=new Map();
const limits=new InteractionLimits();
let chatDice,speedMeasurements,restarts,runtimeSettings,mainMenu,backupReader,banner,imageWorkshop,admin,densuke,trpg,profile,blackjack,casino,rps,four,schedule,sharedSchedules,interactionHandlers,chipAccount,chipTools,forumTags,refreshPanel,ready=false,stopping=false,revision=0;
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
  if(sharedResources?.imageBusy)throw new EntryError('画像の処理中です。完了後に入室してください。');
  if(voiceProbe?.busy)throw new EntryError('処理速度を測定中です。完了または中断後に入室してください。');
  job.abort.signal.throwIfAborted();
  if(job.revision !== revision) throw new EntryError('設定が変更されたため中止しました。');
  const c=configured();
  if(c.voice&&(backupReader?.active||readingActive()))throw new EntryError('メイン・サブの読み上げ中です。開始したサーバーで停止してから入室してください。');
  const member = await guild.members.fetch({user: job.userId, force: true});
  const channel = await guild.channels.fetch(job.channelId);
  job.abort.signal.throwIfAborted();
  if(job.revision !== revision) throw new EntryError('設定が変更されたため中止しました。');
  if(c.voice&&(backupReader?.active||readingActive()))throw new EntryError('メイン・サブの読み上げ中です。開始したサーバーで停止してから入室してください。');
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
  if(c.voice&&(backupReader?.active||readingActive()))throw new EntryError('メイン・サブの読み上げ中です。開始したサーバーで停止してから入室してください。');
  const member = await guild.members.fetch({user:interaction.user.id,force:true});
  if(c.voice&&(backupReader?.active||readingActive()))throw new EntryError('メイン・サブの読み上げ中です。開始したサーバーで停止してから入室してください。');
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
    await guild.channels.fetch(); await guild.members.fetchMe();
    chatDice=createChatDice({guild,judge:diceJudge.enabled?(text,options)=>diceJudge.decide(text,options):null,enabled:()=>ready&&!stopping&&settings.get().chatDice!==false});
    speedMeasurements=createBenchmarkController({guild,access:globalAccess,probe:voiceProbe,onDiagnostic:info=>console.warn('速度測定の操作:',`v${botVersion}`,JSON.stringify(info))});
    backupReader=createBackupReader({guild,enabled:backupEnabled,voiceBusy:()=>voiceProbe.busy||voiceBusy()||resourcePresence.activeCount>1,volume:()=>settings.get().volume??30,activity:()=>resourcePresence.activity(),onDiagnostic:failure=>console.warn('読み上げ停止:',failure.code,`v${botVersion}`,JSON.stringify(failure.info??{}))});
    const bannerState=user=>({key:user.banner??null,url:user.bannerURL({extension:'png',size:1024})??null});
    banner=createBannerController({guild,access:globalAccess,current:async()=>{try{return bannerState(await client.user.fetch(true));}catch{throw new EntryError('現在のバナーを取得できませんでした。少し待ってから「現在を確認」を押してください。');}},update:async image=>{try{return bannerState(await sharedResources.banner(()=>client.user.setBanner(image)));}catch(error){if(error instanceof SharedBotResourceError)throw error;throw new EntryError('バナーの反映を確認できませんでした。「現在を確認」で状態を確認してからお試しください。');}}});
    imageWorkshop=createImageWorkshop({guild,convert:(input,options)=>sharedResources.image(input,options),canProcess:()=>!voiceProbe.busy&&!voiceBusy()});
    refreshPanel=createPanelRefresher({settings,guild});
    await registerCommands(guild);
    densuke=createDensukeController({email:guild.id===env.GUILD_ID?env.DENSUKE_EMAIL:undefined,settings,guild});
    forumTags=createForumTagsController({guild});
    schedule=createScheduleController({guild,store:scheduleStore});
    sharedSchedules=createSharedScheduleController({guild,store:scheduleStore,openCalendar:(i,id)=>schedule.openShared(i,id)});
    chipAccount=createChipAccountController({guild,wallet:gameWallets});
    four=createFourController({guild});
    rps=createRpsController({guild});
    chipTools=createChipTools({guild,wallet:gameWallets});
    casino=createCasinoController({guild,wallet:gameWallets,openWork:i=>chipTools.openWork(i)});
    blackjack=createBlackjackController({guild,wallet:gameWallets,openWallet:i=>chipAccount.openSelf(i),openTransfer:i=>chipTools.openTransfer(i),openCasual:i=>rps.open(i),openFour:i=>four.open(i),openWork:i=>chipTools.openWork(i),openCasino:(i,kind)=>casino.open(i,kind),casinoCurrent:i=>casino.current(i)});
    profile=createProfileController({store:personalReadings,guild,words:()=>settings.get().words});
    mainMenu=createMainMenu({guild,capabilities:()=>({readingEnabled:backupEnabled,diceEnabled:settings.get().chatDice!==false,diceFullContent:client.options.intents.has(GatewayIntentBits.MessageContent)}),openVc:i=>choose(i),openRead:(i,action)=>backupReader.handle(i,action),openGame:i=>blackjack.lobby(i),openProfile:i=>profile.open(i),openWallet:i=>chipAccount.openSelf(i),openCalendar:i=>sharedSchedules.open(i),openWorkshop:i=>imageWorkshop.open(i)});
    trpg=createTrpgController({store:trpgStore,guild});
    restarts=createRestartController({guild,access:globalAccess,store:runtimeEnv,rpc:updateClient,supported:env.ASTRAL_RESTART_PROTOCOL==='1'&&process.connected,beforeStart:()=>{if(globalBusy())throw new EntryError('読み上げ・VC入室・ゲームなどが進行中です。終了後に再起動してください。');}});
    runtimeSettings=createRuntimeEnvController({guild,access:globalAccess,store:runtimeEnv});
    admin=createAdminController({settings,guild,securityScan:createSecurityScan(),refreshPanel,changed:settingsChanged,pendingCount:()=>[...pending.values()].filter(job=>!job.moving && !job.abort.signal.aborted).length,openDensuke:i=>densuke.open(i),openTrpg:i=>trpg.open(i),openForum:i=>forumTags.open(i),openChips:i=>chipAccount.openAdmin(i),openSchedule:i=>schedule.openAdmin(i),openUpdates:i=>versions.open(i),openBanner:i=>banner.open(i),openRuntime:i=>runtimeSettings.open(i),openRestart:i=>restarts.open(i),openPerformance:i=>speedMeasurements.open(i),openServers:i=>network.ui.open(i),jevTest:diceJudge,diagnose:createDiagnostics({settings,guild,diceState:()=>({enabled:settings.get().chatDice!==false,fullContent:client.options.intents.has(GatewayIntentBits.MessageContent),judge:diceJudge.snapshot()}),version:botVersion,pendingCount:()=>pending.size,backupState:()=>({enabled:backupEnabled,active:backupReader.active,lastFailure:backupReader.lastFailure})})});
    interactionHandlers=createInteractionHandlers({serverNetwork:network.ui,mainMenu,backupReader,speedMeasurements,restarts,runtimeSettings,banner,imageWorkshop,versions,admin,densuke,trpg,profile,forumTags,sharedSchedules,schedule,blackjack,casino,rps,four,chipAccount,chipTools});
async function interaction(interaction) {
  if (!ready || interaction.guildId !== guild.id) return;
  const route=interactionRoute(interaction);if(!route)return;
  polishResponses(interaction);
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
    imageWorkshop?.leave(interaction);
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
    if (interaction.deferred || interaction.replied) await quiet(() => interaction.editReply(payload('✧  確認してください',content,{state:'error',components,feature:themeForNamespace(route.namespace)})));
    else await quiet(() => interaction.reply({...payload('✧  確認してください',content,{state:'error',components,feature:themeForNamespace(route.namespace)}),flags:MessageFlags.Ephemeral}));
    const source=route.namespace;
    console.error('操作:',error.code ?? error.name,'機能:',source);
  }finally{finishActivity();}
}
function message(message){if(ready&&!stopping&&message.guildId===guild.id){backupReader?.onMessage(message);void chatDice?.onMessage(message);}}
function revalidate(){void backupReader?.revalidate();}
function channelDelete(channel){void backupReader?.onChannelDelete(channel);}
function voice(before,after) {
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
}

return {
 guild,settings, async refresh(){await resourcePresence.track(()=>refreshPanel(false));await resourcePresence.track(()=>schedule.refresh());await resourcePresence.track(()=>trpg.refreshPanels());},
 interaction,message,revalidate,channelDelete,voice,
 activate(){if(!stopping)ready=true;},
 readingActive:()=>!!backupReader?.active,
 voiceBusy:()=>!!backupReader?.active||pending.size>0||queue.size>0,
 busy:()=>updateBusy({pending:pending.size,accounts:gameWallets.accounts.values(),sessions:[blackjack?.sessions,rps?.sessions,four?.sessions,chipTools?.work]})||!!backupReader?.active,
 freeze(){stopping=true;ready=false;banner?.close();imageWorkshop?.close();void backupReader?.close();for(const job of pending.values())job.abort.abort();},
 async drain(){await backupReader?.close();await Promise.all([settings.tail,personalReadings.tail,trpgStore.tail,scheduleStore.tail,gameWallets.tail]);},
};
}
