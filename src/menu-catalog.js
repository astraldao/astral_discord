export const menuDestinations={
  vc:{label:'VCに入る',summary:'ロビーから入室先を選ぶ',guide:'1. ロビーVCへ参加します。\n2. 「VCに入る」で入室先を選びます。\n3. 参加予告のあと、選んだVCへ移動します。\n\nロビーが分からない場合は、VC画面の案内を確認してください。'},
  read:{label:'読み上げ',summary:'このチャンネルの投稿をVCで聞く',guide:'1. 聞きたいVCへ参加します。\n2. 読みたいテキストチャンネルで、読み上げ画面を開きます。\n3. 「このチャンネルで開始」を押します。\n\n画面を開くだけでは開始しません。一時停止・待機分の消去・停止も、読み上げ画面で操作できます。'},
  game:{label:'ゲーム',summary:'ゲームを選ぶ・続きを遊ぶ',guide:'「ゲーム」から遊びたいものを選びます。進行中のブラックジャックがあれば「続きから遊ぶ」で戻れます。\n\nチップを使うゲームや、チップを渡す操作もここから開けます。'},
  calendar:{label:'予定表',summary:'このチャンネルの共有予定を見る',guide:'1. 「予定表」で、このチャンネルに共有された予定表を選びます。\n2. 「週間」「今日から30日」などに切り替えて、予定を確認できます。\n3. 日付や予定を選ぶと、時刻・場所・説明が開きます。\n\n「検索・取り出し」で予定を探したり、ICSファイルを保存したりできます。予定の追加・共有は管理者が /admin から操作します。'},
  profile:{label:'自分の読み方',summary:'名前をどう読み上げるか設定する',guide:'「自分の読み方」で、名前の読み方を入力して保存します。VC入室時の音声告知に使われる設定です。\n\n個人設定は本人だけが変更できます。'},
  wallet:{label:'自分のチップ',summary:'残高と利用履歴を確認する',guide:'「自分のチップ」で、残高や「チップの履歴」を確認できます。\n\n「チップを渡す」から、相手と枚数を確認して譲渡できます。'},
};
export const isMenuDestination=value=>typeof value==='string'&&Object.hasOwn(menuDestinations,value);

export const menuTroubleshooting={
 vc:'ロビーに参加してから開き直してください。入室先が表示されない場合は、管理者がVC設定と動作診断を確認します。',
 read:'VCへの参加と、このチャンネルで読み上げを開始したかを確認してください。開始できない場合は管理者の動作診断を使います。',
 game:'進行中のゲームは「続きから遊ぶ」で戻れます。チップ不足の場合は残高を確認してください。',
 calendar:'このチャンネルに共有投稿があるかを確認してください。見つからない場合は管理者が予定表の投稿を管理します。',
 profile:'保存後の表示を確認してください。読み方は入室告知用で、投稿本文の辞書とは異なります。',
 wallet:'残高と利用履歴を確認してください。譲渡は相手と枚数の確認後に確定します。',
};

export const menuGuideTopics={...menuDestinations,dice:{label:'チャットダイス',summary:'投稿した1D100などへ結果を返信',guide:'このチャンネルへ 1D100・1D4,3D10・ダメージ 3D10 などを投稿します。結果は元の投稿への返信です。意味を尋ねる質問・説明・引用・否定には反応しません。外部AIへ本文を送りません。'}};
menuTroubleshooting.dice='通常投稿で反応しない場合は @Bot 1D100 を試してください。管理者が動作診断で通常投稿への対応状況とON/OFFを確認できます。';

// Keep runtime guidance to three booleans; no arbitrary service state enters a card.
export function menuCapabilities(value){
  const raw=value??{};
  return Object.fromEntries(['readingEnabled','diceEnabled','diceFullContent'].filter(key=>typeof raw[key]==='boolean').map(key=>[key,raw[key]]));
}
export function menuCapabilityNote(topic,value){
  const state=menuCapabilities(value);
  if(topic==='read'&&state.readingEnabled===false)return '**現在は未有効です。** 管理者に有効化を依頼してください。';
  if(topic==='dice'){
    if(state.diceEnabled===false)return '**現在はOFFです。** 管理者が設定でダイス返信をONにすると利用できます。';
    if(state.diceFullContent===false)return '**現在はBotへのメンションが必要です。** @Bot 1D100 のように投稿してください。';
    if(state.diceFullContent===true)return '**通常の投稿から利用できます。** Botをメンションする必要はありません。';
  }
  return '';
}
