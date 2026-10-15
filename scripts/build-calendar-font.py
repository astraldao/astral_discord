"""Build a Japanese glyph atlas. Only development needs Pillow and the source font.

Source: Noto Sans CJK JP (SIL Open Font License, assets/calendar-font-LICENSE.txt).
JIS X 0208 covers common Japanese; unsupported symbols use a visible replacement.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import argparse,json,zlib,base64
root=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser()
parser.add_argument('--font',default='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
font=parser.parse_args().font
characters=set(chr(n) for n in range(32,127))|set('…□年月日月火水木金土件予定選択日本時間終')
for first in range(0xa1,0xf5):
 for second in range(0xa1,0xff):
  try: characters.add(bytes([first,second]).decode('euc_jp'))
  except UnicodeDecodeError: pass
glyphs={};chunks=bytearray()
for size in [20,28]:
 f=ImageFont.truetype(font,size)
 for ch in sorted(characters if size==20 else set('0123456789年月')):
  box=f.getbbox(ch);w=max(1,box[2]-box[0]);h=max(1,box[3]-box[1]);im=Image.new('L',(w,h));ImageDraw.Draw(im).text((-box[0],-box[1]),ch,font=f,fill=255)
  data=bytes(round(v/85) for v in im.tobytes());glyphs[f'{size}:{ch}']={'w':w,'h':h,'x':box[0],'y':box[1],'advance':round(f.getlength(ch)),'offset':len(chunks)};chunks.extend(data)
asset={'format':'alpha-four','font':'ASTRAL Calendar JP','source':'Noto Sans CJK JP','glyphs':glyphs,'pixels':base64.b64encode(zlib.compress(chunks,9)).decode()}
(root/'assets/calendar-font.json').write_text(json.dumps(asset,separators=(',',':'))+'\n')
