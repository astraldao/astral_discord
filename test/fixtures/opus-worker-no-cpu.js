import process from 'node:process';
process.threadCpuUsage=()=>{throw new Error('Counter unavailable');};
await import('../../src/opus-worker.js');
