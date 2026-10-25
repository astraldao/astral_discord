import {randomInt} from 'node:crypto';
import {compileDiceExpression,diceCompare} from './dice-expression.js';
export function evaluateDiceExpression(request,random=randomInt){
  if(request?.kind!=='advanced')throw new Error('invalid advanced request');
  const c=compileDiceExpression(request.formula),traces=[],values=new Map(),warnings=new Set();let draws=0,reserved=c.baseDice;
  const draw=sides=>{const n=random(1,sides+1);if(!Number.isInteger(n)||n<1||n>sides)throw new Error('invalid random result');draws++;return n;};
  for(const term of c.terms){
    const dice=[];
    for(let i=0;i<term.count;i++){
      reserved--;const steps=[];let extra=0;
      while(true){
        let value=draw(term.sides);const step={value};
        if(term.reroll&&diceCompare(value,term.reroll.op,term.reroll.n)){
          if(draws+reserved<200){step.before=value;value=draw(term.sides);step.value=value;}else warnings.add('振り直し・追加抽選を含む200回の上限');
        }
        steps.push(step);
        if(!term.explode||value!==term.sides)break;
        if(extra>=10||draws+reserved>=200){warnings.add(extra>=10?'1個あたり追加10回の上限':'振り直し・追加抽選を含む200回の上限');break;}
        extra++;
      }
      dice.push({steps,total:steps.reduce((n,s)=>n+s.value,0),kept:true});
    }
    if(term.keep){const order=dice.map((d,i)=>({i,value:d.total})).sort((a,b)=>(term.keep.high?b.value-a.value:a.value-b.value)||a.i-b.i),kept=new Set(order.slice(0,term.keep.count).map(d=>d.i));dice.forEach((d,i)=>{d.kept=kept.has(i);});}
    const value=dice.reduce((sum,d)=>sum+(d.kept?(term.success?Number(diceCompare(d.total,term.success.op,term.success.n)):d.total):0),0);
    values.set(term,value);traces.push({term,dice,value});
  }
  const math=n=>{
    if(n.t==='dice')return values.get(n);if(n.t==='number')return n.n;if(n.t==='group')return math(n.a);if(n.t==='unary')return (n.op==='-'?-1:1)*math(n.a);
    const a=math(n.a),b=math(n.b);if(n.op==='/'&&b===0)throw new Error('zero');const value=n.op==='+'?a+b:n.op==='-'?a-b:n.op==='*'?a*b:a/b;
    if(!Number.isFinite(value)||Math.abs(value)>1000000000000)throw new Error('range');return value;
  };
  function substitution(n,parent=0){
    if(n.t==='dice')return String(values.get(n));if(n.t==='number')return String(n.n);if(n.t==='group')return `(${substitution(n.a)})`;if(n.t==='unary')return `${n.op}(${substitution(n.a)})`;
    const precedence=n.op==='+'||n.op==='-'?1:2,s=`${substitution(n.a,precedence)}${n.op}${substitution(n.b,precedence+1)}`;return precedence<parent?`(${s})`:s;
  }
  const roots=c.roots.map(r=>{try{const value=math(r.root);return {label:r.label,value,calculation:substitution(r.root),check:r.check,passed:r.check?diceCompare(value,r.check.op,r.check.n):null};}catch(e){return {label:r.label,value:null,calculation:substitution(r.root),check:r.check,passed:null,error:e.message==='zero'?'0で割る計算になりました。':'計算結果が±1兆の範囲を超えました。'};}});
  return {roots,traces,draws,warnings:[...warnings]};
}
