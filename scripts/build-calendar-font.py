"""Build a small Latin glyph atlas; development only, no font/Python needed by the bot."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json,zlib,base64
root=Path(__file__).resolve().parent.parent
font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
glyphs={};chunks=bytearray()
for size in [16,22,28]:
 f=ImageFont.truetype(font,size)
 for code in range(32,127):
  ch=chr(code);box=f.getbbox(ch);w=max(1,box[2]-box[0]);h=max(1,box[3]-box[1]);im=Image.new('L',(w,h));ImageDraw.Draw(im).text((-box[0],-box[1]),ch,font=f,fill=255)
  data=bytes(round(v/85) for v in im.tobytes());glyphs[f'{size}:{ch}']={'w':w,'h':h,'x':box[0],'y':box[1],'advance':round(f.getlength(ch)),'offset':len(chunks)};chunks.extend(data)
asset={'format':'alpha-four','font':'DejaVu Sans','glyphs':glyphs,'pixels':base64.b64encode(zlib.compress(chunks,9)).decode()}
(root/'assets/calendar-font.json').write_text(json.dumps(asset,separators=(',',':'))+'\n')
