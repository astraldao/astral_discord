import {SlashCommandBuilder, ChannelType, PermissionFlagsBits as P} from 'discord.js';
const vc=(s)=>s.addChannelOption(o=>o.setName('チャンネル').setDescription('通常のボイスチャンネル').addChannelTypes(ChannelType.GuildVoice).setRequired(true));
export function commands() {
  const settings=new SlashCommandBuilder().setName('vc設定').setDescription('入室ロビーの設定').setDefaultMemberPermissions(P.ManageGuild)
    .addSubcommand(s=>vc(s.setName('ロビー').setDescription('入室ロビーを指定')))
    .addSubcommand(s=>vc(s.setName('行き先追加').setDescription('入室候補にVCを追加')))
    .addSubcommand(s=>vc(s.setName('行き先削除').setDescription('入室候補からVCを削除')))
    .addSubcommand(s=>s.setName('一覧').setDescription('現在の設定を確認'))
    .addSubcommand(s=>s.setName('待機秒数').setDescription('予告後の待機時間を設定').addIntegerOption(o=>o.setName('秒').setDescription('3〜15秒').setMinValue(3).setMaxValue(15).setRequired(true)))
    .addSubcommand(s=>s.setName('通知音').setDescription('ずんだもんの音声告知を有効・無効にする').addBooleanOption(o=>o.setName('有効').setDescription('名前をずんだもんで告知').setRequired(true)))
    .addSubcommand(s=>s.setName('音量').setDescription('告知の音量を設定').addIntegerOption(o=>o.setName('パーセント').setDescription('10〜60、初期値30').setMinValue(10).setMaxValue(60).setRequired(true)))
    .addSubcommand(s=>s.setName('直接入室').setDescription('候補VCへの直接入室を制御').addBooleanOption(o=>o.setName('許可').setDescription('true:直接入室可 / false:検出後ロビーへ戻す').setRequired(true)))
    .addSubcommand(s=>s.setName('パネル設置').setDescription('ロビーVCに入室パネルを設置・更新'))
    .addSubcommand(s=>s.setName('辞書登録').setDescription('名前や英単語の読みを登録・上書き')
      .addStringOption(o=>o.setName('単語').setDescription('表示名全体または英単語').setMaxLength(32).setRequired(true))
      .addStringOption(o=>o.setName('読み').setDescription('ひらがな・カタカナの読み方').setMaxLength(40).setRequired(true)))
    .addSubcommand(s=>s.setName('辞書削除').setDescription('登録した読み方を削除')
      .addStringOption(o=>o.setName('単語').setDescription('登録した表示名または英単語').setMaxLength(32).setRequired(true)))
    .addSubcommand(s=>s.setName('辞書一覧').setDescription('登録した読み方を確認'));
  return [new SlashCommandBuilder().setName('vc').setDescription('入室先を選ぶ'),settings];
}
