import {Worker} from 'node:worker_threads';
const failed=code=>Object.assign(new Error(code==='DENSUKE_HTML_TIMEOUT'?'伝助の応答解析が時間内に完了しませんでした。':'伝助の応答を安全に解析できませんでした。'),{code});
// One bounded, disposable worker for one page. Sensitive fields stay in memory.
export function parseDensukePage(kind,html,{event,email,signal,timeout=5000,launch=()=>new Worker(new URL('./densuke-parser-worker.js',import.meta.url),{env:{},execArgv:[],stdout:true,stderr:true,resourceLimits:{maxOldGenerationSizeMb:32,maxYoungGenerationSizeMb:8,stackSizeMb:1}})}={}){
  if(!['confirmation','result'].includes(kind)||typeof html!=='string'||Buffer.byteLength(html)>1024*1024||!Number.isInteger(timeout)||timeout<1||timeout>5000)return Promise.reject(failed('DENSUKE_HTML_LIMIT'));
  if(signal?.aborted)return Promise.reject(failed('DENSUKE_HTML_CANCELLED'));
  return new Promise((resolve,reject)=>{
    let worker,timer,settled=false;
    const aborted=()=>finish(failed('DENSUKE_HTML_CANCELLED'));
    const error=()=>finish(failed('DENSUKE_HTML_PARSE'));
    const message=data=>{
      if(!data||data.ok!==true){finish(failed(data?.code==='DENSUKE_HTML_LIMIT'?'DENSUKE_HTML_LIMIT':'DENSUKE_HTML_PARSE'));return;}
      const value=data.value;
      if(kind==='confirmation'?value!==true:!value||typeof value.answer!=='string'||typeof value.edit!=='string'||value.answer.length>2048||value.edit.length>2048){finish(failed('DENSUKE_HTML_PARSE'));return;}
      finish(null,value);
    };
    function finish(failure,value){
      if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',aborted);
      if(worker){worker.off('message',message);worker.off('error',error);worker.off('exit',error);worker.on('error',()=>{});try{Promise.resolve(worker.terminate()).catch(()=>{});}catch{}}
      failure?reject(failure):resolve(value);
    }
    try{
      worker=launch();worker.stdout?.resume();worker.stderr?.resume();worker.on('message',message);worker.on('error',error);worker.on('exit',error);
      signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted){aborted();return;}
      timer=setTimeout(()=>finish(failed('DENSUKE_HTML_TIMEOUT')),timeout);
      worker.postMessage({kind,html,...(kind==='confirmation'?{event,email}:{})});
    }catch{finish(failed('DENSUKE_HTML_PARSE'));}
  });
}
