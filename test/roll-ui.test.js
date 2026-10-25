import test from 'node:test';
import assert from 'node:assert/strict';
import {PermissionFlagsBits as P} from 'discord.js';
import {rollReply} from '../src/roll-ui.js';
import {diceRequest,saizeRequest,createChatDice} from '../src/chat-dice.js';
import {saizeMenuName,saizeMenuSource} from '../src/saize-menu.js';
import {themes} from '../src/ui.js';
const card=m=>m.embeds[0].toJSON();
const draws=description=>[...description.matchAll(/`(\d+)`/g)].map(m=>Number(m[1]));
function sequence(values){let i=0;return {random:(min,max)=>{const value=values[i++];assert.ok(value>=min&&value<max);return value;},calls:()=>i};}
test('one roll uses a game card with a prominent result and keeps every value and signed modifier',()=>{
  const rng=sequence([6,8,10]),m=rollReply(diceRequest('3D10+2'),rng.random),d=card(m);
  assert.equal(d.title,'🎲  3D10+2 → 26');assert.equal(d.color,themes.game.color);assert.deepEqual(draws(d.description),[6,8,10]);assert.match(d.description,/補正：\+2/);assert.equal(rng.calls(),3);assert.equal(m.content,null);assert.deepEqual(m.components,[]);
  const negative=card(rollReply(diceRequest('1D4-7'),()=>4));assert.match(negative.title,/1D4-7 → -3/);assert.deepEqual(draws(negative.description),[4]);assert.match(negative.description,/補正：-7/);
});
test('multiple independent rolls share one card with their formulas, totals and breakdowns in order',()=>{
  const rng=sequence([99,2,1,5,10]),m=rollReply(diceRequest('1D100,1D4,3D10+2'),rng.random),d=card(m);
  assert.equal(m.embeds.length,1);assert.match(d.title,/ダイスロール · 3式/);assert.match(d.description,/1D100 → 99[\s\S]*1D4 → 2[\s\S]*3D10\+2 → 18/);assert.deepEqual(draws(d.description),[99,2,1,5,10]);assert.equal(rng.calls(),5);assert.doesNotMatch(d.description,/残り|省略/);
});
test('the maximum 200 individual dice fit both native embed and text limits without omitting any draw',()=>{
  for(const counts of [[100,100],[40,40,40,40,40],[100,97,1,1,1],[1,1,1,97,100]])for(const modifier of [-1000000,0,1000000]){
    const request={rolls:counts.map(count=>({count,sides:1000000,modifier}))},rng=sequence(Array(200).fill(1000000)),m=rollReply(request,rng.random),d=card(m);
    assert.deepEqual(draws(d.description),Array(200).fill(1000000));assert.equal(rng.calls(),200);assert.ok(d.description.length<=4096);assert.ok(d.title.length+d.description.length+(d.footer?.text.length??0)<=6000);assert.doesNotMatch(d.description,/残り|省略|…/);
    const fallback=rollReply(request,()=>1000000,{embed:false});assert.ok(fallback.content.length<=2000,`${counts}/${modifier}: ${fallback.content.length}`);assert.equal(fallback.embeds,undefined);
    const values=[...fallback.content.matchAll(/内訳：\n([\d \n]+)/g)].flatMap(m=>m[1].trim().split(/\s+/).map(Number));assert.deepEqual(values,Array(200).fill(1000000));
  }
});
test('all Saizeriya cards preserve digits and conversion, with names and source links only after a prefix',()=>{
  for(let a=1;a<=3;a++)for(let b=1;b<=4;b++)for(let c=1;c<=10;c++)for(const showMenu of [false,true]){
    const rng=sequence([a,b,c]),d=card(rollReply(saizeRequest(showMenu?'!サイゼロール':'サイゼロール'),rng.random)),code=`${a}${b}0${c===10?0:c}`,name=saizeMenuName(code);
    assert.equal(d.title,`🎲  サイゼロール → ${code}`);assert.equal(d.color,themes.game.color);assert.match(d.description,/式：`\(1D3\)\(1D4\)0\(1D10\)`/);assert.ok(d.description.includes(`\`${a}\` · \`${b}\` · \`0\`（固定） · \`${c===10?'10 → 0':c}\``));assert.equal(rng.calls(),3);
    if(showMenu){assert.equal(d.url,saizeMenuSource.url);assert.match(d.footer.text,/2024年6月改定版/);assert.match(d.footer.text,/現在の店舗での提供は未確認/);assert.ok(d.description.includes(name??'参照表に該当なし'));}
    else{assert.equal(d.url,undefined);assert.doesNotMatch(d.description,/参照表|ハンバーグ|メニュー/);assert.match(d.footer.text,/実在するメニュー番号とは限りません/);}
  }
});
test('invalid requests never draw and resource errors use a concise warning card or text',()=>{
  for(const request of [null,{rolls:[]},{rolls:[{count:201,sides:6,modifier:0}]},{rolls:[{count:1,sides:1000001,modifier:0}]}])assert.throws(()=>rollReply(request,()=>assert.fail('must not draw')));
  const request=diceRequest('101D6'),m=rollReply(request,()=>assert.fail('must not draw'));assert.match(card(m).title,/ダイスを確認/);assert.match(card(m).description,/1〜100個/);assert.equal(rollReply(request,()=>assert.fail('must not draw'),{embed:false}).content,request.error);
});
function fixture({embed=true,lateEmbed=embed,fail=false,content='3D10+2'}={}){
  let phase=0;const replies=[],bounds=[],message={id:'source',guildId:'guild',channelId:'channel',author:{id:'user',bot:false},content},member={user:{bot:false}},current={...message,reply:async m=>{replies.push(m);if(fail)throw new Error('unknown outcome');}},channel={guildId:'guild',isTextBased:()=>true,isThread:()=>false,permissionsFor:()=>({has:flag=>flag===P.EmbedLinks?(phase?lateEmbed:embed):true}),messages:{fetch:async()=>{phase++;return current;}}},guild={id:'guild',members:{fetch:async()=>member,fetchMe:async()=>({})},channels:{fetch:async()=>channel}},controller=createChatDice({guild,random:(min,max)=>{bounds.push([min,max]);return max-1;}});
  return {message,replies,bounds,controller};
}
test('actual replies fall back to text when current EmbedLinks permission is absent, preserving every die',async()=>{
  for(const options of [{embed:false},{embed:true,lateEmbed:false}]){
    const f=fixture({...options,content:'100D1000000,100D1000000'});await f.controller.onMessage(f.message);assert.equal(f.replies.length,1);const m=f.replies[0];assert.equal(m.embeds,undefined);assert.equal(f.bounds.length,200);assert.ok(m.content.length<=2000);assert.doesNotMatch(m.content,/残り|省略/);assert.deepEqual(m.allowedMentions,{parse:[],repliedUser:false});assert.equal(m.nonce,'source');assert.equal(m.enforceNonce,true);assert.equal(m.failIfNotExists,true);
  }
  const saize=fixture({embed:false,content:'!サイゼロール'});await saize.controller.onMessage(saize.message);assert.match(saize.replies[0].content,/3400/);assert.match(saize.replies[0].content,/末尾の10を0に変換/);assert.equal(saize.bounds.length,3);
});
test('an unknown embed send outcome never triggers a text retry or another draw',async()=>{
  const f=fixture({fail:true});await f.controller.onMessage(f.message);await f.controller.onMessage(f.message);assert.equal(f.replies.length,1);assert.equal(f.replies[0].embeds.length,1);assert.equal(f.bounds.length,3);assert.deepEqual(draws(card(f.replies[0]).description),[10,10,10]);
});
