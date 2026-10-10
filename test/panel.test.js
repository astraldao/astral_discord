import test from 'node:test';
import assert from 'node:assert/strict';
import {createPanelRefresher} from '../src/panel.js';

const lobbyId='111111111111111111';
function fixture() {
  let c={version:1,lobbyId,targetIds:[],seconds:5,voice:true,volume:30,enforce:true,words:[],panel:null};
  let sends=0,edits=0,deletes=0;
  const message={id:'333333333333333333',async edit(){edits++;},async delete(){deletes++;}};
  const channel={type:2,messages:{async fetch(){return message;}},async send(){sends++;return message;}};
  const settings={get:()=>structuredClone(c),async update(fn){const next=structuredClone(c);fn(next);c=next;}};
  const guild={channels:{async fetch(){return channel;}}};
  return {settings,channel,refresh:createPanelRefresher({settings,guild}),counts:()=>({sends,edits,deletes})};
}
test('simultaneous panel installs create one message and update it thereafter',async()=>{
  const f=fixture();
  await Promise.all([f.refresh(true),f.refresh(true),f.refresh(true)]);
  assert.deepEqual(f.counts(),{sends:1,edits:2,deletes:0});
  assert.equal(f.settings.get().panel.channelId,lobbyId);
});
test('a lobby change during sending discards the obsolete panel without overwriting settings',async()=>{
  const f=fixture(),send=f.channel.send;
  f.channel.send=async()=>{
    const message=await send();
    await f.settings.update(c=>{c.lobbyId='222222222222222222';});
    return message;
  };
  await assert.rejects(f.refresh(true),/ロビーが変更/);
  assert.equal(f.settings.get().panel,null);assert.equal(f.counts().deletes,1);
  f.channel.send=send;
  await f.refresh(true);
  assert.equal(f.settings.get().panel.channelId,'222222222222222222');
});
test('missing messages can be replaced but permission errors never create duplicates',async()=>{
  const f=fixture();await f.refresh(true);
  f.channel.messages.fetch=async()=>{throw Object.assign(new Error('denied'),{code:50013});};
  await assert.rejects(f.refresh(true),/denied/);assert.equal(f.counts().sends,1);
  f.channel.messages.fetch=async()=>{throw Object.assign(new Error('missing'),{code:10008});};
  await f.refresh(true);assert.equal(f.counts().sends,2);
});
test('a failed settings write removes the new panel and the next install can recover',async()=>{
  const f=fixture(),update=f.settings.update;
  f.settings.update=async()=>{throw new Error('disk failure');};
  await assert.rejects(f.refresh(true),/disk failure/);
  assert.equal(f.counts().deletes,1);assert.equal(f.settings.get().panel,null);
  f.settings.update=update;await f.refresh(true);
  assert.ok(f.settings.get().panel);
});
