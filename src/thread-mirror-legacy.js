export const legacyThreadName=t=>`${String(t.name).slice(0,76).replace(/[\uD800-\uDBFF]$/u,'')} · ${t.id}`.slice(0,100);
const values=x=>[...(x?.values?.()??[])];
export function legacyMirrorPost(message){
 const author=message.member?.displayName??message.author?.globalName??message.author?.username??'投稿者';
 const content=typeof message.content==='string'?message.content:'';
 const embeds=[{author:{name:String(author).slice(0,256)},description:`[元の投稿](https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id})`,footer:{text:`astral-sync:${message.id}`},...(message.createdTimestamp?{timestamp:new Date(message.createdTimestamp).toISOString()}:{})}];
 const attachments=values(message.attachments).slice(0,10).map((a,n)=>({name:`添付 ${n+1}`,value:typeof a.url==='string'&&/^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\//.test(a.url)&&a.url.length<900?`[${String(a.name??'ファイル').replace(/[\[\]@]/g,'').slice(0,60)}](${a.url})`:'元の投稿から確認してください。'}));
 const sourceEmbeds=(message.embeds??[]).slice(0,5).map(e=>[e.title,e.description].filter(Boolean).join('\n')).filter(Boolean).join('\n\n');
 if(sourceEmbeds)embeds[0].description+='\n\n'+sourceEmbeds.slice(0,3500);
 if(attachments.length){let budget=5500-embeds[0].description.length-String(author).length;embeds[0].fields=attachments.map(a=>{if(a.name.length+a.value.length>budget)a.value='元の投稿から確認してください。';budget-=a.name.length+a.value.length;return a;});}
 if(!content&&!sourceEmbeds&&!attachments.length)embeds[0].description+='\n本文なし（スタンプ等は元の投稿で確認）';
 return {content:content||null,embeds,allowedMentions:{parse:[],repliedUser:false},components:[]};
}
