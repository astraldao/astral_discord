// Monotonic token buckets. Rejections do not spend other buckets' tokens.
export class InteractionLimits {
  constructor(now=()=>performance.now()) {this.now=now;this.users=new Map();this.global={};}
  consume(userId,entry=false) {
    const now=this.now();
    for(const [id,s] of this.users)if(now-s.seen>=60000)this.users.delete(id);
    let user=this.users.get(userId);
    if(!user && this.users.size>=1024)return 60;
    user??={};
    const rules=[[user,'actions',5,1000],[this.global,'actions',30,200]];
    if(entry)rules.push([user,'entries',1,15000],[this.global,'entries',4,3000]);
    const buckets=rules.map(([owner,key,capacity,period])=>{
      const previous=owner[key]??{tokens:capacity,at:now};
      return {owner,key,tokens:Math.min(capacity,previous.tokens+(now-previous.at)/period),period};
    });
    const wait=Math.max(0,...buckets.map(b=>b.tokens>=1?0:Math.ceil((1-b.tokens)*b.period/1000)));
    if(wait)return wait;
    for(const b of buckets)b.owner[b.key]={tokens:b.tokens-1,at:now};
    user.seen=now;this.users.set(userId,user);return 0;
  }
}
