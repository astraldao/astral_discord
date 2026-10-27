import {createRpsController} from '../src/rps-ui.js';
import {createChipAccountController,chipAccountScreen} from '../src/chip-account-ui.js';
import {GameWalletStore} from '../src/game-wallets.js';
// Real controllers, fictional actors and in-memory ledger only; no Discord or filesystem writes.
export async function gameRecoveryPayloads(){
  const owner='111111111111111111',target='222222222222222222',event=(customId,values)=>({customId,values,user:{id:owner},channelId:'channel',message:{flags:{has:()=>true}},async deferUpdate(){this.deferred=true;},async deferReply(){this.deferred=true;},async reply(p){this.result=p;},async editReply(p){this.result=p;},async showModal(m){this.modal=m;}}),plain=m=>({embeds:m.embeds.map(e=>e.toJSON()),components:m.components.map(r=>r.toJSON())});
  const unexpected=event('open');await createRpsController({access:async()=>{throw new Error('架空エラー: EXAMPLE_INTERNAL_PATH /example/private/file');}}).open(unexpected);
  const wallet=new GameWalletStore(null,{now:()=>1793000000000}),c=createChipAccountController({wallet,access:async()=>{},member:async()=>{}});await c.openAdmin(event('open'));let s=[...c.sessions.sessions.values()][0];const click=(action,values)=>event(`wallet:${s.id}:${s.turn}:${action}`,values);await c.handle(click('target',[target]));const form=click('mode',['add']);await c.handle(form);const invalid=event(form.modal.toJSON().custom_id);invalid.fields={getTextInputValue:k=>k==='amount'?'-1':'イベントのお礼'};await c.handle(invalid);
  const correction=plain(invalid.result),recover=invalid.result.components.flatMap(r=>r.toJSON().components).find(x=>x.custom_id?.includes(':recover:'));
  if(recover)await c.handle(event(recover.custom_id));else{await c.openAdmin(event('open'));s=[...c.sessions.sessions.values()][0];await c.handle(click('target',[target]));}
  const retry=click('mode',['add']);await c.handle(retry);correction.form=retry.modal.toJSON().components.map(r=>r.components[0]).map(f=>({label:f.label,value:f.value??''}));
  const valid=event(retry.modal.toJSON().custom_id);valid.fields={getTextInputValue:k=>k==='amount'?'100':'イベントのお礼'};await c.handle(valid);await wallet.transfer(owner,target,20,'fictional-gift');
  return {unexpected:plain(unexpected.result),correction,stale:plain(chipAccountScreen(s,wallet))};
}
