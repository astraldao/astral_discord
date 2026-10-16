// At most one queued message is prepared. WAV data stays in memory until playback.
export function prepareBackupSpeech({text,signal,synth}){
  signal.throwIfAborted();
  let chunks=[],consumer,claimed=false,disposed=false,bytes=0,parts=0,failure,rejectCancelled;
  const cancelled=new Promise((_,reject)=>{rejectCancelled=reject;});
  const cancel=()=>{chunks=[];consumer=null;disposed=true;rejectCancelled(signal.reason??new Error('音声の準備を取り消しました。'));};
  signal.addEventListener('abort',cancel,{once:true});
  const generating=Promise.resolve().then(()=>{
    signal.throwIfAborted();if(disposed)throw new Error('音声の準備は終了しています。');
    return synth.stream(text,signal,wav=>{
      signal.throwIfAborted();if(disposed)throw new Error('音声の準備は終了しています。');
      if(!Buffer.isBuffer(wav)||!wav.length||++parts>256||(bytes+=wav.length)>8*1024*1024)throw new Error('先読み音声が大きすぎます。');
      if(consumer)consumer(wav);else chunks.push(wav);
    });
  });
  const done=Promise.race([generating,cancelled]).catch(error=>{failure=error;chunks=[];consumer=null;throw error;}).finally(()=>signal.removeEventListener('abort',cancel));
  done.catch(()=>{});
  return {done,get bufferedBytes(){return chunks.reduce((sum,wav)=>sum+wav.length,0);},
    async consume(onChunk){
      signal.throwIfAborted();if(failure)throw failure;if(claimed||disposed)throw new Error('音声の準備は終了しています。');claimed=true;
      consumer=onChunk;const ready=chunks;chunks=[];
      try{for(const wav of ready){signal.throwIfAborted();if(disposed)throw new Error('音声の準備は終了しています。');onChunk(wav);}ready.length=0;await done;}finally{ready.length=0;consumer=null;}
    },
    dispose(){if(disposed)return;chunks=[];consumer=null;disposed=true;rejectCancelled(new Error('音声の準備を破棄しました。'));},
  };
}
