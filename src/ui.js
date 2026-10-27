import {EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags, escapeMarkdown} from 'discord.js';
import {adminCategories,adminDestinations} from './admin-navigation.js';
export async function acknowledgePrivate(i){
  if(i.deferred||i.replied)return;
  if(i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();
  else await i.deferReply({flags:MessageFlags.Ephemeral});
}
export const mentions={parse:[]};
export const text=value=>escapeMarkdown(String(value)).replace(/@/g,'＠').slice(0,100);
let botIcon=()=>undefined;
const footerDate=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'});
export function setBotIconProvider(provider){botIcon=provider;}
export function cardFooter(date=new Date()){
  const iconURL=botIcon();
  return {text:`created by あすとらる · ${footerDate.format(date)}`,...(iconURL?{iconURL}:{})};
}
// One mark and accent per feature; success/warning/error colors always win so status stays readable.
export const themes={
  menu:{icon:'✦',color:0x5865f2},voice:{icon:'🔊',color:0x3d8fd1},schedule:{icon:'📅',color:0x2b6fb1},
  densuke:{icon:'🗳️',color:0x2c9c8f},trpg:{icon:'📜',color:0xb5835a},game:{icon:'🎲',color:0x9791e0},admin:{icon:'⚙️',color:0x6f7d93},
};
const statusColors={success:0x29856d,error:0xc94f61,warning:0xb77920};
const namespaceThemes={menu:'menu',image:'menu',vc:'voice',read:'voice',profile:'voice',calendars:'schedule',schedule:'schedule',densuke:'densuke',trpg:'trpg',
  game:'game',bj:'game',casino:'game',rps:'game',four:'game',wallet:'game',chips:'game',work:'game',
  servers:'admin',admin:'admin',perf:'admin',restart:'admin',runtime:'admin',banner:'admin',updates:'admin',forum:'admin'};
export const themeForNamespace=namespace=>Object.hasOwn(namespaceThemes,namespace)?namespaceThemes[namespace]:undefined;
// Older titles carried their own marks; strip only known marks so user-provided names keep their emoji.
const legacyMarks=['✦','✧','♠','✊','🐔','📅'];
const marks=[...new Set([...legacyMarks,...Object.values(themes).map(t=>t.icon),'🃏','🎰','🪙','🟡'])];
const bareTitle=title=>{for(const mark of marks)if(title.startsWith(mark)&&/^\s/u.test(title.slice(mark.length)))return title.slice(mark.length).trimStart();return title;};
// Shared button rules: destructive labels read red, page/item steps get arrows. Links and existing emoji stay as built.
const destructiveLabel=label=>!/せず|一時停止/u.test(label)&&(/(削除|消去|停止|中断)(を確定|する|…)?$/u.test(label)||/(?<!検索を|条件を|選択をすべて|固定を|絞り込みを)解除(を確定|する|…)?$/u.test(label));
const stepLabel=/^(前|次)(へ|の(ページ|\d+件|\d+組|ZIP|予定|月|週))$/u;
function polishButton(button){
  const data=button?.data??button;
  if(data?.type!==ComponentType.Button||![ButtonStyle.Primary,ButtonStyle.Secondary].includes(data.style)||typeof data.label!=='string')return;
  const set=(key,value)=>{if(button.data)button[key==='style'?'setStyle':'setEmoji'](value);else data[key]=value;};
  if(destructiveLabel(data.label))set('style',ButtonStyle.Danger);
  const step=data.label.match(stepLabel);if(step&&!data.emoji)set('emoji',{name:step[1]==='前'?'◀️':'▶️'});
}
export function polishComponents(components){
  if(Array.isArray(components))for(const row of components)for(const item of (row?.components??[]))polishButton(item);
  return components;
}
export function polishMessage(message){
  if(message&&typeof message==='object')polishComponents(message.components);
  return message;
}
export function card(title,description,state='normal',{feature,icon}={}) {
  const theme=Object.hasOwn(themes,feature)?themes[feature]:undefined,mark=icon??theme?.icon,name=bareTitle(title);
  return new EmbedBuilder().setColor(statusColors[state]??theme?.color??themes.menu.color)
    .setTitle(mark?`${mark}  ${name}`:name).setDescription(description).setFooter(cardFooter());
}
export function payload(title,description,{state='normal',components=[],feature,icon}={}) {
  return {content:null,embeds:[card(title,description,state,{feature,icon})],components:polishComponents(components),allowedMentions:mentions};
}
export const themed=(feature,icon)=>({
  card:(title,description,state)=>card(title,description,state,{feature,icon}),
  payload:(title,description,options={})=>payload(title,description,{feature,icon,...options}),
});
export const adminHomeButton=()=>new ButtonBuilder().setCustomId('admin:open').setLabel('管理メニューへ').setStyle(ButtonStyle.Secondary);
export const adminSectionButton=id=>{
  const category=adminCategories.find(c=>c.id===id);if(!category)throw new Error('不明な管理カテゴリです。');
  return new ButtonBuilder().setCustomId(`admin:open-section:${id}`).setLabel(`${category.label}へ`).setStyle(ButtonStyle.Secondary);
};
export const adminFeatureButton=action=>{
  const destination=adminDestinations.find(d=>d.action===action);if(!destination)throw new Error('不明な管理操作です。');
  return new ButtonBuilder().setCustomId(`admin:open-feature:${action}`).setLabel(`${destination.label}を開く`).setStyle(ButtonStyle.Primary);
};
export const restartButton=()=>new ButtonBuilder().setCustomId('restart:open').setLabel('Botを再起動').setStyle(ButtonStyle.Secondary);
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
  return payload('✦  入室待ち',`**${text(name)}**\n\n${ahead?`順番待ち · あなたの前に **${ahead}人**`:'まもなく参加予告を始めます。'}\n告知の終了から **${seconds}秒後** に入室します。`,{feature:'voice'});
}
export function panel(c) {
  return payload('✦  VCに参加',`**ロビーに参加 → 入室先を選ぶ → 予告後に移動**\n\n${c.voice?'音声告知の終了から':'参加予告から'} **${c.seconds}秒後** に、選んだVCへ移動します。\n先にロビーVCへ参加してから、下のボタンを押してください。`,{components:[openButton(),personalReadingButton().addComponents(menuHomeButton())],feature:'voice'});
}
export function countdownCard(name,remaining,total) {
  const bar='▰'.repeat(total-remaining)+'▱'.repeat(remaining);
  return payload('✦  まもなく入室',`**${text(name)}**\n\nあと **${remaining}秒**\n${bar}\n\n参加予告が完了しました。入室までそのままお待ちください。`,{feature:'voice'});
}
