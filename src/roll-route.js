import {diceExpressions,requestFromExpressions,pureDiceRequest,diceRequest,saizeRequest} from './dice-request.js';
import {rollText,rollWords,clearlyNotRoll} from './roll-intent.js';
import {advancedRollCandidate} from './dice-expression.js';
export const diceHelpMessage='1D100・3D10など、振りたいダイスの式を付けて投稿してください。サイゼロールも使えます。';
const related=source=>/(?:サイゼロール|ダイス(?![ケけキき])|だいす(?![きキけケ])|サイコロ(?![ジじ])|さいころ(?![じジ])|(?<!スク)ロール(?=$|[!?？。、\s]|を|で|の|に|は|が|って|して|お願い|おねがい|ふって|振って|ください))/u.test(source);
// Strip mention IDs before counting visible text or sending a candidate to the judge.
export function routeDiceMessage(content){
  if(typeof content!=='string'||content.length>8000)return null;
  const visible=content.replace(/<@!?\d{17,20}>|<@&\d{17,20}>|<#\d{17,20}>/g,' ').trim();
  const pure=pureDiceRequest(visible.normalize('NFKC'));
  if(pure)return {kind:'local',request:pure};
  if([...visible].length>=30)return null;
  const source=rollText(visible);if(!source)return null;
  const matches=diceExpressions(source),advanced=advancedRollCandidate(source),hasSaize=source.includes('サイゼロール');
  if(!matches.length&&!advanced&&!related(source))return null;
  const local=saizeRequest(source)??diceRequest(source);if(local)return {kind:'local',request:local};
  if(clearlyNotRoll(source))return null;
  if(!matches.length&&!hasSaize&&rollWords(source)&&/(?:振って|ふって|回して|まわして|転がして|ころがして|ロールして|ろーるして|お願い|おねがい|roll)/iu.test(source))return {kind:'local',request:{error:diceHelpMessage}};
  const request=hasSaize&&(matches.length||advanced)?{error:'通常ダイスかサイゼロールのどちらかを、1投稿ずつ依頼してください。'}:hasSaize?{kind:'saize',...(/(?<!!)!(?=サイゼロール)/u.test(source)?{showMenu:true}:{})}:advanced?advanced.request:matches.length?requestFromExpressions(matches):{error:diceHelpMessage};
  return {kind:'judge',text:source,request};
}
