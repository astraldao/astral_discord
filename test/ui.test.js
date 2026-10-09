import test from 'node:test';
import assert from 'node:assert/strict';
import {commands,canConfigure} from '../src/commands.js';
import {PermissionsBitField,PermissionFlagsBits as P} from 'discord.js';
import {panel,countdownCard,payload,choiceNavigation,waitingCard} from '../src/ui.js';
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
test('settings commands default to administrators and enforce the same permission at execution',()=>{
  const json=commands().map(command=>command.toJSON());
  assert.equal(json.find(command=>command.name==='vc設定').default_member_permissions,String(P.Administrator));
  assert.ok(!json.find(command=>command.name==='vc').default_member_permissions);
  assert.equal(canConfigure(new PermissionsBitField(P.Administrator)),true);
  assert.equal(canConfigure(new PermissionsBitField(P.ManageGuild)),false);
  assert.equal(canConfigure(new PermissionsBitField()),false);
  assert.equal(canConfigure(null),false);
});
test('destination pagination and queue progress remain usable at the first and last pages',()=>{
  const first=choiceNavigation(0,5).toJSON().components;
  const last=choiceNavigation(4,5).toJSON().components;
  assert.equal(first[0].disabled,true);assert.equal(first[2].disabled,false);
  assert.equal(last[0].disabled,false);assert.equal(last[2].disabled,true);
  assert.equal(first[1].custom_id,'vc:page:0');
  assert.match(waitingCard('test',2,5).embeds[0].toJSON().description,/2人/);
  assert.match(waitingCard('test',0,5).embeds[0].toJSON().description,/まもなく/);
});
test('explicit destination list does not admit other VCs in same category',()=>{
  const c={id:'123',type:2,parentId:'category',userLimit:0,permissionsFor:()=>({has:()=>true})};
  assert.equal(canEnter(c,{}, {},'lobby',['123']),true);
  assert.equal(canEnter({...c,id:'private'},{},{},'lobby',['123']),false);
});
