"""Development-only sprite generation. Runtime requires only Node.js."""
from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import json,zlib,base64
root=Path(__file__).resolve().parent.parent
font='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
def f(n):return ImageFont.truetype(font,n)
chunks=[]
def pack(im):
 offset=sum(map(len,chunks));chunks.append(im.tobytes());return {'w':im.width,'h':im.height,'offset':offset}
base=Image.new('RGBA',(800,280),'#121b2a');d=ImageDraw.Draw(base);d.rounded_rectangle((16,16,784,264),24,fill='#19263a',outline='#30435a',width=2)
slots=[]
for symbol,color in [('★','#dfbb64'),('♥','#d9768b'),('♦','#a898e0'),('♣','#6fb8a7'),('♠','#a4bed8'),('7','#f1a76e')]:
 im=Image.new('RGBA',(168,184));p=ImageDraw.Draw(im);p.rounded_rectangle((0,0,167,183),18,fill='#f8f5ed',outline='#ded8c9',width=2);p.text((84,84),symbol,font=f(96),fill=color,anchor='mm');slots.append(pack(im))
dice=[]
patterns=[[(1,1)],[(0,0),(2,2)],[(0,0),(1,1),(2,2)],[(0,0),(2,0),(0,2),(2,2)],[(0,0),(2,0),(1,1),(0,2),(2,2)],[(0,0),(0,1),(0,2),(2,0),(2,1),(2,2)]]
for pattern in patterns:
 im=Image.new('RGBA',(168,184));p=ImageDraw.Draw(im);p.rounded_rectangle((0,0,167,183),18,fill='#f8f5ed',outline='#ded8c9',width=2)
 for x,y in pattern:p.ellipse((42+x*42-9,42+y*50-9,42+x*42+9,42+y*50+9),fill='#394964')
 dice.append(pack(im))
red={1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36}
numbers=[]
for n in range(37):
 im=Image.new('RGBA',(184,184));p=ImageDraw.Draw(im);p.ellipse((0,0,183,183),fill='#448a73' if n==0 else '#b74f68' if n in red else '#293c53',outline='#9ba9bf',width=3);p.text((92,87),str(n),font=f(72),fill='#f8f5ed',anchor='mm');numbers.append(pack(im))
im=Image.new('RGBA',(184,184));p=ImageDraw.Draw(im);p.rounded_rectangle((0,0,183,183),18,fill='#293c53',outline='#4b617e',width=2);p.text((92,87),'?',font=f(72),fill='#a4b3c9',anchor='mm');waiting=pack(im)
art={'slots':slots,'dice':dice,'numbers':numbers,'waiting':waiting,'base':pack(base)};art['pixels']=base64.b64encode(zlib.compress(b''.join(chunks),9)).decode();(root/'assets/casino-art.json').write_text(json.dumps(art,separators=(',',':')))
print((root/'assets/casino-art.json').stat().st_size)
