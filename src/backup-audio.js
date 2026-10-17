import {Readable} from 'node:stream';
import {createSpeechEncoder} from './opus-encoder.js';
import {joinVoiceChannel,entersState,VoiceConnectionStatus,createAudioPlayer,createAudioResource,AudioPlayerStatus,StreamType,NoSubscriberBehavior} from '@discordjs/voice';
import {watchBackupAudio} from './backup-health.js';
import {backupFault} from './backup-fault.js';
// The worker allows 15 seconds without a new WAV. Do not cut playback off before it.
export const backupPlayerBehaviors={noSubscriber:NoSubscriberBehavior.Pause,maxMissedFrames:1000};
export async function waitBackupReady(connection,signal){
  signal.throwIfAborted();if(connection.state.status===VoiceConnectionStatus.Ready)return false;
  try{await entersState(connection,VoiceConnectionStatus.Ready,AbortSignal.any([signal,AbortSignal.timeout(5000)]));return true;}
  catch(error){throw backupFault(error,'CONNECTION');}
}
export async function playBackupAudio(player,pcm,{signal,onStart},fault=()=>null,encoder){
  signal.throwIfAborted();if(fault())throw fault();
  const source=Buffer.isBuffer(pcm)?Readable.from([pcm]):pcm;
  const codec=encoder??createSpeechEncoder({signal});let resource;
  try{await codec.ready;signal.throwIfAborted();resource=createAudioResource(codec.stream(source,signal),{inputType:StreamType.Opus});}
  catch(error){if(!encoder)codec.close();throw error;}
  // A stalled generator must fail rather than silently discard the rest of a message.
  const stop=()=>player.stop(true);signal.addEventListener('abort',stop,{once:true});
  try{
    player.play(resource);
    await entersState(player,AudioPlayerStatus.Playing,AbortSignal.any([signal,AbortSignal.timeout(3000)]));onStart?.();
    await entersState(player,AudioPlayerStatus.Idle,AbortSignal.any([signal,AbortSignal.timeout(60000)]));
    if(fault())throw fault();signal.throwIfAborted();
    if(!resource.playStream.readableEnded)throw new Error('音声データの到着が途切れました。');
  }finally{signal.removeEventListener('abort',stop);player.stop(true);resource.playStream.destroy();if(!encoder)codec.close();}
}
export async function connectBackupAudio(channel,signal,{onFault}={}){
  signal.throwIfAborted();
  const connection=joinVoiceChannel({channelId:channel.id,guildId:channel.guild.id,adapterCreator:channel.guild.voiceAdapterCreator,selfDeaf:true,selfMute:false});
  const player=createAudioPlayer({behaviors:backupPlayerBehaviors});let closed=false,encoder;
  const health=watchBackupAudio({connection,player,signal,onFault});
  const close=()=>{if(closed)return;closed=true;health.close();player.stop(true);encoder?.close();if(connection.state.status!==VoiceConnectionStatus.Destroyed)connection.destroy();};signal.addEventListener('abort',close,{once:true});
  try{encoder=createSpeechEncoder({signal});await Promise.all([entersState(connection,VoiceConnectionStatus.Ready,AbortSignal.any([signal,AbortSignal.timeout(15000)])),encoder.ready]);connection.subscribe(player);health.arm();}
  catch(error){signal.removeEventListener('abort',close);close();throw error;}
  return {waitReady:s=>waitBackupReady(connection,s),healthy:()=>!closed&&!health.fault()&&connection.state.status===VoiceConnectionStatus.Ready&&!channel.guild.members.me.voice.serverMute,
    play:(pcm,options)=>playBackupAudio(player,pcm,options,health.fault,encoder),close(){signal.removeEventListener('abort',close);close();}};
}
