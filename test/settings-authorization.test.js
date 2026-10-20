import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PermissionsBitField,PermissionFlagsBits as P} from 'discord.js';
import {SettingsStore} from '../src/settings.js';
import {createAdminController} from '../src/admin.js';
import {createDensukeController,densukeEmailModal} from '../src/densuke-ui.js';

async function queuedChange(flow,change){
  const dir=await mkdtemp(join(tmpdir(),'astral-settings-access-')),path=join(dir,'settings.json');
  let allowed=true,changed=0,release,entered;
  try{
    const settings=new SettingsStore(path,{version:1,lobbyId:null,targetIds:[],seconds:5,voice:true,enforce:true,densukeEmail:'owner@example.com'});
    await settings.update(()=>{});const previous=await readFile(path,'utf8');
    const guild={members:{fetch:async()=>({permissions:new PermissionsBitField(allowed?P.Administrator:0n)})},channels:{cache:new Map(),fetch:async()=>({permissionsFor:()=>({has:()=>true})})}};
    const controller=flow==='email'?createDensukeController({settings,guild}):createAdminController({settings,guild,access:async()=>allowed,changed:()=>changed++,refreshPanel:async()=>{},pendingCount:()=>0});
    const s=controller.sessions.create('owner');Object.assign(s,{channelId:'channel',originChannelId:'channel',phase:'review',event:{name:'PRIVATE EVENT',schedule:'PRIVATE DATE',description:'',password:'',choice:'1'},reviewEmail:'owner@example.com',emailEditBase:'owner@example.com'});
    if(flow==='confirm')s.stage={action:'volume',value:20,base:JSON.stringify(settings.get()),description:'音量の変更'};
    const gate=new Promise(resolve=>release=resolve),queued=new Promise(resolve=>entered=resolve),update=settings.update.bind(settings);
    settings.tail=gate;settings.update=(...args)=>{entered();return update(...args);};
    const customId=flow==='email'?densukeEmailModal(s,s.emailEditBase).toJSON().custom_id:`admin:${s.id}:${flow==='confirm'?'save':'submit-volume'}`;
    const i={customId,user:{id:'owner'},channelId:'channel',message:{},isChatInputCommand:()=>false,isModalSubmit:()=>flow!=='confirm',fields:{getTextInputValue:()=>flow==='email'?'new@example.com':'20'},async deferReply(){this.deferred=true;},async deferUpdate(){this.deferred=true;},async editReply(value){this.result=value;},async reply(value){this.result=value;this.replied=true;}};
    const pending=controller.handle(i);await queued;
    if(change==='revoked')allowed=false;
    if(change==='expired')s.expires=0;
    if(change==='replaced')controller.sessions.create('owner');
    if(change==='form-replaced')densukeEmailModal(s,s.emailEditBase);
    if(change==='base-replaced')s.emailEditBase='different@example.com';
    release();await pending;
    if(change==='allowed'){
      assert.equal(flow==='email'?settings.get().densukeEmail:settings.get().volume,flow==='email'?'new@example.com':20);
      assert.equal(JSON.parse(await readFile(path,'utf8'))[flow==='email'?'densukeEmail':'volume'],flow==='email'?'new@example.com':20);
      assert.equal(changed,flow==='email'?0:1);
    }else{
      assert.equal(await readFile(path,'utf8'),previous);assert.equal(settings.get().volume,30);assert.equal(settings.get().densukeEmail,'owner@example.com');assert.equal(changed,0);assert.equal(s.busy,false);
      if(flow==='email' && !['form-replaced','base-replaced'].includes(change))assert.ok(!JSON.stringify(i.result).includes('PRIVATE EVENT'));
    }
    // A denied save must not poison unrelated future saves or leave a temporary file.
    await update(c=>{c.seconds=7;});assert.equal(settings.get().seconds,7);assert.equal(JSON.parse(await readFile(path,'utf8')).seconds,7);
  }finally{release?.();await rm(dir,{recursive:true,force:true});}
}
for(const flow of ['confirm','immediate','email'])for(const change of ['revoked','expired','replaced'])test(`${flow} settings save refuses ${change} authority after queue wait`,{timeout:5000},()=>queuedChange(flow,change));
for(const change of ['form-replaced','base-replaced'])test(`email settings save refuses ${change} context after queue wait`,{timeout:5000},()=>queuedChange('email',change));
test('authorized queued settings changes persist and update UI effects once',{timeout:5000},async()=>{for(const flow of ['confirm','immediate','email'])await queuedChange(flow,'allowed');});
