import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {compileDiceExpression,pureAdvancedDice,advancedRollCandidate} from '../src/dice-expression.js';
import {evaluateDiceExpression} from '../src/dice-evaluate.js';
import {diceRequest} from '../src/dice-request.js';
import {routeDiceMessage} from '../src/roll-route.js';
import {rollReply} from '../src/roll-ui.js';
import {createChatDice} from '../src/chat-dice.js';
import {createBeatApiDiceJudge} from '../src/beatapi-dice.js';
const request=formula=>({kind:'advanced',formula}),sequence=values=>{let at=0;return {random:(min,max)=>{const n=values[at++];assert.ok(n>=min&&n<max,`${n}: ${min}..${max}`);return n;},calls:()=>at};};
const run=(formula,values)=>evaluateDiceExpression(request(formula),sequence(values).random);
test('arithmetic uses precedence, parentheses, unary signs and fractional division without executing source',()=>{
  for(const [s,expected] of [['(2d6+3)*2',24],['2d6+3*2',15],['-1d6+10',6],['10-(1d6-2)',8],['1d6/2',2],['1d6/3',4/3],['2*(1d6+1d6)',18],['-(1d6+2)*-2',12]]){
    const values=s.includes('2d6')||s.includes('1d6+1d6')?[4,5]:[4],r=run(s,values);assert.equal(r.roots[0].value,expected,s);
  }
  assert.equal(run('(2d6+3)*2',[4,5]).roots[0].calculation,'(9+3)*2');assert.equal(compileDiceExpression('（２Ｄ６＋３）＊２').formula,'(2D6+3)*2');assert.equal(diceRequest('（２Ｄ６＋３）×２ふって').formula,'(2D6+3)*2');assert.equal(routeDiceMessage('1d6÷2').request.formula,'1D6/2');assert.match(rollReply(request('1d6/3'),()=>4).embeds[0].toJSON().title,/約1\.333333333/);
});
test('keep-high and keep-low select whole dice, retain original ordering and break ties by original index',()=>{
  const high=run('4d6kh3',[6,2,5,3]);assert.equal(high.roots[0].value,14);assert.deepEqual(high.traces[0].dice.map(d=>d.kept),[true,false,true,true]);
  const low=run('4d6kl2',[6,2,5,3]);assert.equal(low.roots[0].value,5);assert.deepEqual(low.traces[0].dice.map(d=>d.kept),[false,true,false,true]);
  assert.deepEqual(run('4d6kh2',[5,5,5,5]).traces[0].dice.map(d=>d.kept),[true,true,false,false]);assert.equal(run('2d20kh1+5',[3,19]).roots[0].value,24);
});
test('natural advantage and disadvantage convert exactly one die while preserving the surrounding arithmetic',()=>{
  for(const [s,formula] of [['有利で1d20','2D20kh1'],['1d20を有利にふって','2D20kh1'],['1d20を不利で','2D20kl1'],['不利で1d20+5','2D20kl1+5'],['有利で(1d20+3)*2','(2D20kh1+3)*2']]){const r=routeDiceMessage(s);assert.equal(r?.kind,'local',s);assert.equal(r.request.formula,formula,s);}
  for(const s of ['有利で2d20','有利で1d20kh1','有利で1d20,1d6'])assert.ok(diceRequest(s)?.error,s);
});
test('rerolls apply once per draw, retain both values and support explicit comparison conditions',()=>{
  const r=run('4d6r1',[1,1,4,1,6,3]);assert.equal(r.roots[0].value,14);assert.deepEqual(r.traces[0].dice.map(d=>d.steps[0]),[{before:1,value:1},{value:4},{before:1,value:6},{value:3}]);assert.equal(r.draws,6);
  for(const [op,value,trigger] of [['<',2,true],['<=',3,true],['>',4,true],['>=',3,true],['!=',2,true],['=',3,true],['==',3,true],['<',3,false],['>',3,false]]){const x=run(`1d6r${op}3`,trigger?[value,5]:[value]);assert.equal(x.draws,trigger?2:1,op);assert.equal(x.roots[0].value,trigger?5:value,op);}
});
test('explosions add maximum faces and reroll a triggering face before deciding whether to explode',()=>{
  const e=run('1d6!',[6,6,3]);assert.equal(e.roots[0].value,15);assert.deepEqual(e.traces[0].dice[0].steps,[{value:6},{value:6},{value:3}]);
  const both=run('1d6r1!',[1,6,1,3]);assert.equal(both.roots[0].value,9);assert.deepEqual(both.traces[0].dice[0].steps,[{before:1,value:6},{before:1,value:3}]);
  const replacement=run('1d6r6!',[6,2]);assert.equal(replacement.draws,2);assert.equal(replacement.roots[0].value,2);
});
test('each exploding chain and the whole request have hard draw caps, with no final success claim after truncation',()=>{
  const a=evaluateDiceExpression(request('1d6!>=10'),()=>6);assert.equal(a.draws,11);assert.equal(a.roots[0].value,66);assert.ok(a.warnings.length);const p=rollReply(request('1d6!>=10'),()=>6).embeds[0].toJSON();assert.match(p.title,/判定未確定/);assert.match(p.description,/追加10回/);assert.doesNotMatch(p.title,/成功|失敗/);
  const b=evaluateDiceExpression(request('100d6!'),()=>6);assert.equal(b.draws,200);assert.equal(b.traces[0].dice.length,100);assert.ok(b.traces[0].dice.every(d=>d.steps.length>=1));assert.ok(b.warnings.length);
});
test('the draw budget reserves all later original dice even when early dice consume every available extra',()=>{
  const r=evaluateDiceExpression(request('40d6!,40d6!,40d6!,40d6!,39d6!'),()=>6);assert.equal(r.draws,200);assert.deepEqual(r.traces.map(t=>t.dice.length),[40,40,40,40,39]);assert.ok(r.traces.every(t=>t.dice.every(d=>d.steps.length>=1)));
  const x=evaluateDiceExpression(request('100d6r1,100d6r1'),()=>1);assert.equal(x.draws,200);assert.ok(x.warnings.length);assert.equal(x.roots[0].value,100);assert.equal(x.roots[1].value,100);
});
test('success pools compare each retained original die or exploding chain, not the sum of the pool',()=>{
  const r=run('5d10cs>=8',[8,3,10,7,9]);assert.equal(r.roots[0].value,3);
  assert.equal(run('5d10kh3cs>=8',[8,3,10,7,9]).roots[0].value,3);assert.equal(run('5d10kl3cs>=8',[8,3,10,7,9]).roots[0].value,1);
  assert.equal(run('2d6!kh1cs>=8',[6,3,5]).roots[0].value,1);assert.equal(run('3d6cs=1',[1,6,1]).roots[0].value,2);
});
test('target comparisons apply to the final arithmetic result and have no system-specific critical rules',()=>{
  for(const [op,target,pass] of [['<=',70,true],['<',42,false],['>=',42,true],['>',42,false],['=',42,true],['==',42,true],['!=',42,false]]){const r=run(`1d100${op}${target}`,[42]);assert.equal(r.roots[0].passed,pass,op);}
  assert.equal(run('1d6-10<=-3',[6]).roots[0].passed,true);assert.equal(run('(2d6+3)*2>=20',[4,5]).roots[0].passed,true);assert.equal(run('5d10cs>=8>=3',[8,3,10,7,9]).roots[0].passed,true);
});
test('invalid formulas, duplicated options and excessive bounds are rejected before any RNG call',()=>{
  for(const formula of ['0d6!','101d6kh1','1d1!','1d1000001!','4d6kh0','4d6kh5','4d6kh1kl1','1d6r1r2','1d6!!','1d6cs>=1cs>=2','1d6cs','1d6>=','1d6+','1d6**2','1d6(2)','1d6;process.exit()','1d6+globalThis.x','1d6/Math.random()','1d6+1000001','1d6+1,4','1d6>=1d6','1d6,1d6,1d6,1d6,1d6,1d6','100d6!,100d6!,1d6!'])assert.throws(()=>rollReply(request(formula),()=>assert.fail('invalid request drew a die')),formula);
});
test('deep nesting, long canonical formulas, excessive tokens and forged requests stay bounded',()=>{
  for(const formula of ['('.repeat(17)+'1d6'+')'.repeat(17),'1d6'+'+123456'.repeat(20),'-'.repeat(150)+'1d6','9'.repeat(7900)+'d6!'])assert.throws(()=>compileDiceExpression(formula));
  for(const r of [null,{kind:'advanced',formula:{}},{kind:'advanced',formula:'1+2'},{kind:'advanced',formula:'1d6',roots:[{constructor:'unsafe'}]}]){if(r?.formula==='1d6')assert.equal(evaluateDiceExpression(r,()=>3).roots[0].value,3);else assert.throws(()=>evaluateDiceExpression(r,()=>assert.fail('must not draw')));}
  const z='0'.repeat(1000);assert.equal(pureAdvancedDice(z+'4d'+z+'6kh3').formula,'4D6kh3');
});
test('runtime zero division and arithmetic overflow preserve all already requested dice instead of rerolling',()=>{
  const r=run('1d6/(1d2-1),1d8kh1',[4,1,7]);assert.equal(r.draws,3);assert.equal(r.roots[0].value,null);assert.match(r.roots[0].error,/0で割る/);assert.equal(r.roots[1].value,7);assert.equal(r.traces.length,3);
  const p=rollReply(request('1d6/0'),()=>4).embeds[0].toJSON();assert.match(p.title,/計算できません/);assert.match(p.description,/`4`/);
  assert.match(run('1d6*1000000*1000000',[6]).roots[0].error,/1兆/);
});
test('normal prose limits, huge pure expressions, protected areas, negations and past reports still take precedence',()=>{
  for(const s of ['あ'.repeat(25)+'4d6kh3','`4d6kh3`','||1d6!||','> 1d100<=70','>>>\n4d6kh3','「4d6kh3」','4d6kh3ふらない','4d6kh3とは？','有利で1d20振ってもいい？','4d6kh3ふった','確率 1d100<=70'])assert.equal(routeDiceMessage(s),null,s);
  assert.ok(routeDiceMessage('100000000d100000000000000000kh1').request.error);assert.equal(routeDiceMessage('この4d6kh3どうしよう').kind,'judge');
  assert.deepEqual(routeDiceMessage('この4d6kh3どうしよう').request,{kind:'advanced',formula:'4D6kh3'});assert.equal(advancedRollCandidate('この(2d6+3)*2どうしよう').request.formula,'(2D6+3)*2');
  for(const s of ['4d6kh3abc','1d6^2','1d6%2','1d6 % 2'])assert.ok(routeDiceMessage(s)?.request.error,s);
  for(const s of ['今日の運勢は1d100%','今日の運勢は1d100+1%'])assert.ok(routeDiceMessage(s).request.rolls);
});
test('cards keep every draw, including replacements, explosions and excluded dice in order',()=>{
  const rng=sequence([1,6,6,3,2,1,4]),p=rollReply(request('3d6r1!kh2'),rng.random).embeds[0].toJSON();assert.deepEqual([...p.description.matchAll(/`(\d+)`/gu)].map(m=>Number(m[1])),[1,6,6,3,2,1,4]);assert.match(p.description,/~~`2`~~/);assert.match(p.description,/→/);assert.match(p.description,/\+/);assert.match(p.title,/19/);assert.equal(rng.calls(),7);
});
test('all 200 values fit embeds and text even with keep rules, rerolls, large faces, warnings and five expressions',()=>{
  const cases=['100d1000000kh1,100d1000000kl100','100d1000000kh50cs>=1,100d1000000kl50cs>=1','100d1000000r<1000000,100d1000000r<1000000','100d1000000!,100d1000000!','40d1000000kh1,40d1000000kh1,40d1000000kh1,40d1000000kh1,40d1000000kh1','(100d1000000kh50+1000000)*1000000,100d1000000r1!kl50cs>=1000000'];
  cases.push(Array(5).fill('40d1000000!kh35*1000000').join(','),Array(5).fill('40d1000000kh15*1000000').join(','));
  for(const formula of cases)for(const max of [false,true])for(const embed of [false,true]){
    const random=(min,upper)=>max?upper-1:min,expected=evaluateDiceExpression(request(formula),random),raw=expected.traces.flatMap(t=>t.dice.flatMap(d=>d.steps.flatMap(s=>s.before===undefined?[s.value]:[s.before,s.value]))),p=rollReply(request(formula),random,{embed}),body=embed?p.embeds[0].toJSON().description:p.content;
    assert.ok(body.length<=(embed?4096:2000),`${formula}: ${body.length}`);assert.doesNotMatch(body,/省略|残り\d+|\.\.\./);
    const actual=embed?[...body.matchAll(/`(\d+)`/gu)].map(m=>Number(m[1])):body.split('\n').filter(line=>/^[\d(][\d()→+ ]*$/u.test(line)).flatMap(line=>(line.match(/\d+/gu)??[]).map(Number));assert.deepEqual(actual,raw,formula);assert.ok(expected.draws<=200);
  }
});
function chatFixture(content,{judge=null,edit=false,fail=false}={}){
  let calls=0,replies=0,draws=0;const message={id:'source',guildId:'g',channelId:'c',author:{id:'u',bot:false},content},current={...message,async reply(p){replies++;if(fail)throw new Error('unknown');return p;}},member={user:{bot:false}},channel={guildId:'g',isTextBased:()=>true,isThread:()=>false,permissionsFor:()=>({has:()=>true}),messages:{fetch:async()=>({...current,content:edit&&++calls>1?'changed':content})}},guild={id:'g',members:{fetch:async()=>member,fetchMe:async()=>({})},channels:{fetch:async()=>channel}},controller=createChatDice({guild,judge,random:(min,max)=>{draws++;return max-1;}});
  return {message,controller,counts:()=>({replies,draws})};
}
test('obvious advanced requests never need Jev and still reply once with nonce and current access checks',async()=>{
  const f=chatFixture('4d6kh3',{judge:()=>assert.fail('clear expression must be local')});await f.controller.onMessage(f.message);await f.controller.onMessage(f.message);assert.deepEqual(f.counts(),{replies:1,draws:4});
  const failed=chatFixture('4d6kh3',{fail:true});await failed.controller.onMessage(failed.message);await failed.controller.onMessage(failed.message);assert.deepEqual(failed.counts(),{replies:1,draws:4});
});
test('Jev can approve an ambiguous advanced request but cannot replace its formula, and edits suppress all draws',async()=>{
  for(const edit of [false,true]){
    let calls=0;const j=createBeatApiDiceJudge({apiKey:'fixture-key',fetcher:async(_,o)=>{calls++;assert.deepEqual(JSON.parse(o.body).state,{text:'この4d6kh3どうしよう'});return new Response(JSON.stringify({model:'jev-1.14-free',answers:{should_roll:{type:'noul',noul:1}}}),{headers:{'Content-Type':'application/json'}});}}),f=chatFixture('この4d6kh3どうしよう',{edit,judge:(text,options)=>j.decide(text,options)});await f.controller.onMessage(f.message);assert.deepEqual(f.counts(),edit?{replies:0,draws:0}:{replies:1,draws:4});assert.equal(calls,edit?0:1);
  }
});
test('malformed and adversarial 8000-character inputs finish in a worker without excessive parser work',async()=>{
  const worker=new Worker(new URL('./fixtures/dice-expression-probe.js',import.meta.url));try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{void worker.terminate();reject(new Error('dice parser exceeded 5 seconds'));},5000);worker.once('message',n=>{clearTimeout(timer);assert.equal(n,120);resolve();});worker.once('error',e=>{clearTimeout(timer);reject(e);});});}finally{await worker.terminate();}
});
