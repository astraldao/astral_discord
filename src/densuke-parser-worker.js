import {parentPort} from 'node:worker_threads';
import {confirmationFields,resultLinks} from './densuke-html.js';
parentPort.once('message',data=>{
  try{
    if(!data||typeof data.html!=='string'||Buffer.byteLength(data.html)>1024*1024||!['confirmation','result'].includes(data.kind))throw new Error('invalid request');
    let value;if(data.kind==='confirmation'){confirmationFields(data.html,data.event,data.email);value=true;}else value=resultLinks(data.html);
    parentPort.postMessage({ok:true,value});
  }catch(error){parentPort.postMessage({ok:false,code:error.code==='DENSUKE_HTML_LIMIT'?'DENSUKE_HTML_LIMIT':'DENSUKE_HTML_PARSE'});}
  parentPort.close();
});
