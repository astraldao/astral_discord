import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PersonalReadingsStore} from '../src/personal-readings.js';
import {createProfileController} from '../src/profile-ui.js';
const owner='12345678901234567',other='12345678901234568';
async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'astral-profile-access-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=await new PersonalReadingsStore(join(dir,'names.json')).load();await store.set(owner,'もとのなまえ',null);await store.set(other,'ほかのひと',null);
  let allowed=true;const controller=createProfileController({store,access:async()=>{if(!allowed)throw new Error('このチャンネルの閲覧権限がありません。');return {displayName:'PRIVATE DISPLAY NAME'};}});
  const interaction=(customId,extra={})=>({customId,user:{id:owner},channelId:'channel',message:{flags:{has:()=>true}},async deferUpdate(){this.deferred=true;},async deferReply(){this.deferred=true;},async editReply(value){this.result=value;},async reply(value){this.result=value;this.replied=true;},async showModal(value){this.modal=value;},...extra});
  await controller.open(interaction('profile:open'));const s=[...controller.sessions.sessions.values()][0];
  const act=async(action,extra={})=>{const i=interaction(`profile:${s.id}:${action}`,extra);await controller.handle(i);return i;};
  return {store,controller,s,interaction,act,deny:()=>allowed=false};
}
for(const action of ['submit','confirm-delete'])for(const change of ['revoked','expired','replaced'])test(`personal ${action} refuses ${change} access after waiting for persistence`,{timeout:5000},async t=>{
  const f=await fixture(t);await f.act(action==='submit'?'form':'delete');const before=await readFile(f.store.path,'utf8');let release,entered;
  const gate=new Promise(resolve=>release=resolve),queued=new Promise(resolve=>entered=resolve),set=f.store.set.bind(f.store);f.store.tail=gate;f.store.set=(...args)=>{entered();return set(...args);};
  const i=f.interaction(`profile:${f.s.id}:${action}${action==='submit'?':'+f.s.formToken:''}`,{fields:{getTextInputValue:()=> 'あたらしい'}}),pending=f.controller.handle(i);
  try{await queued;if(change==='revoked')f.deny();if(change==='expired')f.s.expires=0;if(change==='replaced')f.controller.sessions.create(owner);release();await pending;
    assert.equal(await readFile(f.store.path,'utf8'),before);assert.equal(f.store.get(owner),'モトノナマエ');assert.equal(f.s.busy,false);assert.ok(!JSON.stringify(i.result).includes('PRIVATE DISPLAY NAME'));
    await set(other,'あとから','ホカノヒト');assert.equal(f.store.get(other),'アトカラ');
  }finally{release();}
});
test('authorized queued personal registration and removal preserve other users and persist once',async t=>{
  for(const action of ['submit','confirm-delete']){
    const f=await fixture(t);await f.act(action==='submit'?'form':'delete');let release,entered;const gate=new Promise(resolve=>release=resolve),queued=new Promise(resolve=>entered=resolve),set=f.store.set.bind(f.store);f.store.tail=gate;f.store.set=(...args)=>{entered();return set(...args);};
    const pending=f.act(action+(action==='submit'?':'+f.s.formToken:''),{fields:{getTextInputValue:()=> 'あたらしい'}});await queued;release();await pending;
    const value=action==='submit'?'アタラシイ':null;assert.equal(f.store.get(owner),value);assert.equal(f.store.get(other),'ホカノヒト');assert.equal((await new PersonalReadingsStore(f.store.path).load()).get(owner),value);assert.equal(f.s.busy,false);
  }
});
test('loss of access during a completed personal save hides private response without rolling back',async t=>{
  const f=await fixture(t);await f.act('form');const set=f.store.set.bind(f.store);f.store.set=async(...args)=>{await set(...args);f.deny();};
  const i=await f.act(`submit:${f.s.formToken}`,{fields:{getTextInputValue:()=> 'あたらしい'}});
  assert.equal(f.store.get(owner),'アタラシイ');assert.ok(!JSON.stringify(i.result).includes('PRIVATE DISPLAY NAME'));assert.ok(!JSON.stringify(i.result).includes('アタラシイ'));
});
