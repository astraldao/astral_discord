// No release downloads or polling. Only an explicit, confirmed admin request schedules work.
export function createManualRestarter({restart,blocked=()=>false,presence=()=>{},schedule=setTimeout,cancel=clearTimeout}){
  let phase='idle',error=null,timer,closed=false;
  const active=()=>['scheduled','restarting'].includes(phase);
  const status=()=>({supported:true,phase,error});
  async function run(revision){timer=undefined;try{phase='restarting';const result=await restart(revision);phase=result.restored?'restored':'complete';error=result.restored?'起動に失敗したため、直前の起動設定に戻して復旧しました。':null;}catch(e){phase=['UPDATE_BUSY','RESTART_CHANGED'].includes(e.code)?'blocked':'failed';error=e.code==='UPDATE_BUSY'?'操作・読み上げ・ゲームが進行中です。終了後にもう一度再起動してください。':e.code==='RESTART_CHANGED'?'起動設定が変わりました。確認画面を開き直してください。':'再起動を完了できませんでした。ホスティング側の状態を確認してください。';}finally{presence(false);}}
  return {get busy(){return active();},status,request(action,revision){
    if(closed)throw new Error('Botを停止しています。');if(action==='status')return status();
    if(action!=='start'||typeof revision!=='string'||revision.length>256)throw new Error('再起動の確認を開き直してください。');
    if(active()||blocked())throw new Error('更新または再起動の処理中です。');
    phase='scheduled';error=null;presence(true);timer=schedule(()=>void run(revision),1500);return status();
  },close(){closed=true;if(timer!==undefined){cancel(timer);timer=undefined;phase='idle';presence(false);}}};
}
