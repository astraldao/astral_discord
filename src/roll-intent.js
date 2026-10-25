// Finite, local language rules: no conversation history or external text service.
const roots=['振って','ふって','フッテ','回して','まわして','転がして','ころがして','ロールして','ろーるして','して'];
const politePositive=['くれる','もらえる','くれますか','もらえますか','いただけますか','いただける','くれるかな','もらえるかな','くれませんか','もらえませんか','いただけませんか','もらっていい'];
const politeQuestionOnly=['くれない','もらえない','いただけない'];
export function requestSource(content){
  if(typeof content!=='string'||content.length>1000)return null;
  const protectedFree=content.normalize('NFKC').replace(/```[\s\S]*?(?:```|$)|`[^`]*(?:`|$)|\|\|[\s\S]*?(?:\|\||$)|!?\[[^\]\n]*\]\(https?:\/\/[^)\n]*(?:\)|$)/g,' '),lines=[];
  for(const line of protectedFree.split('\n')){if(/^\s*>>>/.test(line))break;if(!/^\s*>/.test(line))lines.push(line);}
  let source=lines.join(' ').replace(/https?:\/\/\S+/g,' ').trim();
  if(/[「」『』"“”]/u.test(source))return null;
  const question=source.endsWith('?');
  if(source.includes('?')&&(!question||source.indexOf('?')!==source.length-1))return null;
  if(question)source=source.slice(0,-1).trimEnd();
  const compact=source.replace(/\s+/g,''),ending=[...politePositive,...(question?politeQuestionOnly:[])].find(end=>source.endsWith(end)&&roots.some(root=>compact.endsWith(root+end)));
  if(question&&!ending)return null;
  // Only a complete delegated request licenses the polite negative question.
  // Remove its ending before the ordinary negation/permission guards run.
  if(ending)source=source.slice(0,-ending.length).trimEnd()+'ください';
  if(!source||/(?:ない|ません|なかった|なくて|なければ|振らな|振りませ|振るな|振らず|振らなく|ロールしな|回さな|しない|しなく|不要|禁止|やめ|例|説明|ルール|期待値|平均|確率|意味|とは|って何|場合|なら|仮に|と言|とい[うわ]|らしい|そうです|でした|振った|振りました|振っても|できる|可能|コード|not\b|don't\b|example\b|what\b|how\b)/iu.test(source))return null;
  return source;
}
const requests=['お願い','お願いします','おねがい','おねがいします','よろしく','頼む','たのむ','ください','下さい','くれ','くれる','もらえる','ちょうだい','ほしい','欲しい','ほしいです','欲しいです','ほしいな','欲しいな','ね','して','する','します',...roots,
  '振る','ふる','フル','振ります','ふります','回す','まわす','転がす','ころがす','roll','please'];
const diceWords=[...new Set([...requests,'ダイス','だいす','サイコロ','さいころ','ロール','ろーる','判定','はんてい','ダメージ','だめーじ','回復','かいふく','幸運','san','技能','目星','めぼし','聞き耳','ききみみ','図書館','としょかん','アイデア','知識','回避','応急手当','説得','信用','心理学','隠密','探索','命中','攻撃','チェック','正気度','成功判定','を','で','の','に','は','じゃあ','では','次は','今回は','ちょっと','もう一度','結果','教えて','出して'].map(word=>word.toLowerCase()))];
const saizeWords=[...new Set([...requests,'を'].map(word=>word.toLowerCase()))];
const tails=[...roots,'お願い','お願いします','おねがい','おねがいします','よろしく','頼む','たのむ','ください','下さい','くれ','ちょうだい','ね'];
function compactWords(text){
  let compact=text.replace(/<@!?\d{17,20}>/g,' ').replace(/[\s,、。!！:：・/\[\]()]+/g,'').toLowerCase();
  const short=compact.replace(/[ー〜~]+$/u,'');
  if(short&&tails.some(tail=>short.endsWith(tail.toLowerCase())))compact=short;
  return compact;
}
export function rollWords(text,{saize=false}={}){
  const compact=compactWords(text),words=saize?saizeWords:diceWords;
  // Dynamic programming bounds work for overlapping words such as お願い/お願いします.
  // A repeated-alternative regexp can backtrack exponentially on a near match.
  const reachable=new Uint8Array(compact.length+1);reachable[0]=1;
  for(let i=0;i<compact.length;i++)if(reachable[i])for(const word of words)if(compact.startsWith(word,i))reachable[i+word.length]=1;
  return reachable[compact.length]===1;
}
const quantities=[
  [/(?:温度|気温|室温|水温|お湯|お?風呂|お?ふろ|サウナ)$/u,/^(?:度|°c|°f)?$/u],
  [/(?:運勢|幸運度|点数|得点|スコア|やる気|好感度|成功率|勝率)$/u,/^(?:点|%)?$/u],
  [/(?:hp|mp|san|str|dex|con|siz|int|pow|app|edu|ダメージ|回復量|体力|攻撃力|防御力)$/u,/^(?:点|ダメージ|hp|mp|san)?$/u],
  [/(?:時間)$/u,/^(?:秒|分|時間)?$/u],
  [/(?:回数|個数|枚数|人数)$/u,/^(?:回|個|枚|人)?$/u],
  [/(?:予算|値段|料金|金額|お小遣い|おこづかい|ごはん代|昼食代|おやつ代)$/u,/^(?:円)?$/u],
  [/(?:年齢|寿命)$/u,/^(?:歳|年)?$/u],
  [/(?:距離|長さ|身長)$/u,/^(?:cm|m|km)?$/u],
  [/(?:体重|重さ)$/u,/^(?:g|kg)?$/u],
];
export function declaredRoll(source,matches){
  if(matches.length!==1)return false;
  const m=matches[0],before=source.slice(0,m.index).replace(/<@!?\d{17,20}>/g,' ').trim().toLowerCase(),after=source.slice(m.index+m[0].length).replace(/[\s!。]+/g,'').toLowerCase();
  const label=before.match(/^([\p{L}\p{N}ー _・]{1,60}?)(?:は|が|を|=|:|→)\s*$/u)?.[1].trim();
  if(!label||/(?:ふった|ふりました|まわした|ころがした|ロールした|ろーるした|って|という|予定|つもり|報告|記事|資料|引用|記載|書[いか]|話|聞|教わ|もし|ブログ)/u.test(label))return false;
  return quantities.some(([subject,unit])=>subject.test(label)&&unit.test(after));
}
