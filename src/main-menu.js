import {ActionRowBuilder,ButtonBuilder,ButtonStyle,MessageFlags,PermissionFlagsBits as P} from 'discord.js';
import {payload,menuHomeButton,adminHomeButton} from './ui.js';
const row=(...buttons)=>new ActionRowBuilder().addComponents(...buttons);
const button=(action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`menu:${action}`).setLabel(label).setStyle(style);
export function mainMenuScreen({admin=false}={}){
  return {...payload('メニュー','**やりたいことを選んでください**\n\n**VCに入る** · ロビーから行き先を選ぶ\n**読み上げ** · このチャンネルの投稿を、参加中のVCで聞く\n**ゲーム** · 無料ゲーム・チップゲームで遊ぶ\n\n自分の読み方やチップも、下のボタンから確認できます。',{components:[
    row(button('vc','VCに入る',ButtonStyle.Primary),button('read','読み上げ'),button('game','ゲーム')),
    row(new ButtonBuilder().setCustomId('profile:open').setLabel('自分の読み方').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('wallet:open').setLabel('自分のチップ').setStyle(ButtonStyle.Secondary)),
    ...(admin?[row(adminHomeButton())]:[]),
  ]}),attachments:[]};
}
export function createMainMenu({guild,openVc,openRead,openGame,openProfile,openWallet,access=async i=>{
  const [member,channel]=await Promise.all([guild.members.fetch({user:i.user.id,force:true}),guild.channels.fetch(i.channelId,{force:true})]);
  if(!channel?.permissionsFor(member)?.has(P.ViewChannel))throw new Error('このチャンネルの閲覧権限を確認してください。');
  return {admin:member.permissions.has(P.Administrator)};
}}){
  return {async handle(i){try{
    if(!i.deferred&&!i.replied){if(i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});}
    const click=i.customId?.match(/^menu:(open|vc|read|game|stop|profile|wallet)$/);
    if(i.customId&&!click)throw new Error('メニューを開き直してください。');
    const action=click?.[1]??i.options?.getString('操作')??'open';
    if(!['open','vc','read','game','stop','profile','wallet'].includes(action))throw new Error('操作を選び直してください。');
    const permission=await access(i);
    if(!permission)throw new Error('このチャンネルの閲覧権限を確認してください。');
    if(action==='open')await i.editReply(mainMenuScreen(permission));
    else if(action==='vc')await openVc(i);
    else if(action==='game')await openGame(i);
    else if(action==='profile')await openProfile(i);
    else if(action==='wallet')await openWallet(i);
    else await openRead(i,action==='stop'?'stop':'status');
  }catch(error){const message={...payload('メニュー',error.message??'操作を完了できませんでした。',{state:'error',components:[row(menuHomeButton())]}),attachments:[]};if(i.deferred||i.replied)await i.editReply(message);else await i.reply({...message,flags:MessageFlags.Ephemeral});}}};
}
