import {mkdir,readFile,writeFile,rename,unlink,stat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {casinoRound,bets} from './casino.js';
export const START_CHIPS=3000,MAX_CHIPS=100000000;
const LIMIT=2*1024*1024,MAX_USERS=5000;
const validId=id=>typeof id==='string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
const validBalance=n=>Number.isSafeInteger(n) && n>=0 && n<=MAX_CHIPS;
export function blackjackPayout(bet,result){if(!bets.includes(bet))throw new Error('掛けチップが不正です。');if(result==='blackjack')return bet*2.5;if(['win','dealer-bust'].includes(result))return bet*2;if(result==='push')return bet;if(['lose','bust','stopped'].includes(result))return 0;throw new Error('勝負の結果が不正です。');}
export class GameWalletStore {
  constructor(path=null,{now=()=>Date.now()}={}){this.path=path;this.now=now;this.accounts=new Map();this.tail=Promise.resolve();}
  balance(user){if(!validId(user))throw new Error('ユーザーを確認できません。');return this.accounts.get(user)?.balance??START_CHIPS;}
  async load(){if(!this.path)return this;try{
    if((await stat(this.path)).size>LIMIT)throw new Error('チップ台帳が上限を超えています。');const d=JSON.parse(await readFile(this.path,'utf8'));
    if(d.version!==1 || !Array.isArray(d.accounts) || d.accounts.length>MAX_USERS)throw new Error('チップ台帳を読み込めません。');
    const accounts=new Map();let interrupted=false;for(const a of d.accounts){if(!a || !validId(a.user) || accounts.has(a.user) || !validBalance(a.balance) || (a.pending!==null && (!a.pending || !validId(a.pending.id) || !bets.includes(a.pending.bet) || !Number.isSafeInteger(a.pending.expires) || a.pending.expires<0)))throw new Error('チップ台帳を読み込めません。');if(a.pending)interrupted=true;accounts.set(a.user,{balance:a.balance,pending:null});}
    if(interrupted)await this.save(accounts);this.accounts=accounts;
  }catch(e){if(e.code!=='ENOENT')throw e;}return this;}
  async save(accounts){if(!this.path)return;const raw=JSON.stringify({version:1,accounts:[...accounts].map(([user,a])=>({user,...a}))});if(Buffer.byteLength(raw)>LIMIT)throw new Error('チップ台帳が上限を超えています。');await mkdir(dirname(this.path),{recursive:true,mode:0o700});const temp=`${this.path}.${randomUUID()}.tmp`;try{await writeFile(temp,raw,{mode:0o600,flag:'wx'});await rename(temp,this.path);}finally{await unlink(temp).catch(()=>{});}}
  update(user,fn,check=()=>{}){const job=this.tail.then(async()=>{if(!validId(user))throw new Error('ユーザーを確認できません。');await check();const next=new Map([...this.accounts].map(([id,a])=>[id,structuredClone(a)]));if(!next.has(user)){if(next.size>=MAX_USERS)throw new Error('チップ台帳のユーザー数が上限に達しています。');next.set(user,{balance:START_CHIPS,pending:null});}const a=next.get(user),result=fn(a);if(!validBalance(a.balance))throw new Error('チップ残高の上限に達しました。');try{await this.save(next);}catch{throw new Error('チップを保存できませんでした。残高は変更していません。');}this.accounts=next;return result;});this.tail=job.catch(()=>{});return job;}
  playCasino(user,options,random,check){return this.update(user,a=>{const r=casinoRound({...options,balance:a.balance},random);a.balance=r.balance;return r;},check);}
  beginBlackjack(user,id,bet,result,expires,check){return this.update(user,a=>{
    if(!validId(id) || !bets.includes(bet) || !Number.isSafeInteger(expires) || expires<=this.now())throw new Error('ラウンドの設定が不正です。');
    if(a.pending && a.pending.expires>this.now())throw new Error('進行中のブラックジャックを終了してから始めてください。');if(a.balance<bet)throw new Error('チップが不足しています。');
    const payout=result?blackjackPayout(bet,result):0;a.balance=a.balance-bet+payout;a.pending=result?null:{id,bet,expires};return {balance:a.balance,payout};
  },check);}
  hasActiveBlackjack(user){const p=this.accounts.get(user)?.pending;return !!p && p.expires>this.now();}
  assertBlackjack(user,id){const p=this.accounts.get(user)?.pending;if(!p || p.id!==id || p.expires<=this.now())throw new Error('このラウンドは終了しています。ゲーム選択から開き直してください。');}
  finishBlackjack(user,id,result,check){return this.update(user,a=>{if(!a.pending || a.pending.id!==id || a.pending.expires<=this.now())throw new Error('このラウンドは精算済み、または終了しています。');const payout=blackjackPayout(a.pending.bet,result);a.balance+=payout;a.pending=null;return {balance:a.balance,payout};},check);}
  refill(user,check){return this.update(user,a=>{if(a.balance>=10)throw new Error('チップは10未満になってから補充できます。');if(a.pending && a.pending.expires>this.now())throw new Error('進行中のブラックジャックを終了してから補充してください。');a.balance=START_CHIPS;a.pending=null;return a.balance;},check);}
}
