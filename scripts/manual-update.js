import {githubHead,validSha} from './auto-update.js';
export const UPDATER_PROTOCOL='2';
export async function githubRelease({fetcher=fetch}={}){
  const sha=await githubHead({fetcher});
  const response=await fetcher(`https://raw.githubusercontent.com/astraldao/astral_discord/${sha}/package.json`,{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('バージョン情報を取得できません。');
  const text=await response.text();if(text.length>65536)throw new Error('バージョン情報が大きすぎます。');
  const version=JSON.parse(text).version;if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version))throw new Error('バージョン情報が不正です。');
  return {sha,version};
}
// No polling: work begins only after an explicit, checked admin request.
export function createManualUpdater({current,latest=githubRelease,prepare,apply,presence=()=>{},blocked=()=>false,now=Date.now,schedule=setTimeout,cancel=clearTimeout}){
  let candidate=null,checkedAt=null,phase='idle',error=null,checking=false,timer,closed=false;
  const active=()=>['preparing','switching'].includes(phase);
  const status=async()=>({supported:true,current:await current(),latest:candidate,checkedAt,phase,error});
  async function run(){
    timer=undefined;
    try{
      const release=await prepare(candidate.sha);if(closed)return;
      phase='switching';const result=await apply(release);
      phase=result.rolledBack?'failed':'complete';error=result.rolledBack?'新版の起動に失敗したため、保存データと前の版を復元しました。':null;
    }catch(e){phase=e.code==='UPDATE_BUSY'?'blocked':'failed';error=e.code==='UPDATE_BUSY'?'操作・VC入室・ゲームが進行中です。終了後にもう一度更新してください。':'更新を完了できませんでした。現在の版を確認してください。';}
    finally{presence(false);}
  }
  return {status,get busy(){return active()||checking;},async request(action,sha){
    if(closed)throw new Error('Botを停止しています。');
    if(action==='status')return status();
    if(blocked())throw new Error('再起動の処理中です。');
    if(action==='check'){
      if(active()||checking)return status();
      if(checkedAt!==null&&now()-checkedAt<30000)return status();
      checking=true;
      try{const found=await latest();if(!validSha(found.sha)||!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(found.version))throw new Error();candidate=found;checkedAt=now();error=null;}finally{checking=false;}
      return status();
    }
    if(action!=='start')throw new Error('更新操作が不正です。');
    if(active()||checking)throw new Error('別の更新操作を処理中です。');
    if(!candidate||!validSha(sha)||sha!==candidate.sha||now()-checkedAt>600000)throw new Error('更新を確認し直してください。');
    if((await current()).sha===sha)throw new Error('この版はすでに稼働しています。');
    if(blocked())throw new Error('再起動の処理中です。');
    // Reserve before returning: simultaneous confirmations cannot launch twice.
    if(active())throw new Error('更新中です。');
    phase='preparing';error=null;presence(true);timer=schedule(()=>void run(),1500);
    return status();
  },close(){closed=true;if(timer!==undefined)cancel(timer);presence(false);}};
}
