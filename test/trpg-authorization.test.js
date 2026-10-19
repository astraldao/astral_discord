import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {TrpgStore,characterRevision} from '../src/trpg-store.js';
import {createTrpgController,trpgPanel} from '../src/trpg-ui.js';
import {createTrpgRepair} from '../src/trpg-repair.js';
const flows=['scenario-create','scenario-edit','table-create','table-edit','table-copy','table-pin','table-scenario','table-add-pc','table-remove-pc','table-delete','foreign-update','foreign-delete','own-register','own-delete','panel-place'];
async function queuedChange(flow,change){
  const dir=await mkdtemp(join(tmpdir(),'astral-trpg-access-'));let allowed=true,release,entered,posts=0;
  try{
    const store=await new TrpgStore(join(dir,'trpg.json')).load(),panel=await store.addPanel('channel','secret');
    const foreign=await store.saveCharacter(panel,'owner','https://iachara.com/view/1',{name:'PRIVATE PC',txt:'PRIVATE BACKUP'}),own=await store.saveCharacter(panel,'actor','https://iachara.com/view/2',{name:'OWN PC',txt:'OWN BACKUP'}),scenario=await store.scenario('base','https://ccfolia.com/rooms/base'),table=await store.saveTable(null,'original','');
    if(flow==='table-remove-pc')await store.changeTableCharacters(table,[foreign]);
    const ownerFlow=flow.startsWith('own-'),controller=createTrpgController({store,access:async()=>{if(!allowed&&ownerFlow)throw new Error('閲覧権限がありません。');return allowed&&!ownerFlow;},guild:{members:{me:{}},channels:{cache:new Map(),fetch:async()=>({id:'destination',type:0,permissionsFor:()=>({has:()=>true}),send:async()=>{posts++;return {id:'posted',delete:async()=>{}};}})}},iachara:{fetchCharacter:async()=>({name:'updated',txt:'updated backup'})}}),s=controller.sessions.create('actor');
    Object.assign(s,{entry:ownerFlow?'panel':'admin',originChannelId:'channel',view:'table',panelId:panel,tableId:table,characterId:flow==='own-delete'?own:foreign,isAdmin:!ownerFlow});
    const revision=JSON.stringify(store.table(table));let action;
    if(flow.startsWith('scenario-')){action='submit-scenario:token';s.scenarioModal={token:'token',id:flow.endsWith('edit')?scenario:null,revision:flow.endsWith('edit')?JSON.stringify(store.metadata().scenarios[0]):undefined};}
    if(['table-create','table-edit'].includes(flow)){action='submit-table:token';s.tableModal={token:'token',id:flow.endsWith('edit')?table:null,revision:flow.endsWith('edit')?revision:undefined};}
    if(flow==='table-copy'){action='submit-table-copy:token';s.copyModal={token:'token',id:table,revision};}
    if(flow==='table-pin'){action='pin-table';s.tableStateRevision=revision;}
    if(flow==='table-scenario')action='table-set-scenario';
    if(flow==='table-add-pc')action='table-add-characters';
    if(flow==='table-remove-pc')action='table-remove-characters';
    if(flow==='table-delete'){action='confirm-delete-table';s.view='delete-table';s.deleteTable=revision;}
    if(flow==='foreign-update'){action='refresh';s.view='detail';}
    if(flow==='own-register'){action='submit-register';s.view='characters';}
    if(flow.endsWith('-delete')&&flow!=='table-delete'){action='confirm-delete-character';s.view='delete-character';s.deleteCharacter={id:s.characterId,revision:characterRevision(store.character(s.characterId,'actor',panel,true))};}
    if(flow==='panel-place'){action='place';s.view='install';s.channelId='destination';s.mode='secret';}
    const i={customId:`trpg:${s.id}:${action}`,user:{id:'actor'},channelId:'channel',message:{flags:{has:()=>false}},values:[flow==='table-scenario'?scenario:foreign],fields:{getTextInputValue:key=>({name:'changed',url:flow==='own-register'?'https://iachara.com/view/3':'https://ccfolia.com/rooms/changed',answer:''})[key]},async deferReply(){this.deferred=true;},async editReply(value){this.result=value;},async reply(value){this.result=value;this.replied=true;}};
    const before=await readFile(store.path,'utf8'),gate=new Promise(resolve=>release=resolve),queued=new Promise(resolve=>entered=resolve),update=store.update.bind(store);
    store.tail=gate;store.update=(...args)=>{entered();return update(...args);};
    const pending=controller.handle(i);await queued;
    if(change==='revoked')allowed=false;
    if(change==='expired')s.expires=0;
    if(change==='replaced')controller.sessions.create('actor');
    release();await pending;
    if(change==='allowed'){assert.notEqual(await readFile(store.path,'utf8'),before);if(flow==='panel-place')assert.equal(posts,1);}
    else{assert.equal(await readFile(store.path,'utf8'),before);assert.equal(posts,0);assert.equal(s.busy,false);const rendered=JSON.stringify(i.result);assert.ok(!rendered.includes('PRIVATE BACKUP'));assert.ok(!rendered.includes('PRIVATE PC'));}
    await update(d=>{d.scenarios.push({id:'after',name:'after',url:'https://ccfolia.com/rooms/after'});});assert.ok(store.metadata().scenarios.some(x=>x.id==='after'));
  }finally{release?.();await rm(dir,{recursive:true,force:true});}
}
for(const flow of flows)test(`${flow} rechecks queued access, expiry and session and still permits an authorized save`,{timeout:10000},async()=>{for(const change of ['revoked','expired','replaced','allowed'])await queuedChange(flow,change);});

for(const operation of ['reserve','complete','clear','adopt','complete-delete-failed'])test(`repair ${operation} validates queued permission and preserves uncertain outcomes`,{timeout:5000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'astral-repair-access-'));let release,entered,allowed=true,sends=0,deletes=0,writes=0;
  try{
    const store=await new TrpgStore(join(dir,'trpg.json')).load(),id=await store.addPanel('channel','secret');
    await store.update(d=>{d.panels[0].messageId='old';if(['clear','adopt'].includes(operation))d.panels[0].repairPending={id:'attempt',channelId:'channel',startedAt:0};});
    const before=await readFile(store.path,'utf8'),stage={id,channelId:'channel',revision:JSON.stringify(store.metadata().panels[0])};
    const guild={members:{me:{id:'bot'},fetchMe:async()=>({id:'bot'})},channels:{fetch:async()=>({type:0,permissionsFor:()=>({has:()=>true}),messages:{fetch:async()=>{if(operation==='adopt')return {author:{id:'bot'},...trpgPanel(store.metadata().panels[0])};throw Object.assign(new Error('missing'),{code:10008});}},send:async()=>{sends++;return {id:'123456789012345678',delete:async()=>{deletes++;if(operation.endsWith('failed'))throw new Error('unknown deletion');}};}})}};
    const check=async()=>{if(!allowed)throw new Error('permission revoked');},repair=createTrpgRepair({store,guild,render:trpgPanel}),gate=new Promise(resolve=>release=resolve),queued=new Promise(resolve=>entered=resolve),update=store.update.bind(store),target=operation.startsWith('complete')?2:1;
    store.update=(...args)=>{if(++writes===target){store.tail=gate;entered();}return update(...args);};
    const pending=operation==='clear'?repair.clearPending(stage,check):operation==='adopt'?repair.adopt(stage,'123456789012345678',check):repair.repair(stage,check);
    const rejected=assert.rejects(pending);await queued;allowed=false;release();await rejected;
    if(operation.endsWith('failed')){assert.ok(store.metadata().panels[0].repairPending);assert.ok((await new TrpgStore(store.path).load()).metadata().panels[0].repairPending);await assert.rejects(repair.repair({...stage,revision:JSON.stringify(store.metadata().panels[0])},async()=>{}));assert.equal(sends,1);}
    else assert.equal(await readFile(store.path,'utf8'),before);
    assert.equal(sends,operation.startsWith('complete')?1:0);assert.equal(deletes,operation.startsWith('complete')?1:0);
  }finally{release?.();await rm(dir,{recursive:true,force:true});}
});

test('revoked management sessions cannot read a selected panel from another channel',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'astral-trpg-read-access-'));
  try{
    const store=await new TrpgStore(join(dir,'trpg.json')).load(),panel=await store.addPanel('private-channel','shared'),character=await store.saveCharacter(panel,'other','https://iachara.com/view/1',{name:'PRIVATE NAME',txt:'PRIVATE TXT'});
    const controller=createTrpgController({store,access:async()=>false,guild:{channels:{cache:new Map()}}}),s=controller.sessions.create('actor');
    Object.assign(s,{entry:'admin',originChannelId:'admin-channel',panelId:panel,characterId:character,view:'characters'});
    for(const action of ['characters','download','form-register']){
      const i={customId:`trpg:${s.id}:${action}`,user:{id:'actor'},channelId:'admin-channel',message:{flags:{has:()=>false}},async deferReply(){this.deferred=true;},async editReply(value){this.result=value;},async reply(value){this.result=value;}};
      await controller.handle(i);assert.ok(!JSON.stringify(i.result).match(/PRIVATE NAME|PRIVATE TXT/));assert.ok(!i.result.files);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('permission loss during persistence hides a completed private change without undoing it',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'astral-trpg-result-access-'));let allowed=true;
  try{
    const store=await new TrpgStore(join(dir,'trpg.json')).load(),table=await store.saveTable(null,'PRIVATE TABLE','');
    const controller=createTrpgController({store,access:async()=>allowed,guild:{channels:{cache:new Map()}}}),s=controller.sessions.create('actor');Object.assign(s,{entry:'admin',originChannelId:'channel',view:'table',tableId:table,tableStateRevision:JSON.stringify(store.table(table))});
    const update=store.update.bind(store);store.update=async(...args)=>{const result=await update(...args);allowed=false;return result;};
    const i={customId:`trpg:${s.id}:pin-table`,user:{id:'actor'},channelId:'channel',message:{flags:{has:()=>false}},async deferReply(){this.deferred=true;},async editReply(value){this.result=value;},async reply(value){this.result=value;}};
    await controller.handle(i);assert.equal(store.table(table).pinned,true);assert.ok(!JSON.stringify(i.result).includes('PRIVATE TABLE'));assert.ok(!i.result.files);
  }finally{await rm(dir,{recursive:true,force:true});}
});
