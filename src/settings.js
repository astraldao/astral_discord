import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {dirname} from 'node:path';
const id = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
export const validDensukeEmail=value=>typeof value==='string' && value.length<=254 && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value);
export function validateSettings(c) {
  if (!c || c.version !== 1 || (c.lobbyId !== null && !id(c.lobbyId)) ||
    !Array.isArray(c.targetIds) || c.targetIds.length > 125 || c.targetIds.some(x => !id(x)) ||
    new Set(c.targetIds).size !== c.targetIds.length || c.targetIds.includes(c.lobbyId) ||
    !Number.isInteger(c.seconds) || c.seconds < 3 || c.seconds > 15 ||
    typeof c.voice !== 'boolean' || typeof c.enforce !== 'boolean') throw new Error('設定ファイルの形式が不正です。');
  c.volume ??=30;
  if(!Number.isInteger(c.volume) || c.volume<10 || c.volume>60)throw new Error('音量は10〜60です。');
  c.words??=[];
  c.densukeEmail??=null;
  if(c.densukeEmail!==null && !validDensukeEmail(c.densukeEmail))throw new Error('伝助の固定メールアドレスが不正です。');
  if(!Array.isArray(c.words) || c.words.length>100 || c.words.some(w=>!w || typeof w.surface!=='string' || !w.surface.length || w.surface.length>32 || typeof w.reading!=='string' || w.reading.length>40 || !/^[ァ-ヴー]+$/.test(w.reading)) || new Set(c.words.map(w=>w.surface.toLowerCase())).size!==c.words.length)throw new Error('読み方辞書の形式が不正です。');
  return c;
}
export class SettingsStore {
  constructor(path, defaults) {this.path=path;this.value=validateSettings(defaults);this.tail=Promise.resolve();}
  async load() {
    try {this.value=validateSettings(JSON.parse(await readFile(this.path,'utf8')));}
    catch(error) {if(error.code !== 'ENOENT') throw error;}
    return this.get();
  }
  get() {return structuredClone(this.value);}
  update(change,check=()=>{}) {
    const run=this.tail.then(async () => {
      // Permission checks performed before joining the queue may already be stale.
      await check();
      const next=this.get();change(next);validateSettings(next);
      await mkdir(dirname(this.path),{recursive:true});
      await writeFile(`${this.path}.tmp`,JSON.stringify(next,null,2)+'\n',{mode:0o600});
      await rename(`${this.path}.tmp`,this.path);
      this.value=next;return this.get();
    });
    this.tail=run.catch(()=>{});return run;
  }
}
