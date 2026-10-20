import test from 'node:test';
import assert from 'node:assert/strict';
import {ChannelType} from 'discord.js';
import {ScheduleError,scheduleErrorMessage} from '../src/schedule-errors.js';
import {ScheduleStore,scheduleDate,scheduleTime,planScheduleImport} from '../src/schedule-store.js';
import {parseScheduleImport,readScheduleAttachment} from '../src/schedule-import.js';
import {scheduleRecurrence} from '../src/schedule-recurrence.js';
import {scheduleImportScreen} from '../src/schedule-import-ui.js';
import {createScheduleController} from '../src/schedule-ui.js';

const GUILD='123456789012345678',CHANNEL='234567890123456789',BOT='456789012345678901';
const secret='PRIVATE_NATIVE_DETAIL /srv/bot/config.json https://private.example/value';
const fallback=scheduleErrorMessage(new Error(secret));
function interaction(customId){return {customId,user:{id:'owner'},channelId:CHANNEL,message:{flags:{has:()=>true}},replies:[],async deferReply(){this.deferred=true;},async deferUpdate(){this.deferred=true;},async editReply(message){this.replies.push(message);},async reply(message){this.replied=true;this.replies.push(message);},async showModal(modal){this.modal=modal;}};}
const click=(s,action)=>interaction(`schedule:${s.id}:${s.turn}:${action}`);
const text=i=>JSON.stringify(i.replies);
function hidden(i){assert.ok(!text(i).includes('/srv/bot/config.json'));assert.ok(!text(i).includes('private.example'));assert.ok(text(i).includes(fallback));}
async function fixture(options={}){
  const store=new ScheduleStore(),id=await store.create('共有予定表');let sends=0;
  const channel={id:CHANNEL,guildId:GUILD,type:ChannelType.GuildText,permissionsFor:()=>({has:()=>true}),send:async()=>{sends++;throw new Error(secret);}};
  const guild={id:GUILD,members:{me:{id:BOT},fetchMe:async()=>({id:BOT})},channels:{fetch:async()=>channel}};
  const controller=createScheduleController({store,guild,access:async()=>{},...options});
  await controller.openAdmin(interaction());const s=[...controller.sessions.sessions.values()][0];
  await controller.handle(Object.assign(click(s,'calendar'),{values:[id]}));
  return {store,id,controller,s,sends:()=>sends};
}

test('calendar messages trust only the local error class, never an error name, code or tag',()=>{
  assert.equal(scheduleErrorMessage(new ScheduleError('日付を確認してください。')),'日付を確認してください。');
  for(const error of [new Error(secret),new TypeError(secret),{name:'ScheduleError',message:secret,schedule:true,sharedSchedule:true},Object.assign(new Error(secret),{name:'ScheduleError',code:'SCHEDULE_ERROR'}),undefined,null,secret])assert.equal(scheduleErrorMessage(error),fallback);
  const unknown={get message(){assert.fail('unknown error message was read');}};
  assert.equal(scheduleErrorMessage(unknown),fallback);
});

test('calendar domain validation retains useful fixed Japanese errors',async()=>{
  for(const operation of [()=>scheduleDate('2026/02/30'),()=>scheduleTime('24:00'),()=>planScheduleImport({events:[]},[]),()=>parseScheduleImport(Buffer.from('invalid')),()=>scheduleRecurrence(null,{frequency:'weekly',count:1}),()=>scheduleImportScreen({}, {})]){
    assert.throws(operation,error=>error instanceof ScheduleError&&scheduleErrorMessage(error)!==fallback&&/[\u3040-\u9fff]/u.test(error.message));
  }
  await assert.rejects(readScheduleAttachment(null),error=>error instanceof ScheduleError&&scheduleErrorMessage(error)!==fallback);
});

test('initial permission lookup failures never reveal native request or path details',async()=>{
  const guild={id:GUILD,members:{fetch:async()=>{throw new Error(secret);}},channels:{fetch:async()=>null}};
  const i=interaction();await createScheduleController({guild,store:new ScheduleStore()}).openAdmin(i);hidden(i);
});

test('a recoverable session failure hides native details while keeping a usable calendar',async()=>{
  let fail=false;
  const f=await fixture({access:async()=>{if(fail){fail=false;throw new Error(secret);}}});
  fail=true;const i=click(f.s,'list');await f.controller.handle(i);hidden(i);
  assert.ok(i.replies.at(-1).components.length);assert.equal(f.s.view,'list');
});

test('an injected attachment-reader failure is hidden and never creates an import stage',async()=>{
  const f=await fixture({readImport:async()=>{throw new Error(secret);}});
  await f.controller.handle(click(f.s,'tools'));const upload=click(f.s,'import');await f.controller.handle(upload);assert.ok(upload.modal);
  const i=interaction(upload.modal.toJSON().custom_id);i.fields={getUploadedFiles:()=>({size:1,first:()=>({id:'unused'})})};
  await f.controller.handle(i);hidden(i);assert.equal(f.s.importStage,undefined);assert.equal(f.store.calendar(f.id).events.length,0);
});

test('a native send failure stays reserved and reveals no native details',async()=>{
  const f=await fixture();await f.controller.handle(click(f.s,'publish'));
  await f.controller.handle(Object.assign(click(f.s,'channel'),{values:[CHANNEL]}));
  const i=click(f.s,'send');await f.controller.handle(i);hidden(i);
  assert.equal(f.sends(),1);assert.equal(f.store.calendar(f.id).publications[0].status,'pending');
  await f.controller.handle(click(f.s,'send'));assert.equal(f.sends(),1);
});
