import {EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown} from 'discord.js';
export const mentions={parse:[]};
export const text=value=>escapeMarkdown(String(value)).replace(/@/g,'＠').slice(0,100);
const colors={normal:0x8886e8,success:0x69bba8,error:0xd38da3};
export function card(title,description,state='normal') {
  return new EmbedBuilder().setColor(colors[state]).setAuthor({name:'ASTRAL · VOICE LOBBY'})
    .setTitle(title).setDescription(description);
}
export function payload(title,description,{state='normal',components=[]}={}) {
  return {content:null,embeds:[card(title,description,state)],components,allowedMentions:mentions};
}
export const openButton=()=>new ActionRowBuilder().addComponents(new ButtonBuilder()
  .setCustomId('vc:open').setLabel('行き先を選ぶ').setEmoji('✨').setStyle(ButtonStyle.Primary));
export const cancelButton=job=>new ActionRowBuilder().addComponents(new ButtonBuilder()
  .setCustomId(`vc:cancel:${job.interaction.id}`).setLabel('入室をキャンセル').setStyle(ButtonStyle.Secondary));
export function choiceNavigation(page,pages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`vc:page:${page-1}`).setLabel('前へ').setStyle(ButtonStyle.Secondary).setDisabled(page===0),
    new ButtonBuilder().setCustomId(`vc:page:${page}`).setLabel('空き状況を更新').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`vc:page:${page+1}`).setLabel('次へ').setStyle(ButtonStyle.Secondary).setDisabled(page>=pages-1));
}
export function waitingCard(name,ahead,seconds) {
  return payload('✧  入室待ち',`**${text(name)}**\n\n${ahead?`あなたの前に **${ahead}人** が入室処理中です。`:'まもなく参加予告を始めます。'}\n\n告知が終わってから **${seconds}秒** 後に入室します。`);
}
export function panel(c) {
  return payload('✦  VOICE LOBBY',`**01**  ロビーVCに参加\n**02**  下のボタンから行き先を選択\n**03**  ${c.voice?'音声告知が終わってから':'参加予告から'} **${c.seconds}秒** で入室`,{components:[openButton()]});
}
export function countdownCard(name,remaining,total) {
  const bar='▰'.repeat(total-remaining)+'▱'.repeat(remaining);
  return payload('✧  まもなく入室',`**${text(name)}**\n\n# ${remaining} 秒\n${bar}\n\n相手のVCに参加を予告しています。`);
}
