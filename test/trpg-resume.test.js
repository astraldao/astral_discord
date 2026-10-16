import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrpgController} from '../src/trpg-ui.js';
import {TrpgStore} from '../src/trpg-store.js';
function interaction(){return {user:{id:'owner'},channelId:'channel',async deferReply(){this.deferred=true;},async editReply(m){this.result=m;}};}
test('table management reopens search and drafts in the same channel without exposing them after role loss',async()=>{
  let allowed=true;const c=createTrpgController({store:new TrpgStore(),guild:{channels:{cache:new Map()}},access:async()=>allowed});
  await c.open(interaction());const s=[...c.sessions.sessions.values()][0],expiry=s.expires;Object.assign(s,{view:'scenarios',query:'星の神話',scenarioDraft:{name:'入力中',url:'https://ccfolia.com/rooms/draft'}});
  const again=interaction();await c.open(again);assert.equal(c.sessions.sessions.get(s.id),s);assert.equal(s.query,'星の神話');assert.equal(s.scenarioDraft.name,'入力中');assert.equal(s.expires,expiry);assert.ok(JSON.stringify(again.result).includes('星の神話'));
  s.busy=true;await assert.rejects(c.open(interaction()),/処理中/);assert.equal(c.sessions.sessions.get(s.id),s);s.busy=false;
  allowed=false;await assert.rejects(c.open(interaction()),/管理者専用/);assert.equal(c.sessions.sessions.get(s.id),s);
});
test('public character sessions cannot be resumed as management and expired drafts start fresh',async()=>{
  const c=createTrpgController({store:new TrpgStore(),guild:{channels:{cache:new Map()}},access:async()=>true}),publicSession=c.sessions.create('owner');Object.assign(publicSession,{view:'characters',originChannelId:'channel',isAdmin:true,panelId:'public'});
  await c.open(interaction());const admin=[...c.sessions.sessions.values()][0];assert.notEqual(admin.id,publicSession.id);assert.equal(admin.entry,'admin');assert.equal(admin.view,'home');
  admin.expires=0;await c.open(interaction());assert.notEqual([...c.sessions.sessions.values()][0].id,admin.id);
});
test('a removed selected table returns to the table list instead of repeatedly failing on reopen',async()=>{
  const c=createTrpgController({store:new TrpgStore(),guild:{channels:{cache:new Map()}},access:async()=>true});await c.open(interaction());const s=[...c.sessions.sessions.values()][0];Object.assign(s,{view:'table',tableId:'removed'});
  const again=interaction();await c.open(again);assert.equal(s.view,'tables');assert.equal(s.tableId,undefined);assert.ok(again.result.components.length>0);
});
