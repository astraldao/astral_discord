import {ScheduleStore} from './schedule-store.js';
import {ScheduleError} from './schedule-errors.js';
const mutations=['create','rename','putEvent','putEvents','importEvents','removeEvent','setEventColor','shiftEvents','restoreHistory','clearHistory'];
const publicationMethods=['complete','changeMonth','cancelPending','unpublish'];
export function createScheduleHub({primary,path='data/schedules.json',registered=id=>id===primary,core=new ScheduleStore(path)}={}){
 const views=new Map(),refreshers=new Map();let active=null,dirty=false,closed=false;
 const belongs=(p,guild)=>(p.guildId??primary)===guild;
 const assertGuild=guild=>{if(closed||!registered(guild))throw new ScheduleError('予定表の同期先が登録されていません。');};
 const refresh=()=>{if(active)return active;dirty=true;active=Promise.resolve().then(async()=>{let updated=0,failed=0;while(dirty&&!closed){dirty=false;for(const [guild,fn]of refreshers){if(!registered(guild))continue;try{const r=await fn();updated+=r.updated;failed+=r.failed;}catch{failed++;}}}return {updated,failed};}).finally(()=>{active=null;if(dirty&&!closed)void refresh().catch(()=>{});});return active;};
 core.changed=()=>{dirty=true;void refresh().catch(()=>{});};
 function view(guild){assertGuild(guild);if(views.has(guild))return views.get(guild);
  const check=fn=>async()=>{assertGuild(guild);await fn?.();assertGuild(guild);};
  const scope=c=>({...c,publications:c.publications.filter(p=>belongs(p,guild))});
  const result={readOnly:guild!==primary,get tail(){return core.tail;},metadata(){assertGuild(guild);return core.metadata().map(scope);},calendar(id){assertGuild(guild);return scope(core.calendar(id));},publication(id){assertGuild(guild);const p=core.publication(id);if(!belongs(p,guild))throw new ScheduleError('このサーバーの共有投稿ではありません。');return p;},reserve(id,channel,month,fn){return core.reserve(id,channel,month,check(async()=>{if(result.calendar(id).publications.length>=5)throw new ScheduleError('このサーバーの共有投稿は予定表ごとに5件までです。');await fn?.();}),guild);}};
  for(const name of mutations)result[name]=(...args)=>{if(guild!==primary)return Promise.reject(new ScheduleError('予定の編集はメインサーバーで行ってください。'));const count=core[name].length-1,fn=args[count],params=Array.from({length:count},(_,n)=>args[n]);return core[name](...params,check(fn));};
  for(const name of publicationMethods)result[name]=(...args)=>{const count=core[name].length-1,fn=args[count],params=Array.from({length:count},(_,n)=>args[n]);return core[name](...params,check(async()=>{result.publication(args[0]);await fn?.();}));};
  views.set(guild,result);return result;
 }
 return {get busy(){return !!active;},async load(){await core.load();return this;},view,refresh,register(guild,fn){assertGuild(guild);refreshers.set(guild,fn);return ()=>{if(refreshers.get(guild)===fn)refreshers.delete(guild);};},async close(){closed=true;core.changed=null;await core.tail;await active;}};
}
