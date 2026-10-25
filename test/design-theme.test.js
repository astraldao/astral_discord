import test from 'node:test';
import assert from 'node:assert/strict';
import {ActionRowBuilder,ButtonBuilder,ButtonStyle} from 'discord.js';
import {card,payload,themed,themes,themeForNamespace,polishComponents,polishMessage} from '../src/ui.js';
import {interactionNamespaces} from '../src/interaction-routing.js';
import {fourImage} from '../src/four-art.js';
import {inflateSync} from 'node:zlib';

const json=embed=>embed.toJSON();
const buttons=(...labels)=>labels.map((label,n)=>({type:2,style:ButtonStyle.Secondary,label,custom_id:`x:${n}`}));

test('each feature gets one mark and accent, replacing older title marks',()=>{
  for(const [feature,theme] of Object.entries(themes)){
    for(const title of ['予定表','✦  予定表','✧  予定表','📅  予定表','♠  予定表']){
      const e=json(card(title,'本文','normal',{feature}));
      assert.equal(e.title,`${theme.icon}  予定表`);assert.equal(e.color,theme.color);
    }
  }
  assert.equal(json(themed('game','🃏').card('♠  ブラックジャック','x')).title,'🃏  ブラックジャック');
  assert.equal(json(themed('game','🃏').payload('ゲームを選ぶ','x',{icon:'🎲'}).embeds[0]).title,'🎲  ゲームを選ぶ');
  assert.equal(new Set(Object.values(themes).map(t=>t.color)).size,Object.keys(themes).length);
});

test('status colors stay readable over feature accents and untagged cards keep the default look',()=>{
  const {payload:schedule}=themed('schedule');
  assert.equal(schedule('x','y',{state:'error'}).embeds[0].toJSON().color,0xc94f61);
  assert.equal(schedule('x','y',{state:'success'}).embeds[0].toJSON().color,0x29856d);
  assert.equal(schedule('x','y',{state:'warning'}).embeds[0].toJSON().color,0xb77920);
  const plain=json(card('✦  メニュー','x'));assert.equal(plain.title,'メニュー');assert.equal(plain.color,themes.menu.color);
  assert.equal(json(card('x','y','normal',{feature:'constructor'})).color,themes.menu.color);
});

test('user-provided titles keep their own emoji and only known marks are removed',()=>{
  const {card:schedule}=themed('schedule');
  assert.equal(json(schedule('🎉 パーティ · 10月','x')).title,'📅  🎉 パーティ · 10月');
  assert.equal(json(schedule('📅予定','x')).title,'📅  📅予定');
});

test('every interaction namespace maps to a theme',()=>{
  for(const namespace of interactionNamespaces)assert.ok(Object.hasOwn(themes,themeForNamespace(namespace)),namespace);
  assert.equal(themeForNamespace('toString'),undefined);assert.equal(themeForNamespace('unknown'),undefined);
});

test('destructive labels turn red while cancel, back and filter-clearing buttons do not',()=>{
  const red=['予定を削除','予定を削除…','削除を確定','読み上げを停止','登録を解除','バナーを解除','測定を中断','中断を確定','待機分を消去…','この予定表の履歴を消去','卓セットの削除を確定'];
  const calm=['削除せず戻る','停止せず戻る','解除せず戻る','一時停止','検索を解除','条件を解除','選択をすべて解除','固定を解除','選択日の絞り込みを解除する','履歴を消去する内容を確認','入室をキャンセル','次の画面で削除を確認する','VC設定へ'];
  const rows=[{type:1,components:buttons(...red,...calm)}];polishComponents(rows);
  const style=Object.fromEntries(rows[0].components.map(b=>[b.label,b.style]));
  for(const label of red)assert.equal(style[label],ButtonStyle.Danger,label);
  for(const label of calm)assert.equal(style[label],ButtonStyle.Secondary,label);
});

test('page and item steps get arrows without replacing existing emoji or touching links',()=>{
  const rows=[{type:1,components:[...buttons('前のページ','次のページ','前へ','次へ','前の5件','次の25件','前の月','次の週','次のラウンド','前の結果を見る'),
    {type:2,style:ButtonStyle.Secondary,label:'次のページ',emoji:{name:'🐔'},custom_id:'e'},{type:2,style:ButtonStyle.Link,label:'削除',url:'https://example.com'}]}];
  polishComponents(rows);const [prev,next,back,forward,p5,n25,month,week,round,result,custom,link]=rows[0].components;
  for(const b of [prev,back,p5,month])assert.equal(b.emoji.name,'◀️');
  for(const b of [next,forward,n25,week])assert.equal(b.emoji.name,'▶️');
  for(const b of [round,result])assert.equal(b.emoji,undefined);
  assert.equal(custom.emoji.name,'🐔');assert.equal(link.style,ButtonStyle.Link);assert.equal(link.emoji,undefined);
});

test('rules apply to builders, are idempotent and keep the single primary action',()=>{
  const row=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('a').setLabel('変更を保存').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('b').setLabel('予定を削除').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('c').setLabel('次のページ').setStyle(ButtonStyle.Secondary));
  const message=payload('x','y',{components:[row]});polishMessage(message);polishMessage(message);
  const [save,remove,next]=row.toJSON().components;
  assert.equal(save.style,ButtonStyle.Primary);assert.equal(remove.style,ButtonStyle.Danger);assert.deepEqual(next.emoji,{name:'▶️'});
  assert.equal(polishMessage('text'),'text');assert.equal(polishMessage(undefined),undefined);assert.deepEqual(polishMessage({content:'x'}),{content:'x'});
});

function decode(png){
  let at=8,data=[],header,palette;while(at<png.length){const length=png.readUInt32BE(at),type=png.toString('ascii',at+4,at+8),body=png.subarray(at+8,at+8+length);if(type==='IHDR')header=body;if(type==='PLTE')palette=body;if(type==='IDAT')data.push(body);at+=length+12;}
  const width=header.readUInt32BE(0),height=header.readUInt32BE(4),channels={2:3,3:1,6:4}[header[9]],raw=inflateSync(Buffer.concat(data)),stride=width*channels+1,out=Buffer.alloc(width*height*channels);
  for(let y=0;y<height;y++){const filter=raw[y*stride];for(let x=0;x<width*channels;x++){const left=x>=channels?out[y*width*channels+x-channels]:0;out[y*width*channels+x]=(raw[y*stride+1+x]+(filter===1?left:0))&255;}}
  const pixel=(x,y)=>{const at=(y*width+x)*channels;return channels===1?[...palette.subarray(out[at]*3,out[at]*3+3)]:[...out.subarray(at,at+3)];};
  return {width,height,indexed:channels===1,pixel};
}

test('the four-in-a-row board shares the game frame and draws smooth, independent pieces',()=>{
  const board=Array(42).fill(0);board[35]=1;board[36]=2;
  // Background, panel and border sampled from the blackjack and casino frames (480px wide).
  const image=decode(fourImage({board,winning:[35]}));
  assert.equal(image.width,480);assert.ok(image.indexed);assert.deepEqual(image.pixel(2,2),[19,28,43]);assert.deepEqual(image.pixel(30,100),[25,38,59]);assert.deepEqual(image.pixel(10,100),[44,67,91]);
  assert.deepEqual(image.pixel(84,292),[105,187,168]);
  assert.deepEqual(image.pixel(84,312),[241,201,105]);assert.deepEqual(image.pixel(136,312),[151,145,224]);assert.deepEqual(image.pixel(84,52),[19,28,43]);
  const pure=new Set([[151,145,224],[25,38,59]].map(c=>c.join())),edge=[];for(let y=284;y<336;y++)for(let x=110;x<162;x++)edge.push(image.pixel(x,y).join());assert.ok(edge.filter(c=>!pure.has(c)).length>20,'anti-aliased disc edge');
  const empty=decode(fourImage({board:Array(42).fill(0)}));assert.deepEqual(empty.pixel(84,312),[19,28,43]);
});
