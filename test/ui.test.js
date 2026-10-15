import test from 'node:test';
import assert from 'node:assert/strict';
import {commands,canConfigure} from '../src/commands.js';
import {PermissionsBitField,PermissionFlagsBits as P} from 'discord.js';
import {panel,countdownCard,payload,choiceNavigation,waitingCard,cardFooter,setBotIconProvider} from '../src/ui.js';
import {canEnter} from '../src/queue.js';
test('all commands and embed/component payloads serialize under Discord builder limits',()=>{
  const json=commands().map(c=>c.toJSON());assert.deepEqual(json.map(c=>c.name),['menu','admin']);
  assert.equal(json.find(c=>c.name==='admin').options?.length??0,0);
  for(const message of [panel({seconds:5,voice:true}),countdownCard('テストVC',5,5),countdownCard('@everyone',1,15),payload('完了','本文')]) {
    for(const embed of message.embeds)assert.ok(embed.toJSON().description);
    for(const row of message.components)row.toJSON();
    assert.deepEqual(message.allowedMentions.parse,[]);
  }
});
test('settings commands default to administrators and enforce the same permission at execution',()=>{
  const json=commands().map(command=>command.toJSON());
  assert.equal(json.find(command=>command.name==='admin').default_member_permissions,String(P.Administrator));
  assert.ok(!json.find(command=>command.name==='menu').default_member_permissions);
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
test('single-page VC choices keep refresh without useless pagination',()=>{
  const controls=choiceNavigation(0,1).toJSON().components;
  assert.equal(controls.length,1);assert.equal(controls[0].custom_id,'vc:page:0');assert.ok(!controls[0].disabled);
});

test('footer uses Japan date and the current bot icon on every render',t=>{
  let icon='https://cdn.discordapp.com/embed/avatars/0.png';
  setBotIconProvider(()=>icon);t.after(()=>setBotIconProvider(()=>undefined));
  assert.equal(cardFooter(new Date('2026-10-11T14:59:59Z')).text,'created by あすとらる · 2026/10/11');
  assert.equal(cardFooter(new Date('2026-10-11T15:00:00Z')).text,'created by あすとらる · 2026/10/12');
  assert.equal(payload('画面','本文').embeds[0].toJSON().footer.icon_url,icon);
  icon='https://cdn.discordapp.com/embed/avatars/1.png';
  assert.equal(panel({seconds:5,voice:true}).embeds[0].toJSON().footer.icon_url,icon);
});

test('command consolidation registers all entries before retiring chips and legacy names',async()=>{
  const {registerCommands}=await import('../src/commands.js');
  const events=[];
  const old=['管理','ゲーム','vc-panel','vc設定','chips','vc','admin','game','read','unrelated'].map(name=>({name,delete:async()=>events.push(`delete:${name}`)}));
  const guild={commands:{
    create:async c=>events.push(`create:${c.name}`),
    fetch:async()=>new Map(old.map(c=>[c.name,c])),
  }};
  await registerCommands(guild);
  assert.deepEqual(events,[
    'create:menu','create:admin',
    'delete:管理','delete:ゲーム','delete:vc-panel','delete:vc設定','delete:chips','delete:vc','delete:game','delete:read',
  ]);
  const json=commands().map(c=>c.toJSON());
  assert.ok(json.every(c=>/^[a-z]+$/.test(c.name)));
  assert.deepEqual(json.find(c=>c.name==='menu').options[0].choices.map(c=>c.value),['vc','read','game','stop']);
  assert.equal(json.find(c=>c.name==='menu').options[0].required,false);
  // A partial registration must not remove the user's existing entry points.
  for(const failed of ['menu','admin']){
    events.length=0;
    guild.commands.create=async c=>{
      events.push(`create:${c.name}`);
      if(c.name===failed)throw new Error('registration failed');
    };
    await assert.rejects(registerCommands(guild));
    assert.ok(!events.some(x=>x.startsWith('delete:')));
  }
});
