import {open,mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
export const runtimeVariables=[
  {key:'ASTRAL_BACKUP_TTS',label:'バックアップ読み上げ',default:'0',valid:value=>/^[01]$/.test(value),help:'0=OFF、1=ON。ONにする前にDiscord Developer PortalでMessage Content Intentを有効にしてください。'},
  {key:'VOICEVOX_BACKUP_THREADS',label:'合成スレッド上限',default:'2',valid:value=>/^[1-4]$/.test(value),help:'1〜4。既定は2。実行時はCPU割当・並列度までに制限します。1コアなら1スレッドです。'},
];
export function validateRuntimeValues(values){
  if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).some(key=>!runtimeVariables.some(d=>d.key===key)))throw new Error('許可されていない起動設定です。');
  for(const d of runtimeVariables)if(Object.hasOwn(values,d.key)&&(typeof values[d.key]!=='string'||!d.valid(values[d.key])))throw new Error('起動設定の値が不正です。');
  return values;
}
export class RuntimeEnvStore{
  values={};tail=Promise.resolve();
  constructor(file,{base=process.env}={}){this.file=file;this.base=Object.fromEntries(runtimeVariables.map(d=>[d.key,typeof base[d.key]==='string'&&d.valid(base[d.key])?base[d.key]:d.default]));}
  async load(){let handle;try{
    handle=await open(this.file,'r');if((await handle.stat()).size>16384)throw new Error('起動設定が大きすぎます。');
    const data=JSON.parse(await handle.readFile('utf8'));if(data.version!==1||Object.keys(data).some(k=>!['version','values'].includes(k)))throw new Error('起動設定の形式が不正です。');this.values={...validateRuntimeValues(data.values)};
  }catch(error){if(error.code!=='ENOENT')throw new Error('保存済みの起動設定を確認できません。');}finally{await handle?.close();}
    this.running={...this.base,...this.values};return this;
  }
  apply(env){for(const d of runtimeVariables)env[d.key]=this.running[d.key];}
  snapshot(){const effective={...this.base,...this.values};return {values:{...this.values},effective,running:{...this.running},revision:JSON.stringify(this.values),pending:runtimeVariables.some(d=>effective[d.key]!==this.running[d.key])};}
  save(key,value,expected,check=async()=>{}){
    const task=this.tail.then(async()=>{
      const d=runtimeVariables.find(d=>d.key===key);if(!d||value!==null&&(typeof value!=='string'||!d.valid(value)))throw new Error('許可されていない起動設定または値です。');
      if(expected!==JSON.stringify(this.values))throw new Error('別の操作で設定が変わりました。最新の画面から選び直してください。');
      const values={...this.values};if(value===null)delete values[key];else values[key]=value;validateRuntimeValues(values);await check();
      await mkdir(dirname(this.file),{recursive:true});const temp=`${this.file}.${randomUUID()}.tmp`;
      try{await writeFile(temp,JSON.stringify({version:1,values},null,2)+'\n',{mode:0o600,flag:'wx'});await check();await rename(temp,this.file);this.values=values;}finally{await unlink(temp).catch(()=>{});}
      return this.snapshot();
    });this.tail=task.catch(()=>{});return task;
  }
  async restoreRunning(values){
    validateRuntimeValues(values);if(runtimeVariables.some(d=>!Object.hasOwn(values,d.key)))throw new Error('起動設定の復元情報が不足しています。');
    await mkdir(dirname(this.file),{recursive:true});const temp=`${this.file}.${randomUUID()}.tmp`;
    try{await writeFile(temp,JSON.stringify({version:1,values},null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,this.file);this.values={...values};}finally{await unlink(temp).catch(()=>{});}
  }
}
