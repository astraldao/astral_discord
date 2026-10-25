import {ActionRowBuilder,ButtonBuilder,ButtonStyle,ChannelType,PermissionFlagsBits as P} from 'discord.js';
import {themed,menuHomeButton} from './ui.js';
const {payload}=themed('voice');

// Only a freshly fetched, visible lobby may appear in the private guide.
export async function lobbyEntryGuide({guild,member,lobbyId}){
  let lobby;
  try{lobby=await guild.channels.fetch(lobbyId,{force:true});}catch{}
  const visible=lobby?.type===ChannelType.GuildVoice&&lobby.permissionsFor(member)?.has(P.ViewChannel);
  const connect=visible&&lobby.permissionsFor(member)?.has(P.Connect);
  const steps=connect?`1. <#${lobby.id}> に参加する\n2. この画面に戻り「入室先を確認」を押す\n3. 行き先を選ぶ`:'管理者にロビーVCの閲覧・接続権限と設定を確認してもらってください。';
  return {...payload('VCに入る',`**ロビーへの参加が必要です**\n\n${steps}`,{state:connect?'normal':'warning',components:[
    new ActionRowBuilder().addComponents(...(visible?[new ButtonBuilder().setLabel('ロビーを開く').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${guild.id}/${lobby.id}`)]:[]),new ButtonBuilder().setCustomId('menu:vc').setLabel('入室先を確認').setStyle(connect?ButtonStyle.Primary:ButtonStyle.Secondary),menuHomeButton()),
  ]}),attachments:[]};
}
