import {parentPort} from 'node:worker_threads';
parentPort.once('message',()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0));
