import {AttachmentBuilder,MessageFlags} from 'discord.js';
const snowflake=n=>typeof n==='string'&&/^\d{17,20}$/.test(n);
const attachment=(message,name)=>[...(message?.attachments?.values?.()??[])].find(a=>a.name===name&&snowflake(a.id));
export function gameImage(message,{name,description,render,retained}){
  message.embeds[0].setImage(`attachment://${name}`);
  if(retained){message.attachments=[{id:retained.id,filename:name,description}];}
  else{message.attachments=[];message.files=[new AttachmentBuilder(render(),{name,description})];}
  return message;
}
// Retain only the last confirmed image on this owner's private message. No PNG cache.
export async function editGameImage(i,s,{key,name,build,reuse=false}){
  const previous=s.gameImage,existing=attachment(i.message,name);
  const retained=reuse&&i.message?.flags?.has(MessageFlags.Ephemeral)&&previous?.key===key&&previous.messageId===i.message.id&&previous.name===name&&existing?.id===previous.attachmentId?existing:undefined;
  const payload=build(retained),reply=await i.editReply(payload),saved=attachment(reply,name);
  if(key&&saved&&snowflake(reply.id))s.gameImage={key,name,messageId:reply.id,attachmentId:saved.id};
  else if(!payload.embeds[0]?.data.image)delete s.gameImage;
  return reply;
}
export const blackjackImageKey=g=>g.phase==='ready'?null:JSON.stringify(['blackjack',g.phase==='playing',g.player,g.phase==='playing'?[g.dealer[0]]:g.dealer]);
export const casinoImageKey=s=>JSON.stringify([s.kind,s.results[s.kind]?.values??null,s.kind==='highlow'?s.card:null]);
