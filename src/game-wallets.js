import {mkdir,readFile,writeFile,rename,unlink,stat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {casinoRound,bets} from './casino.js';
export const START_CHIPS=3000,MAX_CHIPS=100000000;
const LIMIT=2*1024*1024,MAX_USERS=5000;
const validId=id=>typeof id==='string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
const validWork=w=>w===undefined || (w && Number.isSafeInteger(w.windowStarted) && w.windowStarted>=0 && Number.isSafeInteger(w.earned) && w.earned>=0 && w.earned<=30 && Number.isSafeInteger(w.notBefore) && w.notBefore>=0 && (w.ticket===null || (w.ticket && validId(w.ticket.id) && Number.isSafeInteger(w.ticket.expires) && w.ticket.expires>=0)));
const validBalance=n=>Number.isSafeInteger(n) && n>=0 && n<=MAX_CHIPS;
export function blackjackPayout(bet,result){if(!bets.includes(bet))throw new Error('掛けチップが不正です。');if(result==='blackjack')return bet*2.5;if(['win','dealer-bust'].includes(result))return bet*2;if(result==='push')return bet;if(['lose','bust','stopped'].includes(result))return 0;throw new Error('勝負の結果が不正です。');}
export class GameWalletStore {
  constructor(path=null,{now=()=>Date.now()}={}){this.path=path;this.now=now;this.accounts=new Map();this.tail=Promise.resolve();}
  balance(user){if(!validId(user))throw new Error('ユーザーを確認できません。');return this.accounts.get(user)?.balance??START_CHIPS;}
  async load(){if(!this.path)return this;try{
    if((await stat(this.path)).size>LIMIT)throw new Error('チップ台帳が上限を超えています。');const d=JSON.parse(await readFile(this.path,'utf8'));
    if(d.version!==1 || !Array.isArray(d.accounts) || d.accounts.length>MAX_USERS)throw new Error('チップ台帳を読み込めません。');
    const accounts=new Map();let interrupted=false;for(const a of d.accounts){if(!a || !validId(a.user) || accounts.has(a.user) || !validBalance(a.balance) || !validWork(a.work) || (a.lastTransfer!==undefined && !validId(a.lastTransfer)) || (a.pending!==null && (!a.pending || !validId(a.pending.id) || !bets.includes(a.pending.bet) || !Number.isSafeInteger(a.pending.expires) || a.pending.expires<0)))throw new Error('チップ台帳を読み込めません。');if(a.pending || a.work?.ticket)interrupted=true;accounts.set(a.user,{balance:a.balance,pending:null,...(a.work?{work:{...structuredClone(a.work),ticket:null}}:{}),...(a.lastTransfer?{lastTransfer:a.lastTransfer}:{})});}
    if(interrupted)await this.save(accounts);this.accounts=accounts;
  }catch(e){if(e.code!=='ENOENT')throw e;}return this;}
  async save(accounts){if(!this.path)return;const raw=JSON.stringify({version:1,accounts:[...accounts].map(([user,a])=>({user,...a}))});if(Buffer.byteLength(raw)>LIMIT)throw new Error('チップ台帳が上限を超えています。');await mkdir(dirname(this.path),{recursive:true,mode:0o700});const temp=`${this.path}.${randomUUID()}.tmp`;try{await writeFile(temp,raw,{mode:0o600,flag:'wx'});await rename(temp,this.path);}finally{await unlink(temp).catch(()=>{});}}
  update(user,fn,check=()=>{}){const job=this.tail.then(async()=>{if(!validId(user))throw new Error('ユーザーを確認できません。');await check();const next=new Map([...this.accounts].map(([id,a])=>[id,structuredClone(a)]));if(!next.has(user)){if(next.size>=MAX_USERS)throw new Error('チップ台帳のユーザー数が上限に達しています。');next.set(user,{balance:START_CHIPS,pending:null});}const a=next.get(user),result=fn(a,next);if([...next.values()].some(x=>!validBalance(x.balance) || !validWork(x.work)))throw new Error('チップ残高の上限に達しました。');try{await this.save(next);}catch{throw new Error('チップを保存できませんでした。残高は変更していません。');}this.accounts=next;return result;});this.tail=job.catch(()=>{});return job;}
  playCasino(user,options,random,check){return this.update(user,a=>{const r=casinoRound({...options,balance:a.balance},random);a.balance=r.balance;return r;},check);}
  beginBlackjack(user,id,bet,result,expires,check){return this.update(user,a=>{
    if(!validId(id) || !bets.includes(bet) || !Number.isSafeInteger(expires) || expires<=this.now())throw new Error('ラウンドの設定が不正です。');
    if(a.pending && a.pending.expires>this.now())throw new Error('進行中のブラックジャックを終了してから始めてください。');if(a.balance<bet)throw new Error('チップが不足しています。');
    const payout=result?blackjackPayout(bet,result):0;a.balance=a.balance-bet+payout;a.pending=result?null:{id,bet,expires};return {balance:a.balance,payout};
  },check);}
  hasActiveBlackjack(user){const p=this.accounts.get(user)?.pending;return !!p && p.expires>this.now();}
  assertBlackjack(user,id){const p=this.accounts.get(user)?.pending;if(!p || p.id!==id || p.expires<=this.now())throw new Error('このラウンドは終了しています。ゲーム選択から開き直してください。');}
  finishBlackjack(user,id,result,check){return this.update(user,a=>{if(!a.pending || a.pending.id!==id || a.pending.expires<=this.now())throw new Error('このラウンドは精算済み、または終了しています。');const payout=blackjackPayout(a.pending.bet,result);a.balance+=payout;a.pending=null;return {balance:a.balance,payout};},check);}
  async refill(){throw new Error('無料ゲームで少しずつチップを獲得してください。');}
  transfer(user,target,amount,id,check){return this.update(user,(a,next)=>{
    if(!validId(target) || target===user || !validId(id) || !Number.isSafeInteger(amount) || amount<1 || amount>MAX_CHIPS)throw new Error('相手と譲渡枚数を確認してください。');
    if(a.lastTransfer===id)throw new Error('この譲渡は送信済みです。');if(a.balance<amount)throw new Error('チップが不足しています。');
    if(!next.has(target)){if(next.size>=MAX_USERS)throw new Error('チップ台帳のユーザー数が上限に達しています。');next.set(target,{balance:START_CHIPS,pending:null});}
    const recipient=next.get(target);if(recipient.balance>MAX_CHIPS-amount)throw new Error('相手のチップ上限を超えます。');a.balance-=amount;recipient.balance+=amount;a.lastTransfer=id;return {amount,balance:a.balance};
  },check);}
  workBudget(a){const time=this.now();const w=a.work??{windowStarted:time,earned:0,notBefore:0,ticket:null};if(time-w.windowStarted>=3600000){w.windowStarted=time;w.earned=0;}a.work=w;return w;}
  beginWork(user,id,check){return this.update(user,a=>{
    const time=this.now();if(!validId(id))throw new Error('ゲームを開き直してください。');
    const w=this.workBudget(a);if(w.ticket && w.ticket.expires>time)throw new Error('進行中のニワトリを元の画面から捕まえてください。');
    w.ticket={id,expires:time+600000};return {id,expires:w.ticket.expires};
  },check);}
  earnWork(user,id,check){return this.update(user,a=>{
    const w=this.workBudget(a),time=this.now();if(!w.ticket || w.ticket.id!==id || w.ticket.expires<=time)throw new Error('このお手伝いは終了しています。');
    const reason=a.balance>=10?'solvent':a.pending && a.pending.expires>time?'blackjack':w.earned>=30?'limit':w.notBefore>time?'cooldown':null;
    const reward=reason?0:Math.min(5,30-w.earned);a.balance+=reward;w.earned+=reward;w.ticket=null;if(reward)w.notBefore=time+30000;return {reward,balance:a.balance,reason};
  },check);}
}
