import {networkRead} from './server-network-fault.js';
import {PermissionFlagsBits as P} from 'discord.js';
import {ServerNetworkError,snowflake} from './server-network-store.js';
export async function networkAuthority(client,primary,target,user){
 if(!snowflake(primary)||!snowflake(target)||primary===target||!snowflake(user))throw new ServerNetworkError('異なる2つのサーバーIDを指定してください。');
 const [source,sub]=await Promise.all([networkRead('main-guild',()=>client.guilds.fetch(primary)),networkRead('sub-guild',()=>client.guilds.fetch(target))]);
 await Promise.all([['main',source],['sub',sub]].map(async([side,guild])=>{const [member,bot]=await Promise.all([networkRead(`${side}-member`,()=>guild.members.fetch({user,force:true})),networkRead(`${side}-bot`,()=>guild.members.fetchMe({force:true}))]);if(member.user?.bot||member.pending||!member.permissions.has(P.Administrator)||!bot.permissions.has(P.Administrator))throw new ServerNetworkError('両サーバーで、実行者とBotの管理者権限が必要です。');}));
 return {source,target:sub};
}
export const networkGuildRoot=(primary,id)=>{if(!snowflake(primary)||!snowflake(id))throw new ServerNetworkError('サーバーIDを確認してください。');return primary===id?'data':`data/guilds/${id}`;};

export async function globalNetworkAdmin(client,primary,guild,i){
 try{const member=await guild.members.fetch({user:i.user.id,force:true}),channel=await guild.channels.fetch(i.channelId,{force:true});
 if(!member.permissions.has(P.Administrator)||!channel?.permissionsFor(member)?.has(P.ViewChannel))throw new ServerNetworkError('現在の管理者・閲覧権限が必要です。');
 if(guild.id!==primary){const main=await client.guilds.fetch(primary),admin=await main.members.fetch({user:i.user.id,force:true});if(!admin.permissions.has(P.Administrator))throw new ServerNetworkError('Bot全体の変更・測定にはメイン側の管理者権限も必要です。');}
 return true;}catch(e){if(e instanceof ServerNetworkError)throw e;throw new ServerNetworkError('共通設定の権限を確認できませんでした。');}
}
