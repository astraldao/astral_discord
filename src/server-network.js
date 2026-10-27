import {ServerNetworkStore,ServerNetworkError} from './server-network-store.js';
import {networkAuthority} from './server-network-access.js';
import {createServerCopier} from './server-copy.js';
import {createThreadMirror} from './thread-mirror.js';
import {createServerNetworkUI} from './server-network-ui.js';
export async function createServerNetwork({client,primary,ensureRuntime,activity,enabled=()=>true,path='data/server-network.json'}){
 const store=await new ServerNetworkStore(path,primary).load();await store.recover();
 const authority=(user,target=store.get().sub)=>networkAuthority(client,primary,target,user);
 const copier=createServerCopier({store,authority,activity}),mirror=createThreadMirror({client,store,authority,activity,enabled});
 const ui=createServerNetworkUI({client,store,authority,ensureRuntime,copier,mirror});
 return {store,ui,copier,mirror,get busy(){return copier.busy||mirror.busy;},start:()=>Promise.all(store.get().links.filter(l=>l.state==='active').map(l=>mirror.catchup(l.id))),ids:()=>[primary,...(store.get().sub?[store.get().sub]:[])],freeze(){copier.close();},async drain(){await mirror.close();await store.tail;}};
}
