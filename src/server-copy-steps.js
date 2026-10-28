const labels={
 'reset-onboarding':'サブの既存オンボーディングを空にする', 'reset-welcome':'サブの既存ウェルカム画面を空にする',
 'reset-staging':'コミュニティ必須チャンネルの退避先を作る', 'reset-references':'サブのチャンネル参照を退避する',
 'reset-automod':'サブの既存AutoModを削除する', 'reset-protected-automod':'削除できない標準AutoModを一時無効化して参照を解除する', 'reset-sound':'サブの既存サウンドを削除する',
 'reset-sticker':'サブの既存スタンプを削除する', 'reset-emoji':'サブの既存絵文字を削除する',
 'reset-channel':'サブの既存チャンネルを削除する', 'reset-role':'サブの既存通常ロールを削除する',
 'reset-images':'サブの既存サーバー画像を空にする', 'reset-staging-delete':'一時退避チャンネルを削除する',
 everyone:'サブの@everyone権限を設定する',role:'サブにロールを作る','role-order':'サブのロール順を設定する',
 emoji:'サブに絵文字を作る',sticker:'サブにスタンプを作る',sound:'サブにサウンドを作る',image:'サブのサーバー画像を設定する',
 channel:'サブにチャンネルを作る',automod:'サブにAutoMod設定をコピーする',settings:'サブの基本設定を更新する',
 welcome:'サブのウェルカム画面を設定する',onboarding:'サブのオンボーディングを設定する',response:'操作画面を更新する'
};
const withId=new Set(['reset-automod','reset-protected-automod','reset-sound','reset-sticker','reset-emoji','reset-channel','reset-role','reset-staging-delete','role','emoji','sticker','sound','channel','automod']);
export function copyStepInfo(operation){if(typeof operation!=='string')return {key:'unknown',phase:'unknown',label:'処理の確認'};const [key,arg,...rest]=operation.split(':');if(!Object.hasOwn(labels,key)||rest.length||withId.has(key)&&!/^\d{17,20}$/.test(arg??'')||key==='image'&&!['icon','banner','splash','discoverySplash'].includes(arg)||!withId.has(key)&&key!=='image'&&arg!==undefined)return {key:'unknown',phase:'unknown',label:'処理の確認'};return {key,phase:key==='response'?'interaction-response':`sub-${key}`,label:labels[key]};}
const count=x=>Array.isArray(x)?x.length:x instanceof Map?x.size:null;
export const emptyOnboarding=o=>!!o&&o.enabled===false&&o.mode===0&&count(o.prompts)===0&&count(o.defaultChannels)===0;
export const emptyWelcome=w=>!w||w.enabled===false&&!w.description&&count(w.channels??w.welcomeChannels)===0;

export const copyStepLabel=key=>Object.hasOwn(labels,key)?labels[key]:'処理の確認';
export const isCopyStep=key=>key==='unknown'||Object.hasOwn(labels,key);

export const storedCopyStep=key=>key==='reset-protected-automod'?'reset-automod':key;
