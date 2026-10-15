import test from 'node:test';
import assert from 'node:assert/strict';
import {ChannelType,PermissionFlagsBits as P} from 'discord.js';
import {lobbyEntryGuide} from '../src/vc-entry-ui.js';
test('visible lobby guide links to the lobby and explains how to continue without moving the member',async()=>{
  const member={},guild={id:'guild',channels:{fetch:async(id,options)=>{assert.equal(id,'lobby');assert.equal(options.force,true);return {id,type:ChannelType.GuildVoice,permissionsFor:m=>{assert.equal(m,member);return {has:()=>true};}};}}};
  const m=await lobbyEntryGuide({guild,member,lobbyId:'lobby'}),b=m.components.flatMap(r=>r.toJSON().components);
  assert.match(m.embeds[0].toJSON().description,/<#lobby>/);assert.match(m.embeds[0].toJSON().description,/入室先を確認/);
  assert.equal(b.find(c=>c.url).url,'https://discord.com/channels/guild/lobby');assert.ok(b.some(c=>c.custom_id==='menu:vc'&&c.style===1));assert.ok(b.some(c=>c.custom_id==='menu:open'));assert.deepEqual(m.attachments,[]);assert.deepEqual(m.allowedMentions.parse,[]);
});
test('hidden, deleted and changed-type lobbies disclose no ID or channel link',async()=>{
  for(const fetch of [async()=>null,async()=>{throw new Error('missing');},async()=>({id:'private-lobby',type:ChannelType.GuildText,permissionsFor:()=>({has:()=>true})}),async()=>({id:'private-lobby',type:ChannelType.GuildVoice,permissionsFor:()=>({has:()=>false})})]){
    const m=await lobbyEntryGuide({guild:{id:'guild',channels:{fetch}},member:{},lobbyId:'private-lobby'});
    assert.ok(!JSON.stringify(m).includes('private-lobby'));assert.ok(!m.components.flatMap(r=>r.toJSON().components).some(c=>c.url));assert.match(m.embeds[0].toJSON().description,/管理者/);
  }
});
test('visible lobby without Connect explains permissions and does not offer a primary retry',async()=>{
  const m=await lobbyEntryGuide({guild:{id:'guild',channels:{fetch:async()=>({id:'lobby',type:ChannelType.GuildVoice,permissionsFor:()=>({has:p=>p===P.ViewChannel})})}},member:{},lobbyId:'lobby'});
  assert.match(m.embeds[0].toJSON().description,/閲覧・接続権限/);assert.ok(!m.components.flatMap(r=>r.toJSON().components).some(c=>c.style===1));
});
