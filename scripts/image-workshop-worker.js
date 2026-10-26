import sharp from 'sharp';
import {workshopImageInfo,imageWorkshopPixels} from '../src/image-workshop-input.js';
import {workshopPresets,workshopOptions} from '../src/image-workshop-options.js';
sharp.cache(false);sharp.concurrency(1);
const chunks=[];let size=0;
try{
  for await(const chunk of process.stdin){size+=chunk.length;if(size>4*1024*1024+256)throw new Error('input limit');chunks.push(chunk);}
  const data=Buffer.concat(chunks),end=data.indexOf(10);if(end<1||end>255)throw new Error('invalid header');
  const {preset,crop}=JSON.parse(data.subarray(0,end).toString('utf8'));if(!workshopOptions(preset,crop))throw new Error('invalid options');
  const image=data.subarray(end+1),inputInfo=workshopImageInfo(image),p=workshopPresets[preset];let output;
  const pipeline=()=>sharp(image,{limitInputPixels:imageWorkshopPixels,failOn:'warning',sequentialRead:true,animated:false}).rotate().toColourspace('srgb');
  if(p.format==='png')output=await pipeline().resize(p.size,p.size,{fit:crop==='contain'?'contain':'cover',position:crop==='contain'?'centre':crop,background:{r:0,g:0,b:0,alpha:0}}).png({compressionLevel:9,bitdepth:8}).toBuffer({resolveWithObject:true});
  else{
    for(const [side,quality] of [[1024,85],[1024,70],[1024,55],[768,60],[512,55]]){
      const target=crop==='contain'?side:Math.min(side,inputInfo.width,inputInfo.height);
      output=await pipeline().resize(target,target,{fit:crop==='contain'?'inside':'cover',position:crop==='contain'?'centre':crop,withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality,mozjpeg:true}).toBuffer({resolveWithObject:true});
      if(output.data.length<=p.maxBytes)break;
    }
  }
  if(!output||output.data.length>p.maxBytes)throw new Error('output limit');
  const header=Buffer.from(JSON.stringify({width:output.info.width,height:output.info.height,format:p.format})+'\n');process.stdout.write(header);process.stdout.write(output.data);
}catch{process.exitCode=1;}
