import {SlashCommandBuilder,PermissionFlagsBits as P} from 'discord.js';
export const canConfigure=permissions=>permissions?.has(P.Administrator)===true;
export function commands() {
  return [new SlashCommandBuilder().setName('vc').setDescription('入室先を選ぶ'),
    new SlashCommandBuilder().setName('管理').setDescription('管理者用の設定画面を開く').setDefaultMemberPermissions(P.Administrator)];
}
