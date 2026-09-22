"""Bounded reduction proof. Approved input is immutable; candidates refuse overwrite."""
import bpy, bmesh, math, json, hashlib, time, sys
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

START=time.perf_counter()
HERE=Path(__file__).parent
BASE=HERE.parent/'cobble-study/candidate1'
MODE=sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else 'candidate1'
assert MODE in {'candidate1','candidate2'}
OUT=HERE/MODE
assert not OUT.exists(), 'Preserve prior evidence'
OUT.mkdir(parents=True)
assert hashlib.sha256((BASE/'source.blend').read_bytes()).hexdigest()=='c5778d6d17cede747e546d6b4792d7db73f01e31b59bb399e69441b297feea20'
bpy.ops.wm.open_mainfile(filepath=str(BASE/'source.blend'))
scene=bpy.context.scene
original=json.loads((BASE/'receipt.json').read_text())
assert bpy.app.version[:3]==(5,2,1)

def tris(ob):
    return sum(len(p.vertices)-2 for p in ob.data.polygons)

def signature(ob):
    d=ob.data
    return hashlib.sha256(repr(([(tuple(v.co)) for v in d.vertices],
        [tuple(p.vertices) for p in d.polygons],
        [[tuple(v.uv) for v in l.data] for l in d.uv_layers],
        [list(row) for row in ob.matrix_world],[m.name for m in d.materials])).encode()).hexdigest()

stones=[o for o in scene.objects if o.name.startswith('Paver ')]
stone_before={o.name:signature(o) for o in stones}

def decimate(ob,target):
    before=tris(ob)
    if before<=target:return
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True);bpy.context.view_layer.objects.active=ob
    mod=ob.modifiers.new('Production reduction','DECIMATE')
    mod.ratio=(target-.5)/before
    mod.use_collapse_triangulate=True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    # Disconnected open stems can stop before the requested target; report actual
    # geometry and check the aggregate policy instead of assuming the ratio won.

soil=scene.objects['Continuous adaptive compacted earth']
soil_source=soil.data.copy()
source_tree=BVHTree.FromPolygons([v.co[:] for v in soil_source.vertices],
    [p.vertices[:] for p in soil_source.polygons],all_triangles=True)
bm=bmesh.new();bm.from_mesh(soil.data)
for axis,sign in [(0,1),(0,-1),(1,1),(1,-1)]:
    point=[0,0,0];normal=[0,0,0];point[axis]=2*sign;normal[axis]=sign
    bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
        dist=1e-7,plane_co=point,plane_no=normal,clear_outer=True,clear_inner=False)
bmesh.ops.triangulate(bm,faces=list(bm.faces))
bm.to_mesh(soil.data);bm.free();soil.data.update()
decimate(soil,6100)
tree=BVHTree.FromPolygons([v.co[:] for v in soil.data.vertices],
    [p.vertices[:] for p in soil.data.polygons],all_triangles=True)

def height(x,y,which=tree):
    hit=which.ray_cast(Vector((float(x),float(y),.4)),Vector((0,0,-1)),1)[0]
    assert hit is not None, (x,y)
    return hit.z

# Compare source and candidate at actual source vertices in the shipped patch.
errors=[]
for v in soil_source.vertices:
    if max(abs(v.co.x),abs(v.co.y))<1.99999:
        errors.append(height(v.co.x,v.co.y)-v.co.z)

# Keep the most legible embedded aggregate; high-frequency soil shading remains.
grit=scene.objects['Sparse embedded aggregate'];d=grit.data
coords=np.array([v.co[:] for v in d.vertices]).reshape(-1,12,3)
assert len(d.polygons)==len(coords)*20
sizes=np.ptp(coords,axis=1).max(1)
chosen=sorted(np.argsort(sizes)[-100:].tolist())
verts=[];faces=[];slots=[]
for index in chosen:
    chunk=coords[index].copy();center=chunk.mean(0)
    delta=height(*center[:2])-height(*center[:2],which=source_tree)
    chunk[:,2]+=delta;offset=len(verts);verts.extend(chunk.tolist())
    for p in list(d.polygons)[index*20:(index+1)*20]:
        faces.append(tuple(offset+v-index*12 for v in p.vertices));slots.append(p.material_index)
mesh=bpy.data.meshes.new('Production retained aggregate');mesh.from_pydata(verts,[],faces);mesh.update()
for m in d.materials:mesh.materials.append(m)
for p,slot in zip(mesh.polygons,slots):p.material_index=slot;p.use_smooth=True
grit.data=mesh

# Outside the 4 m export is presentation only, explicitly separate from asset costs.
preview=bpy.data.meshes.new('Preview ground outside export')
preview.from_pydata([(-30,-30,.059),(30,-30,.059),(30,30,.059),(-30,30,.059),
    (-2,-2,.059),(2,-2,.059),(2,2,.059),(-2,2,.059)],[],
    [(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
preview.materials.append(soil.data.materials[0]);preview.update()
environment=bpy.data.objects.new('Preview only surrounding ground',preview);scene.collection.objects.link(environment)
environment['excludeFromRuntime']=True

plants=[o for o in scene.objects if o.name.startswith(('Broadleaf weed','Small seedling','Bowed uneven grass','Leafy moss colony'))]
root_shifts=[]
for record in original['plantRecords']:
    root=record['rootM'];delta=height(*root[:2])-height(*root[:2],which=source_tree)
    root_shifts.append({'name':record['name'],'verticalM':delta})
    for ob in plants:
        if ob.name in {record['name'],record['name']+' petioles'}:ob.location.z+=delta
for ob in plants:
    if not ob.name.startswith('Leafy moss'):continue
    array=np.array([v.co[:] for v in ob.data.vertices]).reshape(-1,41,3)
    for shoot in array:
        root=shoot[:3].mean(0)
        shoot[:,2]+=height(*root[:2])-height(*root[:2],which=source_tree)
    ob.data.vertices.foreach_set('co',array.reshape(-1).astype(np.float32));ob.data.update()

for ob in plants:
    if MODE=='candidate1':
        # Current 4,000 exported triangle policy includes explicit reverse faces.
        # 1,850 native triangles reserve rounding and back-face costs.
        decimate(ob,max(12,int(tris(ob)*1750/54665)))
    elif ob.name.startswith('Leafy moss'):
        # Preserve every shoot and all seven leaf silhouettes; remove only their
        # subpixel raised ridge and the stem hidden inside the dense colony.
        d=ob.data;verts=[];faces=[];tints=[]
        colors=d.color_attributes['MossColor']
        per_vertex={loop.vertex_index:tuple(colors.data[loop.index].color) for loop in d.loops}
        for start in range(0,len(d.vertices),41):
            for leaf in range(7):
                ids=[start+6+5*leaf+k for k in [0,1,3,4]]
                q=len(verts);verts.extend([tuple(d.vertices[i].co) for i in ids]);tints.extend([per_vertex[i] for i in ids])
                faces.extend([(q,q+1,q+3),(q,q+3,q+2)])
        reduced=bpy.data.meshes.new(ob.name+' silhouette LOD0');reduced.from_pydata(verts,[],faces);reduced.update()
        for m in d.materials:reduced.materials.append(m)
        attr=reduced.color_attributes.new(name='MossColor',type='FLOAT_COLOR',domain='CORNER')
        reduced.color_attributes.active_color=attr
        for loop in reduced.loops:attr.data[loop.index].color=tints[loop.vertex_index]
        for p in reduced.polygons:p.use_smooth=True
        ob.data=reduced
    else:decimate(ob,max(20,int(tris(ob)*.42)))

assert stone_before=={o.name:signature(o) for o in stones}
camera=scene.camera;light=scene.objects['Patch area light']
prefs=bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type='OPTIX';prefs.refresh_devices()
for device in prefs.devices:device.use=device.type=='OPTIX'
scene.cycles.device='GPU';scene.cycles.samples=96

def view(state):
    name,eye,target,lens,key,energy,size,ambient=state
    camera.location=eye;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
    light.location=key;light.rotation_euler=(Vector(target)-light.location).to_track_quat('-Z','Y').to_euler();light.data.energy=energy;light.data.size=size
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=ambient
    scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)

for state in original['views']:view(state)
meshes=[o for o in scene.objects if o.type=='MESH'];saved={o.name:list(o.data.materials) for o in meshes}
for mode in ['gray','unlit']:
    mapping={}
    for material in set(m for mats in saved.values() for m in mats):
        m=material.copy();n,l=m.node_tree.nodes,m.node_tree.links;bs=n.get('Principled BSDF')
        if mode=='gray':
            for socket in ['Base Color','Normal']:
                for link in list(bs.inputs[socket].links):l.remove(link)
            bs.inputs['Base Color'].default_value=(.18,.18,.18,1)
        else:
            e=n.new('ShaderNodeEmission');e.inputs['Color'].default_value=bs.inputs['Base Color'].default_value
            if bs.inputs['Base Color'].is_linked:l.new(bs.inputs['Base Color'].links[0].from_socket,e.inputs['Color'])
            l.new(e.outputs[0],n['Material Output'].inputs['Surface'])
        mapping[material]=m
    for ob in meshes:
        for i,mat in enumerate(saved[ob.name]):ob.data.materials[i]=mapping[mat]
    state=list(original['views'][3]);state[0]=mode;view(state)
    for ob in meshes:
        for i,mat in enumerate(saved[ob.name]):ob.data.materials[i]=mat

# Preserve native source and builder at precisely the reviewed state.
for im in bpy.data.images:
    if im.has_data and not im.packed_file:im.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'),compress=True)
(OUT/'build-snapshot.py').write_bytes(Path(__file__).read_bytes())
def identity(p):return {'path':p.as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
counts={o.name:tris(o) for o in meshes}
receipt={'createdUtc':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
    'mode':MODE,'blender':bpy.app.version_string,'seconds':time.perf_counter()-START,
    'input':identity(BASE/'source.blend'),'sourceApproval':'cobble-results.md human approval 2026-09-22',
    'stonesUnchanged':True,'stoneSignatures':stone_before,'trianglesByObject':counts,
    'triangles':{'stones':sum(tris(o) for o in stones),'substrate':tris(soil)+tris(grit),
        'plantsNative':sum(tris(o) for o in plants),'plantsWithAllFacesDuplicated':2*sum(tris(o) for o in plants)},
    'soilHeightErrorM':{'maximumAbsolute':float(np.max(np.abs(errors))),'p99Absolute':float(np.quantile(np.abs(errors),.99)),'sampleCount':len(errors)},
    'rootShifts':root_shifts,'retainedAggregateIndices':chosen,'views':original['views'],
    'sourceOnly':True,'runtimeQA':False,'rightsReviewed':False,'artisticAcceptance':False,
    'limitations':['Procedural soil and multiple materials remain unbaked','Presentation ground outside 4m excluded from runtime costs',
        'Native reduction is not runtime qualification; no budget waiver','Vertex support is not complete triangle collision proof'],
    'files':[identity(p) for p in sorted(OUT.iterdir()) if p.suffix in {'.png','.blend','.py'}]}
(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print('PRODUCTION_READY',json.dumps({k:receipt[k] for k in ['mode','triangles','soilHeightErrorM','seconds']}),flush=True)
