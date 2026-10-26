import {memberFixtures} from './member-fixtures.js';
import {scheduleScreen} from '../src/schedule-ui.js';
import {densukeScreen} from '../src/densuke-ui.js';
import {tableScreen} from '../src/tables-ui.js';
import {createTrpgController} from '../src/trpg-ui.js';
import {fourScreen} from '../src/four-ui.js';
import {profileScreen} from '../src/profile-ui.js';
import {workshopScreen} from '../src/image-workshop-ui.js';
import {themed} from '../src/ui.js';
export async function memberPreviewPayloads(){
  const f=memberFixtures(),plain=(m,image=false)=>({embeds:m.embeds.map(e=>e.toJSON()),components:m.components.map(r=>r.toJSON()),...(image&&Buffer.isBuffer(m.files?.[0]?.attachment)?{previewImage:`data:image/png;base64,${m.files[0].attachment.toString('base64')}`}:{})});
  async function trpg(view){const c=createTrpgController({store:f.trpg,guild:{channels:{cache:new Map()}},access:async()=>true}),s=c.sessions.create(f.owner);Object.assign(s,{entry:'admin',isAdmin:true,view,panelId:f.panel,originChannelId:f.channel});const i={customId:`trpg:${s.id}:${view}`,user:{id:f.owner},channelId:f.channel,message:{flags:{has:()=>true}},isChatInputCommand:()=>false,async deferUpdate(){},async editReply(p){this.result=p;},async reply(p){this.result=p;}};await c.handle(i);return plain(i.result);}
  const t=tableScreen({id:'preview',view:'table',tableId:'table1',page:0},f.trpg.metadata()),table=themed('trpg').payload(t.title,t.body,{components:t.components});if(t.fields?.length)table.embeds[0].addFields(...t.fields);
  return {calendar:plain(scheduleScreen(f.schedule,{calendar:()=>structuredClone(f.calendar)})),densuke:plain(densukeScreen(f.densuke)),trpg:await trpg('home'),table:plain(table),characters:await trpg('characters'),four:plain(fourScreen(f.four),true),workshop:plain(workshopScreen(f.workshop)),profile:plain(profileScreen({id:'preview',view:'home',name:'あすとらる',words:[]},'あすとらる'))};
}
