"""Development-only sprite generation. Runtime requires only Node.js."""
from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import json,zlib,base64
from art_palette import compact_art
root=Path(__file__).resolve().parent.parent
font='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
def f(n):return ImageFont.truetype(font,n)
chunks=[]
def pack(im):
 im=im.resize((round(im.width*0.6),round(im.height*0.6)),Image.Resampling.LANCZOS)
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
art={'slots':slots,'dice':dice,'numbers':numbers,'waiting':waiting,'base':pack(base)}
# Additional vector sprites keep runtime self-contained and deterministic.
def canvas(w,h):return Image.new('RGBA',(w,h))
highlight=canvas(176,192);p=ImageDraw.Draw(highlight);p.rounded_rectangle((1,1,174,190),21,outline='#e6bf68',width=6);art['highlight']=pack(highlight)
cards=[]
for n in range(1,14):
 im=canvas(168,184);p=ImageDraw.Draw(im);p.rounded_rectangle((0,0,167,183),18,fill='#f8f5ed',outline='#d5ccba',width=2)
 rank={1:'A',11:'J',12:'Q',13:'K'}.get(n,str(n));p.text((18,14),rank,font=f(24),fill='#34455d');p.text((84,93),rank,font=f(78),fill='#34455d',anchor='mm');cards.append(pack(im))
art['cards']=cards
hl=base.copy();p=ImageDraw.Draw(hl);p.text((290,29),'PREVIOUS',font=f(15),fill='#9baec7',anchor='mm');p.text((510,29),'CURRENT',font=f(15),fill='#e6bf68',anchor='mm');art['highlowBase']=pack(hl)
hl=base.copy();p=ImageDraw.Draw(hl);p.text((290,29),'CURRENT',font=f(15),fill='#e6bf68',anchor='mm');p.text((510,29),'NEXT',font=f(15),fill='#9baec7',anchor='mm');art['highlowReadyBase']=pack(hl)
# Distinct animal silhouettes, rather than relying on platform emoji fonts.
animals=[]
for i,color in enumerate(['#ddc7e8','#efb785','#f5dd98','#8ec8b5']):
 im=canvas(64,44);p=ImageDraw.Draw(im)
 if i==0:
  p.ellipse((16,0,27,25),fill=color);p.ellipse((37,0,48,25),fill=color);p.ellipse((20,3,23,18),fill='#ac87b6');p.ellipse((41,3,44,18),fill='#ac87b6')
 elif i==1:
  p.polygon([(12,22),(12,0),(30,17)],fill=color);p.polygon([(34,17),(52,0),(52,22)],fill=color)
 elif i==2:
  p.ellipse((23,0,32,13),fill='#cf7181');p.ellipse((31,0,40,13),fill='#cf7181');p.ellipse((39,3,47,15),fill='#cf7181')
 else:
  p.ellipse((0,14,43,41),fill=color);p.ellipse((4,16,37,38),fill='#579482');p.line((13,19,13,36),fill=color,width=2);p.line((26,19,26,36),fill=color,width=2);p.line((5,27,35,27),fill=color,width=2)
 if i!=3:
  p.ellipse((10,12,54,43),fill=color);p.ellipse((21,24,25,28),fill='#26364b');p.ellipse((39,24,43,28),fill='#26364b')
  if i==2:p.polygon([(29,30),(36,30),(32,36)],fill='#d5984d')
  else:p.ellipse((29,31,35,35),fill='#956c84')
 else:p.ellipse((36,18,61,39),fill=color);p.ellipse((49,23,53,27),fill='#26364b')
 animals.append(pack(im))
art['animals']=animals
track=Image.new('RGBA',(800,280),'#121b2a');p=ImageDraw.Draw(track);p.rounded_rectangle((16,16,784,264),24,fill='#19263a',outline='#30435a',width=2)
p.text((60,33),'RACE',font=f(16),fill='#e6bf68');p.text((701,33),'FINISH',font=f(13),fill='#c5d1e2',anchor='mm')
for i in range(4):
 y=52+i*48;p.rounded_rectangle((42,y,755,y+44),9,fill='#22334b' if i%2==0 else '#1d2d43');p.text((65,y+22),str(i+1),font=f(22),fill='#91a4bf',anchor='mm')
 for x in range(704,728,8):
  for yy in range(y+2,y+42,8):p.rectangle((x,yy,x+7,yy+7),fill='#c0cbd9' if (x//8+yy//8)%2==0 else '#3e526d')
art['track']=pack(track)
art['scale']=0.6;art=compact_art(art,chunks);(root/'assets/casino-art.json').write_text(json.dumps(art,separators=(',',':')))
print((root/'assets/casino-art.json').stat().st_size)
