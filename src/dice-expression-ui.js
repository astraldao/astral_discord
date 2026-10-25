import {evaluateDiceExpression} from './dice-evaluate.js';
import {themed} from './ui.js';
const {payload}=themed('game');
const number=n=>{if(Object.is(n,-0))return '0';if(Number.isInteger(n))return String(n);const rounded=Number(n.toPrecision(10));return `${rounded===n?'':'約'}${rounded}`;};
function present(result,embed,{compact=false}={}){
  const code=v=>embed?`\`${v}\``:String(v),reference=result.warnings.length>0;
  const outcome=r=>r.error?'計算できません':`${number(r.value)}${r.check?reference?' · 判定未確定':r.passed?' · 成功':' · 失敗':reference?' · 参考値':''}`;
  const titles=result.roots.map(r=>`${r.label} → ${outcome(r)}`),single=titles.length===1;
  const calculations=result.roots.map((r,i)=>`${single?'':`${i+1}. `}${embed?'**':''}${titles[i]}${embed?'**':''}${r.error?!compact?`\n${r.error}`:'':!compact&&/[()+*/-]/u.test(r.calculation)?`\n計算：${r.calculation} = ${number(r.value)}`:''}`).join('\n\n');
  const traces=result.traces.map((t,i)=>{
    const values=t.dice.map(d=>{const s=d.steps.map(step=>`${step.before===undefined?'':`${code(step.before)}→`}${code(step.value)}`).join('+');return !d.kept&&!compact?(embed?`~~${s}~~`:`(${s})`):s;});
    const lines=[];for(let n=0;n<values.length;n+=10)lines.push(values.slice(n,n+10).join(embed?' · ':' '));
    const keep=t.term.keep?`${t.term.keep.high?'高い':'低い'}${t.term.keep.count}個を採用`:'',score=t.term.success?`成功数 ${t.value}`:`小計 ${number(t.value)}`;
    return compact?`${i+1}:\n${lines.join('\n')}`:`${embed?'**':''}${i+1}. 内訳${embed?'**':''} ${score}${keep?` · ${keep}`:''}\n${lines.join('\n')}`;
  }).join('\n\n');
  const notes=[...(result.traces.some(t=>t.term.reroll)?[compact?'→振直':'→ 振り直し前→後']:[]),...(result.traces.some(t=>t.term.explode)?[compact?'+追加':'+ 追加抽選']:[]),...(!compact&&result.traces.some(t=>t.term.keep)?[embed?'取消線は除外':'括弧内は除外']:[])];
  const warning=reference?compact?'\n※ 抽選上限に達したため参考値・判定未確定。':`\n\n参考値：${result.warnings.join('・')}に達したため、ここまでの値です。比較の成否は確定しません。`:'';
  const errors=compact?[...new Set(result.roots.filter(r=>r.error).map(r=>r.error.includes('0で')?'0で除算':'±1兆の範囲外'))].join('・'):'';
  return {title:single?titles[0]:`ダイスロール · ${titles.length}式`,body:`${single&&embed&&!result.roots[0].error?(calculations.includes('\n計算：')?calculations.slice(calculations.indexOf('\n計算：')+1)+'\n\n':''):calculations+'\n\n'}${traces}${notes.length?`\n\n${notes.join(' · ')}`:''}${warning}`,text:`🎲 ${calculations}\n\n${traces}${notes.length?`\n${notes.join(' · ')}`:''}${warning}${errors?`\n計算不可：${errors}`:''}`};
}
export function advancedDiceReply(request,random,{embed=true}={}){
  const result=evaluateDiceExpression(request,random),p=present(result,embed);
  if(!embed){const text=p.text.length<=2000?p.text:present(result,false,{compact:true}).text;if(text.length>2000)throw new Error('dice result exceeds text limit');return {content:text};}
  if(p.body.length>4096)throw new Error('dice result exceeds embed limit');
  const message=payload(p.title,p.body,{state:result.warnings.length||result.roots.some(r=>r.error)?'warning':'normal'});
  if(result.traces.some(t=>t.term.keep))message.embeds[0].setFooter({text:'採用は振り直し・追加分の合計で比較 · 同値は元の出目順を優先'});
  return message;
}
