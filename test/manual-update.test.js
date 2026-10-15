import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {githubRelease,createManualUpdater} from '../scripts/manual-update.js';
import {createUpdateClient} from '../src/update-client.js';
import {createVersionController} from '../src/version-ui.js';
const old='a'.repeat(40),fresh='b'.repeat(40),other='c'.repeat(40);
function fixture({prepare=async()=>'/release/'+fresh,apply=async()=>({rolledBack:false}),latest=async()=>({sha:fresh,version:'2.0.0'})}={}){
  let time=1000000,job,current={sha:old,version:'1.0.0'},checks=0;const presence=[];
  const updater=createManualUpdater({current:async()=>current,latest:async()=>{checks++;return latest();},prepare,apply,presence:x=>presence.push(x),now:()=>time,schedule:fn=>{job=fn;return 1;},cancel:()=>job=null});
  return {updater,presence,checks:()=>checks,advance:ms=>time+=ms,current:v=>current=v,async run(){job();for(let n=0;n<100;n++){await new Promise(r=>setImmediate(r));if(!['preparing','switching'].includes((await updater.status()).phase))return;}throw new Error('update did not settle');}};
}
test('version check pins the package to the validated main SHA and rejects malformed responses',async()=>{
  const urls=[];const fetcher=async(url,options)=>{urls.push(url);assert.equal(options.redirect,'error');return {ok:true,text:async()=>urls.length===1?JSON.stringify({object:{sha:fresh}}):JSON.stringify({version:'2.1.0'})};};
  assert.deepEqual(await githubRelease({fetcher}),{sha:fresh,version:'2.1.0'});assert.ok(urls[1].endsWith(`/${fresh}/package.json`));
  for(const body of ['{}','{"version":"bad"}','x'.repeat(65537)]){
    let count=0;await assert.rejects(githubRelease({fetcher:async()=>({ok:true,text:async()=>++count===1?JSON.stringify({object:{sha:fresh}}):body})}));
  }
});
test('idle/status never polls GitHub, checks are bounded and only a confirmed SHA starts an update',async()=>{
  let prepared=0,applied=0;const f=fixture({prepare:async sha=>{prepared++;assert.equal(sha,fresh);return '/release/'+fresh;},apply:async()=>{applied++;return {rolledBack:false};}});
  await f.updater.request('status');assert.equal(f.checks(),0);await assert.rejects(f.updater.request('start',fresh));
  await f.updater.request('check');await f.updater.request('check');assert.equal(f.checks(),1);await assert.rejects(f.updater.request('start',other));
  const starts=await Promise.allSettled([f.updater.request('start',fresh),f.updater.request('start',fresh)]);assert.equal(starts.filter(x=>x.status==='fulfilled').length,1);assert.deepEqual(f.presence,[true]);assert.equal(prepared,0);
  await f.run();assert.equal(prepared,1);assert.equal(applied,1);assert.equal((await f.updater.status()).phase,'complete');assert.deepEqual(f.presence,[true,false]);
});
test('prepare failures, active games and startup rollback restore normal presence and report the outcome',async()=>{
  for(const options of [{prepare:async()=>{throw new Error('download failed');}},{apply:async()=>{throw Object.assign(new Error('busy'),{code:'UPDATE_BUSY'});}},{apply:async()=>({rolledBack:true})}]){
    const f=fixture(options);await f.updater.request('check');await f.updater.request('start',fresh);await f.run();assert.ok(['failed','blocked'].includes((await f.updater.status()).phase));assert.ok((await f.updater.status()).error);assert.deepEqual(f.presence,[true,false]);
  }
  const expired=fixture();await expired.updater.request('check');expired.advance(600001);await assert.rejects(expired.updater.request('start',fresh));assert.deepEqual(expired.presence,[]);
  const same=fixture();await same.updater.request('check');same.current({sha:fresh,version:'2.0.0'});await assert.rejects(same.updater.request('start',fresh));
});
test('RPC correlates responses and disconnects/timeouts reject without exposing a local fallback updater',async()=>{
  const channel=new EventEmitter();channel.connected=true;const sent=[];channel.send=(m,done)=>{sent.push(m);done();};
  const client=createUpdateClient({channel,supported:true,timeout:10});const p=client.request('status');channel.emit('message',{type:'update-rpc-result',id:'wrong',data:'wrong'});channel.emit('message',{type:'update-rpc-result',id:sent[0].id,data:{phase:'idle'}});assert.deepEqual(await p,{phase:'idle'});
  await assert.rejects(client.request('check'),/応答/);const disconnected=client.request('status');channel.emit('disconnect');await assert.rejects(disconnected,/接続/);client.close();assert.equal(channel.listenerCount('message'),0);
  const unavailable=createUpdateClient({channel,supported:false,version:'1.0.0'});assert.equal((await unavailable.request('status')).supported,false);await assert.rejects(unavailable.request('start',fresh));unavailable.close();
});
function i(customId='open',user='owner',channelId='channel'){return {customId,user:{id:user},channelId,message:{flags:{has:()=>true}},replies:[],async deferUpdate(){this.deferred=true;},async deferReply(){this.deferred=true;},async editReply(p){this.replies.push(p);},async reply(p){this.replies.push(p);this.replied=true;}};}
test('admin version UI requires fresh permission, owner, channel, confirmation and current controls',async()=>{
  const f=fixture();let allowed=true;const controller=createVersionController({updater:f.updater,access:async()=>allowed});await controller.open(i());const s=[...controller.sessions.sessions.values()][0];const click=action=>i(`updates:${s.id}:${s.turn}:${action}`);
  await controller.handle(click('start'));assert.equal((await f.updater.status()).phase,'idle');
  await controller.handle(click('check'));await controller.handle(click('confirm'));assert.equal(s.confirm,true);
  const stale=click('start');stale.customId=stale.customId.replace(`:${s.turn}:`,':999:');await controller.handle(stale);assert.equal((await f.updater.status()).phase,'idle');
  for(const bad of [Object.assign(click('start'),{user:{id:'other'}}),Object.assign(click('start'),{channelId:'other'})]){await controller.handle(bad);assert.equal((await f.updater.status()).phase,'idle');}
  allowed=false;await controller.handle(click('start'));assert.equal((await f.updater.status()).phase,'idle');allowed=true;
  await controller.handle(click('start'));assert.equal((await f.updater.status()).phase,'preparing');assert.equal(s.confirm,false);assert.ok(JSON.stringify(s.data).includes('preparing'));f.updater.close();
});
test('permission loss during a version check does not display the returned version information',async()=>{
  let allowed=true;const f=fixture({latest:async()=>{allowed=false;return {sha:fresh,version:'2.0.0'};}}),controller=createVersionController({updater:f.updater,access:async()=>allowed});await controller.open(i());const s=[...controller.sessions.sessions.values()][0],check=i(`updates:${s.id}:${s.turn}:check`);await controller.handle(check);assert.ok(!JSON.stringify(check.replies).includes('2.0.0'));assert.equal((await f.updater.status()).phase,'idle');
});
