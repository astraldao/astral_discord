import {iacharaUrl,MAX_TXT} from './trpg-store.js';

// The public site's guest flow; no member credentials or editing requests.
const API='https://apiv3.iachara.com';
const PUBLIC_WEB_KEY='AIzaSyBRP4ntIWd48qx6Liqk-1DnigSMM_xNLgs';
const groups=[['battleSkills','戦闘技能'],['searchSkills','探索技能'],['actionSkills','行動技能'],['negotiationSkills','交渉技能'],['knowledgeSkills','知識技能']];
const num=x=>Number.isFinite(Number(x))?Number(x):0;
const pretty=x=>typeof x==='string'?x:JSON.stringify(x??'',null,2);
function boundedTree(data) {
  const pending=[{value:data,depth:0}];let count=0;
  while(pending.length){const {value,depth}=pending.pop();if(++count>10000 || depth>16)throw new Error('キャラデータの構造が複雑すぎます。');if(value && typeof value==='object')for(const child of Object.values(value))pending.push({value:child,depth:depth+1});}
}
export function characterText(data) {
  boundedTree(data);
  if(!['6th','7th'].includes(data?.version) || !data.profile?.name || !data.abilities)throw new Error('対応するキャラデータを確認できませんでした。');
  const p=data.profile,a=data.abilities,seventh=data.version==='7th';
  const base=k=>num(a[k]?.value);
  const current=k=>base(k)+num(a[k]?.fixedDiff)+num(a[k]?.tmpFixedDiff);
  const derived={hp:seventh?Math.floor((base('con')+base('siz'))/10):Math.ceil((base('con')+base('siz'))/2),mp:seventh?Math.floor(base('pow')/5):base('pow'),san:base('pow')*(seventh?1:5),ide:base('int')*(seventh?1:5),luck:base('pow')*5,know:base('edu')*(seventh?1:5)};
  const out=[`いあきゃら キャラクター控え · ${seventh?'7':'6'}版`,'【基本情報】',`名前: ${p.name} (${p.furi??''})`,`タグ: ${p.tag??''}`,`職業: ${p.profession??''}`,`年齢: ${p.age??''} / 性別: ${p.sex??''} / 身長: ${p.height??''}`,`体重: ${p.weight??''} / 出身: ${p.from??''}`,`髪の色: ${p.hairColor??''} / 瞳の色: ${p.eyeColor??''} / 肌の色: ${p.skinColor??''}`];
  for(const x of p.externalProfiles??[])out.push(`${x.name}: ${pretty(x.value)}`);
  out.push('\n【アイコン】',...(p.icons??[]).map(x=>`${x.name??''}: ${x.url??''}`),'\n【能力値】','項目: 現在値 / 基本値 / 増加分 / 一時的');
  for(const [k,v] of Object.entries(a)){const b=v.value===undefined?derived[k]:num(v.value);out.push(`${k.toUpperCase()}: ${b===undefined?'未設定':b+num(v.fixedDiff)+num(v.tmpFixedDiff)} / ${b??'未設定'} / ${num(v.fixedDiff)} / ${num(v.tmpFixedDiff)}`);}
  out.push('\n【技能値】','技能名: 合計 / 初期値 / 職業P / 興味P / 成長分 / その他');
  for(const [key,title] of groups){out.push(`\n『${title}』`);for(const s of [...data[key]?.static??[],...data[key]?.additional??[]]){let initial=s.defaultPoint;if(initial===undefined){if(s.name==='回避')initial=Math.floor(current('dex')*(seventh?0.5:2));else if(s.name==='母国語')initial=current('edu')*(seventh?1:5);}const values=[initial,s.professionPoint,s.interestPoint,s.growthPoint,s.otherPoint].map(num);out.push(`${s.name}${s.additionalName?`（${s.additionalName}）`:''}: ${values.reduce((x,y)=>x+y,0)} / ${values.join(' / ')}`);}}
  for(const [key,title] of [['skillPoint','技能ポイント設定'],['battle','武器'],['belongings','冒険の装備とその他の所持品'],['incomeAndAssets','収入と財産'],['backstory','バックストーリー'],['spells','呪文'],['artifacts','魔導書・アーティファクト'],['fellows','遭遇した超自然の存在'],['passedScenarios','通過したシナリオ名'],['memo','メモ'],['additionalMemo','追加メモ']])if(data[key]!==undefined)out.push(`\n【${title}】`,pretty(data[key]));
  // Lossless source included for future schema changes and restoring custom fields.
  out.push('\n【元データ・復元用JSON】',JSON.stringify(data,null,2));
  const txt=out.join('\n')+'\n';if(Buffer.byteLength(txt)>MAX_TXT)throw new Error('TXTが256KBを超えています。');return txt;
}
export function createIacharaClient({fetchImpl=fetch,now=()=>Date.now(),timeoutSignal=()=>AbortSignal.timeout(60000)}={}) {
  let token,expires=0,authJob,busy=false,last=-Infinity;
  async function json(url,options={},operation) {
    operation.signal.throwIfAborted();
    const signal=AbortSignal.any([operation.signal,AbortSignal.timeout(20000)]);
    const r=await fetchImpl(url,{...options,redirect:'error',signal});
    if(!r.ok){if(r.status===401){token=null;expires=0;}await r.body?.cancel().catch(()=>{});throw new Error('いあきゃらから取得できませんでした。公開設定や稼働状況を確認してください。');}
    if(num(r.headers.get('content-length'))>operation.remaining){await r.body?.cancel().catch(()=>{});throw new Error('取得データの合計が256KBを超えています。');}
    const reader=r.body.getReader();const chunks=[];try{while(true){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;operation.remaining-=value.length;if(operation.remaining<0)throw new Error('取得データの合計が256KBを超えています。');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
    signal.throwIfAborted();
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('取得データの形式を確認できませんでした。');}
  }
  async function auth(operation){if(token && now()<expires)return token;if(!authJob)authJob=(async()=>{const guest=await json(`${API}/v3/auth/guestToken`,{method:'POST',headers:{'Content-Type':'application/json'}},operation);const t=await json(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${PUBLIC_WEB_KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:guest.token,returnSecureToken:true})},operation);if(typeof t.idToken!=='string')throw new Error('ゲスト接続を確認できませんでした。');token=t.idToken;expires=now()+Math.max(0,Math.min(num(t.expiresIn)-60,3300))*1000;return token;})().finally(()=>{authJob=null;});return authJob;}
  return {async fetchCharacter(url){url=iacharaUrl(url);if(busy || now()-last<5000)throw new Error('キャラ取得が続いています。少し待って更新してください。');busy=true;last=now();const operation={signal:timeoutSignal(),remaining:MAX_TXT};try{const bearer=await auth(operation);const r=await json(`${API}/v3/charasheet/${url.split('/').pop()}`,{headers:{Authorization:`Bearer ${bearer}`}},operation);const d=r.data?.data;if(!r.success || !d)throw new Error('共有キャラを読み込めませんでした。');if((d.additionalMemoIds??[]).length>20)throw new Error('追加メモが多すぎます。');const additionalMemo=[];for(const id of d.additionalMemoIds??[]){if(typeof id!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new Error('追加メモの形式を確認できません。');const m=await json(`${API}/v3/memo/${id}?password=undefined`,{headers:{Authorization:`Bearer ${bearer}`}},operation);if(!m.memo)throw new Error('追加メモを取得できませんでした。以前の控えを保持します。');additionalMemo.push(m.memo);}operation.signal.throwIfAborted();const full={...d,additionalMemo};return {name:full.profile?.name,txt:characterText(full)};}finally{busy=false;}}};
}
