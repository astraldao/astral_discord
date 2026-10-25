import {parentPort} from 'node:worker_threads';
import {diceRequest,saizeRequest} from '../../src/chat-dice.js';
const requests=['1d10'+ 'お願いします'.repeat(70)+'x','1d10'+ 'おねがいします'.repeat(65)+'x','!サイゼロール'+ 'お願いします'.repeat(70)+'x'];
let rejected=0;for(let i=0;i<30;i++)for(const content of requests)if(!diceRequest(content)&&!saizeRequest(content))rejected++;
parentPort.postMessage({rejected});
