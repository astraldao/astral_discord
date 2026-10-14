import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {githubHead,prepareRelease,readState,writeState,releasePath,snapshotData,restoreData,cleanup,intervalMs,runFile} from './auto-update.js';
export function launchWorker(root,source,{timeout=90000}={}){
  const child=spawn(process.execPath,[join(source,'index.js'),'--worker'],{cwd:root,shell:false,env:{...process.env,ASTRAL_DATA_ROOT:root,ASTRAL_SUPERVISED:'1'},stdio:['inherit','inherit','inherit','ipc']});
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  const ready=new Promise((accept,reject)=>{
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('新版の起動が時間内に完了しませんでした。'));},timeout);
    const message=m=>{if(m?.type==='worker-ready'){clearTimeout(timer);child.off('message',message);accept();}};
    child.on('message',message);child.once('error',()=>{clearTimeout(timer);reject(new Error('Botを起動できません。'));});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Botの起動に失敗しました。'));});
  });
  return {child,ready,exited};
}
export function requestStop(worker,{timeout=15000}={}){
  return new Promise((accept,reject)=>{
    const id=randomUUID(),child=worker.child;
    const timer=setTimeout(()=>finish(new Error('更新待機の応答がありません。')),timeout);
    const finish=(error,busy=false)=>{clearTimeout(timer);child.off('message',message);child.off('exit',exit);error?reject(error):accept(!busy);};
    const message=m=>{if(m?.id!==id)return;if(m.type==='update-busy')finish(null,true);else if(m.type==='update-stopped')finish();else if(m.type==='update-error')finish(new Error('データ保存に失敗しました。'));};
    const exit=()=>finish(new Error('更新待機中にBotが終了しました。'));
    child.on('message',message);child.once('exit',exit);
    if(!child.connected)finish(new Error('Botとの接続が切れています。'));
    else child.send({type:'prepare-update',id},error=>{if(error)finish(new Error('Botとの接続が切れています。'));});
  });
}
export async function switchRelease(root,state,release,{launch=launchWorker,save=writeState}={}){
  const sha=release.split('/').at(-1);let candidate;
  try{
    await snapshotData(root);
    // The journal makes startup migration rollback recoverable after a container interruption.
    await save(root,{...state,transition:sha});
    candidate=launch(root,release);await candidate.ready;
    const next={sha,release:sha,previous:state.release,failed:null};await save(root,next);
    candidate.child.send({type:'activate'},error=>{if(error)candidate.child.kill('SIGTERM');});
    return {state:next,worker:candidate};
  }catch{
    if(candidate){candidate.child.kill('SIGKILL');await candidate.exited;}
    if(candidate)await restoreData(root);const old={...state,failed:sha};delete old.transition;await save(root,old);
    console.warn(`自動更新: ${sha.slice(0,7)} の起動に失敗。保存データと前の版を戻しました。`);
    const worker=launch(root,releasePath(root,old));await worker.ready;worker.child.send({type:'activate'});
    return {state:old,worker};
  }
}
export async function recoverTransition(root,state){
  if(!state.transition)return state;
  await restoreData(root);const old={...state,failed:state.transition};delete old.transition;await writeState(root,old);return old;
}
export async function supervise(){
  const root=process.cwd();let state=await readState(root),worker,prepared=null,timer,checking=false,managed=false,stopping=false,exitStatus=0;
  const abort=new AbortController(),children=new Set();
  function launch(data,source){if(stopping)throw new Error('Botを停止しています。');const current=launchWorker(data,source);children.add(current);void current.exited.then(()=>children.delete(current));return current;}
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{
    stopping=true;clearInterval(timer);abort.abort();for(const current of children)current.child.kill(signal);
    const force=setTimeout(()=>{for(const current of children)current.child.kill('SIGKILL');process.exit(0);},15000);force.unref();
    void Promise.all([...children].map(current=>current.exited)).then(()=>{clearTimeout(force);if(!checking)process.exit(0);});
  });
  if(state.transition){state=await recoverTransition(root,state);console.warn('自動更新: 中断された更新の保存データを復元しました。');}
  await writeState(root,state);
  function watch(current){current.child.once('exit',code=>{if(current===worker&&!managed&&!stopping){console.error('Botが終了しました。ホスティング側から再起動してください。');exitStatus=code||1;stopping=true;clearInterval(timer);abort.abort();if(!checking)process.exit(exitStatus);}});}
  worker=launch(root,releasePath(root,state));await worker.ready;watch(worker);worker.child.send({type:'activate'});
  await cleanup(root,state);
  const enabled=process.env.ASTRAL_AUTO_UPDATE!=='0';
  console.log(`自動更新: ${enabled?'ON · mainを定期確認':'OFF'}${state.sha?` · ${state.sha.slice(0,7)}`:''}`);
  async function check(){
    if(checking||stopping)return;checking=true;
    try{
      if(!prepared){const sha=await githubHead();if(sha===state.sha||sha===state.failed)return;console.log(`自動更新: ${sha.slice(0,7)} を準備中。`);const release=await prepareRelease(root,sha,{run:(command,args,options)=>runFile(command,args,{...options,signal:abort.signal})});prepared={sha,release};}
      if(stopping)return;
      managed=true;
      const stopped=await requestStop(worker);
      if(!stopped){console.log('自動更新: 処理・ゲームの終了を待っています。');return;}
      await worker.exited;if(stopping)return;
      const result=await switchRelease(root,state,prepared.release,{launch});worker=result.worker;state=result.state;watch(worker);prepared=null;
      await cleanup(root,state);console.log(`自動更新: ${state.sha?.slice(0,7)??'前の版'} で稼働中。`);
    }catch(error){console.warn('自動更新:',error.message);if(worker.child.exitCode!==null||worker.child.signalCode!==null){clearInterval(timer);process.exitCode=1;}}
    finally{managed=false;checking=false;if(stopping)process.exit(exitStatus);else if(worker.child.exitCode!==null||worker.child.signalCode!==null){clearInterval(timer);process.exit(1);}}
  }
  if(enabled){timer=setInterval(()=>void check(),intervalMs(process.env.ASTRAL_UPDATE_INTERVAL));void check();}
}
