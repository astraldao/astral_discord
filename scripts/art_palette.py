"""Development-only indexed sprite packing; Pillow and NumPy are not runtime dependencies."""
import base64,zlib
from PIL import Image
import numpy as np

def compact_art(art,chunks):
 raw=np.frombuffer(b''.join(chunks),dtype=np.uint8).reshape(-1,4)
 # Samples are deterministic and bounded; preserve transparent edges separately.
 colors=raw[:,0:3];sample=colors[::max(1,len(colors)//150000)]
 sample=sample[:len(sample)//256*256].reshape(-1,256,3)
 image=Image.fromarray(sample,'RGB').quantize(colors=128,method=Image.Quantize.MEDIANCUT)
 palette=np.array(image.getpalette()[:384],dtype=np.int32).reshape(-1,3)
 keys=np.arange(32768,dtype=np.int32)
 rgb=np.stack([(keys>>10)*8+4,((keys>>5)&31)*8+4,(keys&31)*8+4],axis=1)
 lut=np.empty(32768,dtype=np.uint8)
 for start in range(0,32768,512):
  diff=rgb[start:start+512,None,:]-palette[None,:,:]
  lut[start:start+512]=np.sum(diff*diff,axis=2).argmin(axis=1)
 key=((colors[:,0].astype(np.int32)>>3)<<10)|((colors[:,1].astype(np.int32)>>3)<<5)|(colors[:,2]>>3)
 packed=np.stack([lut[key],raw[:,3]],axis=1).astype(np.uint8).tobytes()
 def offsets(value):
  if isinstance(value,dict):
   if 'offset' in value:value['offset']//=2
   for v in value.values():offsets(v)
  elif isinstance(value,list):
   for v in value:offsets(v)
 offsets(art)
 art['encoding']='indexed-alpha';art['palette']=base64.b64encode(palette.astype(np.uint8).tobytes()).decode()
 art['lookup']=base64.b64encode(zlib.compress(lut.tobytes(),9)).decode()
 art['pixels']=base64.b64encode(zlib.compress(packed,9)).decode()
 return art
