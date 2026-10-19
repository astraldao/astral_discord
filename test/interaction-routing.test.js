import test from 'node:test';
import assert from 'node:assert/strict';
import {interactionRoute,createInteractionHandlers} from '../src/interaction-routing.js';
import {commands} from '../src/commands.js';
const interaction=(kind,value)=>({customId:kind==='command'?undefined:value,commandName:kind==='command'?value:undefined,isChatInputCommand:()=>kind==='command',isButton:()=>kind==='button',isStringSelectMenu:()=>kind==='string',isAnySelectMenu:()=>['string','user','role','channel'].includes(kind),isModalSubmit:()=>kind==='modal'});

test('registered commands and legacy compatibility select the correct entry without enabling new commands',()=>{
  for(const [name,target] of [['menu','menu'],['admin','admin'],['vc','vc'],['read','read'],['game','game-lobby']])assert.deepEqual(interactionRoute(interaction('command',name)),{kind:'command',namespace:name,target});
  assert.deepEqual(commands().map(c=>c.name),['menu','admin']);
  for(const name of ['perf','schedule','calendars','chips','stop','unknown','constructor'])assert.equal(interactionRoute(interaction('command',name)),null);
});
test('buttons, forms and select types retain their supported namespaces; VC selection cannot become a general feature route',()=>{
  const general=['perf','restart','runtime','banner','read','updates','admin','densuke','trpg','profile','forum','calendars','schedule','bj','casino','rps','four','wallet','chips','work','game'];
  for(const kind of ['button','string','user','role','channel','modal']){
    for(const namespace of general){const route=interactionRoute(interaction(kind,`${namespace}:session:action`));assert.equal(route?.target,namespace);assert.equal(route?.kind,'component');}
    assert.equal(interactionRoute(interaction(kind,'menu:open'))?.target,kind==='button'?'menu':undefined);
    assert.equal(interactionRoute(interaction(kind,'vc:select'))?.target,['button','string'].includes(kind)?'vc':undefined);
  }
});
test('names must match exactly and unrecognized interactions or missing IDs are ignored',()=>{
  for(const id of ['menu','vc','schedule','menu-other:open','xmenu:open','x:admin:open','__proto__:open','constructor:open',':admin','Menu:open','menu\n:open','ａｄｍｉｎ:open',null,undefined])assert.equal(interactionRoute(interaction('button',id)),null,id);
  assert.equal(interactionRoute(interaction('context','admin:open')),null);
});
test('handler table preserves special entry methods and passes the original interaction exactly once',async()=>{
  const calls=[],controllers={};
  for(const name of ['mainMenu','backupReader','speedMeasurements','restarts','runtimeSettings','banner','versions','admin','densuke','trpg','profile','forumTags','sharedSchedules','schedule','blackjack','casino','rps','four','chipAccount','chipTools']){
    const controller={};for(const method of ['handle','lobby','openSelf'])controller[method]=function(i){assert.equal(this,controller);calls.push({name,method,i});};controllers[name]=controller;
  }
  const handlers=createInteractionHandlers(controllers);assert.equal(handlers.has('vc'),false);
  for(const [kind,id,name,method] of [
    ['command','game','blackjack','lobby'],['button','game:select','blackjack','handle'],['button','bj:id:hit','blackjack','handle'],
    ['button','wallet:open','chipAccount','openSelf'],['button','wallet:id:page','chipAccount','handle'],
    ['button','work:id:answer','chipTools','handle'],['modal','chips:id:confirm','chipTools','handle'],
    ['string','calendars:id:select','sharedSchedules','handle'],['modal','schedule:id:form','schedule','handle'],
    ['button','perf:id:cancel','speedMeasurements','handle'],['command','admin','admin','handle'],['button','menu:calendar','mainMenu','handle'],
  ]){
    const i=interaction(kind,id);i.values=['opaque-value'];i.deferred=true;const route=interactionRoute(i),before=calls.length;
    await handlers.get(route.target)(i);assert.equal(calls.length,before+1);assert.deepEqual(calls.at(-1),{name,method,i});assert.deepEqual(i.values,['opaque-value']);assert.equal(i.deferred,true);
  }
});
test('missing controllers or required special methods are rejected during initialization',()=>{
  assert.throws(()=>createInteractionHandlers({}),/呼び出し先/);
  const controllers=new Proxy({},{get:()=>({handle(){}})});assert.throws(()=>createInteractionHandlers(controllers),/blackjack/);
});
