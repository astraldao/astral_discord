import {BoundedBytes} from '../../src/bounded-bytes.js';
const mode=process.argv[2],count=262144;if(!['old','new'].includes(mode))throw Error('mode');
const chunk=Uint8Array.of(42);global.gc();const before=process.memoryUsage(),began=performance.now();
let chunks,collector;if(mode==='old'){chunks=[];for(let n=0;n<count;n++)chunks.push(Buffer.from(chunk));}else{collector=new BoundedBytes(count);for(let n=0;n<count;n++)collector.append(chunk);}
const collectionMs=performance.now()-began;global.gc();const after=process.memoryUsage(),output=mode==='old'?Buffer.concat(chunks):collector.finish();
if(output.length!==count||output.some(value=>value!==42))throw Error('bytes changed');
console.log(JSON.stringify({mode,bytes:count,fragments:count,collectionMs,heldHeapDelta:after.heapUsed-before.heapUsed,externalDelta:after.external-before.external,rssDelta:after.rss-before.rss}));
