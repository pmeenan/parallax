"""Mechanical review sheets and non-self-referential artifact hash inventory."""
from pathlib import Path
from PIL import Image,ImageDraw
import json,hashlib
ROOT=Path(__file__).parent
results=json.loads((ROOT/'results.json').read_text())
for member in results['members']:
    folder=ROOT/member['member'].lower()
    member['files']=[{'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(folder.iterdir()) if p.name!='verification.json']
    (folder/'verification.json').write_text(json.dumps(member,indent=2)+'\n')
    sheet=Image.new('RGB',(1600,1260),(24,24,24));draw=ImageDraw.Draw(sheet)
    captures=['high-source.png','native-low.png','high-source-opposing.png','reimport-opposing.png']
    for i,name in enumerate(captures):
        x=(i%2)*800;y=(i//2)*630
        draw.text((x+10,y+8),member['member']+' '+name,fill='white')
        sheet.paste(Image.open(folder/name).convert('RGB').resize((800,600),Image.Resampling.LANCZOS),(x,y+30))
    sheet.save(ROOT/(member['member'].lower()+'-comparison.png'))
(ROOT/'results.json').write_text(json.dumps(results,indent=2)+'\n')
files=[{'name':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(ROOT.rglob('*')) if p.is_file() and p.name!='file-inventory.json']
(ROOT/'file-inventory.json').write_text(json.dumps({'files':files,'method':'SHA256; inventory excludes itself. Review sheets are mechanical resize and labels only.'},indent=2)+'\n')
