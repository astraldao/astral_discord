import {SlashCommandBuilder,PermissionFlagsBits as P} from 'discord.js';
export const canConfigure=permissions=>permissions?.has(P.Administrator)===true;
export function commands() {
  return [new SlashCommandBuilder().setName('vc').setDescription('ロビーから参加するVCを選ぶ（あなただけに表示）'),
    new SlashCommandBuilder().setName('admin').setDescription('VC・音声・日程調整・卓とキャラシの管理画面を開く').setDefaultMemberPermissions(P.Administrator),
    new SlashCommandBuilder().setName('game').setDescription('ゲーム選択画面を開く（あなただけに表示）')];
}

export async function registerCommands(guild){
  for(const command of commands())await guild.commands.create(command.toJSON());
  for(const old of (await guild.commands.fetch()).values())if(['vc-panel','vc設定','管理','ゲーム'].includes(old.name))await old.delete();
}
