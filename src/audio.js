import { Readable } from 'node:stream';
import {
  joinVoiceChannel, entersState, VoiceConnectionStatus, createAudioPlayer,
  createAudioResource, AudioPlayerStatus, StreamType, NoSubscriberBehavior,
} from '@discordjs/voice';

export async function connectSpeech(channel, pcm, signal) {
  const connection = joinVoiceChannel({
    channelId: channel.id, guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: true, selfMute: false,
  });
  const player = createAudioPlayer({behaviors: {noSubscriber: NoSubscriberBehavior.Stop}});
  let fault;
  player.on('error', error => { fault = error; });
  connection.on('error', error => { fault = error; });
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, signal ? AbortSignal.any([signal,AbortSignal.timeout(15000)]) : 15000);
    if (channel.guild.members.me.voice.serverMute) throw new Error('Botがサーバーミュートされています。');
    connection.subscribe(player);
    const abort=()=>player.stop();
    signal?.addEventListener('abort',abort,{once:true});
    return {
      async start() {
        signal?.throwIfAborted();
        if (fault) throw fault;
        player.play(createAudioResource(Readable.from([pcm]), {inputType: StreamType.Raw}));
        await entersState(player, AudioPlayerStatus.Playing, signal ? AbortSignal.any([signal,AbortSignal.timeout(3000)]) : 3000);
        await entersState(player, AudioPlayerStatus.Idle, signal ? AbortSignal.any([signal,AbortSignal.timeout(25000)]) : 25000);
        if(fault)throw fault;
      },
      healthy() { return !fault && connection.state.status === VoiceConnectionStatus.Ready; },
      close() { signal?.removeEventListener('abort',abort); player.stop(); connection.destroy(); },
    };
  } catch (error) {
    player.stop(); connection.destroy(); throw error;
  }
}
