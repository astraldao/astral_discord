// Limit decoded response bytes while streaming, before allocating the full text.
// Fetch enforces the same signal while headers and body are being received.
export async function boundedResponseText(response,{signal,maxBytes=65536}={}){
  const reject=()=>new Error('更新情報を安全に取得できませんでした。');
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>65536)throw reject();
  if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});throw reject();}
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>maxBytes)){
    await response.body.cancel().catch(()=>{});throw reject();
  }
  const reader=response.body.getReader(),chunks=[];let bytes=0;
  try{
    while(true){
      signal?.throwIfAborted();
      const {done,value}=await reader.read();signal?.throwIfAborted();if(done)break;
      if(!(value instanceof Uint8Array)||(bytes+=value.byteLength)>maxBytes)throw reject();
      chunks.push(Buffer.from(value));
    }
    return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  }catch{throw reject();}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
