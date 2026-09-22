"""Lighting-only diagnostic: unchanged cycle1 shape under cycle2 key light."""
import bpy
import json
import hashlib
from pathlib import Path
OUT=Path('D:/src/parallax/assets/source/d1-paving/master-2026-09-20/cycle2')
scene=bpy.data.scenes['Paving master 2026-09-20 cycle1']
light=next(o for o in scene.objects if o.type=='LIGHT')
old_energy,old_size,old_path=light.data.energy,light.data.size,scene.render.filepath
path=OUT/'cycle1-under-cycle2-light.png'
assert not path.exists()
try:
    light.data.energy=18
    light.data.size=.55
    scene.render.filepath=str(path)
    bpy.ops.render.render(write_still=True,scene=scene.name)
finally:
    light.data.energy,light.data.size,scene.render.filepath=old_energy,old_size,old_path
receipt={'scope':'Unchanged cycle1 oblique geometry/camera with only key power170 to18W and size0.7 to0.55m. Source file unchanged.',
         'file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size}
(OUT/'comparison-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
result=receipt
