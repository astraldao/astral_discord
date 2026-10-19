import {parse,defaultTreeAdapter as adapter} from 'parse5';
import {validDensukeEmail} from './settings.js';
const origin='https://www.densuke.biz';
const invalidHtml=()=>Object.assign(new Error('伝助の応答が大きすぎるか複雑すぎます。'),{code:'DENSUKE_HTML_LIMIT'});
function walkNodes(root){
  const found=[],pending=[{node:root,depth:0}];
  while(pending.length){
    const {node,depth}=pending.pop();if(depth>128||found.length>=20000)throw invalidHtml();found.push(node);
    const children=node.childNodes??[];for(let n=children.length-1;n>=0;n--)pending.push({node:children[n],depth:depth+1});
  }
  return found;
}
function nodes(html) {
  if(typeof html!=='string'||Buffer.byteLength(html)>1024*1024)throw invalidHtml();
  let operations=0;const bounded={...adapter};
  const count=()=>{if(++operations>100000)throw invalidHtml();};
  const depth=parent=>{let level=0;for(let p=parent;p;p=adapter.getParentNode(p))if(++level>128)throw invalidHtml();};
  for(const name of ['createDocument','createDocumentFragment','createElement','createCommentNode','createTextNode','setDocumentType','adoptAttributes','detachNode','setTemplateContent']){
    bounded[name]=(...args)=>{count();return adapter[name](...args);};
  }
  for(const name of ['appendChild','insertBefore','insertText','insertTextBefore']){
    bounded[name]=(...args)=>{count();depth(args[0]);return adapter[name](...args);};
  }
  const tree=parse(html,{treeAdapter:bounded});return walkNodes(tree);
}
const attrs=n=>Object.fromEntries((n.attrs??[]).map(a=>[a.name,a.value]));
export function fieldsFor(event,email) {
  if(!validDensukeEmail(email))throw new Error('「固定メール設定」でメールアドレスを設定してください。');
  return {eventname:event.name,schedule:event.schedule,explain:event.description,email,pw:event.password?'1':'0',password:event.password,eventchoice:event.choice,postfix:''};
}
export function confirmationFields(html,event,email) {
  const forms=nodes(html).filter(n=>n.tagName==='form');
  const form=forms.find(n=>{const a=attrs(n);return a.method?.toLowerCase()==='post' && new URL(a.action??'',origin+'/confirm').href===origin+'/create';});
  if(!form)throw new Error('伝助の確認画面を認識できませんでした。作成は行っていません。');
  const fields=Object.create(null);for(const n of walkNodes(form)){if(n.tagName==='input'){const a=attrs(n);if(a.type==='hidden' && a.name)fields[a.name]=a.value??'';}}
  const expected=fieldsFor(event,email);
  for(const [key,value] of Object.entries(expected))if(fields[key]!==value)throw new Error('伝助の確認内容が一致しません。作成は行っていません。');
  // Forward only the known fields, never server-provided destinations or extra parameters.
  return expected;
}
export function densukeUrl(value) {
  try {
    const url=new URL(value,origin);
    if(!['https:','http:'].includes(url.protocol) || !['densuke.biz','www.densuke.biz'].includes(url.hostname) || url.port || url.username || url.password || !/^\/(list|edit)$/.test(url.pathname) || !/^[A-Za-z0-9]+$/.test(url.searchParams.get('cd')??''))return null;
    url.protocol='https:';url.hostname='www.densuke.biz';return url;
  } catch{return null;}
}
export function eventLinks(answer,edit) {
  const a=densukeUrl(answer),e=densukeUrl(edit);
  if(a?.pathname!=='/list' || e?.pathname!=='/edit' || a.searchParams.get('cd')!==e.searchParams.get('cd'))throw new Error('同じイベントの回答用・編集用URLを入力してください。');
  // Keep the edit capability (pw) private; never pass it to the public URL.
  a.search=new URLSearchParams({cd:a.searchParams.get('cd')}).toString();
  return {answer:a.href,edit:e.href};
}
export function resultLinks(html) {
  const links=new Map();
  function collect(value) {
    const url=densukeUrl(value);if(url)links.set(url.href,url);
  }
  for(const n of nodes(html)){
    const a=attrs(n);
    if(n.tagName==='a')collect(a.href);
    if(n.tagName==='input' && !['eventname','schedule','explain','email'].includes(a.name))collect(a.value);
    // Completion pages may display URLs in textareas or plain text rather than links.
    if(n.nodeName==='#text')for(const value of (n.value??'').match(/https?:\/\/(?:www\.)?densuke\.biz\/(?:list|edit)\?[^\s<>"']+/g)??[])collect(value);
  }
  const answers=[],edits=new Map();
  for(const url of links.values()){const key=url.searchParams.get('cd');if(url.pathname==='/list')answers.push(url);else if(!edits.has(key))edits.set(key,url);}
  for(const answer of answers){const edit=edits.get(answer.searchParams.get('cd'));if(edit)return eventLinks(answer.href,edit.href);}
  throw Object.assign(new Error('作成結果を確認できません。控えメールを確認してください。再作成すると重複する可能性があります。'),{code:'DENSUKE_RESULT_URLS'});
}
