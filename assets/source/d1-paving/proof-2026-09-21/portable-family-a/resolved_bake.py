"""Portable material/mesh transfer proof; not library admission.

Run from the saved selected source scene in Blender 5.2.1. Output uses standard
glTF channels and can be judged separately from the high-resolution source.
"""
import bpy
import json
import time
import hashlib
from pathlib import Path
from datetime import datetime, timezone

ROOT=Path('D:/src/parallax/assets/source/d1-paving/surface-study-2026-09-21')
CYCLE=201
OUT=Path('D:\\src\\parallax\\assets\\source\\d1-paving\\proof-2026-09-21\\portable-family-a');OUT.mkdir(exist_ok=True)
START=time.perf_counter()
source_scene=bpy.data.scenes['Family A export source']
scene=source_scene.copy();scene.name=f'Portable limestone transfer proof cycle{CYCLE}'
bpy.context.window.scene=scene
# Copy objects/data so source visibility and selection cannot be changed by baking.
for old in list(scene.objects):
    new=old.copy();new.data=old.data.copy()
    scene.collection.objects.link(new)
    for coll in list(old.users_collection):
        if coll==scene.collection:coll.objects.unlink(old)
    if old==source_scene.camera:scene.camera=new
high=next(o for o in scene.objects if o.name.startswith('Family A'))
low=high.copy();low.data=high.data.copy();low.name='Limestone portable LOD0'
scene.collection.objects.link(low)
for o in scene.objects:o.select_set(False)
low.select_set(True);bpy.context.view_layer.objects.active=low
triangles=sum(len(p.vertices)-2 for p in low.data.polygons)
dec=low.modifiers.new('Source to 3900 triangle mesh','DECIMATE');dec.ratio=3900/triangles
bpy.ops.object.modifier_apply(modifier=dec.name)
tri=low.modifiers.new('Portable triangulation','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=tri.name)
assert len(low.data.polygons)<=4000
for attr in list(low.data.attributes):
    if attr.name in {'geology','plateau','grain','broad'}:low.data.attributes.remove(attr)
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=.85,island_margin=.018,area_weight=.2,correct_aspect=True)
bpy.ops.object.mode_set(mode='OBJECT')
material=bpy.data.materials.new('Baked limestone standard PBR');material.use_nodes=True
low.data.materials.clear();low.data.materials.append(material)
nodes,links=material.node_tree.nodes,material.node_tree.links
bs=nodes.get('Principled BSDF');bs.inputs['Metallic'].default_value=0
scene.render.engine='CYCLES';scene.cycles.samples=32
scene.render.bake.use_selected_to_active=True
scene.render.bake.cage_extrusion=.006
scene.render.bake.max_ray_distance=.018
scene.render.bake.margin=12
scene.render.bake.use_pass_direct=False;scene.render.bake.use_pass_indirect=False
scene.render.bake.use_pass_color=True
scene.render.bake.normal_space='TANGENT'
high.select_set(True)
images={};times={}
for channel,size,space,bake_type in [('basecolor',2048,'sRGB','DIFFUSE'),('normal',2048,'Non-Color','NORMAL'),('roughness',1024,'Non-Color','ROUGHNESS')]:
    image=bpy.data.images.new('Baked limestone '+channel,width=size,height=size,alpha=False)
    image.colorspace_settings.name=space
    node=nodes.new('ShaderNodeTexImage');node.image=image;node.label=channel;nodes.active=node
    started=time.perf_counter();bpy.ops.object.bake(type=bake_type)
    times[channel]=time.perf_counter()-started
    image.filepath_raw=str(OUT/(channel+'.png'));image.file_format='PNG';image.save();image.pack()
    images[channel]=node
links.new(images['basecolor'].outputs['Color'],bs.inputs['Base Color'])
links.new(images['roughness'].outputs['Color'],bs.inputs['Roughness'])
normal=nodes.new('ShaderNodeNormalMap');links.new(images['normal'].outputs['Color'],normal.inputs['Color'])
links.new(normal.outputs[0],bs.inputs['Normal'])
high.hide_render=True;high.hide_set(True);high.select_set(False)
scene.cycles.samples=128
scene.render.filepath=str(OUT/'native-low.png');bpy.ops.render.render(write_still=True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'limestone.glb'),export_format='GLB',use_selection=True,use_active_scene=True,export_materials='EXPORT')
# Store the portable studio without the source object dependency.
scene.collection.objects.unlink(high)
bpy.data.libraries.write(str(OUT/'portable.blend'),{scene},fake_user=True,compress=True)
receipt={'createdUtc':datetime.now(timezone.utc).isoformat(),'blender':bpy.app.version_string,
 'source':'../family/candidate2/source.blend','triangles':len(low.data.polygons),'vertices':len(low.data.vertices),
 'dimensionsM':list(low.dimensions),'materials':len(low.data.materials),'bakeSeconds':times,
 'totalSeconds':time.perf_counter()-START,'scope':'Source transfer proof only; no runtime or library acceptance',
 'knownLimitations':['Generated albedo is not physically measured and may retain illumination','Roughness is authored from scalar field, not measured','No KTX2, meshopt, LOD chain or engine QA in this proof'],
 'files':[{'name':f.name,'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'bytes':f.stat().st_size} for f in sorted(OUT.iterdir()) if f.suffix in {'.png','.blend','.glb'}]}
(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
result=receipt
