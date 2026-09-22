"""Direct native captures of cycle2; run after build in its live namespace."""
import hashlib
import bpy
import json
from pathlib import Path
from mathutils import Vector
from datetime import datetime, timezone
OUT=Path('D:/src/parallax/assets/source/d1-paving/master-2026-09-20/cycle2')
scene=bpy.data.scenes['Paving master 2026-09-20 cycle2']
camera=scene.camera
camdata=camera.data
VIEWS=[('oblique',(.53,-.62,.48),(0,0,.035),'PERSP',55),
       ('reverse',(-.55,.58,.43),(0,0,.04),'PERSP',55),
       ('top',(0,0,.9),(0,0,0),'ORTHO',.55),
       ('grazing',(.40,-.65,.145),(0,0,.04),'PERSP',55),
       ('walking-scale',(0,-.68,1.65),(0,.04,0),'PERSP',45)]
def progress(message):
    with (OUT/'construction.log').open('a',encoding='utf-8') as handle:
        handle.write(datetime.now(timezone.utc).isoformat()+' '+message+'\n')
def set_view(view):
    name,location,target,kind,lens=view
    camera.location=location
    camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
    camdata.type=kind
    if kind=='ORTHO':camdata.ortho_scale=lens
    else:camdata.lens=lens
    scene.render.filepath=str(OUT/(name+'.png'))

for view in VIEWS:
    set_view(view)
    progress('Rendering '+view[0])
    bpy.ops.render.render(write_still=True,scene=scene.name)
    progress('Rendered '+view[0])
set_view(VIEWS[0])
receipt={
    'finishedUtc':datetime.now(timezone.utc).isoformat(),
    'capture':'Direct Blender Cycles PNG; no crop, paintover, texture or bump.',
    'cameras':[{'name':v[0],'location':v[1],'target':v[2],'type':v[3],'lensOrOrtho':v[4]} for v in VIEWS],
    'files':[]
}
for file in sorted(OUT.iterdir()):
    if file.suffix in {'.png','.blend','.json'}:
        receipt['files'].append({'name':file.name,'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
result={'capturesComplete':True,'output':str(OUT)}
