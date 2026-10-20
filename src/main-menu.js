import {ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,MessageFlags,PermissionFlagsBits as P} from 'discord.js';
import {payload,menuHomeButton,adminHomeButton} from './ui.js';
const row=(...buttons)=>new ActionRowBuilder().addComponents(...buttons);
const button=(action,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`menu:${action}`).setLabel(label).setStyle(style);
const destinations={
  vc:{label:'VCに入る',summary:'ロビーから入室先を選ぶ',guide:'1. ロビーVCへ参加します。\n2. 「VCに入る」で入室先を選びます。\n3. 参加予告のあと、選んだVCへ移動します。\n\nロビーが分からない場合は、VC画面の案内を確認してください。'},
  read:{label:'読み上げ',summary:'このチャンネルの投稿をVCで聞く',guide:'1. 聞きたいVCへ参加します。\n2. 読みたいテキストチャンネルで、読み上げ画面を開きます。\n3. 「このチャンネルで開始」を押します。\n\n画面を開くだけでは開始しません。一時停止・待機分の消去・停止も、読み上げ画面で操作できます。'},
  game:{label:'ゲーム',summary:'ゲームを選ぶ・続きを遊ぶ',guide:'「ゲーム」から遊びたいものを選びます。進行中のブラックジャックがあれば「続きから遊ぶ」で戻れます。\n\nチップを使うゲームや、チップを渡す操作もここから開けます。'},
  calendar:{label:'予定表',summary:'このチャンネルの共有予定を見る',guide:'1. 「予定表」で、このチャンネルに共有された予定表を選びます。\n2. 「週間」「今日から30日」などに切り替えて、予定を確認できます。\n3. 日付や予定を選ぶと、時刻・場所・説明が開きます。\n\n「検索・取り出し」で予定を探したり、ICSファイルを保存したりできます。予定の追加・共有は管理者が /admin から操作します。'},
  profile:{label:'自分の読み方',summary:'名前をどう読み上げるか設定する',guide:'「自分の読み方」で、名前の読み方を入力して保存します。VC入室時の音声告知に使われる設定です。\n\n個人設定は本人だけが変更できます。'},
  wallet:{label:'自分のチップ',summary:'残高と利用履歴を確認する',guide:'「自分のチップ」で、残高や「チップの履歴」を確認できます。\n\n「チップを渡す」から、相手と枚数を確認して譲渡できます。'},
};
const destination=value=>typeof value==='string'&&Object.hasOwn(destinations,value);
class MenuUiError extends Error{}
export function mainMenuScreen({admin=false,recent=[]}={}){
  const items=[...new Set(recent.filter(destination))].slice(0,3);
  return {...payload('メニュー','**やりたいことを選んでください**\n\n**VCに入る** · ロビーから行き先を選ぶ\n**読み上げ** · このチャンネルの投稿を、参加中のVCで聞く\n**ゲーム** · 無料ゲーム・チップゲームで遊ぶ\n**予定表** · このチャンネルの共有予定を見る\n\n初めての操作は「使い方」で確認できます。',{components:[
    row(button('vc','VCに入る',ButtonStyle.Primary),button('read','読み上げ'),button('game','ゲーム'),button('calendar','予定表')),
    row(button('profile','自分の読み方'),button('wallet','自分のチップ'),button('help','使い方')),
    ...(items.length?[row(new StringSelectMenuBuilder().setCustomId('menu:recent').setPlaceholder('最近使った機能を開く').addOptions(...items.map(value=>({value,label:destinations[value].label,description:destinations[value].summary}))))]:[]),
    ...(admin?[row(adminHomeButton())]:[]),
  ]}),attachments:[]};
}
export function mainMenuGuideScreen(topic){
  const selected=destination(topic)?destinations[topic]:null;
  return {...payload(selected?`使い方 · ${selected.label}`:'使い方',selected?selected.guide:'操作の手順を選んでください。\n\n普段は **/menu**、管理者の設定は **/admin** から開きます。\nどの機能も、まず画面で内容を確認できます。',{components:[
    row(new StringSelectMenuBuilder().setCustomId('menu:help-topic').setPlaceholder('知りたい操作を選ぶ').addOptions(...Object.entries(destinations).map(([value,item])=>({value,label:item.label,description:item.summary,default:value===topic})))),
    row(...(selected?[button(topic,`${selected.label}を開く`,ButtonStyle.Primary)]:[]),menuHomeButton()),
  ]}),attachments:[]};
}
export function createMainMenu({guild,openVc,openRead,openGame,openProfile,openWallet,openCalendar,now=()=>Date.now(),access=async i=>{
  const [member,channel]=await Promise.all([guild.members.fetch({user:i.user.id,force:true}),guild.channels.fetch(i.channelId,{force:true})]);
  if(!channel?.permissionsFor(member)?.has(P.ViewChannel))throw new MenuUiError('このチャンネルの閲覧権限を確認してください。');
  return {admin:member.permissions.has(P.Administrator)};
}}){
  // Destination names only. Never retain message text, controller state or results.
  const recent=new Map(),ttl=10*60*1000,limit=200;
  const key=i=>JSON.stringify([i.channelId,i.user.id]);
  const history=i=>{const stamp=now();for(const [id,entry] of recent)if(entry.expires<=stamp)recent.delete(id);return recent.get(key(i))?.items??[];};
  const remember=(i,action)=>{
    const items=[action,...history(i).filter(item=>item!==action)].slice(0,3),id=key(i);
    recent.delete(id);recent.set(id,{items,expires:now()+ttl});
    while(recent.size>limit)recent.delete(recent.keys().next().value);
  };
  return {async handle(i){try{
    if(!i.deferred&&!i.replied){if(i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});}
    const click=i.customId?.match(/^menu:(open|vc|read|game|stop|profile|wallet|calendar|help|help-topic|recent)$/);
    if(i.customId&&!click)throw new MenuUiError('メニューを開き直してください。');
    let action=click?.[1]??i.options?.getString('操作')??'open';
    if(!['open','vc','read','game','stop','profile','wallet','calendar','help','help-topic','recent'].includes(action))throw new MenuUiError('操作を選び直してください。');
    const permission=await access(i);
    if(!permission)throw new MenuUiError('このチャンネルの閲覧権限を確認してください。');
    if(action==='recent'){
      if(i.values?.length!==1||!history(i).includes(i.values[0]))throw new MenuUiError('最近使った機能の表示が変わりました。メニューを開き直してください。');
      action=i.values[0];
    }
    if(action==='open')await i.editReply(mainMenuScreen({...permission,recent:history(i)}));
    else if(action==='help')await i.editReply(mainMenuGuideScreen());
    else if(action==='help-topic'){
      if(i.values?.length!==1||!destination(i.values[0]))throw new MenuUiError('知りたい操作を選び直してください。');
      await i.editReply(mainMenuGuideScreen(i.values[0]));
    }
    else if(action==='vc')await openVc(i);
    else if(action==='game')await openGame(i);
    else if(action==='profile')await openProfile(i);
    else if(action==='wallet')await openWallet(i);
    else if(action==='calendar')await openCalendar(i);
    else await openRead(i,action==='stop'?'stop':'status');
    if(destination(action))remember(i,action);
  }catch(error){const message={...payload('メニュー',error instanceof MenuUiError?error.message:'操作を完了できませんでした。メニューから開き直してください。',{state:'error',components:[row(menuHomeButton())]}),attachments:[]};if(i.deferred||i.replied)await i.editReply(message);else await i.reply({...message,flags:MessageFlags.Ephemeral});}}};
}
