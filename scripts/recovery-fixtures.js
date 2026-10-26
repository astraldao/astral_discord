// Fixed fictional measurements for tests and before/after examples. No host inspection.
export function recoveryFixtures(){
  const capacity={cpuLimitCores:1,logicalCores:1,effectiveCores:1,memoryUsedBytes:261*1048576,memoryLimitBytes:589*1048576,cpuQuotaKnown:true,memoryQuotaKnown:true,arch:'x64'};
  const result={id:1,version:'6.15.0',ok:true,cancelled:false,measuredAt:1793000000000,parts:7,audioMs:3552,warmupMs:8574,firstAudioMs:2020,synthesisMs:12759,maxGapMs:2274,encodingMs:1707,realTimeFactor:3.59,throttledPercent:19,throttledMs:784,before:capacity,after:{...capacity},info:{engine:'features',protocol:3,threads:1,configuredThreads:3,warmupCpuMs:1000,firstAudioCpuMs:100,synthesisCpuMs:2000},encoding:{backend:'worker-opusscript',warmupMs:1626,processMs:44,warmupCpuMs:200,processCpuMs:20}};
  return {result,state:{phase:'idle',result,historyCount:1},session:{id:'preview',turn:0},transfer:{id:'preview',turn:0,view:'draft',target:'222222222222222222',amountDraft:'4000'}};
}
