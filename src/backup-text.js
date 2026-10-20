export const backupTextModes=Object.freeze({raw:'そのまま',chat:'チャット向け'});
const normalize=value=>String(value??'').normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/gu,' ').trim();
const emoji=/<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>/y;
const urlAt=(value,at)=>{const prefix=value.slice(at,at+8).toLowerCase();return prefix.startsWith('https://')||prefix.startsWith('http://');};
const urlEnd=char=>/\s/u.test(char)||'<>`|。、「」『』()（）'.includes(char);
function spoilerEnd(value,at){
  for(;at<value.length;){
    if(value[at]==='\\'){
      let end=at+1;while(value[end]==='\\')end++;
      const escaped=(end-at)%2===1;at=end+(escaped&&value.startsWith('||',end)?2:0);continue;
    }
    if(value.startsWith('||',at))return at;
    at++;
  }
  return -1;
}
function codeRuns(value){
  const runs=[],at=new Map();
  for(let start=0;start<value.length;){
    if(value[start]!=='`'){start++;continue;}
    let end=start+1;while(value[end]==='`')end++;
    const run={start,end,length:end-start};runs.push(run);at.set(start,run);start=end;
  }
  const equal=new Map(),larger=[];
  for(let i=runs.length-1;i>=0;i--){
    const run=runs[i];run.nextInline=equal.get(run.length);equal.set(run.length,run);
    while(larger.length&&larger.at(-1).length<run.length)larger.pop();
    run.nextFence=larger.at(-1);larger.push(run);
  }
  return at;
}
function chatText(value){
  const result=[],runs=codeRuns(value);
  for(let at=0;at<value.length;){
    if(value[at]==='\\'){
      let end=at+1;while(value[end]==='\\')end++;
      const escaped=(end-at)%2===1;result.push(value.slice(at,end));at=end;
      if(escaped){
        const delimiter=value[at]==='`'?value.slice(at,runs.get(at).end):value.startsWith('||',at)?'||':value[at];
        if(delimiter&&'`|<'.includes(delimiter[0])){result.push(delimiter);at+=delimiter.length;}
      }
      continue;
    }
    if(value[at]==='`'){
      // Backslashes inside code are literal. Shorter tick runs cannot close it.
      const run=runs.get(at),end=run.length>=3?run.nextFence:run.nextInline;
      if(end){result.push(' コード ');at=end.end;}
      else{result.push(value.slice(at,run.end));at=run.end;}
      continue;
    }
    if(value.startsWith('||',at)){
      const end=spoilerEnd(value,at+2);
      if(end!==-1){result.push(' 伏せ字 ');at=end+2;}
      else{result.push('||');at+=2;}
      continue;
    }
    const angle=value[at]==='<'&&urlAt(value,at+1),start=angle?at+1:at;
    if(urlAt(value,start)){
      let end=start;while(end<value.length&&!urlEnd(value[end]))end++;
      let valid=false;try{valid=!!new URL(value.slice(start,end)).hostname;}catch{}
      if(valid){result.push(' リンク ');at=end+(angle&&value[end]==='>'?1:0);}
      else{result.push(value.slice(at,end));at=end;}
      continue;
    }
    if(value[at]==='<'){
      emoji.lastIndex=at;if(emoji.test(value)){result.push(' 絵文字 ');at=emoji.lastIndex;continue;}
    }
    result.push(value[at++]);
  }
  return result.join('');
}
// Count Unicode code points after optional chat formatting so surrogate pairs stay intact.
export function backupText(value,{mode='raw'}={}){
  if(!Object.hasOwn(backupTextModes,mode))throw new Error('読み上げモードを選び直してください。');
  const source=normalize(value),chars=Array.from(mode==='chat'?normalize(chatText(source)):source);
  return chars.slice(0,50).join('')+(chars.length>50?'以下略':'');
}
