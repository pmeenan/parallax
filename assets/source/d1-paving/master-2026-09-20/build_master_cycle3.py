"""One explicitly authorized connected-fracture extension, 2026-09-20.

Every fracture is a shared surface patch; no convex hull, subtractive cutters,
procedural surface noise, or former stone generator. Gray geometry only.
"""
import bpy
import bmesh
import json
import math
from pathlib import Path
from datetime import datetime,timezone
from mathutils import Vector
from mathutils.geometry import delaunay_2d_cdt

OUT=Path('D:/src/parallax/assets/source/d1-paving/master-2026-09-20/cycle3')
OUT.mkdir(parents=True,exist_ok=True)
assert bpy.app.version[:3]==(5,2,1)
assert not (OUT/'source.blend').exists()
assert bpy.context.mode=='OBJECT'
START=datetime.now(timezone.utc).isoformat()
def progress(message):
    with (OUT/'construction.log').open('a',encoding='utf-8') as f:
        f.write(datetime.now(timezone.utc).isoformat()+' '+message+'\n')
scene=bpy.data.scenes.new('Paving master 2026-09-20 cycle3')
bpy.context.window.scene=scene
scene.unit_settings.system='METRIC'
scene.unit_settings.scale_length=1
def active(obj):
    for o in bpy.context.selected_objects:o.select_set(False)
    obj.select_set(True);bpy.context.view_layer.objects.active=obj
def mesh_object(name,verts,faces):
    mesh=bpy.data.meshes.new(name+' mesh');mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);scene.collection.objects.link(obj);return obj

# Counter-clockwise perimeter: deliberately unequal intervals. Connected planes
# define both small flake boundaries and long intact stretches, not a regular grid.
rim=[(-.192,-.103),(-.177,-.138),(-.139,-.145),(-.114,-.142),(-.085,-.147),
     (-.013,-.147),(.049,-.145),(.087,-.142),(.111,-.138),(.158,-.137),
     (.195,-.107),(.197,-.051),(.193,-.010),(.194,.065),(.176,.117),
     (.142,.137),(.110,.140),(.067,.143),(.006,.147),(-.036,.141),
     (-.062,.146),(-.121,.143),(-.157,.138),(-.190,.109),(-.196,.043),
     (-.191,.011),(-.196,-.031)]
# Width of missing top material and depth of the outer fracture boundary differ
# independently. Almost intact intervals interrupt wider compound losses.
width=[.012,.017,.015,.023,.011,.003,.002,.013,.021,.008,.005,.002,.004,
       .014,.019,.010,.003,.002,.006,.018,.021,.008,.003,.014,.017,.005,.003]
drop=[.009,.013,.005,.014,.006,.002,.001,.004,.011,.003,.007,.002,.001,
      .011,.016,.005,.002,.001,.005,.007,.015,.003,.002,.010,.007,.002,.001]
N=len(rim)
verts=[];faces=[]
outer=[];inner=[];bottom=[]
normals=[]
for i,(x,y) in enumerate(rim):
    before=Vector(rim[(i-1)%N]);after=Vector(rim[(i+1)%N])
    tangent=(after-before).normalized()
    outward=Vector((tangent.y,-tangent.x));normals.append(outward)
    outer.append(len(verts));verts.append((x,y,.080-drop[i]))
    inner.append(len(verts));verts.append((x-outward.x*width[i],y-outward.y*width[i],.080))
    # The foot is slightly undercut differently around the piece, without a belt.
    inset=[.002,.006,.001,.003,.005,.001,.002][i%7]
    bottom.append(len(verts));verts.append((x-outward.x*inset,y-outward.y*inset,.002))

# Broad walking top, capped once and densified later. Shoulder facets share all
# boundary vertices. Selected extra ridge points create compound flakes, not bites.
faces.append(tuple(inner))
compound={2:(.45,.004),3:(.61,-.002),7:(.31,.003),8:(.54,.002),
          13:(.64,-.003),14:(.28,.002),18:(.56,.001),19:(.37,-.002),
          23:(.62,.002),24:(.43,-.001)}
for i in range(N):
    j=(i+1)%N
    if i in compound:
        t,zoffset=compound[i]
        a=Vector(verts[inner[i]]);b=Vector(verts[inner[j]])
        c=Vector(verts[outer[i]]);d=Vector(verts[outer[j]])
        p=(a.lerp(b,t)).lerp(c.lerp(d,t),.56)
        p.z+=zoffset
        p.z=min(.0795,max(min(c.z,d.z)+.001,p.z))
        k=len(verts);verts.append(tuple(p))
        faces.extend([(inner[i],outer[i],k),(outer[i],outer[j],k),
                      (outer[j],inner[j],k),(inner[j],inner[i],k)])
    elif i%3==0:
        faces.extend([(inner[i],outer[i],inner[j]),(outer[i],outer[j],inner[j])])
    else:
        faces.extend([(inner[i],outer[i],outer[j]),(inner[i],outer[j],inner[j])])

# Unwrap the side into distance/height, insert a small number of deliberate
# fracture junctions at unequal elevations, then triangulate connected patches.
# This avoids the former continuous ring of side vertices at half thickness.
lengths=[0.0]
for i in range(N):lengths.append(lengths[-1]+(Vector(rim[(i+1)%N])-Vector(rim[i])).length)
coords=[];global_ids=[]
for i in range(N+1):
    k=i%N
    coords.extend([Vector((lengths[i],.002)),Vector((lengths[i],.080-drop[k]))])
    global_ids.extend([bottom[k],outer[k]])
boundary=[2*i for i in range(N+1)]+[2*i+1 for i in reversed(range(N+1))]
interior_specs=[(1,.55,.049,.0015),(3,.28,.026,-.0025),(4,.61,.056,-.002),
                (8,.35,.035,.001),(10,.45,.058,-.002),(12,.28,.032,-.0015),
                (15,.65,.047,-.002),(18,.48,.025,.001),(20,.38,.055,-.0025),
                (23,.51,.032,-.0015),(25,.50,.050,.001)]
for segment,t,z,relief in interior_specs:
    j=(segment+1)%N
    p=Vector(rim[segment]).lerp(Vector(rim[j]),t)
    n=normals[segment].lerp(normals[j],t).normalized()
    # Negative values represent broad fracture losses, positive values retained ridges.
    p+=n*relief
    global_ids.append(len(verts));verts.append((p.x,p.y,z))
    coords.append(Vector((lengths[segment]+t*(lengths[segment+1]-lengths[segment]),z)))
cdt=delaunay_2d_cdt(coords,[],[boundary],1,1e-8,True)
mapping=[]
for origins in cdt[3]:
    assert len(origins)==1, 'Side construction unexpectedly merged control vertices'
    mapping.append(global_ids[origins[0]])
for tri in cdt[2]:faces.append(tuple(mapping[k] for k in tri))
faces.append(tuple(reversed(bottom)))
stone=mesh_object('Connected fracture limestone master',verts,faces)
bm=bmesh.new();bm.from_mesh(stone.data)
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
assert all(e.is_manifold for e in bm.edges),'Control mesh must already be closed'
control_faces=len(bm.faces)
bm.to_mesh(stone.data);bm.free()
progress('Closed connected fracture control mesh authored')

# Preserve the exact low-resolution planar patch graph as a separate retained source
# mesh datablock with fake user; not an extra object in captures or a runtime LOD.
control=stone.data.copy();control.name='Unworn connected fracture control mesh';control.use_fake_user=True
active(stone)
stone.data.remesh_voxel_size=.0007
stone.data.remesh_voxel_adaptivity=0
bpy.ops.object.voxel_remesh()
# Local smoothing only at upper edges: one millimetre scale physical wear, with
# intact lower planar fracture faces. No displacement noise is applied anywhere.
group=stone.vertex_groups.new(name='Upper ridge wear only')
for v in stone.data.vertices:
    w=max(0,min(1,(v.co.z-.052)/.018))
    if w>0:group.add([v.index],w,'REPLACE')
modifier=stone.modifiers.new('Restrained upper ridge weathering','SMOOTH')
modifier.factor=.55;modifier.iterations=12;modifier.vertex_group=group.name
bpy.ops.object.modifier_apply(modifier=modifier.name)
# A broad shallow worn hollow merges into the walking top; no stamp-like pit rims.
for v in stone.data.vertices:
    x,y,z=v.co
    if z>.076:
        q=((x+.028)/.100)**2+((y-.020)/.073)**2
        v.co.z-=.0006*math.exp(-q*2)*min(1,(z-.076)/.003)
stone.data.update()
for p in stone.data.polygons:p.use_smooth=True
progress('Local wear complete; no surface noise')

mat=bpy.data.materials.new('Uniform neutral gray cycle3 - no maps')
mat.use_nodes=True
shader=mat.node_tree.nodes.get('Principled BSDF')
shader.inputs['Base Color'].default_value=(.30,.30,.30,1)
shader.inputs['Roughness'].default_value=.72
stone.data.materials.append(mat)
plane=mesh_object('Plain neutral support cycle3',[(-5,-5,0),(5,-5,0),(5,5,0),(-5,5,0)],[(0,1,2,3)])
plane.location.z=min(v.co.z for v in stone.data.vertices)
ground=bpy.data.materials.new('Neutral support gray cycle3');ground.use_nodes=True
ground.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.19,.19,.19,1)
ground.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.85
plane.data.materials.append(ground)
world=bpy.data.worlds.new('Neutral studio cycle3');world.use_nodes=True
world.node_tree.nodes.get('Background').inputs[0].default_value=(.4,.4,.4,1)
world.node_tree.nodes.get('Background').inputs[1].default_value=.45
scene.world=world
lightdata=bpy.data.lights.new('Matched cycle2 key','AREA');lightdata.energy=18;lightdata.shape='DISK';lightdata.size=.55
light=bpy.data.objects.new('Matched cycle2 key',lightdata);scene.collection.objects.link(light)
light.location=(-.55,-.45,.72)
light.rotation_euler=(Vector((0,0,.04))-light.location).to_track_quat('-Z','Y').to_euler()
camdata=bpy.data.cameras.new('Inspection camera cycle3');camdata.lens=55;camdata.clip_start=.01;camdata.clip_end=100
camera=bpy.data.objects.new('Inspection camera cycle3',camdata);scene.collection.objects.link(camera);scene.camera=camera
camera.location=(.53,-.62,.48)
camera.rotation_euler=(Vector((0,0,.035))-camera.location).to_track_quat('-Z','Y').to_euler()
scene.render.engine='CYCLES';scene.cycles.samples=64;scene.cycles.use_denoising=True
scene.render.resolution_x=1536;scene.render.resolution_y=1024;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
scene.render.filepath=str(OUT/'oblique.png')
bpy.context.view_layer.update()
bm=bmesh.new();bm.from_mesh(stone.data)
metrics={'startedUtc':START,'blender':bpy.app.version_string,'vertices':len(bm.verts),
 'faces':len(bm.faces),'triangles':sum(len(f.verts)-2 for f in bm.faces),
 'nonManifoldEdges':sum(not e.is_manifold for e in bm.edges),'volumeM3':bm.calc_volume(signed=True),
 'dimensionsM':list(stone.dimensions),'minimumZAndSupportHeightM':plane.location.z,
 'controlMeshFaces':control_faces,'controlShoulderSegments':N,'compoundShoulderPatches':len(compound),
 'sideFractureJunctions':len(interior_specs),'voxelSizeM':.0007,'materials':1,'maps':0,
 'authoring':'Explicitly connected planar fracture mesh; unequal shoulder widths/elevations, shared compound patches and side junctions; upper ridge wear only. No convex hull, cutters or displacement noise.',
 'scope':'One authorized extension cycle; source geometry only, not exported, admitted or runtime accepted.',
 'references':['batch-104/kit-002-stone-family-v4.png','batch-108/mat-001-cream-limestone-v1.png','batch-103/kit-001-paving-assembly-v1.png'],
 'rightsReview':'Internal authored geometry; existing catalog reference rights lineage. No public shipping clearance asserted.'}
bm.free()
(OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
active(stone)
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_distance=.8
            area.spaces.active.region_3d.view_location=(0,0,.04)
bpy.data.libraries.write(str(OUT/'source.blend'),{scene,control},fake_user=True,compress=True)
progress('Dedicated source scene and control mesh saved')
result={'scene':scene.name,'output':str(OUT),'metrics':metrics}
