export const menuDestinations={
  vc:{label:'VCに入る',summary:'ロビーから入室先を選ぶ',guide:'1. ロビーVCへ参加します。\n2. 「VCに入る」で入室先を選びます。\n3. 参加予告のあと、選んだVCへ移動します。\n\nロビーが分からない場合は、VC画面の案内を確認してください。'},
  read:{label:'読み上げ',summary:'このチャンネルの投稿をVCで聞く',guide:'1. 聞きたいVCへ参加します。\n2. 読みたいテキストチャンネルで、読み上げ画面を開きます。\n3. 「このチャンネルで開始」を押します。\n\n画面を開くだけでは開始しません。一時停止・待機分の消去・停止も、読み上げ画面で操作できます。'},
  game:{label:'ゲーム',summary:'ゲームを選ぶ・続きを遊ぶ',guide:'「ゲーム」から遊びたいものを選びます。進行中のブラックジャックがあれば「続きから遊ぶ」で戻れます。\n\nチップを使うゲームや、チップを渡す操作もここから開けます。'},
  calendar:{label:'予定表',summary:'このチャンネルの共有予定を見る',guide:'1. 「予定表」で、このチャンネルに共有された予定表を選びます。\n2. 「週間」「今日から30日」などに切り替えて、予定を確認できます。\n3. 日付や予定を選ぶと、時刻・場所・説明が開きます。\n\n「検索・取り出し」で予定を探したり、ICSファイルを保存したりできます。予定の追加・共有は管理者が /admin から操作します。'},
  workshop:{label:'画像工房',summary:'画像を絵文字・スタンプ・共有用に整形',guide:'1. 「画像を選ぶ」からPNG・JPEGを1枚アップロードします。\n2. 用途と、全体を残すか切り抜く位置を選びます。\n3. 「画像を作成」で完成画像を確認し、添付を保存します。\n\n4MiB・約400万画素以内。完成画像は本人だけに表示し、サーバーへの自動登録や公開投稿は行いません。'},
  profile:{label:'自分の読み方',summary:'名前をどう読み上げるか設定する',guide:'「自分の読み方」で、名前の読み方を入力して保存します。VC入室時の音声告知に使われる設定です。\n\n個人設定は本人だけが変更できます。'},
  wallet:{label:'自分のチップ',summary:'残高と利用履歴を確認する',guide:'「自分のチップ」で、残高や「チップの履歴」を確認できます。\n\n「チップを渡す」から、相手と枚数を確認して譲渡できます。'},
};
export const isMenuDestination=value=>typeof value==='string'&&Object.hasOwn(menuDestinations,value);

export const menuTaskDetails={
  vc:{prepare:'先にロビーVCへ参加してください。',effect:'入室先を選ぶと、参加予告と待機の後に移動します。待機中はキャンセルできます。'},
  read:{prepare:'聞きたいVCに参加し、読みたいテキストチャンネルで開いてください。',effect:'開始ボタンを押した後の投稿を読みます。メニューへ戻っても続き、停止・再起動で終了します。'},
  game:{prepare:'無料ゲームはチップ不要。チップゲームは最低10枚からです。',effect:'ゲームを選ぶだけではチップを使いません。勝負開始時に使い、進行中のゲームは続きへ戻れます。'},
  calendar:{prepare:'共有投稿のあるテキストチャンネルで開きます。',effect:'閲覧・検索・ICS保存ができます。編集は管理者用の画面から行います。'},
  workshop:{prepare:'PNG・JPEGを1枚用意してください。Botには送信・埋め込み・ファイル添付権限が必要です。',effect:'選択だけでは変換しません。作成後に画像を保存できます。保持画像は操作終了・10分期限・再起動で破棄します。'},
  profile:{prepare:'かな・長音で自分の名前の読み方を用意します。',effect:'保存後、次の入室告知から反映します。解除すると辞書による自動の読み方へ戻ります。'},
  wallet:{prepare:'自分の残高・履歴を確認できます。譲渡は相手と枚数を確認してください。',effect:'履歴は取得時点の内容です。最新の情報は更新ボタンで再取得できます。'},
  dice:{prepare:'1D100などのダイスや「サイゼロール」をこのチャンネルへ投稿します。',effect:'結果は元の投稿への返信です。ゲーム内のチップを賭けるダイスとは別で、チップは使いません。'},
};

export const menuTroubleshooting={
 vc:'ロビーに参加してから開き直してください。入室先が表示されない場合は、管理者がVC設定と動作診断を確認します。',
 read:'VCへの参加と、このチャンネルで読み上げを開始したかを確認してください。開始できない場合は管理者の動作診断を使います。',
 game:'進行中のゲームは「続きから遊ぶ」で戻れます。チップ不足の場合は残高を確認してください。',
 calendar:'このチャンネルに共有投稿があるかを確認してください。見つからない場合は管理者が予定表の投稿を管理します。',
 workshop:'画像を小さくして選び直してください。音声の処理中は終了を待ちます。権限不足は管理者へ確認してください。',
 profile:'保存後の表示を確認してください。読み方は入室告知用で、投稿本文の辞書とは異なります。',
 wallet:'残高と利用履歴を確認してください。譲渡は相手と枚数の確認後に確定します。',
};

export const diceGuideParts={
  basic:'このチャンネルへ 1D100・1D4,3D10・1d10ふって・ダメージ 3D10 などを投稿します。「お風呂の温度は1D100度！！」のような、温度や点数を決める宣言にも対応します。',
  advanced:'(2d6+3)*2＝計算\n4d6kh3／kl3＝高い／低い3個\n1d20を有利で／不利で＝2個から採用\n4d6r1＝1を一度だけ振り直し\n1d6!＝最大値で追加\n5d10cs>=8＝成功数\n1d100<=70＝成功・失敗\n\n振り直し前と除外した値も残します。追加抽選に上限があります。',
  saize:'「サイゼロール」「サイゼロールして」なら (1D3)(1D4)0(1D10) を連結した番号を返します（末尾の10は0に変換）。料理名も見たいときだけ「!サイゼロール」と投稿してください。2024年6月の参照表を使い、!なしでは料理名を出しません。',
  limits:'結果は元の投稿への返信です。通常の文章は30文字未満が対象です（式だけの投稿は例外）。明確な依頼はその場で判定し、関連する曖昧な短文だけ、設定済みのJevへ送ります。説明・引用・否定は見送ります。',
};
export const menuGuideTopics={...menuDestinations,dice:{label:'チャットダイス',summary:'計算式・採用指定・成功数にも対応',guide:Object.values(diceGuideParts).join('\n\n')}};
menuTroubleshooting.dice='通常投稿で反応しない場合は @Bot 1D100 を試してください。管理者が動作診断で通常投稿への対応状況とON/OFFを確認できます。';
export function menuHelpViews(topic){
  if(typeof topic!=='string'||!Object.hasOwn(menuGuideTopics,topic))return {};
  const item=menuGuideTopics[topic],task=menuTaskDetails[topic];
  return {steps:{label:'手順',body:topic==='dice'?`${diceGuideParts.basic}\n\n${diceGuideParts.limits}`:item.guide},
    ...(topic==='dice'?{advanced:{label:'高度なダイス',body:`${diceGuideParts.advanced}\n\n${diceGuideParts.limits}`},saize:{label:'サイゼロール',body:`${diceGuideParts.saize}\n\n${diceGuideParts.limits}`}}:{}),
    before:{label:'準備・反映・終了',body:`**使う前に**\n${task.prepare}\n\n**反映・終了**\n${task.effect}`},
    trouble:{label:'うまく動かないとき',body:menuTroubleshooting[topic]}};
}

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
