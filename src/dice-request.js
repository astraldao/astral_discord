import {requestSource,rollWords,declaredRoll} from './roll-intent.js';
import {pureAdvancedDice,advancedRollCandidate} from './dice-expression.js';
export const diceLimitMessage='ダイスは1回1〜100個、面数2〜1000000、最大5式・合計200個、補正は±1000000までです。';
export function diceExpressions(source){
  return [...source.matchAll(/(?<![A-Za-z0-9_])([0-9]+)[dD]([0-9]+)(?:\s*([+-])\s*([0-9]+))?(?:(?![A-Za-z0-9_])|(?=(?:cm|km|kg|hp|mp|san|m|g)(?:[\s!。]|$)))/giu)];
}
export function withoutExpressions(source,matches){
  let rest='',at=0;for(const m of matches){rest+=source.slice(at,m.index)+' ';at=m.index+m[0].length;}return rest+source.slice(at);
}
function boundedNumber(digits,maximum){
  const value=digits.replace(/^0+(?=\d)/u,'');if(value.length>String(maximum).length)return null;
  const number=Number(value);return Number.isSafeInteger(number)&&number<=maximum?number:null;
}
export function requestFromExpressions(matches){
  const invalid=()=>({error:diceLimitMessage});
  if(!matches.length||matches.length>5)return invalid();
  const rolls=[];
  for(const m of matches){
    const count=boundedNumber(m[1],100),sides=boundedNumber(m[2],1000000),amount=m[3]?boundedNumber(m[4],1000000):0;
    if(count===null||count<1||sides===null||sides<2||amount===null)return invalid();
    rolls.push({count,sides,modifier:m[3]==='-'?-amount:amount});
  }
  if(rolls.reduce((n,r)=>n+r.count,0)>200)return invalid();
  return {rolls};
}
export function pureDiceRequest(source){
  const advanced=pureAdvancedDice(source);if(advanced)return advanced;
  const matches=diceExpressions(source);if(!matches.length||withoutExpressions(source,matches).replace(/[\s,、。!！:：・/\[\]()]+/g,''))return null;
  return requestFromExpressions(matches);
}
export function saizeRequest(content){
  const source=requestSource(content)?.replace(/<@!?\d{17,20}>/g,' ').trim();
  const match=source?.match(/^(?:(?:じゃあ|では|次は|今回は|ちょっと|もう一度)\s*)?(!?)サイゼロール(.*)$/u);
  if(!match||!rollWords(match[2],{saize:true}))return null;
  return match[1]==='!'?{kind:'saize',showMenu:true}:{kind:'saize'};
}
export function diceRequest(content){
  const source=requestSource(content);if(!source)return null;
  const advanced=advancedRollCandidate(source);if(advanced){if(!rollWords(advanced.rest)&&!declaredRoll(source,advanced.spans.map(s=>Object.assign([s.raw],{index:s.start}))))return null;return advanced.request;}
  const matches=diceExpressions(source);if(!matches.length)return null;
  if(!rollWords(withoutExpressions(source,matches))&&!declaredRoll(source,matches))return null;
  return requestFromExpressions(matches);
}
