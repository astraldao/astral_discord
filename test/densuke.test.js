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
function actionId(s,action){
  if(action==='create'){
    if(s.phase==='review')return densukeScreen(s).components.flatMap(row=>row.toJSON().components).find(c=>c.label==='この内容で作成').custom_id;
    return `densuke:${s.id}:create:closed`;
  }
  if(action==='submit'){if(!s.eventToken)densukeModal(s);return `densuke:${s.id}:submit:${s.eventToken}`;}
  if(action==='submit-email')return `densuke:${s.id}:submit-email:${s.emailToken??'closed'}`;
  if(['choice','form','cancel','share','restart','form-email','form-recover'].includes(action))return densukeScreen(s).components.flatMap(row=>row.toJSON().components).find(c=>c.custom_id?.split(':')[2]===action)?.custom_id??`densuke:${s.id}:${action}:closed`;
  return `densuke:${s.id}:${action}`;
}
function fixture(fail=false){
  let now=0,calls=0,c={densukeEmail:null};const posts=[],mails=[];
  const settings={get:()=>structuredClone(c),async update(fn,check=()=>{}){await check();const next=structuredClone(c);fn(next);c=next;}};
  const controller=createDensukeController({email,settings,now:()=>now,client:{async create(e,destination){calls++;mails.push(destination);if(fail)throw new UncertainCreation('uncertain');return result;}}});
  const interaction=(id,extra={})=>({customId:id,user:{id:'owner'},memberPermissions:new PermissionsBitField(P.Administrator),channelId:'channel',channel:{async send(m){posts.push(m);}},message:{},deferred:false,replied:false,
    isModalSubmit:()=>id?.includes(':submit')??false,async deferReply(){this.deferred=true;},async deferUpdate(){this.deferred=true;},async reply(m){this.replied=true;this.result=m;},async editReply(m){this.result=m;},async showModal(m){this.modal=m;},...extra});
  async function open(){await controller.open(interaction());return [...controller.sessions.sessions.values()].at(-1);}
  return {controller,interaction,open,calls:()=>calls,posts,mails,settings,setTime:v=>now=v};
}
test('modal stays private, review is required, duplicate creation is refused and sharing excludes secrets',async()=>{
  const f=fixture(),s=await f.open(),act=(action,extra)=>f.interaction(actionId(s,action),extra);
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
  const id=actionId(s,'create');
  await f.controller.handle(f.interaction(id,{memberPermissions:new PermissionsBitField()}));
  await f.controller.handle(f.interaction(id,{user:{id:'stranger'}}));assert.equal(f.calls(),0);
  await f.controller.handle(f.interaction(id));assert.equal(s.phase,'uncertain');
  await f.controller.handle(f.interaction(id));assert.equal(f.calls(),1);
});
test('reopening cannot reset creation limits, and cancellation never creates an event',async()=>{
  const f=fixture(),s=await f.open();s.event=event();s.phase='review';await f.controller.handle(f.interaction(actionId(s,'create')));
  const next=await f.open();next.event=event();next.phase='review';await f.controller.handle(f.interaction(actionId(next,'create')));assert.equal(f.calls(),1);
  await f.controller.handle(f.interaction(actionId(next,'cancel')));assert.equal(next.phase,'closed');
});
test('reopening preserves drafts and uncertain or completed results without creating or sharing anything',async()=>{
  for(const phase of ['draft','review','uncertain','done']){
    const f=fixture(),s=await f.open(),expires=s.expires;s.event=event();s.phase=phase;s.inputDraft={...event(),name:'入力中'};
    if(phase==='done')s.result={answer:result.answer,edit:result.edit};
    f.setTime(120000);const again=await f.open();assert.equal(again,s);assert.equal(again.phase,phase);assert.equal(again.inputDraft.name,'入力中');assert.equal(again.expires,expires);assert.equal(f.calls(),0);assert.equal(f.posts.length,0);
    f.setTime(600000);assert.notEqual((await f.open()).id,s.id);
  }
});
test('reopening during a create cannot evict the session or invite another request',async()=>{
  let finish,calls=0;const f=fixture();const c=createDensukeController({email,client:{create:async()=>{calls++;await new Promise(r=>finish=r);return result;}}});
  await c.open(f.interaction());const s=[...c.sessions.sessions.values()][0];s.event=event();s.phase='review';const creating=c.handle(f.interaction(actionId(s,'create')));await new Promise(r=>setImmediate(r));
  await assert.rejects(c.open(f.interaction()),/処理中/);assert.equal(c.sessions.sessions.get(s.id),s);assert.equal(calls,1);finish();await creating;assert.equal(s.phase,'done');
});
test('largest form and preview fit Discord limits',()=>{
  const s={id:'test',phase:'review',event:{...event(),name:'a'.repeat(250),schedule:'a'.repeat(4000),description:'a'.repeat(2000)}};
  assert.equal(densukeModal(s).toJSON().components.length,4);
  const m=densukeScreen(s);assert.ok(m.embeds[0].toJSON().description.length<4096);m.components.forEach(r=>r.toJSON());
  densukeEmailModal(s,email).toJSON();
});
test('email settings use a private modal, retain the event draft and override the environment fallback',async()=>{
  const f=fixture(),s=await f.open();s.event=event();s.phase='review';
  const form=f.interaction(actionId(s,'form-email'));await f.controller.handle(form);
  assert.ok(form.modal);assert.equal(form.deferred,false);
  const submit=f.interaction(form.modal.toJSON().custom_id,{fields:{getTextInputValue:()=> 'new@example.com'}});
  await f.controller.handle(submit);assert.equal(f.settings.get().densukeEmail,'new@example.com');
  assert.equal(s.event.name,event().name);assert.equal(s.phase,'review');assert.equal(f.calls(),0);
  assert.ok(!JSON.stringify(submit.result).includes('new@example.com'));
  await f.controller.handle(f.interaction(actionId(s,'create')));assert.deepEqual(f.mails,['new@example.com']);
});
test('invalid or unauthorized email edits never persist, and stale edits never overwrite',async()=>{
  const f=fixture(),s=await f.open();const act=(a,extra)=>f.interaction(actionId(s,a),extra);
  await f.controller.handle(act('form-email'));
  await f.controller.handle(act('submit-email',{fields:{getTextInputValue:()=> 'bad\naddress'}}));assert.equal(f.settings.get().densukeEmail,null);
  await f.controller.handle(act('submit-email',{memberPermissions:new PermissionsBitField(),fields:{getTextInputValue:()=> 'new@example.com'}}));assert.equal(f.settings.get().densukeEmail,null);
  await f.settings.update(c=>c.densukeEmail='other@example.com');
  await f.controller.handle(act('submit-email',{fields:{getTextInputValue:()=> 'new@example.com'}}));assert.equal(f.settings.get().densukeEmail,'other@example.com');
});
test('another administrator changing the recipient requires review before event submission',async()=>{
  const f=fixture(),s=await f.open(),act=(a,extra)=>f.interaction(actionId(s,a),extra);
  await f.controller.handle(act('submit',{fields:{getTextInputValue:key=>event()[key]}}));
  await f.settings.update(c=>c.densukeEmail='other@example.com');
  await f.controller.handle(act('create'));assert.equal(f.calls(),0);
  await f.controller.handle(act('submit',{fields:{getTextInputValue:key=>event()[key]}}));
  await f.controller.handle(act('create'));assert.deepEqual(f.mails,['other@example.com']);
});
test('existing event recovery works after restart without creation or exposing edit credentials',async()=>{
  const f=fixture(),s=await f.open(),act=(action,extra)=>f.interaction(actionId(s,action),extra);
  const form=act('form-recover');await f.controller.handle(form);assert.ok(form.modal);assert.equal(form.deferred,false);
  await f.controller.handle(act(`submit-recover:${s.recoverToken}`,{fields:{getTextInputValue:key=>result[key]}}));
  assert.equal(s.phase,'done');assert.equal(f.calls(),0);
  await f.controller.handle(act('share'));assert.equal(f.posts.length,1);assert.ok(!JSON.stringify(f.posts[0]).includes('Secret123'));
});
test('new-event shortcut clears old secrets and sharing state without resetting creation limits',async()=>{
  const f=fixture(),s=await f.open();s.event=event();s.phase='review';
  const act=a=>f.interaction(actionId(s,a));
  await f.controller.handle(act('create'));await f.controller.handle(act('share'));
  assert.equal(s.shared,true);
  await f.controller.handle(act('restart'));
  assert.equal(s.phase,'draft');assert.equal(s.event.password,'');assert.equal(s.event.name,'');
  assert.equal(s.result,undefined);assert.equal(s.shared,undefined);
  s.event=event();s.phase='review';await f.controller.handle(act('create'));assert.equal(f.calls(),1);
});
test('uncertain creation cannot use new-event shortcut to recreate an event',async()=>{
  const f=fixture(true),s=await f.open();s.event=event();s.phase='review';
  await f.controller.handle(f.interaction(actionId(s,'create')));
  await f.controller.handle(f.interaction(actionId(s,'restart')));
  assert.equal(s.phase,'uncertain');assert.equal(f.calls(),1);
});
test('invalid form submission preserves corrections privately and cannot create the previous valid event',async()=>{
  const f=fixture(),s=await f.open();s.event=event();s.phase='review';
  const invalid={...event(),name:'新しい卓',password:'BAD_12'};
  const act=(a,extra)=>f.interaction(actionId(s,a),extra);
  const submit=act('submit',{fields:{getTextInputValue:key=>invalid[key]}});await f.controller.handle(submit);
  assert.equal(s.phase,'draft');assert.ok(!JSON.stringify(submit.result).includes(invalid.password));
  await f.controller.handle(act('create'));assert.equal(f.calls(),0);
  const form=act('form');await f.controller.handle(form);
  const fields=form.modal.toJSON().components.map(r=>r.components[0]);
  assert.equal(fields[0].value,invalid.name);assert.equal(fields[1].value,invalid.schedule);assert.equal(fields[3].value,invalid.password);
  const foreign=act('form',{user:{id:'stranger'}});await f.controller.handle(foreign);assert.ok(!foreign.modal);assert.ok(!JSON.stringify(foreign.result).includes(invalid.password));
  await f.controller.handle(act('submit',{fields:{getTextInputValue:key=>({...invalid,password:'OK12'})[key]}}));
  assert.equal(s.phase,'review');assert.equal(s.inputDraft,undefined);
  await f.controller.handle(act('create'));assert.equal(f.calls(),1);
  assert.ok(JSON.stringify(densukeScreen(s)).includes('<#channel>'));
  await f.controller.handle(act('share'));assert.ok(!JSON.stringify(f.posts).includes('Secret123'));
});
test('failed input draft is bounded and discarded on cancellation',async()=>{
  const f=fixture(),s=await f.open();const fields={...event(),schedule:'x'.repeat(5000),password:'BAD_12'};
  await f.controller.handle(f.interaction(actionId(s,'submit'),{fields:{getTextInputValue:key=>fields[key]}}));
  assert.equal(s.phase,'draft');assert.equal(s.inputDraft.schedule.length,4000);densukeModal(s).toJSON();
  await f.controller.handle(f.interaction(actionId(s,'cancel')));assert.equal(s.inputDraft,undefined);assert.equal(s.event.password,'');
});

test('uncertain creation recovers from an answer URL alone and never repeats creation',async()=>{
  const f=fixture(true),s=await f.open(),act=(a,extra)=>f.interaction(actionId(s,a),extra);s.event=event();s.phase='review';await f.controller.handle(act('create'));assert.equal(s.phase,'uncertain');await f.controller.handle(act('form-recover'));const i=act(`submit-recover:${s.recoverToken}`,{fields:{getTextInputValue:key=>{assert.equal(key,'answer');return result.answer;}}});await f.controller.handle(i);assert.equal(s.phase,'done');assert.equal(f.calls(),1);assert.equal(s.result.edit,undefined);assert.ok(!JSON.stringify(i.result).includes('undefined'));assert.ok(!JSON.stringify(i.result).includes('Secret123'));await f.controller.handle(act('share'));assert.equal(f.posts.length,1);assert.equal(f.calls(),1);
});
test('recovery rejects wrong sessions, old forms, edit URLs and wrong channels while retaining invalid input',async()=>{
  const f=fixture(),s=await f.open(),act=(a,extra)=>f.interaction(actionId(s,a),extra);await f.controller.handle(act('form-recover'));const old=s.recoverToken;await f.controller.handle(act('form-recover'));await f.controller.handle(act(`submit-recover:${old}`,{fields:{getTextInputValue:()=>result.answer}}));assert.equal(s.phase,'draft');await f.controller.handle(act(`submit-recover:${s.recoverToken}`,{fields:{getTextInputValue:()=>result.edit}}));assert.equal(s.phase,'draft');assert.equal(s.recoverDraft,result.edit);await f.controller.handle(act('form-recover'));const token=s.recoverToken;const wrong=act(`submit-recover:${token}`,{channelId:'wrong',fields:{getTextInputValue:()=>result.answer}});await f.controller.handle(wrong);assert.equal(s.phase,'draft');await f.controller.handle(act(`submit-recover:${token}`,{user:{id:'other'},fields:{getTextInputValue:()=>result.answer}}));assert.equal(s.phase,'draft');assert.equal(f.calls(),0);
});
test('revoked administrator cannot recover or receive private results after acknowledgement',async()=>{
  let allowed=true;const guild={members:{fetch:async()=>({permissions:new PermissionsBitField(allowed?P.Administrator:0n)})},channels:{fetch:async()=>({permissionsFor:()=>({has:()=>true})})}};const c=createDensukeController({email,guild}),s=c.sessions.create('owner');Object.assign(s,{phase:'uncertain',channelId:'channel',event:event(),recoverToken:'token',recoverPhase:'uncertain'});const replies=[];const i={customId:`densuke:${s.id}:submit-recover:token`,user:{id:'owner'},channelId:'channel',fields:{getTextInputValue:()=>result.answer},async deferReply(){this.deferred=true;allowed=false;},async editReply(p){replies.push(p);}};await c.handle(i);assert.equal(s.phase,'uncertain');assert.ok(!JSON.stringify(replies).includes('卓の日程'));assert.ok(!JSON.stringify(replies).includes('回答用URL'));assert.ok(JSON.stringify(replies).includes('管理者専用'));
});

test('pre-create check runs once after valid confirmation and refusal never becomes uncertain',async()=>{
  for(const refuse of [false,true]){
    const paths=[];let checks=0;
    const client=createDensukeClient(async url=>{paths.push(new URL(url).pathname);return new Response(paths.length===1?confirm():completed);});
    const blocked=new Error('authorization changed');
    const pending=client.create(event(),email,{beforeCreate:async()=>{checks++;assert.deepEqual(paths,['/confirm']);if(refuse)throw blocked;}});
    if(refuse)await assert.rejects(pending,error=>error===blocked && !(error instanceof UncertainCreation));else assert.deepEqual(await pending,result);
    assert.equal(checks,1);assert.deepEqual(paths,refuse?['/confirm']:['/confirm','/create']);
  }
  let checks=0;const client=createDensukeClient(async()=>new Response('invalid confirmation'));
  await assert.rejects(client.create(event(),email,{beforeCreate:async()=>{checks++;}}));assert.equal(checks,0);
});

for(const change of ['administrator','visibility','expiry','recipient','replacement','phase','review-token'])test(`confirmation wait rechecks ${change} before sending create`,async()=>{
  let allowed=true,visible=true,time=0,destination=email,release,started;
  const waiting=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve),paths=[];
  const guild={members:{fetch:async()=>({permissions:new PermissionsBitField(allowed?P.Administrator:0n)})},channels:{fetch:async()=>({permissionsFor:()=>({has:()=>visible})})}};
  const client=createDensukeClient(async url=>{paths.push(new URL(url).pathname);if(paths.length===1){started();await gate;return new Response(confirm());}return new Response(completed);});
  const controller=createDensukeController({email,guild,client,now:()=>time,settings:{get:()=>({densukeEmail:destination})}});
  const f=fixture();await controller.open(f.interaction());const s=[...controller.sessions.sessions.values()][0];Object.assign(s,{event:event(),phase:'review'});
  const i=f.interaction(actionId(s,'create')),pending=controller.handle(i);await waiting;
  if(change==='administrator')allowed=false;
  if(change==='visibility')visible=false;
  if(change==='expiry')time=s.expires;
  if(change==='recipient')destination='changed@example.com';
  if(change==='replacement')controller.sessions.create('owner');
  if(change==='phase')s.phase='closed';
  if(change==='review-token')s.reviewToken='changed-review';
  release();await pending;assert.deepEqual(paths,['/confirm']);assert.equal(s.phase,'review');assert.equal(s.result,undefined);assert.equal(s.busy,false);
  const rendered=JSON.stringify(i.result);assert.ok(!rendered.includes(result.edit));assert.ok(!rendered.includes(event().password));
  if(['administrator','visibility','expiry','replacement'].includes(change))assert.ok(!rendered.includes(event().name));
  if(change==='recipient')assert.ok(rendered.includes('固定メールが変更'));
});

test('network failure after permission loss cannot redisplay private event details',async()=>{
  let allowed=true;
  const guild={members:{fetch:async()=>({permissions:new PermissionsBitField(allowed?P.Administrator:0n)})},channels:{fetch:async()=>({permissionsFor:()=>({has:()=>true})})}};
  const f=fixture(),controller=createDensukeController({email,guild,client:{create:async()=>{allowed=false;throw new Error('network failure');}}});
  await controller.open(f.interaction());const s=[...controller.sessions.sessions.values()][0];Object.assign(s,{event:event(),phase:'review'});
  const i=f.interaction(actionId(s,'create'));await controller.handle(i);
  const rendered=JSON.stringify(i.result);assert.ok(rendered.includes('管理者専用'));assert.ok(!rendered.includes(event().name));assert.ok(!rendered.includes('network failure'));assert.equal(s.busy,false);
});

function delayedCreationNotice(f,s,user='owner'){
  let enter,release,reject,first=true;const entered=new Promise(resolve=>enter=resolve),gate=new Promise((resolve,fail)=>{release=resolve;reject=fail;});
  const i=f.interaction(actionId(s,'create'),{user:{id:user},async editReply(message){this.result=message;if(first){first=false;enter();await gate;}}});
  return {i,entered,release,reject};
}
test('failed pre-send notice restores review without consuming creation cooldown and allows explicit retry',async()=>{
  const f=fixture(),s=await f.open();Object.assign(s,{event:event(),phase:'review'});let updates=0;
  const i=f.interaction(actionId(s,'create'),{async editReply(message){this.result=message;if(++updates===1)throw new Error('simulated notice failure');}});
  await f.controller.handle(i);assert.equal(s.phase,'review');assert.equal(s.busy,false);assert.equal(f.calls(),0);
  await f.controller.handle(f.interaction(actionId(s,'create')));assert.equal(f.calls(),1);assert.equal(s.phase,'done');
});
test('expired response tokens still restore a pre-send draft when even the error reply fails',async()=>{
  const f=fixture(),s=await f.open();Object.assign(s,{event:event(),phase:'review'});
  await assert.rejects(f.controller.handle(f.interaction(actionId(s,'create'),{async editReply(){throw Object.assign(new Error('expired response'),{code:10062});}})));
  assert.equal(s.phase,'review');assert.equal(s.busy,false);assert.equal(f.calls(),0);
  assert.equal(await f.open(),s);await f.controller.handle(f.interaction(actionId(s,'create')));assert.equal(f.calls(),1);
});
test('two administrators awaiting notices recheck the global limit before either starts the client',{timeout:5000},async t=>{
  const f=fixture(),a=await f.open(),b=f.controller.sessions.create('second');for(const s of [a,b])Object.assign(s,{channelId:'channel',event:event(),phase:'review',reviewEmail:email});
  const first=delayedCreationNotice(f,a),second=delayedCreationNotice(f,b,'second');t.after(()=>{first.release();second.release();});
  const pendingA=f.controller.handle(first.i);await first.entered;const pendingB=f.controller.handle(second.i);
  const stage=await Promise.race([second.entered.then(()=> 'notice'),pendingB.then(()=> 'finished')]);assert.equal(stage,'notice');
  first.release();second.release();await Promise.all([pendingA,pendingB]);assert.equal(f.calls(),1);assert.deepEqual([a.phase,b.phase].sort(),['done','review']);
});
test('a failing delayed notice cannot erase another administrator creation reservation',{timeout:5000},async t=>{
  const f=fixture(),a=await f.open(),b=f.controller.sessions.create('second');for(const s of [a,b])Object.assign(s,{channelId:'channel',event:event(),phase:'review',reviewEmail:email});
  const first=delayedCreationNotice(f,a);t.after(()=>first.release());const pendingA=f.controller.handle(first.i);await first.entered;
  await f.controller.handle(f.interaction(actionId(b,'create'),{user:{id:'second'}}));assert.equal(f.calls(),1);
  first.reject(new Error('simulated notice failure'));await pendingA;assert.equal(a.phase,'review');
  await f.controller.handle(f.interaction(actionId(a,'create')));assert.equal(f.calls(),1);
  f.setTime(61000);await f.controller.handle(f.interaction(actionId(a,'create')));assert.equal(f.calls(),2);assert.equal(a.phase,'done');
});
for(const change of ['administrator','visibility','expiry','recipient','replacement','phase','review-token'])test(`pre-send notice wait rechecks ${change} before even confirming with Densuke`,{timeout:5000},async t=>{
  let allowed=true,visible=true,time=0,destination=email;const paths=[];
  const guild={members:{fetch:async()=>({permissions:new PermissionsBitField(allowed?P.Administrator:0n)})},channels:{fetch:async()=>({permissionsFor:()=>({has:()=>visible})})}};
  const client=createDensukeClient(async url=>{paths.push(new URL(url).pathname);return new Response(paths.length===1?confirm():completed);});
  const controller=createDensukeController({email,guild,client,now:()=>time,settings:{get:()=>({densukeEmail:destination})}}),f=fixture();
  await controller.open(f.interaction());const s=[...controller.sessions.sessions.values()][0];Object.assign(s,{event:event(),phase:'review'});
  const notice=delayedCreationNotice(f,s);t.after(()=>notice.release());const pending=controller.handle(notice.i);await notice.entered;
  if(change==='administrator')allowed=false;if(change==='visibility')visible=false;if(change==='expiry')time=s.expires;if(change==='recipient')destination='changed@example.com';if(change==='replacement')controller.sessions.create('owner');if(change==='phase')s.phase='closed';if(change==='review-token')s.reviewToken='changed-review';
  notice.release();await pending;assert.deepEqual(paths,[]);assert.equal(s.phase,'review');assert.equal(s.busy,false);
  const rendered=JSON.stringify(notice.i.result);assert.ok(!rendered.includes(event().password));assert.ok(!rendered.includes(result.edit));
  if(['administrator','visibility','expiry','replacement'].includes(change))assert.ok(!rendered.includes(event().name));
});

test('confirmation traffic still consumes creation limits when the later pre-create permission check refuses',{timeout:5000},async t=>{
  let allowed=true,time=0,release,enter,first=true;const entered=new Promise(resolve=>enter=resolve),gate=new Promise(resolve=>release=resolve),paths=[];t.after(()=>release());
  const guild={members:{fetch:async()=>({permissions:new PermissionsBitField(allowed?P.Administrator:0n)})},channels:{fetch:async()=>({permissionsFor:()=>({has:()=>true})})}};
  const client=createDensukeClient(async url=>{const path=new URL(url).pathname;paths.push(path);if(path==='/confirm'){if(first){first=false;enter();await gate;}return new Response(confirm());}return new Response(completed);});
  const controller=createDensukeController({email,guild,client,now:()=>time}),f=fixture();await controller.open(f.interaction());const s=[...controller.sessions.sessions.values()][0];Object.assign(s,{event:event(),phase:'review'});
  const act=()=>controller.handle(f.interaction(actionId(s,'create'))),pending=act();await entered;allowed=false;release();await pending;assert.deepEqual(paths,['/confirm']);assert.equal(s.phase,'review');
  allowed=true;await act();time=61000;await act();assert.deepEqual(paths,['/confirm']);time=300001;await act();assert.deepEqual(paths,['/confirm','/confirm','/create']);assert.equal(s.phase,'done');
});
test('failure to display a successful creation keeps the completed result and never offers to create it again',async()=>{
  const f=fixture(),s=await f.open();Object.assign(s,{event:event(),phase:'review'});let updates=0;
  const i=f.interaction(actionId(s,'create'),{async editReply(message){this.result=message;if(++updates>1)throw Object.assign(new Error('expired response'),{code:10062});}});
  await assert.rejects(f.controller.handle(i));assert.equal(s.phase,'done');assert.equal(s.busy,false);assert.equal(f.calls(),1);assert.deepEqual(s.result,result);
  const reopened=f.interaction();await f.controller.open(reopened);assert.ok(JSON.stringify(reopened.result).includes(result.answer));
  await f.controller.handle(f.interaction(actionId(s,'create')));assert.equal(f.calls(),1);assert.equal(s.phase,'done');
});

const shareButton=i=>i.result.components.flatMap(r=>r.toJSON().components).find(c=>c.custom_id?.split(':')[2]==='share');
test('known Discord send denials keep answer sharing retryable after correction',async()=>{
  for(const code of [10003,50001,50013,50035]){
    const f=fixture(),s=await f.open();Object.assign(s,{phase:'done',event:event(),result:{...result}});let sends=0,posts=0;
    const channel={send:async()=>{if(++sends===1)throw Object.assign(new Error('known rejection'),{code});posts++;}};
    const first=f.interaction(actionId(s,'share'),{channel});await f.controller.handle(first);assert.equal(s.shared,false);assert.equal(s.shareUncertain,undefined);assert.equal(shareButton(first).disabled,false);assert.equal(shareButton(first).label,'回答URLを共有');
    await f.controller.handle(f.interaction(actionId(s,'share'),{channel}));await f.controller.handle(f.interaction(actionId(s,'share'),{channel}));assert.equal(sends,2);assert.equal(posts,1);assert.equal(s.shared,true);assert.equal(s.shareUncertain,undefined);
  }
});
test('unknown answer-share outcomes stay visibly unconfirmed and never invite a duplicate send',async()=>{
  const f=fixture(),s=await f.open();Object.assign(s,{phase:'done',event:event(),result:{...result}});let sends=0;
  const channel={send:async()=>{sends++;throw new Error('simulated unknown outcome');}},first=f.interaction(actionId(s,'share'),{channel});await f.controller.handle(first);
  assert.equal(s.shared,true);assert.equal(s.shareUncertain,true);assert.equal(shareButton(first).label,'共有結果は未確認');assert.equal(shareButton(first).disabled,true);
  const reopened=f.interaction();await f.controller.open(reopened);assert.equal(shareButton(reopened).label,'共有結果は未確認');
  const repeated=f.interaction(actionId(s,'share'),{channel});await f.controller.handle(repeated);assert.ok(JSON.stringify(repeated.result).includes('未確認'));assert.ok(!JSON.stringify(repeated.result).includes('このイベントは共有済みです'));assert.equal(sends,1);assert.deepEqual(s.result,result);
});
test('sharing in progress is not labelled as confirmed and concurrent clicks send only once',{timeout:5000},async t=>{
  const f=fixture(),s=await f.open();Object.assign(s,{phase:'done',event:event(),result:{...result}});let enter,release,sends=0;const entered=new Promise(resolve=>enter=resolve),gate=new Promise(resolve=>release=resolve);t.after(()=>release());
  const channel={send:async()=>{sends++;enter();await gate;}},first=f.interaction(actionId(s,'share'),{channel}),pending=f.controller.handle(first);await entered;
  const duplicate=f.interaction(actionId(s,'share'),{channel});await f.controller.handle(duplicate);assert.equal(shareButton(duplicate).label,'共有結果は未確認');assert.equal(shareButton(duplicate).disabled,true);
  release();await pending;assert.equal(sends,1);assert.equal(s.shareUncertain,undefined);assert.equal(shareButton(first).label,'回答URLは共有済み');
});
test('a new event clears the previous unconfirmed sharing state without creating or posting automatically',async()=>{
  const f=fixture(),s=await f.open();Object.assign(s,{phase:'done',event:event(),result:{...result}});
  await f.controller.handle(f.interaction(actionId(s,'share'),{channel:{send:async()=>{throw new Error('unknown');}}}));assert.equal(s.shareUncertain,true);
  await f.controller.handle(f.interaction(actionId(s,'restart')));assert.equal(s.shared,undefined);assert.equal(s.shareUncertain,undefined);assert.equal(s.phase,'draft');assert.equal(f.calls(),0);assert.equal(f.posts.length,0);
});
test('permission loss after an unknown share preserves its state but hides private event details',async()=>{
  let allowed=true,sends=0;const f=fixture(),guild={members:{fetch:async()=>({permissions:new PermissionsBitField(allowed?P.Administrator:0n)})},channels:{fetch:async()=>({permissionsFor:()=>({has:()=>true})})}},controller=createDensukeController({email,guild}),s=controller.sessions.create('owner');Object.assign(s,{phase:'done',channelId:'channel',event:event(),result:{...result}});
  const i=f.interaction(actionId(s,'share'),{channel:{send:async()=>{sends++;allowed=false;throw new Error('unknown');}}});await controller.handle(i);assert.equal(s.shareUncertain,true);assert.ok(!JSON.stringify(i.result).includes(result.answer));assert.ok(!JSON.stringify(i.result).includes(event().name));
  allowed=true;const reopened=f.interaction();await controller.open(reopened);assert.equal(shareButton(reopened).label,'共有結果は未確認');assert.equal(sends,1);
});
test('a confirmed public share stays confirmed even when its private result display fails',async()=>{
  const f=fixture(),s=await f.open();Object.assign(s,{phase:'done',event:event(),result:{...result}});let sends=0;
  await assert.rejects(f.controller.handle(f.interaction(actionId(s,'share'),{channel:{send:async()=>{sends++;}},async editReply(){throw Object.assign(new Error('expired'),{code:10062});}})));
  assert.equal(s.shared,true);assert.equal(s.shareUncertain,undefined);const reopened=f.interaction();await f.controller.open(reopened);assert.equal(shareButton(reopened).label,'回答URLは共有済み');
  await f.controller.handle(f.interaction(actionId(s,'share'),{channel:{send:async()=>{sends++;}}}));assert.equal(sends,1);
});
