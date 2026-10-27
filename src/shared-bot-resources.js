import {SerialQueue} from './queue.js';
import {processWorkshopImage} from './image-workshop-process.js';
export class SharedBotResourceError extends Error {}
// The gateway serves multiple guilds, but profile writes and native image workers are process resources.
export function createSharedBotResources({convert=processWorkshopImage,now=Date.now}={}){
 let image=false,banner=false,nextImage=0,nextBanner=0;
 return {entryQueue:new SerialQueue(),get imageBusy(){return image;},get busy(){return image||banner;},
  async image(input,options){if(image||now()<nextImage)throw new SharedBotResourceError('別サーバーを含む画像の処理中か、直後です。少し待ってから作成してください。');image=true;nextImage=now()+2000;try{return await convert(input,options);}finally{image=false;}},
  async banner(operation){if(banner||now()<nextBanner)throw new SharedBotResourceError('別サーバーを含むバナーの変更中か、変更直後です。60秒待って現在を確認してください。');banner=true;nextBanner=now()+60000;try{return await operation();}finally{nextBanner=now()+60000;banner=false;}},
 };
}
