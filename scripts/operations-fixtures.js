// Fictional snapshots only: no environment, files, Discord or external API access.
export function operationsFixtures(){
  const current='a'.repeat(40),target='b'.repeat(40),MiB=1048576;
  const security={status:'complete',version:'6.12.0',checkedAt:1793000000000,lockHash:'a'.repeat(64),packageCount:44,runtimeCount:43,devCount:1,skipped:0,detailMissing:1,findings:[{id:'CVE-2099-1001',severity:'high',detail:true,packages:Array.from({length:7},(_,n)=>({name:`example-${n}`,version:'1.0.0',dev:n%2===0,direct:n<2})),fixed:[{name:'example-1',version:'1.0.1'}]},{id:'CVE-2099-1002',severity:'unknown',detail:false,packages:[{name:'example-tool',version:'2.0.0',dev:true,direct:true}],fixed:[]}]};
  const version={supported:true,current:{sha:current,version:'6.12.0'},latest:{sha:target,version:'6.13.0'},phase:'idle',checkedAt:1793000000000};
  const capacity={currentSha:current,targetSha:target,archiveBytes:2*MiB,sourceBytes:10*MiB,dataBackupBytes:MiB,dependencies:'reuse',freeBytes:300*MiB};
  const runtime={pending:true,running:{ASTRAL_BACKUP_TTS:'0',VOICEVOX_BACKUP_THREADS:'1'},effective:{ASTRAL_BACKUP_TTS:'1',VOICEVOX_BACKUP_THREADS:'2'}};
  return {security,version,capacity,runtime};
}
