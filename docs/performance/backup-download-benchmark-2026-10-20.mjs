import {prepareBackups,backupBundles} from '../../src/backups.js';
const mode=process.argv[2];if(!['all','one'].includes(mode)||typeof global.gc!=='function')throw Error('usage: node --expose-gc <script> all|one');
// Synthetic flat strings model data loaded from JSON. No real PC data is used.
const synthetic=()=>JSON.parse(JSON.stringify(Array.from({length:100},(_,n)=>({id:`synthetic-${n}`,ownerId:'synthetic',panelId:'panel',name:`Synthetic${n}`,txt:'x'.repeat(256*1024-String(n).length)+n}))));
const characters=synthetic();
global.gc();global.gc();const before=process.memoryUsage(),cpu=process.cpuUsage(),began=performance.now();let files;
if(mode==='all')files=backupBundles(characters);
else{
  // Match new-plan creation, generation and post-authorization validation.
  const initial=prepareBackups(characters).plan,prepared=prepareBackups(characters);files=[prepared.part(0)];
  if(prepareBackups(characters).plan.signature!==initial.signature)throw Error('snapshot changed');
}
const elapsedMs=performance.now()-began,used=process.cpuUsage(cpu);global.gc();global.gc();const after=process.memoryUsage();
if(characters.reduce((n,c)=>n+Buffer.byteLength(c.txt),0)!==100*256*1024)throw Error('source changed');
console.log(JSON.stringify({mode,characters:characters.length,outputs:files.length,outputBytes:files.reduce((n,f)=>n+f.data.length,0),elapsedMs,cpuMs:(used.user+used.system)/1000,arrayBuffersDelta:after.arrayBuffers-before.arrayBuffers,externalDelta:after.external-before.external,heapUsedDelta:after.heapUsed-before.heapUsed,rssDelta:after.rss-before.rss}));
