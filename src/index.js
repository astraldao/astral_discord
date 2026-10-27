import {Client,REST,Routes,GatewayIntentBits,Partials} from 'discord.js';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {RuntimeEnvStore} from './runtime-env.js';
import {createUpdateClient} from './update-client.js';
import {createResourcePresence,updateProfileVersion} from './resource-presence.js';
import {createVoiceBenchmark} from './voice-benchmark.js';
import {createBeatApiDiceJudge} from './beatapi-dice.js';
import {configureDiceContent} from './chat-dice.js';
import {createUpdateLifecycle} from './update-lifecycle.js';
import {createSharedBotResources} from './shared-bot-resources.js';
import {createGuildRuntime} from './guild-runtime.js';
import {createServerNetwork} from './server-network.js';
import {networkGuildRoot} from './server-network-access.js';
import {ServerNetworkError} from './server-network-store.js';
import {setBotIconProvider} from './ui.js';
const env=process.env;
if(!/^\d{17,20}$/.test(env.GUILD_ID||''))throw new Error('GUILD_IDにDiscordサーバーのIDを設定してください。');
if(!env.DISCORD_TOKEN||env.DISCORD_TOKEN.startsWith('put_'))throw new Error('DISCORD_TOKENを設定してください。');
const runtimeEnv=await new RuntimeEnvStore('data/runtime-env.json',{base:env}).load();runtimeEnv.apply(env);
const client=new Client({rest:{retries:0,timeout:15000},intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates,GatewayIntentBits.GuildMessages,...(env.ASTRAL_BACKUP_TTS==='1'?[GatewayIntentBits.MessageContent]:[])],partials:[Partials.Message,Partials.Channel],presence:{status:env.ASTRAL_UPDATING==='1'||env.ASTRAL_RESTARTING==='1'?'dnd':'idle'}});
const botVersion=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version;
const resourcePresence=createResourcePresence(client,{version:botVersion,updating:env.ASTRAL_UPDATING==='1',restarting:env.ASTRAL_RESTARTING==='1'});
setBotIconProvider(()=>client.user?.displayAvatarURL({extension:'png',size:64}));
const updateClient=createUpdateClient({version:botVersion}),runtimes=new Map(),loading=new Map();let network,ready=false,stopping=false;
const sharedResources=createSharedBotResources();
const readingActive=()=>[...runtimes.values()].some(r=>r.readingActive());
const voiceBusy=()=>sharedResources.imageBusy||[...runtimes.values()].some(r=>r.voiceBusy());
const globalBusy=()=>network?.busy||sharedResources.busy||[...runtimes.values()].some(r=>r.busy())||resourcePresence.activeCount>1;
const voiceProbe=createVoiceBenchmark({version:botVersion,onDiagnostic:info=>console.warn('速度測定の操作:',`v${botVersion}`,JSON.stringify(info)),canStart:()=>{if(globalBusy()||voiceBusy())throw new ServerNetworkError('別サーバーを含む操作が進行中です。完了後に測定してください。');},activity:()=>resourcePresence.activity()});
const diceJudge=createBeatApiDiceJudge({apiKey:env.BEATAPI_API_KEY,model:env.BEATAPI_JEV_MODEL||'jev-1.14-free',paidFallback:env.BEATAPI_JEV_PAID_FALLBACK!=='0'});
async function ensureRuntime(id){
 if(stopping||!network.ids().includes(id))throw new ServerNetworkError('連携先が登録されていません。');
 if(runtimes.has(id))return runtimes.get(id);if(loading.has(id))return loading.get(id);
 const promise=(async()=>{const guild=await client.guilds.fetch(id);const r=await createGuildRuntime({client,guild,root:networkGuildRoot(env.GUILD_ID,id),env,runtimeEnv,resourcePresence,updateClient,diceJudge,voiceProbe,botVersion,network,globalBusy,voiceBusy,readingActive,sharedResources});if(stopping){r.freeze();await r.drain();throw new ServerNetworkError('Botを終了しています。');}runtimes.set(id,r);if(ready)r.activate();return r;})();
 loading.set(id,promise);try{return await promise;}finally{loading.delete(id);}
}
client.once('clientReady',async()=>{try{
 network=await createServerNetwork({client,primary:env.GUILD_ID,ensureRuntime,onDiagnostic:info=>console.warn('サーバー連携:',`v${botVersion}`,JSON.stringify(info)),activity:()=>resourcePresence.activity(),enabled:()=>ready&&!stopping&&client.options.intents.has(GatewayIntentBits.MessageContent)});
 for(const id of network.ids()){try{await ensureRuntime(id);}catch(e){if(id===env.GUILD_ID)throw e;console.warn('サブサーバーの初期化を確認してください:',e.code??e.name);}}
 resourcePresence.start();void resourcePresence.track(()=>updateProfileVersion(client.application,botVersion)).catch(()=>console.warn('プロフィール更新を確認してください。'));
 ready=env.ASTRAL_SUPERVISED!=='1';if(ready){for(const r of runtimes.values())r.activate();void network.start().catch(()=>{});}
 console.log(`準備完了: ${client.user.tag} / v${botVersion} / ${runtimes.size}サーバー`);
 for(const r of runtimes.values())await r.refresh().catch(()=>console.warn('設置済みパネルの権限と投稿を確認してください。'));
 if(process.connected)process.send({type:'worker-ready'});
 }catch(e){console.error('初期設定:',e.code??e.name);resourcePresence.stop();client.destroy();process.exitCode=1;}});
client.on('interactionCreate',async i=>{if(!ready||stopping||!runtimes.has(i.guildId))return;await runtimes.get(i.guildId).interaction(i);});
const route=(id,method,...args)=>runtimes.get(id)?.[method](...args);
const safely=promise=>{void Promise.resolve(promise).catch(()=>{});};
client.on('messageCreate',m=>{if(ready&&!stopping){route(m.guildId,'message',m);safely(network.mirror.message(m));}});
client.on('messageUpdate',(_before,after)=>{if(ready&&!stopping)safely(network.mirror.message(after));});
client.on('messageDelete',m=>{if(ready&&!stopping)safely(network.mirror.remove(m));});
client.on('messageDeleteBulk',messages=>{if(ready&&!stopping)for(const m of messages.values())safely(network.mirror.remove(m));});
client.on('threadCreate',t=>{if(ready&&!stopping)safely(network.mirror.thread(t));});
client.on('threadUpdate',(_before,t)=>{if(ready&&!stopping)safely(network.mirror.thread(t));});
client.on('threadDelete',t=>{if(ready&&!stopping)safely(network.mirror.thread(t,true));});
client.on('channelUpdate',(_before,c)=>route(c.guildId,'revalidate'));
client.on('channelDelete',c=>{route(c.guildId,'channelDelete',c);if(ready&&!stopping)safely(network.mirror.channelDelete(c));});
client.on('guildMemberUpdate',(_before,m)=>route(m.guild.id,'revalidate'));
client.on('roleUpdate',(_before,r)=>route(r.guild.id,'revalidate'));
client.on('roleDelete',r=>route(r.guild.id,'revalidate'));
client.on('voiceStateUpdate',(before,after)=>route(after.guild.id,'voice',before,after));
client.on('error',e=>console.error('Discord接続:',e.code??e.name));
function freeze(){stopping=true;ready=false;resourcePresence.stop();voiceProbe.close();network?.freeze();for(const r of runtimes.values())r.freeze();}
async function drain(){await Promise.allSettled(loading.values());await network?.drain();await Promise.all([...runtimes.values()].map(r=>r.drain()));await runtimeEnv.tail;updateClient.close();await client.destroy();}
if(env.ASTRAL_SUPERVISED==='1'&&process.connected){const lifecycle=createUpdateLifecycle({snapshot:()=>runtimeEnv.snapshot().running,accept:m=>m.runtimeRevision===undefined||m.runtimeRevision===runtimeEnv.snapshot().revision,busy:()=>!!network?.busy||resourcePresence.activeCount>0||[...runtimes.values()].some(r=>r.busy()),freeze,drain,send:(m,done)=>process.send(m,done??(()=>{})),exit:code=>process.exit(code)});
 process.on('message',m=>{if(m?.type==='update-presence'){resourcePresence.setUpdating(m.updating);resourcePresence.setRestarting(!!m.restarting);return;}if(m?.type==='activate'&&!stopping){ready=true;for(const r of runtimes.values())r.activate();void network?.start().catch(()=>{});}else void lifecycle(m);});}
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{freeze();const force=setTimeout(()=>process.exit(0),12000);force.unref();void(async()=>{while(resourcePresence.activeCount>0)await delay(50);await drain();process.exit(0);})().catch(()=>process.exit(1));});
const fullDiceContent=await configureDiceContent(client,()=>new REST({timeout:3000,retries:0}).setToken(env.DISCORD_TOKEN).get(Routes.oauth2CurrentApplication()));
if(!fullDiceContent)console.info('通常投稿のダイス返信・スレッド同期にはMessage Content Intentを有効化して再起動してください。');
client.login(env.DISCORD_TOKEN).catch(e=>{console.error('ログイン:',e.code??e.name);process.exitCode=1;});
