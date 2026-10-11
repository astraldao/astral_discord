import {EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown} from 'discord.js';
export const mentions={parse:[]};
export const text=value=>escapeMarkdown(String(value)).replace(/@/g,'＠').slice(0,100);
const colors={normal:0x8886e8,success:0x69bba8,error:0xd38da3};
export function card(title,description,state='normal') {
  return new EmbedBuilder().setColor(colors[state])
    .setTitle(title).setDescription(description);
}
export function payload(title,description,{state='normal',components=[]}={}) {
  return {content:null,embeds:[card(title,description,state)],components,allowedMentions:mentions};
}
export const openButton=()=>new ActionRowBuilder().addComponents(new ButtonBuilder()
  .setCustomId('vc:open').setLabel('入室するVCを選ぶ').setStyle(ButtonStyle.Primary));
export const cancelButton=job=>new ActionRowBuilder().addComponents(new ButtonBuilder()
  .setCustomId(`vc:cancel:${job.interaction.id}`).setLabel('入室をキャンセル').setStyle(ButtonStyle.Secondary));
export function choiceNavigation(page,pages) {
  const refresh=new ButtonBuilder().setCustomId(`vc:page:${page}`).setLabel('空き状況を更新').setStyle(ButtonStyle.Secondary);
  return new ActionRowBuilder().addComponents(...(pages>1?[
    new ButtonBuilder().setCustomId(`vc:page:${page-1}`).setLabel('前のページ').setStyle(ButtonStyle.Secondary).setDisabled(page===0),
    refresh,
    new ButtonBuilder().setCustomId(`vc:page:${page+1}`).setLabel('次のページ').setStyle(ButtonStyle.Secondary).setDisabled(page>=pages-1)]:[refresh]));
}
export function waitingCard(name,ahead,seconds) {
  return payload('✦  入室待ち',`**${text(name)}**\n\n${ahead?`順番待ち · あなたの前に **${ahead}人**`:'まもなく参加予告を始めます。'}\n告知の終了から **${seconds}秒後** に入室します。`);
}
export function panel(c) {
  return payload('✦  VCに参加',`**1**  ロビーVCに参加する\n**2**  下のボタンで入室先を選ぶ\n**3**  ${c.voice?'音声告知の終了から':'参加予告から'} **${c.seconds}秒後** に入室`,{components:[openButton()]});
}
export function countdownCard(name,remaining,total) {
  const bar='▰'.repeat(total-remaining)+'▱'.repeat(remaining);
  return payload('✦  まもなく入室',`**${text(name)}**\n\nあと **${remaining}秒**\n${bar}\n\n参加予告が完了しました。入室までそのままお待ちください。`);
}
