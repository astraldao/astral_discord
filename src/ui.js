import {EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown} from 'discord.js';
export const mentions={parse:[]};
export const text=value=>escapeMarkdown(String(value)).replace(/@/g,'＠').slice(0,100);
let botIcon=()=>undefined;
const footerDate=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'});
export function setBotIconProvider(provider){botIcon=provider;}
export function cardFooter(date=new Date()){
  const iconURL=botIcon();
  return {text:`created by あすとらる · ${footerDate.format(date)}`,...(iconURL?{iconURL}:{})};
}
const colors={normal:0x5865f2,success:0x29856d,error:0xc94f61,warning:0xb77920};
export function card(title,description,state='normal') {
  return new EmbedBuilder().setColor(colors[state])
    .setTitle(title.replace(/^[✦✧]\s+/u,'')).setDescription(description).setFooter(cardFooter());
}
export function payload(title,description,{state='normal',components=[]}={}) {
  return {content:null,embeds:[card(title,description,state)],components,allowedMentions:mentions};
}
export const adminHomeButton=()=>new ButtonBuilder().setCustomId('admin:open').setLabel('管理メニューへ').setStyle(ButtonStyle.Secondary);
export const menuHomeButton=()=>new ButtonBuilder().setCustomId('menu:open').setLabel('メニューへ').setStyle(ButtonStyle.Secondary);
export const personalReadingButton=()=>new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('profile:open').setLabel('自分の読み方').setStyle(ButtonStyle.Secondary));
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
  return payload('✦  VCに参加',`**ロビーに参加 → 入室先を選ぶ → 予告後に移動**\n\n${c.voice?'音声告知の終了から':'参加予告から'} **${c.seconds}秒後** に、選んだVCへ移動します。\n先にロビーVCへ参加してから、下のボタンを押してください。`,{components:[openButton(),personalReadingButton().addComponents(menuHomeButton())]});
}
export function countdownCard(name,remaining,total) {
  const bar='▰'.repeat(total-remaining)+'▱'.repeat(remaining);
  return payload('✦  まもなく入室',`**${text(name)}**\n\nあと **${remaining}秒**\n${bar}\n\n参加予告が完了しました。入室までそのままお待ちください。`);
}
