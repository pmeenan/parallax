"""Fresh gray geometry master, authored for live Blender MCP, 2026-09-20.

No former stone meshes, shaders, concept pixels or generator code are reused.
This is a high-resolution source experiment, not an admitted runtime asset.
"""
import bpy
import bmesh
import json
import math
import random
from pathlib import Path
from datetime import datetime, timezone
from mathutils import Vector, noise

OUT = Path('D:/src/parallax/assets/source/d1-paving/master-2026-09-20/cycle1')
OUT.mkdir(parents=True, exist_ok=True)
assert bpy.app.version[:3] == (5, 2, 1)
assert not (OUT / 'source.blend').exists(), 'Never overwrite a retained cycle'
assert bpy.context.mode == 'OBJECT'
START = datetime.now(timezone.utc).isoformat()
def progress(message):
    with (OUT/'construction.log').open('a',encoding='utf-8') as handle:
        handle.write(datetime.now(timezone.utc).isoformat()+' '+message+'\n')
progress('Starting new live scene')
scene = bpy.data.scenes.new('Paving master 2026-09-20 cycle1')
bpy.context.window.scene = scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1

def active(obj):
    for current in bpy.context.selected_objects:
        current.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

def mesh_object(name, verts, faces):
    mesh = bpy.data.meshes.new(name + ' mesh')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    return obj

# Deliberately nonparallel quarried faces, a clipped rear corner, varied shoulders.
# Point order is counterclockwise; dimensions remain a plausible hand-laid paver.
outline = [(-.198,-.110),(-.180,-.143),(-.053,-.148),(.143,-.139),
           (.197,-.112),(.194,.085),(.169,.132),(.063,.150),
           (-.149,.142),(-.197,.112)]
top_insets = [.010,.006,.004,.012,.014,.005,.017,.005,.010,.008]
top_heights = [.078,.0785,.080,.079,.0765,.078,.077,.0805,.079,.078]
points=[]
for i,(x,y) in enumerate(outline):
    points.append((x*.978 + .001,y*.98,.003 + .001*math.sin(i*1.7)))
    points.append((x,y,.040 + .007*math.sin(i*2.4)))
    inset=top_insets[i]
    points.append((x-math.copysign(inset,x),y-math.copysign(inset*.8,y),top_heights[i]))
bm=bmesh.new()
for p in points: bm.verts.new(p)
bmesh.ops.convex_hull(bm,input=list(bm.verts))
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
mesh=bpy.data.meshes.new('Fresh hand-fractured master source')
bm.to_mesh(mesh);bm.free()
stone=bpy.data.objects.new('Stone master - gray geometry only',mesh)
scene.collection.objects.link(stone)
active(stone)

# Individually placed, shallow angular spalls interrupt the shoulders. They do
# not form a continuous factory bevel or cover the whole top with noise.
cuts=[(-.170,-.138,.077,.027,.019,.014),(-.079,-.145,.077,.031,.015,.011),
      (.080,-.139,.080,.025,.016,.015),(.177,-.121,.068,.023,.019,.023),
      (.192,-.048,.074,.014,.031,.014),(.194,.064,.070,.018,.025,.015),
      (.137,.140,.080,.028,.020,.013),(.001,.148,.075,.027,.017,.015),
      (-.119,.144,.080,.026,.025,.015),(-.193,.075,.075,.019,.030,.014),
      (-.197,-.016,.071,.017,.030,.016),(-.135,-.145,.031,.022,.012,.009),
      (.195,.011,.028,.014,.023,.010)]
randomizer=random.Random(920)
for i,(x,y,z,sx,sy,sz) in enumerate(cuts):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=(x,y,z))
    cutter=bpy.context.object
    cutter.name=f'Temporary authored fracture {i:02}'
    cutter.scale=(sx,sy,sz)
    cutter.rotation_euler=(randomizer.uniform(-.7,.7),randomizer.uniform(-.7,.7),randomizer.uniform(-1,1))
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    active(stone)
    mod=stone.modifiers.new(f'Local fracture {i:02}','BOOLEAN')
    mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter,do_unlink=True)
progress('13 boolean fractures complete')

# Dense source supports small true geometric relief; no early decimation.
active(stone)
stone.data.remesh_voxel_size=.0009
stone.data.remesh_voxel_adaptivity=0
bpy.ops.object.voxel_remesh()
smooth=stone.modifiers.new('Submillimetre weathering of fresh fracture edges','SMOOTH')
smooth.factor=.55;smooth.iterations=4
bpy.ops.object.modifier_apply(modifier=smooth.name)
progress('Voxel remesh and restrained smoothing complete')

# Sparse angular, shallow surface losses: locality and measured depth are
# explicit, rather than high contrast shader noise posing as broken stone.
pits=[(-.097,-.046,.012,.008,.0028),(.071,.024,.018,.009,.0019),
      (-.017,.083,.009,.006,.0018),(.119,-.072,.008,.006,.0023),
      (-.129,.061,.006,.009,.0021),(.029,-.106,.012,.005,.0017)]
source_normals=[v.normal.copy() for v in stone.data.vertices]
for v,source_normal in zip(stone.data.vertices,source_normals):
    x,y,z=v.co
    top=max(0,min(1,(z-.064)/.010))
    # Very shallow worn undulation; shoulder facets remain legible.
    if top:
        undulation=.00042*noise.noise_vector(Vector((x*19,y*19,3.9)))[0]
        loss=0
        for i,(px,py,rx,ry,depth) in enumerate(pits):
            a=math.atan2((y-py)/ry,(x-px)/rx)
            r=math.sqrt(((x-px)/rx)**2+((y-py)/ry)**2)
            boundary=1+.18*math.sin(3*a+i)+.11*math.cos(5*a+.5*i)
            t=max(0,1-r/boundary)
            loss+=depth*min(1,t*4)**.7
        v.co.z += top*(undulation-loss)
    # Fine relief is physical, subdued and biased toward broken sides.
    side=1-top
    v.co += source_normal*(side*.00020*noise.noise_vector(v.co*170)[1])
stone.data.update()
progress('Localized surface relief complete')
for p in stone.data.polygons: p.use_smooth=True

mat=bpy.data.materials.new('Uniform neutral gray - no textures or bump')
mat.use_nodes=True
bsdf=mat.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Base Color'].default_value=(.30,.30,.30,1)
bsdf.inputs['Roughness'].default_value=.72
stone.data.materials.append(mat)

plane=mesh_object('Plain neutral support - not soil',[(-5,-5,0),(5,-5,0),(5,5,0),(-5,5,0)],[(0,1,2,3)])
plane.location.z=min(v.co.z for v in stone.data.vertices)
groundmat=bpy.data.materials.new('Neutral support gray')
groundmat.diffuse_color=(.19,.19,.19,1)
groundmat.use_nodes=True
groundmat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.19,.19,.19,1)
groundmat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.85
plane.data.materials.append(groundmat)
world=bpy.data.worlds.new('Neutral studio world')
world.use_nodes=True;world.node_tree.nodes.get('Background').inputs[0].default_value=(.4,.4,.4,1)
world.node_tree.nodes.get('Background').inputs[1].default_value=.45
scene.world=world
ld=bpy.data.lights.new('Broad raking key','AREA');ld.energy=170;ld.shape='DISK';ld.size=.7
light=bpy.data.objects.new('Broad raking key',ld);scene.collection.objects.link(light)
light.location=(-.55,-.45,.72)
light.rotation_euler=(Vector((0,0,.04))-light.location).to_track_quat('-Z','Y').to_euler()
camdata=bpy.data.cameras.new('Inspection camera');camera=bpy.data.objects.new('Inspection camera',camdata)
scene.collection.objects.link(camera);scene.camera=camera
camdata.lens=55;camdata.clip_start=.01;camdata.clip_end=100
scene.render.engine='CYCLES';scene.cycles.samples=64
scene.cycles.use_denoising=True
scene.render.resolution_x=1536;scene.render.resolution_y=1024;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.view_settings.view_transform='AgX'
scene.render.film_transparent=False

bm=bmesh.new();bm.from_mesh(stone.data)
metrics={'startedUtc':START,'blender':bpy.app.version_string,'vertices':len(bm.verts),
 'faces':len(bm.faces),'triangles':sum(len(f.verts)-2 for f in bm.faces),
 'nonManifoldEdges':sum(not e.is_manifold for e in bm.edges),
 'volumeM3':bm.calc_volume(signed=True),'voxelSizeM':.0009,
 'authoring':'Fresh convex quarried blank, 13 local angular fractures, dense remesh, restrained wear and 6 shallow local pits.',
 'seed':920,'materials':1,'maps':0,'references':['batch-104/kit-002-stone-family-v4.png','batch-108/mat-001-cream-limestone-v1.png','batch-103/kit-001-paving-assembly-v1.png'],
 'scope':'High resolution neutral geometry proof; not exported, QA-admitted or runtime accepted.',
 'rightsReview':'Internal authored geometry; reference rights lineage retained in concept catalog; public-shipping clearance not asserted.'}
bm.free();bpy.context.view_layer.update()
metrics['dimensionsM']=list(stone.dimensions)
metrics['minimumZAndSupportHeightM']=plane.location.z
(OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
VIEWS=[('oblique',(.53,-.62,.48),(0,0,.035),'PERSP',55),
       ('reverse',(-.55,.58,.43),(0,0,.04),'PERSP',55),
       ('top',(0,0,.9),(0,0,0),'ORTHO',.55),
       ('grazing',(.40,-.65,.145),(0,0,.04),'PERSP',55),
       ('walking-scale',(0,-.68,1.65),(0,.04,0),'PERSP',45)]
def set_view(view):
    name,location,target,kind,lens=view
    camera.location=location
    camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
    camdata.type=kind
    if kind=='ORTHO':camdata.ortho_scale=lens
    else:camdata.lens=lens
    scene.render.filepath=str(OUT/(name+'.png'))
set_view(VIEWS[0]);active(stone)
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_distance=.8
            area.spaces.active.region_3d.view_location=(0,0,.04)
            area.spaces.active.clip_start=.001
# Store this dedicated scene only; user's other scenes and filepath are intact.
bpy.data.libraries.write(str(OUT/'source.blend'),{scene},fake_user=True,compress=True)
progress('Dedicated source scene saved')
result={'scene':scene.name,'output':str(OUT),'metrics':metrics,'readyForRenders':True}
