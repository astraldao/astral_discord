import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {createManualUpdater,UPDATER_PROTOCOL} from './manual-update.js';
import {prepareRelease,readState,writeState,releasePath,snapshotData,restoreData,cleanup,runFile} from './auto-update.js';
export function launchWorker(root,source,{timeout=90000,updating=false}={}){
  const child=spawn(process.execPath,[join(source,'index.js'),'--worker'],{cwd:root,shell:false,env:{...process.env,ASTRAL_DATA_ROOT:root,ASTRAL_SUPERVISED:'1',ASTRAL_UPDATER_PROTOCOL:UPDATER_PROTOCOL,ASTRAL_UPDATING:updating?'1':'0'},stdio:['inherit','inherit','inherit','ipc']});
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
    console.warn(`更新: ${sha.slice(0,7)} の起動に失敗。保存データと前の版を戻しました。`);
    const worker=launch(root,releasePath(root,old));await worker.ready;worker.child.send({type:'activate'});
    return {state:old,worker};
  }
}
export async function recoverTransition(root,state){
  if(!state.transition)return state;
  await restoreData(root);const old={...state,failed:state.transition};delete old.transition;await writeState(root,old);return old;
}
export async function supervise(){
  const root=process.cwd();let state=await readState(root),worker,managed=false,stopping=false,updateRunning=false;
  const abort=new AbortController(),children=new Set();
  const send=(current,message)=>{if(current?.child.connected)current.child.send(message,()=>{});};
  const updater=createManualUpdater({
    current:async()=>({sha:state.sha,version:JSON.parse(await readFile(join(releasePath(root,state),'package.json'),'utf8')).version,failed:state.failed}),
    presence:updating=>{updateRunning=updating;send(worker,{type:'update-presence',updating});},
    prepare:async sha=>{await cleanup(root,state);return prepareRelease(root,sha,{run:(command,args,options)=>runFile(command,args,{...options,signal:abort.signal})});},
    apply:async release=>{
      if(stopping)throw new Error('Botを停止しています。');
      managed=true;
      try{
        if(!await requestStop(worker))throw Object.assign(new Error('進行中の操作があります。'),{code:'UPDATE_BUSY'});
        await worker.exited;if(stopping)throw new Error('Botを停止しています。');
        const result=await switchRelease(root,state,release,{launch});worker=result.worker;state=result.state;watch(worker);
        await cleanup(root,state);return {rolledBack:state.sha!==release.split('/').at(-1)};
      }finally{
        managed=false;
        if(!stopping&&(worker.child.exitCode!==null||worker.child.signalCode!==null)){stopping=true;abort.abort();updater.close();process.exitCode=1;}
      }
    },
  });
  function launch(data,source){
    if(stopping)throw new Error('Botを停止しています。');
    const current=launchWorker(data,source,{updating:updateRunning});children.add(current);void current.exited.then(()=>children.delete(current));return current;
  }
  function watch(current){
    current.child.on('message',m=>{
      if(current!==worker||stopping||m?.type!=='update-rpc'||typeof m.id!=='string'||m.id.length>64)return;
      void updater.request(m.action,m.sha).then(data=>send(current,{type:'update-rpc-result',id:m.id,data})).catch(()=>send(current,{type:'update-rpc-result',id:m.id,error:'更新操作に失敗しました。画面を開き直して確認してください。'}));
    });
    current.child.once('exit',code=>{
      if(current!==worker||managed||stopping)return;
      console.error('Botが終了しました。ホスティング側から再起動してください。');stopping=true;abort.abort();updater.close();process.exitCode=code||1;
    });
  }
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{
    stopping=true;abort.abort();updater.close();for(const current of children)current.child.kill(signal);
    const force=setTimeout(()=>{for(const current of children)current.child.kill('SIGKILL');process.exit(0);},15000);force.unref();
    void Promise.all([...children].map(current=>current.exited)).then(()=>{clearTimeout(force);process.exit(0);});
  });
  if(state.transition){state=await recoverTransition(root,state);console.warn('更新: 中断された初期化の保存データを復元しました。');}
  await writeState(root,state);worker=launch(root,releasePath(root,state));await worker.ready;watch(worker);send(worker,{type:'activate'});await cleanup(root,state);
  console.log(`更新: 管理者の /admin → バージョン管理 から実行${state.sha?` · ${state.sha.slice(0,7)}`:''}`);
}
