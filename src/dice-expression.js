export const advancedDiceHelp='高度な式は最大5式・ダイス5組・合計200回の抽選、各組1〜100個・2〜1000000面です。kh/kl・r・!・cs・比較、四則演算と括弧に対応します。式は正規化後120文字・括弧16段までです。';
const bad=()=>{throw new Error('invalid dice expression');};
const bounded=(digits,max=1000000)=>{const s=digits.replace(/^0+(?=\d)/u,'');if(s.length>String(max).length)bad();const n=Number(s);if(!Number.isSafeInteger(n)||n>max)bad();return n;};
const compareOps=['<=','>=','!=','==','<','>','='];
export const diceCompare=(a,op,b)=>op==='<'?a<b:op==='<='?a<=b:op==='>'?a>b:op==='>='?a>=b:op==='!='?a!==b:a===b;
const comparator=(op,n)=>`${op==='=='?'=':op}${n}`;
const mathSymbols=s=>s.replace(/[×✕]/gu,'*').replace(/÷/gu,'/').replace(/−/gu,'-');
export function compileDiceExpression(input){
  if(typeof input!=='string'||input.length>8000)bad();
  const source=mathSymbols(input.normalize('NFKC')).replace(/[、。]/gu,',').trim(),tokens=[];let at=0;
  while(at<source.length){
    if(/\s/u.test(source[at])){at++;continue;}
    const start=at,rest=source.slice(at),numeric=rest.match(/^(\d+)(?:[dD](\d+))?/u),option=rest.match(/^(kh|kl|cs|r)/iu),op=compareOps.find(s=>rest.startsWith(s));let token;
    if(numeric){at+=numeric[0].length;token=numeric[2]!==undefined?{t:'dice',count:bounded(numeric[1],100),sides:bounded(numeric[2])}:{t:'number',n:bounded(numeric[1])};if(token.t==='dice'&&(token.count<1||token.sides<2))bad();}
    else if(option){at+=option[0].length;token={t:option[0].toLowerCase()};}
    else if(op){at+=op.length;token={t:op};}
    else if('+-*/()!,'.includes(source[at]))token={t:source[at++]};
    else bad();
    tokens.push({...token,start,end:at});if(tokens.length>128)bad();
  }
  let pos=0,depth=0,nodes=0;const terms=[],peek=()=>tokens[pos]?.t,take=t=>{if(peek()!==t)bad();return tokens[pos++];},node=x=>{if(++nodes>128)bad();return x;};
  const integer=()=>take('number').n,signed=()=>{const sign=peek()==='-'?(pos++,-1):peek()==='+'?(pos++,1):1;return sign*integer();};
  const condition=implicit=>{const op=compareOps.includes(peek())?tokens[pos++].t:implicit;if(!op)bad();return {op:op==='=='?'=':op,n:integer()};};
  function primary(){
    if(++depth>16)bad();let n;
    if(peek()==='+'||peek()==='-'){const op=tokens[pos++].t;n=node({t:'unary',op,a:primary()});}
    else if(peek()==='('){pos++;n=node({t:'group',a:sum()});take(')');}
    else if(peek()==='number')n=node({t:'number',n:integer()});
    else if(peek()==='dice'){
      const t=tokens[pos++];n=node({t:'dice',count:t.count,sides:t.sides,reroll:null,explode:false,keep:null,success:null});
      const options=new Set();
      while(['r','!','kh','kl','cs'].includes(peek())){
        const op=tokens[pos++].t,key=['kh','kl'].includes(op)?'keep':op;if(options.has(key))bad();options.add(key);
        if(op==='r')n.reroll=condition('=');else if(op==='!')n.explode=true;else if(op==='cs')n.success=condition(null);
        else {const count=integer();if(count<1||count>n.count)bad();n.keep={high:op==='kh',count};}
      }
      terms.push(n);if(terms.length>5)bad();
    }else bad();
    depth--;return n;
  }
  function product(){let n=primary();while(peek()==='*'||peek()==='/'){const op=tokens[pos++].t;n=node({t:'binary',op,a:n,b:primary()});}return n;}
  function sum(){let n=product();while(peek()==='+'||peek()==='-'){const op=tokens[pos++].t;n=node({t:'binary',op,a:n,b:product()});}return n;}
  const label=n=>n.t==='number'?String(n.n):n.t==='unary'?`${n.op}${label(n.a)}`:n.t==='group'?`(${label(n.a)})`:n.t==='binary'?`${label(n.a)}${n.op}${label(n.b)}`:`${n.count}D${n.sides}${n.reroll?`r${n.reroll.op==='='?'':n.reroll.op}${n.reroll.n}`:''}${n.explode?'!':''}${n.keep?`${n.keep.high?'kh':'kl'}${n.keep.count}`:''}${n.success?`cs${comparator(n.success.op,n.success.n)}`:''}`;
  const roots=[];
  while(pos<tokens.length){
    const before=terms.length,root=sum();if(terms.length===before)bad();const check=compareOps.includes(peek())?{op:tokens[pos++].t,n:signed()}:null;
    roots.push({root,check,label:label(root)+(check?comparator(check.op,check.n):'')});if(roots.length>5)bad();
    if(pos===tokens.length)break;
    if(peek()===','){pos++;if(pos===tokens.length)bad();}
    else if(!['dice','number','('].includes(peek())||tokens[pos].start===tokens[pos-1].end)bad();
  }
  const baseDice=terms.reduce((s,n)=>s+n.count,0),formula=roots.map(r=>r.label).join(',');
  if(!roots.length||baseDice>200||formula.length>120)bad();
  return {roots,terms,baseDice,formula};
}
const advanced=raw=>/(?:kh|kl|cs|r)(?=[\d<>=!])|[*/()<>=]|[%^](?=\s*[\d(+-])|(?<![!])!(?![!])/iu.test(raw)||(!/^\d+d\d+(?:\s*[+-]\s*\d+)?(?:\s+\d+d\d+(?:\s*[+-]\s*\d+)?)*[!\s]*$/iu.test(raw)&&/[+-]/u.test(raw));
export function pureAdvancedDice(source){
  if(typeof source==='string')source=mathSymbols(source);
  if(typeof source!=='string'||source.length>8000||!/^\s*[+\-(\d]/u.test(source)||!/^[\d\sdkhlrcs+\-*/()<>=!,、。]+$/iu.test(source)||!/(?<![a-z0-9_])\d+d\d+/iu.test(source)||!source.split(/[,、。]/u).some(advanced))return null;
  try{return {kind:'advanced',formula:compileDiceExpression(source).formula};}catch{return {error:advancedDiceHelp};}
}
// Locate math islands without feeding prose into the expression parser or accepting a valid prefix of an unknown suffix.
export function advancedDiceCandidate(source,{force=false}={}){
  if(typeof source!=='string'||source.length>8000)return null;
  const spans=[];let consumed=0;
  for(const match of source.matchAll(/(?<![a-z0-9_])\d+d\d+(?=$|[^a-z0-9_]|kh|kl|cs|r(?=[\d<>=!]))/giu)){
    if(match.index<consumed)continue;
    let start=match.index,end=match.index+match[0].length;
    while(start>consumed&&/[\d\s()+\-*/]/u.test(source[start-1]))start--;
    while(end<source.length){
      const ch=source[end];
      if(/\s/u.test(ch)){let next=end;while(next<source.length&&/\s/u.test(source[next]))next++;if(/[a-z]/iu.test(source[next]??'')&&!/^(?:kh\d|kl\d|r[\d<>=!]|cs[<>=!])/iu.test(source.slice(next)))break;end=next;continue;}
      if(/[\d()+\-*/<>=!]/u.test(ch)||/[%^]/u.test(ch)&&/^[%^]\s*[\d(+-]/u.test(source.slice(end))){end++;continue;}
      const option=source.slice(end).match(/^(?:[dD](?=\d)|kh|kl|cs|r(?=[\d<>=!]))/iu);if(option){end+=option[0].length;continue;}break;
    }
    const full=source.slice(start,end),raw=full.trim();spans.push({start:start+full.length-full.trimStart().length,end:start+full.trimEnd().length,raw});consumed=end;
  }
  if(!spans.length||!force&&!spans.some(s=>advanced(s.raw)))return null;
  let rest='',at=0;for(const s of spans){rest+=source.slice(at,s.start)+' ';at=s.end;}rest+=source.slice(at);
  const formula=spans.map(s=>s.raw).join(',');let request;
  try{if(spans.some(s=>/[a-z0-9_]/iu.test(source[s.end]??'')))bad();request={kind:'advanced',formula:compileDiceExpression(formula).formula};}catch{request={error:advancedDiceHelp};}
  return {request,rest,spans};
}
export function advancedRollCandidate(source){
  if(typeof source!=='string')return null;
  source=mathSymbols(source);
  const aliases=source.match(/有利|不利/gu);if(!aliases)return advancedDiceCandidate(source);
  const candidate=advancedDiceCandidate(source.replace(/有利|不利/gu,' '),{force:true});if(!candidate)return null;
  try{
    if(aliases.length!==1||candidate.request.error)bad();const c=compileDiceExpression(candidate.request.formula);
    if(c.roots.length!==1||c.terms.length!==1||c.terms[0].count!==1||c.terms[0].keep)bad();
    candidate.request={kind:'advanced',formula:compileDiceExpression(c.formula.replace(/1D\d+/u,`2D${c.terms[0].sides}${aliases[0]==='有利'?'kh':'kl'}1`)).formula};
  }catch{candidate.request={error:'有利・不利は、1D20など1個のダイスを含む1つの式へ指定してください。2個振って高い方・低い方を採用します。'};}
  return candidate;
}
