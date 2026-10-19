import {fieldsFor,eventLinks} from './densuke-html.js';
import {parseDensukePage} from './densuke-parser.js';
import {BoundedBytes} from './bounded-bytes.js';
export {densukeUrl,eventLinks,confirmationFields,resultLinks} from './densuke-html.js';
const origin='https://www.densuke.biz';
export const choices={'1':'○△×','2':'○×','3':'◎○△×'};
export function eventData(input) {
  const name=String(input.name??'').trim(),schedule=String(input.schedule??'').trim().replace(/\r\n?/g,'\n');
  const description=String(input.description??'').trim().replace(/\r\n?/g,'\n'),password=String(input.password??'').trim(),choice=String(input.choice??'1');
  if(!name || name.length>250)throw new Error('イベント名は1〜250文字で入力してください。');
  if(!schedule || schedule.length>4000 || schedule.split('\n').filter(line=>line.trim()).length>500)throw new Error('候補日程は1行に1候補、4000文字・500候補以内で入力してください。');
  if(description.length>2000)throw new Error('説明は2000文字以内で入力してください。');
  if(password && !/^[A-Za-z0-9]{1,8}$/.test(password))throw new Error('パスワードは半角英数字8文字以内です。');
  if(!Object.hasOwn(choices,choice))throw new Error('回答の選択肢を選び直してください。');
  return {name,schedule,description,password,choice};
}
export class UncertainCreation extends Error {}
export function createDensukeClient(fetcher=fetch,{parsePage=parseDensukePage}={}) {
  async function request(path,fields) {
    let url=origin+path,method='POST',body=new URLSearchParams(fields),response;
    const signal=AbortSignal.timeout(20000);
    for(let redirects=0;redirects<=3;redirects++) {
      response=await fetcher(url,{method,body,redirect:'manual',signal,headers:{...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{}),'User-Agent':'AstralVoiceLobby/3.2'}});
      if(![301,302,303].includes(response.status))break;
      const location=response.headers.get('location');
      let target;try{target=new URL(location??'',url);}catch{}
      await response.body?.cancel().catch(()=>{});
      if(!location || !target || target.protocol!=='https:' || !['www.densuke.biz','densuke.biz'].includes(target.hostname) || target.port || target.username || target.password || redirects===3)throw Object.assign(new Error('伝助の転送先を確認できません。'),{code:'DENSUKE_REDIRECT'});
      url=target.href;method='GET';body=undefined;
    }
    if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});throw Object.assign(new Error('伝助との通信に失敗しました。'),{code:'DENSUKE_HTTP'});}
    const advertised=response.headers.get('content-length');
    if(advertised!==null&&(!/^\d+$/.test(advertised)||!Number.isSafeInteger(Number(advertised))||Number(advertised)>1024*1024)){await response.body.cancel().catch(()=>{});throw new Error('伝助の応答が大きすぎるか形式が不正です。');}
    const reader=response.body.getReader(),bytes=new BoundedBytes(1024*1024);
    try {while(true){signal.throwIfAborted();const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;bytes.append(value);}return bytes.finish().toString('utf8');}
    catch(error){if(error?.code==='RESPONSE_LIMIT')throw new Error('伝助の応答が大きすぎます。');throw error;}
    finally {bytes.dispose();await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  return {async create(input,email,{beforeCreate=async()=>{}}={}){
    const event=eventData(input),fields=fieldsFor(event,email);
    await parsePage('confirmation',await request('/confirm',fields),{event,email});
    // Confirmation may await remote I/O and parsing. Recheck the caller's authority
    // before the irreversible POST; refusal here is a known non-creation.
    await beforeCreate();
    const confirmed=fields;
    try {const result=await parsePage('result',await request('/create',confirmed));return eventLinks(result.answer,result.edit);}
    catch(error){console.error('伝助の作成結果:',error.code??'DENSUKE_RESPONSE');throw new UncertainCreation('作成結果を確認できません。控えメールを確認してください。自動再送はしません。');}
  }};
}
