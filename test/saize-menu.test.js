import test from 'node:test';
import assert from 'node:assert/strict';
import {saizeRequest,rollSaize,createChatDice} from '../src/chat-dice.js';
import {saizeMenuName,saizeMenuSource} from '../src/saize-menu.js';

test('menu disclosure requires an immediately preceding exclamation mark on the request token',()=>{
  for(const text of ['!サイゼロール','!サイゼロールして','!サイゼロールお願い','!サイゼロールしてくれる？','！サイゼロール','<@123456789012345678> !サイゼロール','じゃあ !サイゼロール'])assert.deepEqual(saizeRequest(text),{kind:'saize',showMenu:true},text);
  for(const text of ['サイゼロール','サイゼロール!','サイゼロール！','サイゼロールして！'])assert.deepEqual(saizeRequest(text),{kind:'saize'},text);
});
test('quoted, negated, explained or misplaced exclamation requests do not disclose menus',()=>{
  for(const text of ['!!サイゼロール','! サイゼロール','サイゼ!ロール','!サイゼロールとは？','!サイゼロールしない','!サイゼロールした','「!サイゼロール」','`!サイゼロール`','||!サイゼロール||','> !サイゼロール','https://example.org/!サイゼロール','例：!サイゼロール','!サイゼロール 1D10'])assert.equal(saizeRequest(text),null,text);
});
test('the dated reference contains only known reachable entries with explicit source metadata',()=>{
  assert.equal(saizeMenuSource.revision,'2024年6月改定版');assert.equal(saizeMenuSource.url,'https://kurobo0408.hatenablog.com/entry/2024/09/22/205739');assert.ok(Object.isFrozen(saizeMenuSource));
  let count=0;for(let a=1;a<=3;a++)for(let b=1;b<=4;b++)for(let c=0;c<=9;c++)if(saizeMenuName(`${a}${b}0${c}`))count++;assert.equal(count,60);
  assert.equal(saizeMenuName('1202'),'小エビのサラダ');assert.equal(saizeMenuName('2101'),'ミラノ風ドリア');assert.equal(saizeMenuName('2407'),'ディアボラ風ハンバーグ');assert.equal(saizeMenuName('3408'),'マグナム（1500ml）白');
  for(const key of ['3400','1101','1410','__proto__','constructor','toString',1202,null,{}])assert.equal(saizeMenuName(key),null);
});
test('all 120 rolls hide menus by default and show only exact reference matches when opted in',()=>{
  let found=0,missing=0;
  for(let a=1;a<=3;a++)for(let b=1;b<=4;b++)for(let c=1;c<=10;c++){
    const draw=()=>{const values=[a,b,c];let calls=0;return {random:()=>{calls++;return values.shift();},calls:()=>calls};};
    const normal=draw(),prefixed=draw(),plain=rollSaize(normal.random),detailed=rollSaize(prefixed.random,{showMenu:true}),name=saizeMenuName(`${a}${b}0${c===10?0:c}`);
    assert.equal(normal.calls(),3);assert.equal(prefixed.calls(),3);assert.doesNotMatch(plain,/メニュー：|参照表|hatenablog/);assert.ok(detailed.startsWith(plain));assert.match(detailed,/2024年6月改定版/);assert.match(detailed,/現在の店舗での提供は未確認/);assert.ok(detailed.length<2000);
    if(name){assert.ok(detailed.includes(`**メニュー：${name}**`));found++;}else{assert.match(detailed,/参照表にこの番号のメニューはありません/);assert.doesNotMatch(detailed,/\*\*メニュー：/);missing++;}
  }assert.equal(found,60);assert.equal(missing,60);
  assert.doesNotMatch(rollSaize(()=>1,{showMenu:'true'}),/参照表/);
});
function fixture(content,{edited=false,enabled=true,fail=false,values=[2,4,7]}={}){
  const replies=[],draws=[],message={id:'source',guildId:'guild',channelId:'channel',author:{id:'user',bot:false},content};
  const current={...message,content:edited?'サイゼロール':content,reply:async reply=>{replies.push(reply);if(fail)throw new Error('unknown');}},member={user:{bot:false}},channel={guildId:'guild',isTextBased:()=>true,isThread:()=>false,permissionsFor:()=>({has:()=>true}),messages:{fetch:async()=>current}},guild={id:'guild',members:{fetch:async()=>member,fetchMe:async()=>({})},channels:{fetch:async()=>channel}},controller=createChatDice({guild,enabled:()=>enabled,random:(min,max)=>{draws.push([min,max]);return values.shift();}});
  return {message,replies,draws,controller};
}
test('actual replies disclose the name only for the prefix, with mention suppression and deduplication intact',async()=>{
  for(const content of ['サイゼロール','サイゼロール!','!サイゼロール']){
    const f=fixture(content);await f.controller.onMessage(f.message);await f.controller.onMessage(f.message);assert.equal(f.replies.length,1);assert.match(f.replies[0].content,/サイゼロール → 2407/);
    assert.equal(f.replies[0].content.includes('ディアボラ風ハンバーグ'),content.startsWith('!'));assert.deepEqual(f.replies[0].allowedMentions,{parse:[],repliedUser:false});assert.equal(f.replies[0].nonce,'source');assert.equal(f.replies[0].enforceNonce,true);assert.equal(f.draws.length,3);
  }
});
test('a missing menu preserves the four-digit roll and the ten-to-zero conversion without rerolling',async()=>{
  const f=fixture('!サイゼロール',{values:[3,4,10]});await f.controller.onMessage(f.message);assert.match(f.replies[0].content,/サイゼロール → 3400/);assert.match(f.replies[0].content,/末尾の10を0に変換/);assert.match(f.replies[0].content,/参照表にこの番号のメニューはありません/);assert.deepEqual(f.draws,[[1,4],[1,5],[1,11]]);
});
test('prefix edits or disabled replies do not draw, and unknown detailed replies are never retried',async()=>{
  for(const options of [{edited:true},{enabled:false}]){const f=fixture('!サイゼロール',options);await f.controller.onMessage(f.message);assert.equal(f.replies.length,0);assert.equal(f.draws.length,0);}
  const f=fixture('!サイゼロール',{fail:true});await f.controller.onMessage(f.message);await f.controller.onMessage(f.message);assert.equal(f.replies.length,1);assert.equal(f.draws.length,3);
});
