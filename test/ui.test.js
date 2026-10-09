import test from 'node:test';
import assert from 'node:assert/strict';
import {commands} from '../src/commands.js';
import {panel,countdownCard,payload} from '../src/ui.js';
import {canEnter} from '../src/queue.js';
test('all commands and embed/component payloads serialize under Discord builder limits',()=>{
  const json=commands().map(c=>c.toJSON());assert.deepEqual(json.map(c=>c.name),['vc','vc設定']);
  assert.equal(json[1].options.length,12);
  for(const message of [panel({seconds:5,voice:true}),countdownCard('テストVC',5,5),countdownCard('@everyone',1,15),payload('完了','本文')]) {
    for(const embed of message.embeds)assert.ok(embed.toJSON().description);
    for(const row of message.components)row.toJSON();
    assert.deepEqual(message.allowedMentions.parse,[]);
  }
});
test('explicit destination list does not admit other VCs in same category',()=>{
  const c={id:'123',type:2,parentId:'category',userLimit:0,permissionsFor:()=>({has:()=>true})};
  assert.equal(canEnter(c,{}, {},'lobby',['123']),true);
  assert.equal(canEnter({...c,id:'private'},{},{},'lobby',['123']),false);
});
