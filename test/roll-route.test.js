import test from 'node:test';
import assert from 'node:assert/strict';
import {routeDiceMessage} from '../src/roll-route.js';
import {diceRequest,createChatDice} from '../src/chat-dice.js';
import {createBeatApiDiceJudge} from '../src/beatapi-dice.js';
const ambiguous='この1d10どうしよう';
test('ordinary prose is limited to 29 Unicode code points after stripping Discord mention IDs',()=>{
  const text='あ'.repeat(25)+'1d10';assert.equal([...text].length,29);assert.equal(routeDiceMessage(text).kind,'judge');assert.equal(routeDiceMessage('あ'+text),null);
  const emoji='😀'.repeat(25)+'1d10';assert.equal([...emoji].length,29);assert.equal(routeDiceMessage(emoji).kind,'judge');assert.equal(routeDiceMessage('😀'+emoji),null);
  for(const prefix of ['<@123456789012345678> ','<@!123456789012345678> ','<#123456789012345678> ']){const r=routeDiceMessage(prefix+text);assert.equal(r.kind,'judge');assert.equal(r.text,text);}
  assert.equal(routeDiceMessage('1d10ふってください'+ 'ね'.repeat(30)),null);
});
test('pure huge dice expressions get local bounded-limit replies rather than disappearing or reaching a judge',()=>{
  for(const text of ['100000000d100000000000000000','9'.repeat(70)+'d'+'9'.repeat(90),'1d6+'+'9'.repeat(60),'100d1000000,100d1000000,1d6']){const r=routeDiceMessage(text);assert.equal(r.kind,'local',text);assert.match(r.request.error,/最大5式・合計200個/);assert.equal(r.text,undefined);}
  assert.ok(diceRequest('100000000d100000000000000000')?.error);
  const zeros='0'.repeat(1100);assert.deepEqual(routeDiceMessage(zeros+'1d'+zeros+'10').request.rolls,[{count:1,sides:10,modifier:0}]);
});
test('obvious requests and playful quantity declarations are local, even when no AI is configured',()=>{
  for(const text of ['1D100','1d10ふって','1d10ふってくれない？','お風呂の温度は1D100度！！','!サイゼロールふって','サイゼロール','ダイス振って','サイコロふって','ロールして'])assert.equal(routeDiceMessage(text)?.kind,'local',text);
});
test('only related ambiguous candidates reach the judge; unrelated, protected and explicit nonrequests do not',()=>{
  for(const text of [ambiguous,'このサイゼロールどうする','ダイスってどうする'])assert.equal(routeDiceMessage(text)?.kind,'judge',text);
  for(const text of ['おはよう','ありがとう','手を振って','ロールケーキ食べたい','だいすきだよ','ダイスキ','サイコロジーが面白い','ロール紙を買った','ロールバックして','画面をスクロールして','ダイスケくん','a1d10abc','1d10とは？','1d10ふった','1d10ふらない','1d10ふってもいい','1d10ふってもいい？','「1d10ふって」','`1d10ふって`','||1d10ふって||','>>> 引用\n1d10ふって','[1d10](https://example.org)','https://example.org/1d10'])assert.equal(routeDiceMessage(text),null,text);
});
function fixture(content,{decision=true,enabled=true,visible=true,deleted=false,edited=false,fail=false}={}){
  const replies=[],draws=[],judged=[],state={enabled,visible,deleted,edited},message={id:'source',guildId:'guild',channelId:'channel',author:{id:'user',bot:false},content},current={...message,reply:async data=>{replies.push(data);if(fail)throw new Error('unknown');}},member={user:{bot:false}},channel={guildId:'guild',isTextBased:()=>true,isThread:()=>false,permissionsFor:()=>({has:()=>state.visible}),messages:{fetch:async()=>{if(state.deleted)throw new Error('deleted');return {...current,content:state.edited?'1d10ふらない':content};}}},guild={id:'guild',members:{fetch:async()=>member,fetchMe:async()=>({})},channels:{fetch:async()=>channel}},controller=createChatDice({guild,enabled:()=>state.enabled,judge:async text=>{judged.push(text);return typeof decision==='function'?decision(state):decision;},random:(min,max)=>{draws.push([min,max]);return max-1;}});return {state,message,current,replies,draws,judged,controller};
}
test('overlength and unrelated messages are completely silent while huge formulas return limit guidance without drawing',async()=>{
  for(const text of ['あ'.repeat(26)+'1d10','普通の会話です','1d10ふって'+'ね'.repeat(30)]){const f=fixture(text);await f.controller.onMessage(f.message);assert.equal(f.replies.length,0);assert.equal(f.judged.length,0);assert.equal(f.draws.length,0);}
  const huge=fixture('9'.repeat(90)+'d'+'9'.repeat(120));await huge.controller.onMessage(huge.message);assert.equal(huge.replies.length,1);assert.match(huge.replies[0].embeds[0].data.description,/1〜100個/);assert.equal(huge.judged.length,0);assert.equal(huge.draws.length,0);
});
test('an allowed ambiguous message draws only after the decision and replies once with existing nonce protection',async()=>{
  const f=fixture(ambiguous,{decision:()=>{assert.equal(f.draws.length,0);return true;}});await f.controller.onMessage(f.message);await f.controller.onMessage(f.message);assert.deepEqual(f.judged,[ambiguous]);assert.deepEqual(f.draws,[[1,11]]);assert.match(f.replies[0].embeds[0].data.title,/1D10 → 10/);assert.equal(f.replies.length,1);assert.equal(f.replies[0].nonce,'source');assert.equal(f.replies[0].enforceNonce,true);assert.deepEqual(f.replies[0].allowedMentions,{parse:[],repliedUser:false});
  for(const decision of [false,undefined,'true',1]){const g=fixture(ambiguous,{decision:()=>decision});await g.controller.onMessage(g.message);assert.equal(g.replies.length,0);assert.equal(g.draws.length,0);}
});
test('external disclosure requires current access and original source; edits, deletion, OFF and revocation suppress later replies',async()=>{
  for(const options of [{visible:false},{enabled:false},{deleted:true},{edited:true}]){const f=fixture(ambiguous,options);await f.controller.onMessage(f.message);assert.equal(f.judged.length,0);assert.equal(f.draws.length,0);}
  for(const key of ['visible','enabled','deleted','edited']){const f=fixture(ambiguous,{decision:state=>{state[key]=!['visible','enabled'].includes(key);return true;}});await f.controller.onMessage(f.message);assert.equal(f.judged.length,1,key);assert.equal(f.replies.length,0,key);assert.equal(f.draws.length,0,key);}
});
test('AI approval cannot choose a formula or disclose a Saizeriya menu without the local exclamation prefix',async()=>{
  for(const text of ['このサイゼロールどうする','この!サイゼロールお願い']){const f=fixture(text);await f.controller.onMessage(f.message);assert.equal(f.judged.length,1);assert.equal(f.draws.length,3);const d=f.replies[0].embeds[0].toJSON();assert.match(d.title,/サイゼロール → 3400/);assert.equal(!!d.url,text.includes('!'));}
  const guide=fixture('ダイスってどうする');await guide.controller.onMessage(guide.message);assert.equal(guide.draws.length,0);assert.match(guide.replies[0].embeds[0].data.description,/振りたいダイスの式/);
});
test('unknown send outcomes never retry or reroll and missing judges leave only ambiguous messages silent',async()=>{
  const f=fixture(ambiguous,{fail:true});await f.controller.onMessage(f.message);await f.controller.onMessage(f.message);assert.equal(f.replies.length,1);assert.equal(f.judged.length,1);assert.equal(f.draws.length,1);
  const g=fixture('1d10ふって');await g.controller.onMessage(g.message);assert.equal(g.judged.length,0);assert.equal(g.replies.length,1);
  const h=fixture(ambiguous);const controller=createChatDice({guild:{id:'guild'}});await controller.onMessage(h.message);assert.equal(h.replies.length,0);
});

test('the real Noul adapter and chat controller compose without sending metadata or changing the locally parsed dice',async()=>{
  let requests=0;const judge=createBeatApiDiceJudge({apiKey:'fixture-key',fetcher:async(_,options)=>{requests++;assert.deepEqual(JSON.parse(options.body).state,{text:ambiguous});return new Response(JSON.stringify({model:'jev-1.14-free',answers:{should_roll:{type:'noul',noul:.95}}}),{headers:{'Content-Type':'application/json'}});}});
  const f=fixture(ambiguous,{decision:()=>judge.decide(ambiguous)});await f.controller.onMessage(f.message);assert.equal(requests,1);assert.deepEqual(f.draws,[[1,11]]);assert.equal(f.replies.length,1);assert.match(f.replies[0].embeds[0].data.title,/1D10 → 10/);
});
