import {SlashCommandBuilder,PermissionFlagsBits as P} from 'discord.js';
export const canConfigure=permissions=>permissions?.has(P.Administrator)===true;
export function commands() {
  return [new SlashCommandBuilder().setName('vc').setDescription('ロビーから参加するVCを選ぶ（あなただけに表示）'),
    new SlashCommandBuilder().setName('管理').setDescription('VC・音声・日程調整・卓とキャラシの管理画面を開く').setDefaultMemberPermissions(P.Administrator),
    new SlashCommandBuilder().setName('ゲーム').setDescription('ミニゲームで遊ぶ').addSubcommand(s=>s.setName('ブラックジャック').setDescription('ディーラーとブラックジャックで対戦する（あなただけに表示）'))];
}
