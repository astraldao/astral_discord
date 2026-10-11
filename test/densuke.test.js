import test from 'node:test';
import assert from 'node:assert/strict';
import {PermissionsBitField,PermissionFlagsBits as P} from 'discord.js';
import {eventData,eventLinks,confirmationFields,resultLinks,createDensukeClient,UncertainCreation} from '../src/densuke.js';
import {createDensukeController,densukeModal,densukeScreen,densukeEmailModal} from '../src/densuke-ui.js';
const email='owner@example.com';
const event=()=>({name:'卓の日程',schedule:'10/31(土) 20:00～\n11/1(日) 20:00～',description:'説明',password:'aB123',choice:'3'});
const result={answer:'https://www.densuke.biz/list?cd=Answer123',edit:'https://www.densuke.biz/edit?cd=Answer123&pw=Secret123'};
const completed=`<a href="${result.answer}">回答</a><input value="${result.edit}">`;
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
function confirm(e=event(),mail=email){return '<form action="create" method="post">'+Object.entries({eventname:e.name,schedule:e.schedule,explain:e.description,email:mail,pw:e.password?'1':'0',password:e.password,eventchoice:e.choice,postfix:''}).map(([name,value])=>`<input type="hidden" name="${name}" value="${esc(value)}">`).join('')+'</form>';}
test('required fields, optional password and the three response choices are validated',()=>{
  for(const choice of ['1','2','3'])assert.equal(eventData({...event(),choice}).choice,choice);
  for(const change of [{name:''},{schedule:''},{password:'あ'},{password:'123456789'},{choice:'4'}])assert.throws(()=>eventData({...event(),...change}));
  assert.equal(eventData({...event(),password:'',description:''}).password,'');
});
test('confirmation refuses mismatched fields and untrusted form destinations',()=>{
  const e=eventData({...event(),name:'卓 & "名前"'});
  assert.equal(confirmationFields(confirm(e),e,email).eventname,e.name);
  assert.throws(()=>confirmationFields(confirm(e).replace('action="create"','action="https://evil.example/create"'),e,email));
  assert.throws(()=>confirmationFields(confirm(e,'other@example.com'),e,email));
});
test('result URLs accept only Densuke links and upgrade HTTP to HTTPS',()=>{
  assert.deepEqual(resultLinks(completed),result);
  assert.deepEqual(resultLinks(completed.replaceAll('https://www.densuke.biz','http://densuke.biz')),result);
  for(const html of [completed.replaceAll('www.densuke.biz','evil.example'),completed.replace('/edit?','/other?')])assert.throws(()=>resultLinks(html));
});
test('client submits fixed mail once and never auto-retries creation',async()=>{
  const requests=[];
  const client=createDensukeClient(async(url,options)=>{requests.push({url,options});return new Response(requests.length===1?confirm():completed);});
  assert.deepEqual(await client.create(event(),email),result);
  assert.deepEqual(requests.map(r=>new URL(r.url).pathname),['/confirm','/create']);
  assert.equal(requests[1].options.body.get('email'),email);assert.equal(requests[1].options.redirect,'manual');
  let count=0;const broken=createDensukeClient(async()=>{count++;if(count===1)return new Response(confirm());throw new Error('timeout');});
  await assert.rejects(broken.create(event(),email),UncertainCreation);assert.equal(count,2);
});
test('result extraction supports textarea and plain URLs and preserves edit credentials',()=>{
  const html=`<h2>イベント作成完了</h2><textarea>${result.answer}</textarea><div>${result.edit.replace('&','&amp;')}</div>`;
  assert.deepEqual(resultLinks(html),result);
  assert.throws(()=>eventLinks(result.answer,result.edit.replace('Answer123','Other123')));
  assert.deepEqual(eventLinks(result.answer+'&pw=NeverShare',result.edit),result);
});
test('completion redirect uses GET once and never repeats the create POST',async()=>{
  const calls=[];
  const client=createDensukeClient(async(url,options)=>{
    calls.push({url,method:options.method});
    if(calls.length===1)return new Response(confirm());
    if(calls.length===2)return new Response(null,{status:303,headers:{location:'https://densuke.biz/complete'}});
    return new Response(`<textarea>${result.answer}\n${result.edit.replace('&','&amp;')}</textarea>`);
  });
  assert.deepEqual(await client.create(event(),email),result);
  assert.deepEqual(calls.map(c=>c.method),['POST','POST','GET']);
});
test('external redirects and redirects requiring a repeated POST are rejected',async()=>{
  for(const [status,location] of [[302,'https://evil.example/complete'],[307,'https://www.densuke.biz/create']]){
    let calls=0;const client=createDensukeClient(async()=>{calls++;return calls===1?new Response(confirm()):new Response(null,{status,headers:{location}});});
    await assert.rejects(client.create(event(),email),UncertainCreation);assert.equal(calls,2);
  }
});
test('confirmation failure never sends creation and responses have a size limit',async()=>{
  let count=0;const client=createDensukeClient(async()=>{count++;return new Response('changed page');});
  await assert.rejects(client.create(event(),email));assert.equal(count,1);
  const huge=createDensukeClient(async()=>new Response('x'.repeat(1024*1024+1)));
  await assert.rejects(huge.create(event(),email),/大きすぎ/);
});
function fixture(fail=false){
  let now=0,calls=0,c={densukeEmail:null};const posts=[],mails=[];
  const settings={get:()=>structuredClone(c),async update(fn){const next=structuredClone(c);fn(next);c=next;}};
  const controller=createDensukeController({email,settings,now:()=>now,client:{async create(e,destination){calls++;mails.push(destination);if(fail)throw new UncertainCreation('uncertain');return result;}}});
  const interaction=(id,extra={})=>({customId:id,user:{id:'owner'},memberPermissions:new PermissionsBitField(P.Administrator),channelId:'channel',channel:{async send(m){posts.push(m);}},message:{},deferred:false,replied:false,
    isModalSubmit:()=>id?.includes(':submit')??false,async deferReply(){this.deferred=true;},async deferUpdate(){this.deferred=true;},async reply(m){this.replied=true;this.result=m;},async editReply(m){this.result=m;},async showModal(m){this.modal=m;},...extra});
  async function open(){await controller.open(interaction());return [...controller.sessions.sessions.values()].at(-1);}
  return {controller,interaction,open,calls:()=>calls,posts,mails,settings,setTime:v=>now=v};
}
test('modal stays private, review is required, duplicate creation is refused and sharing excludes secrets',async()=>{
  const f=fixture(),s=await f.open(),act=(action,extra)=>f.interaction(`densuke:${s.id}:${action}`,extra);
  const form=act('form');await f.controller.handle(form);assert.ok(form.modal);assert.equal(form.deferred,false);
  await f.controller.handle(act('create'));assert.equal(f.calls(),0);
  await f.controller.handle(act('choice',{values:['3']}));
  await f.controller.handle(act('submit',{fields:{getTextInputValue:key=>event()[key]}}));assert.equal(s.phase,'review');
  const screen=JSON.stringify(densukeScreen(s));assert.ok(!screen.includes('aB123'));assert.ok(!screen.includes(email));
  await f.controller.handle(act('create'));await f.controller.handle(act('create'));assert.equal(f.calls(),1);
  await f.controller.handle(act('share'));await f.controller.handle(act('share'));assert.equal(f.posts.length,1);
  const shared=JSON.stringify(f.posts[0]);assert.ok(!shared.includes('Secret123'));assert.ok(!shared.includes(email));assert.ok(!shared.includes('aB123'));
});
test('revoked permissions, foreign owners and uncertain results cannot create again',async()=>{
  const f=fixture(true),s=await f.open();s.event=event();s.phase='review';
  const id=`densuke:${s.id}:create`;
  await f.controller.handle(f.interaction(id,{memberPermissions:new PermissionsBitField()}));
  await f.controller.handle(f.interaction(id,{user:{id:'stranger'}}));assert.equal(f.calls(),0);
  await f.controller.handle(f.interaction(id));assert.equal(s.phase,'uncertain');
  await f.controller.handle(f.interaction(id));assert.equal(f.calls(),1);
});
test('reopening cannot reset creation limits, and cancellation never creates an event',async()=>{
  const f=fixture(),s=await f.open();s.event=event();s.phase='review';await f.controller.handle(f.interaction(`densuke:${s.id}:create`));
  const next=await f.open();next.event=event();next.phase='review';await f.controller.handle(f.interaction(`densuke:${next.id}:create`));assert.equal(f.calls(),1);
  await f.controller.handle(f.interaction(`densuke:${next.id}:cancel`));assert.equal(next.phase,'closed');
});
test('largest form and preview fit Discord limits',()=>{
  const s={id:'test',phase:'review',event:{...event(),name:'a'.repeat(250),schedule:'a'.repeat(4000),description:'a'.repeat(2000)}};
  assert.equal(densukeModal(s).toJSON().components.length,4);
  const m=densukeScreen(s);assert.ok(m.embeds[0].toJSON().description.length<4096);m.components.forEach(r=>r.toJSON());
  densukeEmailModal(s,email).toJSON();
});
test('email settings use a private modal, retain the event draft and override the environment fallback',async()=>{
  const f=fixture(),s=await f.open();s.event=event();s.phase='review';
  const form=f.interaction(`densuke:${s.id}:form-email`);await f.controller.handle(form);
  assert.ok(form.modal);assert.equal(form.deferred,false);
  const submit=f.interaction(`densuke:${s.id}:submit-email`,{fields:{getTextInputValue:()=> 'new@example.com'}});
  await f.controller.handle(submit);assert.equal(f.settings.get().densukeEmail,'new@example.com');
  assert.equal(s.event.name,event().name);assert.equal(s.phase,'review');assert.equal(f.calls(),0);
  assert.ok(!JSON.stringify(submit.result).includes('new@example.com'));
  await f.controller.handle(f.interaction(`densuke:${s.id}:create`));assert.deepEqual(f.mails,['new@example.com']);
});
test('invalid or unauthorized email edits never persist, and stale edits never overwrite',async()=>{
  const f=fixture(),s=await f.open();const act=(a,extra)=>f.interaction(`densuke:${s.id}:${a}`,extra);
  await f.controller.handle(act('form-email'));
  await f.controller.handle(act('submit-email',{fields:{getTextInputValue:()=> 'bad\naddress'}}));assert.equal(f.settings.get().densukeEmail,null);
  await f.controller.handle(act('submit-email',{memberPermissions:new PermissionsBitField(),fields:{getTextInputValue:()=> 'new@example.com'}}));assert.equal(f.settings.get().densukeEmail,null);
  await f.settings.update(c=>c.densukeEmail='other@example.com');
  await f.controller.handle(act('submit-email',{fields:{getTextInputValue:()=> 'new@example.com'}}));assert.equal(f.settings.get().densukeEmail,'other@example.com');
});
test('another administrator changing the recipient requires review before event submission',async()=>{
  const f=fixture(),s=await f.open(),act=(a,extra)=>f.interaction(`densuke:${s.id}:${a}`,extra);
  await f.controller.handle(act('submit',{fields:{getTextInputValue:key=>event()[key]}}));
  await f.settings.update(c=>c.densukeEmail='other@example.com');
  await f.controller.handle(act('create'));assert.equal(f.calls(),0);
  await f.controller.handle(act('submit',{fields:{getTextInputValue:key=>event()[key]}}));
  await f.controller.handle(act('create'));assert.deepEqual(f.mails,['other@example.com']);
});
test('existing event recovery works after restart without creation or exposing edit credentials',async()=>{
  const f=fixture(),s=await f.open(),act=(action,extra)=>f.interaction(`densuke:${s.id}:${action}`,extra);
  const form=act('form-recover');await f.controller.handle(form);assert.ok(form.modal);assert.equal(form.deferred,false);
  await f.controller.handle(act('submit-recover',{fields:{getTextInputValue:key=>result[key]}}));
  assert.equal(s.phase,'done');assert.equal(f.calls(),0);
  await f.controller.handle(act('share'));assert.equal(f.posts.length,1);assert.ok(!JSON.stringify(f.posts[0]).includes('Secret123'));
});
test('new-event shortcut clears old secrets and sharing state without resetting creation limits',async()=>{
  const f=fixture(),s=await f.open();s.event=event();s.phase='review';
  const act=a=>f.interaction(`densuke:${s.id}:${a}`);
  await f.controller.handle(act('create'));await f.controller.handle(act('share'));
  assert.equal(s.shared,true);
  await f.controller.handle(act('restart'));
  assert.equal(s.phase,'draft');assert.equal(s.event.password,'');assert.equal(s.event.name,'');
  assert.equal(s.result,undefined);assert.equal(s.shared,undefined);
  s.event=event();s.phase='review';await f.controller.handle(act('create'));assert.equal(f.calls(),1);
});
test('uncertain creation cannot use new-event shortcut to recreate an event',async()=>{
  const f=fixture(true),s=await f.open();s.event=event();s.phase='review';
  await f.controller.handle(f.interaction(`densuke:${s.id}:create`));
  await f.controller.handle(f.interaction(`densuke:${s.id}:restart`));
  assert.equal(s.phase,'uncertain');assert.equal(f.calls(),1);
});
