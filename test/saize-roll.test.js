import test from 'node:test';
import assert from 'node:assert/strict';
import {saizeRequest,rollSaize,createChatDice} from '../src/chat-dice.js';

const replyText=m=>[m.content,...(m.embeds??[]).map(e=>{const d=e.toJSON();return [d.title,d.description,d.footer?.text].filter(Boolean).join('\n');})].filter(Boolean).join('\n');
test('saize accepts a short call or explicit request including mentions and halfwidth text',()=>{
  for(const content of ['サイゼロール','サイゼロール！','サイゼロールお願い','サイゼロールをお願いします','サイゼロールして','サイゼロールしてください','サイゼロールしてくれる？','サイゼロールしてもらえる?','じゃあサイゼロール','もう一度 サイゼロールよろしく','ｻｲｾﾞﾛｰﾙ','<@123456789012345678> サイゼロール','<@!123456789012345678> サイゼロール振って'])assert.deepEqual(saizeRequest(content),{kind:'saize'},content);
});
test('saize ignores explanations, quotations, negations, narratives and mixed or ambiguous requests',()=>{
  for(const content of ['サイゼロールとは？','サイゼロールって何','サイゼロールの説明','サイゼロールをしない','サイゼロールしなくていい','サイゼロールやめて','サイゼロール禁止','サイゼロールした','サイゼロールをしたい','サイゼロールで遊ぼう','サイゼロールしてと言われた','サイゼロールしてもいい？','例：サイゼロール','サイゼロールなら','サイゼロールという機能','サイゼロール?','「サイゼロール」','"サイゼロール"','`サイゼロール`','```\nサイゼロール\n```','||サイゼロール||','> サイゼロール','https://example.org/サイゼロール','サイゼロール1D6','サイゼロール サイゼロール','スーパーサイゼロール','サイゼロールx','(1D3)(1D4)0(1D10)','ありがとう',null,{},'サイゼロール'+' '.repeat(1001)])assert.equal(saizeRequest(content),null,String(content));
});
test('saize concatenates three independent standard dice with a literal zero and maps only the final ten to zero',()=>{
  const seen=new Set();for(let a=1;a<=3;a++)for(let b=1;b<=4;b++)for(let c=1;c<=10;c++){
    const values=[a,b,c],bounds=[],text=rollSaize((min,max)=>{bounds.push([min,max]);return values.shift();});
    assert.deepEqual(bounds,[[1,4],[1,5],[1,11]]);assert.ok(text.includes(`サイゼロール → ${a}${b}0${c===10?0:c}`));assert.ok(text.includes(`(${a})(${b})0(${c})`));assert.match(text,/実在するメニュー番号とは限りません/);assert.ok(text.length<2000);assert.match(text,/サイゼロール → [1-3][1-4]0[0-9]\*\*/);seen.add(`${a}${b}0${c===10?0:c}`);
  }assert.equal(seen.size,120);
});
function fixture(random=(min,max)=>min){
  const replies=[],draws=[],state={enabled:true,visible:true,archived:false,locked:false,pending:false,fail:false,edited:false},message={id:'source',guildId:'guild',channelId:'channel',author:{id:'user',bot:false},content:'サイゼロール'},current={...message,reply:async data=>{replies.push(data);if(state.fail)throw new Error('SECRET');}};
  const member={user:{bot:false},get pending(){return state.pending;}},channel={guildId:'guild',isTextBased:()=>true,isThread:()=>false,get archived(){return state.archived;},get locked(){return state.locked;},permissionsFor:()=>({has:()=>state.visible}),messages:{fetch:async()=>({...current,content:state.edited?'サイゼロールの説明':current.content})}},guild={id:'guild',members:{fetch:async()=>member,fetchMe:async()=>({})},channels:{fetch:async()=>channel}};
  const controller=createChatDice({guild,enabled:()=>state.enabled,now:()=>1000,random:(min,max)=>{draws.push([min,max]);return random(min,max);}});return {message,current,replies,draws,state,channel,guild,controller};
}
test('saize posts one no-mention reply to the source with the existing deduplication nonce',async()=>{
  const f=fixture();await f.controller.onMessage(f.message);await f.controller.onMessage(f.message);assert.equal(f.replies.length,1);assert.match(replyText(f.replies[0]),/サイゼロール → 1101/);assert.deepEqual(f.draws,[[1,4],[1,5],[1,11]]);assert.deepEqual(f.replies[0].allowedMentions,{parse:[],repliedUser:false});assert.equal(f.replies[0].failIfNotExists,true);assert.equal(f.replies[0].nonce,'source');assert.equal(f.replies[0].enforceNonce,true);
});
test('saize does not draw or reply for foreign, automated, inaccessible or ambiguous messages',async()=>{
  for(const extra of [{guildId:'other'},{guildId:null},{author:{id:'bot',bot:true}},{webhookId:'hook'},{system:true},{partial:true},{content:'サイゼロールした'},{content:'「サイゼロール」'}]){const f=fixture();await f.controller.onMessage({...f.message,...extra});assert.equal(f.replies.length,0);assert.equal(f.draws.length,0);}
  for(const key of ['archived','locked','pending','edited']){const f=fixture();f.state[key]=true;await f.controller.onMessage(f.message);assert.equal(f.draws.length,0,key);assert.equal(f.replies.length,0,key);}
  for(const key of ['visible','enabled']){const f=fixture();f.state[key]=false;await f.controller.onMessage(f.message);assert.equal(f.draws.length,0,key);assert.equal(f.replies.length,0,key);}
});
test('saize rechecks live permissions and source edits before drawing and never retries unknown replies',async()=>{
  for(const mode of ['disabled','permission','deleted','edited']){const f=fixture();f.channel.messages.fetch=async()=>{if(mode==='deleted')throw new Error('missing');if(mode==='disabled')f.state.enabled=false;if(mode==='permission')f.state.visible=false;return {...f.current,content:mode==='edited'?'1D100':f.current.content};};await f.controller.onMessage(f.message);assert.equal(f.draws.length,0,mode);assert.equal(f.replies.length,0,mode);}
  const f=fixture();f.state.fail=true;await f.controller.onMessage(f.message);await f.controller.onMessage(f.message);assert.equal(f.replies.length,1);assert.equal(f.draws.length,3);
});
test('saize and ordinary dice share one user rate limit rather than allowing bypass via the other mode',async()=>{
  const f=fixture();for(const [id,content] of [['one','サイゼロール'],['two','1D6'],['three','サイゼロール'],['four','1D6']]){Object.assign(f.current,{id,content});await f.controller.onMessage({...f.message,id,content});}
  assert.equal(f.replies.length,3);assert.match(replyText(f.replies[0]),/サイゼロール/);assert.match(replyText(f.replies[1]),/1D6 → 1/);assert.match(replyText(f.replies[2]),/サイゼロール/);
});

test('only saize converts a final ten; ordinary 1D10 replies still report ten',async()=>{
  const saize=fixture((min,max)=>max-1);await saize.controller.onMessage(saize.message);
  assert.match(replyText(saize.replies[0]),/サイゼロール → 3400/);assert.match(replyText(saize.replies[0]),/`3` · `4` · `0`（固定） · `10 → 0`/);
  const ordinary=fixture((min,max)=>max-1);ordinary.message.content=ordinary.current.content='1D10';await ordinary.controller.onMessage(ordinary.message);
  assert.match(replyText(ordinary.replies[0]),/1D10 → 10/);assert.doesNotMatch(replyText(ordinary.replies[0]),/サイゼ|変換/);assert.deepEqual(ordinary.draws,[[1,11]]);
});
