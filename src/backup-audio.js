import {Readable} from 'node:stream';
import {joinVoiceChannel,entersState,VoiceConnectionStatus,createAudioPlayer,createAudioResource,AudioPlayerStatus,StreamType,NoSubscriberBehavior} from '@discordjs/voice';
export async function connectBackupAudio(channel,signal){
  const connection=joinVoiceChannel({channelId:channel.id,guildId:channel.guild.id,adapterCreator:channel.guild.voiceAdapterCreator,selfDeaf:true,selfMute:false});
  const player=createAudioPlayer({behaviors:{noSubscriber:NoSubscriberBehavior.Stop}});let fault,closed=false;
  player.on('error',e=>{fault=e;});connection.on('error',e=>{fault=e;});
  const close=()=>{if(closed)return;closed=true;player.stop();connection.destroy();};signal.addEventListener('abort',close,{once:true});
  try{await entersState(connection,VoiceConnectionStatus.Ready,AbortSignal.any([signal,AbortSignal.timeout(15000)]));connection.subscribe(player);}
  catch(error){signal.removeEventListener('abort',close);close();throw error;}
  return {healthy:()=>!closed&&!fault&&connection.state.status===VoiceConnectionStatus.Ready&&!channel.guild.members.me.voice.serverMute,
    async play(pcm,{signal,onStart}){
      signal.throwIfAborted();if(fault)throw fault;
      player.play(createAudioResource(Readable.from([pcm]),{inputType:StreamType.Raw}));
      await entersState(player,AudioPlayerStatus.Playing,AbortSignal.any([signal,AbortSignal.timeout(3000)]));onStart?.();
      await entersState(player,AudioPlayerStatus.Idle,AbortSignal.any([signal,AbortSignal.timeout(25000)]));if(fault)throw fault;
    },close(){signal.removeEventListener('abort',close);close();}};
}
