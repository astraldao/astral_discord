import {parse} from 'parse5';
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
function nodes(html) {
  const found=[];function walk(n){found.push(n);for(const c of n.childNodes??[])walk(c);}walk(parse(html));return found;
}
const attrs=n=>Object.fromEntries((n.attrs??[]).map(a=>[a.name,a.value]));
function fieldsFor(event,email) {
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email??''))throw new Error('管理者がDENSUKE_EMAILを設定してください。');
  return {eventname:event.name,schedule:event.schedule,explain:event.description,email,pw:event.password?'1':'0',password:event.password,eventchoice:event.choice,postfix:''};
}
export function confirmationFields(html,event,email) {
  const forms=nodes(html).filter(n=>n.tagName==='form');
  const form=forms.find(n=>{const a=attrs(n);return a.method?.toLowerCase()==='post' && new URL(a.action??'',origin+'/confirm').href===origin+'/create';});
  if(!form)throw new Error('伝助の確認画面を認識できませんでした。作成は行っていません。');
  const fields={};function walk(n){if(n.tagName==='input'){const a=attrs(n);if(a.type==='hidden' && a.name)fields[a.name]=a.value??'';}for(const c of n.childNodes??[])walk(c);}walk(form);
  const expected=fieldsFor(event,email);
  for(const [key,value] of Object.entries(expected))if(fields[key]!==value)throw new Error('伝助の確認内容が一致しません。作成は行っていません。');
  // Forward only the known fields, never server-provided destinations or extra parameters.
  return expected;
}
export function resultLinks(html) {
  const links=new Set();
  for(const n of nodes(html)){
    const a=attrs(n),value=n.tagName==='a'?a.href:n.tagName==='input'?a.value:null;
    if(!value)continue;
    try {const url=new URL(value,origin);if(['https:','http:'].includes(url.protocol) && ['densuke.biz','www.densuke.biz'].includes(url.hostname) && !url.port && !url.username && !url.password && /^\/(list|edit)$/.test(url.pathname) && /^[A-Za-z0-9]+$/.test(url.searchParams.get('cd')??'')){url.protocol='https:';url.hostname='www.densuke.biz';links.add(url.href);}}catch{}
  }
  const answer=[...links].find(url=>new URL(url).pathname==='/list'),edit=[...links].find(url=>new URL(url).pathname==='/edit');
  if(!answer || !edit)throw new Error('作成結果を確認できません。控えメールを確認してください。再作成すると重複する可能性があります。');
  return {answer,edit};
}
export class UncertainCreation extends Error {}
export function createDensukeClient(fetcher=fetch) {
  async function request(path,fields) {
    const response=await fetcher(origin+path,{method:'POST',body:new URLSearchParams(fields),redirect:'manual',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'AstralVoiceLobby/3.2'}});
    if(!response.ok)throw new Error('伝助との通信に失敗しました。');
    const reader=response.body.getReader();let size=0;const chunks=[];
    try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024)throw new Error('伝助の応答が大きすぎます。');chunks.push(Buffer.from(value));}}
    finally {await reader.cancel().catch(()=>{});}
    return Buffer.concat(chunks).toString('utf8');
  }
  return {async create(input,email){
    const event=eventData(input),fields=fieldsFor(event,email);
    const confirmed=confirmationFields(await request('/confirm',fields),event,email);
    try {return resultLinks(await request('/create',confirmed));}
    catch {throw new UncertainCreation('作成結果を確認できません。控えメールを確認してください。自動再送はしません。');}
  }};
}
