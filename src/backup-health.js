import {VoiceConnectionStatus as Status} from '@discordjs/voice';

// A short reconnect may recover; a persistent disconnect must not leave a silent reader active.
export function watchBackupAudio({connection,player,signal,onFault=()=>{},disconnectMs=5000,schedule=setTimeout,cancel=clearTimeout}){
  let fault=null,armed=false,closed=false,timer=null;
  const clear=()=>{if(timer!==null)cancel(timer);timer=null;};
  function report(error){
    if(closed||signal.aborted||fault)return;fault=error;clear();
    if(armed)Promise.resolve().then(()=>{if(!closed&&!signal.aborted)return onFault(error);}).catch(()=>{});
  }
  const error=()=>report(new Error('音声接続または再生処理が停止しました。'));
  function changed(_before,after){
    if(closed||!armed)return;
    if(after.status===Status.Ready){clear();return;}
    if(after.status===Status.Destroyed){report(new Error('音声接続が終了しました。'));return;}
    if(after.status===Status.Disconnected&&timer===null){timer=schedule(()=>{timer=null;if(connection.state.status!==Status.Ready)report(new Error('音声接続が復旧しませんでした。'));},disconnectMs);timer?.unref?.();}
  }
  function close(){if(closed)return;closed=true;clear();connection.off('stateChange',changed);connection.off('error',error);player.off('error',error);connection.on('error',()=>{});player.on('error',()=>{});signal.removeEventListener('abort',close);}
  connection.on('stateChange',changed);connection.on('error',error);player.on('error',error);signal.addEventListener('abort',close,{once:true});
  return {fault:()=>fault,arm(){if(signal.aborted||closed)throw new Error('音声接続は停止しています。');if(fault)throw fault;armed=true;},close};
}
