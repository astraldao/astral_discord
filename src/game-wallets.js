import {mkdir,readFile,writeFile,rename,unlink,stat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {START_CHIPS,MAX_CHIPS,MAX_USERS,WALLET_LIMIT as LIMIT,LEGACY_WALLET_LIMIT} from './chip-constants.js';
import {newLedger,recordChip,validLedger,validAudit,AUDIT_LIMIT} from './chip-ledger.js';
import {casinoRound,bets} from './casino.js';
export {START_CHIPS,MAX_CHIPS};
const validId=id=>typeof id==='string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
const validWork=w=>w===undefined || (w && Number.isSafeInteger(w.windowStarted) && w.windowStarted>=0 && Number.isSafeInteger(w.earned) && w.earned>=0 && w.earned<=30 && Number.isSafeInteger(w.notBefore) && w.notBefore>=0 && (w.ticket===null || (w.ticket && validId(w.ticket.id) && Number.isSafeInteger(w.ticket.expires) && w.ticket.expires>=0)));
const validBest=n=>n===undefined || (Number.isInteger(n)&&n>=0&&n<=7);
const validBalance=n=>Number.isSafeInteger(n) && n>=0 && n<=MAX_CHIPS;
export function blackjackPayout(bet,result){if(!bets.includes(bet))throw new Error('掛けチップが不正です。');if(result==='blackjack')return bet*2.5;if(['win','dealer-bust'].includes(result))return bet*2;if(result==='push')return bet;if(['lose','bust','stopped'].includes(result))return 0;throw new Error('勝負の結果が不正です。');}
// Copy only accounts touched by trusted transaction callbacks. Persistence still writes one atomic file.
class WalletDraft extends Map {
  constructor(source){super(source);this.touched=new Set();}
  get(user){let a=super.get(user);if(a&&!this.touched.has(user)){a=structuredClone(a);super.set(user,a);this.touched.add(user);}return a;}
  set(user,a){if(this.touched)this.touched.add(user);return super.set(user,a);}
}
export class GameWalletStore {
  constructor(path=null,{now=()=>Date.now()}={}){this.path=path;this.now=now;this.accounts=new Map();this.audit=[];this.tail=Promise.resolve();}
  memoryBest(user){this.balance(user);return this.accounts.get(user)?.memoryBest??0;}
  balance(user){if(!validId(user))throw new Error('ユーザーを確認できません。');return this.accounts.get(user)?.balance??START_CHIPS;}
  async load(){if(!this.path)return this;try{
    if((await stat(this.path)).size>LIMIT)throw new Error('チップ台帳が上限を超えています。');const raw=await readFile(this.path,'utf8'),d=JSON.parse(raw);if(d.version===1&&Buffer.byteLength(raw)>LEGACY_WALLET_LIMIT)throw new Error('旧チップ台帳が上限を超えています。');
    if(![1,2].includes(d.version) || (d.version===2&&!validAudit(d.audit)) || !Array.isArray(d.accounts) || d.accounts.length>MAX_USERS)throw new Error('チップ台帳を読み込めません。');
    const accounts=new Map(),audit=d.version===2?d.audit:[];let interrupted=d.version===1;for(const a of d.accounts){if(!a || !validId(a.user) || accounts.has(a.user) || !validBalance(a.balance) || !validWork(a.work) || !validBest(a.memoryBest) || (a.lastTransfer!==undefined && !validId(a.lastTransfer)) || (a.pending!==null && (!a.pending || !validId(a.pending.id) || !bets.includes(a.pending.bet) || !Number.isSafeInteger(a.pending.expires) || a.pending.expires<0)))throw new Error('チップ台帳を読み込めません。');if(a.pending || a.work?.ticket)interrupted=true;if(d.version===2&&!validLedger(a.ledger,a.balance))throw new Error('チップ履歴を読み込めません。');const ledger=d.version===2?structuredClone(a.ledger):newLedger(a.balance,this.now());const account={balance:a.balance,pending:null,ledger,...(a.work?{work:{...structuredClone(a.work),ticket:null}}:{}),...(a.lastTransfer?{lastTransfer:a.lastTransfer}:{}),...(a.memoryBest!==undefined?{memoryBest:a.memoryBest}:{}),...(a.lastAdjustment?{lastAdjustment:a.lastAdjustment}:{})};if(a.lastAdjustment!==undefined&&!validId(a.lastAdjustment))throw new Error('チップ履歴を読み込めません。');if(a.pending)recordChip(account,this.now(),'blackjack-interrupted',0);accounts.set(a.user,account);}
    if(d.version===1){try{await writeFile(`${this.path}.v1-backup`,raw,{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}}if(interrupted)await this.save(accounts,audit);this.accounts=accounts;this.audit=audit;
  }catch(e){if(e.code!=='ENOENT')throw e;}return this;}
  async save(accounts,audit=this.audit){if(!this.path)return;const raw=JSON.stringify({version:2,audit,accounts:[...accounts].map(([user,a])=>({user,...a}))});if(Buffer.byteLength(raw)>LIMIT)throw new Error('チップ台帳が上限を超えています。');await mkdir(dirname(this.path),{recursive:true,mode:0o700});const temp=`${this.path}.${randomUUID()}.tmp`;try{await writeFile(temp,raw,{mode:0o600,flag:'wx'});await rename(temp,this.path);}finally{await unlink(temp).catch(()=>{});}}
  update(user,fn,check=()=>{}){const job=this.tail.then(async()=>{if(!validId(user))throw new Error('ユーザーを確認できません。');await check();const next=new WalletDraft(this.accounts),audit=structuredClone(this.audit);if(!next.has(user)){if(next.size>=MAX_USERS)throw new Error('チップ台帳のユーザー数が上限に達しています。');next.set(user,{balance:START_CHIPS,pending:null,ledger:newLedger(START_CHIPS,this.now(),true)});}const a=next.get(user);a.ledger??=newLedger(a.balance,this.now());const before=a.balance,seq=a.ledger.seq,result=fn(a,next,audit);if(a.balance!==before&&a.ledger.seq===seq)recordChip(a,this.now(),'other',a.balance-before);if(!validAudit(audit)||[...next.values()].some(x=>!validBalance(x.balance) || !validWork(x.work) || !validBest(x.memoryBest)||!validLedger(x.ledger,x.balance)))throw new Error('チップ残高の上限に達しました。');try{await this.save(next,audit);}catch{throw new Error('チップを保存できませんでした。残高は変更していません。');}this.accounts=new Map(next);this.audit=audit;return result;});this.tail=job.catch(()=>{});return job;}
  playCasino(user,options,random,check){return this.update(user,a=>{const r=casinoRound({...options,balance:a.balance},random);a.balance=r.balance;recordChip(a,this.now(),'casino',r.delta,{game:r.kind,wager:r.bet,stake:r.bet,payout:r.payout,result:r.outcome});return r;},check);}
  beginBlackjack(user,id,bet,result,expires,check){return this.update(user,a=>{
    if(!validId(id) || !bets.includes(bet) || !Number.isSafeInteger(expires) || expires<=this.now())throw new Error('ラウンドの設定が不正です。');
    if(a.pending && a.pending.expires>this.now())throw new Error('進行中のブラックジャックを終了してから始めてください。');if(a.balance<bet)throw new Error('チップが不足しています。');
    if(a.pending)recordChip(a,this.now(),'blackjack-interrupted',0);const payout=result?blackjackPayout(bet,result):0;a.balance=a.balance-bet+payout;a.pending=result?null:{id,bet,expires};recordChip(a,this.now(),result?'blackjack-result':'blackjack-bet',payout-bet,{game:'blackjack',wager:bet,stake:bet,payout,...(result?{result}:{})});return {balance:a.balance,payout};
  },check);}
  hasActiveBlackjack(user){const p=this.accounts.get(user)?.pending;return !!p && p.expires>this.now();}
  assertBlackjack(user,id){const p=this.accounts.get(user)?.pending;if(!p || p.id!==id || p.expires<=this.now())throw new Error('このラウンドは終了しています。ゲーム選択から開き直してください。');}
  finishBlackjack(user,id,result,check){return this.update(user,a=>{if(!a.pending || a.pending.id!==id || a.pending.expires<=this.now())throw new Error('このラウンドは精算済み、または終了しています。');const stake=a.pending.bet,payout=blackjackPayout(stake,result);a.balance+=payout;a.pending=null;recordChip(a,this.now(),'blackjack-result',payout,{game:'blackjack',wager:0,stake,payout,result});return {balance:a.balance,payout};},check);}
  doubleBlackjack(user,id,result,check){return this.update(user,a=>{
    const pending=a.pending;if(!pending || pending.id!==id || pending.expires<=this.now())throw new Error('このラウンドは精算済み、または終了しています。');
    if(!['win','dealer-bust','push','lose','bust'].includes(result))throw new Error('ダブルの結果を確認できません。');
    if(a.balance<pending.bet)throw new Error('追加のチップが不足しています。');
    const bet=pending.bet*2,payout=blackjackPayout(pending.bet,result)*2;a.balance=a.balance-pending.bet+payout;a.pending=null;recordChip(a,this.now(),'blackjack-double',payout-pending.bet,{game:'blackjack',wager:pending.bet,stake:bet,payout,result});return {balance:a.balance,payout,bet};
  },check);}
  async refill(){throw new Error('無料ゲームで少しずつチップを獲得してください。');}
  transfer(user,target,amount,id,check){return this.update(user,(a,next)=>{
    if(!validId(target) || target===user || !validId(id) || !Number.isSafeInteger(amount) || amount<1 || amount>MAX_CHIPS)throw new Error('相手と譲渡枚数を確認してください。');
    if(a.lastTransfer===id||a.ledger.history.some(e=>e.type==='gift-out'&&e.id===id))throw new Error('この譲渡は送信済みです。');if(a.balance<amount)throw new Error('チップが不足しています。');
    if(!next.has(target)){if(next.size>=MAX_USERS)throw new Error('チップ台帳のユーザー数が上限に達しています。');next.set(target,{balance:START_CHIPS,pending:null,ledger:newLedger(START_CHIPS,this.now(),true)});}
    const recipient=next.get(target);recipient.ledger??=newLedger(recipient.balance,this.now());if(recipient.balance>MAX_CHIPS-amount)throw new Error('相手のチップ上限を超えます。');a.balance-=amount;recipient.balance+=amount;a.lastTransfer=id;recordChip(a,this.now(),'gift-out',-amount,{id,peer:target});recordChip(recipient,this.now(),'gift-in',amount,{id,peer:user});return {amount,balance:a.balance};
  },check);}
  workBudget(a){const time=this.now();const w=a.work??{windowStarted:time,earned:0,notBefore:0,ticket:null};if(time-w.windowStarted>=3600000){w.windowStarted=time;w.earned=0;}a.work=w;return w;}
  beginWork(user,id,check){return this.update(user,a=>{
    const time=this.now();if(!validId(id))throw new Error('ゲームを開き直してください。');
    const w=this.workBudget(a);if(w.ticket && w.ticket.expires>time)throw new Error('進行中のニワトリを元の画面から捕まえてください。');
    w.ticket={id,expires:time+600000};return {id,expires:w.ticket.expires};
  },check);}
  earnWork(user,id,check,{score=0}={}){return this.update(user,a=>{
    const w=this.workBudget(a),time=this.now();if(!w.ticket || w.ticket.id!==id || w.ticket.expires<=time)throw new Error('このお手伝いは終了しています。');
    if(!validBest(score))throw new Error('記録を確認できません。');a.memoryBest=Math.max(a.memoryBest??0,score);
    const reason=a.balance>=10?'solvent':a.pending && a.pending.expires>time?'blackjack':w.earned>=30?'limit':w.notBefore>time?'cooldown':null;
    const reward=reason?0:Math.min(5,30-w.earned);a.balance+=reward;w.earned+=reward;w.ticket=null;if(reward){w.notBefore=time+30000;recordChip(a,time,'work',reward);}return {reward,balance:a.balance,reason,best:a.memoryBest};
  },check);}
  failWork(user,id,score,check){return this.update(user,a=>{const w=this.workBudget(a);if(!w.ticket||w.ticket.id!==id||w.ticket.expires<=this.now()||!validBest(score))throw new Error('このゲームは終了しています。');a.memoryBest=Math.max(a.memoryBest??0,score);w.ticket=null;return {best:a.memoryBest};},check);}

  account(user){this.balance(user);const a=this.accounts.get(user);return structuredClone({balance:a?.balance??START_CHIPS,pending:a?.pending??null,ledger:a?.ledger??newLedger(a?.balance??START_CHIPS,this.now(),!a)});}
  list(){return [...this.accounts].map(([user,a])=>({user,balance:a.balance,net:(a.ledger?.totals.paid??0)-(a.ledger?.totals.wagered??0)})).sort((a,b)=>b.balance-a.balance||a.user.localeCompare(b.user));}
  adjustmentAudit(){return structuredClone(this.audit).reverse();}
  adjust(user,{actor,id,mode,value,reason,expectedBalance,expectedRevision},check){
    if(typeof check!=='function')return Promise.reject(new Error('管理者権限の確認が必要です。'));
    return this.update(user,(a,next,audit)=>{
      if(!validId(actor)||!validId(id)||!['add','remove','set'].includes(mode)||!Number.isSafeInteger(value)||value<0||value>MAX_CHIPS||(mode!=='set'&&value===0)||typeof reason!=='string'||!reason.trim()||reason.length>100||/[\u0000-\u001f\u007f]/u.test(reason))throw new Error('調整内容を確認してください。');
      if(a.lastAdjustment===id||audit.some(e=>e.id===id))throw new Error('この調整は保存済みです。');
      if(a.balance!==expectedBalance||a.ledger.seq!==expectedRevision)throw new Error('残高か履歴が変わりました。内容を開き直して確認してください。');
      if(a.pending&&a.pending.expires>this.now())throw new Error('ブラックジャックの終了後に調整してください。');
      const balance=mode==='set'?value:mode==='add'?a.balance+value:a.balance-value;
      if(!validBalance(balance)||balance===a.balance)throw new Error('調整後は0〜100,000,000枚で、現在と異なる残高にしてください。');
      const delta=balance-a.balance;a.balance=balance;a.lastAdjustment=id;
      const e=recordChip(a,this.now(),'adjust',delta,{id,actor,reason:reason.trim()});audit.push({...e,user});if(audit.length>AUDIT_LIMIT)audit.splice(0,audit.length-AUDIT_LIMIT);
      return {balance,delta};
    },check);
  }

}
