import {SlashCommandBuilder,PermissionFlagsBits as P} from 'discord.js';
import {adminDestinations} from './admin-navigation.js';
export const canConfigure=permissions=>permissions?.has(P.Administrator)===true;
export function commands() {
  return [
    new SlashCommandBuilder().setName('menu').setDescription('VC・読み上げ・ゲーム・予定表を開く（自分だけに表示）').addStringOption(option=>option.setName('操作').setDescription('直接開く操作を選ぶ。省略するとメニューを表示').addChoices({name:'VCに入る',value:'vc'},{name:'読み上げを開く',value:'read'},{name:'ゲームを開く',value:'game'},{name:'このチャンネルの予定表',value:'calendar'},{name:'読み上げを停止',value:'stop'},{name:'自分の読み方',value:'profile'},{name:'自分のチップ',value:'wallet'})),
    new SlashCommandBuilder().setName('admin').setDescription('サーバーの設定・予定表・Botの更新を管理する（管理者専用）').setDefaultMemberPermissions(P.Administrator).addStringOption(option=>option.setName('操作').setDescription('設定を直接開く。省略すると管理メニューを表示').addChoices(...adminDestinations.map(d=>({name:`${d.categoryLabel} / ${d.label}`,value:d.action})))),
  ];
}

const retiredCommands=new Set(['vc','game','read','vc-panel','vc設定','管理','ゲーム','chips']);

export async function registerCommands(guild){
  // Keep existing commands until every replacement has registered successfully.
  for(const command of commands())await guild.commands.create(command.toJSON());
  for(const old of (await guild.commands.fetch()).values())if(retiredCommands.has(old.name))await old.delete();
}
