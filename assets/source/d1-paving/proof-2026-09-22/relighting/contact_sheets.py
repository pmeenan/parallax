"""Mechanical contact-sheet composition of unedited native renders; no paintover."""
from pathlib import Path
from PIL import Image,ImageDraw
import hashlib,json
ROOT=Path(__file__).parent
outputs=[]
for camera in ['close','walking']:
    sheet=Image.new('RGB',(1600,1014),(25,25,25));draw=ImageDraw.Draw(sheet)
    draw.text((12,10),f'{camera}: full cardinal lights / gray cardinal controls / full diagonal lights; all same exposure',fill='white')
    rows=[('full',[0,90,180,270]),('gray',[0,90,180,270]),('full',[45,135,225,315])]
    for row,(mode,angles) in enumerate(rows):
        for col,angle in enumerate(angles):
            p=ROOT/f'{camera}-{mode}-{angle:03d}.png'
            im=Image.open(p).convert('RGB');im.thumbnail((400,300),Image.Resampling.LANCZOS)
            x,y=col*400,40+row*324
            draw.text((x+8,y),f'{mode} {angle:03d} degrees',fill='white')
            sheet.paste(im,(x,y+22))
    p=ROOT/f'{camera}-sheet.png';sheet.save(p)
    outputs.append({'name':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size})
frames=[Image.open(ROOT/f'close-full-{angle:03d}.png').convert('RGB').resize((800,600),Image.Resampling.LANCZOS) for angle in range(0,360,45)]
p=ROOT/'close-light-orbit.gif'
frames[0].save(p,save_all=True,append_images=frames[1:],duration=550,loop=0)
outputs.append({'name':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size})
(ROOT/'sheets.json').write_text(json.dumps({'method':'Pillow12.3 contact-sheet resize/labels and GIF resized sequential frames only; GIF palette quantization; individual native frames unchanged','files':outputs},indent=2)+'\n')
