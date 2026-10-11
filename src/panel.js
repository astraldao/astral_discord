import {ChannelType} from 'discord.js';
import {panel} from './ui.js';

export function createPanelRefresher({settings,guild}) {
  let tail=Promise.resolve();
  async function refresh(create) {
    const c=settings.get();
    if(!c.lobbyId)throw new Error('先に /admin の「VC設定」でロビーを設定してください。');
    const lobby=await guild.channels.fetch(c.lobbyId);
    if(!lobby || lobby.type!==ChannelType.GuildVoice)throw new Error('ロビーVCが見つかりません。再設定してください。');
    if(c.panel?.channelId===c.lobbyId) {
      try {
        const message=await lobby.messages.fetch(c.panel.messageId);
        await message.edit(panel(c));return;
      } catch(error) {if(error.code!==10008)throw error;}
    }
    if(!create)return;
    const message=await lobby.send(panel(c));
    try {
      await settings.update(next=>{
        if(next.lobbyId!==c.lobbyId)throw new Error('設置中にロビーが変更されました。設置をやり直してください。');
        next.panel={channelId:c.lobbyId,messageId:message.id};
      });
    } catch(error) {
      try {await message.delete();}catch{}
      throw error;
    }
  }
  return (create=false)=>{
    const run=tail.then(()=>refresh(create));
    tail=run.catch(()=>{});return run;
  };
}
