// A prepare request freezes intake synchronously: no new operation can race the drain.
export function updateBusy({active=0,pending=0,accounts=[],sessions=[],now=Date.now()}={}){
  if(active || pending)return true;
  if([...accounts].some(a=>a.pending?.expires>now || a.work?.ticket?.expires>now))return true;
  return sessions.some(pool=>[...(pool?.sessions?.values()??[])].some(s=>s.expires>now && (s.busy || s.game?.phase==='playing' || ['watch','playing','claim'].includes(s.view))));
}
export function createUpdateLifecycle({busy,freeze,drain,send,exit,snapshot=()=>undefined,accept=()=>true}){
  let frozen=false;
  return async message=>{
    if(message?.type!=='prepare-update' || typeof message.id!=='string')return;
    if(frozen || busy() || !accept(message)){send({type:'update-busy',id:message.id});return;}
    frozen=true;freeze();
    try{const runtime=snapshot();await drain();send({type:'update-stopped',id:message.id,...(runtime?{runtime}:{})},()=>exit(0));}
    catch{send({type:'update-error',id:message.id});exit(1);}
  };
}
