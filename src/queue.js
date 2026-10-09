export class SerialQueue {
  tail = Promise.resolve();
  waiting = [];
  active = null;
  get size() { return this.waiting.length + (this.active ? 1 : 0); }
  positions() {
    this.waiting.forEach((entry,index)=>{
      try {entry.onPosition?.(index+(this.active?1:0));} catch {}
    });
  }
  add(task,{signal,onPosition}={}) {
    if(signal?.aborted)return Promise.reject(signal.reason);
    const result = new Promise((resolve,reject)=>{
      const entry={task,resolve,reject,signal,onPosition};
      entry.cancel=()=>{
        const index=this.waiting.indexOf(entry);
        if(index<0)return;
        this.waiting.splice(index,1);
        signal.removeEventListener('abort',entry.cancel);
        reject(signal.reason);
        this.positions();
      };
      signal?.addEventListener('abort',entry.cancel,{once:true});
      this.waiting.push(entry);
      this.positions();
      queueMicrotask(()=>this.pump());
    });
    this.tail = result.catch(() => {});
    return result;
  }
  async pump() {
    if(this.active || !this.waiting.length)return;
    const entry=this.waiting.shift();
    this.active=entry;
    this.positions();
    let value,error,failed=false;
    try {value=await entry.task();} catch(cause){error=cause;failed=true;}
    entry.signal?.removeEventListener('abort',entry.cancel);
    this.active=null;
    this.positions();
    queueMicrotask(()=>this.pump());
    if(failed)entry.reject(error);else entry.resolve(value);
  }
}

export function canEnter(channel, member, bot, lobbyId, targets) {
  const listed=Array.isArray(targets) ? targets.includes(channel?.id) : channel?.parentId === targets;
  if (!channel || channel.type !== 2 || channel.id === lobbyId || !listed) return false;
  const memberPermissions = channel.permissionsFor(member);
  const botPermissions = channel.permissionsFor(bot);
  // Admin-listed destinations authorize bot-assisted entry without member Connect.
  // Retain member ViewChannel and the bot's ViewChannel/Connect/MoveMembers/chat permissions.
  const has = (permissions, bits) => permissions?.has(bits) === true;
  return has(memberPermissions, [1024n])
    && has(botPermissions, [1024n, 1048576n, 16777216n, 2048n, 16384n])
    && (!channel.userLimit || channel.members.filter(m => !m.user.bot).size < channel.userLimit);
}
