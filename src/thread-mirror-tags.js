import {ServerNetworkError,snowflake} from './server-network-store.js';
export const sameMirrorTags=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&new Set(a).size===a.length&&[...a].sort().every((id,n)=>id===[...b].sort()[n]);
export function mirrorTagOrder(source,mapping){const ids=source.appliedTags??[];if(!Array.isArray(ids)||ids.length>5||new Set(ids).size!==ids.length)throw new ServerNetworkError('同期元のタグ数・重複を確認してください。');const order=ids.map(id=>{if(!snowflake(id)||!snowflake(mapping[id]))throw new ServerNetworkError('タグの対応が変更されました。');return mapping[id];});if(new Set(order).size!==order.length)throw new ServerNetworkError('タグの対応が重複しています。');return order;}
export const mirrorTagStages=order=>order.length?order.toReversed().map((_,n)=>order.toReversed().slice(0,n+1)):[[]];
export const validMirrorTagOrder=order=>Array.isArray(order)&&order.length<=5&&new Set(order).size===order.length&&order.every(snowflake);
export const validMirrorTagIntent=op=>validMirrorTagOrder(op.tagOrder)&&validMirrorTagOrder(op.tags)&&mirrorTagStages(op.tagOrder).some(stage=>JSON.stringify(stage)===JSON.stringify(op.tags));
