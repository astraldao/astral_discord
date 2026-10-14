import {AdminSessions} from './admin.js';
// Bound memory without evicting a paid hand or an in-flight wallet transaction.
export class GameSessions extends AdminSessions {
  constructor(now=()=>Date.now(),protect=()=>false){super(now);this.protect=protect;}
  get(id,userId){try{return super.get(id,userId);}catch{throw new Error('この画面は終了しています。元のコマンドやゲーム選択から開き直してください。');}}
  create(userId){
    for(const [id,s] of this.sessions)if(s.expires<=this.now())this.sessions.delete(id);
    const owned=[...this.sessions.values()].filter(s=>s.userId===userId);
    if(owned.some(s=>s.busy||this.protect(s)))throw new Error('進行中のゲームを元の画面から操作してください。');
    for(const s of owned)this.sessions.delete(s.id);
    if(this.sessions.size>=200){
      const idle=[...this.sessions.values()].find(s=>!s.busy&&!this.protect(s));
      if(!idle)throw new Error('ゲーム画面が混み合っています。しばらくしてから開き直してください。');
      this.sessions.delete(idle.id);
    }
    return super.create(userId);
  }
}
