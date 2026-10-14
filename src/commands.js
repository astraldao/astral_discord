import {SlashCommandBuilder,PermissionFlagsBits as P} from 'discord.js';
export const canConfigure=permissions=>permissions?.has(P.Administrator)===true;
export function commands() {
  return [
    new SlashCommandBuilder().setName('vc').setDescription('入室するVCを選ぶ（自分だけに表示）'),
    new SlashCommandBuilder().setName('game').setDescription('ゲームで遊ぶ・自分のチップや履歴を確認する（自分だけに表示）'),
    new SlashCommandBuilder().setName('admin').setDescription('VC・音声・卓・日程調整・予定表・チップを管理する（管理者専用）').setDefaultMemberPermissions(P.Administrator),
  ];
}

const retiredCommands=new Set(['vc-panel','vc設定','管理','ゲーム','chips']);

export async function registerCommands(guild){
  // Keep existing commands until every replacement has registered successfully.
  for(const command of commands())await guild.commands.create(command.toJSON());
  for(const old of (await guild.commands.fetch()).values())if(retiredCommands.has(old.name))await old.delete();
}
