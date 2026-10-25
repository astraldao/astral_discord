import {randomInt} from 'node:crypto';
import {themed} from './ui.js';
import {saizeMenuName,saizeMenuSource} from './saize-menu.js';
const {payload}=themed('game');
const sign=n=>`${n>0?'+':''}${n}`;
function diceResults(request,random){
  if(!request||request.error||!Array.isArray(request.rolls))throw new Error('invalid dice request');
  if(request.rolls.length<1||request.rolls.length>5||request.rolls.some(r=>!Number.isInteger(r.count)||r.count<1||r.count>100||!Number.isInteger(r.sides)||r.sides<2||r.sides>1000000||!Number.isInteger(r.modifier)||Math.abs(r.modifier)>1000000)||request.rolls.reduce((n,r)=>n+r.count,0)>200)throw new Error('invalid dice request');
  return request.rolls.map(r=>{
    const values=Array.from({length:r.count},()=>random(1,r.sides+1));
    return {values,modifier:r.modifier,sum:values.reduce((a,b)=>a+b,0)+r.modifier,label:`${r.count}D${r.sides}${r.modifier?sign(r.modifier):''}`};
  });
}
function groups(values,embed){
  const lines=[];for(let i=0;i<values.length;i+=10)lines.push(values.slice(i,i+10).map(v=>embed?`\`${v}\``:String(v)).join(embed?' · ':' '));return lines.join('\n');
}
const detail=(r,embed)=>`${embed?'**内訳**':'内訳：'}\n${groups(r.values,embed)}${r.modifier?`\n補正：${sign(r.modifier)}`:''}`;
const diceText=results=>`🎲 ${results.map(r=>`**${r.label} → ${r.sum}**\n${detail(r,false)}`).join('\n\n')}`;
function saizeResult(random){
  const first=random(1,4),second=random(1,5),last=random(1,11),digit=last===10?0:last;
  return {first,second,last,digit,code:`${first}${second}0${digit}`};
}
function saizeText(r,showMenu){
  const text=`🎲 **サイゼロール → ${r.code}**\n(1D3)(1D4)0(1D10) → (${r.first})(${r.second})0(${r.last})${r.last===10?' → 末尾の10を0に変換':''}\n※ 実在するメニュー番号とは限りません。`;
  if(showMenu!==true)return text;
  const name=saizeMenuName(r.code);
  return `${text}\n\n${name?`**メニュー：${name}**`:'参照表にこの番号のメニューはありません。'}\n[参照表（${saizeMenuSource.revision}）](<${saizeMenuSource.url}>) · 現在の店舗での提供は未確認です。`;
}
export function rollDice(request,random=randomInt){return diceText(diceResults(request,random));}
export function rollSaize(random=randomInt,{showMenu=false}={}){return saizeText(saizeResult(random),showMenu);}
export function rollReply(request,random=randomInt,{embed=true}={}){
  if(request?.error)return embed?payload('ダイスを確認',request.error,{state:'warning'}):{content:request.error};
  if(request?.kind==='saize'){
    const r=saizeResult(random),showMenu=request.showMenu===true;
    if(!embed)return {content:saizeText(r,showMenu)};
    const name=showMenu?saizeMenuName(r.code):null;
    const body=[...(showMenu?[name?`**${name}**`:'**参照表に該当なし**']:[]),'**内訳**\n'+`\`${r.first}\` · \`${r.second}\` · \`0\`（固定） · \`${r.last===10?'10 → 0':r.last}\``,'式：`(1D3)(1D4)0(1D10)`'].join('\n\n');
    const m=payload(`サイゼロール → ${r.code}`,body);
    m.embeds[0].setFooter({text:showMenu?`${saizeMenuSource.revision} · 現在の店舗での提供は未確認です。`:'番号の抽選です · 実在するメニュー番号とは限りません。'});
    if(showMenu)m.embeds[0].setURL(saizeMenuSource.url);
    return m;
  }
  // Draw once; presentation and permission fallback must never cause a reroll.
  const results=diceResults(request,random);
  if(!embed)return {content:diceText(results)};
  const single=results.length===1;
  return payload(single?`${results[0].label} → ${results[0].sum}`:`ダイスロール · ${results.length}式`,results.map(r=>`${single?'':`**${r.label} → ${r.sum}**\n`}${detail(r,true)}`).join('\n\n'));
}
