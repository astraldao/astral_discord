import {randomUUID} from 'node:crypto';
export function createUpdateClient({channel=process,supported=process.env.ASTRAL_UPDATER_PROTOCOL==='2',version='',timeout=35000}={}){
  const pending=new Map();
  const unavailable={supported:false,current:{version,sha:null},latest:null,phase:'unavailable'};
  const receive=m=>{if(m?.type!=='update-rpc-result')return;const job=pending.get(m.id);if(!job)return;pending.delete(m.id);clearTimeout(job.timer);m.error?job.reject(new Error(m.error)):job.resolve(m.data);};
  const disconnect=()=>{for(const job of pending.values()){clearTimeout(job.timer);job.reject(new Error('更新プロセスとの接続が切れました。'));}pending.clear();};
  channel.on('message',receive);channel.on('disconnect',disconnect);
  return {request(action,sha){
    if(!supported||!channel.connected)return action==='status'?Promise.resolve(unavailable):Promise.reject(new Error('更新用の起動環境を一度再導入してください。'));
    return new Promise((resolve,reject)=>{const id=randomUUID();const timer=setTimeout(()=>{pending.delete(id);reject(new Error('更新プロセスの応答がありません。'));},timeout);pending.set(id,{resolve,reject,timer});channel.send({type:'update-rpc',id,action,sha},error=>{if(error){clearTimeout(timer);pending.delete(id);reject(new Error('更新プロセスに接続できません。'));}});});
  },close(){channel.off('message',receive);channel.off('disconnect',disconnect);disconnect();}};
}
