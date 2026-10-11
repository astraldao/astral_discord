"""Build compact RGBA sprites. Development only: Python + Pillow; runtime uses Node."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import json,zlib,base64
ROOT=Path(__file__).resolve().parent.parent
font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
bold='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
def f(n,b=False):return ImageFont.truetype(bold if b else font,n)
chunks=[]
def pack(im):
 offset=sum(len(c) for c in chunks);chunks.append(im.tobytes());return {'w':im.width,'h':im.height,'offset':offset}
base=Image.new('RGBA',(800,440),'#121b2a');d=ImageDraw.Draw(base)
d.rounded_rectangle((16,16,784,424),radius=24,fill='#19263a',outline='#30435a',width=2)
for y,label in [(38,'DEALER'),(246,'YOU')]:
 d.text((40,y),label,font=f(17,True),fill='#afbdd1')
d.line((40,223,760,223),fill='#30435a',width=1)
cards=[]
for suit in ['♠','♥','♦','♣']:
 for rank in ['A','2','3','4','5','6','7','8','9','10','J','Q','K']:
  im=Image.new('RGBA',(84,132));p=ImageDraw.Draw(im);p.rounded_rectangle((0,0,83,131),radius=10,fill='#f8f5ed',outline='#ddd9cd',width=1)
  color='#c25164' if suit in ['♥','♦'] else '#24334b'
  p.text((9,7),rank,font=f(23,True),fill=color);p.text((11,36),suit,font=f(18),fill=color)
  p.text((42,80),suit,font=f(40),fill=color,anchor='mm');cards.append(pack(im))
im=Image.new('RGBA',(84,132));p=ImageDraw.Draw(im);p.rounded_rectangle((0,0,83,131),radius=10,fill='#6161a8',outline='#9898d0',width=2);p.rounded_rectangle((8,8,75,123),radius=6,outline='#b1b0dd',width=1)
for y in range(26,115,20):
 for x in range(22,70,20):p.polygon([(x,y-5),(x+5,y),(x,y+5),(x-5,y)],fill='#9392ca')
cards.append(pack(im))
scores=[]
for n in range(32):
 im=Image.new('RGBA',(100,66));p=ImageDraw.Draw(im);p.rounded_rectangle((0,0,99,65),radius=16,fill='#253a50');p.text((50,30),str(n),font=f(32,True),fill='#e7edf5',anchor='mm');scores.append(pack(im))
im=Image.new('RGBA',(100,66));p=ImageDraw.Draw(im);p.rounded_rectangle((0,0,99,65),radius=16,fill='#253a50');p.text((50,30),'?',font=f(32,True),fill='#a5b5c8',anchor='mm');scores.append(pack(im))
art={'base':pack(base),'cards':cards,'scores':scores};art['pixels']=base64.b64encode(zlib.compress(b''.join(chunks),9)).decode();(ROOT/'assets/blackjack-art.json').write_text(json.dumps(art,separators=(',',':')))
print((ROOT/'assets/blackjack-art.json').stat().st_size)
