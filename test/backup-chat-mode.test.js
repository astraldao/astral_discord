import test from 'node:test';
import assert from 'node:assert/strict';
import {backupText} from '../src/backup-text.js';
import {createBackupReader,backupReaderScreen} from '../src/backup-reader.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function wave(){const b=Buffer.alloc(44+12000);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(192000,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(12000,40);return b;}
const controls=message=>message.components.flatMap(row=>row.toJSON().components);
const interaction=(action,extra={})=>({user:{id:'owner'},channelId:'text',options:{getSubcommand:()=>action},message:{flags:{has:()=>true}},async deferReply(){this.deferred=true;},async deferUpdate(){this.deferred=true;},async reply(value){this.result=value;this.replied=true;},async editReply(value){this.result=value;},...extra});
async function fixture({onPlay,onStream,canControl,...options}={}){
  const spoken=[],played=[],diagnostics=[];let now=0,closed=0,reader;
  reader=createBackupReader({guild:{id:'guild'},enabled:true,now:()=>now,resolveTargets:async()=>({text:{send:async()=>({async edit(){}})},voice:{id:'voice'}}),authorize:async()=>{},canControl:canControl??(async i=>{if(!['owner','admin'].includes(i.user.id))throw new Error('owner');}),onDiagnostic:value=>diagnostics.push(value),worker:()=>({ready:Promise.resolve(),async stream(text,signal,chunk){spoken.push(text);if(onStream)await onStream(text,signal,chunk);else chunk(wave());},close(){closed++;}}),speaker:async()=>({healthy:()=>true,close(){},async play(_source,options){played.push(reader.state.currentJob.text);options.onStart();await onPlay?.(reader.state.currentJob.text);}}),...options});
  await reader.handle(interaction('start'));assert.equal(reader.state?.ready,true);
  const id=action=>controls(backupReaderScreen(reader.state,true)).find(c=>c.custom_id?.split(':')[1]===action)?.custom_id??`read:${action}:${reader.state.id}:${reader.state.controlRevision}`;
  const handle=async(customId,extra={})=>{const i=interaction('unused',{customId,...extra});await reader.handle(i);return i;};
  const act=(action,extra)=>handle(id(action),extra);
  return {reader,spoken,played,diagnostics,id,handle,act,closed:()=>closed,setTime:value=>now=value,message:content=>reader.onMessage({guildId:'guild',channelId:reader.state.textId,content,author:{bot:false}})};
}

test('raw text remains the default while chat formatting applies before the 50 code point boundary',()=>{
  const value=' Ａ\n\tＢ  🪐 ';assert.equal(backupText(value),backupText(value,{mode:'raw'}));assert.equal(backupText(value),'A B 🪐');
  assert.equal(backupText('🪐'.repeat(51),{mode:'chat'}),'🪐'.repeat(50)+'以下略');assert.equal(Array.from(backupText('🪐'.repeat(51),{mode:'chat'})).length,53);
  assert.equal(backupText('https://example.com/'+'a'.repeat(2000),{mode:'chat'}),'リンク');
  assert.equal(backupText('`'+'あ'.repeat(2000)+'`',{mode:'chat'}),'コード');
  assert.throws(()=>backupText('本文',{mode:'unknown'}));
});
test('chat formatting shortens URLs, complete code, spoilers and Discord custom emoji without fetching',t=>{
  t.mock.method(globalThis,'fetch',()=>assert.fail('chat formatting must not fetch links'));
  const cases=[['前 https://example.com/path?q=1 後','前 リンク 後'],['<https://example.com/x> を見る','リンク を見る'],['https://example.com。次の文','リンク 。次の文'],['`秘密のコード` 後','コード 後'],['```js\nconst secret=1;\n``` 後','コード 後'],['||見せない本文|| 後','伏せ字 後'],['<:hello:123456789012345678> <a:party:123456789012345679>','絵文字 絵文字']];
  for(const [source,expected] of cases)assert.equal(backupText(source,{mode:'chat'}),expected);
});
test('incomplete or escaped formatting stays literal and large malformed inputs remain bounded',()=>{
  for(const source of ['前 `閉じていない','前 ```閉じていない','前 ||閉じていない','http://','https://','<:bad:no-id>','\\`内容\\`'])assert.equal(backupText(source,{mode:'chat'}),backupText(source));
  const large='<not-emoji> '.repeat(100000);assert.equal(Array.from(backupText(large,{mode:'chat'})).length,53);assert.equal(backupText('```'+'x'.repeat(300000)+'```',{mode:'chat'}),'コード');
});
test('spoilers respect escape parity at both delimiters without exposing text after an escaped closer',()=>{
  const slash='\\';
  for(let count=0;count<=5;count++){
    const run=slash.repeat(count),opening=run+'||秘密||';
    if(count%2)assert.equal(backupText(opening,{mode:'chat'}),backupText(opening));
    else assert.ok(!backupText(opening,{mode:'chat'}).includes('秘密'));
    const closed='||秘密'+run+'||'+(count%2?'まだ秘密||':' 公開');
    const text=backupText(closed,{mode:'chat'});assert.ok(!text.includes('秘密'));assert.match(text,/伏せ字/);if(!(count%2))assert.match(text,/公開/);
  }
  assert.equal(backupText('||秘密'+slash+'||まだ秘密||',{mode:'chat'}),'伏せ字');
});
test('code openings honor escape parity while backslashes inside code do not escape its closing ticks',()=>{
  const slash='\\';
  for(let count=0;count<=5;count++){
    const run=slash.repeat(count),opening=run+'`秘密`';
    if(count%2)assert.equal(backupText(opening,{mode:'chat'}),backupText(opening));
    else assert.ok(!backupText(opening,{mode:'chat'}).includes('秘密'));
    assert.equal(backupText('`秘密'+run+'` 公開',{mode:'chat'}),'コード 公開');
  }
});
test('long code delimiters cannot close at shorter inner runs and inline code requires equal runs',()=>{
  const cases=[['````code ``` hidden code````','コード'],['``code ``` hidden code``','コード'],['`code `` hidden code`','コード'],['```code `` hidden code````','コード'],['````unclosed ``` literal','````unclosed ``` literal']];
  for(const [source,expected] of cases)assert.equal(backupText(source,{mode:'chat'}),expected);
  const many=Array.from({length:500},(_,n)=>'`'.repeat(n+3)+' body ').join('');assert.ok(Array.from(backupText(many,{mode:'chat'})).length<=53);
});

test('changing modes affects only newly received posts and keeps queued FIFO contents unchanged',async()=>{
  const f=await fixture();assert.equal(f.reader.state.mode,'raw');await f.act('pause');
  f.message('前 https://example.com');const before=f.reader.state.queue[0].text;
  await f.act('mode',{values:['chat']});f.message('後 https://example.com');assert.equal(f.reader.state.queue[0].text,before);assert.equal(f.reader.state.queue[1].text,'後 リンク');
  const screen=JSON.stringify(backupReaderScreen(f.reader.state,true));assert.ok(!screen.includes('https://example.com'));assert.ok(screen.includes('チャット向け'));assert.ok(screen.includes('新しい投稿'));
  await f.act('resume');await f.reader.idle();assert.deepEqual(f.played,['前 https://example.com','後 リンク']);await f.reader.close();
  await f.reader.handle(interaction('start'));assert.equal(f.reader.state.mode,'raw');await f.reader.close();
});

test('clearing a paused snapshot keeps posts received after confirmation and cannot run twice',async()=>{
  const f=await fixture();await f.act('pause');f.message('消去一');f.message('消去二');await f.act('clear');const confirm=f.id('confirm-clear');
  f.message('新しい投稿');await f.handle(confirm);assert.equal(f.reader.state.queue.length,1);assert.equal(f.reader.state.queue[0].text,'新しい投稿');assert.equal(f.reader.state.metrics.cleared,2);
  await f.handle(confirm);assert.equal(f.reader.state.queue.length,1);assert.equal(f.reader.state.metrics.cleared,2);assert.deepEqual(f.spoken,[]);
  await f.act('resume');await f.reader.idle();assert.deepEqual(f.played,['新しい投稿']);await f.reader.close();
});
test('cancelled or expired queue confirmations preserve all waiting posts',async()=>{
  const f=await fixture();await f.act('pause');f.message('待機一');await f.act('clear');const old=f.id('confirm-clear');await f.act('cancel-clear');await f.handle(old);assert.equal(f.reader.state.queue.length,1);
  await f.act('clear');const expired=f.id('confirm-clear');f.setTime(30000);const response=await f.handle(expired);assert.equal(f.reader.state.queue.length,1);assert.equal(f.reader.state.clearIntent,undefined);assert.match(JSON.stringify(response.result),/期限切れ/);
  await f.act('clear');await f.act('status');assert.ok(f.reader.state.clearIntent);f.setTime(60000);await f.act('status');assert.equal(f.reader.state.clearIntent,undefined);assert.equal(f.reader.state.queue.length,1);await f.reader.close();
});
test('a queued sentence that starts during confirmation becomes current and is never interrupted',async()=>{
  const first=deferred(),second=deferred(),secondStarted=deferred();
  const f=await fixture({onPlay:async text=>{if(text==='一番')await first.promise;if(text==='二番'){secondStarted.resolve();await second.promise;}}});
  f.message('一番');await tick();f.message('二番');f.message('消去三番');await tick();await f.act('clear');const confirm=f.id('confirm-clear');
  first.resolve();await secondStarted.promise;f.message('後からの投稿');await f.handle(confirm);assert.equal(f.reader.state.currentJob.text,'二番');assert.deepEqual(f.reader.state.queue.map(job=>job.text),['後からの投稿']);assert.equal(f.reader.state.metrics.cleared,1);
  second.resolve();await f.reader.idle();assert.deepEqual(f.played,['一番','二番','後からの投稿']);assert.equal(f.reader.active,true);assert.equal(f.closed(),0);await f.reader.close();
});
test('clearing active prefetch drops its later chunks without killing the worker or accumulating more generations',async()=>{
  const first=deferred(),prefetch=deferred(),prefetchStarted=deferred();let later;
  const f=await fixture({onPlay:async text=>{if(text==='現在')await first.promise;},onStream:async(text,_signal,chunk)=>{chunk(wave());if(text==='先読み'){later=chunk;prefetchStarted.resolve();await prefetch.promise;chunk(wave());}}});
  f.message('現在');await tick();f.message('先読み');await prefetchStarted.promise;const prepared=f.reader.state.queue[0].prepared;assert.ok(prepared.bufferedBytes>0);
  await f.act('clear');await f.act('confirm-clear');assert.equal(prepared.bufferedBytes,0);assert.doesNotThrow(()=>later(wave()));
  for(let n=0;n<6;n++){f.message(`消去${n}`);await f.act('clear');await f.act('confirm-clear');}
  f.message('最後に残る');await tick();assert.deepEqual(f.spoken,['現在','先読み']);assert.equal(f.reader.state.queue.length,1);assert.equal(f.reader.state.metrics.cleared,7);assert.equal(f.closed(),0);
  first.resolve();await tick();assert.deepEqual(f.played,['現在']);prefetch.resolve();await f.reader.idle();assert.deepEqual(f.spoken,['現在','先読み','最後に残る']);assert.deepEqual(f.played,['現在','最後に残る']);assert.equal(f.reader.active,true);assert.deepEqual(f.diagnostics,[]);await f.reader.close();
});
test('failure in a discarded generation still stops safely before any later queued message plays',async()=>{
  const first=deferred(),generation=deferred(),began=deferred(),secret='PRIVATE_NATIVE_PATH_AND_TEXT';
  const f=await fixture({onPlay:async text=>{if(text==='現在')await first.promise;},onStream:async(text,_signal,chunk)=>{chunk(wave());if(text==='失敗する先読み'){began.resolve();await generation.promise;throw new Error(secret);}}});
  f.message('現在');await tick();f.message('失敗する先読み');await began.promise;await f.act('clear');await f.act('confirm-clear');f.message('後続');generation.resolve();await tick();first.resolve();await f.reader.idle();
  assert.equal(f.reader.active,false);assert.deepEqual(f.played,['現在']);assert.deepEqual(f.spoken,['現在','失敗する先読み']);assert.equal(f.diagnostics.length,1);assert.ok(!JSON.stringify(f.diagnostics).includes(secret));assert.equal(f.closed(),1);
});
test('discarded prefetch failures stop after the current sentence even with an empty or paused queue and no later post',async()=>{
  for(const timing of ['during-current','after-current'])for(const paused of [false,true]){
    const current=deferred(),generation=deferred(),began=deferred(),secret='PRIVATE_FAILURE_AFTER_CLEAR';
    const f=await fixture({onPlay:async text=>{if(text==='現在')await current.promise;},onStream:async(text,_signal,chunk)=>{chunk(wave());if(text==='先読み'){began.resolve();await generation.promise;throw new Error(secret);}}});
    f.message('現在');await tick();f.message('先読み');await began.promise;await f.act('clear');await f.act('confirm-clear');if(paused)await f.act('pause');assert.equal(f.reader.state.queue.length,0);
    if(timing==='during-current'){generation.resolve();await tick();assert.equal(f.reader.active,true);assert.equal(f.reader.state.currentJob.text,'現在');assert.equal(f.diagnostics.length,0);}
    current.resolve();await f.reader.idle();
    if(timing==='after-current'){assert.equal(f.reader.active,true);generation.resolve();await tick();}
    assert.equal(f.reader.active,false);assert.deepEqual(f.played,['現在']);assert.equal(f.diagnostics.length,1);assert.ok(!JSON.stringify(f.diagnostics).includes(secret));assert.equal(f.closed(),1);
  }
});
test('stop releases a slot wait even when a discarded mock generator never settles',{timeout:2000},async()=>{
  const current=deferred(),began=deferred();
  const f=await fixture({onPlay:async text=>{if(text==='現在')await current.promise;},onStream:async(text,_signal,chunk)=>{chunk(wave());if(text==='先読み'){began.resolve();await new Promise(()=>{});}}});
  f.message('現在');await tick();f.message('先読み');await began.promise;await f.act('clear');await f.act('confirm-clear');f.message('後続');current.resolve();await tick();assert.equal(f.reader.state.currentJob.text,'後続');
  await f.reader.close();await f.reader.idle();assert.equal(f.reader.active,false);assert.deepEqual(f.played,['現在']);assert.equal(f.closed(),1);
});

test('mode and queue controls require owner or administrator and reject malformed or missing revisions',async()=>{
  const f=await fixture();await f.act('pause');f.message('待機');
  for(const action of ['mode','clear']){await f.act(action,{user:{id:'other'},values:['chat']});assert.equal(f.reader.state.mode,'raw');assert.equal(f.reader.state.clearIntent,undefined);}
  for(const values of [[],['unknown'],['chat','raw']])await f.act('mode',{values});
  const old=f.id('mode');await f.handle(`read:mode:${f.reader.state.id}`,{values:['chat']});await f.act('mode',{user:{id:'admin'},values:['chat']});assert.equal(f.reader.state.mode,'chat');await f.handle(old,{values:['raw']});assert.equal(f.reader.state.mode,'chat');assert.equal(f.reader.state.queue.length,1);await f.reader.close();
});

test('revision is checked again after delayed authorization before a mode change or queue clear',async()=>{
  for(const action of ['mode','confirm-clear']){
    let delayed=false,allow;const f=await fixture({canControl:async()=>{if(delayed)await new Promise(resolve=>allow=resolve);}});await f.act('pause');f.message('待機');if(action==='confirm-clear')await f.act('clear');
    delayed=true;const pending=f.act(action,{values:['chat']});await tick();delayed=false;await f.act('mode',{values:['chat']});await f.act('mode',{values:['raw']});allow();await pending;
    assert.equal(f.reader.state.mode,'raw');assert.equal(f.reader.state.queue.length,1);assert.equal(f.reader.state.metrics.cleared,0);await f.reader.close();
  }
});

test('an old session cannot modify or reveal a replacement after asynchronous control checks',async()=>{
  for(const action of ['mode','clear','confirm-clear','cancel-clear']){
    let delayed=false,allow;const f=await fixture({canControl:async()=>{if(delayed)await new Promise(resolve=>allow=resolve);}});await f.act('pause');f.message('待機');if(action.includes('clear')&&action!=='clear')await f.act('clear');
    delayed=true;const old=f.act(action,{values:['chat']});await tick();await f.reader.close();await f.reader.handle(interaction('start',{user:{id:'replacement'},channelId:'PRIVATE_SOURCE'}));const current=f.reader.state.id;
    allow();const response=await old;assert.equal(f.reader.state.id,current);assert.equal(f.reader.state.mode,'raw');assert.equal(f.reader.state.queue.length,0);assert.ok(!JSON.stringify(response.result).includes('PRIVATE_SOURCE'));await f.reader.close();
  }
});

test('default controls recheck current source visibility for owner and administrator before changing modes or clearing',async()=>{
  let visible=true;const guild={id:'guild',members:{fetch:async({user})=>({permissions:{has:()=>user==='admin'}})},channels:{fetch:async()=>({permissionsFor:()=>({has:()=>visible})})}};
  const real=createBackupReader({guild,enabled:true,resolveTargets:async()=>({text:{send:async()=>({async edit(){}})},voice:{id:'voice'}}),authorize:async()=>{},worker:()=>({ready:Promise.resolve(),close(){},async stream(_,__,chunk){chunk(wave());}}),speaker:async()=>({healthy:()=>true,close(){},async play(_s,o){o.onStart();}})});
  await real.handle(interaction('start'));const click=(action,extra={})=>interaction('unused',{customId:`read:${action}:${real.state.id}:${real.state.controlRevision}`,...extra});
  await real.handle(click('pause'));real.onMessage({guildId:'guild',channelId:'text',content:'待機',author:{bot:false}});visible=false;
  for(const user of ['owner','admin']){await real.handle(click('mode',{user:{id:user},values:['chat']}));await real.handle(click('clear',{user:{id:user}}));assert.equal(real.state.mode,'raw');assert.equal(real.state.clearIntent,undefined);}
  visible=true;await real.handle(click('mode',{user:{id:'admin'},values:['chat']}));assert.equal(real.state.mode,'chat');await real.close();
});

test('warming and empty queues disable controls, and UI never contains queued message text',async()=>{
  let ready;const reader=createBackupReader({guild:{id:'guild'},enabled:true,resolveTargets:async()=>({text:{send:async()=>({async edit(){}})},voice:{id:'voice'}}),authorize:async()=>{},canControl:async()=>{},worker:()=>({ready:new Promise(resolve=>ready=resolve),close(){}}),speaker:async()=>({close(){}})});
  const start=interaction('start'),pending=reader.handle(start);await tick();
  const screen=backupReaderScreen(reader.state,true),items=controls(screen);for(const action of ['mode','clear']){assert.equal(items.find(item=>item.custom_id?.split(':')[1]===action).disabled,true);await reader.handle(interaction('unused',{customId:`read:${action}:${reader.state.id}:${reader.state.controlRevision}`,values:['chat']}));}
  assert.equal(reader.state.mode,'raw');assert.equal(reader.state.clearIntent,undefined);ready();await pending;await reader.close();
  const f=await fixture();assert.equal(controls(backupReaderScreen(f.reader.state,true)).find(c=>c.custom_id?.split(':')[1]==='clear').disabled,true);await f.act('pause');f.message('PRIVATE_POST_TEXT');await f.act('clear');
  const value=backupReaderScreen(f.reader.state,true,{details:true});assert.ok(!JSON.stringify(value).includes('PRIVATE_POST_TEXT'));assert.ok(value.components.length<=5);for(const row of value.components)assert.ok(row.toJSON().components.length<=5);for(const e of value.embeds)assert.ok(e.toJSON().description.length<=4096);await f.reader.close();
});
