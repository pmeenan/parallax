"""Inspect final vertex-color GLB, assemble unaltered render thumbnails, freeze hashes."""
from pathlib import Path
import json,hashlib,struct
from PIL import Image,ImageDraw
P=Path(__file__).parent;raw=(P/'transfer/representative-moss.glb').read_bytes();n=int.from_bytes(raw[12:16],'little');g=json.loads(raw[20:20+n]);binary=raw[28+n:];colors=[]
for mesh in g['meshes']:
    for p in mesh['primitives']:
        assert 'COLOR_0' in p['attributes'] and 'COLOR_1' not in p['attributes']
        a=g['accessors'][p['attributes']['COLOR_0']];v=g['bufferViews'][a['bufferView']];fmt,size,div={5123:('H',2,65535),5121:('B',1,255),5126:('f',4,1)}[a['componentType']];channels={'VEC3':3,'VEC4':4}[a['type']];stride=v.get('byteStride',channels*size);offset=v.get('byteOffset',0)+a.get('byteOffset',0)
        values=[struct.unpack_from('<'+fmt*channels,binary,offset+i*stride) for i in range(a['count'])];scale=div if a.get('normalized') else 1;rgb=[x/scale for row in values for x in row[:3]]
        colors.append({'attribute':'COLOR_0','count':a['count'],'uniqueColors':len(set(values)),'componentType':a['componentType'],'normalized':a.get('normalized',False),'rgbMin':min(rgb),'rgbMax':max(rgb)})
check={'vertexColors':colors,'embeddedBuffers':all('uri' not in b for b in g['buffers']),'images':len(g.get('images',[])),'textures':len(g.get('textures',[])),'noFullValidatorClaim':True}
(P/'transfer/file-structure.json').write_text(json.dumps(check,indent=2)+'\n')
out=Image.new('RGB',(1500,1230),(32,32,32));d=ImageDraw.Draw(out)
for i,name in enumerate(['close','close-opposing','close-unlit','close-gray','walking','overview','transfer/native','transfer/reimport']):
    im=Image.open(P/(name+'.png')).convert('RGB');im.thumbnail((500,375));x=i%3*500;y=i//3*410;out.paste(im,(x,y+24));d.text((x+8,y+6),name,fill='white')
out.save(P/'contact-sheet.jpg',quality=92)
files=[{'name':f.relative_to(P).as_posix(),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(P.rglob('*')) if f.is_file() and f.name!='file-inventory.json']
(P/'file-inventory.json').write_text(json.dumps({'files':files,'scope':'Final bounded source evidence; excludes itself'},indent=2)+'\n');print(json.dumps({'files':len(files),'sourceSha256':hashlib.sha256((P/'source.blend').read_bytes()).hexdigest(),'check':check}))
