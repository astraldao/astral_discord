import {Readable} from 'node:stream';
import {joinVoiceChannel,entersState,VoiceConnectionStatus,createAudioPlayer,createAudioResource,AudioPlayerStatus,StreamType,NoSubscriberBehavior} from '@discordjs/voice';
export async function playBackupAudio(player,pcm,{signal,onStart},fault=()=>null){
  signal.throwIfAborted();if(fault())throw fault();
  const source=Buffer.isBuffer(pcm)?Readable.from([pcm]):pcm;
  const resource=createAudioResource(source,{inputType:StreamType.Raw});
  // A stalled generator must fail rather than silently discard the rest of a message.
  const stop=()=>player.stop(true);signal.addEventListener('abort',stop,{once:true});
  try{
    player.play(resource);
    await entersState(player,AudioPlayerStatus.Playing,AbortSignal.any([signal,AbortSignal.timeout(3000)]));onStart?.();
    await entersState(player,AudioPlayerStatus.Idle,AbortSignal.any([signal,AbortSignal.timeout(60000)]));
    if(fault())throw fault();signal.throwIfAborted();
    if(!resource.playStream.readableEnded)throw new Error('音声データの到着が途切れました。');
  }finally{signal.removeEventListener('abort',stop);player.stop(true);resource.playStream.destroy();}
}
export async function connectBackupAudio(channel,signal){
  const connection=joinVoiceChannel({channelId:channel.id,guildId:channel.guild.id,adapterCreator:channel.guild.voiceAdapterCreator,selfDeaf:true,selfMute:false});
  const player=createAudioPlayer({behaviors:{noSubscriber:NoSubscriberBehavior.Stop,maxMissedFrames:150}});let fault,closed=false;
  player.on('error',e=>{fault=e;});connection.on('error',e=>{fault=e;});
  const close=()=>{if(closed)return;closed=true;player.stop();connection.destroy();};signal.addEventListener('abort',close,{once:true});
  try{await entersState(connection,VoiceConnectionStatus.Ready,AbortSignal.any([signal,AbortSignal.timeout(15000)]));connection.subscribe(player);}
  catch(error){signal.removeEventListener('abort',close);close();throw error;}
  return {healthy:()=>!closed&&!fault&&connection.state.status===VoiceConnectionStatus.Ready&&!channel.guild.members.me.voice.serverMute,
    play:(pcm,options)=>playBackupAudio(player,pcm,options,()=>fault),close(){signal.removeEventListener('abort',close);close();}};
}
