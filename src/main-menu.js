import {ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,MessageFlags,PermissionFlagsBits as P} from 'discord.js';
import {themed,menuHomeButton,adminHomeButton} from './ui.js';
const row=(...buttons)=>new ActionRowBuilder().addComponents(...buttons);
const button=(action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`menu:${action}`).setLabel(label).setStyle(style);
import {menuDestinations as destinations,isMenuDestination as destination,menuTroubleshooting,menuGuideTopics,menuTaskDetails,menuCapabilities,menuCapabilityNote} from './menu-catalog.js';
const {payload}=themed('menu');
class MenuUiError extends Error{}
export function mainMenuScreen({admin=false,recent=[],capabilities}={}){
  const items=[...new Set(recent.filter(destination))].slice(0,3),state=menuCapabilities(capabilities);
  const diceHint=state.diceEnabled===false?'チャットダイスは現在OFFです。':state.diceFullContent===false?'チャットダイスは @Bot 1D100 のようにメンションして使えます。':'チャットダイスは1D100などを投稿して使えます。';
  return {...payload('メニュー',`**やりたいことを選んでください**\n\n**VCに入る** · ロビーから行き先を選ぶ\n**読み上げ** · ${state.readingEnabled===false?'現在は未有効 · 使い方で手順を確認':'このチャンネルの投稿を、参加中のVCで聞く'}\n**ゲーム** · 無料ゲーム・チップゲームで遊ぶ\n**予定表** · このチャンネルの共有予定を見る\n\n読み上げ・ゲーム・個人設定は選択欄から開けます。「使い方」で手順を確認できます。${diceHint}`,{components:[
    row(button('vc','VCに入る',ButtonStyle.Primary),button('calendar','予定表')),
    row(new StringSelectMenuBuilder().setCustomId('menu:find').setPlaceholder('目的・説明から機能を探す').addOptions(...Object.entries(destinations).map(([value,d])=>({value,label:d.label,description:d.summary})))),
    ...(items.length?[row(new StringSelectMenuBuilder().setCustomId('menu:recent').setPlaceholder('最近使った機能を開く').addOptions(...items.map(value=>({value,label:destinations[value].label,description:destinations[value].summary}))))]:[]),
    row(button('help','使い方'),...(admin?[adminHomeButton()]:[])),
  ]}),attachments:[]};
}
export function mainMenuGuideScreen(topic,capabilities){
  const selected=typeof topic==='string'&&Object.hasOwn(menuGuideTopics,topic)?menuGuideTopics[topic]:null,note=menuCapabilityNote(topic,capabilities),state=menuCapabilities(capabilities),task=selected?menuTaskDetails[topic]:null;
  const trouble=topic==='dice'&&state.diceEnabled===false?'管理者にダイス返信の有効化を依頼してください。ON/OFFは動作診断でも確認できます。':topic==='read'&&state.readingEnabled===false?'管理者が読み上げ設定を有効にしてBotを再起動すると利用できます。':menuTroubleshooting[topic];
  return {...payload(selected?`使い方 · ${selected.label}`:'使い方',selected?`${note?`${note}\n\n`:''}${task?`**使う前に**\n${task.prepare}\n\n**手順**\n`:''}${selected.guide}${task?`\n\n**反映・終了**\n${task.effect}`:''}\n\n**うまく動かないとき**\n${trouble}`:'操作の手順を選んでください。\n\n普段は **/menu**、管理者の設定は **/admin** から開きます。\nどの機能も、まず画面で内容を確認できます。',{components:[
    row(new StringSelectMenuBuilder().setCustomId('menu:help-topic').setPlaceholder('知りたい操作を選ぶ').addOptions(...Object.entries(menuGuideTopics).map(([value,item])=>({value,label:item.label,description:item.summary,default:value===topic})))),
    row(...(selected&&destination(topic)?[button(topic,`${selected.label}を開く`,ButtonStyle.Primary)]:[]),menuHomeButton()),
  ]}),attachments:[]};
}
export function createMainMenu({guild,openVc,openRead,openGame,openProfile,openWallet,openCalendar,capabilities=()=>({}),now=()=>Date.now(),access=async i=>{
  const [member,channel]=await Promise.all([guild.members.fetch({user:i.user.id,force:true}),guild.channels.fetch(i.channelId,{force:true})]);
  if(!channel?.permissionsFor(member)?.has(P.ViewChannel))throw new MenuUiError('このチャンネルの閲覧権限を確認してください。');
  return {admin:member.permissions.has(P.Administrator)};
}}){
  // Destination names only. Never retain message text, controller state or results.
  const recent=new Map(),ttl=10*60*1000,limit=200;
  const key=i=>JSON.stringify([i.channelId,i.user.id]);
  const history=i=>{const stamp=now();for(const [id,entry] of recent)if(entry.expires<=stamp)recent.delete(id);return recent.get(key(i))?.items??[];};
  const remember=(i,action)=>{
    const items=[action,...history(i).filter(item=>item!==action)].slice(0,3),id=key(i);
    recent.delete(id);recent.set(id,{items,expires:now()+ttl});
    while(recent.size>limit)recent.delete(recent.keys().next().value);
  };
  return {async handle(i){let recovery;try{
    if(!i.deferred&&!i.replied){if(i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});}
    const click=i.customId?.match(/^menu:(open|vc|read|game|stop|profile|wallet|calendar|help|help-topic|recent|find)$/);
    if(i.customId&&!click)throw new MenuUiError('メニューを開き直してください。');
    let action=click?.[1]??i.options?.getString('操作')??'open';
    if(!['open','vc','read','game','stop','profile','wallet','calendar','help','help-topic','recent','find'].includes(action))throw new MenuUiError('操作を選び直してください。');
    const permission=await access(i);
    if(!permission)throw new MenuUiError('このチャンネルの閲覧権限を確認してください。');
    if(action==='find'){if(i.values?.length!==1||!destination(i.values[0]))throw new MenuUiError('一覧から機能を選び直してください。');action=i.values[0];}
    if(action==='recent'){
      if(i.values?.length!==1||!history(i).includes(i.values[0]))throw new MenuUiError('最近使った機能の表示が変わりました。メニューを開き直してください。');
      action=i.values[0];
    }
    const state=['open','help','help-topic'].includes(action)?menuCapabilities(capabilities()):undefined;
    if(destination(action))recovery=action;
    if(action==='open')await i.editReply(mainMenuScreen({...permission,recent:history(i),capabilities:state}));
    else if(action==='help')await i.editReply(mainMenuGuideScreen(undefined,state));
    else if(action==='help-topic'){
      if(i.values?.length!==1||!(typeof i.values[0]==='string'&&Object.hasOwn(menuGuideTopics,i.values[0])))throw new MenuUiError('知りたい操作を選び直してください。');
      await i.editReply(mainMenuGuideScreen(i.values[0],state));
    }
    else if(action==='vc')await openVc(i);
    else if(action==='game')await openGame(i);
    else if(action==='profile')await openProfile(i);
    else if(action==='wallet')await openWallet(i);
    else if(action==='calendar')await openCalendar(i);
    else await openRead(i,action==='stop'?'stop':'status');
    if(destination(action))remember(i,action);
  }catch(error){const message={...payload('メニュー',error instanceof MenuUiError?error.message:'操作を完了できませんでした。メニューから開き直してください。',{state:'error',components:[row(...(recovery?[button(recovery,`${destinations[recovery].label}を開き直す`,ButtonStyle.Primary)]:[]),button('help','使い方'),menuHomeButton())]}),attachments:[]};if(i.deferred||i.replied)await i.editReply(message);else await i.reply({...message,flags:MessageFlags.Ephemeral});}}};
}
