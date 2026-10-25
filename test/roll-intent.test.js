import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {diceRequest,saizeRequest,createChatDice} from '../src/chat-dice.js';
const expected=[{count:1,sides:10,modifier:0}];
test('hiragana, katakana, natural imperatives and gentle requests preserve the same dice',()=>{
  for(const content of ['1d10ふって','1d10をふってください','1d10をふって下さい','1d10ふってね！','1d10ふってほしい','1d10ふってほしいです','1d10ふってほしいな','1d10ふって欲しいです','1d10ふってちょうだい','1d10ふってくれ','1d10ふってー','1d10ふって〜','1d10おねがい','1d10おねがいします','1d10たのむ','1d10ふります','1d10ふる','1d10フッテ','１ｄ１０ ﾌｯﾃ','1d10まわして','1d10ころがして','1d10転がして','1d10ろーるして','じゃあ目星で1d10ふって','めぼし1d10ふって','<@123456789012345678> 1d10ふって'])assert.deepEqual(diceRequest(content)?.rolls,expected,content);
});
test('delegated polite requests support equivalent verbs and endings, including explicit negative questions',()=>{
  const verbs=['振って','ふって','回して','まわして','転がして','ころがして','ロールして','ろーるして'];
  for(const verb of verbs)for(const ending of ['くれる？','もらえる？','くれない？','もらえない？','くれますか？','もらえますか？','くれませんか？','もらえませんか？','いただける？','いただけない？','いただけますか？','いただけませんか？','もらっていい？','くれるかな？','もらえるかな？','もらえますか','くれませんか','いただけませんか']){
    const content=`1d10を${verb}${ending}`;assert.deepEqual(diceRequest(content)?.rolls,expected,content);
  }
  assert.deepEqual(diceRequest('1d10 ふって くれる？')?.rolls,expected);
});
test('negation, prohibition, permission questions and complaints remain nonrequests across kana variants',()=>{
  const denied=['ふらない','ふりません','ふるな','ふらず','ふらなくていい','ふらんで','ふってない','ふっていない','ふってほしくない','ふってほしくありません','ふってもいい','ふってもいい？','ふる？','ふれる？','ふれますか？','ふっていい？','ふってくれない','ふってもらえない','ふっていただけない','ふってはいけない','ふってください、やっぱりやめて','振らない','振ってもいい？','振るな','ロールしない'];
  for(const ending of denied){const text=`1d10${ending}`;assert.equal(diceRequest(text),null,text);assert.equal(saizeRequest(`!サイゼロール${ending}`),null,ending);}
});
test('explanations, past and conditional speech, quotes, masked links and multiline Discord quotes stay silent',()=>{
  for(const text of ['1d10をふった','1d10をふりました','1d10ふってた','1d10ふったら','1d10ふれば','1d10ふったことがある','1d10をふってと言われた','1d10ふってって言われた','1d10をふっている','1d10をふる予定','1d10をふって使います','1d10です','判定は1d10です','1d10をふってくださいという説明','1d10のれい','1d10ふってくれない？という話','1d10ふってくれる？？','1d10ふって？','「1d10ふって」','`1d10ふって`','```\n1d10ふって\n```','||1d10ふって||','> 1d10ふって','>>> 引用\n1d10ふって','>>>\n!サイゼロールふって','[1d10ふって](https://example.org/dice)','[!サイゼロールふって](https://example.org/menu)','https://example.org/1d10ふって'])assert.equal(diceRequest(text),null,text);
  for(const text of ['>>> 引用\n!サイゼロールふって','[!サイゼロールふって](https://example.org/menu)'])assert.equal(saizeRequest(text),null,text);
});
test('new wording keeps independent dice, modifiers and resource validation and does not accept arbitrary code',()=>{
  assert.deepEqual(diceRequest('1D4,3D10をふってください')?.rolls,[{count:1,sides:4,modifier:0},{count:3,sides:10,modifier:0}]);
  assert.deepEqual(diceRequest('ダメージ2D6-3おねがい')?.rolls,[{count:2,sides:6,modifier:-3}]);
  for(const text of ['101d10ふって','1d1000001ふって','1d10+1000001ふって','100d10,100d10,1d10ふって'])assert.ok(diceRequest(text)?.error,text);
  for(const text of ['1d10ふって;process.exit()','1d10ふって${process.env.TOKEN}','1d10ふって'+ ' '.repeat(1001),null,{}])assert.equal(diceRequest(text),null,String(text));
});
test('Saizeriya accepts the same kana requests while the exact exclamation prefix alone controls menu disclosure',()=>{
  for(const text of ['サイゼロールふって','サイゼロールをふってください','サイゼロールおねがい','サイゼロールふってくれる？','サイゼロールしていただけませんか？','サイゼロールをふってー']){
    assert.deepEqual(saizeRequest(text),{kind:'saize'},text);assert.deepEqual(saizeRequest('!'+text),{kind:'saize',showMenu:true},text);
  }
  assert.deepEqual(saizeRequest('サイゼロールふって！'),{kind:'saize'});
  for(const text of ['!!サイゼロールふって','! サイゼロールふって','サイゼロールのふりかた','サイゼロールふった','サイゼロールふってもいい？','!サイゼロールふってくれない','!サイゼロールです'])assert.equal(saizeRequest(text),null,text);
});
function fixture(content,{changed=false,enabled=true}={}){
  const replies=[],draws=[],message={id:'source',guildId:'guild',channelId:'channel',author:{id:'user',bot:false},content},current={...message,content:changed?'1d10ふらない':content,reply:async reply=>replies.push(reply)},member={user:{bot:false}},channel={guildId:'guild',isTextBased:()=>true,isThread:()=>false,permissionsFor:()=>({has:()=>true}),messages:{fetch:async()=>current}},guild={id:'guild',members:{fetch:async()=>member,fetchMe:async()=>({})},channels:{fetch:async()=>channel}},controller=createChatDice({guild,enabled:()=>enabled,random:(min,max)=>{draws.push([min,max]);return max-1;}});return {message,replies,draws,controller};
}
test('actual kana replies retain cards, standard ten, prefix gating and post-fetch context checks',async()=>{
  const f=fixture('1d10ふってくれない？');await f.controller.onMessage(f.message);await f.controller.onMessage(f.message);assert.equal(f.replies.length,1);assert.match(f.replies[0].embeds[0].data.title,/1D10 → 10/);assert.deepEqual(f.draws,[[1,11]]);assert.deepEqual(f.replies[0].allowedMentions,{parse:[],repliedUser:false});assert.equal(f.replies[0].enforceNonce,true);
  for(const options of [{changed:true},{enabled:false}]){const denied=fixture('1d10ふって',options);await denied.controller.onMessage(denied.message);assert.equal(denied.draws.length,0);assert.equal(denied.replies.length,0);}
  const saize=fixture('!サイゼロールふって');await saize.controller.onMessage(saize.message);assert.match(saize.replies[0].embeds[0].data.title,/サイゼロール → 3400/);assert.match(saize.replies[0].embeds[0].data.description,/10 → 0/);assert.ok(saize.replies[0].embeds[0].data.url);assert.equal(saize.draws.length,3);
});
test('long overlapping request words with a bad suffix finish within a bounded worker without exponential backtracking',async()=>{
  const worker=new Worker(new URL('./fixtures/roll-intent-probe.js',import.meta.url));
  try{const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('intent probe timed out')),8000);worker.once('message',data=>{clearTimeout(timer);resolve(data);});worker.once('error',error=>{clearTimeout(timer);reject(error);});});assert.deepEqual(result,{rejected:90});}finally{await worker.terminate();}
});
test('a complete quantity declaration treats one numeric slot as the requested dice, including playful temperature sentences',()=>{
  for(const content of ['お風呂の温度は1D100度！！','おふろの温度は 1d10 度!','今日のお風呂は1D100℃','サウナの温度は1D100度','今日の運勢は1D100点！','今回のダメージは1d10点','私のHPは1d10','HP=1d10','待ち時間は1d10分','睡眠時間は1d10時間','今日のおやつ代は1d10円','私の寿命は1d10歳','回数は1d10回','身長は1d10cm','体重は1d10kg','<@123456789012345678> お風呂の温度は1d10度'])assert.ok(diceRequest(content)?.rolls,content);
  assert.deepEqual(diceRequest('お風呂の温度は2d10+30度！！')?.rolls,[{count:2,sides:10,modifier:30}]);
  assert.ok(diceRequest('お風呂の温度は101d10度')?.error);
});
test('quantity context is not enough to trigger explanatory, quoted, conditional, malformed or reported speech',()=>{
  for(const content of ['お風呂の温度は1D100度とは？','お風呂の温度は1D100度です','お風呂の温度は1D100度だった','お風呂の温度は1D100度らしい','お風呂の温度は1D100度と言われた','お風呂の温度は1D100度という意味','例：お風呂の温度は1D100度','もしお風呂の温度は1D100度なら','お風呂の温度は1D100度にしない','お風呂の温度は1D100度禁止','「お風呂の温度は1D100度！！」','>>> 引用\nお風呂の温度は1D100度！！','[お風呂の温度は1D100度](https://example.org)','温度の説明で1D100を使う','私がふったお風呂の温度は1d100度','温度は1d10円','お風呂の温度は1d10度と1d4度','これは1D100度','お風呂の温度は1d10度ですか？','報告ではお風呂の温度は1d100度','記事に書いたお風呂の温度は1d100度','もしお風呂の温度は1d100度'])assert.equal(diceRequest(content),null,content);
});
test('playful declarations reply once with complete dice results without copying the surrounding sentence',async()=>{
  const f=fixture('お風呂の温度は1D100度！！');await f.controller.onMessage(f.message);await f.controller.onMessage(f.message);assert.equal(f.replies.length,1);const d=f.replies[0].embeds[0].toJSON();assert.match(d.title,/1D100 → 100/);assert.match(d.description,/`100`/);assert.doesNotMatch(d.description,/お風呂|温度/);assert.deepEqual(f.draws,[[1,101]]);
});
