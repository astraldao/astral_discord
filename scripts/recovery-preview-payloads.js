import {recoveryFixtures} from './recovery-fixtures.js';
import {benchmarkScreen} from '../src/voice-benchmark-ui.js';
import {mainMenuGuideScreen} from '../src/main-menu.js';
import {createChipTools} from '../src/chip-tools.js';
import {GameWalletStore} from '../src/game-wallets.js';
export async function recoveryPreviewPayloads(){
  const f=recoveryFixtures(),plain=m=>({embeds:m.embeds.map(e=>e.toJSON()),components:m.components.map(r=>r.toJSON())}),capabilities={diceEnabled:true,diceFullContent:true};
  const wallet=new GameWalletStore(),owner='111111111111111111',target='222222222222222222';wallet.accounts.set(owner,{balance:3000,pending:null});
  const tools=createChipTools({wallet,access:async()=>{},recipient:async()=>{}}),event=(id,values)=>({customId:id,values,user:{id:owner},channelId:'channel',message:{flags:{has:()=>true}},async deferReply(){this.deferred=true;},async deferUpdate(){this.deferred=true;},async reply(p){this.result=p;},async editReply(p){this.result=p;},async showModal(m){this.modal=m;}});
  await tools.openTransfer(event('open'));const s=[...tools.transfers.sessions.values()][0],click=(a,values)=>event(`chips:${s.id}:${s.turn}:${a}`,values);await tools.handle(click('target',[target]));const first=click('amount');await tools.handle(first);const invalid=event(first.modal.toJSON().custom_id);invalid.fields={getTextInputValue:()=> '4000'};await tools.handle(invalid);const correction=click('amount');await tools.handle(correction);
  return {help:plain(mainMenuGuideScreen('dice',capabilities)),benchmark:plain(benchmarkScreen(f.session,f.state)),transfer:{...plain(invalid.result),form:{label:correction.modal.toJSON().components[0].components[0].label,value:correction.modal.toJSON().components[0].components[0].value??''}},timings:plain(benchmarkScreen({...f.session,resultView:'timings'},f.state)),capacity:plain(benchmarkScreen({...f.session,resultView:'capacity'},f.state)),helpAdvanced:plain(mainMenuGuideScreen('dice',capabilities,'advanced')),helpBefore:plain(mainMenuGuideScreen('dice',capabilities,'before')),helpTrouble:plain(mainMenuGuideScreen('dice',capabilities,'trouble'))};
}
