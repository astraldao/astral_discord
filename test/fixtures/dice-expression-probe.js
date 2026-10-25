import {parentPort} from 'node:worker_threads';
import {compileDiceExpression,advancedRollCandidate,pureAdvancedDice} from '../../src/dice-expression.js';
const cases=['9'.repeat(7900)+'d9kh1','1d6'+'r1'.repeat(3000),'('.repeat(3900)+'1d6'+')'.repeat(3900),'1d6'+'+1'.repeat(3900)];let count=0;
for(let i=0;i<30;i++)for(const s of cases){try{compileDiceExpression(s);}catch{}advancedRollCandidate(s);pureAdvancedDice(s);count++;}parentPort.postMessage(count);
