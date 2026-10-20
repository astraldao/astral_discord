import {randomUUID} from 'node:crypto';
import {ChannelType,PermissionFlagsBits as P} from 'discord.js';

export async function trpgPanelTarget(guild,id){
  const channel=await guild.channels.fetch(id,{force:true}),bot=await guild.members.fetchMe({force:true});
  if(channel?.type!==ChannelType.GuildText || !channel.permissionsFor(bot)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks,P.ReadMessageHistory]))throw new Error('設置先とBotの閲覧・送信・埋め込み・履歴権限を確認してください。');return channel;
}

export function createTrpgRepair({store,guild,render}){
  let tail=Promise.resolve();
  const panel=id=>{const p=store.metadata().panels.find(x=>x.id===id);if(!p)throw new Error('パネルが見つかりません。');return p;};
  const serialize=fn=>{const run=tail.then(fn);tail=run.catch(()=>{});return run;};
  const target=id=>trpgPanelTarget(guild,id);
  const checkStage=stage=>{const p=panel(stage.id);if(JSON.stringify(p)!==stage.revision)throw new Error('パネル情報が変わりました。選び直してください。');return p;};
  return {
    repair(stage,check){return serialize(async()=>{
      await check();const p=checkStage(stage);if(p.repairPending)throw new Error('前回の投稿結果が未確認です。設置先でBotのメッセージを確認し、そのIDを登録してください。');
      const channel=await target(stage.channelId);let existing;
      if(p.messageId){try{const original=await guild.channels.fetch(p.channelId,{force:true});if(original)existing=await original.messages.fetch(p.messageId);}catch(e){if(![10003,10008].includes(e.code))throw e;}}
      await check();checkStage(stage);
      if(existing){if(stage.channelId!==p.channelId)throw new Error('元のパネルは残っています。元の設置先で更新してください。');await existing.edit(render(p));return 'updated';}
      const attempt={id:randomUUID(),channelId:stage.channelId,startedAt:Date.now()};
      await store.update(d=>{const current=d.panels.find(x=>x.id===p.id);if(JSON.stringify(current)!==stage.revision)throw new Error('パネル情報が変わりました。選び直してください。');current.repairPending=attempt;},check);
      let message,sending=false;
      try{
        await check();sending=true;message=await channel.send(render(p));await check();
        await store.update(d=>{const current=d.panels.find(x=>x.id===p.id);if(current?.repairPending?.id!==attempt.id || current.mode!==p.mode)throw new Error('パネル情報が変わりました。');current.channelId=stage.channelId;current.messageId=message.id;delete current.repairPending;},check);
        return 'created';
      }catch(e){
        let clear=!sending;
        if(message){try{await message.delete();clear=true;}catch{}}
        else if([10003,50001,50013,50035].includes(e.code))clear=true;
        // Unknown send outcomes remain persisted; reopening or restart must not resend.
        if(clear)await store.update(d=>{const current=d.panels.find(x=>x.id===p.id);if(current?.repairPending?.id===attempt.id)delete current.repairPending;});
        if(panel(p.id).repairPending)throw new Error('投稿結果を確認できません。自動再送はしません。設置先のBotメッセージIDを「復旧結果を登録」から登録してください。');
        throw e;
      }
    });},
    clearPending(stage,check){return serialize(async()=>{
      await check();const p=checkStage(stage);if(!p.repairPending || Date.now()-p.repairPending.startedAt<60000)throw new Error('送信結果を確認するため、1分以上待ってから操作してください。');
      await check();await store.update(d=>{const current=d.panels.find(x=>x.id===p.id);if(JSON.stringify(current)!==stage.revision)throw new Error('パネル情報が変わりました。選び直してください。');delete current.repairPending;},check);
    });},
    adopt(stage,messageId,check){return serialize(async()=>{
      if(!/^\d{17,20}$/.test(messageId))throw new Error('DiscordメッセージのIDを入力してください。');
      await check();const p=checkStage(stage),pending=p.repairPending;if(!pending)throw new Error('未確認の復旧処理はありません。');
      const channel=await target(pending.channelId),message=await channel.messages.fetch(messageId),expected=render(p);
      const controls=m=>(m.components??[]).flatMap(r=>(typeof r.toJSON==='function'?r.toJSON():r).components??[]).map(c=>c.custom_id??c.customId);
      const description=m=>(typeof m.embeds?.[0]?.toJSON==='function'?m.embeds[0].toJSON():m.embeds?.[0])?.description;
      if(message.author?.id!==guild.members.me.id || JSON.stringify(controls(message))!==JSON.stringify(controls(expected)) || description(message)!==description(expected))throw new Error('指定されたメッセージは、この公開範囲のBotパネルと一致しません。');
      await check();await store.update(d=>{const current=d.panels.find(x=>x.id===p.id);if(JSON.stringify(current)!==stage.revision)throw new Error('パネル情報が変わりました。選び直してください。');current.channelId=pending.channelId;current.messageId=messageId;delete current.repairPending;},check);
      return 'adopted';
    });}
  };
}
