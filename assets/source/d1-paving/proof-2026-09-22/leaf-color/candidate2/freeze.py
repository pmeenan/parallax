"""Inspect the actual GLB and freeze source evidence without rendering or editing art."""
from pathlib import Path
import json, hashlib, struct, io
from PIL import Image

ROOT = Path(__file__).parent
raw = (ROOT / 'transfer/representative-weed.glb').read_bytes()
n = int.from_bytes(raw[12:16], 'little')
g = json.loads(raw[20:20+n])
binary = raw[28+n:]
images = []
for im in g['images']:
    view = g['bufferViews'][im['bufferView']]
    start = view.get('byteOffset', 0)
    image = Image.open(io.BytesIO(binary[start:start+view['byteLength']]))
    images.append({'mimeType': im['mimeType'], 'dimensions': list(image.size), 'format': image.format})
colors = []
formats = {5121: ('B', 1, 255), 5123: ('H', 2, 65535), 5126: ('f', 4, 1)}
for mesh in g['meshes']:
    for primitive in mesh['primitives']:
        attrs = primitive['attributes']
        assert 'COLOR_1' not in attrs
        if 'COLOR_0' not in attrs:
            continue
        a = g['accessors'][attrs['COLOR_0']]
        view = g['bufferViews'][a['bufferView']]
        fmt, size, divisor = formats[a['componentType']]
        channels = {'VEC3': 3, 'VEC4': 4}[a['type']]
        stride = view.get('byteStride', size*channels)
        offset = view.get('byteOffset', 0)+a.get('byteOffset', 0)
        values = [struct.unpack_from('<'+fmt*channels, binary, offset+i*stride) for i in range(a['count'])]
        scale = divisor if a.get('normalized', False) else 1
        rgb = [v/scale for row in values for v in row[:3]]
        assert min(rgb) >= 0 and max(rgb) <= 1
        colors.append({'mesh': mesh.get('name'), 'attribute': 'COLOR_0', 'count': a['count'], 'componentType': a['componentType'], 'normalized': a.get('normalized', False), 'rgbMin': min(rgb), 'rgbMax': max(rgb), 'uniqueColors': len(set(values))})
assert colors
check = {'embeddedBuffers': all('uri' not in b for b in g['buffers']), 'embeddedImages': images, 'vertexColors': colors, 'standardBaseColorAndNormalPresent': any('normalTexture' in m and 'baseColorTexture' in m.get('pbrMetallicRoughness', {}) for m in g['materials']), 'noFullValidatorClaim': True}
(ROOT / 'transfer/file-structure.json').write_text(json.dumps(check, indent=2)+'\n')
files = [{'name': p.relative_to(ROOT).as_posix(), 'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(ROOT.rglob('*')) if p.is_file() and p.name != 'file-inventory.json']
(ROOT / 'file-inventory.json').write_text(json.dumps({'files': files, 'scope': 'Frozen source evidence inventory; excludes itself'}, indent=2)+'\n')
print(json.dumps({'files': len(files), 'sourceSha256': hashlib.sha256((ROOT/'source.blend').read_bytes()).hexdigest(), 'vertexColors': colors}))
