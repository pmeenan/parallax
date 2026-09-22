"""Fixed native inspection views; no image postprocessing."""
import bpy
import json
import hashlib
from pathlib import Path
from mathutils import Vector
from datetime import datetime, timezone

CYCLE=101
ROOT=Path('D:/src/parallax/assets/source/d1-paving/surface-study-2026-09-21')
OUT=Path('D:/src/parallax/assets/source/d1-paving/proof-2026-09-21/stone/candidate1')
scene=bpy.data.scenes['Paving proof stone candidate1']
bpy.context.window.scene=scene
stone=next(o for o in scene.objects if o.type=='MESH' and o.name.startswith('Paving proof stone candidate1 master'))
ground=next(o for o in scene.objects if o.name.startswith('Neutral support'))
light=next(o for o in scene.objects if o.type=='LIGHT')
camera=scene.camera
ground.location.z=min(v.co.z for v in stone.data.vertices)+.003
scene.render.resolution_x=1600;scene.render.resolution_y=1200;scene.cycles.samples=128
material=stone.data.materials[0]
gray=bpy.data.materials.new(f'Diagnostic gray cycle{CYCLE}');gray.use_nodes=True
gray.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.28,.28,.28,1)
gray.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.8
unlit=material.copy();unlit.name=f'Unlit reflectance diagnostic cycle{CYCLE}'
un=unlit.node_tree.nodes;ul=unlit.node_tree.links
emission=un.new('ShaderNodeEmission')
ul.new(un.get('Principled BSDF').inputs['Base Color'].links[0].from_socket,emission.inputs['Color'])
ul.new(emission.outputs[0],un.get('Material Output').inputs['Surface'])
views=[
 ('oblique',(.51,-.59,.48),(0,0,.035),(-.6,-.5,.9),False),
 ('reverse-light',(.51,-.59,.48),(0,0,.035),(.6,.5,.9),False),
 ('reverse-view',(-.51,.59,.43),(0,0,.035),(-.6,-.5,.9),False),
 ('grazing',(.44,-.58,.18),(0,0,.035),(-.65,-.2,.22),False),
 ('gray',(.51,-.59,.48),(0,0,.035),(-.6,-.5,.9),True),
 ('walking',(0,-.65,1.65),(0,0,.02),(-.6,-.5,.9),False),
 ('basecolor-unlit',(.51,-.59,.48),(0,0,.035),(-.6,-.5,.9),'UNLIT'),
]
for name,eye,target,key,plain in views:
    camera.location=eye;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.lens=45 if name=='walking' else 55
    light.location=key;light.rotation_euler=(Vector((0,0,.03))-light.location).to_track_quat('-Z','Y').to_euler()
    light.data.energy=12 if name=='grazing' else 45
    light.data.size=.35 if name=='grazing' else .65
    stone.data.materials[0]=unlit if plain=='UNLIT' else gray if plain else material
    scene.render.filepath=str(OUT/(name+'.png'))
    bpy.ops.render.render(write_still=True)
stone.data.materials[0]=material
camera.location=views[0][1];camera.rotation_euler=(Vector(views[0][2])-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=55
light.location=views[0][3];light.rotation_euler=(Vector((0,0,.03))-light.location).to_track_quat('-Z','Y').to_euler()
light.data.energy=45;light.data.size=.65
scene.render.filepath=str(OUT/'oblique.png')
for im in bpy.data.images:
    if im.source=='FILE' and im.has_data and not im.packed_file and im.filepath:im.pack()
bpy.data.libraries.write(str(OUT/'source.blend'),{scene},fake_user=True,compress=True)
receipt={'capturedUtc':datetime.now(timezone.utc).isoformat(),'native':'Blender Cycles OPTIX, 128 samples, AgX; no image edits',
 'views':[{'name':v[0],'camera':v[1],'target':v[2],'key':v[3],'gray':v[4]} for v in views],
 'files':[{'name':f.name,'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'bytes':f.stat().st_size} for f in sorted(OUT.iterdir()) if f.suffix in {'.png','.blend'}]}
(OUT/'captures.json').write_text(json.dumps(receipt,indent=2)+'\n')
result=receipt
