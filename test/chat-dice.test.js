import test from 'node:test';
import assert from 'node:assert/strict';
import {Client,GatewayIntentBits,IntentsBitField,ApplicationFlagsBitField,Routes} from 'discord.js';
import {diceRequest,rollDice,createChatDice,configureDiceContent} from '../src/chat-dice.js';
import {changeSettings} from '../src/admin.js';
const request=s=>diceRequest(s);
test('bare, Japanese declarations, explicit requests and fullwidth expressions are accepted',()=>{
 for(const text of ['1D100','1d4','3D10','１Ｄ１００','1D4,3D10','判定1D100','1D100を振って','1D100を振ってください','1D100振ってくれる？','3D10ロールしてもらえる？','ダメージ 3D10','回復 1D4+2','roll 3d10','SANチェック 1d100','<@123456789012345678> 1d100'])assert.ok(request(text)?.rolls,text);
 assert.deepEqual(request('1D4,3D10').rolls,[{count:1,sides:4,modifier:0},{count:3,sides:10,modifier:0}]);assert.equal(request('3d10-2').rolls[0].modifier,-2);
});
test('explanations, questions, negations, examples, narratives, code, quotes and unrelated prose are not requests',()=>{
 for(const text of ['1D100とは？','1D100って何','1D100を振らない','1D100振ってほしくない','1D100は振りません','例:1D100','1D100の平均','1D100で判定するルール','1D100を振ってと言われた','1D100を振った','1D100を振ってもいい','Can I roll 1d100?','Do not roll 3d10','今日は1D100を使って遊ぶ予定です','`1D100`','```\n3d10\n```','||1D4||','> 1D100','「1D100」','https://example.org/1d100','a1d100','1d100abc','ありがとう'])assert.equal(request(text),null,text);
 assert.equal(request('x'.repeat(1001)),null);assert.equal(request({}),null);
});
test('resource caps are validated before drawing and request text is never executable',()=>{
 for(const text of ['0D100','101D100','1D1','1D1000001','1D6+1000001','100D6,100D6,1D6','1D6,1D6,1D6,1D6,1D6,1D6'])assert.ok(request(text)?.error,text);
 assert.equal(request('1D100; process.exit()'),null);assert.equal(request('1D100+foo'),null);assert.throws(()=>rollDice({rolls:[{count:1e9,sides:6,modifier:0}]}));
});
test('secure draw boundaries, totals, modifiers and bounded individual results are correct',()=>{
 const bounds=[],text=rollDice(request('3D10+2'),(min,max)=>{bounds.push([min,max]);return max-1;});assert.deepEqual(bounds,[[1,11],[1,11],[1,11]]);assert.match(text,/3D10\+2 → 32/);assert.match(text,/10, 10, 10/);
 const max=rollDice(request('100D1000000,100D1000000'),()=>1000000);assert.ok(max.length<2000);assert.match(max,/残り80個/);assert.match(max,/100000000/);
});
function fixture(){let stamp=1000,enabled=true,visible=true,fail=false,edited=false,archived=false;const replies=[],message={id:'message',guildId:'guild',channelId:'channel',content:'3D10',author:{id:'user',bot:false}},current={...message,async reply(m){replies.push(m);if(fail)throw new Error('SECRET');}};
 const member={user:{bot:false}},channel={guildId:'guild',isTextBased:()=>true,isThread:()=>false,get archived(){return archived;},permissionsFor:()=>({has:()=>visible}),messages:{async fetch(){return {...current,content:edited?'changed':current.content};}}};
 const guild={id:'guild',members:{fetch:async()=>member,fetchMe:async()=>({})},channels:{fetch:async()=>channel}},controller=createChatDice({guild,enabled:()=>enabled,now:()=>stamp,random:()=>4});
 return {message,current,channel,guild,replies,controller,now:n=>stamp=n,enabled:v=>enabled=v,visible:v=>visible=v,fail:v=>fail=v,edited:v=>edited=v,archived:v=>archived=v};}
test('valid human posts receive one reply with no mentions, individual values and no source text',async()=>{
 const f=fixture();await f.controller.onMessage(f.message);assert.equal(f.replies.length,1);assert.match(f.replies[0].content,/3D10 → 12/);assert.deepEqual(f.replies[0].allowedMentions,{parse:[],repliedUser:false});assert.equal(f.replies[0].failIfNotExists,true);assert.equal(f.replies[0].nonce,f.message.id);assert.equal(f.replies[0].enforceNonce,true);
});
test('bot/webhook/DM/foreign guild/system/partial messages and irrelevant conversations are ignored',async()=>{
 for(const extra of [{guildId:null},{guildId:'other'},{author:{id:'bot',bot:true}},{webhookId:'hook'},{system:true},{partial:true},{content:'例は1D100です'},{content:'ordinary'}]){const f=fixture();await f.controller.onMessage({...f.message,...extra});assert.equal(f.replies.length,0);}
});
test('permission loss, archived threads, edited/deleted source and disabled settings suppress replies',async()=>{
 for(const mode of ['permission','archived','edited','disabled','missing','late-permission']){const f=fixture();if(mode==='permission')f.visible(false);if(mode==='archived')f.archived(true);if(mode==='edited')f.edited(true);if(mode==='disabled')f.enabled(false);if(mode==='missing')f.channel.messages.fetch=async()=>{throw new Error('missing');};if(mode==='late-permission')f.channel.messages.fetch=async()=>{f.visible(false);return f.current;};await f.controller.onMessage(f.message);assert.equal(f.replies.length,0,mode);}
});
test('deduplication and cooldowns prevent duplicate posts and unknown outcomes never retry',async()=>{
 const f=fixture();f.fail(true);await f.controller.onMessage(f.message);await f.controller.onMessage(f.message);assert.equal(f.replies.length,1);f.fail(false);await f.controller.onMessage({...f.message,id:'second'});assert.equal(f.replies.length,1);f.now(4000);await f.controller.onMessage({...f.message,id:'second'});assert.equal(f.replies.length,2);
});
test('at most four replies can be pending and message edits during permission lookup cannot change the dice',async()=>{
 const f=fixture();let release;f.guild.members.fetch=()=>new Promise(resolve=>release=resolve);const original=f.controller.onMessage(f.message);await new Promise(r=>setImmediate(r));f.message.content='100D10';release({user:{bot:false}});f.guild.members.fetch=async()=>({user:{bot:false}});await original;assert.equal(f.replies.length,1);assert.match(f.replies[0].content,/3D10/);
 const g=fixture(),waiting=[];g.channel.messages.fetch=async options=>({...g.current,id:options.message,author:{id:`user${options.message}`,bot:false}});g.guild.members.fetch=()=>new Promise(resolve=>waiting.push(resolve));const jobs=[];for(let n=0;n<5;n++){g.now(1000+n*300);jobs.push(g.controller.onMessage({...g.message,id:String(n),author:{id:`user${n}`}}));}await new Promise(r=>setImmediate(r));assert.equal(waiting.length,4);g.guild.members.fetch=async()=>({user:{bot:false}});for(const done of waiting)done({user:{bot:false}});await Promise.all(jobs);assert.equal(g.replies.length,4);
});
test('content intent requires existing Discord approval and failures keep mention-mode available',async()=>{
 assert.equal(Routes.oauth2CurrentApplication(),'/oauth2/applications/@me');for(const flag of [ApplicationFlagsBitField.Flags.GatewayMessageContent,ApplicationFlagsBitField.Flags.GatewayMessageContentLimited]){const c={options:{intents:new IntentsBitField()}};assert.equal(await configureDiceContent(c,async()=>({flags:flag})),true);assert.ok(c.options.intents.has(GatewayIntentBits.MessageContent));}
 for(const load of [async()=>({flags:0}),async()=>{throw new Error('SECRET');}]){const c={options:{intents:new IntentsBitField()}};assert.equal(await configureDiceContent(c,load),false);assert.equal(c.options.intents.has(GatewayIntentBits.MessageContent),false);}
 const enabled={options:{intents:new IntentsBitField([GatewayIntentBits.MessageContent])}};assert.equal(await configureDiceContent(enabled,()=>assert.fail('already enabled')),true);
});
test('admin live switch accepts only booleans and preserves unrelated settings',()=>{
 const c={version:1,lobbyId:null,targetIds:[],seconds:5,volume:30,voice:true,enforce:true,words:[]};changeSettings(c,'chatDice',false);assert.equal(c.chatDice,false);assert.throws(()=>changeSettings(c,'chatDice','1'));assert.equal(c.voice,true);
});

test('Discord Client frozen intents are replaced before login rather than silently left unchanged',async()=>{
 const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages]});try{assert.equal(Object.isFrozen(client.options.intents),true);await configureDiceContent(client,async()=>({flags:ApplicationFlagsBitField.Flags.GatewayMessageContentLimited}));assert.equal(client.options.intents.has(GatewayIntentBits.MessageContent),true);}finally{await client.destroy();}
});
