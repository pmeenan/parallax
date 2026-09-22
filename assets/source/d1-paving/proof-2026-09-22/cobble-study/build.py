"""Source-only small-stone assembly, reusing the approved leaf and moss artwork."""
import bpy, numpy as np, math, json, hashlib, time, random, sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from datetime import datetime, timezone

ROOT=Path(__file__).parent
CANDIDATE=sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else 'candidate1'
assert CANDIDATE in {'candidate1','candidate2'}
DEST=ROOT/CANDIDATE
assert not DEST.exists(), 'Preserve retained candidates; use a new destination.'
DEST.mkdir()
original=ROOT.parent/'layout-study/candidate1/build.py'
bootstrap=original.read_text().split('# Rounded ovate blades')[0]
bootstrap=bootstrap.replace('OUT=Path(__file__).parent','OUT=DEST')
bootstrap=bootstrap.replace("'Broken-joint layout candidate1'", "'Small stone cobble proof '+CANDIDATE")
bootstrap=bootstrap.replace("OUT.parent/'layout2.json'", "OUT.parent/'layout.json'")
(DEST/'resolved-bootstrap.py').write_text(bootstrap)
exec(compile(bootstrap,str(original),'exec'))
# The retained scaffold supplies the original three portable stone meshes,
# approved soil material, height recipe and embedded grit. No stone texture changes.
tree=BVHTree.FromPolygons([v.co[:] for v in soil.data.vertices],
                         [p.vertices[:] for p in soil.data.polygons],all_triangles=True)
stone_vertices=[];stone_faces=[]
for stone in stones:
    start=len(stone_vertices)
    stone_vertices.extend([tuple(stone.matrix_world@v.co) for v in stone.data.vertices])
    stone_faces.extend([tuple(start+i for i in p.vertices) for p in stone.data.polygons])
stone_tree=BVHTree.FromPolygons(stone_vertices,stone_faces)
del stone_vertices,stone_faces
def soil_z(x,y):
    point=tree.ray_cast(Vector((float(x),float(y),.3)),Vector((0,0,-1)),1)[0]
    assert point is not None
    return point.z

def blocked_points(points,margin=0):
    hit=np.zeros(len(points),dtype=bool)
    for a in rects:
        hit|=((points[:,0]>=a[0]-margin)&(points[:,0]<=a[2]+margin)&
              (points[:,1]>=a[1]-margin)&(points[:,1]<=a[3]+margin))
    return hit

def stone_vertex_conflicts(points):
    for p in points[blocked_points(points)]:
        hit=stone_tree.ray_cast(Vector((float(p[0]),float(p[1]),.3)),Vector((0,0,-1)),1)[0]
        if hit is not None and p[2]<hit.z+.0003:return True
    return False

def geometry_signature(ob):
    d=ob.data
    attributes={a.name:[tuple(e.color) for e in a.data] for a in d.color_attributes}
    payload=repr(([(tuple(v.co)) for v in d.vertices],
        [tuple(p.vertices) for p in d.polygons],
        [[tuple(v.uv) for v in l.data] for l in d.uv_layers],attributes))
    return hashlib.sha256(payload.encode()).hexdigest()

plant_source=PROOF/'moss/candidate1/source.blend'
with bpy.data.libraries.load(str(plant_source),link=False) as (src,dst):
    dst.objects=[name for name in src.objects if name.startswith(
        ('Broadleaf weed','Small seedling','Bowed uneven grass','Leafy moss colony'))]
plant_objects=dst.objects
for ob in plant_objects:scene.collection.objects.link(ob)
plant_before={ob.name:geometry_signature(ob) for ob in plant_objects}
source_records=json.loads((PROOF/'vegetation/candidate2/receipt.json').read_text())['plants']
source_records=[r for r in source_records if r['type']!='moss']
moss_records=json.loads((PROOF/'moss/candidate1/receipt.json').read_text())['colonies']
placed=[];plant_records=[]
rng_plants=random.Random(922932)

def candidates(anchor,radius):
    # Deterministic local search, ordered by relocation distance. No random
    # regeneration of the approved mesh, UV or botanical color data.
    xy=np.array([[anchor[0]+rng_plants.uniform(-radius,radius),
                  anchor[1]+rng_plants.uniform(-radius,radius)] for _ in range(5000)])
    xy=xy[(np.abs(xy)<1.88).all(1)]
    xy=xy[~blocked_points(xy,.002)]
    if placed:
        xy=xy[[min(math.hypot(x-a,y-b) for a,b in placed)>.045 for x,y in xy]]
    return sorted(xy,key=lambda p:float(np.linalg.norm(p-np.array(anchor[:2]))))

for record in source_records:
    group=[o for o in plant_objects if o.name==record['name'] or o.name==record['name']+' petioles']
    anchor=np.array(record['root']);all_co=np.concatenate([np.array([v.co[:] for v in ob.data.vertices]) for ob in group])
    found=None
    depth=.003 if record['type'] in {'broadleaf','seedling'} else .002
    for x,y in candidates(anchor,.55):
        dz=soil_z(x,y)-depth-anchor[2];delta=np.array([x-anchor[0],y-anchor[1],dz])
        world=all_co+delta
        low=world[world[:,2]<.084]
        if len(low) and stone_vertex_conflicts(low):continue
        found=delta;break
    assert found is not None, record['name']+' has no safe rooted placement'
    for ob in group:ob.location=found.tolist()
    placed.append((x,y))
    plant_records.append({'name':record['name'],'type':record['type'],
        'sourceRootM':anchor.tolist(),'rootM':(anchor+found).tolist(),
        'translationM':found.tolist(),'rootDepthM':depth,'lowVertexConflicts':0})

# Fit complete original moss shoots to the new soil. Every shoot retains its
# 41 vertices, leaf shapes, topology and corner colors; only rigid shoot positions
# change. This avoids deforming leaves or making a flat green joint ribbon.
moss_checks=[]
for record in moss_records:
    ob=next(o for o in plant_objects if o.name==record['name'])
    source_co=np.array([v.co[:] for v in ob.data.vertices])
    assert len(source_co)==record['shoots']*41
    shoots=source_co.reshape(-1,41,3)
    old_center=np.array(record['center']);options=candidates(old_center,.55)[:350]
    assert options
    # Favor positions where the greatest number of whole shoots already fits.
    offsets=np.array([s[0,:2] for s in shoots])
    scores=[]
    for p in options:
        free=~blocked_points(offsets+p-old_center[:2],.0018)
        scores.append((int(free.sum()),-float(np.linalg.norm(p-old_center[:2])),p))
    center=max(scores,key=lambda t:t[:2])[2]
    used=[];new=[];relocations=[];min_leaf_support=math.inf
    for s in shoots:
        root=s[:3].mean(0);desired=root[:2]+center-old_center[:2]
        attempts=[desired]+[desired+np.array([rng_plants.uniform(-.018,.018),rng_plants.uniform(-.018,.018)]) for _ in range(160)]
        best=None
        for xy in attempts:
            if used and min(float(np.linalg.norm(xy-p)) for p in used)<.00040:continue
            delta=np.array([xy[0]-root[0],xy[1]-root[1],soil_z(*xy)-.00012-root[2]])
            moved=s+delta
            if blocked_points(moved).any():continue
            # All nonstem vertices remain above actual soil; roots are embedded.
            support=min(v[2]-soil_z(*v[:2]) for v in moved[6:])
            if support<.00002:continue
            best=moved;min_leaf_support=min(min_leaf_support,support);used.append(xy);relocations.append(delta.tolist());break
        assert best is not None, 'Cannot fit original moss shoot without distortion'
        new.append(best)
    new=np.array(new)
    relative_error=float(np.max(np.abs((new-new[:,:1])-(shoots-shoots[:,:1]))))
    assert relative_error<1e-12
    ob.data.vertices.foreach_set('co',new.reshape(-1).astype(np.float32));ob.data.update()
    placed.append(tuple(center))
    moss_checks.append({'name':ob.name,'shoots':len(shoots),'originalCenterM':old_center.tolist(),
        'centerXYM':center.tolist(),'shootTranslationsM':relocations,
        'shootRelativeGeometryMaximumErrorM':relative_error,'minimumLeafSoilClearanceM':min_leaf_support,
        'rootDepthM':.00012,'projectedStoneVertexConflicts':0})

assert all(plant_before[o.name]==geometry_signature(o) for o in plant_objects if not o.name.startswith('Leafy moss'))
counts={o.name:sum(len(p.vertices)-2 for p in o.data.polygons) for o in scene.objects if o.type=='MESH'}
stone_tris=sum(counts[o.name] for o in stones);plant_tris=sum(counts[o.name] for o in plant_objects)
ground_tris=sum(counts.values())-stone_tris-plant_tris
assert sum(counts.values())<=750000
camera=bpy.data.objects.new('Patch camera',bpy.data.cameras.new('Patch camera'));scene.collection.objects.link(camera);scene.camera=camera;camera.data.clip_start=.001
light=bpy.data.objects.new('Patch area light',bpy.data.lights.new('Patch area light','AREA'));scene.collection.objects.link(light)
scene.world=bpy.data.worlds.new('Patch world');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.45,.45,.45,1)
scene.render.engine='CYCLES';scene.cycles.device='GPU';scene.cycles.samples=96;scene.cycles.use_denoising=True
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.refresh_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
scene.render.resolution_x=1800;scene.render.resolution_y=1350;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX'
detail=Vector(plant_records[0]['rootM']);moss_detail=Vector((*moss_checks[0]['centerXYM'],soil_z(*moss_checks[0]['centerXYM'])))
views=[('sunny-oblique',(4.4,-5.5,5.7),(0,0,.06),50,(-3,-4,6),2200,1,.22),
 ('opposing-light',(4.4,-5.5,5.7),(0,0,.06),50,(3,4,6),2200,1,.22),
 ('overcast',(4.4,-5.5,5.7),(0,0,.06),50,(-3,-4,6),1100,8,.5),
 ('walking',(.15,-1.7,1.7),(.05,.15,.065),42,(-3,-4,6),2200,1,.22),
 ('top-packing',(0,0,8.7),(0,0,.065),48,(-3,-4,6),2200,1,.22),
 ('plant-contact',tuple(detail+Vector((.20,-.22,.34))),tuple(detail+Vector((0,0,.025))),58,(-3,-4,6),2200,1,.22),
 ('moss-contact',tuple(moss_detail+Vector((.045,-.055,.095))),tuple(moss_detail+Vector((0,0,.002))),58,(-3,-4,6),2200,1,.22),
 ('grazing',(.3,-2.5,.36),(0,.15,.075),42,(-3,-4,6),2200,1,.22),
 ('reverse',(-4.4,5.5,5.7),(0,0,.06),50,(-3,-4,6),2200,1,.22)]
def view(state):
    name,eye,target,lens,key,energy,size,ambient=state
    camera.location=eye;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
    light.location=key;light.rotation_euler=(Vector(target)-light.location).to_track_quat('-Z','Y').to_euler();light.data.energy=energy;light.data.size=size;scene.world.node_tree.nodes['Background'].inputs[1].default_value=ambient
    scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
for state in views:view(state)
meshes=[o for o in scene.objects if o.type=='MESH']
saved={o.name:list(o.data.materials) for o in meshes};controls={}
for mode in ['gray','unlit']:
    mapping={}
    for material in set(m for mats in saved.values() for m in mats):
        m=material.copy();m.name=mode+' '+material.name;n,l=m.node_tree.nodes,m.node_tree.links;bs=n.get('Principled BSDF')
        assert bs
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
    state=list(views[3]);state[0]=mode;view(state)
    for ob in meshes:
        for i,mat in enumerate(saved[ob.name]):ob.data.materials[i]=mat
for im in bpy.data.images:
    if im.has_data and not im.packed_file:im.pack()
# Save with the sunny overview camera, without another capture.
name,eye,target,lens,key,energy,size,ambient=views[0]
camera.location=eye;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
light.location=key;light.rotation_euler=(Vector(target)-light.location).to_track_quat('-Z','Y').to_euler();light.data.energy=energy;light.data.size=size;scene.world.node_tree.nodes['Background'].inputs[1].default_value=ambient
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'),compress=True)
def identity(path):return {'path':path.as_posix(),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
receipt={'createdUtc':datetime.now(timezone.utc).isoformat(),'seconds':time.perf_counter()-START,
 'blender':bpy.app.version_string,'seed':922932,'buildScript':identity(Path(__file__)),
 'inputs':[identity(p) for p in [original,layout_path,plant_source,recipe,contact,*[Path(s['path']) for s in sources.values()]]],
 'references':['KIT-001 batch103 (smaller scale per human feedback)','KIT-002 batch104','MAT-001/MAT-018 batch108','VEG-001 batch116'],
 'stoneCount':len(stones),'uniqueStoneMeshes':len({o.data for o in stones}),
 'triangles':{'stone':stone_tris,'ground':ground_tris,'plants':plant_tris,'scene':sum(counts.values())},
 'actualXYScaleRange':[min(v for a in layout for v in a['scaleXYZ'][:2]),max(v for a in layout for v in a['scaleXYZ'][:2])],
 'layout':layout,'layoutSeamScore':layout_seam_score,'minimumAABBClearanceM':min(clearance),
 'plantRecords':plant_records,'plantOriginalGeometrySignatures':plant_before,
 'nonmossPlantGeometryAttributesUnchanged':True,'mossSupport':moss_checks,'views':views,
 'rightsReviewed':False,'sourceOnly':True,'runtimeQA':False,'artisticAcceptance':False,
 'limitations':['Three reused mineral identities remain; arrangement does not generate new source patterns',
 'High-detail ground and vegetation exceed production targets; source scene ceiling is separate',
 'Stone clearance uses conservative bounds; plant vertices are checked against actual stone top rays, not full triangle collision',
 'Moss fitted through rigid shoot relocation; complete colony layout differs from original',
 'No new bake or engine proof; existing unchanged mesh/material transfers are reused'],
 'outputs':[identity(p) for p in sorted(OUT.iterdir()) if p.suffix in {'.png','.blend','.py'}]}
(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print('COBBLE_READY',json.dumps({k:receipt[k] for k in ['stoneCount','triangles','seconds','minimumAABBClearanceM']}),flush=True)
