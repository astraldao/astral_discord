import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {payload} from '../src/ui.js';
import {encodePng} from '../src/sprite-image.js';
import {gameImage,editGameImage,blackjackImageKey} from '../src/game-images.js';
import {blackjackImage} from '../src/blackjack-art.js';
import {casinoImage} from '../src/casino-art.js';
import {createCasinoController} from '../src/casino-ui.js';
const MID='123456789012345678',AID='234567890123456789';
const message=(name='casino.png',id=MID,aid=AID,privateFlag=true)=>({id,flags:{has:()=>privateFlag},attachments:new Map([[aid,{id:aid,name}]])});
test('same confirmed private image is retained without invoking the PNG renderer',async()=>{
  let renders=0,last;const s={},build=retained=>gameImage(payload('Game','Current'),{name:'casino.png',description:'screen',retained,render:()=>{renders++;return Buffer.from('PNG');}});const i={async editReply(p){last=p;return message();}};
  await editGameImage(i,s,{key:'one',name:'casino.png',build});assert.equal(renders,1);i.message=message();await editGameImage(i,s,{key:'one',name:'casino.png',build,reuse:true});assert.equal(renders,1);assert.equal(last.files,undefined);assert.deepEqual(last.attachments,[{id:AID,filename:'casino.png',description:'screen'}]);
  await editGameImage(i,s,{key:'changed',name:'casino.png',build,reuse:true});assert.equal(renders,2);assert.ok(last.files);
});
test('different message, attachment, public origin or separate reply always generates a fresh image',async()=>{
  for(const patch of [{message:message('casino.png','345678901234567890')},{message:message('casino.png',MID,'456789012345678901')},{message:message('casino.png',MID,AID,false)},{reuse:false}]){
    let renders=0;const s={gameImage:{key:'one',name:'casino.png',messageId:MID,attachmentId:AID}},i={message:message(),async editReply(){return message();}};const options={key:'one',name:'casino.png',reuse:true,build:retained=>gameImage(payload('Game','Current'),{name:'casino.png',description:'screen',retained,render:()=>{renders++;return Buffer.from('PNG');}})};if(patch.message)i.message=patch.message;else options.reuse=false;await editGameImage(i,s,options);assert.equal(renders,1);
  }
});
test('failed uploads are not registered; card flips use a new visible image key without exposing the deck',async()=>{
  const s={},i={async editReply(){throw new Error('network');}};await assert.rejects(editGameImage(i,s,{key:'one',name:'casino.png',build:()=>gameImage(payload('Game','Current'),{name:'casino.png',description:'screen',render:()=>Buffer.from('PNG')})}));assert.equal(s.gameImage,undefined);
  const g={phase:'playing',player:[9,4],dealer:[8,12],deck:[1,2,3]};assert.equal(blackjackImageKey(g),blackjackImageKey({...g,dealer:[8,6],deck:[50,51]}));assert.notEqual(blackjackImageKey(g),blackjackImageKey({...g,phase:'done'}));
});
test('PNG Sub filtering round-trips opaque RGB and transparent RGBA bytes',()=>{
  for(const alpha of [255,128]){const pixels=Buffer.from([255,0,20,alpha,10,20,30,255,20,200,10,255,250,30,20,255]),png=encodePng(pixels,2,2),channels=alpha===255?3:4;assert.equal(png[25],channels===3?2:6);const parts=[];for(let at=8;at<png.length;){const len=png.readUInt32BE(at),type=png.toString('ascii',at+4,at+8);if(type==='IDAT')parts.push(png.subarray(at+8,at+8+len));at+=len+12;}const raw=inflateSync(Buffer.concat(parts));for(let y=0;y<2;y++){const row=y*(2*channels+1);assert.equal(raw[row],1);const values=[];for(let x=0;x<2;x++)for(let c=0;c<channels;c++){const at=x*channels+c;values[at]=(raw[row+1+at]+(x?values[at-channels]:0))&255;assert.equal(values[at],pixels[(y*2+x)*4+c]);}}}
});
test('small indexed game PNGs stay readable-sized and within the payload budget',()=>{
  const frames=[blackjackImage({phase:'playing',player:[9,4],dealer:[8,12]}),casinoImage('slots',{values:[1,3,1]}),casinoImage('roulette',{values:[36]}),casinoImage('dice',{values:[2,6]}),casinoImage('highlow',{values:[7,12]},{card:12}),casinoImage('race',{values:[2,0,3,1]})];for(const png of frames){assert.equal(png.readUInt32BE(16),480);assert.ok(png.readUInt32BE(20)<=264);assert.equal(png[25],3);assert.ok(png.length<8192);}
});
test('controller refresh and wager edits reuse uploads, while a new outcome replaces the image',async()=>{
  const c=createCasinoController({access:async()=>{},random:()=>0});let fileCount=0,aid=BigInt(AID),current=message();function i(action){return {customId:action,user:{id:'owner'},channelId:'channel',message:current,async deferUpdate(){this.deferred=true;},async deferReply(){this.deferred=true;},async editReply(p){if(p.files){fileCount++;aid++;current=message('casino.png',MID,String(aid));}this.output=p;return current;},async reply(p){this.output=p;}};}
  await c.open(i('open'),'slots');const s=[...c.sessions.sessions.values()][0],click=action=>i(`casino:${s.id}:${s.turn}:${action}`);assert.equal(fileCount,1);await c.handle(click('bet-50'));await c.handle(click('refresh'));assert.equal(fileCount,1);await c.handle(click('spin'));assert.equal(fileCount,2);const other=click('refresh');other.user={id:'other'};await c.handle(other);assert.equal(other.output.files,undefined);assert.deepEqual(other.output.attachments,[]);
});
test('invalid image dimensions and palettes are rejected before encoding',()=>{
  for(const [w,h] of [[0,1],[-1,1],[1.5,1],[1,Infinity],[100000,100000]])assert.throws(()=>encodePng(Buffer.alloc(4),w,h));assert.throws(()=>encodePng(Buffer.alloc(3),1,1));assert.throws(()=>encodePng(Buffer.alloc(4),1,1,{palette:Buffer.alloc(4),lookup:Buffer.alloc(32768)}));
});
