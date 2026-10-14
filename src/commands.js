import {SlashCommandBuilder,PermissionFlagsBits as P} from 'discord.js';
export const canConfigure=permissions=>permissions?.has(P.Administrator)===true;
export function commands() {
  return [new SlashCommandBuilder().setName('vc').setDescription('ロビーから参加するVCを選ぶ（あなただけに表示）'),
    new SlashCommandBuilder().setName('admin').setDescription('VC・音声・卓・日程調整・予定表・チップを管理').setDefaultMemberPermissions(P.Administrator),
    new SlashCommandBuilder().setName('game').setDescription('チップゲーム・無料ゲームを選ぶ（あなただけに表示）'),
    new SlashCommandBuilder().setName('chips').setDescription('自分のチップ・直近20件・ゲームの記録を確認（非公開）')];
}

export async function registerCommands(guild){
  for(const command of commands())await guild.commands.create(command.toJSON());
  for(const old of (await guild.commands.fetch()).values())if(['vc-panel','vc設定','管理','ゲーム'].includes(old.name))await old.delete();
}
