"""Read final actual artifacts and freeze a non-self-referential hash inventory."""
from pathlib import Path
import json,hashlib,struct,io
from PIL import Image
ROOT=Path(__file__).parent
raw=(ROOT/'transfer/representative-weed.glb').read_bytes();g=json.loads(raw[20:20+int.from_bytes(raw[12:16],'little')]);n=int.from_bytes(raw[12:16],'little');binary=raw[28+n:]
images=[]
for im in g['images']:
    view=g['bufferViews'][im['bufferView']];start=view.get('byteOffset',0);image=Image.open(io.BytesIO(binary[start:start+view['byteLength']]));images.append({'mimeType':im['mimeType'],'dimensions':list(image.size),'format':image.format})
check={'embeddedBuffers':all('uri' not in b for b in g['buffers']),'embeddedImages':images,'standardBaseColorAndNormalPresent':any('normalTexture' in m and 'baseColorTexture' in m.get('pbrMetallicRoughness',{}) for m in g['materials']),'noFullValidatorClaim':True}
(ROOT/'transfer/file-structure.json').write_text(json.dumps(check,indent=2)+'\n')
files=[{'name':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(ROOT.rglob('*')) if p.is_file() and p.name!='file-inventory.json']
(ROOT/'file-inventory.json').write_text(json.dumps({'files':files,'scope':'Frozen source evidence inventory; excludes itself'},indent=2)+'\n')
print(json.dumps({'files':len(files),'sourceSha256':hashlib.sha256((ROOT/'source.blend').read_bytes()).hexdigest()}))
